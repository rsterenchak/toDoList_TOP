# TODO List

## Bugs
     
- [x] **[HIGH]** Empty project name corrupts todo rendering and hides input field
  - Description: Reproduction: create a new project, add at least one todo, edit the project title to an empty string and confirm, click into a different project, then click back into the now-unnamed project. The todo items don't render, and after renaming the project to something non-empty the items still don't populate and the "New item" input/placeholder is gone too — the project looks empty and uneditable even though the data presumably still exists in storage. Likely root cause is that the empty title is being used as a lookup key (or persisted as the project's identifier) and either collides with another empty-key entry, fails an equality check on re-selection, or causes the todo-render path to short-circuit. Two things to fix: (1) prevent empty project names from being committed in the first place — on blur/Enter with empty input, either revert to the previous title or fall back to a default like "Untitled" (matches the new commit-on-blur behavior added for the projChild creation flow), and (2) make sure project lookup/rendering keys off a stable id rather than the display name so renaming never breaks the linkage. Verify storage isn't leaking orphaned entries after this sequence.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-04-26 (PR #<number>)
     
- [x] **[LOW]** Add light-mode variant for PWA iOS home-screen icon
  - Description: Add a light-purple variant of `apple-touch-icon.png` so iOS users on light-mode home screens see a tonal match instead of the current dark-tuned purple. Keep the existing PNG as the default (and dark-mode) icon — it already matches the favicon's standard purple. Export a lighter-purple companion (lifted from the `#8b7bff` accent toward something like `#b8a8ff`; pin the exact shade during export) and save as `assets/apple-touch-icon-light.png`, then add a second `<link rel="apple-touch-icon" sizes="180x180" media="(prefers-color-scheme: light)" href="assets/apple-touch-icon-light.png">` after the existing one in `template.html`. iOS 18+ honors the media query to swap icons on theme toggle; older iOS falls back to the unconditional default. No `webpack.config.js` change needed — the existing asset pipeline picks up the new PNG via the same path.
  - File: `toDoList_main/src/template.html`
  - Completed: 2026-04-26 (PR #<number>)

## Features

- [x] **[MEDIUM]** Add toggle for visual truncation of long todo titles
  - Description: Long todo titles currently overflow or wrap awkwardly inside their row. Add a display-only truncation that trims the rendered title to a single line with a trailing ellipsis (CSS `text-overflow: ellipsis` with `white-space: nowrap` and `overflow: hidden` on the title container is the cleanest path); the full title is preserved in the underlying data and revealed on hover (native `title` attribute tooltip) and inside the edit modal. Add a small icon button in the TODO ITEMS header row, immediately to the left of the existing "Expand all" control, using a stacked-lines glyph (three horizontal lines, each shorter than the last) and a "Compact titles" tooltip on hover. Toggle has two visual states: outline (off) and filled background using the existing accent color (on). Persist the on/off state in `localStorage` alongside the existing theme preference so it survives reloads — the preference is global, not per-project. No changes to stored todo data, no new dependencies.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/listLogic.js`
  - Completed: 2026-04-26 (PR #<number>)

- [x] **[LOW]** Add periodic blinking animation to ghost companion sprite
  - Description: Extend the ghost companion in `companion.js` so it blinks on its own at irregular intervals while idle (in addition to whatever animations it already does). Pick a randomized cadence — roughly every 3–6 seconds with a short ~120ms closed-eye frame — so the blink reads as natural rather than metronomic. Reuse whatever frame-swap or sprite-state mechanism the existing animations use; don't introduce a new animation system. Make sure the blink timer pauses or resets when the ghost is in another animated state (e.g. reacting, moving) so blinks don't visibly clip mid-action.
  - File: `toDoList_main/src/companion.js`
  - Completed: 2026-04-26 (PR #<number>)

- [x] **[LOW]** Replace dark-mode toggle with sun/moon icon button
  - Description: Swap the current dark-mode toggle for a 36×36 icon button placed immediately to the right of the ghost toggle. The button shows a moon glyph in light mode and a sun glyph in dark mode (icon represents the target mode, per convention), with a short fade/rotate (~150ms) on the swap to match existing app transitions. Use inline SVG for both glyphs — no new icon-library dependency — and update `style.css` for the button frame (transparent fill, subtle border, hover state). Existing theme-toggle wiring lives in `main.js`; grep with `offset`/`limit` rather than loading the whole file since it's over 25k tokens.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-04-25 (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
