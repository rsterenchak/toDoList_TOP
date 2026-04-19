# Porting Guide

How to replicate this automation pipeline on a new repo.

## Prerequisites

- A GitHub repo you own (or can admin).
- A Claude account with access to Routines.
- GitHub CLI (`gh`) available locally if you want to test preflight commands by hand.

## What carries over, what doesn't

Portable across repos (copy with minimal changes):
- The PR Explainer workflow (`.github/workflows/claude-pr-explainer.yml`)
- The routine spec (paste into the new repo's hosted routine)
- The general structure of `TODO.md` (`## Bugs` and `## Features` sections)
- The general structure of `CLAUDE.md` (section headers, universal rules)

Not portable — must be written per-repo:
- The *contents* of `CLAUDE.md` — stack, file organization, conventions are codebase-specific
- The `paths:` filter in the workflow — matches the new repo's source folder and file extensions

## Steps

### 1. Decide if the repo warrants it

Not every repo does. The pipeline earns its keep when the project has a steady backlog, you'll work on it over weeks or months, and the work is mostly incremental (bugs and features) rather than large architectural rewrites. For one-week prototypes or single scripts, the setup overhead exceeds the payoff.

### 2. Seed the repo-side files

Create these at the repo root:

- `TODO.md` with `## Bugs` and `## Features` sections, each containing 2–3 real, well-scoped tasks. Not placeholders — actual work you want done, so the first run produces useful signal.
- `CLAUDE.md` written fresh for this codebase. See "Writing CLAUDE.md" below.

### 3. Copy and tune the PR Explainer workflow

Copy `.github/workflows/claude-pr-explainer.yml` from an existing repo. Update exactly one thing: the `paths:` filter, to match the new repo's source folder and file types.

Examples:
- Python repo: `src/**/*.py`
- TypeScript repo: `src/**/*.ts`, `src/**/*.tsx`
- Go repo: `**/*.go`

Everything else in the workflow (permissions, checkout step, prompt) stays identical.

### 4. Add the OAuth secret

GitHub → repo Settings → Secrets and variables → Actions → New repository secret. Name: `CLAUDE_CODE_OAUTH_TOKEN`. Value: same token as other repos using the pipeline (one token, reused).

### 5. Enable branch protection

GitHub → repo Settings → Rules → Rulesets → New branch ruleset. Configure:

- Name: "Protect main" or similar
- Enforcement status: Active
- Target branches: Include default branch
- Require a pull request before merging: checked, with 0 required approvals (solo dev can't approve own PRs)
- Block force pushes: checked
- Restrict deletions: checked

Everything else off unless you have a specific reason.

### 6. Create the scheduled routine

In claude.ai → Routines → New routine:

- Name: Descriptive ("Automated Task Runner - <ProjectName>")
- Repositories: Add the new repo
- Schedule: Once daily is a good starting cadence. Adjust based on how fast you actually merge.
- Instructions: Paste the contents of `docs/routine-spec.md` from an existing repo verbatim. It's nearly identical across repos; the variations are in CLAUDE.md and TODO.md, not the spec.

Start the routine as Active.

### 7. Trigger a test run

Hit "Run now" in the routine UI. Watch what happens:

- Did it find TODO.md? If not, check the file is at the repo root and committed.
- Did it pick an expected task? If it picked the wrong one, priority ordering or vagueness logic explains it.
- Did the PR land cleanly? If not, check the routine's log for the exit reason.
- Did the PR Explainer comment? If not, check the `paths:` filter matches files the PR actually modified.

First runs usually reveal one or two issues with CLAUDE.md or the workflow config. Fix and re-run.

## Writing CLAUDE.md for a new repo

The single most important step, and the one least reusable. Structure it with these sections in order:

1. **Project overview.** Two or three sentences. What does this thing do, who uses it, what's the shape.
2. **Stack and constraints.** Language, framework, package manager, build tool. Any "do not introduce X" rules that matter.
3. **Repo layout.** Top-level folders and what they contain. Explicitly list folders that must never be edited directly (build output, vendored code).
4. **Source file organization.** Walk through each main source file and write one line describing what it owns. If the codebase has organic structure that's hard to summarize, that's a sign you need to impose clearer boundaries before automating — or skip this section and accept that the routine will guess.
5. **Conventions that matter.** Data persistence patterns, API conventions, styling approach, test patterns, error-handling patterns. Anything you've said "we do it this way" more than twice.
6. **Scope discipline.** Mostly copy from another repo — "don't refactor unrelated things," "don't touch build config unless asked." Universal rules.
7. **What not to flag in review.** Also mostly copy-pasteable.

Rules must be **concrete and verifiable against a diff**. "Write clean code" is unenforceable; "All data mutations go through `<specific file>`" is enforceable. If you can't imagine a reviewer checking a diff against a rule, rephrase it.

## Tips for the second and third repo

**Keep a personal CLAUDE.md template.** Not the full file — just your preferred section headers and the universal rules. New repo → paste template → fill in the repo-specific sections.

**Reuse phrasing across repos.** "Destructive actions require confirmation." "Do not commit files in build output directories." "Modals close on backdrop, Escape, and explicit close button." Good rules are often portable. Keep a running list of well-phrased rules.

**Keep the workflow file identical except for the `paths:` filter.** Any other drift between copies creates inconsistency that'll bite you during debugging.

## Traps to avoid

**Don't copy CLAUDE.md between repos wholesale.** Rules that applied to one app ("no new dependencies") might be actively wrong for another where adding libraries is expected. Blind copy produces a rulebook that doesn't match reality, and both the implementer and reviewer make worse decisions than with no rules at all.

**Don't scale the pattern before it works on one repo.** If the pipeline isn't reliably producing mergeable PRs on the first repo, adding a second multiplies the problem. Fix the first pipeline until it's genuinely good, then port.

**Don't run multiple routines against the same repo.** They'll race on TODO.md, both try to open PRs, both hit the compounding guard in different ways. One routine per repo.

**Don't let staleness accumulate.** If you update the routine spec in one repo's hosted routine, the others get stale. For two repos it's manageable; for four or more, keep the spec in a central place (a gist, a template repo) and copy updates out rather than editing each in place.

## Checklist

When porting to a new repo, verify:

- [ ] `TODO.md` at repo root with `## Bugs` and `## Features` sections
- [ ] `CLAUDE.md` at repo root, written for this codebase
- [ ] `.github/workflows/claude-pr-explainer.yml` present, `paths:` filter updated
- [ ] `CLAUDE_CODE_OAUTH_TOKEN` secret added in GitHub Settings
- [ ] Branch protection ruleset active on default branch
- [ ] Hosted routine created, Instructions field populated, routine Active
- [ ] One test run completed successfully, with a PR opened and explained