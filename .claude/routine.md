# Project routine config — toDoList_TOP

Working directory: `toDoList_main/`
Install command: `npm install`
Test command: `npm run test:run`

All preflight and test-verification commands run from `toDoList_main/`. The test suite lives in `toDoList_main/tests/`.

## Bookkeeping — changelog.js

Every code change with a user-visible effect must be reflected in `toDoList_main/src/changelog.js`. This update is part of the same commit as the code change — the changelog and the code ship together so they can never drift.

The file exports a `changelog` array, newest-first. Each entry is `{ version, date, added?, fixed?, changed? }` where `date` is ISO `YYYY-MM-DD`.

### How to add the bullet

First, compute today's date in `America/Los_Angeles` timezone, ISO `YYYY-MM-DD` format. (The routine runs daily at 6 PM PDT, so local date is the intuitive anchor.) Call this TODAY.

Then decide: **merge into the topmost entry, or prepend a new one?**

- If the topmost entry's `date` equals TODAY → **merge**. Append your new bullet to the appropriate category array on that entry (`added`, `fixed`, or `changed` — see category selection below). Create the category array if it doesn't exist yet on that entry. Do NOT modify the entry's `date` or `version`.
- Otherwise → **prepend** a new entry at the top of the array with:
  - `date: TODAY`
  - `version`: the SAME version string as the previous topmost entry. Never bump the version — version bumps are a human decision reserved for deliberate releases.
  - Exactly ONE of `added`, `fixed`, or `changed` populated as a single-element array containing your bullet. Omit the other two keys entirely.

This merge-on-same-day rule means two tasks run on the same PDT day produce ONE entry with two bullets, not two same-dated entries stacked on top of each other. The modal renders one heading per entry, so merging keeps the UI clean.

Category selection:
- Task's `Type:` line is `bug` → use `fixed`.
- Task's `Type:` line is `feature` → use `added` by default. If the task title or description makes clear the work is a modification to existing behavior rather than net-new functionality (verbs like "modify", "update", "change", "tweak", "adjust", "restyle", "rework"), use `changed` instead.

Bullet style:
- One sentence, user-facing, describing the outcome — not the implementation. Examples from the existing file to match tone: "Expand all / collapse all buttons for todo item descriptions.", "Due date field restored on mobile layouts below 420px.", "Drag-and-drop reordering now keeps completed items at the bottom."
- No references to PR numbers, branch names, function names, or file paths. The reader is an end-user of the app, not a code reviewer.
- Past or simple present tense. No first person. No "implemented", "added code to", "refactored". Describe what the user can now do or what now works differently.
- One bullet per task. If the task touches multiple user-visible surfaces, combine them into one sentence with a comma rather than emitting two bullets.

### How to prune older bullets (rolling 5-bullet cap)

After adding your bullet (whether via merge or prepend), enforce a cap of **5 total bullets across the entire `changelog` array**. Prune oldest-first until the total count is exactly 5 (or fewer, if the array naturally has fewer).

Pruning algorithm:
1. Count total bullets across every entry's `added`, `fixed`, and `changed` arrays combined.
2. If the count is ≤ 5, do nothing — you're done.
3. Otherwise, walk entries from oldest (bottom of array) to newest (top). Within each entry, bullets are considered in the order they appear across `added`, then `changed`, then `fixed`. Remove bullets one at a time from the oldest position until the total hits 5.
4. When removing the last bullet from a category array, also remove that category key from the entry (don't leave empty arrays).
5. When an entry has no bullets left in any category, remove the entire entry from the array.
6. The bullet you just added must never be pruned — the cap is always enforced against older bullets first. Whether you merged or prepended, the newly-added bullet stays.

Worked example 1 — MERGE path. State before this run:
```
[
  { version: '1.1', date: '2026-04-24', added: ['G'] },
  { version: '1.1', date: '2026-04-23',
    added: ['C'], fixed: ['D', 'E'], changed: ['F'] }
]
```
Total = 5 bullets. Another task runs later the same PDT day (2026-04-24) with a bug fix → bullet 'H' goes into `fixed` on the topmost entry (merge):
```
[
  { version: '1.1', date: '2026-04-24', added: ['G'], fixed: ['H'] },
  { version: '1.1', date: '2026-04-23',
    added: ['C'], fixed: ['D', 'E'], changed: ['F'] }
]
```
Total = 6 bullets. Cap is 5, so prune 1 from the oldest entry at the oldest position: remove 'C'. Final state:
```
[
  { version: '1.1', date: '2026-04-24', added: ['G'], fixed: ['H'] },
  { version: '1.1', date: '2026-04-23',
    fixed: ['D', 'E'], changed: ['F'] }
]
```

Worked example 2 — PREPEND path. State before this run:
```
[
  { version: '1.1', date: '2026-04-23',
    added: ['A', 'B', 'C'], fixed: ['D', 'E'], changed: ['F'] }
]
```
Total = 6 bullets. Today is 2026-04-24, so prepend a new entry with bullet 'G':
```
[
  { version: '1.1', date: '2026-04-24', added: ['G'] },
  { version: '1.1', date: '2026-04-23',
    added: ['A', 'B', 'C'], fixed: ['D', 'E'], changed: ['F'] }
]
```
Total = 7 bullets. Prune 2 from the oldest entry at the oldest position: remove 'A', then 'B'. Final state:
```
[
  { version: '1.1', date: '2026-04-24', added: ['G'] },
  { version: '1.1', date: '2026-04-23',
    added: ['C'], fixed: ['D', 'E'], changed: ['F'] }
]
```

### When to skip the changelog update

If the task has NO user-visible effect whatsoever (pure internal refactor, test-only change, build config tweak that produces identical output), skip the changelog update entirely — do not merge, do not prepend, do not prune. Note in the PR body: "No changelog entry — change has no user-visible effect." This escape hatch should rarely fire; when in doubt, add the entry.

## Project bookkeeping constraints

- Never bump the `version` string in changelog.js — always reuse the previous topmost entry's version. Version bumps are a human decision.
- Never create a second entry with the same PDT date as the existing topmost entry. When today's PDT date matches the topmost entry's date, merge the new bullet into that entry; only prepend when the PDT date is genuinely new.
- Never exceed 5 total bullets across the entire changelog array. Enforce the pruning algorithm above on every run where a new bullet is added.
