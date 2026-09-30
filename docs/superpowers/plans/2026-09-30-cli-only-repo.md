# CLI-only Repo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the repo into the WikiMasters CLI only: delete the Chrome extension, move `cli/` to the root, rewrite the docs, rename the GitHub repo to `wikimasters-cli`.

**Architecture:** File moves with `git mv` (history follows the files), deletions with `git rm`, doc rewrites. No Python code changes.

**Tech Stack:** Python 3.12+, uv, pytest, Typer, httpx; git; `gh`.

**Global Constraints:** Spec `docs/superpowers/specs/2026-09-30-cli-only-repo-design.md`. No personal data in any file (no account ids, emails, cookies). Commits use the noreply address set in the repo config. Never push `private-history`.

**User decisions (already made):**
- "A": same features, clean repo; no new commands.
- Delete the Chrome extension ("useless, you can delete it").
- GitHub repo name: `wikimasters-cli`.
- Merge and push when done.

---

### Task 1: Delete the extension and move the CLI to the root

**Goal:** The tree holds only the Python CLI, at the root.

**Files:**
- Delete: `extension/`, `tests/*.js`, `package.json`, `package-lock.json`
- Delete: `docs/superpowers/specs/2026-09-28-{multi-discard-extension,per-page-loading,select-all}-design.md`, `docs/superpowers/plans/2026-09-28-{multi-discard-extension,per-page-loading,select-all}.md` and their `.tasks.json`
- Move: `cli/wikimasters/` to `wikimasters/`, `cli/tests/` to `tests/`, `cli/pyproject.toml`, `cli/uv.lock` to the root
- Modify: `.gitignore`

**Acceptance Criteria:**
- [ ] `git ls-files | grep -E '^(extension|cli)/|\.js$|package'` prints nothing
- [ ] `uv run pytest -q` at the root: 62 passed
- [ ] `uv run wm --help` lists `login`, `collection`, `discard`

**Verify:** `uv run pytest -q` → `62 passed`

**Steps:**

- [ ] **Step 1: Delete the extension files**

```bash
git rm -rq extension tests package.json package-lock.json
git rm -q docs/superpowers/specs/2026-09-28-*-design.md docs/superpowers/plans/2026-09-28-*
```

- [ ] **Step 2: Move the CLI**

```bash
git mv cli/wikimasters wikimasters
git mv cli/tests tests
git mv cli/pyproject.toml pyproject.toml
git mv cli/uv.lock uv.lock
rm -rf cli   # only untracked leftovers (.venv, caches) remain
```

- [ ] **Step 3: `.gitignore`**: delete the lines `node_modules/` and `extension/dist/`.

- [ ] **Step 4: Run the checks**

```bash
uv sync && uv run pytest -q && uv run wm --help
git ls-files | grep -E '^(extension|cli)/|\.js$|package'   # expect no output
```

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: drop the chrome extension, move the cli to the root"
```

### Task 2: Rewrite the docs for the CLI

**Goal:** README, CLAUDE.md, and the CLI spec describe the CLI-only repo.

**Files:**
- Modify: `README.md` (full rewrite), `CLAUDE.md`, `docs/superpowers/specs/2026-09-30-python-cli-design.md`
- Delete: `docs/assets/icon.svg` if the new README does not use it

**Acceptance Criteria:**
- [ ] README sections: what it is, disclaimer, install, login, commands, how it works, license; links use `gautierlp/wikimasters-cli`
- [ ] `CLAUDE.md` commands are `uv run pytest -q`; no `npm`; repo URL is `https://github.com/gautierlp/wikimasters-cli`; the personal-data, `private-history` and noreply rules are unchanged
- [ ] No `cli/` path left in the CLI spec
- [ ] `grep -n "npm\|esbuild\|multi-discard" README.md CLAUDE.md` finds only the first-publication history note in `CLAUDE.md`

**Verify:** `grep -rn "cli/\|npm\|esbuild" README.md CLAUDE.md docs/superpowers/specs/2026-09-30-python-cli-design.md` → no output

**Steps:**

- [ ] **Step 1:** Rewrite `README.md` from the current "Python CLI", "Disclaimer" and "How It Works" sections, dropping the extension parts. Commands block:

```sh
uv sync
pbpaste | uv run wm login
uv run wm collection
uv run wm collection --rarity SR
uv run wm collection --json
uv run wm discard <id> [<id>...]
```

- [ ] **Step 2:** Update `CLAUDE.md` (title "WikiMasters CLI", commands, repo URL).
- [ ] **Step 3:** In the CLI spec, change `cli/...` paths to root paths.
- [ ] **Step 4:** Run the Verify grep, then `uv run pytest -q` (62 passed).
- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "docs: describe the repo as the wikimasters cli"
```

### Task 3: Merge, push, rename the GitHub repo

**Goal:** `main` on GitHub holds the CLI-only repo, under the name `wikimasters-cli`.

**Files:** none (git and GitHub only)

**Acceptance Criteria:**
- [ ] `git log --format=%ae origin/main..main` shows only the noreply address before the push
- [ ] `gh repo view gautierlp/wikimasters-cli --json name` returns `wikimasters-cli`
- [ ] `git remote get-url origin` ends with `wikimasters-cli.git`

**Verify:** `git fetch origin && git status -sb` → `main...origin/main` with no ahead/behind

**Steps:**

- [ ] **Step 1:** In the main checkout: `git merge --ff-only <branch>`, check the emails, `git push origin main`.
- [ ] **Step 2:** `gh repo rename wikimasters-cli --repo gautierlp/wikimasters-multi-discard --yes`
- [ ] **Step 3:** `git remote set-url origin git@github.com:gautierlp/wikimasters-cli.git`, then `git fetch origin`.
