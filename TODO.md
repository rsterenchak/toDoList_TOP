# TODO List

## Bugs

- [ ] **[HIGH]** Desktop description field collapses newlines when copied (mobile works)
  - Description: On mobile, the description editor preserves multi-line markdown formatting correctly through paste → save → reload → copy. On desktop, the same `desc` field collapses all newlines and leading indentation into a single horizontal run of text separated by extra spaces, breaking the TODO.md draft-and-copy workflow. The data layer is shared (`listLogic.js`, same `desc` string field), so the divergence is in the desktop render surface or the desktop copy mechanism — not the underlying data. Goal: bring desktop to formatting parity with mobile so a multi-line markdown entry pasted in on desktop comes back out with identical bytes.
  - Behavior:
    1. The desktop description editing surface must use a `<textarea>` element with `white-space: pre-wrap` and a monospace font — same element type as the mobile modal. Not `contenteditable`, not a `<div>`, not `<span>`, not `innerHTML` on any element.
    2. Value is assigned via `textarea.value = todo.desc` (the property), never `innerHTML`, `innerText`, or `textContent`.
    3. The desktop copy mechanism reads from `todo.desc` directly (or `textarea.value`) and passes that raw string to `navigator.clipboard.writeText`. No `.innerText` reads, no DOM round-trip, no innerHTML serialization.
    4. If `desc` is also rendered read-only anywhere on desktop (preview on the row, tooltip, non-editing modal state), that surface uses `white-space: pre-wrap` and is populated via `.textContent` on a whitespace-preserving element — never `innerHTML`.
    5. Mobile behavior stays unchanged — this is desktop-only catch-up.
  - Implementation notes:
    - **Diagnostic step first**: open the desktop description surface in DevTools. Compare to the mobile modal element side-by-side. The element type and `white-space` CSS will reveal the divergence. Likely the desktop path was built before the mobile modal and uses an older render approach.
    - Check whether desktop and mobile share the same renderer/builder function or use separate paths. If separate, consolidating onto the textarea-based mobile builder is the simplest fix.
    - The difference between `.innerText` and `.textContent` matters here: `.innerText` collapses whitespace based on CSS (so it returns the collapsed version even if the data is correct), while `.textContent` returns the raw text node. For copy operations, prefer reading `todo.desc` or `textarea.value` directly over either DOM read.
    - Inline JS styles override CSS (recurring source of bugs in `main.js`) — if `white-space: normal` is being set inline on the desktop desc element, change it in JS, not just in `style.css`.
    - `main.js` is over 25k tokens — grep for `desc`, `description`, and any "copy" handlers with offset/limit pagination rather than full reads. Look specifically for handlers that ONLY run when `pointer: fine` or behind any `(min-width: …)` gate.
    - Round-trip acceptance test: paste this exact block into the desktop description field, save, reload, copy, paste into a plain text editor:
    - [ ] **[LOW]** Example todo
      - Description: First line.
        - Nested bullet.
      - Code: `npm install`
      The pasted-out bytes must match the pasted-in bytes character for character. Run the same test on mobile to confirm parity is maintained.
    - No data-model changes. No dependencies. No mobile path changes.
  - Acceptance criteria:
    - Pasting a multi-line markdown block into the desktop description editor visually shows the same line breaks and indentation that were pasted in.
    - After save → reload, the desktop editor still shows the same formatting.
    - Copying from desktop places bytes on the clipboard that, when pasted into a plain `.md` file, render with all newlines and indentation intact.
    - Round-trip test (paste markdown → save → reload → copy → paste into text editor) produces bytes identical to the original paste, on desktop.
    - Mobile round-trip behavior is unchanged (regression check).
    - No element in the desktop description render or copy path uses `innerHTML` or `.innerText` for desc content.
  - Out of scope: markdown preview/rendering inside the modal (live-rendered markdown), syntax highlighting, multi-todo export, structured entry assembly, mobile-side changes.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

- [ ] **[MEDIUM]** Make todo titles editable from the mobile detail modal
  - Description: On desktop, todo titles are renamed inline by double-clicking the title field on the row. On mobile, tapping a todo row opens a detail modal showing title, description, and due date — but the title in that modal is read-only, so there's no way to rename a todo on touch devices without rotating to desktop. Add tap-to-edit behavior to the title inside the mobile modal: render the title as static text with a small pencil affordance (`✎` in the accent color) to signal editability; on tap, swap the static text for an input prefilled with the current value, focused and selected. Commit on Enter or blur, escape on Escape (revert). Reuse the existing `renameHandledByEnter` flag pattern so the Enter `keydown` handler and the `blur` handler don't both run duplicate-check logic against already-updated state. Empty titles revert to the previous value rather than blocking. All mutations route through `listLogic.js` (likely a reuse of the same rename path used by the desktop inline edit) — do not mutate the data model from the modal directly. Note: the input needs `font-size: 16px+` to avoid iOS Safari auto-zoom on focus.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [ ] **[LOW]** Add center-screen checkmark animation on mobile swipe-to-complete
  - Description: When a todo row is swiped right past the completion threshold on a touch device, briefly show a large purple checkmark animation in the center of the viewport to confirm the action. Style: a bare ✓ in the accent purple (`#6C5DF5`), roughly 90px tall, that pops in with a slight overshoot (scale 0.3 → 1.2 → 1.0) while a soft circular ripple expands outward from it and fades to transparent. No enclosing circle or background — the check sits over whatever's behind it. Total duration roughly 1.0–1.2s, then the whole thing fades out. Overlay must be `pointer-events: none` and `position: fixed` centered, so it never intercepts taps and the user can keep scrolling or tapping mid-animation. Gate the whole behavior behind the existing touch-device check (`pointer: coarse`) — desktop completion paths don't trigger it. Trigger fires on swipe-release once the completion threshold is crossed (matches the existing swipe-right-to-complete flow), not mid-swipe. Swiping right on an already-completed row to un-complete it does NOT play the animation — only the complete direction does. Respect `prefers-reduced-motion`: when set, skip the animation entirely and just complete the todo silently. Hook into the existing `touchend` handler in `main.js` that finalizes the swipe-complete gesture; the animation should be a small DOM-node-insert-then-remove rather than a long-lived element, so there's no cleanup risk if the user fires it repeatedly in quick succession.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
