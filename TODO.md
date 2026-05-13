# TODO List

## Bugs

- [ ] **[LOW]** Reduce TODAY/PROJECTS pill button size to compact
  - Description: Shrink the TODAY/PROJECTS view-switch pills in the top bar to a more compact size — currently they're visually heavy for a global nav element. New specs: `font-size: 12px`, `padding: 4px 12px`, resulting in roughly 22px tall pills. Keep the existing letter-spacing, uppercase transform, font-weight, border-radius (999px), and active/inactive coloring exactly as they are — this is a size-only change.
    - Implementation notes:
      - If any inline styles were applied to the pills in `main.js` during the pill-bar creation or top-bar relocation entries (font-size, padding, height), update them directly in `main.js` — inline JS styles override CSS and have been a recurring source of styling bugs in this codebase.
      - On mobile, verify the pills still meet a usable tap target. At ~22px tall they're on the smaller side vertically, but the horizontal padding keeps them ~70–80px wide, which is workable.
  - File: `toDoList_main/src/style.css`, `toDoList_main/src/main.js`
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
