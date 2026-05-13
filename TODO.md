# TODO List

## Bugs

- [ ] **[MEDIUM]** Restyle Today view todo rows to match Projects view row style
  - Description: Update the Today view's todo row rendering to visually match the Projects view's todo rows — dark card fill, rounded corners, more generous padding, and the dotted-border due pill with calendar icon. Move the project-name pill from its current right-side position to the left of the title, where it functions as a leading context chip. The due pill takes the right-aligned slot the project pill used to occupy, matching the Projects view's layout exactly. The project pill changes from a filled style to a purple-outline + purple-text style to align with the rest of the row's chip aesthetic.
    - Behavior:
      1. Row layout (left to right): completion checkbox → project pill → todo title → due pill (right-aligned).
      2. Row card: dark fill matching the Projects-view row fill (`~#1a1a22`), `border-radius: 6px`, padding ~11px vertical × 14px horizontal, ~4px vertical gap between rows.
      3. Project pill: purple outline + purple text on transparent background, all-caps, same monospace styling currently used. `max-width: ~110px` with `text-overflow: ellipsis` and `white-space: nowrap` for long project names.
      4. Due pill: visually identical to the existing Projects-view due pill — dotted 1px border, calendar icon, all-caps date text, chevron-down affordance. Amber border + amber text variant for items due today and "due in N days" labels (≤3 days out), matching the Projects view's existing amber styling convention.
      5. Checkbox styling matches the Projects-view checkbox (size, border, hover, checked state).
      6. The existing click-row-to-jump-to-project behavior (from the aggregation entry) remains intact: clicking the row body outside the checkbox and pills switches to PROJECTS view, selects the project, and scrolls to the todo.
    - Implementation notes:
      - Reuse the existing project-row CSS classes for the card fill, checkbox, and due pill where possible. If `style.css` doesn't currently expose them as shared classes, extract a `.todoRowCard` (or similarly named) class that both views share, so future tweaks only touch one place.
      - The due-pill rendering currently lives inside the project-row builder in `main.js`. If extracting it cleanly to a small shared helper is straightforward, do so and reuse it in `buildTodayRow`. If not, match the markup and styles directly in `buildTodayRow` and leave a `// TODO: extract shared due-pill builder` comment for a future cleanup pass.
      - Inline JS style assignments on the existing Today rows (set during the aggregation entry) must be removed if they conflict with the new CSS — inline styles override stylesheets in this codebase and have been a recurring source of bugs.
      - The four-builder consolidation refactor on the roadmap remains separate; don't pull it into this entry. Only `buildTodayRow` is in scope.
      - `main.js` is over 25k tokens; grep for `buildTodayRow` (or the Today-row creation block from the aggregation entry) and the existing project-row builder before reading, with offset/limit pagination.
    - Out of scope: making the due pill interactive on the Today view (clicking the chevron should not yet open the date popover — the pill remains display-only in this entry; interactivity is a follow-up entry); a description-toggle control on Today rows; an X close/remove control on Today rows; the four-builder consolidation refactor.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)

## Features

- [x] **[MEDIUM]** Relocate view-switch pills to top bar and remove sidebar PROJECTS label
  - Description: Move the TODAY/PROJECTS pill bar from its current centered position in the main panel header row up into the top bar, anchored to the left immediately right of the hamburger icon. Remove the all-caps "PROJECTS" label that currently sits at the top of the sidebar so the project list begins directly at the sidebar's top padding. Together these align the layout with the chosen Today dashboard mockup and resolve the vertical asymmetry between the sidebar (which no longer has a header) and the main panel (which previously did).
    - Behavior:
      1. Top bar layout becomes: hamburger icon (far left) → small gap → TODAY pill → PROJECTS pill → flexible spacer → existing right-side icon cluster (pomodoro, stats, ghost). Pills keep their active/inactive styling, click behavior, and view-persistence wiring from the shell entry.
      2. The previous pill container in the main panel header row is removed. EXPAND ALL stays where it is (right-aligned, only rendered on PROJECTS view).
      3. The sidebar's "PROJECTS" all-caps header label is removed entirely. The project list now begins at the sidebar's existing top padding; the + button at the sidebar's bottom is unchanged.
      4. On TODAY view, the main panel's first visible element is now the date header — no header row sits above it, since EXPAND ALL is PROJECTS-only.
    - Implementation notes:
      - On narrow / mobile widths, the top bar may not have room for hamburger + two pills + three right-side icons. Start with the simplest fix: compress pill padding via a `<600px` breakpoint. If that's still tight, fall back to hiding pill text behind a small dropdown. Pill text needs to stay at `font-size: 16px+` to avoid iOS auto-zoom regardless of which approach is taken.
      - The pill bar was created in `main.js` in the shell entry; if any inline styles were applied there (background, border, layout), they need to be updated in `main.js` directly — CSS-only changes will be overridden.
      - `main.js` is over 25k tokens; grep for the pill bar creation block from the shell entry and the existing top-bar render block before reading, with offset/limit pagination.
    - Out of scope: any change to pill visuals (color, shape, animation) beyond position; the sidebar's + button placement or styling; the right-side icon cluster; any change to EXPAND ALL.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-13

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
