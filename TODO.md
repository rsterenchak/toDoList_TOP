# TODO LIST

- [ ] **[MEDIUM]** Agent view: span the full pane instead of the narrow queue rail
  - Type: bug
  - Description: `#agentView` overlays `#mainBar` (`grid-row: 1 / -1; grid-column: 1`) exactly the way `#structureView` does, so at desktop widths it is boxed into the fixed ~308px queue track of `#mainSec`'s queue|detail split while `#descDetailPane` sits beside it showing its "open a task" empty state — the same squeeze the Structure view had before it was given the full pane. The Agent view is now reached only by DRAFTED / STUCK / MOCKUP badge routes, but when it is shown its board is crammed into the rail. Give it the full pane the same way Structure got it: collapse the `#mainSec` split and hide the detail pane while AGENT is active.
  - Behavior: With AGENT active at desktop widths the board fills the entire main pane — no queue rail beside it, no leftover detail pane. Switching back to STREAM restores the queue rail and detail pane with the open task intact. Mobile is unchanged.
  - Implementation notes:
    - Mirror the Structure collapse gate: it is keyed off `body[data-view="structure"] #mainSec` (an ancestor of `#mainBar`, since CSS can't select an ancestor by a descendant's attribute). Add the identical `body[data-view="agent"] #mainSec { grid-template-columns: minmax(0, 1fr); }` rule.
    - Hide `#descDetailPane` while AGENT is active. `applyActiveView` already toggles `descDetailPane.hidden` for `structure`; extend that to also hide it for `agent` (the `#descDetailPane[hidden] { display: none }` guard already exists). Do NOT unmount `#descSibling` — hide the pane so returning to STREAM restores the open task.
    - Verify the Agent board's own internal layout reads correctly at the full pane width — it was only ever seen in the rail, so its cards may need their own max-width or grid tuning; report what you find and keep any board-internal change minimal.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
