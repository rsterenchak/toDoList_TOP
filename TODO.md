# TODO LIST

- [ ] **[LOW]** Make the reload nudge actually disappear when hidden, and never linger on fresh load
  - Type: bug
  - Description: Two small leftover seams in the reload nudge's lifecycle, both confirmed by console diagnostics: (1) When `renderUpdateNudge()` sets `nudge.hidden = true` on the `#claudeUpdateNudge` element, the element stays visible on screen because the `.claudeUpdateNudge` CSS rule's `display` property overrides the HTML `hidden` attribute. Fix in `style.css`: add `.claudeUpdateNudge[hidden] { display: none; }` (or equivalent — make `hidden` win over the styled `display`) so hiding actually hides. (2) On sheet mount, even after a fresh load with no waiting service worker, the nudge can still appear because `updatePending` was persisted-or-default-true somewhere and the mount-time guard didn't catch it. Harden `claudeSheet.js`'s mount: after seeding `updatePending = hasPendingUpdate()`, if `updatePending` is false also force-call `renderUpdateNudge()` so the nudge starts hidden on any load where no worker is waiting — the nudge should ONLY appear in response to a real `appUpdateAvailable` event after mount, never as leftover state. Net: the nudge is invisible by default, appears only when a worker is genuinely waiting, and actually disappears the moment the flag clears.
  - File: `toDoList_main/src/claudeSheet.js`, `toDoList_main/src/style.css`, `toDoList_main/tests/claudeSheet.test.js`
  - Completed: YYYY-MM-DD (PR #<number>)
  <!-- id: 3f4e47de-5d58-4df5-b131-b2e18a8d92ee -->
