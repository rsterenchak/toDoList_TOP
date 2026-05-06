# TODO List

## Bugs

- [x] **[LOW]** Replace pixel-art Pomodoro icon with stroke-based stopwatch
  - Description: Swap the existing pixel-art clock SVG inside `pomodoroToggle.innerHTML` for a stroke-based stopwatch — crown bar + stem on top, side stem button on the upper right, circular dial, single hand. The new design uses a 24×24 viewBox (was 14×14) so the hand's rotation pivot moves from (7, 7) to (12, 14); `syncPomodoroIcon`'s rotate string and the `.clockIconHand` `transform-origin` in `style.css` must move in lockstep with the SVG or the sweep will be off-center. The `.clockIconBody`, `.clockIconFace`, and `.clockIconPivot` classes become vestigial once the new SVG is flat-stroked rather than grouped — remove them in the same commit so the cleanup doesn't drift into a follow-up.
  - File: `toDoList_main/src/main.js`, `toDoList_main/src/style.css`
  - Completed: 2026-05-06

## Features

- [x] **[MEDIUM]** Add SomaFM music player with visualizer button to navbar
  - Description: Add a focus-music player to the navbar's right cluster, sitting between `#pomodoroToggle` and `#settingsToggle`. The trigger is a 36×36 button whose icon is a 5-bar equalizer that animates while playing and settles flat when paused or idle — same visual vocabulary as the Pomodoro clock's progress sweep, but the icon itself is the state indicator rather than a hand. Click opens an anchored popover with a station picker (5–6 SomaFM stations), a play/pause primary button, and a volume slider. Audio streams via a single hidden `<audio>` element pointed at SomaFM's direct MP3 URLs (e.g. `https://somafm.com/groovesalad.pls`) — no API key, no new dependencies. Persist last-station and volume in localStorage; do not auto-resume on page load (mobile autoplay restrictions block it and unexpected audio is hostile). Pause the audio element when the Pomodoro `pomodoro-alert` body class lands so the chime isn't drowned out, and resume on acknowledgment if the user was playing before. Network-required and offline-fail are accepted compromises.
    - Behavior:
      1. Button visualizer bars animate via CSS-only `@keyframes` (scaleY pulse, staggered delays) while `data-music-status="PLAYING"`; flatten to a static 30% height when `IDLE` or `PAUSED`. `prefers-reduced-motion` flattens the bars to a single static shape (no animation).
      2. While playing, the button picks up the accent color treatment used by `#pomodoroToggle[data-pomo-status="RUNNING"]` (accent border + accent fill text) so the right-cluster buttons read as kin.
      3. Click toggles the popover open/closed. Popover dismisses on outside click, Escape, button re-click, viewport resize, and scroll — mirror the existing `hidePomodoroPopover` plumbing.
      4. Station list is a vertical list of buttons; the active station gets an accent-tinted row (mirror `.pomodoroTab.active`). Genre tag right-aligned in muted SpaceMono uppercase, matching the pomodoro popover's typographic treatment.
      5. Play/pause primary button uses the same `.pomodoroPrimaryBtn` styling. Volume slider is a native `<input type="range">` with a numeric readout (0–100).
      6. Selecting a station while paused stages it but doesn't auto-play; selecting a station while playing performs a seamless swap (set `audio.src`, `audio.play()`).
      7. Pomodoro coordination: subscribe to the pomodoro controller via `ensurePomodoro().subscribe(...)`. When `status` transitions to `COMPLETE_UNACKED`, capture `wasPlaying` and pause the audio element; on transition out of `COMPLETE_UNACKED` (acknowledge / reset / mode change / start), resume only if `wasPlaying` was true.
    - Implementation notes:
      - New module `toDoList_main/src/music.js` mirrors `pomodoro.js`'s shape: `createMusic(doc)` factory returning a controller (`play`, `pause`, `setStation`, `setVolume`, `subscribe`, `getState`, `destroy`), plus module-level `ensureMusic()` / `destroyMusic()` singleton accessors. State machine: `IDLE → PLAYING → PAUSED → PLAYING → IDLE`. Station list is a hardcoded constant in the module (no fetch, no API): Groove Salad, Drone Zone, Space Station Soma, DEF CON Radio, Lush, Deep Space One — exact list to be confirmed but format is `[{ id, name, genre, streamUrl }]`.
      - localStorage keys under the `todoapp_` prefix: `todoapp_music_state` for `{ stationId, volume }`. State writes are best-effort (try/catch).
      - `main.js`: import from `music.js` (`ensureMusic`, plus any helper exports), add `const musicToggle = document.createElement('button')`, wire it between `pomodoroToggle` and `settingsToggle` in the navbar (`nav.appendChild` order). Functions to add mirror the pomodoro plumbing: `getMusicController()`, `syncMusicIcon()`, `hideMusicPopover()`, `onMusicOutsideClick()`, `onMusicKeydown()`, `showMusicPopover()`. Subscribe at controller-level on the `setTimeout(0)` so the icon's playing/paused state stays in sync regardless of whether the popover is open.
      - The existing `margin-left: auto` lives on `#pomodoroToggle` and pushes the whole right cluster to the navbar's right edge. The new music button should NOT carry `margin-left: auto` — it inherits the navbar's `gap: 8px` between siblings, sitting flush against the pomodoro button.
      - `style.css`: add `#musicToggle` styled like `#pomodoroToggle`, `.musicVizBars` + `.musicVizBars span` rules with a `musicVizBar` keyframe (5 bars, scaleY 0.3 ↔ 1.0 with 0s / 0.2s / 0.4s / 0.6s / 0.8s delays). Style `#musicPopover` mirroring `#pomodoroPopover`. Add `body:has(#musicPopover) #helpFab { display: none; }` to match the existing FAB-hide rules.
      - `modals.js`: extend `isAnyModalOrPopoverOpen()` to include `document.getElementById('musicPopover')` so the global `?` and `n` shortcuts (and the help FAB visibility) honor the music popover the same way they honor the pomodoro popover.
      - `pomodoro.js`: no changes — the music module subscribes to the existing pomodoro controller. Coordination logic lives entirely in `music.js`.
      - No new dependencies. No new build config. Audio is one `<audio>` element created lazily on first `play()` and reused thereafter.
      - Mobile: native autoplay restrictions block any `audio.play()` not initiated by a user gesture — the popover's play button is the only entry point, so this falls out naturally. Volume slider must be `font-size: 16px+` on mobile to avoid iOS Safari auto-zoom (the native range input doesn't trigger it but its focus ring inherits from the popover; verify on device).
      - Help modal: add a "Music" topic section to `HELP_TOPICS` in `modals.js` describing the button, the station picker, and the network-required nature of the feature.
  - File: `toDoList_main/src/music.js`, `toDoList_main/src/main.js`, `toDoList_main/src/style.css`, `toDoList_main/src/modals.js`
  - Completed: 2026-05-06

## In Progress

- [x] Fix API rate limiting issue
  - Completed: 2024-04-15
