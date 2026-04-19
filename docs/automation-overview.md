# Automation Overview

How the Claude automation pipeline works in this repo, end-to-end.

## The four moving parts

1. **`CLAUDE.md`** (repo root) — ambient context about this codebase: stack, file organization, conventions, scope rules. Loaded automatically every time Claude operates on the repo.
2. **`TODO.md`** (repo root) — the task queue. Bugs and features are filed as GitHub-style checkboxes under `## Bugs` and `## Features`. The scheduled routine picks one task per run.
3. **Scheduled routine** (Anthropic-hosted, not in this repo) — named "Automated Task Runner - Bugs & Features" in Claude's routines UI. Runs daily at 6:00 PM PDT. Reads its instructions from the Instructions field in the hosted UI (mirrored in `docs/routine-spec.md` for reference).
4. **PR Explainer workflow** (`.github/workflows/claude-pr-explainer.yml`) — runs on every PR touching source files. Posts a single comment with a walkthrough of what the PR does and any bug concerns it spotted.

## The daily flow

```
6:00 PM PDT — Anthropic-hosted routine fires
   ↓ clones the repo, reads CLAUDE.md and TODO.md
   ↓ preflight checks (clean tree, up-to-date base, no open claude/* PRs)
   ↓ picks one task (bugs before features, HIGH > MEDIUM > LOW, file order tiebreaker)
   ↓ implements the change on a claude/<type>-<title> branch
   ↓ commits in [Claude] <type>: <message> format
   ↓ marks the task [x] in TODO.md in a separate commit
   ↓ pushes the branch and opens a PR against the default branch
       ↓
PR Explainer workflow triggers on the new PR
   ↓ reads the diff
   ↓ posts a single comment with "What this PR does" and "Potential bugs or concerns"
       ↓
Human review
   ↓ read the explainer comment
   ↓ verify behavior in the app if needed
   ↓ merge
```

## Where each piece lives

| Component | Location | Edited via |
|---|---|---|
| Ambient context | `CLAUDE.md` at repo root | Direct edit, commit, push |
| Task queue | `TODO.md` at repo root | Direct edit, commit, push |
| Routine instructions | Anthropic's hosted UI (claude.ai → Routines) | Web UI Instructions field |
| Routine schedule | Anthropic's hosted UI | Web UI Repeats field |
| PR Explainer workflow | `.github/workflows/claude-pr-explainer.yml` | Direct edit, commit, push |
| Branch protection | GitHub Settings → Rules → Rulesets | GitHub web UI |

The routine is the only piece that doesn't live in the repo. Everything else is version-controlled.

## Compounding-PR prevention

The routine's preflight checks for any open PR whose head branch starts with `claude/`. If one exists, the routine exits without doing anything. This prevents the failure mode where each day's run stacks a new PR on top of unreviewed work from prior runs.

Consequence: if a Claude PR sits unreviewed for multiple days, the routine will skip every run until it merges or is closed. If throughput feels slow, the answer is merging faster, not running the routine more often.

## Scope enforcement

Two independent mechanisms keep changes scoped:

- **The routine spec** forbids refactoring unrelated code and requires unrelated issues to be filed as new TODO.md entries rather than fixed inline.
- **`CLAUDE.md`** repeats the same rule in the repo-side context, so it's enforced regardless of which Claude instance operates on the codebase.

If a PR drifts outside its task, both the spec and CLAUDE.md are candidates for tightening.

## Troubleshooting

**The routine ran but no PR appeared.**
Most likely one of: TODO.md had no actionable tasks, all actionable tasks were too vague, or an open `claude/*` PR already existed. Check the routine's run log in the Anthropic UI — it will show the exit reason.

**The routine opened a PR but the Explainer never commented.**
Check whether the PR touched files matching the workflow's `paths:` filter in `.github/workflows/claude-pr-explainer.yml`. TODO-only PRs are filtered out by design.

**A PR landed that broke something.**
Revert on the default branch via a new PR. Then either (a) tighten `CLAUDE.md` with a rule that would have prevented it, (b) file a more specific TODO.md entry describing the correct fix, or (c) both. Ad-hoc reverts without updating the rules let the same class of bug reappear.

**The routine made a change I didn't want.**
Check whether the TODO.md entry was ambiguous. Most bad output traces back to a vague task description rather than the routine misbehaving. Rewrite the entry more concretely before re-queueing.

**Something in CLAUDE.md is being ignored.**
CLAUDE.md rules need to be concrete and verifiable against a diff. "Write clean code" won't be enforced; "All data mutations go through `listLogic.js`" will. Rephrase the rule in observable terms.

## Updating the routine's instructions

The authoritative copy of the routine spec lives in the Anthropic-hosted UI, not in this repo. To update it:

1. Go to claude.ai → Routines → "Automated Task Runner - Bugs & Features".
2. Edit the Instructions field.
3. Save.
4. Update `docs/routine-spec.md` in the repo to match, so the reference copy doesn't drift.

Editing `docs/routine-spec.md` alone has no effect on behavior — it's a reference, not the live config.

## What's deliberately *not* automated

- **PR merging.** Always manual. The human review step is what keeps the pipeline honest about intent.
- **TODO.md authoring.** Tasks are written by hand. Writing clear tasks is the single highest-leverage thing in this pipeline; automating it would defeat the purpose.
- **CLAUDE.md maintenance.** Rules are added and pruned by hand as patterns emerge from PR review.