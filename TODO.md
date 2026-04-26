# TODO List

## Bugs
     
- [x] **[MEDIUM]** Fix due-date pill bottom border being clipped inside todo row
  - Description: The due-date pill (calendar icon + "MAY 1" + chevron) inside each todo row is missing its bottom border — the top, left, and right borders render but the bottom edge is cut off flush with the row. Expected behavior is a fully enclosed rounded rectangle around the pill matching its top border. Likely cause is the pill's effective height (border + padding + line-height) being slightly taller than the todo row's content box, combined with `overflow: hidden` (or a too-tight `height`/`max-height`) on the row container clipping the bottom edge. Investigate the todo row's height and overflow rules and the pill's vertical padding/line-height in `style.css` — either give the row enough room or remove the overflow clip on that axis.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-04-24 (PR #<number>)

## Features

- [ ] **[LOW]** Add periodic blinking animation to ghost companion sprite
  - Description: Extend the ghost companion in `companion.js` so it blinks on its own at irregular intervals while idle (in addition to whatever animations it already does). Pick a randomized cadence — roughly every 3–6 seconds with a short ~120ms closed-eye frame — so the blink reads as natural rather than metronomic. Reuse whatever frame-swap or sprite-state mechanism the existing animations use; don't introduce a new animation system. Make sure the blink timer pauses or resets when the ghost is in another animated state (e.g. reacting, moving) so blinks don't visibly clip mid-action.
  - File: `toDoList_main/src/companion.js`
  - Completed: YYYY-MM-DD (PR #<number>)

- [x] **[LOW]** Replace dark-mode toggle with sun/moon icon button
  - Description: Swap the current dark-mode toggle for a 36×36 icon button placed immediately to the right of the ghost toggle. The button shows a moon glyph in light mode and a sun glyph in dark mode (icon represents the target mode, per convention), with a short fade/rotate (~150ms) on the swap to match existing app transitions. Use inline SVG for both glyphs — no new icon-library dependency — and update `style.css` for the button frame (transparent fill, subtle border, hover state). Existing theme-toggle wiring lives in `main.js`; grep with `offset`/`limit` rather than loading the whole file since it's over 25k tokens.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-04-25 (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
