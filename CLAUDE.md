# WikiMasters CLI

This repo will be published as open source.

- Never commit personal data: no account or user ids (not even partial), no
  email addresses, no cookies, auth tokens, or copied request headers. Use
  placeholders such as `<user-uuid>` in docs and fixtures.
- Test fixtures use invented data (`uc-1`, `https://img.test/1.png`), never
  data captured from a live account.

Commands: `uv sync`, `uv run pytest -q` (tests), `uv run wm --help`.

## Publishing

- Public repo: https://github.com/gautierlp/wikimasters-cli
  (first published 2026-09-28 as `wikimasters-multi-discard`, a Chrome
  extension, with a fresh, single-commit history; renamed 2026-09-30 when the
  extension was dropped for the CLI).
- The local branch `private-history` holds the pre-publication history. It
  contains partial account ids and the owner's personal email. Never push it:
  no `git push --all`, no `git push origin private-history`.
- Commits use the GitHub noreply address
  `241731735+gautierlp@users.noreply.github.com` (set in the repo's local git
  config). Check `git log --format=%ae origin/main..main` before a push.
