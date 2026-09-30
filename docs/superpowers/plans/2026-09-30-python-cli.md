# WikiMasters Python CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `wm` terminal command that logs in from a pasted browser cookie, lists the player's WikiMasters collection, and discards cards.

**Architecture:** A small Python package in `cli/`: `auth.py` (cookie parse/build, session file, Supabase refresh), `models.py` (pydantic v2), `client.py` (httpx wrapper for the two site endpoints), `main.py` (Typer commands). Every network call goes through an injectable `httpx` transport so tests never touch the live site.

**Tech Stack:** Python 3.12+, uv, pydantic 2, httpx, typer, pytest. Spec: `docs/superpowers/specs/2026-09-30-python-cli-design.md`.

**Global Constraints:**
- Never commit personal data: no real ids, emails, cookies, tokens, or copied headers. Fixtures use invented values (`uc-1`, `card-1`, `https://img.test/1.png`).
- The Supabase project ref and anon key are public constants (they ship in the site's JavaScript); they live only in `cli/wikimasters/auth.py`.
- No test calls the network. Every `httpx.Client` used in a test gets an `httpx.MockTransport`.
- Cookie chunk size is 3180 characters, chunk names are `sb-<ref>-auth-token.0`, `.1`, ...; a value that fits in one chunk uses the bare name `sb-<ref>-auth-token`.
- A collection page holds at most 50 rows (`PAGE_SIZE = 50`); paging stops at the first page with fewer rows; hard stop at `MAX_PAGES = 200`.
- User-facing messages are English. Server error text is passed through as is.
- No em dashes anywhere (code, comments, docs, commit messages).

**User decisions (already made):**
- Collection only for now: list and discard. No trades, notifications, pulls.
- Code lives in `cli/` inside this repo; a separate repo may come later.
- Login is "paste the cookie once"; the CLI refreshes the token itself. Password login is impossible (captcha on the Supabase password grant, verified 2026-09-30).
- No FastAPI; this is a CLI, not a server.

---

## File structure

```
cli/
  pyproject.toml                      # package "wikimasters", script "wm"
  wikimasters/__init__.py
  wikimasters/models.py               # pydantic models (Task 1)
  wikimasters/auth.py                 # cookie parse/build, SessionStore, refresh (Tasks 2, 3)
  wikimasters/client.py               # httpx client for the two endpoints (Task 4)
  wikimasters/main.py                 # Typer app: login, collection, discard (Tasks 5, 6)
  tests/conftest.py                   # shared fixtures (Task 1)
  tests/fixtures/collection_page.json # invented page (Task 1)
  tests/test_models.py
  tests/test_auth.py
  tests/test_client.py
  tests/test_main.py
```

All `uv` and `pytest` commands below run from `cli/`: `cd cli && uv run pytest -q`.

---

### Task 0: Scaffold the package

**Goal:** An installable `cli/` package with a `wm` entry point and a passing empty test run.

**Files:**
- Create: `cli/pyproject.toml`
- Create: `cli/wikimasters/__init__.py`
- Create: `cli/tests/__init__.py`
- Modify: `.gitignore`
- Modify: `CLAUDE.md` (Commands line)

**Acceptance Criteria:**
- [ ] `cd cli && uv sync` creates `cli/.venv` and `cli/uv.lock` without error
- [ ] `cd cli && uv run pytest -q` prints "no tests ran" (pytest exits 5 when it finds no test; that is expected here)
- [ ] `cd cli && uv run wm --help` prints usage (the app exists in Task 5; for now a placeholder Typer app with no commands is fine)
- [ ] `git status` shows no `.venv`, `__pycache__`, or `.pytest_cache` entries

**Verify:** `cd cli && uv sync && uv run pytest -q; uv run wm --help` → "no tests ran" (exit 5), then a usage line

**Steps:**

- [ ] **Step 1: Write `cli/pyproject.toml`**

```toml
[project]
name = "wikimasters"
version = "0.1.0"
description = "WikiMasters collection from the terminal"
requires-python = ">=3.12"
dependencies = [
    "httpx>=0.27",
    "pydantic>=2.7",
    "typer>=0.12",
]

[project.scripts]
wm = "wikimasters.main:app"

[dependency-groups]
dev = ["pytest>=8"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["wikimasters"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 2: Create the package and a placeholder app**

`cli/wikimasters/__init__.py`: empty file.

`cli/wikimasters/main.py` (placeholder, replaced in Task 5):

```python
import typer

app = typer.Typer(help="WikiMasters from the terminal.", no_args_is_help=True)


@app.callback()
def _root() -> None:
    """WikiMasters from the terminal."""
```

`cli/tests/__init__.py`: empty file.

- [ ] **Step 3: Ignore build output**

Append to the root `.gitignore`:

```
.venv/
__pycache__/
.pytest_cache/
*.egg-info/
```

- [ ] **Step 4: Note the commands in `CLAUDE.md`**

Change the line `Commands: \`npm test\` (vitest), \`npm run build\` (esbuild to \`extension/dist/\`).` to:

```
Commands: `npm test` (vitest), `npm run build` (esbuild to `extension/dist/`),
`cd cli && uv run pytest -q` (Python CLI tests).
```

- [ ] **Step 5: Install and verify**

Run: `cd cli && uv sync && uv run pytest -q; uv run wm --help`
Expected: `uv.lock` created, "no tests ran" (exit 5), then the Typer usage text.

- [ ] **Step 6: Commit**

```bash
git add .gitignore CLAUDE.md cli/pyproject.toml cli/uv.lock cli/wikimasters cli/tests
git commit -m "chore(cli): scaffold the wikimasters python package"
```

---

### Task 1: Pydantic models

**Goal:** Typed models for the collection page, a row, a card, the API error, and the Supabase session, plus the shared test fixture.

**Files:**
- Create: `cli/wikimasters/models.py`
- Create: `cli/tests/fixtures/collection_page.json`
- Create: `cli/tests/conftest.py`
- Test: `cli/tests/test_models.py`

**Acceptance Criteria:**
- [ ] The fixture page validates into `CollectionPage` with 3 rows and the right pending id
- [ ] `null` `image_url` and `null` `category` are accepted
- [ ] A known rarity becomes `Rarity.R`; an unknown rarity like `"XX"` stays the plain string `"XX"`
- [ ] Unknown fields in any object are ignored, not rejected
- [ ] `Session` keeps unknown fields (so the cookie round-trips) and `SessionUser.username` reads `user_metadata.username`
- [ ] `ApiError.text()` returns `error`, else `message`, else `""`

**Verify:** `cd cli && uv run pytest tests/test_models.py -v` → all PASS

**Steps:**

- [ ] **Step 1: Write the fixture**

`cli/tests/fixtures/collection_page.json`:

```json
{
  "total": 3,
  "rarityCounts": { "C": 0, "PC": 0, "R": 1, "SR": 1, "UR": 1, "L": 0 },
  "tagOptions": [],
  "pendingTradeCardIds": ["uc-3"],
  "collection": [
    {
      "id": "uc-1",
      "card_id": "card-1",
      "user_id": "<user-uuid>",
      "count": 1,
      "starred": false,
      "is_shiny": false,
      "tags": [],
      "obtained_at": "2026-09-27T15:01:04.895652+00:00",
      "card": {
        "id": "card-1",
        "wikipedia_title": "Alpha",
        "wikipedia_url": "https://fr.wikipedia.org/wiki/Alpha",
        "image_url": "https://img.test/1.png",
        "hide_image": false,
        "category": "first thing",
        "lang": "fr",
        "rarity": "R",
        "atk": 10,
        "def": 12,
        "q_score": 1.5,
        "pageviews": 100,
        "created_at": "2026-04-30T15:45:35.040702+00:00"
      }
    },
    {
      "id": "uc-2",
      "card_id": "card-2",
      "user_id": "<user-uuid>",
      "count": 2,
      "starred": true,
      "is_shiny": false,
      "tags": [],
      "obtained_at": "2026-09-27T15:02:04.000000+00:00",
      "card": {
        "id": "card-2",
        "wikipedia_title": "Beta",
        "wikipedia_url": "https://fr.wikipedia.org/wiki/Beta",
        "image_url": null,
        "hide_image": false,
        "category": null,
        "lang": "fr",
        "rarity": "SR",
        "atk": 20,
        "def": 22,
        "q_score": 2.5,
        "pageviews": 200,
        "created_at": "2026-04-30T15:45:35.040702+00:00"
      }
    },
    {
      "id": "uc-3",
      "card_id": "card-3",
      "user_id": "<user-uuid>",
      "count": 1,
      "starred": false,
      "is_shiny": true,
      "tags": [],
      "obtained_at": "2026-09-27T15:03:04.000000+00:00",
      "card": {
        "id": "card-3",
        "wikipedia_title": "Gamma",
        "wikipedia_url": "https://fr.wikipedia.org/wiki/Gamma",
        "image_url": "https://img.test/3.png",
        "hide_image": false,
        "category": "third thing",
        "lang": "fr",
        "rarity": "UR",
        "atk": 30,
        "def": 32,
        "q_score": 3.5,
        "pageviews": 300,
        "created_at": "2026-04-30T15:45:35.040702+00:00"
      }
    }
  ]
}
```

- [ ] **Step 2: Write `cli/tests/conftest.py`**

```python
import json
import time
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def page_json() -> dict:
    return json.loads((FIXTURES / "collection_page.json").read_text())


def make_session_dict(expires_in_s: int = 3600) -> dict:
    """An invented Supabase session, shaped like the real cookie JSON."""
    now = int(time.time())
    return {
        "access_token": "access-1",
        "token_type": "bearer",
        "expires_in": 3600,
        "expires_at": now + expires_in_s,
        "refresh_token": "refresh-1",
        "user": {
            "id": "<user-uuid>",
            "aud": "authenticated",
            "user_metadata": {"username": "tester"},
        },
    }


@pytest.fixture
def session_dict() -> dict:
    return make_session_dict()
```

- [ ] **Step 3: Write the failing tests**

`cli/tests/test_models.py`:

```python
from wikimasters.models import ApiError, CollectionPage, Rarity, Session, UserCard


def test_fixture_page_validates(page_json):
    page = CollectionPage.model_validate(page_json)
    assert page.total == 3
    assert page.rarity_counts["SR"] == 1
    assert page.pending_trade_card_ids == ["uc-3"]
    assert [r.id for r in page.collection] == ["uc-1", "uc-2", "uc-3"]


def test_nulls_are_accepted(page_json):
    page = CollectionPage.model_validate(page_json)
    beta = page.collection[1]
    assert beta.card.image_url is None
    assert beta.card.category is None
    assert beta.starred is True
    assert beta.card.def_ == 22


def test_stats_zero_page_has_no_total():
    page = CollectionPage.model_validate(
        {"total": None, "rarityCounts": {}, "tagOptions": [], "pendingTradeCardIds": [], "collection": []}
    )
    assert page.total is None
    assert page.rarity_counts == {}


def test_known_and_unknown_rarity(page_json):
    row = page_json["collection"][0]
    assert UserCard.model_validate(row).card.rarity is Rarity.R
    row["card"]["rarity"] = "XX"
    assert UserCard.model_validate(row).card.rarity == "XX"


def test_unknown_fields_are_ignored(page_json):
    page_json["surprise"] = 1
    page_json["collection"][0]["card"]["surprise"] = 1
    CollectionPage.model_validate(page_json)


def test_session_round_trips_unknown_fields(session_dict):
    session_dict["provider_token"] = "keep-me"
    session = Session.model_validate(session_dict)
    assert session.user.username == "tester"
    assert session.model_dump()["provider_token"] == "keep-me"


def test_api_error_text():
    assert ApiError.model_validate({"error": "nope"}).text() == "nope"
    assert ApiError.model_validate({"message": "msg"}).text() == "msg"
    assert ApiError.model_validate({}).text() == ""
```

- [ ] **Step 4: Run the tests to see them fail**

Run: `cd cli && uv run pytest tests/test_models.py -q`
Expected: ImportError, `wikimasters.models` does not exist.

- [ ] **Step 5: Write `cli/wikimasters/models.py`**

```python
"""Pydantic models for the WikiMasters API and the Supabase session."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class Rarity(StrEnum):
    C = "C"
    PC = "PC"
    R = "R"
    SR = "SR"
    UR = "UR"
    L = "L"


class _Model(BaseModel):
    """Ignore fields we do not model, so a new site field never breaks the CLI."""

    model_config = ConfigDict(extra="ignore", populate_by_name=True)


class Card(_Model):
    id: str
    wikipedia_title: str
    wikipedia_url: str | None = None
    image_url: str | None = None
    hide_image: bool = False
    category: str | None = None
    lang: str | None = None
    rarity: Rarity | str
    atk: int | None = None
    def_: int | None = Field(default=None, alias="def")
    q_score: float | None = None
    pageviews: int | None = None
    created_at: datetime | None = None


class UserCard(_Model):
    """One row of the collection: a card the player owns."""

    id: str
    card_id: str
    count: int = 1
    starred: bool = False
    is_shiny: bool = False
    tags: list[str] = Field(default_factory=list)
    obtained_at: datetime | None = None
    card: Card


class CollectionPage(_Model):
    total: int | None = None
    rarity_counts: dict[str, int] | None = Field(default=None, alias="rarityCounts")
    pending_trade_card_ids: list[str] = Field(default_factory=list, alias="pendingTradeCardIds")
    collection: list[UserCard] = Field(default_factory=list)


class ApiError(_Model):
    error: str | None = None
    message: str | None = None

    def text(self) -> str:
        return self.error or self.message or ""


class _KeepAll(BaseModel):
    """Keep unknown fields, so the session JSON round-trips through the cookie unchanged."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)


class SessionUser(_KeepAll):
    id: str
    user_metadata: dict = Field(default_factory=dict)

    @property
    def username(self) -> str | None:
        name = self.user_metadata.get("username")
        return name if isinstance(name, str) else None


class Session(_KeepAll):
    access_token: str
    token_type: str = "bearer"
    expires_in: int | None = None
    expires_at: int
    refresh_token: str
    user: SessionUser | None = None
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd cli && uv run pytest tests/test_models.py -v`
Expected: 7 PASS.

- [ ] **Step 7: Commit**

```bash
git add cli/wikimasters/models.py cli/tests/conftest.py cli/tests/fixtures/collection_page.json cli/tests/test_models.py
git commit -m "feat(cli): pydantic models for the collection and the session"
```

---

### Task 2: Cookie parse, cookie build, session store

**Goal:** Turn a pasted Cookie header into a `Session`, turn a `Session` back into the exact cookie the site expects, and keep it on disk.

**Files:**
- Create: `cli/wikimasters/auth.py`
- Test: `cli/tests/test_auth.py`

**Acceptance Criteria:**
- [ ] `parse_cookie_header` finds the `sb-<ref>-auth-token` chunks anywhere in the pasted text (a bare header or a whole copied curl command), joins them by index, and returns a `Session`
- [ ] A single unchunked cookie (bare name, no `.0`) also parses
- [ ] `build_cookie_header(parse_cookie_header(h))` re-parses to the same session (round trip)
- [ ] `build_cookie_header` splits at 3180 characters into `.0`, `.1`, ... and uses the bare name when the value fits in one chunk
- [ ] Text with no such cookie raises `LoginRequired`
- [ ] `SessionStore.save` writes `session.json` with mode `0600`; `load` reads it back; `load` on a missing file raises `LoginRequired` with the text "Not logged in. Run `wm login`."
- [ ] `SessionStore()` defaults to `$WM_CONFIG_DIR/session.json`, else `~/.config/wikimasters/session.json`

**Verify:** `cd cli && uv run pytest tests/test_auth.py -v` → all PASS

**Steps:**

- [ ] **Step 1: Write the failing tests**

`cli/tests/test_auth.py`:

```python
import base64
import json
import stat

import pytest

from wikimasters import auth
from wikimasters.auth import (
    COOKIE_NAME,
    LoginRequired,
    SessionStore,
    build_cookie_header,
    parse_cookie_header,
)
from wikimasters.models import Session

from .conftest import make_session_dict


def encode_cookie_value(data: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode()
    return "base64-" + raw.rstrip("=")


def test_parse_two_chunk_header(session_dict):
    session_dict["user"]["padding"] = "x" * 4000  # force two chunks
    value = encode_cookie_value(session_dict)
    assert len(value) > auth.CHUNK_SIZE
    header = f"{COOKIE_NAME}.0={value[:auth.CHUNK_SIZE]}; {COOKIE_NAME}.1={value[auth.CHUNK_SIZE:]}"
    session = parse_cookie_header(header)
    assert session.access_token == "access-1"
    assert session.user.username == "tester"


def test_parse_whole_curl_command(session_dict):
    value = encode_cookie_value(session_dict)
    text = f"curl 'https://example.test/api' \\\n  -b '{COOKIE_NAME}={value}' \\\n  -H 'accept: */*'"
    assert parse_cookie_header(text).refresh_token == "refresh-1"


def test_parse_missing_cookie():
    with pytest.raises(LoginRequired):
        parse_cookie_header("foo=bar; other=1")


def test_round_trip_long_session(session_dict):
    session_dict["user"]["padding"] = "y" * 4000
    session = Session.model_validate(session_dict)
    header = build_cookie_header(session)
    assert f"{COOKIE_NAME}.0=" in header and f"{COOKIE_NAME}.1=" in header
    for part in header.split("; "):
        assert len(part.split("=", 1)[1]) <= auth.CHUNK_SIZE
    again = parse_cookie_header(header)
    assert again.model_dump() == session.model_dump()


def test_build_short_session_uses_bare_name(session_dict):
    header = build_cookie_header(Session.model_validate(session_dict))
    assert header.startswith(f"{COOKIE_NAME}=base64-")
    assert ".0=" not in header


def test_store_save_and_load(tmp_path, session_dict):
    store = SessionStore(tmp_path / "session.json")
    store.save(Session.model_validate(session_dict))
    mode = stat.S_IMODE(store.path.stat().st_mode)
    assert mode == 0o600
    assert store.load().access_token == "access-1"


def test_store_missing_file(tmp_path):
    with pytest.raises(LoginRequired, match="Not logged in"):
        SessionStore(tmp_path / "nope.json").load()


def test_store_default_path_uses_env(monkeypatch, tmp_path):
    monkeypatch.setenv("WM_CONFIG_DIR", str(tmp_path))
    assert SessionStore().path == tmp_path / "session.json"
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd cli && uv run pytest tests/test_auth.py -q`
Expected: ImportError, `wikimasters.auth` does not exist.

- [ ] **Step 3: Write `cli/wikimasters/auth.py`**

```python
"""Session handling: the browser cookie, the session file, and the token refresh.

The site uses Supabase Auth. The browser keeps the session in a cookie named
sb-<project-ref>-auth-token, split in 3180-character chunks (.0, .1, ...).
Joined, the value is "base64-" followed by base64url JSON.
"""

from __future__ import annotations

import base64
import os
import re
from pathlib import Path

from .models import Session

# Public values: both ship in the site's JavaScript and reach every visitor.
# The anon key only lets a client talk to Supabase Auth; it grants no data on its own.
PROJECT_REF = "cyrxjeppjqsxxjayfrur"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN5cnhqZXBwanFzeHhqYXlmcnVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM4ODAzMzksImV4cCI6MjA4OTQ1NjMzOX0.BZluyXygNxuQGDPxFX1zG5i-cqp10CVK-8GGtuak4Rg"
COOKIE_NAME = f"sb-{PROJECT_REF}-auth-token"
CHUNK_SIZE = 3180
PREFIX = "base64-"

_CHUNK_RE = re.compile(re.escape(COOKIE_NAME) + r"(?:\.(\d+))?=([A-Za-z0-9_\-]+)")


class LoginRequired(Exception):
    """The CLI has no usable session. The user must run `wm login`."""


def parse_cookie_header(text: str) -> Session:
    """Find the auth cookie chunks anywhere in `text` and decode the session."""
    found = _CHUNK_RE.findall(text)
    if not found:
        raise LoginRequired(f"No {COOKIE_NAME} cookie found in the pasted text.")
    chunks = sorted(found, key=lambda m: int(m[0] or 0))
    value = "".join(v for _, v in chunks)
    if not value.startswith(PREFIX):
        raise LoginRequired("The cookie value does not start with 'base64-'.")
    raw = value[len(PREFIX) :]
    data = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
    return Session.model_validate_json(data)


def build_cookie_header(session: Session) -> str:
    """The reverse of parse_cookie_header, with the browser's own chunk rule."""
    payload = session.model_dump_json(by_alias=True)
    value = PREFIX + base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    if len(value) <= CHUNK_SIZE:
        return f"{COOKIE_NAME}={value}"
    chunks = [value[i : i + CHUNK_SIZE] for i in range(0, len(value), CHUNK_SIZE)]
    return "; ".join(f"{COOKIE_NAME}.{i}={chunk}" for i, chunk in enumerate(chunks))


def default_config_dir() -> Path:
    env = os.environ.get("WM_CONFIG_DIR")
    return Path(env) if env else Path.home() / ".config" / "wikimasters"


class SessionStore:
    """The session file on disk."""

    def __init__(self, path: Path | None = None) -> None:
        self.path = Path(path) if path else default_config_dir() / "session.json"

    def load(self) -> Session:
        if not self.path.exists():
            raise LoginRequired("Not logged in. Run `wm login`.")
        return Session.model_validate_json(self.path.read_text())

    def save(self, session: Session) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(session.model_dump_json(by_alias=True))
        self.path.chmod(0o600)
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd cli && uv run pytest tests/test_auth.py -v`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/wikimasters/auth.py cli/tests/test_auth.py
git commit -m "feat(cli): parse and rebuild the supabase auth cookie, store the session"
```

---

### Task 3: Token refresh

**Goal:** Refresh an expiring session against Supabase Auth and keep the file current.

**Files:**
- Modify: `cli/wikimasters/auth.py`
- Test: `cli/tests/test_auth.py`

**Acceptance Criteria:**
- [ ] `ANON_KEY` (set in Task 2) decodes to a JWT whose payload has `"role": "anon"` and `"ref": "cyrxjeppjqsxxjayfrur"`
- [ ] `refresh(session, http)` POSTs to `https://cyrxjeppjqsxxjayfrur.supabase.co/auth/v1/token?grant_type=refresh_token` with header `apikey: <ANON_KEY>` and JSON body `{"refresh_token": ...}`, and returns the new `Session`
- [ ] A non-200 answer raises `LoginRequired` with the text "Session expired. Run `wm login` again."
- [ ] `ensure_fresh(store, http, now=None)` refreshes and saves when `expires_at - now < 60`, and returns the stored session untouched otherwise
- [ ] `ensure_fresh` on a missing file raises `LoginRequired`

**Verify:** `cd cli && uv run pytest tests/test_auth.py -v` → all PASS

**Steps:**

- [ ] **Step 1: Add the failing tests to `cli/tests/test_auth.py`**

Add `import httpx` and `from wikimasters.auth import ANON_KEY, REFRESH_URL, ensure_fresh, refresh` to the imports at the top, then append:

```python


def refresh_transport(status: int = 200, calls: list | None = None) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(request)
        if status != 200:
            return httpx.Response(status, json={"error_code": "refresh_token_not_found"})
        body = make_session_dict()
        body["access_token"] = "access-2"
        body["refresh_token"] = "refresh-2"
        return httpx.Response(200, json=body)

    return httpx.MockTransport(handler)


def test_anon_key_is_the_anon_role():
    payload = ANON_KEY.split(".")[1]
    decoded = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert decoded["role"] == "anon"
    assert decoded["ref"] == auth.PROJECT_REF


def test_refresh_posts_token_and_returns_new_session(session_dict):
    calls: list[httpx.Request] = []
    http = httpx.Client(transport=refresh_transport(calls=calls))
    new = refresh(Session.model_validate(session_dict), http)
    assert new.access_token == "access-2"
    req = calls[0]
    assert str(req.url) == REFRESH_URL
    assert req.headers["apikey"] == ANON_KEY
    assert json.loads(req.content) == {"refresh_token": "refresh-1"}


def test_refresh_refused_raises_login_required(session_dict):
    http = httpx.Client(transport=refresh_transport(status=400))
    with pytest.raises(LoginRequired, match="Session expired"):
        refresh(Session.model_validate(session_dict), http)


def test_ensure_fresh_refreshes_near_expiry(tmp_path):
    store = SessionStore(tmp_path / "session.json")
    store.save(Session.model_validate(make_session_dict(expires_in_s=30)))
    http = httpx.Client(transport=refresh_transport())
    session = ensure_fresh(store, http)
    assert session.access_token == "access-2"
    assert store.load().refresh_token == "refresh-2"


def test_ensure_fresh_keeps_a_valid_session(tmp_path):
    store = SessionStore(tmp_path / "session.json")
    store.save(Session.model_validate(make_session_dict(expires_in_s=3600)))
    calls: list[httpx.Request] = []
    http = httpx.Client(transport=refresh_transport(calls=calls))
    assert ensure_fresh(store, http).access_token == "access-1"
    assert calls == []


def test_ensure_fresh_without_file(tmp_path):
    with pytest.raises(LoginRequired):
        ensure_fresh(SessionStore(tmp_path / "none.json"), httpx.Client(transport=refresh_transport()))
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd cli && uv run pytest tests/test_auth.py -q`
Expected: ImportError on `REFRESH_URL`, `ensure_fresh`, `refresh`.

- [ ] **Step 3: Add the refresh code to `cli/wikimasters/auth.py`**

Add `import time` and `import httpx` to the imports at the top, and these constants next to the others:

```python
REFRESH_URL = f"https://{PROJECT_REF}.supabase.co/auth/v1/token?grant_type=refresh_token"
REFRESH_MARGIN_S = 60
```

Append at the end of the file:

```python
def refresh(session: Session, http: httpx.Client) -> Session:
    """Exchange the refresh token for a new session. The old refresh token dies."""
    response = http.post(
        REFRESH_URL,
        headers={"apikey": ANON_KEY},
        json={"refresh_token": session.refresh_token},
    )
    if response.status_code != 200:
        raise LoginRequired("Session expired. Run `wm login` again.")
    return Session.model_validate(response.json())


def ensure_fresh(store: SessionStore, http: httpx.Client, now: float | None = None) -> Session:
    """Load the session; refresh and save it when the access token is about to expire."""
    session = store.load()
    current = time.time() if now is None else now
    if session.expires_at - current < REFRESH_MARGIN_S:
        session = refresh(session, http)
        store.save(session)
    return session
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd cli && uv run pytest tests/test_auth.py -v`
Expected: 14 PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/wikimasters/auth.py cli/tests/test_auth.py
git commit -m "feat(cli): refresh the supabase session before it expires"
```

---

### Task 4: API client

**Goal:** An httpx client that loads collection pages, walks all pages, and discards one card, with server refusals mapped to a typed error.

**Files:**
- Create: `cli/wikimasters/client.py`
- Test: `cli/tests/test_client.py`

**Acceptance Criteria:**
- [ ] Every request carries the `cookie` header from `build_cookie_header(session)` and a browser-like `user-agent`
- [ ] `collection_page(n, stats)` GETs `/api/my-collection?sort=rarity&page=n&stats=0|1` and returns a `CollectionPage`
- [ ] `all_collection()` asks page 0 with `stats=1`, then pages 1.. with `stats=0`, stops at the first page with fewer than 50 rows, concatenates rows, unions `pendingTradeCardIds`, keeps `total` and `rarityCounts` from page 0
- [ ] `all_collection()` raises `RuntimeError` after 200 full pages
- [ ] `discard(id)` POSTs `/api/user-cards/<id>/discard` with an empty body
- [ ] A 4xx answer raises `ApiRefused(status, message)` where `message` is the JSON `error` (or `message`), else the trimmed body text; `str(err)` is `HTTP <status>: <message>`
- [ ] A 5xx answer raises `httpx.HTTPStatusError`

**Verify:** `cd cli && uv run pytest tests/test_client.py -v` → all PASS

**Steps:**

- [ ] **Step 1: Write the failing tests**

`cli/tests/test_client.py`:

```python
import json

import httpx
import pytest

from wikimasters.auth import COOKIE_NAME
from wikimasters.client import PAGE_SIZE, ApiRefused, Client
from wikimasters.models import Session

from .conftest import make_session_dict


def make_row(i: int, **overrides) -> dict:
    row = {
        "id": f"uc-{i}",
        "card_id": f"card-{i}",
        "count": 1,
        "starred": False,
        "is_shiny": False,
        "tags": [],
        "card": {"id": f"card-{i}", "wikipedia_title": f"Title {i}", "rarity": "R"},
    }
    row.update(overrides)
    return row


def make_page(rows: list[dict], pending: list[str] = (), total: int | None = None) -> dict:
    return {
        "total": total,
        "rarityCounts": {"R": len(rows)} if total is not None else {},
        "tagOptions": [],
        "pendingTradeCardIds": list(pending),
        "collection": rows,
    }


@pytest.fixture
def session() -> Session:
    return Session.model_validate(make_session_dict())


def client_with(handler, session: Session) -> tuple[Client, list[httpx.Request]]:
    calls: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    return Client(session, transport=httpx.MockTransport(wrapped)), calls


def test_collection_page_sends_cookie_and_params(session, page_json):
    client, calls = client_with(lambda r: httpx.Response(200, json=page_json), session)
    page = client.collection_page(2, stats=True)
    assert [r.id for r in page.collection] == ["uc-1", "uc-2", "uc-3"]
    req = calls[0]
    assert req.url.path == "/api/my-collection"
    assert dict(req.url.params) == {"sort": "rarity", "page": "2", "stats": "1"}
    assert req.headers["cookie"].startswith(f"{COOKIE_NAME}=base64-")
    assert "Mozilla" in req.headers["user-agent"]


def test_all_collection_walks_until_short_page(session):
    pages = {
        0: make_page([make_row(i) for i in range(PAGE_SIZE)], pending=["uc-1"], total=52),
        1: make_page([make_row(50), make_row(51)], pending=["uc-51"]),
    }

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=pages[int(request.url.params["page"])])

    client, calls = client_with(handler, session)
    page = client.all_collection()
    assert len(page.collection) == 52
    assert page.total == 52
    assert page.rarity_counts == {"R": 50}
    assert page.pending_trade_card_ids == ["uc-1", "uc-51"]
    assert [c.url.params["stats"] for c in calls] == ["1", "0"]


def test_all_collection_stops_at_max_pages(session, monkeypatch):
    monkeypatch.setattr("wikimasters.client.MAX_PAGES", 3)
    full = make_page([make_row(i) for i in range(PAGE_SIZE)])
    client, _ = client_with(lambda r: httpx.Response(200, json=full), session)
    with pytest.raises(RuntimeError, match="more than 3 pages"):
        client.all_collection()


def test_discard_posts_empty_body(session):
    client, calls = client_with(lambda r: httpx.Response(200, json={"ok": True}), session)
    client.discard("uc-1")
    req = calls[0]
    assert req.method == "POST"
    assert req.url.path == "/api/user-cards/uc-1/discard"
    assert req.content == b""


def test_discard_refusal_maps_to_api_refused(session):
    client, _ = client_with(lambda r: httpx.Response(409, json={"error": "Vous ne possédez plus cette carte"}), session)
    with pytest.raises(ApiRefused) as info:
        client.discard("uc-1")
    assert info.value.status == 409
    assert info.value.message == "Vous ne possédez plus cette carte"
    assert str(info.value) == "HTTP 409: Vous ne possédez plus cette carte"


def test_refusal_with_plain_text_body(session):
    client, _ = client_with(lambda r: httpx.Response(401, text="Unauthorized"), session)
    with pytest.raises(ApiRefused, match="HTTP 401: Unauthorized"):
        client.collection_page(0)


def test_server_error_raises_httpx_error(session):
    client, _ = client_with(lambda r: httpx.Response(502, text="bad gateway"), session)
    with pytest.raises(httpx.HTTPStatusError):
        client.collection_page(0)
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd cli && uv run pytest tests/test_client.py -q`
Expected: ImportError, `wikimasters.client` does not exist.

- [ ] **Step 3: Write `cli/wikimasters/client.py`**

```python
"""HTTP client for the two WikiMasters endpoints the CLI uses."""

from __future__ import annotations

import httpx

from .auth import build_cookie_header
from .models import ApiError, CollectionPage, Session

BASE_URL = "https://www.wiki-masters.com"
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"
)
PAGE_SIZE = 50
MAX_PAGES = 200


class ApiRefused(Exception):
    """The site answered 4xx. `message` is the server's own text, often French."""

    def __init__(self, status: int, message: str) -> None:
        self.status = status
        self.message = message
        super().__init__(f"HTTP {status}: {message}" if message else f"HTTP {status}")


class Client:
    def __init__(self, session: Session, transport: httpx.BaseTransport | None = None) -> None:
        self._http = httpx.Client(
            base_url=BASE_URL,
            transport=transport,
            timeout=30,
            headers={
                "user-agent": USER_AGENT,
                "accept": "*/*",
                "cookie": build_cookie_header(session),
            },
        )

    def close(self) -> None:
        self._http.close()

    def collection_page(self, page: int, stats: bool = False) -> CollectionPage:
        response = self._http.get(
            "/api/my-collection",
            params={"sort": "rarity", "page": page, "stats": int(stats)},
        )
        _raise_for(response)
        return CollectionPage.model_validate(response.json())

    def all_collection(self) -> CollectionPage:
        """Every row, in the site's order. Stops at the first page shorter than PAGE_SIZE."""
        first = self.collection_page(0, stats=True)
        rows = list(first.collection)
        pending = set(first.pending_trade_card_ids)
        last = first
        page = 1
        while len(last.collection) >= PAGE_SIZE:
            if page >= MAX_PAGES:
                raise RuntimeError(f"Collection has more than {MAX_PAGES} pages; stopped to avoid an endless loop")
            last = self.collection_page(page)
            rows.extend(last.collection)
            pending.update(last.pending_trade_card_ids)
            page += 1
        return CollectionPage(
            total=first.total,
            rarity_counts=first.rarity_counts,
            pending_trade_card_ids=sorted(pending),
            collection=rows,
        )

    def discard(self, user_card_id: str) -> None:
        response = self._http.post(f"/api/user-cards/{user_card_id}/discard")
        _raise_for(response)


def _raise_for(response: httpx.Response) -> None:
    if response.is_success:
        return
    if 400 <= response.status_code < 500:
        try:
            message = ApiError.model_validate(response.json()).text()
        except ValueError:
            message = ""
        if not message:
            message = response.text.strip()[:150]
        raise ApiRefused(response.status_code, message)
    response.raise_for_status()
```

Note: `sorted(pending)` sorts the ids as strings; the test expects `["uc-1", "uc-51"]`, which is sorted order.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd cli && uv run pytest tests/test_client.py -v`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add cli/wikimasters/client.py cli/tests/test_client.py
git commit -m "feat(cli): httpx client for the collection and discard endpoints"
```

---

### Task 5: `wm login` and `wm collection`

**Goal:** The Typer app with the login command and the collection listing.

**Files:**
- Modify: `cli/wikimasters/main.py` (replace the placeholder)
- Test: `cli/tests/test_main.py`

**Acceptance Criteria:**
- [ ] `wm login` reads the pasted text from stdin when stdin is not a terminal, or from `--from-file PATH`; on a terminal with no `--from-file` it exits 2 with the hint "Pipe the cookie in: `pbpaste | wm login`, or use `--from-file`."
- [ ] A successful login saves the session and prints `Logged in as <username>` (falls back to the user id, then to `unknown user`)
- [ ] Unparseable text exits 1 with `Could not read the cookie: <reason>`
- [ ] `wm collection` prints one line per row: id, rarity, count, flags (`*` starred, `T` pending trade), title, then a last line `<n> cards` (`<n> of <total> cards` when `total` is known)
- [ ] `--page N` lists only that page (with `stats=1`), `--rarity R` filters (case-insensitive), `--json` prints the rows as a JSON array with the API's field names
- [ ] Without a session file, every command except `login` exits 1 with `Not logged in. Run \`wm login\`.`
- [ ] An `ApiRefused` exits 1 with its `str()`; a 401 exits 1 with `Session expired. Run \`wm login\` again.`

**Verify:** `cd cli && uv run pytest tests/test_main.py -v` → all PASS

**Steps:**

- [ ] **Step 1: Write the failing tests**

`cli/tests/test_main.py`:

```python
import base64
import json

import httpx
import pytest
from typer.testing import CliRunner

from wikimasters import main
from wikimasters.auth import COOKIE_NAME, SessionStore
from wikimasters.client import Client
from wikimasters.main import app
from wikimasters.models import Session

from .conftest import make_session_dict

runner = CliRunner()


def cookie_text(data: dict) -> str:
    raw = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    return f"{COOKIE_NAME}=base64-{raw}"


@pytest.fixture(autouse=True)
def config_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("WM_CONFIG_DIR", str(tmp_path))
    return tmp_path


def fake_client(monkeypatch, handler) -> list[httpx.Request]:
    """Make main._client() return a Client on a fake network, and record requests."""
    calls: list[httpx.Request] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return handler(request)

    session = Session.model_validate(make_session_dict())
    monkeypatch.setattr(main, "_client", lambda: Client(session, transport=httpx.MockTransport(wrapped)))
    return calls


def test_login_from_stdin(config_dir):
    result = runner.invoke(app, ["login"], input=cookie_text(make_session_dict()))
    assert result.exit_code == 0, result.output
    assert "Logged in as tester" in result.output
    assert SessionStore().load().access_token == "access-1"


def test_login_from_file(tmp_path):
    path = tmp_path / "cookie.txt"
    path.write_text(cookie_text(make_session_dict()))
    result = runner.invoke(app, ["login", "--from-file", str(path)])
    assert result.exit_code == 0, result.output
    assert "Logged in as tester" in result.output


def test_login_bad_text():
    result = runner.invoke(app, ["login"], input="nothing useful")
    assert result.exit_code == 1
    assert "Could not read the cookie" in result.output


def test_commands_need_a_session():
    result = runner.invoke(app, ["collection"])
    assert result.exit_code == 1
    assert "Not logged in. Run `wm login`." in result.output


def test_collection_table(monkeypatch, page_json):
    fake_client(monkeypatch, lambda r: httpx.Response(200, json=page_json))
    result = runner.invoke(app, ["collection"])
    assert result.exit_code == 0, result.output
    lines = result.output.splitlines()
    assert any(line.startswith("uc-1") and "Alpha" in line and " R " in line for line in lines)
    assert any(line.startswith("uc-2") and "*" in line for line in lines)  # starred
    assert any(line.startswith("uc-3") and "T" in line for line in lines)  # pending trade
    assert lines[-1] == "3 of 3 cards"


def test_collection_page_and_rarity_filter(monkeypatch, page_json):
    calls = fake_client(monkeypatch, lambda r: httpx.Response(200, json=page_json))
    result = runner.invoke(app, ["collection", "--page", "4", "--rarity", "sr"])
    assert result.exit_code == 0, result.output
    assert dict(calls[0].url.params) == {"sort": "rarity", "page": "4", "stats": "1"}
    assert "Beta" in result.output and "Alpha" not in result.output


def test_collection_json(monkeypatch, page_json):
    fake_client(monkeypatch, lambda r: httpx.Response(200, json=page_json))
    result = runner.invoke(app, ["collection", "--json"])
    assert result.exit_code == 0, result.output
    rows = json.loads(result.output)
    assert [r["id"] for r in rows] == ["uc-1", "uc-2", "uc-3"]
    assert rows[0]["card"]["def"] == 12


def test_collection_expired_session(monkeypatch):
    fake_client(monkeypatch, lambda r: httpx.Response(401, json={"error": "Unauthorized"}))
    result = runner.invoke(app, ["collection"])
    assert result.exit_code == 1
    assert "Session expired. Run `wm login` again." in result.output
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd cli && uv run pytest tests/test_main.py -q`
Expected: failures, `main._client` and the commands do not exist.

- [ ] **Step 3: Write `cli/wikimasters/main.py`**

```python
"""The `wm` command line."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import httpx
import typer

from .auth import LoginRequired, SessionStore, ensure_fresh, parse_cookie_header
from .client import ApiRefused, Client
from .models import CollectionPage, UserCard

app = typer.Typer(help="WikiMasters from the terminal.", no_args_is_help=True)


@app.callback()
def _root() -> None:
    """WikiMasters from the terminal."""


def _fail(message: str, code: int = 1) -> None:
    typer.echo(message, err=True)
    raise typer.Exit(code)


def _client() -> Client:
    """A client on a fresh session. Tests replace this function."""
    try:
        session = ensure_fresh(SessionStore(), httpx.Client(timeout=30))
    except LoginRequired as err:
        _fail(str(err))
    return Client(session)


def _api_message(err: ApiRefused) -> str:
    if err.status == 401:
        return "Session expired. Run `wm login` again."
    return str(err)


@app.command()
def login(
    from_file: Path | None = typer.Option(None, "--from-file", help="Read the Cookie header from this file."),
) -> None:
    """Store the browser session from a pasted Cookie header (or a copied curl command)."""
    if from_file is not None:
        text = from_file.read_text()
    elif sys.stdin.isatty():
        _fail("Pipe the cookie in: `pbpaste | wm login`, or use `--from-file`.", 2)
    else:
        text = sys.stdin.read()
    try:
        session = parse_cookie_header(text)
    except (LoginRequired, ValueError) as err:
        _fail(f"Could not read the cookie: {err}")
    SessionStore().save(session)
    user = session.user
    who = (user.username or user.id) if user else "unknown user"
    typer.echo(f"Logged in as {who}")


def _print_rows(rows: list[UserCard], pending: set[str], total: int | None) -> None:
    for row in rows:
        flags = ("*" if row.starred else " ") + ("T" if row.id in pending else " ")
        typer.echo(f"{row.id:36}  {row.card.rarity:3}  {row.count:>3}  {flags}  {row.card.wikipedia_title}")
    if total is not None:
        typer.echo(f"{len(rows)} of {total} cards")
    else:
        typer.echo(f"{len(rows)} cards")


@app.command()
def collection(
    page: int | None = typer.Option(None, "--page", help="One page only (0-based)."),
    rarity: str | None = typer.Option(None, "--rarity", help="Keep only this rarity: C, PC, R, SR, UR, L."),
    as_json: bool = typer.Option(False, "--json", help="Print the rows as JSON."),
) -> None:
    """List your collection."""
    client = _client()
    try:
        data = client.collection_page(page, stats=True) if page is not None else client.all_collection()
    except ApiRefused as err:
        _fail(_api_message(err))
    rows = data.collection
    if rarity:
        rows = [row for row in rows if str(row.card.rarity).upper() == rarity.upper()]
    if as_json:
        typer.echo(json.dumps([row.model_dump(by_alias=True, mode="json") for row in rows], ensure_ascii=False, indent=2))
        return
    _print_rows(rows, set(data.pending_trade_card_ids), data.total)
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd cli && uv run pytest tests/test_main.py -v`
Expected: 8 PASS.

- [ ] **Step 5: Run the full suite and the real command help**

Run: `cd cli && uv run pytest -q && uv run wm collection --help`
Expected: all tests pass; the help text lists `--page`, `--rarity`, `--json`.

- [ ] **Step 6: Commit**

```bash
git add cli/wikimasters/main.py cli/tests/test_main.py
git commit -m "feat(cli): login from a pasted cookie and list the collection"
```

---

### Task 6: `wm discard`

**Goal:** Discard one or more cards by id, with the extension's protection rules and a confirmation.

**Files:**
- Modify: `cli/wikimasters/main.py`
- Test: `cli/tests/test_main.py`

**Acceptance Criteria:**
- [ ] `wm discard ID [ID...]` loads the full collection first, then refuses (exit 1, no POST sent) when any id is not in the collection, is starred, or is in a pending trade; it prints one reason line per bad id
- [ ] Duplicate ids are collapsed, first occurrence wins
- [ ] It prints one line per card (`<rarity>  <title>`) and asks `Discard N card(s)? [y/N]`; a "no" exits 1 with `Aborted.` and sends no POST; `--yes` / `-y` skips the question
- [ ] Discards run one at a time in the given order; each success prints `ok <title>`; the first failure prints `failed <title>: HTTP <status>: <message>` and stops with exit 1

**Verify:** `cd cli && uv run pytest tests/test_main.py -v` → all PASS

**Steps:**

- [ ] **Step 1: Add the failing tests to `cli/tests/test_main.py`**

```python
def collection_then_discard(page_json, discard_status: int = 200):
    """A fake site: GET pages return the fixture, POST discards answer discard_status."""

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            if discard_status == 200:
                return httpx.Response(200, json={"ok": True})
            return httpx.Response(discard_status, json={"error": "Vous ne possédez plus cette carte"})
        return httpx.Response(200, json=page_json)

    return handler


def posted_ids(calls: list[httpx.Request]) -> list[str]:
    return [c.url.path.split("/")[3] for c in calls if c.method == "POST"]


def test_discard_refuses_starred_pending_and_unknown(monkeypatch, page_json):
    calls = fake_client(monkeypatch, collection_then_discard(page_json))
    result = runner.invoke(app, ["discard", "uc-2", "uc-3", "uc-9", "--yes"])
    assert result.exit_code == 1
    assert "uc-2: starred (Beta)" in result.output
    assert "uc-3: in a pending trade (Gamma)" in result.output
    assert "uc-9: not in your collection" in result.output
    assert posted_ids(calls) == []


def test_discard_asks_and_aborts_on_no(monkeypatch, page_json):
    calls = fake_client(monkeypatch, collection_then_discard(page_json))
    result = runner.invoke(app, ["discard", "uc-1"], input="n\n")
    assert result.exit_code == 1
    assert "Discard 1 card(s)?" in result.output
    assert "Aborted." in result.output
    assert posted_ids(calls) == []


def test_discard_with_yes_posts_each_id_once(monkeypatch, page_json):
    calls = fake_client(monkeypatch, collection_then_discard(page_json))
    result = runner.invoke(app, ["discard", "uc-1", "uc-1", "-y"])
    assert result.exit_code == 0, result.output
    assert "ok Alpha" in result.output
    assert posted_ids(calls) == ["uc-1"]


def test_discard_stops_at_first_failure(monkeypatch, page_json):
    page_json["collection"][1]["starred"] = False
    page_json["pendingTradeCardIds"] = []
    calls = fake_client(monkeypatch, collection_then_discard(page_json, discard_status=409))
    result = runner.invoke(app, ["discard", "uc-1", "uc-2", "uc-3", "-y"])
    assert result.exit_code == 1
    assert "failed Alpha: HTTP 409: Vous ne possédez plus cette carte" in result.output
    assert posted_ids(calls) == ["uc-1"]
```

- [ ] **Step 2: Run the tests to see them fail**

Run: `cd cli && uv run pytest tests/test_main.py -q`
Expected: the four new tests fail, `discard` is not a command.

- [ ] **Step 3: Add the command to `cli/wikimasters/main.py`**

Append at the end of the file:

```python
@app.command()
def discard(
    ids: list[str] = typer.Argument(..., help="User-card ids (the first column of `wm collection`)."),
    yes: bool = typer.Option(False, "--yes", "-y", help="Do not ask for confirmation."),
) -> None:
    """Discard cards by id. Starred cards and cards in a pending trade are refused."""
    client = _client()
    try:
        data = client.all_collection()
    except ApiRefused as err:
        _fail(_api_message(err))
    wanted = list(dict.fromkeys(ids))
    by_id = {row.id: row for row in data.collection}
    pending = set(data.pending_trade_card_ids)
    problems = []
    for card_id in wanted:
        row = by_id.get(card_id)
        if row is None:
            problems.append(f"{card_id}: not in your collection")
        elif row.starred:
            problems.append(f"{card_id}: starred ({row.card.wikipedia_title})")
        elif card_id in pending:
            problems.append(f"{card_id}: in a pending trade ({row.card.wikipedia_title})")
    if problems:
        for line in problems:
            typer.echo(line, err=True)
        raise typer.Exit(1)
    for card_id in wanted:
        row = by_id[card_id]
        typer.echo(f"{row.card.rarity:3}  {row.card.wikipedia_title}")
    if not yes and not typer.confirm(f"Discard {len(wanted)} card(s)?"):
        _fail("Aborted.")
    for card_id in wanted:
        title = by_id[card_id].card.wikipedia_title
        try:
            client.discard(card_id)
        except ApiRefused as err:
            _fail(f"failed {title}: {_api_message(err)}")
        typer.echo(f"ok {title}")
```

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd cli && uv run pytest tests/test_main.py -v`
Expected: 12 PASS.

- [ ] **Step 5: Run the whole suite**

Run: `cd cli && uv run pytest -q`
Expected: all PASS, no warnings about the network.

- [ ] **Step 6: Commit**

```bash
git add cli/wikimasters/main.py cli/tests/test_main.py
git commit -m "feat(cli): discard cards with the extension's protection rules"
```

---

### Task 7: README section

**Goal:** Tell a reader how to install and use the CLI.

**Files:**
- Modify: `README.md` (add a section before `## Roadmap`)

**Acceptance Criteria:**
- [ ] The section explains the install (`cd cli && uv sync`), the login (`pbpaste | uv run wm login` after copying the request as cURL from DevTools), and the three commands
- [ ] It states that the session file lives at `~/.config/wikimasters/session.json`, that the CLI refreshes it, and that Chrome may ask for one new login after the first refresh
- [ ] No em dash in the new text; no personal data

**Verify:** `grep -c "wm login" README.md` → at least 1; the em dash count of README.md is unchanged: `python3 -c "print(open('README.md').read().count(chr(8212)))"`

**Steps:**

- [ ] **Step 1: Add the section to `README.md`, right before `<!-- ROADMAP -->`**

````markdown
<!-- CLI -->
## Python CLI

The same two endpoints, from the terminal. Lives in `cli/`, needs Python 3.12+
and [uv](https://docs.astral.sh/uv/).

```sh
cd cli && uv sync
```

**Log in once.** The site knows you by a session cookie. Copy it from Chrome:
open your collection page, press Cmd+Option+I, open the Network tab, right-click
the `my-collection` request, choose "Copy as cURL", then:

```sh
pbpaste | uv run wm login
```

The CLI keeps the session in `~/.config/wikimasters/session.json` (mode 600)
and refreshes it on its own. After the first refresh, Chrome may ask you to log
in again once; after that the two sessions live apart.

**Commands**

```sh
uv run wm collection                 # every card: id, rarity, count, flags, title
uv run wm collection --rarity SR     # one rarity
uv run wm collection --json          # raw rows
uv run wm discard <id> [<id>...]     # asks first; -y skips the question
```

Flags in the list: `*` starred, `T` in a pending trade. `discard` refuses both,
and any id not in your collection, before it sends anything.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

````

- [ ] **Step 2: Verify**

Run: `grep -c "wm login" README.md; python3 -c "print(open('README.md').read().count(chr(8212)))"`
Expected: first count at least 1; second count equal to what it was before the edit.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs(readme): python cli install and usage"
```
