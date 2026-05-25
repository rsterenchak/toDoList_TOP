# TODO List

## Bugs

- [ ] **[MEDIUM]** Add description editor modal on mobile for drafting TODO.md entries
 - Description: On mobile (touch devices, `pointer: coarse`), tapping a todo row body opens a centered modal editor over a backdrop for editing that todo's `desc` field. The intended use is drafting TODO.md backlog entries inside the app, so the editor must preserve markdown formatting (backticks, indentation, multi-line) and offer a one-tap copy-to-clipboard. Match the existing modal pattern (changelog modal): floating dialog padded from screen edges, purple-accented border, header with todo title + close X, monospace `<textarea>` filling the body, toolbar at the bottom.
 - Behavior:
   1. Tap on a todo row body (excluding the checkbox, date pill, and any existing controls) opens the modal for that row's todo.
   2. Modal renders the current `desc` value in a monospace textarea, font-size 16px (CLAUDE.md mobile-input constraint to avoid iOS auto-zoom), `white-space: pre`, multi-line, no auto-resize on the row itself.
   3. Toolbar holds two buttons: "Copy as TODO.md entry" (primary, purple) copies the textarea contents to clipboard via `navigator.clipboard.writeText`; "Clear" wipes the textarea contents (with a confirmation step per CLAUDE.md's destructive-action rule, since this throws away saved description text).
   4. Save commits the textarea value back to the todo via `listLogic.js` (data-model mutations route through here) and closes the modal.
   5. Modal closes 3 ways per CLAUDE.md: explicit close X, backdrop click, Escape (even though Escape isn't reachable from a soft keyboard, keep it for parity with desktop keyboards on tablets).
   6. On the todo row, when `desc` is non-empty, render a small purple note-style indicator icon (inline SVG or a CSS-drawn glyph — no new dependencies) between the checkbox and the title so the user can tell at a glance which todos carry descriptions.
 - Implementation notes:
   - The `desc` field already exists on the `toDo` factory and is already persisted by `listLogic.js` — no data-model changes needed, only UI surface.
   - Gate the tap-to-open listener on `window.matchMedia('(pointer: coarse)').matches` so desktop behavior is unchanged. The description is silently still on the data model in localStorage on desktop; exposing it on desktop is a follow-up.
   - Be careful about tap-target collisions: tapping the checkbox, date pill, delete button, or title-edit affordance must NOT open the modal. Wire the listener on the row body element specifically, and stop propagation from the controls.
   - `main.js` is over 25k tokens — navigate with grep + offset/limit when adding the modal builder and tap handler; don't try to read in full.
   - No new dependencies (per CLAUDE.md). Use the existing modal-creation helpers and styling tokens in `style.css`.
   - The "Copy as TODO.md entry" button copies the raw textarea contents as-is — the user is responsible for the markdown shape. (A future iteration could assemble `- [ ] **[PRIORITY]** {title}\n  - Description: {desc}\n  - File: ...` from structured fields, but scope here is just the editor surface.)
 - Acceptance criteria:
   - Tapping a todo row body on a touch device opens the modal; tapping the checkbox or date pill does not.
   - Modal preserves markdown formatting on save and on reload from localStorage.
   - "Copy as TODO.md entry" places the textarea contents on the clipboard.
   - "Clear" prompts for confirmation before wiping non-empty content.
   - Modal closes via X, backdrop tap, and Escape.
   - Rows with non-empty `desc` show the indicator icon; rows with empty `desc` do not.
   - Textarea font-size is 16px+ on mobile (no iOS auto-zoom on focus).
 - Out of scope: desktop entry point for the editor; structured entry assembly from title + priority + file fields; rich-text or syntax-highlighted markdown editing.
 - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
 - Completed: YYYY-MM-DD (PR #<number>)


## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
