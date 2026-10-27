# Onboarding a repo into the pipeline

Moved out of the main README so it stays a runbook. The template this runs against is [`claude-routine-template`](https://github.com/rsterenchak/claude-routine-template); its own README covers the per-shape scaffolding in depth.

The routine reads a repo's `TODO.md`, opens a PR implementing each entry, and auto-merges it. `onboard.sh` (in the **`claude-routine-template`** repo) scaffolds a repo into it — it's shape-aware, and if your `gh` CLI is authenticated it also sets most of the GitHub settings for you. The rest is a handful of one-time credentials.

**Already-wired repo** — nothing to set up: open the PWA, switch the workspace picker to the repo, and inject an entry (or paste into `TODO.md` on `main`). The next run opens the PR and merges it.

### New repo — the fast path

**0. Preconditions.** onboard runs your *local* `onboard.sh` for detection and fetches the scaffold fresh from `claude-routine-template` **main**, so both have to be current:

```bash
grep -c 'SHAPE="sql"' onboard.sh   # local script up to date? want >= 1
curl -fsI https://raw.githubusercontent.com/rsterenchak/claude-routine-template/main/scripts/gen-src-manifest.js   # template pushed? want 200
```

**1. Scaffold.** Fill `NAME`/`SHAPE` and paste. The `( set -e … )` subshell stops at the first real error instead of cascading into misleading noise:

```bash
NAME=SQL_shape_test    # exact repo name
SHAPE=sql              # repo-only | console | desktop | maui | sql | web-build | web-served

( set -e
cd /workspaces

# clone if it exists, else create. NOTE: --clone is a BOOLEAN flag — no trailing
# dir arg (the trailing "$NAME" was the "accepts at most 1 arg(s)" bug).
if gh repo view "rsterenchak/$NAME" >/dev/null 2>&1; then
  [ -d "$NAME/.git" ] || gh repo clone "rsterenchak/$NAME"
else
  gh repo create "rsterenchak/$NAME" --private --clone
fi
[ -d "$NAME/.git" ] || { echo "!! $NAME dir not created — read the gh error above."; exit 1; }
cd "$NAME"

case "$SHAPE" in                       # seed a minimal fixture for the shape
  repo-only)  : ;;
  console)    dotnet new console ;;
  desktop)    dotnet new winforms ;;
  maui)       dotnet new maui ;;       # needs: dotnet workload install maui
  sql)        mkdir -p migrations; [ -e schema.sql ] || printf 'CREATE TABLE example (\n    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),\n    name TEXT NOT NULL\n);\n' > schema.sql ;;
  web-build)  printf '{"name":"web","scripts":{"build":"vite build","test":"vitest run --passWithNoTests"},"devDependencies":{"vite":"^5","vitest":"^2"}}' > package.json; echo 'export default {}' > vite.config.js; printf '<!doctype html><script type="module" src="/src/main.js"></script>' > index.html; mkdir -p src; echo 'console.log(1)' > src/main.js ;;
  web-served) printf '<!doctype html><h1>served</h1>' > index.html; mkdir -p src; echo 'console.log(1)' > src/app.js ;;
esac
[ -e README.md ] || echo "# $NAME ($SHAPE)" > README.md

git add -A && git commit -q -m fixture 2>/dev/null || true
git branch -M main
git push -u origin main                # 403 in a Codespace? see "Codespace push auth" below, then re-run

cd /workspaces/claude-routine-template && ./onboard.sh "../$NAME"
)
```

This clones or creates the repo, seeds a fixture for the shape, and runs onboard. If `gh` is authenticated, onboard also sets read-write workflow permissions, the Pages source, and offers to add your secrets — so steps 3–4 may already be done for you.

**2. Confirm the files reached `main`.** The one step that bites: onboard's own `git push` can 403 silently in a Codespace, leaving the scaffold local-only. Check what's actually on `main`:

```bash
gh api repos/rsterenchak/<repo>/contents --jq '.[].path'   # want manifest.yml, scripts/, claude-run.yml…
```

Only your original files? onboard's push didn't land — see **Troubleshooting → Codespace push auth**, then `git add -A && git commit -m scaffold && git push`.

**3. Grant access** (per repo, quick):
- Install the Claude GitHub app on the repo — https://github.com/apps/claude
- Add the repo to your worker PAT (**Contents: write, Actions: read + write**) — https://github.com/settings/personal-access-tokens

**4. Settings** — onboard's `gh` path sets these; do them by hand only if it didn't:
- **Actions → General → Workflow permissions:** "Read and write" *and* tick "Allow GitHub Actions to create and approve pull requests."
- **Pages → Deploy from a branch:** `web-build` → `gh-pages` / root; every other manifest shape (`web-served`, `console`, `desktop`, `maui`, `sql`, `doc`) → `main` / root; `repo-only` → skip.
- **Secrets:** `CLAUDE_CODE_OAUTH_TOKEN` (always); `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (the legacy service_role JWT) if the repo runs triage.

**5. Register with the worker.** In the PWA, open Inject settings → **+ Add target** and enter the repo and its `TODO.md` path. That writes an enabled row to the Supabase `inject_targets` registry, which the worker reads live on every request — no `wrangler deploy` needed. `srcPrefix` is `"src/"` for web, the project subfolder for .NET, and `""` for `sql` / `doc` / `repo-only`.

**6. Verify + smoke-test.**

```bash
curl -fsI https://rsterenchak.github.io/<repo>/src-manifest.json   # want 200 (every shape but repo-only)
```

Inject a trivial entry in the PWA — the PR should open and merge (`sql` / `doc` / `repo-only` auto-merge with no CI; the code shapes merge once tests pass).

### Shape reference

`onboard.sh` detects the shape and scaffolds the matching files; override at the prompt if it guesses wrong.

| Shape | Detected from | Publishes | Structure lens |
|---|---|---|---|
| `web-build` | bundler config + build script | Pages `gh-pages` (built output) | Code + UI |
| `web-served` | no build; root `index.html` / `src/` | Pages `main` | Code + UI |
| `console` | `.csproj` / `.sln`, cross-platform | Pages `main` (manifest only) | Code + Types |
| `desktop` | WinForms / WPF (`net*-windows`) | Pages `main` (manifest only) | Code + Types |
| `maui` | `UseMaui` or an `-android` TFM | Pages `main` (manifest only) | Code + Types |
| `sql` | `.sql` files, no `package.json` | Pages `main` (manifest only) | Code + SQL |
| `doc` | a `docs/` dir or ≥ 2 `.md` files, no code | Pages `main` (manifest only) | Code |
| `repo-only` | none of the above | — | — |

CI on push: `desktop` on Windows, `maui` builds the Android head, the other code shapes on ubuntu; `sql` / `doc` / `repo-only` have none.


---

## Troubleshooting

**Codespace push auth (the recurring 403).** A Codespace's pinned `GITHUB_TOKEN` is scoped to the repo it *launched* from, not your target — so `git push` (and onboard's internal push) 403 with `Permission … denied`. Fix it, then verify before pushing:

```bash
unset GITHUB_TOKEN && gh auth status   # "not logged in"? run: gh auth login  (GitHub.com → HTTPS → browser)
gh auth setup-git
git -C <repo> ls-remote origin >/dev/null && echo "AUTH OK"   # proves write access BEFORE you push
```

Make it stick across new terminals: `echo 'unset GITHUB_TOKEN' >> ~/.bashrc`. (Sibling: `git config --local --unset commit.gpgsign` if commits fail on GPG signing.)

**onboard wrote files but nothing's on `main`.** Its push is guarded with `2>/dev/null`, so a 403 is swallowed — the scaffold is local-only, and re-running skips it as "already exists" while pushing nothing (a no-op loop). Never trust onboard's exit; confirm with `gh api repos/<owner>/<repo>/contents`. A bare `git push` reporting *"Everything up-to-date"* means the files were never **committed** — stage them: `git add -A && git commit -m scaffold && git push`.

**Cascading `not a git repository` / `target is not a directory`.** A chained `cmd; cmd; cmd` line barrels past its first error, so you see downstream noise instead of the root cause (the repo dir was never created — read the line *above* the cascade). Run steps individually, or use the `( set -e … )` subshell, which halts at the real failure and says why.

**Manifest 404s.** `curl -fsI https://<owner>.github.io/<repo>/src-manifest.json` — read the 404 body: **~9KB of HTML with a GitHub CSP header** means Pages is serving but the manifest isn't committed yet (workflow hasn't run, or failed); **no HTML body** means Pages isn't enabled (step 4). Then check `gh run list --repo <owner>/<repo>` — a **red run** is almost always missing read-write permissions (the commit-back to `main` 403s); a **green run** just needs a minute for Pages to redeploy.

**PR opens but won't auto-merge.** The "Allow GitHub Actions to create and approve pull requests" toggle is off (step 4).

**Inject refused.** A 400 `Target not in allowlist` means the repo has no enabled `inject_targets` row — add one in Inject settings → **+ Add target** (step 5). A 401 `Sign-in required` or 403 `Admin only` means the caller isn't a signed-in admin — sign in to the PWA with an email listed in the worker's `ADMIN_EMAILS` secret. A GitHub 403 from the append itself means the worker PAT lacks access to the repo (step 3).

**OAuth token vs. PAT — two different credentials.** `CLAUDE_CODE_OAUTH_TOKEN` (step 4) authenticates Claude *inside* the run; the PAT access-list entry (step 3) lets the worker *reach* the repo. Setting one does not cover the other.

**Routine or config changes go straight to `main`** — don't route them through the pipeline. It ships backlog entries, not its own scaffolding.

---
