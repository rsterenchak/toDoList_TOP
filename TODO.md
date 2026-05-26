# TODO List

## Bugs

- [x] **[MEDIUM]** Preserve markdown formatting in description editor (paste + copy)
  - Description: The description editor modal (from the prior entry, mobile centered modal C) currently strips formatting when markdown text is pasted in, and the "Copy as TODO.md entry" button must emit the textarea contents to the clipboard as raw markdown bytes with no transformation. End goal: the user can paste a TODO.md draft into the modal, edit it, tap "Copy as TODO.md entry", and paste the result directly into their `TODO.md` file with formatting fully intact (bullets, indentation, backticks, newlines, asterisks, brackets).
  - Behavior:
    1. Paste into the description textarea preserves the raw clipboard text verbatim — newlines, leading whitespace, asterisks, backticks, dashes, brackets, and Unicode all survive.
    2. The textarea uses `white-space: pre-wrap` (or `pre`) so indentation and line breaks render visibly while editing.
    3. The textarea has `autocapitalize="off"`, `autocorrect="off"`, `spellcheck="false"` so iOS/Android keyboards don't autocorrect markdown punctuation (e.g. turning `--` into `—`, `"foo"` into curly quotes, or auto-capitalizing list items).
    4. The `desc` field stores the raw string as-is — no `.trim()`, no `.replace()`, no HTML escaping on write.
    5. "Copy as TODO.md entry" calls `navigator.clipboard.writeText(todo.desc)` with the unmodified string. No template wrapping, no prefix/suffix, no entity encoding — what the user typed is what lands on the clipboard.
    6. Brief visual confirmation that copy succeeded: button label flips to "Copied ✓" for ~1.2s, then reverts. No toast, no modal.
    7. On render (modal open, page reload), `desc` is placed into the textarea via `textarea.value = todo.desc` — never `innerHTML` or `innerText`, which would normalize whitespace and entities.
  - Implementation notes:
    - The current "Copy as TODO.md entry" button in the description editor modal is the integration point — this entry fixes its behavior, doesn't add a new button.
    - Investigate why paste currently strips formatting. Likely culprits: (a) the editor surface is `contenteditable` instead of `<textarea>` and `innerText` is normalizing; (b) there's a `paste` event listener calling `e.clipboardData.getData('text/plain')` then mangling; (c) `desc` is being set via `innerHTML` somewhere in the render path. If the editor is currently `contenteditable`, switch to `<textarea>`.
    - Verify in `listLogic.js` that the `desc` write path doesn't transform the string. `addToDo_` / `updateToDo` / wherever the desc setter lives should assign the raw value.
    - Inline JS styles override CSS (recurring source of bugs in `main.js`) — if `white-space` is being set inline, change it in JS, not in `style.css`.
    - Clipboard API requires a secure context (HTTPS) — GitHub Pages already serves over HTTPS, so this works in production. For local `webpack-dev-server`, `navigator.clipboard` works on `localhost` per spec.
    - Fallback: if `navigator.clipboard` is unavailable (older mobile browsers), fall back to a hidden textarea + `document.execCommand('copy')`. Both paths emit identical bytes.
    - No new dependencies. No data-model changes — `desc` is already a string.
  - Acceptance criteria:
    - Pasting a multi-line markdown TODO.md entry into the description textarea preserves every newline, leading space, and special character.
    - After save + reload from localStorage, reopening the modal shows the description with identical formatting.
    - "Copy as TODO.md entry" places exactly `todo.desc` on the clipboard (verified by pasting into a plain text editor — bytes match).
    - Pasting the copied content into a real `.md` file renders correctly as markdown (bullets nest, code formatting holds, headings work).
    - iOS Safari does not autocapitalize, autocorrect, or smart-quote-substitute typed content in the textarea.
    - Copy button shows brief "Copied ✓" confirmation, then reverts.
  - Out of scope: multi-todo export, project-level export, footer-level export trigger, structured entry assembly (assembling `- [ ] **[PRIORITY]** {title}\n...` from separate fields), markdown preview/rendering inside the modal, syntax highlighting.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/listLogic.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-25

## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
