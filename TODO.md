# TODO List

## Bugs

- [x] **[MEDIUM]** Replace due-date pill with bare calendar icon on mobile todo rows
  - Description: On mobile (touch / narrow viewport), the due-date pill on each todo row (icon + "May 31" text inside a padded background) eats horizontal space and forces the title to truncate aggressively — see screenshot in conversation history where titles cut off at ~25 characters. Replace the pill with just the calendar icon (`ti-calendar` or existing equivalent), no background chrome, no date text inline. The icon's color encodes urgency: red `#E24B4A` for overdue, amber `#EF9F27` for due today or within 3 days, purple `#9D93EE` for future dates, dim gray `#5a5a6a` for no date set. The actual date stays accessible — tapping the icon still opens the existing due-date popover, which shows and edits the date as it does today. Desktop layout is unchanged (it has the room for the full pill).
  - Behavior:
    1. At mobile breakpoint, render only the calendar icon in the due-date slot — no `May 31` text node, no pill padding/background.
    2. Compute urgency class at render time and on storage restore: overdue / soon (≤3 days) / later / none.
    3. Tap target remains at least 32×32px (wrap the icon in a padded button if the bare icon is smaller) so it stays reachable.
    4. Tapping the icon opens the existing due-date popover unchanged.
    5. On desktop, the pill renders as today.
  - Implementation notes:
    - Likely a CSS-only change at the mobile breakpoint (hide the date text span, strip the pill's `background`/`padding`, set icon color via a class on the pill element). Confirm by grepping `main.js` for the pill construction — if the date text is appended as a child of the pill rather than a sibling span, may need a small DOM tweak or a wrapping span to target it with `display: none` on mobile.
    - Urgency class should be applied to the pill element (or its icon) by the same code path that currently writes the date label, so both initial render and restore-from-storage stay in sync.
    - Reminder: inline JS styles override CSS — if `main.js` is setting `style.background` or `style.padding` on the pill directly, those writes need to go away (or be made conditional) for the CSS mobile rules to take effect.
    - Mobile breakpoint should match existing convention in `style.css` (no new breakpoint).
  - Acceptance criteria:
    - On a narrow viewport, todo rows show titles with noticeably more room than before; the calendar icon sits where the pill used to.
    - Icon color matches urgency: overdue red, ≤3 days amber, future purple, no date dim gray.
    - Tapping the icon opens the due-date popover unchanged.
    - Desktop layout (wide viewport) shows the full pill as today.
  - Out of scope: Changes to the due-date popover itself, changes to desktop rendering, recurring-task UI.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-25

## Features

- [x] **[MEDIUM]** Re-enable drag-and-drop JSON import with redesigned full-window overlay
  - Description: The drag-and-drop import code in `exportImport.js` is fully intact (`attachDragDropImport` is exported, `#importDropOverlay` CSS is present, validation routes through the shared `importTodosFromString` pipeline with the destructive-overwrite confirm modal), but the boot-time call from `main.js` is missing — dragging a `.json` file onto the window currently does nothing. Re-wire the call alongside the other restore-from-storage hooks (passing the same `rebuildAfterImport` callback the file picker and Drive pull paths use), and redesign the overlay to a full-window dashed perimeter: replace the small centered `#importDropOverlayInner` card with an inset dashed border (`inset: 18px; border: 2px dashed var(--accent); border-radius: 8px; box-shadow: 0 0 24px var(--accent-glow)`) over a slightly darker base wash (`background: rgba(14,15,20,0.72)`), centered inside it a 44px Tabler-style file-arrow glyph (vanilla inline SVG or a unicode glyph — no new icon-font dependency), the existing "DROP JSON TO IMPORT" label in SpaceMono uppercase letterspaced, and a 12px `var(--text-secondary)` subline reading "Replaces all current projects & todos" so the destructive nature is legible before the confirm modal opens. Keep the pointer-coarse early-return (touch browsers skip drag listeners entirely), the existing `dragDepth` enter/leave counter, and the file-type guard. The overlay stays `pointer-events: none` so the window-level `drop` listener still fires.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/exportImport.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-24

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
