# TODO List

## Bugs
     
- [x] **[MEDIUM]** Fix due-date pill bottom border being clipped inside todo row
  - Description: The due-date pill (calendar icon + "MAY 1" + chevron) inside each todo row is missing its bottom border — the top, left, and right borders render but the bottom edge is cut off flush with the row. Expected behavior is a fully enclosed rounded rectangle around the pill matching its top border. Likely cause is the pill's effective height (border + padding + line-height) being slightly taller than the todo row's content box, combined with `overflow: hidden` (or a too-tight `height`/`max-height`) on the row container clipping the bottom edge. Investigate the todo row's height and overflow rules and the pill's vertical padding/line-height in `style.css` — either give the row enough room or remove the overflow clip on that axis.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-04-24 (PR #<number>)

- [x] **[MEDIUM]** Fix due-date pill bottom border still clipped after first attempt (deeper investigation)
  - Description: Follow-up to the earlier due-date pill clipping entry — the bottom border is still being cut off (top border + top corners render cleanly, bottom edge is flush with the row's bottom edge with no visible border or bottom radius). The first fix attempt (loosening row height / overflow) didn't resolve it, so the cause is likely something more specific. Things to check in order: (1) `box-sizing` mismatch — if the pill is `content-box` while siblings are `border-box`, its rendered height exceeds the row's flex slot and the bottom border falls outside; force `box-sizing: border-box` on the pill. (2) `align-items: stretch` on the row's flex container forcing the pill to stretch to row height — switch to `align-items: center` so the pill keeps its intrinsic height. (3) The row itself has a bottom border that's painting *over* the pill's bottom border at the same Y coordinate — confirm by temporarily giving the pill a 2px bright border and seeing if the bottom reappears. (4) Sub-pixel rounding on the pill's `border-bottom` at the device's DPR — try a slightly thicker border or explicit `border-bottom-width: 1px` to rule it out. (5) Negative `margin-bottom` or `transform: translateY()` on the pill pulling it below the row's content box. Inspect with Safari Web Inspector (mobile) — the computed bottom border value will tell you immediately whether it's "declared but clipped" vs. "never declared in the first place."
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-04-24 (PR #<number>)

- [ ] **[MEDIUM]** Fix add-project button not auto-focusing the new project input on mobile
  - Description: On mobile, tapping the add-project button in the sidebar inserts a new project row but doesn't move focus into its input field — the user has to make a second tap on the input before the soft keyboard appears and they can type, which is significant friction on touch. Expected behavior is that the new project's input is focused immediately after creation so the keyboard pops up and typing flows in without an extra tap. Likely cause is the button's click handler creating and rendering the new row but never calling `.focus()` on the input — or calling it outside the original tap's user-gesture tick (e.g., after a `setTimeout` or after an `await`), which iOS Safari treats as a non-gesture focus and silently refuses to summon the keyboard for. Fix by appending the row first, then calling `.focus()` on the input synchronously in the same handler tick. If a render path defers DOM insertion, restructure so the input exists before the focus call rather than deferring the focus.
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)
     
- [ ] **[MEDIUM]** Fix footer still clipped at viewport bottom on mobile (background not reaching screen edge)
  - Description: Follow-up to the earlier safe-area fix — footer text ("TASK MANAGEMENT V1.1" / "X OPEN / Y DONE") is still being clipped at the bottom edge on iOS Safari. Working theory based on visual inspection: the footer container itself isn't extending all the way down to the screen edge, so its background ends short of the bottom and the content inside is positioned against wherever that short edge lands — instead of being lifted up by the safe-area inset. Expected behavior is that the footer's background fills to the absolute bottom of the viewport (under the home indicator) while the footer's *content* sits above the safe-area inset and is fully readable. Fix pattern: ensure the page layout (body or main app container) is `min-height: 100dvh` so the footer can reach the true bottom, then on the footer use `padding-bottom: env(safe-area-inset-bottom)` (not `bottom`/`margin-bottom`) so the background paints into the inset zone while content is pushed up. Verify `viewport-fit=cover` is on the viewport meta tag — without it, `env(safe-area-inset-bottom)` resolves to 0 and the padding does nothing. Also worth checking whether a parent container has a fixed `height: 100vh` (which on iOS excludes the dynamic toolbar area) — switch to `100dvh` if so.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/template.html`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[LOW]** Add completion micro-interaction when a todo is checked off
  - Description: Make the most-repeated action in the app feel satisfying: when the user flips `#checkToDo` from unchecked → checked inside `wireCheckbox`, play a brief celebratory animation. (1) The checkbox scales to ~1.15 and back over ~150ms while the `::after` checkmark draws in. (2) A left-to-right strike-through sweep animates across `#toDoInput` over ~200ms before the static `text-decoration: line-through` on `#toDoChild.completed #toDoInput` takes over. (3) On touch devices, `navigator.vibrate(10)` fires a short haptic pulse (guard with `'vibrate' in navigator`). Fire only on the unchecked → checked transition — not on page load for already-completed items, and not on uncheck. Respect `prefers-reduced-motion` by skipping the visual animations while keeping the haptic, which is subtle and welcome even with reduced motion. Implement via a transient `just-completed` class added in the change handler and removed ~300ms later, with `@keyframes` in `style.css` targeting the checkbox and title under that class — this isolates the animation from the sort-to-bottom DOM reorder that follows completion.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-04-23 (PR #<number>)

- [ ] **[LOW]** Add desktop-only ghost companion that roams the bottom of the screen and cheers on completion
  - Description: Add a small animated pixel ghost character that lives in the bottom strip of the viewport on desktop, occasionally wandering around and celebrating whenever a todo item or project is completed. Purely decorative — no functional effect on the todo list itself, just a bit of personality.
    - Character & rendering:
      1. Ghost sprite, ~48–64px tall, pixel-art style, tinted to match the app's purple accent against the dark theme. Hard pixel edges so it reads cleanly at 1x/2x DPR.
      2. Single PNG sprite sheet with three animation states stacked vertically: idle (slow bob/blink, ~4 frames), walk (~4 frames, drawn facing right — flip horizontally via CSS `transform: scaleX(-1)` when moving left), cheer (~6 frames, arms/tail raised with a small vertical hop). Suggested sheet layout: 48x48 per frame, 6 cols × 3 rows = 288x144 total. Final dimensions up to the implementer.
      3. Animate via CSS `@keyframes` with `steps(N)` on `background-position-x` — no JS per-frame redraws needed. One keyframe rule per state, swap the element's class to change state.
    - Behavior / state machine (managed in `main.js`):
      1. States: IDLE, WALKING, CHEERING. On a 20–120s random timer, transition IDLE↔WALKING (weighted ~70% idle so it doesn't pace constantly).
      2. WALKING: pick a random target X inside the allowed strip (bottom ~160px of the viewport, 24px margins on each edge), lerp `left`/`top` toward the target at a slow walk pace, flip sprite on direction, return to IDLE on arrival. Also pick a random Y offset within the strip so it drifts up and down slightly, not just left/right.
      3. CHEERING: triggered externally (see below), interrupts any state, plays the cheer animation once, returns to IDLE. A bigger cheer (longer animation or a simple CSS confetti/sparkle burst from the ghost's position) fires when the last open item in a project gets checked off.
    - Cheer trigger wiring:
      1. Hook into the existing item-completion handler in `main.js` (wherever the `completed` flag is toggled and the row re-renders) — call `companion.cheer()` there. Fire the "project complete" variant when the toggle results in zero remaining open items in the active project.
    - Settings & persistence:
      1. Add an on/off toggle somewhere unobtrusive (sidebar footer or next to the theme toggle). Default on.
      2. Persist the preference to `localStorage` under the existing `todoapp_` prefix (e.g. `todoapp_companion_enabled`). When disabled, remove the companion element entirely — don't just hide it — so it consumes no timers or paint work.
    - Desktop-only gate:
      1. Mount the companion only when `(min-width: 1024px) and (pointer: fine)` matches. On mobile it would overlap tap targets and the bottom safe-area is already tight (see the footer clipping entries).
    - Accessibility:
      1. `aria-hidden="true"` on the companion element — it's decorative; screen readers shouldn't announce it.
      2. Respect `prefers-reduced-motion: reduce` — when set, skip all movement and cheering animations entirely (either hide the companion or render it static in one spot).
    - CLAUDE.md constraints:
      1. No new dependencies — sprite animation via CSS keyframes + background-position is pure native CSS, no library needed.
      2. `main.js` is large (25k+ tokens) — when locating the completion toggle handler for the cheer hook, use grep (`toggleCompleted`, `completed = `, or the checkbox event wiring) + offset/limit rather than reading the full file.
    - Out of scope for v1: click-to-pet interactions, thought bubbles with phrases, sleep state after inactivity, multiple character skins or a character picker, mobile support, dragging the ghost to reposition. Any of these can be follow-up entries once the base companion is shipped.
    - Asset note: the sprite sheet PNG itself needs to be created or sourced. Add to `toDoList_main/src/assets/` (create the folder if it doesn't exist) and reference from `style.css` via `url()` — Webpack will handle it. If no assets path is currently configured in webpack, confirm with a quick grep of `webpack.config.js` before writing the entry's CSS (per CLAUDE.md, don't modify webpack config unless required; the default file-loader setup usually already handles images).
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/index.js`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
