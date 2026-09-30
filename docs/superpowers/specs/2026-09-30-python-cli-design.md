# WikiMasters Python CLI: design

Status: approved design, 2026-09-30.

## Goal

A terminal tool, `wm`, that lists the player's WikiMasters collection and
discards cards, from the same API the website and the Chrome extension use.
Collection only for now. It lives in `cli/` in this repo; a move to its own
repo can come later.

## What the API looks like (captured 2026-09-30)

Both endpoints are same-origin on `https://www.wiki-masters.com` and accept
only the session cookie. An `Authorization: Bearer` header is refused (401).

`GET /api/my-collection?sort=rarity&page=<N>&stats=<0|1>`

```json
{
  "total": 161,
  "rarityCounts": { "C": 0, "PC": 0, "R": 0, "SR": 0, "UR": 0, "L": 0 },
  "tagOptions": [],
  "pendingTradeCardIds": ["<user-card-uuid>"],
  "collection": [
    {
      "id": "<user-card-uuid>",
      "card_id": "<card-uuid>",
      "user_id": "<user-uuid>",
      "count": 1,
      "starred": false,
      "is_shiny": false,
      "tags": [],
      "obtained_at": "2026-09-27T15:01:04.895652+00:00",
      "card": {
        "id": "<card-uuid>",
        "wikipedia_title": "Example",
        "wikipedia_url": "https://fr.wikipedia.org/wiki/Example",
        "image_url": null,
        "hide_image": false,
        "category": "short description, may be null",
        "lang": "fr",
        "rarity": "R",
        "atk": 10,
        "def": 10,
        "q_score": 1.5,
        "pageviews": 100,
        "created_at": "2026-04-30T15:45:35.040702+00:00"
      }
    }
  ]
}
```

- A page holds at most 50 rows. `total` and `rarityCounts` are filled only
  with `stats=1`; with `stats=0` they are `null` and `{}`.
- Rarity values seen: `C`, `PC`, `R`, `SR`, `UR`, `L`.
- `image_url` and `category` can be `null`.

`POST /api/user-cards/<user-card-uuid>/discard`, empty body. Success is a 2xx.
A refusal is a 4xx with `{"error": "<French message>"}`, for example 409
when the card is no longer owned.

## Authentication

The site uses Supabase Auth. The browser cookie is named
`sb-<project-ref>-auth-token` and is split in chunks `.0`, `.1`, ... of 3180
characters. Joined, the value is `base64-` followed by base64url JSON:

```json
{ "access_token": "<jwt>", "token_type": "bearer", "expires_in": 3600,
  "expires_at": 1790776615, "refresh_token": "<short string>", "user": { ... } }
```

The access token lives one hour. To get a new one:

`POST https://<project-ref>.supabase.co/auth/v1/token?grant_type=refresh_token`
with header `apikey: <anon key>` and body `{"refresh_token": "..."}`. The
answer has the same shape as the cookie JSON, with a new refresh token. The
old refresh token is then dead. Verified 2026-09-30: the refreshed session,
rebuilt as a cookie, is accepted by `/api/my-collection`.

Password login is not possible from a script: the Supabase project requires a
captcha token on `grant_type=password` (verified: `captcha_failed`).

The project ref and the anon key are public: they are embedded in the site's
JavaScript and sent to every visitor. The anon key only lets a client talk to
Supabase Auth; it grants no data access by itself. They are constants in
`cli/wikimasters/auth.py`.

Consequence for the user: after the first refresh by the CLI, Chrome still
holds the old refresh token. When Chrome's own access token expires, Chrome
may ask for a new login, once. After that the two sessions live apart.

## Code layout

```
cli/
  pyproject.toml            # package "wikimasters", script "wm", managed with uv
  wikimasters/
    __init__.py
    auth.py                 # cookie parse/build, session store, refresh
    models.py               # pydantic models
    client.py               # httpx client for the two endpoints
    main.py                 # Typer app
  tests/
    test_auth.py
    test_models.py
    test_client.py
    test_main.py
    fixtures/collection_page.json   # invented data
```

### auth.py

- `parse_cookie_header(header: str) -> Session`: takes the `Cookie` header
  text as pasted from DevTools (the `-b` value of a copied curl also works),
  finds the `sb-*-auth-token` chunks, joins them in order, strips `base64-`,
  decodes, validates as `Session`.
- `build_cookie_header(session: Session) -> str`: the reverse, with the same
  chunking rule, so the site sees exactly what the browser sends.
- `SessionStore` with `path` (default `~/.config/wikimasters/session.json`,
  override with env `WM_CONFIG_DIR`), `load()`, `save()`. The file is written
  with mode 0600.
- `refresh(session, http) -> Session`: calls the Supabase refresh endpoint.
- `ensure_fresh(store, http) -> Session`: loads, refreshes if `expires_at` is
  less than 60 seconds away, saves, returns. Raises `LoginRequired` when the
  file is missing or the refresh is refused.

### models.py

Pydantic v2 models: `Card`, `UserCard` (a row), `CollectionPage`, `ApiError`,
`Session`, `SessionUser` (only `id` and `user_metadata.username`). Unknown
fields are ignored, so a new field on the site does not break the CLI.
`Rarity` is a `str` enum with the six values; an unknown value stays a plain
string rather than failing (use `Union[Rarity, str]`).

### client.py

`Client(session_provider, transport=None)` wraps `httpx.Client` with base URL
`https://www.wiki-masters.com`, a browser-like `User-Agent`, and the cookie
header built from the current session.

- `collection_page(page: int, stats: bool = False) -> CollectionPage`
- `all_collection() -> CollectionPage`: page 0 with `stats=1`, then next pages
  with `stats=0` until a page has fewer than 50 rows; rows concatenated,
  `pendingTradeCardIds` unioned. Hard stop at 200 pages.
- `discard(user_card_id: str) -> None`: raises `ApiRefused(status, message)`
  on 4xx with the server's `error` text, `httpx.HTTPStatusError` on 5xx.

### main.py

Typer app `wm`:

- `wm login`: prompts for the cookie header (hidden input), parses it, saves
  the session, prints `Logged in as <username>`. `--from-file PATH` reads the
  header from a file instead.
- `wm collection [--page N] [--rarity R] [--json]`: table with id, title,
  rarity, count, starred (`*`), pending trade (`T`). `--json` prints the raw
  rows. Default sort is the API's (rarity).
- `wm discard ID [ID...] [--yes]`: loads the collection first, refuses ids
  that are starred, in a pending trade, or not found (prints why, exit 1,
  nothing discarded). Then shows the titles and asks for confirmation unless
  `--yes`. Discards one at a time, prints `ok <title>` or the error, and stops
  at the first failure. Exit code 1 if any failed.

Errors to the user, always in English: missing session -> "Not logged in. Run
`wm login`."; refresh refused -> "Session expired. Run `wm login` again.";
API refusal -> `HTTP 409: <server text>`.

## Testing

pytest. Network is faked with `httpx.MockTransport`; no test calls the live
site or Supabase. Fixtures are invented (`uc-1`, `https://img.test/1.png`).

- `test_auth.py`: parse of a two-chunk header round-trips through
  `build_cookie_header`; `ensure_fresh` refreshes when near expiry and not
  otherwise; `LoginRequired` on missing file and on a 400 from refresh.
- `test_models.py`: the fixture page validates; unknown rarity survives;
  `null` `image_url` and `category` are accepted.
- `test_client.py`: `all_collection` stops at a short page and unions pending
  ids; `discard` maps a 409 body to `ApiRefused`.
- `test_main.py`: Typer `CliRunner`; `discard` refuses a starred id before any
  POST; `--yes` skips the prompt; exit codes.

## Out of scope

Trades, notifications, pulls, any other endpoint. Reading the cookie from
Chrome. Password login. A move to a separate repo.
