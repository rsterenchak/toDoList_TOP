# TODO LIST

- [x] **[MEDIUM]** Reformat Inbox cards to compact one-line + tap-to-open modal, fix vertical clipping
 - Type: bug
 - Description: On mobile Inbox view, each todo card currently clips its content at the top edge — the project breadcrumb (e.g. "▸ IDEA   Task Management App") rendered above the title is half-cut by the card's rounded top edge, and long titles get cropped at the bottom. The clipping is the underlying bug; the reformat is the design fix. Replace the current card layout with a compact one-line card: a small circular checkbox on the left, the title truncated to one line with ellipsis, a small `▸ IDEA` (or whatever entry-type tag) pill plus the project name as a dimmed metadata line below the title, and a right chevron (›) indicating tappable. Tapping a card opens a focused modal that displays the full title and full description with comfortable typography (no truncation, line-height ~1.5, generous padding), plus Edit and Done action buttons at the bottom. The modal serves as the "read mode" so the cards themselves can stay compact and many fit on a phone screen without clipping. Mockup option B from the user-approved set.
 - Behavior:
   1. The Inbox view's card container no longer clips content at its top or bottom edges. The clipping was caused by either `overflow: hidden` set too aggressively on the card or insufficient vertical padding combined with content rendering above the card's content box. Fix at the root: ensure the card's padding accommodates the rendered content AND `overflow: visible` (or `overflow: hidden` with content fitting inside) — pick whichever matches the surrounding pattern. The visible symptom (any text rendering outside the card's apparent bounds, or being cropped by the card's rounded corners) must be gone.
   2. New card layout, compact (one-line title):
      - Left: 18px circular checkbox/radio indicator with `1.5px` border in `var(--muted)` (matches existing inbox checkbox style if one exists; otherwise use the Void palette muted token).
      - Middle: stacked column with `gap: 3px`:
        - Title: `font-size: ~13.5px`, `line-height: 1.3`, `color: var(--text)`, truncated to one line via `overflow: hidden; text-overflow: ellipsis; white-space: nowrap`.
        - Metadata row: a small pill containing the entry-type tag (e.g. `▸ IDEA` — match whatever tag the entry already carries: IDEA, FEATURE, BUG, etc.) in `var(--purple-lt)` text on `rgba(108, 93, 245, 0.18)` background, `border-radius: 4px`, `padding: 2px 6px`, `font-size: 10px`, `letter-spacing: 0.5px`, `text-transform: uppercase`, `font-weight: bold`. After the pill, the project name in `font-size: 10.5px`, `color: var(--muted)`, single-line ellipsis truncation with a sensible max-width (~200px).
      - Right: chevron `›` glyph in `var(--muted-dim)`, `font-size: 14px`, flex-shrink: 0.
      - Card itself: `background: var(--card-bg)` (or the existing inbox card bg token — match what's already there), `border-radius: 12px`, `padding: 11px 14px`, `display: flex; align-items: center; gap: 10px`, `cursor: pointer`.
   3. Cards are tappable (entire card, not just the chevron). Tapping opens a modal.
   4. Modal contents:
      - At the top, a small dim label: `▸ IDEA · Task Management App` (entry-type tag and project name on one line, `font-size: 10px`, `color: var(--muted-dim)`, `text-transform: uppercase`, `letter-spacing: 1px`).
      - Title: `font-size: 16px`, `line-height: 1.35`, `color: var(--text)`, `font-weight: 600`, NO truncation (wraps naturally).
      - "Description" label (same dim small style as the breadcrumb label).
      - Description body: `font-size: 13px`, `line-height: 1.55`, `color: var(--text-dim)`, NO truncation, wraps fully.
      - Action row at the bottom, right-aligned: "Edit" (ghost button) and "Done" (primary purple button). Both invoke the EXISTING edit and complete handlers from the current Inbox tap behavior — do NOT create new handlers; reuse whatever the current card-tap or row-tap path uses for these actions.
      - Modal styling: `background: var(--card-bg)`, `border: 1px solid var(--purple-bord)` (or the existing modal border token), `border-radius: 14px`, `padding: 18px 18px 16px`, `box-shadow: 0 8px 24px rgba(0,0,0,.4)`, centered or anchored per the existing modal convention (grep for any existing modals like the edit modal, settings modal, or pomodoro modal and match its open/close treatment — overlay backdrop, focus trap, ESC-to-close, tap-outside-to-close).
   5. Closing the modal returns to the Inbox view with scroll position preserved.
   6. If a card is tapped while the keyboard is active in another input, the input loses focus and the modal opens — i.e. the tap dispatches normally without being eaten by a focus-blur race.
   7. The Inbox's existing affordances are unchanged: the empty-state, the pull-to-refresh (if any), the bottom tab bar (Projects / Inbox / Calendar), and the title-bar / settings menu access. Only the card layout and the modal trigger change.
   8. On the desktop layout (≥1024px) — if the Inbox is rendered there at all — the change is a no-op or matches whatever desktop already does. This entry is explicitly mobile-scoped; do not refactor desktop card rendering unless the same code path renders both (in which case, gate the new compact + modal treatment behind the existing mobile breakpoint and leave desktop on its current layout).
   9. Accessibility: cards are keyboard-focusable, Enter/Space activates the tap (opens the modal). Modal traps focus and returns focus to the originating card on close. The card's `role` and `aria-label` are set appropriately so screen readers announce the title + project context.
   10. Long titles (50+ chars) truncate cleanly with ellipsis in the card and render in full in the modal. Pin via test with a fixture entry having a known-long title.
   11. Entries without a description: the modal still opens, the "Description" label is either hidden or replaced with a dim "No description" placeholder. Pick one and pin it. Suggest: hide the label entirely and show no body text — cleaner.
 - Test-first regression set:
   1. Clipping fix: the card's rendered bounding box contains all of its child text. Pin via DOM assertion that the card's `scrollHeight` equals its `offsetHeight` (no overflow) AND the card's children's bounding rects are all within the card's bounding rect. May be flaky in jsdom — fall back to source-pattern (assert the card's CSS rule does NOT have `overflow: hidden` combined with insufficient padding, or assert `overflow: visible` is explicitly set).
   2. Compact card structure: the card contains exactly one title element, one metadata row with a pill + project name, and one chevron. Title element has `text-overflow: ellipsis` and `white-space: nowrap` in its computed style.
   3. Tap opens modal: simulating a click on the card invokes whatever modal-open function the implementation uses. Assert the modal element is present in the DOM and visible after the tap.
   4. Modal content: with a fixture entry having a known title and description, the modal contains both, with the title NOT truncated (`white-space: normal` or no truncation styles applied) and the description fully rendered (no `-webkit-line-clamp` or similar truncation).
   5. Modal close: tapping outside, pressing ESC, or tapping a close affordance closes the modal and returns focus to the originating card.
   6. Edit and Done actions in the modal call the SAME handlers the current Inbox card-tap action calls. Do NOT introduce new edit/complete logic — reuse existing.
   7. Long-title fixture: title with 80+ characters renders truncated with ellipsis in the card, full in the modal.
   8. No-description fixture: modal opens, no "Description" label, no empty body section.
   9. Keyboard accessibility: cards are reachable via Tab, Enter activates the tap, modal traps focus, ESC closes.
   10. Mobile-only scope (if Inbox renders on desktop too): at ≥1024px, the existing desktop layout is unchanged. Pin via responsive test or source-pattern check on the breakpoint guard.
   11. Empty Inbox: existing empty-state rendering is unchanged.
   12. Tab bar non-regression: the bottom tab bar (Projects / Inbox / Calendar) is unchanged.
 - Implementation notes: Find the Inbox view's card-rendering function. The screenshot's URL bar shows `terenchak.github.io` so this is the deployed PWA — the relevant module is whatever renders the Inbox tab on mobile. Grep `Inbox`, `inbox`, `INBOX`, or for the bottom tab bar's "INBOX" label to find the entry point. The card itself is likely rendered in a function that maps over a list of inbox entries (entries from across all projects that haven't been completed and aren't tied to a project view). Identify that function before touching anything.
   - Replace the card's DOM construction with the new compact structure. Remove any element that rendered the project breadcrumb ABOVE the title (this was the clipping culprit per the screenshot). Add the new metadata row BELOW the title.
   - Add the modal: if the project already has a modal system (grep for existing modals — settings, edit-task, pomodoro, etc.), follow its conventions for open/close, backdrop, focus management, ESC handling, tap-outside dismissal. If no existing modal system, the cleanest approach is a fixed-position overlay with a backdrop div and the modal content centered; reuse the Void aesthetic tokens (`--card-bg`, `--purple-bord`).
   - Wire the modal's Edit and Done buttons to the existing edit and complete handlers — do NOT introduce new mutation paths. Grep the current Inbox card's tap handler to find what it calls today and route the modal buttons to the same functions.
   - For the clipping fix specifically: inspect the current card CSS for `overflow: hidden`. If present, evaluate whether removing it leaks content elsewhere; if removing is safe, prefer that over restructuring. If `overflow: hidden` must stay (e.g. for border-radius clipping of child elements), increase the card's vertical padding so content fits inside, and ensure the rendered HTML doesn't place text outside the padded content box (the screenshot suggests the breadcrumb was being absolutely-positioned above the card top, or the card had `padding-top` smaller than the breadcrumb's height — find which and fix accordingly).
   - CSS tokens to use (match existing Void palette in `style.css`; if these exact tokens don't exist, grep for the closest equivalents and use those — do NOT invent new tokens):
     - Card bg: `var(--card-bg)` or whichever bg the current inbox card uses.
     - Pill bg: `rgba(108, 93, 245, 0.18)` (the existing purple-dim pattern from the show-completed icon's active state).
     - Pill text: `var(--purple-lt)`.
     - Title text: `var(--text)`.
     - Metadata muted: `var(--muted)`.
     - Chevron dim: `var(--muted-dim)`.
     - Modal border: existing modal border (grep `border:` on existing modal selectors).
   - The chevron is a simple `›` text glyph, not an SVG — keeps the DOM light.
   - Do NOT change the entry data model. Do NOT change how Inbox entries are aggregated. Do NOT change the empty-state. Do NOT change the bottom tab bar. Only the card's DOM structure and CSS + the new modal change.
   - If existing tests pin the old card structure (e.g. "card has a breadcrumb element above the title"), update those assertions to match the new structure. Do NOT delete the test file; extend it.
 - Out of scope: changes to the entry data model; the bottom tab bar layout; the empty Inbox state; the calendar tab; the projects tab; the desktop Inbox rendering (if separate from mobile); any change to other modals in the app; any change to how Inbox entries are filtered, sorted, or aggregated; the entry edit flow itself (only the trigger — the modal's Edit button — is new; the actual edit modal/screen is whatever already exists); the entry-type tag taxonomy (IDEA, FEATURE, BUG, etc.); the project name truncation max-width can be tweaked later if needed.
 - File: whichever module renders the Inbox tab on mobile (grep `Inbox`, `inbox`, or the INBOX tab label to find it — likely in `main.js` or a dedicated `inboxView.js` module), `toDoList_main/src/style.css` (new CSS for the compact card + modal), `toDoList_main/tests/` (extend existing inbox tests if they exist, or add a new test file `inboxCardCompact.test.js`)
 - Completed: 2026-06-07
  <!-- id: bdc1a4e6-ddcd-4fcc-9ba9-e9e55b495e9b -->

- [x] **[HIGH]** Fix IDEAS filter rendering regression on project page + rewire Inbox modal 'Done' to close-only — Completed: 2026-06-07
 - Type: bug
 - Description: The previously-shipped "Reformat Inbox cards to compact one-line + tap-to-open modal" entry introduced two regressions:
   1. **Project page IDEAS filter no longer renders cards.** On the project view when the IDEAS filter pill is active (user-supplied screenshot shows "IDEAS 7 ›" selected and the page header reporting "9 open · 176 done"), the body renders the TODO.md viewer and then the empty-state ghost ("THAT'S ALL FOR THIS PROJECT") instead of the 7 idea cards that should be visible. The filter is selected and the count is correct (7 ideas exist in the data layer), but the rendered body skips them. The most likely root cause: the prior entry modified a shared card-rendering function (the Inbox and the project page's filtered-by-IDEAS list almost certainly share a `renderTodoCard` / `renderInboxCard` / similar function or render path), and the modification broke ideas-typed entries specifically. Alternative root causes worth checking: the prior entry's filter or mapping logic changed how IDEAS entries are selected; a JS error thrown during render is silently swallowing the cards; new CSS hides cards of type IDEA (e.g. an over-broad selector like `.inboxCard[data-type="idea"] { display: none; }` introduced by accident). The agent should diagnose with console probes BEFORE prescribing a fix — paste output from `document.querySelectorAll('[data-todo-id]').length`, `Array.from(...).filter(el => el.dataset.type === 'idea').length`, and `console.log` the entries array fed into the renderer when IDEAS filter is active.
   2. **Inbox modal's 'Done' button completes the entry, which removes it from Inbox.** The prior entry wired the modal's Done button to the existing complete handler. The user's intent — confirmed via clarification — is that Done should be a dismiss/close action only, NOT mark the entry complete. Idea-type entries especially should remain visible in the Inbox after the user has read them in the modal. Rewire the Done button to ONLY close the modal (same effect as tapping outside, pressing ESC, or tapping the close affordance if one exists). Do NOT change the Edit button — Edit continues to invoke the existing edit handler.
 - Behavior:
   1. With IDEAS filter active on the project page, all idea-type entries render as cards in the body — exactly as they did before the prior Inbox-card entry shipped. The empty-state ghost ("THAT'S ALL FOR THIS PROJECT") only appears when there are genuinely zero entries matching the active filter, not when entries exist but rendering is broken.
   2. The filter pill's count (`IDEAS 7 ›`) matches the number of rendered cards in the body. Pin via a behavioral test: with a fixture project containing K idea-type entries and the IDEAS filter active, assert exactly K cards render.
   3. Other filter pills (whatever else exists — FEATURES, BUGS, ALL, etc.) also render correctly. Specifically, if the prior entry broke ideas but other types render fine, the agent should diagnose why ideas specifically were affected and ensure the fix doesn't break the others. If the prior entry broke ALL types and the screenshot just happened to show IDEAS, the fix restores all types.
   4. The Inbox modal's Done button, when tapped, closes the modal and returns the user to the Inbox view with the entry STILL VISIBLE in the list. The entry's completion state is unchanged — it stays in whatever state it was in before the modal opened. `localStorage` is not written. The data model is not mutated.
   5. The Inbox modal's Edit button is UNCHANGED — still invokes the existing edit handler.
   6. The Inbox modal's other close paths (tap-outside backdrop, ESC key, close X if present) are unchanged — they also close without mutating state.
   7. The card visual treatment in the Inbox is unchanged from the prior entry (compact one-line, pill + project name, chevron). Only the Done button's wiring changes.
   8. The modal's visual treatment is unchanged from the prior entry (focused-read mode with full title, full description, Edit + Done actions). Only Done's behavior changes.
   9. Inbox entries that ARE genuinely completed (e.g. completed via the Edit flow or some other code path) continue to filter out of Inbox the same way they did before. Done in the modal is the only path being changed.
 - Test-first regression set:
   1. Project-page IDEAS filter renders cards: with a fixture project containing 3 idea-type entries and the IDEAS filter active, the body renders 3 card elements. Pin by selector — assert `document.querySelectorAll('[role="..."]' or whichever selector identifies an inbox/project card).length === 3` after filter is set to IDEAS.
   2. Empty-state correctness: with a fixture project containing 0 idea-type entries and the IDEAS filter active, the empty-state ghost element IS visible. (Pins that the empty-state isn't being shown incorrectly when entries DO exist.)
   3. Other filter types render: with a fixture containing entries of multiple types (idea, feature, bug, etc.), each filter pill shows the matching cards. This guards against the fix accidentally over-correcting (e.g. if the prior entry broke ideas-specifically and the fix accidentally breaks features).
   4. Inbox modal Done is close-only: with the modal open on a fixture entry, simulating a tap on Done does NOT call the complete handler. Pin via a spy/mock on whatever function the prior entry wired Done to — assert it's NOT called after the tap. The modal closes (assert modal element is no longer in the DOM or is hidden).
   5. Inbox modal Edit is unchanged: simulating a tap on Edit calls the existing edit handler. Pin via the same spy/mock approach.
   6. Inbox entry remains visible after Done: with a fixture Inbox containing entry E, tap E to open modal, tap Done to close, assert E is still rendered in the Inbox after the modal closes.
   7. localStorage non-regression: opening the modal, tapping Done, and closing it does NOT trigger any localStorage write. Pin via a spy on `localStorage.setItem`.
   8. Data-model non-regression: the entry's `completed` flag (or however completion is tracked in the data layer) is unchanged after tapping Done. Pin by checking the entry's state before and after.
   9. Existing complete-elsewhere paths still work: if the entry CAN be completed via a different path (e.g. tapping the checkbox indicator on the card itself, the Edit flow's complete action, etc.), that path is unchanged and still marks the entry complete.
 - Implementation notes:
   - **Diagnose Bug 1 BEFORE prescribing a fix.** Open the project page in the user's environment (or run the test fixture), set the IDEAS filter active, and run this console probe:
     ```
     // What's in the data layer?
     console.log('IDEA entries in data:', allProjects.find(p => p.name === 'Task Management App')?.todos?.filter(t => t.type === 'idea')?.length);
     // What's the renderer being given?
     // (find the render function and add a console.log of the entries array at its top)
     // What's actually rendered?
     console.log('Rendered cards in body:', document.querySelectorAll('[data-todo-id], .todoRow, .inboxCard').length);
     // Any JS errors?
     // (open the browser console and check for red errors during render)
     ```
     The output identifies which layer broke: data → renderer → DOM. Pick the fix that addresses the actual breakage point. Do NOT guess a root cause — instrument first.
   - **Likely candidates** (in rough order of probability based on the prior entry's scope):
     - **(a)** The prior entry modified a shared `renderInboxCard` or `renderTodoCard` function that is also called by the project-page filter logic. If the new card structure assumes Inbox-specific data (e.g. `entry.projectName` for the metadata pill) that ideas on the project page don't have or have differently, the renderer may throw or render empty. Fix: pass the missing data, OR branch the renderer by context (Inbox vs project page), OR keep the renderer Inbox-only and revert the project page to its prior render path.
     - **(b)** The prior entry added CSS like `.inboxCard` or `.todoCard` selectors that the project page's IDEAS list also matches, and a `display: none` or `overflow: hidden` rule is hiding ideas. Fix: scope the new CSS to only Inbox-context cards (e.g. `#inboxView .todoCard` instead of `.todoCard`).
     - **(c)** The prior entry introduced a JS error during render that's silently swallowed by a try/catch. Fix: surface the error and address the underlying issue.
   - **Bug 2 fix** is surgical. Find the modal's Done button click handler (grep for the modal's button construction from the prior entry). Currently it likely calls something like `completeEntry(entry.id)` or `markDone(entry.id)` followed by `closeModal()`. Change it to call ONLY `closeModal()` — strip the completion call entirely. Do NOT rename the button (keep the "Done" label per the user's choice). Do NOT touch the Edit button's handler.
   - The Edit button stays wired to the existing edit handler. Do NOT change it.
   - The modal's other close paths (backdrop tap, ESC, X if present) are unchanged.
   - If existing tests pin "tapping Done marks the entry complete" (introduced by the prior entry's test set), update those assertions to "tapping Done closes the modal without changing entry state". Do NOT delete the test file; extend/amend it.
   - **Sanity check before committing:** with the fix in place, run a fixture where an idea is tapped → modal opens → Done is tapped → modal closes. The idea must still be visible in the Inbox after this sequence. Pin via test.
 - Out of scope: changes to the card visual treatment (compact one-line layout from the prior entry stays); changes to the modal's visual treatment (title, description, Edit button — all unchanged); the data model for completion; how completed entries are filtered out of Inbox (the existing filter for genuinely-completed entries is preserved); the project page's filter UI (the pills themselves, their labels, their counts); the bottom tab bar; the empty Inbox state's design; the TODO.md viewer; the show-completed icon button in the viewer header; the chat pane; any change to the desktop layout if it renders independently from mobile (this entry is mobile-scoped — apply the same diagnosis if desktop is also affected, but do not refactor desktop-specific code paths).
 - File: same files the prior Inbox-card entry touched (grep the prior entry's commit for the exact list — likely `toDoList_main/src/main.js` and/or `toDoList_main/src/inboxView.js` or whichever module owns Inbox rendering), `toDoList_main/src/style.css` (if Bug 1's root cause is CSS-scoped), `toDoList_main/tests/` (extend the existing inbox tests from the prior entry — do not replace)
 - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 1988bac5-8d4e-4b9c-8a79-c73bc6922d6e -->

- [x] **[HIGH]** Revert all Inbox-card work — restore idea rendering in both Projects and Inbox tabs — Completed: 2026-06-07
  - Type: bug
  - Description: Two consecutive entries have left the app in a broken state where idea-type entries do not render in either the Projects tab (with the IDEAS filter active — the filter pill shows "IDEAS 7 ›" but the body shows the "THAT'S ALL FOR THIS PROJECT" empty-state ghost) or the Inbox tab. The page header reports "10 open · 176 done" yet no open cards render, confirming the render path is broken, not the data. The two entries responsible are: (1) the "Reformat Inbox cards to compact one-line + tap-to-open modal" entry (introduced compact cards, a tap-to-open modal, and rewired handlers), and (2) the follow-up "Fix IDEAS filter rendering regression + rewire Inbox modal Done to close-only" entry (a fix attempt that did NOT resolve the regression). Both fix attempts failed because the root cause is not well enough understood to fix forward safely. The correct move is to fully revert both, returning the card rendering for both Projects and Inbox to the exact state it was in BEFORE any of this Inbox-card work began. The original card-clipping cosmetic issue is acceptable to reintroduce — it will be re-addressed later in a much narrower CSS-only entry. Restoring the ability to see ideas in both tabs is the priority; a missing polish feature is far less bad than broken core rendering.
  - Behavior:
    1. On the Projects tab with the IDEAS filter active, all idea-type entries render as cards (the count in the "IDEAS N ›" pill matches the number of rendered cards). The empty-state ghost only appears when there are genuinely zero matching entries.
    2. On the Projects tab with any other filter (ALL, FEATURES, BUGS, or whatever the full set is) and with no filter, all matching open entries render as cards. The "10 open" (or current count) corresponds to rendered open cards.
    3. On the Inbox tab, all inbox entries render in whatever layout they had BEFORE the Inbox-card entry shipped (the pre-change card design, not the compact one-line + modal design). Tapping an inbox entry does whatever it did before the Inbox-card entry (likely opening the edit flow directly — restore the prior behavior).
    4. The tap-to-open modal introduced by the Inbox-card entry is GONE. The compact one-line card layout is GONE. The Done-close rewiring is moot (the modal it applied to no longer exists).
    5. All other app functionality is unchanged from current `main` EXCEPT the reverted Inbox-card work. Specifically, unrelated features that shipped before or after the Inbox-card work (the show-completed icon button in the TODO.md viewer, the sub-band background fixes, the chat pane, etc.) are NOT reverted — only the Inbox-card entry and its failed fix-follow-up are backed out.
    6. The full test suite passes on the reverted tree.
  - Test-first / verification approach:
    1. Behavioral ground truth (the acceptance criterion that matters most): with a fixture project containing K idea-type entries and the IDEAS filter active, exactly K cards render in the Projects body. With the Inbox populated by J entries, exactly J cards render in the Inbox. These two assertions are the definition of "fixed" — pin them.
    2. The compact-card and modal tests introduced by the Inbox-card entry and its fix-follow-up must be REMOVED (they pin behavior that no longer exists after the revert and would fail). Delete those test files or revert them as part of backing out the feature. Do NOT leave orphan tests asserting the removed modal/compact-card behavior.
    3. Whatever tests existed for the Inbox and Projects card rendering BEFORE the Inbox-card work are restored (if the Inbox-card entry modified or replaced them) and pass.
    4. Full suite green on the reverted tree (the baseline was ~2176 passing before this Inbox saga — confirm the revert returns to a comparable green baseline, accounting for any unrelated entries that legitimately shipped in between).
  - Implementation notes:
    - **Identify the commits to revert.** Use `git log --oneline` and grep commit messages / PR merge commits for the two entries. The first is the "Reformat Inbox cards to compact one-line + tap-to-open modal" work; the second is the "Fix IDEAS filter rendering regression + rewire Inbox modal Done to close-only" work. Confirm each commit's scope with `git show <sha> --stat` before reverting — verify they touched the Inbox/Projects render path and CSS, and did NOT bundle in unrelated changes.
    - **Prefer `git revert` over manual restoration** if the two commits revert cleanly and no unrelated commits have since modified the same lines. `git revert <fix-commit-sha> <inbox-card-commit-sha>` (revert the newer one first, then the older) produces a clean inverse. If `git revert` conflicts because unrelated work touched adjacent lines, resolve ONLY the Inbox-card-related hunks (restore the pre-change render path and remove the compact-card/modal additions) and leave unrelated intervening changes intact.
    - **If the fix-follow-up commit never landed** (it may have aborted, like prior entries in this project's history have when scope was unsafe — check whether a PR actually merged), then only the Inbox-card commit needs reverting. Verify via git history whether the fix-follow-up produced a merged commit before attempting to revert it.
    - **After reverting**, confirm the render path is restored by inspecting that the function which renders Projects cards and the function which renders Inbox cards are back to their pre-Inbox-card-entry form. If the Inbox-card entry modified a SHARED render function (the most likely root cause of why the Projects page broke from an Inbox-scoped change), reverting restores it for both — verify both call sites render correctly.
    - **Remove orphaned artifacts**: any new CSS classes the Inbox-card entry added (compact card, modal, badge-on-card) that are now unused should be removed to avoid dead CSS. Any new modal DOM-construction code, new event handlers, and the test files pinning them should be removed.
    - **Do NOT revert unrelated work.** If commits unrelated to the Inbox-card saga shipped between the Inbox-card commit and now, leave them untouched. Scope the revert strictly to the two named entries.
    - **Sanity check before committing**: load a fixture with idea-type entries, set the IDEAS filter on the Projects tab → ideas render. Switch to the Inbox tab → inbox entries render. Both must show cards, not the empty state. This is the whole point of the revert.
  - Out of scope: re-implementing the card-clipping fix (deliberately deferred — will be a separate, narrow, CSS-only entry later); re-implementing the Inbox modal (deferred — separate isolated entry later, only if still wanted, built to provably not touch the Projects render path); reverting any unrelated feature (show-completed icon button, sub-band fixes, chat pane, anything not part of the two named Inbox-card entries); changing the data model; changing the filter pills or their counts; the bottom tab bar; the TODO.md viewer.
  - File: same files the two Inbox-card entries touched (identify via `git show --stat` on the relevant commits — likely `toDoList_main/src/main.js` and/or `toDoList_main/src/inboxView.js` or whichever module owns Inbox + Projects card rendering, plus `toDoList_main/src/style.css`), and the test files those entries added under `toDoList_main/tests/` (remove them)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: bc0fc180-5bc5-4d4c-8dfa-eae5159f02fb -->

- [x] **[MEDIUM]** Make Inbox rows tap-to-open the existing description editor; switch to compact one-line + chevron layout — Completed: 2026-06-07
  - Type: feature
  - Description: The Inbox view's idea rows currently render a two-line card (status-label + project name above the title) and are only interactive via the small status-label chip. The user wants whole-row tap to open a read/edit view for the idea's title and description — with the explicit constraint that dismissing the modal NEVER marks the idea complete. The previously-shipped attempt at this bundled new modal DOM with a new shared-render-path, which broke the project-page IDEAS view and accidentally completed seven ideas via a Done-button-wired-to-complete bug. This entry takes a dramatically simpler approach: reuse the EXISTING `showDescEditorModal` (already in `modals.js`, already in production use from the project-page row tap handler). That modal has no completion wiring at all — it's structurally incapable of marking anything done. Tap-to-edit title commits via Enter or blur; description commits via blur; the `×` close dismisses. Edits persist via the existing `onSave` / `onTitleSave` callbacks that route through `listLogic.editToDoItem` (the same path the project-row description editor uses). On the inbox, after a save callback fires, call `renderInbox()` to refresh the row's visible title/description preview from the updated data. Card layout swaps from the current two-line form to the compact one-line form (option B from the user-approved mockup): title truncated to one line with ellipsis, status pill + project name on a meta row below, chevron `›` glyph on the right indicating tappability. Status-pill tap is preserved (existing popover wins via target check). **CRITICAL: this entry touches ONLY the inbox-specific code path (`buildInboxRow` and `renderInbox` in `main.js`, plus `.inboxRow*` CSS classes). It does NOT touch `buildToDoRow`, `toDoRow.js`, `taskFilter.js`, `applyTaskFilter`, or any shared card-rendering function. The project-page IDEAS view must continue to render all idea-status rows correctly — this is the non-regression guarantee learned from the prior saga.**
  - Behavior:
    1. Inbox row visual: 18px circular check glyph on left (existing, non-interactive — `inboxRowCheck`), a body column in the middle with the title on one line (truncated with ellipsis) and a meta row below (status pill via `buildStatusLabel(item)` + " · " + project name, both single-line ellipsis), and a chevron `›` glyph on the right (`var(--muted-dim)`, ~18px, `flex-shrink: 0`).
    2. Card padding `11px 14px`, `border-radius: 12px`, `background: var(--card-bg)` (or the existing inbox card bg token — match what's already there), `display: flex; align-items: center; gap: 10px; cursor: pointer`.
    3. Whole-row tap (click anywhere on `.inboxRow`) calls `showDescEditorModal(item, { projectName, onSave, onTitleSave })` where `item` is the row's `__item` and `projectName` is the row's `data-value`. Same calling shape as `toDoRow.js`'s existing usage.
    4. Tap targets that must NOT open the modal (the row handler bails on these, same pattern as `wireToDoRowClick` in `toDoRow.js`):
       - The status label chip (`.todoStatusLabel`) — its existing popover wins.
       - The non-interactive check glyph (`.inboxRowCheck`) — no behavior change.
    5. The chevron `›` is decorative — it has NO separate click handler. Clicks on it propagate up to the row handler and open the modal as part of the whole-row tap.
    6. Modal behavior: handled entirely by the existing `showDescEditorModal` — no new modal code. Title is tap-to-edit (text + pencil affordance flips to an input; Enter or blur commits, Escape reverts). Description is a textarea that commits on blur. Close `×` dismisses. Tap-outside dismisses. ESC dismisses. ALL dismiss paths leave `item.completed` unchanged. The modal has no Done button and no completion wiring — this is the structural guarantee that ideas can't get accidentally completed by dismissal.
    7. Save callbacks (`onSave`, `onTitleSave`) call `renderInbox()` to refresh the inbox view from the updated data. This re-runs `buildInboxRow` for every idea and reflects the edited title/description-presence immediately when the user closes the modal.
    8. Accessibility: row has `role="button"`, `tabindex="0"`, `aria-label` describing the action (e.g. `"Open idea: ${item.tit}"`). Enter and Space on focused row activate the tap (same as click). Focus-visible outline matches the surrounding app's focus treatment.
    9. **Non-regression — project page IDEAS view**: with the IDEAS filter active on the project page, all idea-status rows in `#mainList` continue to render and remain visible. The project-page `buildToDoRow` and its tap handler (`wireToDoRowClick`) are NOT modified. The project-page IDEAS view is unaffected by this entry.
    10. **Non-regression — completion data**: no code path introduced by this entry calls `listLogic.setToDoCompleted` or mutates `item.completed`. Pin via test: simulate row tap, modal open, modal close (every dismiss path) — assert `item.completed === false` throughout.
    11. **Non-regression — inbox empty state and cross-project aggregation**: with zero idea-status non-completed items across all projects, the inbox renders the empty-state message exactly as today. With ideas across multiple projects, all aggregate into the inbox view as today (no change to `getIdeaTodosAcrossProjects`).
    12. On the desktop layout (if the inbox renders there at all): same behavior. The change is layout-agnostic — `showDescEditorModal` already handles both surfaces.
  - Test-first regression set:
    1. Inbox row DOM structure (compact one-line): with a fixture inbox containing one idea, assert the rendered row has the chevron child, the title is single-line (CSS `white-space: nowrap` + `text-overflow: ellipsis`), the meta row contains the status label + project name.
    2. Row tap opens modal: simulating click on the row body (not on status label, not on check glyph) calls `showDescEditorModal`. Spy/mock on the imported `showDescEditorModal` to verify it was called with the correct `item` and options shape (`{ projectName, onSave, onTitleSave }`).
    3. Status-label tap does NOT open modal: simulating click on `.todoStatusLabel` does NOT call `showDescEditorModal` (the existing status popover behavior wins).
    4. Check glyph tap does NOT open modal: simulating click on `.inboxRowCheck` does NOT call `showDescEditorModal`.
    5. Chevron tap DOES open modal: simulating click on the chevron glyph DOES call `showDescEditorModal` (chevron is decorative, falls through to row handler).
    6. Save callback refreshes inbox: invoking the captured `onSave` or `onTitleSave` callback triggers a `renderInbox()` call. Spy on `renderInbox` to verify.
    7. **Completion non-regression**: no code path in this entry calls `listLogic.setToDoCompleted`. Pin via spy/mock on `setToDoCompleted` — assert it is NEVER called during any row tap, modal open, or modal close in the inbox test fixtures.
    8. **Project-page IDEAS non-regression**: keep the existing `applyTaskFilter` IDEAS-render test from `tests/taskFilter.test.js` (the one kept from the prior failed attempt). It pins "K idea entries under the IDEAS filter render exactly K cards". Must stay green.
    9. **Card-rendering function isolation**: source-pattern assertion — the function `buildToDoRow` is NOT modified by this entry. Grep `buildToDoRow` in source and confirm it's unchanged. The function `buildInboxRow` is modified. No new shared rendering function is introduced.
    10. Accessibility: row has `role="button"`, `tabindex="0"`, `aria-label`. Enter activates same as click.
  - Implementation notes:
    - **In `main.js`**, find `buildInboxRow` (around line 8038) and `renderInbox` (around line 8104). These are the only main.js functions this entry modifies.
    - **Update `buildInboxRow`** to construct the compact one-line layout:
      - Keep the existing `inboxRowCheck` and `inboxRowBody` structure.
      - Inside `inboxRowBody`: rebuild as a `column` flex with the title as ONE line and the meta row below. The title element gets `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` via CSS (added in style.css).
      - Append a chevron span after the body: `const chev = document.createElement('span'); chev.className = 'inboxRowChev'; chev.setAttribute('aria-hidden', 'true'); chev.textContent = '›'; row.appendChild(chev);`
      - Add row-level interactivity: `row.setAttribute('role', 'button'); row.setAttribute('tabindex', '0'); row.setAttribute('aria-label', 'Open idea: ' + (item.tit || ''));`
      - Add a click listener that bails on `.todoStatusLabel` and `.inboxRowCheck` and otherwise calls `showDescEditorModal(item, { projectName, onSave, onTitleSave })`. The bail-out pattern mirrors `wireToDoRowClick` in `toDoRow.js` exactly — copy the target-check idiom but only for the two relevant selectors.
      - Add a keydown listener that maps Enter and Space to the same click action.
    - **Import `showDescEditorModal` in main.js**: the existing import block from `./modals.js` (around line 60) currently imports `hasPendingUpdate` and `isAnyModalOrPopoverOpen`. Add `showDescEditorModal` to that import.
    - **In `onSave` and `onTitleSave` callbacks**: call `renderInbox()` to rebuild the view from updated data. The callbacks also need to call `listLogic.editToDoItem(projectName, item)` to route the persist through the Supabase mirror — match the pattern in `toDoRow.js`'s existing `showDescEditorModal` usage (line ~381) which does this already.
    - **In `style.css`**: add or update `.inboxRow` CSS for the compact layout. Add `.inboxRowChev`. Add `.inboxRow:focus-visible` outline. Do NOT modify any non-`.inboxRow*` selectors. Do NOT add or modify any `.todoRow*`, `.todayRow*`, or shared card selectors.
    - **Tests**: extend the existing inbox tests under `toDoList_main/tests/` (grep for inbox*.test.js to find them; likely `inboxIdeasView.test.js` or similar). Add the new assertions; do not delete existing assertions unless they pin behavior that's deliberately being changed (e.g. the old two-line layout assertion gets updated to compact one-line). Add a new test file if the test set grows large (e.g. `tests/inboxRowTap.test.js`).
    - **CRITICAL sanity check before committing**: grep `setToDoCompleted` across the diff — if any line in the diff added a call to `setToDoCompleted`, that's a bug. The entry should add ZERO calls to that function. Verify with a final grep on the patched files.
    - **CRITICAL second sanity check**: grep `buildToDoRow` across the diff — there should be ZERO matches in modified files (only references in unchanged code). If `buildToDoRow` appears in the diff, the entry has crossed into shared-render territory and must be rolled back.
  - Out of scope: any change to `buildToDoRow`, `wireToDoRowClick`, `toDoRow.js`, `taskFilter.js`, `applyTaskFilter`, `showDescEditorModal` itself (reused as-is, no modification), the description editor's title-edit or description-save behavior, the project-page IDEAS view, the project-page row tap handler, the inbox empty-state copy, `getIdeaTodosAcrossProjects`, the status-label popover, the `listLogic` data model, the chat pane, the TODO.md viewer, the calendar tab, the bottom tab bar; adding a "Done" labeled button to the modal (separate follow-up if wanted — would benefit both inbox and project-row contexts).
  - File: `toDoList_main/src/main.js` (buildInboxRow, renderInbox, import line for showDescEditorModal), `toDoList_main/src/style.css` (`.inboxRow*` selectors only), `toDoList_main/tests/` (extend existing inbox tests or add a new `inboxRowTap.test.js`)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: dea60389-89df-4e52-9bb9-f389708402a6 -->

- [x] **[MEDIUM]** Exclude completed items from filter pill counts and empty-state trigger in applyTaskFilter — Completed: 2026-06-07
  - Type: bug
  - Description: The task filter cycle pill ("ACTIVE 175", "IDEAS N", "ALL N") inflates its count by including items whose `__item.completed === true`. Visible symptom in the user-supplied screenshot: the ACTIVE pill reads "175" on a project where only ~5 active items are visible and 170 items are in the collapsed COMPLETED section (5 + 170 = 175 — the completed are being double-counted under their original status). Same root cause as the previously-diagnosed IDEAS count inflation: completed items retain their `status` field, so a `status === 'active'` item with `completed: true` still gets counted by `counts.active += 1` in the filter's iteration. Fix: in `applyTaskFilter`'s count loop, exclude rows where `__item.completed === true` from ALL count increments (`counts.all`, `counts.active`, `counts.ideas`, `total`, and `visible`). Leave the `setRowHidden(row, !show)` call unchanged — the visibility behavior is correct as-is; only the counting is wrong. Completed items remain in the DOM (under the collapsed COMPLETED section), keep their `taskFilterHidden` class set by filter-match logic, and the dedicated "COMPLETED (170)" indicator continues to show the completed count separately. Net effect: filter pills show the count of *non-completed* matching items, which matches what the user perceives.
  - Behavior:
    1. ACTIVE pill: shows the count of items with `(status === 'active' || status === 'in_progress')` AND `completed === false`. In the screenshot's project, this should drop from 175 to ~5.
    2. IDEAS pill: shows the count of items with `status === 'idea'` AND `completed === false`. Pre-fix (per the earlier diagnostic) this was 9; post-fix it should be the count of non-completed ideas.
    3. ALL pill: shows the count of all items with `completed === false`.
    4. The "COMPLETED (N)" indicator (the section header, owned by `updateCompletedSection` in `emptyState.js`) is UNCHANGED. It already counts completed items separately and that count is correct.
    5. Empty-state trigger (`updateFilterEmptyState`): if the active filter matches zero non-completed items but the project has completed items, the filter-empty-state message shows ("No active tasks" or whichever message — the existing copy is unchanged). The trigger condition `total > 0 && visible === 0` now operates on non-completed-only counts.
    6. `setRowHidden(row, !show)` is unchanged — completed items still get their `taskFilterHidden` class set based on filter-status match, the same as today. Their visibility under the COMPLETED collapse is governed by the `completedCollapsed` class on `#mainList` and the `.completed` class on the row (unchanged).
    7. Real-time count update: filter pill count recalculates on every `applyTaskFilter()` call, which already happens when tasks are added, completed, un-completed, status-changed, or filter changes. After a user un-completes a previously-completed item (e.g. via the checkbox or the row's status path), the count updates on the same render pass — no extra wiring needed.
    8. Cross-project behavior: per the existing scope of `applyTaskFilter` (operates on `#mainList`, current-project-only), no change. The inbox view aggregates across projects through a different path (`getIdeaTodosAcrossProjects`), unaffected by this entry.
  - Test-first regression set:
    1. With a fixture project containing 3 active-non-completed items and 5 active-but-completed items, `counts.active` after `applyTaskFilter` is 3 (not 8).
    2. With a fixture project containing 2 idea-non-completed items and 7 idea-but-completed items, `counts.ideas` is 2 (not 9).
    3. With a fixture project containing only completed items (0 non-completed), `total` is 0 and the filter empty-state message renders.
    4. The COMPLETED section header count (`updateCompletedSection`) is unchanged — assert it still shows the count of `.completed` rows.
    5. `setRowHidden` is called for every committed row (completed or not) and applies the same hide/show based on filter-status match as before this entry. Pin via spy.
    6. Real-time update: simulate un-completing one of the 5 completed-active items → `applyTaskFilter` re-runs → `counts.active` is now 4 (not 3).
    7. Filter switching is unaffected: cycle ALL → ACTIVE → IDEAS → ALL, each shows the correct non-completed count for its category.
    8. Source-pattern: the count loop in `applyTaskFilter` (taskFilter.js around line 156-168) contains an early-skip or guard for `row.__item.completed`. Pin via a grep-style assertion that the count-incrementing lines are gated on a not-completed check.
  - Implementation notes:
    - **Single-file change**: only `toDoList_main/src/taskFilter.js` and its test file. No other file is modified.
    - **The exact fix** in `applyTaskFilter` (around lines 156-168). Current code:
```js
      rows.forEach(function (row) {
          if (!isCommittedRow(row)) return;
          const status = rowStatus(row);
          total += 1;
          counts.all += 1;
          if (status === 'active' || status === 'in_progress') counts.active += 1;
          if (status === 'idea') counts.ideas += 1;
          const show = activeFilter.match(status);
          if (show) visible += 1;
          setRowHidden(row, !show);
      });
```
      Patched form:
```js
      rows.forEach(function (row) {
          if (!isCommittedRow(row)) return;
          const status = rowStatus(row);
          const isCompleted = !!(row.__item && row.__item.completed);
          if (!isCompleted) {
              total += 1;
              counts.all += 1;
              if (status === 'active' || status === 'in_progress') counts.active += 1;
              if (status === 'idea') counts.ideas += 1;
          }
          const show = activeFilter.match(status);
          if (show && !isCompleted) visible += 1;
          setRowHidden(row, !show);
      });
```
      Note the `setRowHidden(row, !show)` line is UNCHANGED — completed rows still get filter-match hiding applied, preserving behavior in the COMPLETED-section-expanded case (where a user expands completed and would expect filter-status to still partition visibility).
    - **Do NOT touch** `setRowHidden`, `updateCounts`, `updateFilterEmptyState`, `isCommittedRow`, `rowStatus`, `FILTERS`, the cycle-pill DOM construction, or `updateCompletedSection` in `emptyState.js`. The fix is purely inside the forEach body.
    - **Tests**: extend `toDoList_main/tests/taskFilter.test.js` (already exists from the earlier saga and was kept). Add the fixture-based count assertions from the regression set above.
    - **Sanity check before committing**: with a fresh test project containing exactly 3 non-completed active items + 5 completed active items, verify in jsdom that `counts.active === 3` and that `setRowHidden` was called 8 times (once per committed row). If `setRowHidden` is called fewer than 8 times, the patch accidentally added an early return for completed items — fix by restoring the `setRowHidden` call outside the completed-skip block.
  - Out of scope: any change to `setRowHidden` (visibility behavior is correct as-is); any change to the completed-section header count (already correct); any change to the empty-state copy or the conditions for showing the project empty-state (only the filter-empty-state's input counts change); any change to status-popover behavior; any change to `getIdeaTodosAcrossProjects` (the inbox aggregator already excludes completed); any change to `buildToDoRow`, `buildInboxRow`, or any rendering function; any change to CSS; any change to the COMPLETED section's collapse/expand behavior; the data model (completed items continue to retain their `status` field — this is by design so un-completing restores the original category).
  - File: `toDoList_main/src/taskFilter.js`, `toDoList_main/tests/taskFilter.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: a1062b59-6aaf-452c-a049-32bb8a26b66f -->

- [x] **[MEDIUM]** Auto-resort current project's row after status change in popover (when sort = Status) — Completed: 2026-06-07
  - Type: bug
  - Description: When the global task sort is set to "Status" on a project page, changing a todo's status via the status popover (e.g. Active → In Progress) does NOT move the row to its new sorted position. The row stays at its original index and the user has to manually toggle sort off and back to Status to trigger the re-sort. Root cause: the status popover commit handler in `todoStatus.js` (around line 145) calls `listLogic.setToDoStatus(projectName, item, status)` (persists the mutation), then `refreshTodoStatusUI(toDoChild, item)` (updates the status label visual), then `applyTaskFilter()` (re-runs filter counts + visibility), then `hideStatusPopover()` — but it never calls `reorderToDoDOM(projectName)`, which is the function that re-applies `renderOrderForSort(items)` to the DOM. So `sortItemsByStatusForRender` runs only on the next manual sort change or page reload, not after a status mutation. Fix: replace the `applyTaskFilter()` call in the popover handler with `reorderToDoDOM(projectName)`. `reorderToDoDOM` already calls `applyTaskFilter()` internally at line 1947 of `toDoRow.js`, so the filter pass still runs — we just additionally pick up the sort-order refresh. Net effect: a status change now re-sorts the row on commit, regardless of sort mode (sort='status' re-sorts by status, sort='due' re-applies due ordering, sort='none' is a no-op DOM-wise since `renderOrderForSort` returns items unchanged when mode='none').
  - Behavior:
    1. On the project page with sort = "Status" active: changing a row's status from Active → In Progress moves the row to the top of the active section immediately on commit (status sort order is in_progress → active → idea → completed, per `STATUS_SORT_RANK` in listLogic.js).
    2. On the project page with sort = "Status" active: changing a row's status from In Progress → Idea moves the row down past the active items into the idea group.
    3. On the project page with sort = "Due" active: changing a row's status does NOT change its position (due-date order is independent of status). The reorderToDoDOM call still runs and re-applies due ordering, which is a no-op for the position of the changed row since its due date didn't change.
    4. On the project page with sort = "None" active: changing a row's status does NOT change its position (manual order is preserved). `renderOrderForSort` returns items in their original array order, so `reorderToDoDOM` re-appends every row in the same order — visually a no-op.
    5. Filter pill counts and visibility still update on commit (they did before — `applyTaskFilter` is called by `reorderToDoDOM` internally).
    6. The status popover closes after commit (`hideStatusPopover()` still runs as the last step of the handler).
    7. The inbox view (`#inboxView`) is UNCHANGED by this entry. It already has its own re-render via `ensureInboxStatusRerender` (a capture-phase document listener at main.js:8082) that calls `renderInbox()` after a status-change commit — that path remains intact and unaffected.
    8. The status change still persists to localStorage and Supabase via the existing `setToDoStatus` path — no change to persistence.
  - Test-first regression set:
    1. Sort = "Status" + status change → row repositions. Fixture: project with one Active and one Idea item, sort='status'. Change Active → In Progress. Assert the changed row is now the first child of `#mainList` (after the blank placeholder if one exists).
    2. Sort = "Due" + status change → row position unchanged. Pin both that `reorderToDoDOM` was called AND that the changed row's index in `#mainList` is the same before and after.
    3. Sort = "None" + status change → row position unchanged. Same assertion structure as #2.
    4. Filter pill counts still update on status change. (Existing behavior preservation — `applyTaskFilter` continues to fire via `reorderToDoDOM`.) With a fixture of 2 active + 1 idea, change one active → idea, assert `counts.active === 1` and `counts.ideas === 2` afterward.
    5. Status popover closes after commit. Assert no `#statusPopover` (or whichever id the popover uses) exists in the DOM after the click.
    6. Persistence still fires. Spy on `listLogic.setToDoStatus` — assert it was called with the right args.
    7. Inbox view non-regression: with active view = 'inbox', a status change on an inbox row STILL triggers `renderInbox()` via the existing capture-phase listener. The `reorderToDoDOM` call also fires but is scoped to `#mainList` so it doesn't disturb `#inboxView`. Pin: after a status change in inbox view, `renderInbox` was called AND `#inboxView`'s child structure reflects the post-change idea list.
  - Implementation notes:
    - **Single-file change in `todoStatus.js`** plus an import addition.
    - **Add import** at the top of `todoStatus.js` (currently imports `listLogic` from `./listLogic.js` and `applyTaskFilter` from `./taskFilter.js`): add `import { reorderToDoDOM } from './toDoRow.js';`. The existing `applyTaskFilter` import becomes unused after this change — remove it from the import block to avoid dead code (the linter or test setup may flag it).
    - **The exact edit** in the popover click handler (around line 144-153 of todoStatus.js). Current code:
```js
      opt.addEventListener('click', function (event) {
          event.stopPropagation();
          listLogic.setToDoStatus(projectName, item, status);
          refreshTodoStatusUI(toDoChild, item);
          applyTaskFilter();
          hideStatusPopover();
      });
```
      Patched form:
```js
      opt.addEventListener('click', function (event) {
          event.stopPropagation();
          listLogic.setToDoStatus(projectName, item, status);
          refreshTodoStatusUI(toDoChild, item);
          reorderToDoDOM(projectName);
          hideStatusPopover();
      });
```
      The `reorderToDoDOM(projectName)` call replaces `applyTaskFilter()` because the former internally calls the latter (line 1947 of toDoRow.js). No need to call both.
    - **Do NOT** touch the inbox's `ensureInboxStatusRerender` path in main.js. The inbox re-render fires via a separate capture-phase document listener that runs BEFORE the bubble-phase popover click handler completes. Its scope is correct (only fires when `getActiveView() === 'inbox'`) and it's idempotent. Leaving it alone preserves the inbox behavior.
    - **Do NOT** add a reorder hook to any other status-change path. The popover is the ONLY user-facing entry point for status changes; the only other call sites for `setToDoStatus` are internal/test paths. If a future status change is wired up elsewhere, that wiring's author is responsible for calling `reorderToDoDOM` from its own commit path — same contract as other mutating handlers (the checkbox completion handlers in toDoRow.js already follow this pattern).
    - **Sanity check before committing**: grep `applyTaskFilter` in the diff. If the patched todoStatus.js still imports or calls `applyTaskFilter`, remove the import (it becomes dead after the substitution). Grep `reorderToDoDOM` in todoStatus.js — should be exactly two matches: the import line and the call site inside the popover handler.
  - Out of scope: any change to `setToDoStatus`, `reorderToDoDOM`, `sortItemsByStatusForRender`, `renderOrderForSort`, `applyTaskFilter`, or the sort dropdown UI; any change to the inbox status-change path; any change to the status popover's appearance, positioning, or non-commit behavior (ESC, tap-outside, hover); any change to the checkbox completion path (already correctly calls reorderToDoDOM); the data model; CSS; the COMPLETED section collapse; the filter pill counts (this entry just preserves their correctness via the internal applyTaskFilter call).
  - File: `toDoList_main/src/todoStatus.js`, `toDoList_main/tests/` (extend `todoStatus.test.js` if it exists, or add a small `todoStatusResortOnChange.test.js`)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: bbe4cc28-f6fb-408b-8d96-7bda7e248b56 -->

- [x] **[LOW]** Extend run-watch timeout from 10 minutes to 20 minutes so long pipeline runs don't dead-end at "Unknown" — Completed: 2026-06-07
  - Type: bug
  - Description: Pipeline runs that take longer than 10 minutes get labeled "Unknown" by both run-watch surfaces (the TODO.md viewer's inline Run-backlog pill, and the Runs tab inside the chat pane) even though the run is still progressing on GitHub. Root cause: the give-up timeout `RUN_GIVE_UP_MS = 10 * 60 * 1000` in both `claudeSheet.js:42` and `main.js:6732`. After this window expires without a terminal status, the client stops polling and the pill switches to the dimmed "Unknown" treatment (claudeSheet.js:1746, plus the equivalent path in main.js via `showRunTimeout()`). The 10-minute window is shorter than how long the pipeline agent can plausibly take on a complex entry: with `max_turns: 100` in `.github/workflows/claude-run.yml`, runs that involve multi-file diagnosis, test rounds, and PR creation routinely reach 12-15 minutes. Bump both constants to 20 minutes (`20 * 60 * 1000`). This is a single-value change in two files — both call sites use the same constant name and the same semantic ("give up polling, render Unknown after this window"), so they must move together to keep the two surfaces consistent. Genuinely hung runs (>20 min) will still surface as "Unknown" with the existing affordance to open GitHub Actions and check directly.
  - Behavior:
    1. A run that completes within 20 minutes of dispatch displays its actual terminal state (Success / Failure) on both surfaces — never falls back to "Unknown" prematurely.
    2. A run that exceeds 20 minutes without surfacing a terminal status still falls back to the dimmed "Unknown" pill, with the existing affordance to open the GitHub Actions run page intact.
    3. The viewer-side pill (main.js) and the Runs-tab pill (claudeSheet.js) behave identically with respect to timeout — they share the same 20-minute window. Don't bump one without the other.
    4. The poll interval (`RUN_POLL_INTERVAL_MS = 5000` in claudeSheet.js) is UNCHANGED. Only the total give-up window changes.
    5. Existing dismissible/tap-to-dismiss behavior on the "Unknown" pill is UNCHANGED.
    6. Any in-flight runs at the moment of deploy: they keep their existing watcher (the constant is captured per-run at startRunPill or equivalent, not read on every poll — but the value is also re-read inside pollRunOnce in main.js via the module-scoped const, so any poll after deploy uses the new value). Net: no migration concern; the bump just applies forward.
  - Test-first regression set:
    1. Source-pattern: both `claudeSheet.js` and `main.js` define `RUN_GIVE_UP_MS = 20 * 60 * 1000`. Pin via grep — exactly two occurrences in the source tree, both equal to `20 * 60 * 1000` (or `1200000`).
    2. The poll-interval constant `RUN_POLL_INTERVAL_MS` is unchanged. Pin via grep.
    3. Behavioral (claudeSheet.js): with a fixture run started at t=0 and a current time of t=19 min, the give-up branch does NOT fire and polling continues. At t=21 min, the give-up branch fires and the Unknown pill renders.
    4. Behavioral (main.js): same as #3 for the viewer-side pill.
    5. `showRunTimeout` itself is unchanged — same dimmed "Unknown" treatment with the existing link affordance.
  - Implementation notes:
    - **Two-file edit, both identical.** Change `const RUN_GIVE_UP_MS = 10 * 60 * 1000;` to `const RUN_GIVE_UP_MS = 20 * 60 * 1000;` in:
      - `toDoList_main/src/claudeSheet.js` (line 42)
      - `toDoList_main/src/main.js` (line 6732)
    - **Update the inline comment** at main.js around line 6851 from "stop watching after 10 minutes" to "stop watching after 20 minutes" so the comment stays accurate. If claudeSheet.js has a similar comment near its constant, update that too (grep its surroundings).
    - **Do NOT** consolidate the duplicated constant into a shared module as part of this entry. That refactor (extract `RUN_GIVE_UP_MS` into a shared `runWatch.js` or similar) would touch import graphs and risk scope drift on a one-line bug fix. If the duplication is worth eliminating, that's a separate small entry afterward — leave a TODO comment near both constants noting they must stay in sync if you want a future reminder, or skip that and just rely on the test #1 grep assertion to catch drift.
    - **Sanity check before committing**: grep for `10 * 60 * 1000` in the patched files — there should be zero matches. Grep for `20 * 60 * 1000` — there should be exactly two matches (one in each file).
  - Out of scope: extracting the constant into a shared module; changing the poll interval; changing the "Unknown" pill's visual treatment or messaging; adding a user-configurable timeout; changing the `max_turns` setting in the workflow; changing the give-up behavior itself (still dimmed Unknown pill with link to GitHub); changing how the run watcher hands off between mobile and desktop chat surfaces; the `RUNS_KEY` localStorage schema.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 789eee60-3efd-4480-bbb1-8850865162ea -->

- [x] **[LOW]** Raise companion ghost z-index above all other UI so it never wanders behind elements — Completed: 2026-06-07
  - Type: bug
  - Description: The wandering companion ghost mascot (`.companion` in style.css, position:fixed, animated via `companionIdle`/`companionCheer`/`companionBigCheer`) currently has `z-index: 2`, which is below virtually every other stacking layer in the app: `#desktopChatPane` (z-index 10), the desktop view sub-band (z-index 9), all modal backdrops (z-index 100), context menus (z-index 200-250), the status popover (z-index 1000), the mobile completed/viewer sheet backdrops (z-index 4000), and the top floating layer (z-index 10000). User-reported visible symptom: when the ghost wanders across the screen and its position overlaps `#claudeChatView` (or its surrounding chat-pane/sheet chrome), the ghost disappears behind that surface. The user wants the ghost on top of everything — a mascot is decorative and should be a consistent visual anchor regardless of what UI is open. Fix: raise `.companion`'s z-index above the existing top floating layer. Pick `z-index: 10001` — one above the highest current value (`10000` for the top-floating element at style.css line 3380), so the ghost sits on the topmost layer while preserving the existing relative order of everything else. The ghost is `pointer-events: none` already, so raising its stacking has no interaction-blocking risk — clicks pass through to whatever's beneath.
  - Behavior:
    1. `.companion` element renders ABOVE all other elements at all times during its wander, idle, and cheer animations. Specifically: above `#claudeChatView`, `#claudeSheet` (mobile slide-up), `#desktopChatPane`, all modals and their backdrops, the status popover, context menus, the top floating layer.
    2. The ghost remains `pointer-events: none` — clicks pass through to whatever is beneath. Modals and popovers stay fully interactive regardless of whether the ghost is visually overlapping them at the moment.
    3. No other element's z-index changes. The relative stacking of all other UI is preserved.
    4. The ghost's visual appearance (sprite, animations, blink behavior) is unchanged.
    5. When the companion is disabled (`body.companion-ghost-off` class is set), the ghost is hidden — that hide behavior is unchanged.
    6. The mobile-empty-state ghosts (separate `.viewGhostMascot` elements at lower z-indexes) are NOT touched. Those are different elements (decorative empty-state spacers) and don't have the wander/overlap issue.
  - Test-first regression set:
    1. Source-pattern: the `.companion` CSS rule has `z-index: 10001`. Pin via grep on the rule block.
    2. The `pointer-events: none` declaration on `.companion` is preserved (so clicks still pass through). Pin via grep.
    3. No other selector's z-index value changes. Diff style.css after the change — only the one line should differ.
    4. Behavioral (jsdom layout limitation may apply — fall back to computed-style assertion): `getComputedStyle(document.querySelector('.companion')).zIndex === '10001'`.
    5. `companion-ghost-off` hide behavior preserved: with `body.companion-ghost-off` set, the existing `display: none` (or whichever rule hides it) still applies. Pin via grep on the companion-off rule.
  - Implementation notes:
    - **Single-line change** in `toDoList_main/src/style.css` at the `.companion` rule (around line 7800-7812). Change `z-index: 2;` to `z-index: 10001;`. No other edits.
    - Do NOT modify any other selector. Do NOT consolidate z-index values into CSS variables as part of this entry (separate refactor, out of scope).
    - Do NOT touch `companion.js` — the bug is purely a CSS stacking issue; the JS positioning logic is correct.
    - **Sanity check before committing**: grep `z-index` in the diff. There should be exactly one line changed — the `.companion` rule's z-index value. If any other z-index line appears in the diff, revert it.
  - Out of scope: extracting z-index values into a layered CSS-variable system (e.g. `--z-companion`, `--z-modal`, etc.); changing other elements' z-indexes; changing the companion's pointer-events, position, or animation behavior; adding a user setting to control whether the ghost overlays modals (separate enhancement if ever wanted); the mobile-empty-state ghost mascots; the companion-disabled hide path; the music-visualizer ghost (`.musicVizGhost` is a separate element entirely).
  - File: `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 73937df2-9074-48e1-bd91-8d4f1d823f53 -->

- [x] **[MEDIUM]** Wire the ▾ expand toggle to actually fill the viewer body to the bottom of #mainList — Completed: 2026-06-07
  - Type: bug
  - Description: The TODO.md viewer's expand affordance (the `▾` chevron in `#todoMdViewerHeader`, which `applyCollapsedState` labels "Expand panel" / "Collapse panel" depending on state — referred to as the collapse button in the codebase but functionally serves as the expand toggle for end users) doesn't actually expand the viewer to fill the available room. When the user taps it from the collapsed state, the body is shown at its natural content height (with the default `max-height: 280px` from `.todoMdViewerBody` in style.css applying), leaving substantial blank space below the viewer card. User-supplied console probe confirms: in the post-tap state, card.bottom = 682, mainList.bottom = 1220 → 538px of unused space below the card. Root cause: the `applyCollapsedState` path toggles only the `collapsed` class on the card; it never adds the `todoMdViewerCard--expanded` class that `.todoMdViewerCard--expanded .todoMdViewerBody { max-height: none; }` keys off. The `applyExpandedHeight` function (main.js:7006) which computes the fill-to-bottom height is wired only to the window-resize handler — itself guarded by the `--expanded` class check — so it never fires from a user action. The `--expanded` class has no UI trigger remaining (was previously wired to `#todoMdViewerExpandBtn`, which a prior entry intentionally removed; the removal didn't migrate the fill-to-bottom semantic onto the surviving collapse button). Fix: in the collapse button's click handler, also toggle the `--expanded` class in sync with the un-collapsed state, then call `applyExpandedHeight()`. Three-line change. Net effect: tapping the expand chevron now fills the viewer body to the bottom of `#mainList` (minus the existing 16px `bottomGap`), and tapping again to collapse returns the body to its hidden state.
  - Behavior:
    1. From the collapsed state, tapping the `▾` chevron expands the viewer card: the body becomes visible AND fills to `mainList.bottom - 16px`. The card.bottom approaches the bottom of mainList, eliminating the previously-unused space.
    2. From the expanded state, tapping the chevron collapses the card: body hides AND the inline height is cleared (`body.style.height = ''`).
    3. The `applyExpandedHeight` calculation already handles the height clear correctly when `--expanded` is absent (existing guard at line 7007 sets `body.style.height = ''` and early-returns).
    4. Window resize while expanded continues to recompute body height via the existing resize listener (unchanged).
    5. The default un-expanded state (page load or project switch) is collapsed, matching today's behavior (`applyCollapsedState(true)` still runs at viewer construction).
    6. The chevron's aria-label and tooltip update as they do today: "Expand panel" when collapsed, "Collapse panel" when expanded. The labels match the new fill-to-bottom semantic naturally — "Expand" now actually expands.
    7. No persistence change in this entry. The expanded state does NOT survive a project switch or page reload. (Tying state to the orphan `viewerExpandedKey` localStorage path is a worthwhile follow-up but explicitly out of scope here.)
    8. **Mobile sheet caveat**: when the viewer card lives inside `#todoMdViewerMobileSheet` (the slide-up sheet on mobile), `applyExpandedHeight` computes against `#mainList` which is no longer the card's parent. The fix in this entry does not address that — if the user opens the viewer in the mobile sheet and taps expand, the body height calculation will use the wrong anchor. The mobile sheet has its own bounding container and would need its own anchor in the calc. For this entry, the mobile-sheet path is out of scope; it remains in whatever state it's in today (no behavioral regression from this entry — the calc was already mainList-anchored before).
  - Test-first regression set:
    1. Tap expand from collapsed state: assert `card.classList.contains('todoMdViewerCard--expanded') === true` AND `body.style.height` is non-empty (a px value).
    2. Tap collapse from expanded state: assert `card.classList.contains('todoMdViewerCard--expanded') === false` AND `body.style.height === ''`.
    3. The `collapsed` class still toggles correctly in sync (preserves existing show/hide-body behavior).
    4. With a fixture viewport of known size (e.g. innerHeight 1000) and a known mainList rect (e.g. mainList.bottom 900, header.bottom 200), after expanding the body's inline height equals `900 - 200 - 16 = 684px` (matching the existing `applyExpandedHeight` formula).
    5. Resize after expand triggers a new height computation via the existing window resize handler. Pin: dispatch a resize event while expanded → `body.style.height` updates.
    6. Default state on viewer construction: collapsed, body height empty, `--expanded` class absent.
    7. Non-regression: the `applyCollapsedState` aria-label/tooltip swap continues to work — when collapsed the button says "Expand panel," when expanded it says "Collapse panel."
    8. Non-regression: no other element's stacking, height, or visibility changes. Diff inspection — only `main.js`'s collapse-button click handler changes; no CSS edits.
  - Implementation notes:
    - **Single small edit in `main.js`** at the collapse button click handler (around line 7039-7041). Current code:
```js
      collapseBodyBtn.addEventListener('click', function() {
          applyCollapsedState(!card.classList.contains('collapsed'));
      });
```
      Patched form:
```js
      collapseBodyBtn.addEventListener('click', function() {
          const willBeCollapsed = !card.classList.contains('collapsed');
          applyCollapsedState(willBeCollapsed);
          // When uncollapsing, also fill the body to the bottom of #mainList
          // by applying the --expanded class that applyExpandedHeight keys off.
          // When collapsing, remove the class so applyExpandedHeight clears
          // the inline height.
          card.classList.toggle('todoMdViewerCard--expanded', !willBeCollapsed);
          applyExpandedHeight();
      });
```
    - `applyExpandedHeight` itself is UNCHANGED. Its existing guard handles both the apply path (when `--expanded` is present, compute and set body.style.height) and the clear path (when absent, set body.style.height = '').
    - The `applyCollapsedState` function is UNCHANGED. It continues to toggle the `collapsed` class and update the button's aria-label/tooltip.
    - The CSS rule at style.css:5143 (`.todoMdViewerCard--expanded .todoMdViewerBody { max-height: none; }`) is UNCHANGED — already correct, just needed the class to be applied.
    - Do NOT touch `viewerExpandedKey`, `getViewerExpandedPref`, or `setViewerExpandedPref` in this entry. Those are orphan persistence helpers; tying them in is a separate follow-up if you want state to survive project switches.
    - Do NOT touch `#todoMdViewerCollapseBtn`'s DOM construction, aria attributes outside what `applyCollapsedState` already does, or its position in the header. The element identity is preserved.
    - **Sanity check before committing**: grep `--expanded` in the diff. There should be exactly one new line — the `classList.toggle('todoMdViewerCard--expanded', ...)` call. If any CSS rule, other JS site, or any other reference appears in the diff, revert it.
  - Out of scope: tying the expanded state to localStorage persistence (the `viewerExpandedKey` machinery is orphan code; wiring it in is a worthwhile follow-up but separate); fixing the mobile-sheet expand path (`applyExpandedHeight` uses `#mainList` as anchor which is wrong when the card is hosted by `#todoMdViewerMobileSheet` — separate entry); changing the `▾` chevron glyph or position; changing the default collapsed state on viewer construction; changing `applyExpandedHeight`'s formula (the `mainListRect.bottom - headerRect.bottom - 16` calculation is preserved as-is); renaming the `collapsed` class or the `applyCollapsedState` function (it does what it does today, plus is now paired with the `--expanded` toggle); changing the default `max-height: 280px` on `.todoMdViewerBody` (only the expanded state lifts it via the existing `--expanded` rule).
  - File: `toDoList_main/src/main.js`, `toDoList_main/tests/` (extend any existing viewer expand/collapse test, or add `todoMdViewerExpandFill.test.js`)
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 27b6155a-58a8-476f-b051-80fc3debe824 -->

- [x] **[HIGH]** Fix hydrate re-inserting projects deleted on another device — Completed: 2026-06-08
  - Type: bug
  - Description: When a project is deleted on Device A while Device B is offline (or missed the realtime DELETE event), Device B's next hydrate resurrects the project locally AND re-INSERTs it back to Supabase, undoing the deletion across all devices. Root cause is the local-only push branch in `hydrateFromSupabase` (`listLogic.js`): a local entry whose id is absent from the server response is treated identically to a "created while offline" project — kept in the merged tree and pushed via `persistMutation({ op: 'insert', ... })`. The two cases are indistinguishable without a record of what the server previously acknowledged. Fix by snapshotting the set of server-known project ids at the end of every successful hydrate into a new `todoapp_lastSeenServerProjectIds` localStorage key (per the existing `todoapp_` prefix convention; stored as a JSON id array). On the next hydrate's local-only loop: if `local.id` is in the snapshot but absent from the current remote response → the server had this row and removed it; drop the entry from the merged tree, skip the INSERT, and cascade-drop its local todos to match the server's cascade. If `local.id` is NOT in the snapshot → genuinely new offline-created project; push as today. The snapshot must be rewritten at the very end of every successful hydrate (after the merge, before the `listLogicHydrated` dispatch) so subsequent runs have a fresh baseline. Add a behavioral regression test (mirroring `tests/listLogicRenameReconcile.test.js` in shape) that seeds a local project with id `proj-X`, seeds the snapshot to include `proj-X`, runs hydrate with a remote response that omits `proj-X`, and asserts (a) the project is gone from `listProjectsArray()`, (b) no `insert` call fires for projects, and (c) the snapshot after hydrate matches the new server set. Out of scope: the same bug shape for individual todos deleted across devices (separate follow-up entry); any server-side schema change (tombstones table, `deleted_at` column) — this fix is client-only.
  - File: `toDoList_main/src/listLogic.js`, `toDoList_main/tests/listLogicDeleteReconcile.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: e8fa0a67-4664-45eb-87d2-24e56b8e8527 -->

- [x] **[LOW]** Add green thunderbolt indicator to all project rows when inject is configured — Completed: 2026-06-08
  - Type: feature
  - Description: When the user has configured inject (a Worker URL is saved in localStorage under the inject config key written by the Configure Inject flow), prepend a green ⚡ Unicode character to every project row title in the sidebar. When no inject config is present, no icon appears and titles render as they do today. The icon must not intercept click/tap or long-press events on the row, must not break title text truncation, and must be hidden when a project title is in edit/rename mode. On config change (user saves or clears the inject URL), the indicators must update without requiring a page reload.
  - File: `toDoList_main/src/projectRow.js`, `toDoList_main/src/style.css`, `toDoList_main/src/inject.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: c597b03e-521f-4795-b828-033f8b405759 -->

- [x] **[HIGH]** Fix inject bolt showing on all project rows instead of only configured ones, and ensure it renders on desktop — Completed: 2026-06-08

  - Type: bug
  - Description: The ⚡︎ bolt indicator currently appears on every project row whenever inject is configured globally, but it should only appear on rows whose specific project has a configured inject target. The `sync()` function in `projectRow.js` must check per-project inject config (keyed by project id or name) rather than the global "is inject configured" flag. Separately, the bolt is not rendering on desktop — remove any mobile-only guard (media query or touch-device condition) that hides it; the bolt should be visible at all breakpoints. Keep the original orange unicode thunderbolt (⚡︎) styling as-is; do not change the glyph or its color treatment. Acceptance criteria: (1) a row shows the bolt only when that project has a configured inject target; (2) rows with no target show no bolt; (3) the bolt renders on both desktop and mobile; (4) existing `projectRowInjectIndicator` tests still pass and at least one new test covers the per-project filtering behavior.
  - File: `toDoList_main/src/projectRow.js`, `toDoList_main/src/inject.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 4e1cb527-5e61-4db1-8662-dacdbc064628 -->

- [x] **[HIGH]** Fix inject bolt visibility in project picker dropdown and change bolt color to amber accent — Completed: 2026-06-08

  - Type: bug
  - Description: The inject bolt (`projInjectBolt`) does not appear on project rows rendered inside `#projectPickerDropdown`, even when a project has a routed inject target. The `attachProjectInjectIndicator` wiring likely only runs for sidebar project rows and is not called for dropdown-rendered rows — or the CSS display rule for `.hasInjectBolt .projInjectBolt` is scoped to a sidebar container and does not apply inside the dropdown. Fix by ensuring `attachProjectInjectIndicator` (or equivalent `sync()` logic) runs for every project row regardless of mount point, and verify the CSS selector is not ancestor-scoped in a way that excludes the dropdown. Additionally, change the bolt icon color from green to the existing amber/orange accent token (approximately `#ffbd5e`) in `style.css`.
  - File: `toDoList_main/src/projectRow.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: e1baf03f-5f98-4047-95f4-f93f4242bcbd -->

- [x] **[HIGH]** Fix projectPickerRow bolt span being inserted into every row regardless of inject gate

  - Type: bug
  - Description: `syncProjectRowInjectBolt` inserts the `.projInjectBolt` span unconditionally into every dropdown row, then uses the `hasInjectBolt` class + CSS `display` to hide it on non-qualifying rows. The span is present in the DOM on all rows even when the project has no inject target configured. This causes a visible layout gap on at least one row where the hidden span contributes non-zero width. Fix: move the span insertion inside the gate check so the span is only appended to rows that actually qualify (same condition used to add `hasInjectBolt`); rows that don't qualify should have no `.projInjectBolt` span at all.
  - File: `toDoList_main/src/projectRow.js`, `toDoList_main/src/style.css`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 5d4d927a-2d3e-4a44-aa8c-63242529974b -->

- [x] **[MEDIUM]** Fix variable gap between bolt icon and project name in project picker dropdown

  - Type: bug
  - Description: In `.projectPickerRow.hasInjectBolt`, the `.projInjectBolt` span is a flex sibling of `.projectPickerName` and `.projectPickerCount`, so flex gap or space-between distribution creates visible space between the bolt and the name that varies as the active row's count badge changes width. The fix is to treat the bolt as a prefix to the name rather than a standalone flex child: wrap `.projInjectBolt` and `.projectPickerName` together (or use negative margin / zero gap on the bolt) so the bolt sits flush left of the name with a fixed, predictable offset regardless of count badge width. Change is CSS-only in `style.css` targeting `.projectPickerRow`, `.projInjectBolt`, and `.projectPickerName`.
  - File: `toDoList_main/src/style.css`
  - Completed: 2026-06-08
  <!-- id: 5726f2cf-2069-47e0-a22a-6ac50bd4fab3 -->

- [x] **[MEDIUM]** Collapse webpack to a single entry to stop main.js double-evaluation — Completed: 2026-06-08
  - Type: bug
  - Description: `webpack.config.js` declares four entry points (`index`, `main`, `toDo`, `list`), but `index.js` already imports `main.js` and `listLogic.js` (and `toDo.js` transitively), so those three are redundant. Because `HtmlWebpackPlugin` injects every entry bundle into the page, `main.js`'s module-level code is evaluated twice — once inside `index.bundle.js` and once inside `main.bundle.js` — which is the real source of the duplicate `addEventListener` registrations that the `window.__*Registered` guards currently suppress. Fix it by reducing the webpack `entry` to `{ index: './src/index.js' }` only, so a single app bundle is emitted and module code runs exactly once. This is an intentional, task-required change to `webpack.config.js`; note that in the PR so the CLAUDE.md build-config review doesn't bounce it (the rule's carve-out is explicit build changes).
  - Acceptance criteria:
    - `npm run build` succeeds and emits a single app bundle (`index.<contenthash>.bundle.js`) with no `main`/`toDo`/`list` bundles in `dist/`.
    - The app boots and renders exactly once; the document-level listeners that were previously double-registered now fire a single time, and behavior is unchanged (the guards still hold either way).
    - The full Vitest suite (`npm run test:run`) stays green.
  - Implementation notes: Nothing hardcodes the individual bundle filenames — verified `template.html` and `sw.js` — and Workbox `InjectManifest` globs `dist/` output, so dropping the extra entries is contained. Vitest runs against source modules in jsdom, not the bundle, so the suite will NOT catch a bundling regression; verify single-evaluation manually in the browser (or dev server) before merging. For that reason this is best applied as a direct commit to main with a local build/boot check rather than an unattended pipeline auto-merge.
  - Out of scope: Removing the six `window.__*Registered` guards (that's the A2 follow-up, done only after this confirms single-evaluation); any `optimization.splitChunks` / `runtimeChunk` / code-splitting or production-mode tuning; any change to application behavior, listeners, or DOM.
  - File: `toDoList_main/webpack.config.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: d6269be6-5f4d-456c-b9ec-bbe95c2565c4 -->

- [x] **[LOW]** Remove obsolete double-evaluation listener guards from main.js — Completed: 2026-06-08
  - Type: bug
  - Description: With the webpack entry collapsed to a single bundle (prior task), `main.js`'s module-level code now evaluates exactly once, so the six `window.__*Registered` guards that existed only to prevent duplicate `addEventListener` registration under double-evaluation are now dead weight. Remove them: `__hydrateListenerRegistered`, `__dueDateChangedListenerRegistered`, `__swipeCompleteFlashListenerRegistered`, `__todoMdViewerListenerRegistered`, `__completedMobileSheetListenersRegistered`, and `__viewerMobileSheetListenersRegistered` (around lines 6135 / 6169 / 6210 / 7148 / 7508 / 7668 — they may have shifted slightly). For each block, drop only the `&& !window.__XRegistered` condition and the `window.__XRegistered = true;` assignment, leaving the `document.addEventListener(...)` call and any `typeof document`/`typeof window` environment guard intact — do not delete the listener itself.
  - Acceptance criteria:
    - `grep "window.__" src/main.js` returns no `*Registered` flags.
    - Each affected document listener still registers exactly once at module load; app behavior is unchanged.
    - The full Vitest suite (`npm run test:run`) stays green, including `tests/todoMdViewer.test.js` and `tests/todoMdViewerShowCompleted.test.js` (the only two suites that import `main.js`).
  - Implementation notes: Safe in the browser because the single-entry collapse means one module evaluation. Safe in tests too — `main.js` is imported only by the two `todoMdViewer` suites, each under Vitest's default per-file isolation (one evaluation), and the only `vi.resetModules()` + re-import pattern in the suite targets `listLogic.js`, not `main.js`. `main.js` is over 25k tokens — find the six blocks with grep + offset/limit rather than reading it in full.
  - Out of scope: Any change to the listeners' handlers or behavior; removing the `typeof document`/`typeof window` environment guards (a separate concern); the Phase B feature extractions (calendar / today / inbox / TODO.md viewer / mobile sheets).
  - File: `toDoList_main/src/main.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: c9477cf0-a99e-45c3-b020-eb52e10f5842 -->

- [x] **[MEDIUM]** Extract the Calendar view into its own calendarView.js module — Completed: 2026-06-08
  - Type: feature
  - Description: Move the entire Calendar subsystem out of `main.js` into a new `toDoList_main/src/calendarView.js`, with no behavior change. The unit to move is cohesive: the module-scope state (`calendarVisibleYear`, `calendarVisibleMonth`, `calendarSelectedKey`), the constants (`CALENDAR_MONTH_NAMES`, `CALENDAR_WEEKDAY_NAMES`), the helpers (`formatCalendarKeyForDate`, `parseCalendarKey`), the state mutators (`resetCalendarStateToToday`, `shiftCalendarMonth`), the renderers (`renderCalendarView`, `renderCalendarDayPanel`), AND the day-panel row builders `buildTodayRow`, `handleTodayCheckboxToggle`, and `jumpToProjectTodo` — despite the "Today" naming there is no Today view, and those three are reachable only from `renderCalendarDayPanel`, so they belong with the calendar. The renderers already fetch their DOM nodes via `document.getElementById` at call time (no closure capture from `component()`), so no DOM needs to be threaded in.
  - Imports the new module needs: `{ listLogic } from './listLogic.js'`; `{ updateDuePillLabel, applyDueUrgency } from './dueDate.js'`; `{ prefersReducedMotion } from './dragDrop.js'` (the exported copy).
  - Breaking the one back-edge: `jumpToProjectTodo` calls `applyActiveView`, which stays in `main.js` and itself calls `renderCalendarView` — importing `applyActiveView` back into the calendar module would create a circular import. Instead, inject it: `calendarView.js` exports an `initCalendarView({ applyActiveView })` that stashes the callback for `jumpToProjectTodo`, and `main.js` calls `initCalendarView({ applyActiveView })` once at module load after the import.
  - Export surface (what `main.js` imports): `renderCalendarView`, `resetCalendarStateToToday`, `shiftCalendarMonth`, `formatCalendarKeyForDate`, a new `getCalendarSelectedKey()` accessor, and `initCalendarView`. Keep `renderCalendarDayPanel`, `parseCalendarKey`, and the three row builders module-private.
  - main.js call-site rewrites: the prev/next-month handlers keep calling `shiftCalendarMonth` (now imported); the switcher's calendar branch keeps calling `resetCalendarStateToToday` + `renderCalendarView` (now imported); and the Calendar arrow-key re-focus block that currently reads the module-local `calendarSelectedKey` directly must read it through `getCalendarSelectedKey()` (it also calls `formatCalendarKeyForDate`, now imported).
  - Test update: `tests/calendarKeyboardNav.test.js` reads `main.js` as text (`readFileSync`) and locates `function renderCalendarView` by string search — repoint that read to `../src/calendarView.js` and update the "not found in main.js" message. The assertion logic is unchanged since `renderCalendarView` stays a `function` declaration. The other three calendar tests read only `style.css` and need no change.
  - Acceptance criteria:
    - `main.js` no longer defines any of the moved symbols; `calendarView.js` exports the surface above; no circular import between the two.
    - Full Vitest suite (`npm run test:run`) green, including the repointed `calendarKeyboardNav.test.js`.
    - Switching to Calendar, paging months, selecting a day, and toggling a day-panel checkbox (including a recurring item) behave exactly as before; jump-to-project from a day-panel row still switches to Projects and scrolls to the row.
  - Out of scope: Any behavior or styling change; extracting the Inbox view (`renderInbox`/`buildInboxRow` — separate follow-up); moving `applyActiveView` out of `main.js`; the shared due-pill-builder TODO noted above `buildTodayRow`.
  - Implementation notes: `main.js` is over 25k tokens — locate the blocks with grep + offset/limit (calendar cluster roughly lines 8298–8634, prev/next handlers ~3746/3749, arrow-key read ~5244), never read it in full. Move additively: create `calendarView.js`, wire the imports + `initCalendarView`, confirm the suite is green, then delete the originals from `main.js`.
  - File: `toDoList_main/src/calendarView.js`, `toDoList_main/src/main.js`, `toDoList_main/tests/calendarKeyboardNav.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 31ea6f44-9e98-4b3c-a173-6957f542111f -->

- [x] **[MEDIUM]** Extract the Inbox view into its own inboxView.js module — Completed: 2026-06-08
  - Type: feature
  - Description: Move the Inbox subsystem out of `main.js` into a new `toDoList_main/src/inboxView.js`, with no behavior change. The unit is `buildInboxRow`, the `_inboxStatusRerenderWired` flag + `ensureInboxStatusRerender`, and `renderInbox` (roughly lines 8057–8210). All three reach DOM via `document.getElementById`/`createElement` at call time (no `component()` closure capture), and the cluster never calls `applyActiveView`, so there is no back-edge into `main.js` and no injection or accessor is needed — unlike the calendar extraction. Keep the `_inboxStatusRerenderWired` guard: it's legitimate idempotency for a function called on every `renderInbox`, not a double-evaluation artifact.
  - Imports the new module needs: `{ listLogic } from './listLogic.js'`; `{ getActiveView } from './prefs.js'`; `{ buildStatusLabel, wireStatusLabelDelegation } from './todoStatus.js'`; `{ showDescEditorModal } from './modals.js'` (where it's defined).
  - Export surface: only `renderInbox`. `buildInboxRow` and `ensureInboxStatusRerender` are reachable only from inside the cluster, so keep them module-private.
  - main.js change: remove the three definitions, import `renderInbox`, and leave the switcher's inbox branch (`applyActiveView`, ~line 8271) calling `renderInbox` — now resolved to the import. No other call sites exist.
  - Test updates: `tests/inboxIdeasView.test.js` and `tests/inboxRowTap.test.js` both read source as text (`readFileSync` / an `extractFn` helper) to assert against `renderInbox` and `buildInboxRow` — repoint their source read from `main.js` to `../src/inboxView.js` (and update the `(main.js)` describe label in `inboxIdeasView`). `tests/inboxIdeasQuery.test.js` only tests `listLogic.getIdeaTodosAcrossProjects` and needs no change; `tests/inboxViewRename.test.js` asserts the inbox-pill click routes through `applyActiveView('inbox')` — that wiring stays in `main.js`, so it's unaffected.
  - Acceptance criteria:
    - `main.js` no longer defines `buildInboxRow`, `ensureInboxStatusRerender`, `_inboxStatusRerenderWired`, or `renderInbox`; `inboxView.js` exports `renderInbox`; no circular import.
    - Full Vitest suite (`npm run test:run`) green, including the two repointed inbox tests.
    - Switching to Inbox lists cross-project ideas newest-first, the empty state shows when there are none, tapping a row opens the description editor (saving persists via `listLogic.editToDoItem` and re-renders), and promoting an idea out of `idea` status while on Inbox drops it from the list on the next tick.
  - Out of scope: Any behavior or styling change; touching the status popover (`todoStatus.js`) or the editor modal (`modals.js`); moving `applyActiveView`; the per-project row code in `main.js`/`toDoRow.js`.
  - Implementation notes: `main.js` is over 25k tokens — grep for the cluster (around lines 8057–8210) with offset/limit, don't read it in full. Move additively: create `inboxView.js`, wire the imports, confirm the suite is green, then delete the originals from `main.js`.
  - File: `toDoList_main/src/inboxView.js`, `toDoList_main/src/main.js`, `toDoList_main/tests/inboxIdeasView.test.js`, `toDoList_main/tests/inboxRowTap.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 86977b6a-2de9-4583-8951-9420471bf5de -->

- [x] **[MEDIUM]** Extract the TODO.md viewer into its own todoMdViewer.js module — Completed: 2026-06-09
  - Type: feature
  - Description: Move the TODO.md viewer subsystem out of `main.js` into a new `toDoList_main/src/todoMdViewer.js`, with no behavior change. This is the largest tail extraction (~900 lines) and the bulk is the ~580-line `buildTodoMdViewerCard` — move it verbatim, do not rewrite it. The unit is the contiguous block roughly at lines 6237–7160: the viewer state/constants (`VIEWER_LASTFETCH_PREFIX`, `VIEWER_EXPANDED_PREFIX`, `ACTIVE_RUN_KEY`, `viewerActiveTab`, `viewerActiveProject`, `viewerResizeHandler`, `viewerRunPollInterval`), the key/storage helpers (`viewerLastFetchKey`, `viewerExpandedKey`, `readViewerLastFetch`, `writeViewerLastFetch`, `readViewerExpanded`, `writeViewerExpanded`), the active-run helpers (`readActiveRun`, `writeActiveRun`, `clearActiveRun`), the lifecycle helpers (`detachViewerResizeHandler`, `stopViewerRunPoll`), `formatViewerSyncedAgo`, `TODO_MD_ID_MARKER_RE`, the four currently-exported pure functions (`parseTodoMdChecklist`, `filterCompletedTokens`, `countCompletedTodoMdEntries`, `buildViewerRenderedBody`), `RUN_ENTRY_PLAY_GLYPH`, `buildViewerRawBody`, `placeViewerCard`, `buildTodoMdViewerCard`, `activeProjectNameForViewer`, `updateTodoMdViewerCard`, AND the module-level `document.addEventListener('mainListRendered', …)` block at the end of that range. Everything reaches DOM via `getElementById` at call time (no `component()` closure capture), and nothing calls `applyActiveView` or any `main.js` function, so there is no back-edge — no injection or accessor needed.
  - Trigger stays event-based: the `mainListRendered` listener moves with the cluster and re-arms when the module is first imported; the `document.dispatchEvent(…'mainListRendered'…)` that fires it lives in the main-list render path in `main.js` and stays there. For the listener to arm, `main.js` must import from the new module — it will, via `placeViewerCard`. (If a later step removes that import, add an explicit side-effect import of `./todoMdViewer.js`.)
  - Imports the new module needs: `{ listLogic } from './listLogic.js'` (only `getProjectTargetId` is used) and `{ readTodoMdFromWorker } from './inject.js'` (the viewer's Worker fetch). No sanitizer/markdown lib is used in this range, so nothing else carries over.
  - Export surface: `placeViewerCard` (called by the viewer mobile sheet still in `main.js`, ~line 7656 — that call becomes an import), plus keep the four pure functions exported because `tests/todoMdViewer.test.js` and `tests/todoMdViewerShowCompleted.test.js` import them. Everything else stays module-private.
  - main.js changes: remove the moved block; import `placeViewerCard`; the viewer mobile sheet's `placeViewerCard(...)` call now resolves to the import; keep the `mainListRendered` dispatch as-is. No direct viewer-render calls exist in `component()` to rewire.
  - Test updates: in `tests/todoMdViewer.test.js` repoint `import { parseTodoMdChecklist } from '../src/main.js'` → `'../src/todoMdViewer.js'`; in `tests/todoMdViewerShowCompleted.test.js` repoint the four-symbol import → `'../src/todoMdViewer.js'`. Both also text-read `main.js` (`readFileSync`) for viewer-proper assertions — repoint those specific reads to `todoMdViewer.js`, but leave their reads of `inject.js`/`emptyState.js`/`prefs.js`/`style.css` untouched. `tests/mobileTodoMdViewerActionRow.test.js` reads only `style.css` (no change). `tests/mobileTodoMdViewerBottomSheet.test.js` and `tests/injectToTodoMd.test.js` text-read `main.js` for the mobile sheet / inject button (both stay) — likely no change, but run them and repoint only a read that searches for a moved viewer-proper symbol.
  - Acceptance criteria:
    - `main.js` no longer defines any of the moved symbols; `todoMdViewer.js` exports `placeViewerCard` + the four pure functions; no circular import; the `mainListRendered` listener still arms (the viewer card appears/updates on the projects view).
    - Full Vitest suite (`npm run test:run`) green, including the two repointed viewer tests.
    - On the projects view the TODO.md viewer card renders, the Rendered/Raw tabs switch, the Worker sync populates the card and shows the synced-ago label, entry expand/collapse works, and the active-run status pill still polls and clears — all exactly as before.
  - Out of scope: Any behavior or styling change; the `expandAllDescriptions`/`collapseAllDescriptions`/`wireExclusiveCompletedDescCollapse` block (serves the projects view, stays); the completed + viewer mobile sheets (later step); `inject.js`/Worker internals; the per-entry "Run this entry" control (the active-run machinery moves verbatim — no new feature here).
  - Implementation notes: `main.js` is over 25k tokens — grep for the cluster (≈6237–7160) with offset/limit, never read it in full, and move `buildTodoMdViewerCard` as a single verbatim block rather than reconstructing it. Move additively: create `todoMdViewer.js`, wire the two imports + `placeViewerCard` export, confirm the suite is green, then delete the originals.
  - File: `toDoList_main/src/todoMdViewer.js`, `toDoList_main/src/main.js`, `toDoList_main/tests/todoMdViewer.test.js`, `toDoList_main/tests/todoMdViewerShowCompleted.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 06cefc3e-c7a3-42a3-bb95-5bc53280394e -->

- [x] **[MEDIUM]** Extract the completed + viewer mobile sheets into a mobileSheets.js module — Completed: 2026-06-09
  - Type: feature
  - Description: Move both mobile bottom-sheet subsystems out of `main.js` into a new `toDoList_main/src/mobileSheets.js`, with no behavior change. The unit is the contiguous block ≈6337–6740: the completed sheet (`completedMobileSheetState`, `collectCompletedNodesForSheet`, `refreshCompletedMobileSheetContent`, `attachCompletedSheetSwipeDown`, `openCompletedMobileSheet`, `closeCompletedMobileSheet` + its module-level resize-auto-close listener) and the viewer sheet (`viewerMobileSheetState`, `refreshViewerMobileSheetContent`, `openViewerMobileSheet`, `closeViewerMobileSheet` + its resize listener). They share `attachCompletedSheetSwipeDown` (the viewer sheet calls it too), so they belong in one module. Everything reaches DOM via `getElementById`/`createElement` at call time (no `component()` closure capture), and — verified — the sheets call no `main.js` function, so there is NO back-edge and NO injection needed (unlike the viewer/calendar). The `onKeydown` each open-function defines is a local const, not the unrelated `main.js` `onKeydown` at ~line 4538.
  - Shared viewport check → its own tiny module: `isMobileViewport` (≈line 6333) is used both inside the sheets and by code that stays in `main.js` (the completed-section expand/collapse at ~6306/6309 and the viewer tap handler at ~6749). To give it one home both can import without a cycle, move it verbatim into a new `toDoList_main/src/viewport.js` and export it; `mobileSheets.js` and `main.js` both import `isMobileViewport` from `./viewport.js`. Keep the `< 1024` comparison exactly as-is (it's the invariant that keeps jsdom's 1024px default in desktop mode for tests).
  - Imports `mobileSheets.js` needs: `{ placeViewerCard } from './todoMdViewer.js'` (the viewer sheet's `closeViewerMobileSheet` calls it to restore the card to `#mainList`) and `{ isMobileViewport } from './viewport.js'`. No `listLogic` or other deps in this range.
  - Export surface: `openCompletedMobileSheet` (called by the expand/collapse code at ~6309), `openViewerMobileSheet` (called by the tap handler), and a new `isAnyMobileSheetOpen()` returning `!!(viewerMobileSheetState?.open || completedMobileSheetState?.open)` — the tap handler currently reads both `.open` flags directly (~6753–6754). Keep `closeCompletedMobileSheet`, `closeViewerMobileSheet`, `attachCompletedSheetSwipeDown`, `collectCompletedNodesForSheet`, and the refresh helpers module-private (no external callers).
  - main.js changes: remove both clusters and `isMobileViewport`; import `isMobileViewport` from `./viewport.js` and `{ openCompletedMobileSheet, openViewerMobileSheet, isAnyMobileSheetOpen } from './mobileSheets.js'`; in the `setViewerCardTapHandler(...)` body replace the two `…MobileSheetState.open` checks with a single `if (isAnyMobileSheetOpen()) return;` and leave the `openViewerMobileSheet(card)` call (now imported); the expand/collapse code keeps calling `openCompletedMobileSheet` (now imported). The `mainListRendered` listeners that stay in `main.js` are unrelated and untouched.
  - Test updates: five suites text-read `main.js` for sheet code — `bottomSheetSwipeDownContainer`, `bottomSheetSwipeUp`, `mobileCompletedBottomSheet`, `mobileTodoMdViewerBottomSheet`, `stackBottomSheet`. Repoint each one's `main.js` source-read to `../src/mobileSheets.js`, but leave their reads of `style.css`/`modals.js`/`todoMdViewer.js` untouched. `claudeSheet.test.js`/`claudeSheetMic.test.js` are about `claudeSheet.js` and need no change. If any test reads `main.js` for the `isMobileViewport` `< 1024` check, repoint that read to `viewport.js`.
  - Acceptance criteria:
    - `main.js` no longer defines the sheet symbols or `isMobileViewport`; `viewport.js` exports `isMobileViewport`; `mobileSheets.js` exports `openCompletedMobileSheet`, `openViewerMobileSheet`, `isAnyMobileSheetOpen`; no circular import.
    - Full Vitest suite (`npm run test:run`) green, including the five repointed sheet suites.
    - On a mobile viewport: tapping the completed-section control opens the completed sheet with the right row count, tapping the viewer card opens the viewer sheet, both close via close button / backdrop / swipe-down, both auto-close when the viewport grows past mobile, and the tap handler still bails when a sheet is already open — all exactly as before.
  - Out of scope: Any behavior or styling change (including the known `applyExpandedHeight` anchor bug — move it as-is); the `expandAllDescriptions`/`collapseAllDescriptions`/`wireExclusiveCompletedDescCollapse` block that triggers the completed sheet (stays in `main.js`); the `claudeSheet.js` AI sheet; `todoMdViewer.js` internals.
  - Implementation notes: `main.js` is over 25k tokens — grep for the clusters (≈6333–6740) with offset/limit, never read it in full. Create `viewport.js` first, then `mobileSheets.js` importing from it; move additively (wire imports + the `isAnyMobileSheetOpen` accessor + the tap-handler rewrite, confirm the suite is green) then delete the originals.
  - File: `toDoList_main/src/viewport.js`, `toDoList_main/src/mobileSheets.js`, `toDoList_main/src/main.js`, `toDoList_main/tests/bottomSheetSwipeDownContainer.test.js`, `toDoList_main/tests/bottomSheetSwipeUp.test.js`, `toDoList_main/tests/mobileCompletedBottomSheet.test.js`, `toDoList_main/tests/mobileTodoMdViewerBottomSheet.test.js`, `toDoList_main/tests/stackBottomSheet.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 68eacd66-79da-4cbe-95bf-31f076670211 -->
