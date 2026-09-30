# CLI-only repo

## Goal

The repo becomes the WikiMasters command-line tool and nothing else. The
Chrome extension is deleted. The Python CLI moves from `cli/` to the repo root.
The GitHub repo is renamed from `wikimasters-multi-discard` to
`wikimasters-cli`. No behavior of the CLI changes.

## Out of scope

- New CLI commands. Other game actions need their API calls found first; each
  one gets its own spec later.
- Renaming the local checkout folder or the Superset project. GitHub redirects
  the old URL, so the local remote keeps working; it is updated anyway.

## Changes

1. Delete the extension and its JavaScript setup: `extension/`, `tests/*.js`,
   `package.json`, `package-lock.json`.
2. Delete the docs that only describe the extension:
   - `docs/superpowers/specs/2026-09-28-multi-discard-extension-design.md`
   - `docs/superpowers/specs/2026-09-28-per-page-loading-design.md`
   - `docs/superpowers/specs/2026-09-28-select-all-design.md`
   - the three matching plans in `docs/superpowers/plans/` and their
     `.tasks.json` files.
   Git history keeps them. `docs/assets/icon.svg` stays if the README still
   uses it, and is deleted otherwise.
3. Move the CLI to the root with `git mv` so history follows the files:
   `cli/wikimasters/` to `wikimasters/`, `cli/tests/` to `tests/`,
   `cli/pyproject.toml` and `cli/uv.lock` to the root. Python code is
   unchanged.
4. `.gitignore`: drop `node_modules/` and `extension/dist/`.
5. README: rewrite around the CLI only. Sections: what it is, disclaimer,
   install (`uv sync`), login, commands, how it works (the two endpoints, the
   retries, the starred and pending-trade refusals), license. Links point to
   `wikimasters-cli`. The extension, its build, and its roadmap go.
6. `CLAUDE.md`: commands become `uv run pytest -q`; the npm commands go; the
   public repo URL becomes `https://github.com/gautierlp/wikimasters-cli`.
   The rules on personal data, `private-history`, and the noreply address stay.
7. `docs/superpowers/specs/2026-09-30-python-cli-design.md`: paths change from
   `cli/...` to the root, and mentions of the extension as a sibling project
   become past tense or go.
8. After the merge to `main` and the push: rename the GitHub repo with
   `gh repo rename wikimasters-cli`, then set the local `origin` URL to the new
   name.

## Verification

- `uv run pytest -q` at the repo root: 62 tests pass.
- `uv run wm --help` at the repo root lists `login`, `collection`, `discard`.
- `git ls-files` shows no `extension/`, no `.js` file, no `package*.json`,
  no `cli/`.
- `grep -rn "multi-discard\|extension" README.md CLAUDE.md` finds nothing
  except, in `CLAUDE.md`, the history note about the first publication.
