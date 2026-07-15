// Mobile pomodoro/music bottom-sheet subsystem, extracted from the large
// component() in main.js following the same closure-to-factory injection
// pattern as projectPicker.js / settingsMenu.js. createMobileUtilitySheet()
// builds the bottom-anchored utility sheet (IDLE nub / PEEK strip / EXPANDED
// controls + music picker) and the persistent mobile tab bar, appends both
// into the `base` container it is handed, and wires the controller
// subscriptions and gesture handlers. Everything the block reads from
// component()'s scope is injected (never imported back from main.js — that
// would be circular): the `base` mount target, `main1` / `mainList` for the
// drawer / empty-state visibility hooks, `applyActiveView` for tab routing,
// and the `getPomodoroController` / `getMusicController` accessors. The two
// leaf helpers it calls come straight from their modules, so those are
// imported here directly.
//
// It installs window.bottomSheetRefreshVisibility and
// window.mobileTabBarRefreshVisibility exactly as component() used to, so the
// drawer / empty-state callers that reach for those globals keep working
// unchanged, and it also returns the built nodes plus the refresh function
// for direct use.
import { nextSuggestedMode } from './pomodoro.js';
import { parseYouTubeUrl } from './music.js';

export function createMobileUtilitySheet(deps) {
    const {
        base,
        main1,
        mainList,
        applyActiveView,
        getPomodoroController,
        getMusicController,
    } = deps;

    // ── Mobile bottom sheet utility surface ──
    // Bottom-anchored sheet for STACK mobile (≤1023px) that houses the
    // Pomodoro timer and the YouTube music player without changing either
    // controller's logic. Three visible states:
    //   IDLE      — 12px collapsed handle nub at the bottom edge
    //   PEEK      — 48px strip with timer + music segments, expand chevron
    //   EXPANDED  — sheet at min(50dvh, 320px) with full controls
    // State transitions are driven by controller subscriptions: timer start
    // or music play → PEEK; both stopped → IDLE (with a 3s grace window so
    // a completion frame is visible briefly). EXPANDED is user-driven (tap
    // or drag-up). Dismissal vocabulary follows CLAUDE.md's modal rule:
    // backdrop tap, drag-down past 30%, Escape.
    const bottomSheet = document.createElement('div');
    bottomSheet.id = 'bottomSheet';
    bottomSheet.setAttribute('data-state', 'IDLE');
    bottomSheet.setAttribute('data-view', 'controls');

    const sheetBackdrop = document.createElement('div');
    sheetBackdrop.id = 'bottomSheetBackdrop';

    // Single tap target for the IDLE nub. The visible glyph is 12px tall but
    // the button uses absolute positioning with extra hit area (≥44×44) so
    // the touch target meets the acceptance criteria.
    const sheetNub = document.createElement('button');
    sheetNub.id = 'bottomSheetNub';
    sheetNub.type = 'button';
    sheetNub.setAttribute('aria-label', 'Open utilities');
    const sheetNubInner = document.createElement('span');
    sheetNubInner.className = 'sheetNubBar';
    sheetNub.appendChild(sheetNubInner);

    // PEEK strip — visible at 48px when a utility is running. Left segment is
    // the timer (green dot + MM:SS), right segment is music (♪ + station name
    // + CSS visualizer bars). The grid uses two equal columns so the layout
    // doesn't shift when one segment empties — the still-running side stays
    // anchored to its column.
    const sheetPeek = document.createElement('button');
    sheetPeek.id = 'bottomSheetPeek';
    sheetPeek.type = 'button';
    sheetPeek.setAttribute('aria-label', 'Open utilities');

    const peekHandle = document.createElement('span');
    peekHandle.className = 'sheetPeekHandle';
    sheetPeek.appendChild(peekHandle);

    const peekContent = document.createElement('span');
    peekContent.className = 'sheetPeekContent';

    const peekPomodoro = document.createElement('span');
    peekPomodoro.className = 'sheetPeekPomodoro';
    const peekDot = document.createElement('span');
    peekDot.className = 'sheetPeekDot';
    peekDot.setAttribute('aria-hidden', 'true');
    const peekTime = document.createElement('span');
    peekTime.className = 'sheetPeekTime';
    peekTime.textContent = '';
    peekPomodoro.appendChild(peekDot);
    peekPomodoro.appendChild(peekTime);

    const peekDivider = document.createElement('span');
    peekDivider.className = 'sheetPeekDivider';
    peekDivider.setAttribute('aria-hidden', 'true');

    const peekMusic = document.createElement('span');
    peekMusic.className = 'sheetPeekMusic';
    const peekNote = document.createElement('span');
    peekNote.className = 'sheetPeekNote';
    peekNote.textContent = '♪';
    peekNote.setAttribute('aria-hidden', 'true');
    const peekStation = document.createElement('span');
    peekStation.className = 'sheetPeekStation';
    peekStation.textContent = '';
    const peekBars = document.createElement('span');
    peekBars.className = 'sheetPeekBars';
    peekBars.setAttribute('aria-hidden', 'true');
    // Four bars with staggered animation durations — the parent has an
    // explicit height so each bar's percentage-based height computes.
    for (let i = 0; i < 4; i++) {
        const bar = document.createElement('span');
        bar.className = 'sheetPeekBar';
        peekBars.appendChild(bar);
    }
    peekMusic.appendChild(peekNote);
    peekMusic.appendChild(peekStation);
    peekMusic.appendChild(peekBars);

    peekContent.appendChild(peekPomodoro);
    peekContent.appendChild(peekDivider);
    peekContent.appendChild(peekMusic);
    sheetPeek.appendChild(peekContent);

    const peekChevron = document.createElement('span');
    peekChevron.className = 'sheetPeekChevron';
    peekChevron.textContent = '⌃';
    peekChevron.setAttribute('aria-hidden', 'true');
    sheetPeek.appendChild(peekChevron);

    // EXPANDED sheet — dialog role per CLAUDE.md modal conventions.
    const sheetExpanded = document.createElement('div');
    sheetExpanded.id = 'bottomSheetExpanded';
    sheetExpanded.setAttribute('role', 'dialog');
    sheetExpanded.setAttribute('aria-label', 'Utilities');
    sheetExpanded.setAttribute('aria-modal', 'true');

    const sheetDragHandle = document.createElement('span');
    sheetDragHandle.className = 'sheetDragHandle';
    sheetDragHandle.setAttribute('aria-hidden', 'true');
    sheetExpanded.appendChild(sheetDragHandle);

    // Controls view — the default content of the expanded sheet. The picker
    // view is mounted as a sibling and toggled via data-view on the parent.
    const sheetControls = document.createElement('div');
    sheetControls.className = 'sheetView sheetViewControls';
    sheetControls.setAttribute('data-sheet-view', 'controls');

    // POMODORO section
    const sheetPomSection = document.createElement('section');
    sheetPomSection.className = 'sheetSection sheetPomSection';
    const sheetPomHeading = document.createElement('h3');
    sheetPomHeading.className = 'sheetSectionHeading';
    sheetPomHeading.textContent = 'POMODORO';
    sheetPomSection.appendChild(sheetPomHeading);

    const sheetPomTime = document.createElement('div');
    sheetPomTime.className = 'sheetPomTime';
    sheetPomTime.textContent = '25:00';
    sheetPomSection.appendChild(sheetPomTime);

    const sheetPomTabs = document.createElement('div');
    sheetPomTabs.className = 'sheetPomTabs';
    const pomModeButtons = {};
    [['focus', 'Focus'], ['short', 'Short'], ['long', 'Long']].forEach(function(pair) {
        const tabBtn = document.createElement('button');
        tabBtn.type = 'button';
        tabBtn.className = 'sheetPomTab';
        tabBtn.setAttribute('data-mode', pair[0]);
        tabBtn.textContent = pair[1];
        tabBtn.addEventListener('click', function() {
            const ctl = getPomodoroController();
            if (ctl) ctl.setMode(pair[0]);
        });
        pomModeButtons[pair[0]] = tabBtn;
        sheetPomTabs.appendChild(tabBtn);
    });
    sheetPomSection.appendChild(sheetPomTabs);

    const sheetPomActions = document.createElement('div');
    sheetPomActions.className = 'sheetPomActions';
    const sheetPomReset = document.createElement('button');
    sheetPomReset.type = 'button';
    sheetPomReset.className = 'sheetPomReset';
    sheetPomReset.textContent = 'Reset';
    sheetPomReset.addEventListener('click', function() {
        const ctl = getPomodoroController();
        if (ctl) ctl.reset();
    });
    const sheetPomPrimary = document.createElement('button');
    sheetPomPrimary.type = 'button';
    sheetPomPrimary.className = 'sheetPomPrimary';
    sheetPomPrimary.textContent = 'Start';
    sheetPomPrimary.addEventListener('click', function() {
        const ctl = getPomodoroController();
        if (!ctl) return;
        const status = ctl.getState().status;
        if (status === 'RUNNING') ctl.pause(); else ctl.start();
    });
    const sheetPomSkip = document.createElement('button');
    sheetPomSkip.type = 'button';
    sheetPomSkip.className = 'sheetPomSkip';
    sheetPomSkip.textContent = 'Skip';
    sheetPomSkip.addEventListener('click', function() {
        const ctl = getPomodoroController();
        if (!ctl) return;
        const snap = ctl.getState();
        const next = nextSuggestedMode(snap.mode);
        ctl.setMode(next);
    });
    sheetPomActions.appendChild(sheetPomReset);
    sheetPomActions.appendChild(sheetPomPrimary);
    sheetPomActions.appendChild(sheetPomSkip);
    sheetPomSection.appendChild(sheetPomActions);

    sheetControls.appendChild(sheetPomSection);

    // MUSIC section — compact "now playing" card with a chevron that opens
    // the inline station picker drilldown (view swap, not a stacked sheet).
    const sheetMusicSection = document.createElement('section');
    sheetMusicSection.className = 'sheetSection sheetMusicSection';
    const sheetMusicHeading = document.createElement('h3');
    sheetMusicHeading.className = 'sheetSectionHeading';
    sheetMusicHeading.textContent = 'MUSIC';
    sheetMusicSection.appendChild(sheetMusicHeading);

    const sheetMusicCard = document.createElement('div');
    sheetMusicCard.className = 'sheetMusicCard';

    const sheetMusicInfo = document.createElement('div');
    sheetMusicInfo.className = 'sheetMusicInfo';
    const sheetMusicStation = document.createElement('div');
    sheetMusicStation.className = 'sheetMusicStation';
    sheetMusicStation.textContent = '';
    const sheetMusicTitle = document.createElement('div');
    sheetMusicTitle.className = 'sheetMusicTitle';
    sheetMusicTitle.textContent = '';
    sheetMusicInfo.appendChild(sheetMusicStation);
    sheetMusicInfo.appendChild(sheetMusicTitle);
    sheetMusicCard.appendChild(sheetMusicInfo);

    const sheetMusicPlayPause = document.createElement('button');
    sheetMusicPlayPause.type = 'button';
    sheetMusicPlayPause.className = 'sheetMusicPlayPause';
    sheetMusicPlayPause.setAttribute('aria-label', 'Play');
    sheetMusicPlayPause.textContent = '▶';
    sheetMusicCard.appendChild(sheetMusicPlayPause);

    const sheetMusicMore = document.createElement('button');
    sheetMusicMore.type = 'button';
    sheetMusicMore.className = 'sheetMusicMore';
    sheetMusicMore.setAttribute('aria-label', 'Choose station');
    sheetMusicMore.textContent = '›';
    sheetMusicCard.appendChild(sheetMusicMore);

    sheetMusicSection.appendChild(sheetMusicCard);
    sheetControls.appendChild(sheetMusicSection);

    sheetExpanded.appendChild(sheetControls);

    // Picker view — inline drilldown that swaps `data-view` rather than
    // stacking. Backdrop tap on this view returns to controls, not dismiss.
    const sheetPicker = document.createElement('div');
    sheetPicker.className = 'sheetView sheetViewPicker';
    sheetPicker.setAttribute('data-sheet-view', 'picker');

    const sheetPickerHeader = document.createElement('div');
    sheetPickerHeader.className = 'sheetPickerHeader';
    const sheetPickerBack = document.createElement('button');
    sheetPickerBack.type = 'button';
    sheetPickerBack.className = 'sheetPickerBack';
    sheetPickerBack.setAttribute('aria-label', 'Back to controls');
    sheetPickerBack.textContent = '‹';
    const sheetPickerTitle = document.createElement('h3');
    sheetPickerTitle.className = 'sheetPickerTitle';
    sheetPickerTitle.textContent = 'Stations';
    sheetPickerHeader.appendChild(sheetPickerBack);
    sheetPickerHeader.appendChild(sheetPickerTitle);
    sheetPicker.appendChild(sheetPickerHeader);

    // Show-video toggle. The mobile player target lives below this control;
    // toggling adds/removes a `show-video` class on the picker view which
    // flips the target's `display`. Playback is unaffected because the
    // iframe stays attached either way.
    const sheetShowVideoRow = document.createElement('label');
    sheetShowVideoRow.className = 'sheetShowVideoRow';
    const sheetShowVideoCheck = document.createElement('input');
    sheetShowVideoCheck.type = 'checkbox';
    sheetShowVideoCheck.className = 'sheetShowVideoCheck';
    const sheetShowVideoLabel = document.createElement('span');
    sheetShowVideoLabel.className = 'sheetShowVideoLabel';
    sheetShowVideoLabel.textContent = 'Show video';
    sheetShowVideoRow.appendChild(sheetShowVideoCheck);
    sheetShowVideoRow.appendChild(sheetShowVideoLabel);
    sheetPicker.appendChild(sheetShowVideoRow);

    const sheetPlayerWrap = document.createElement('div');
    sheetPlayerWrap.className = 'sheetPlayerWrap';
    const sheetPlayerTarget = document.createElement('div');
    sheetPlayerTarget.id = 'bottomSheetMusicPlayerTarget';
    sheetPlayerWrap.appendChild(sheetPlayerTarget);
    sheetPicker.appendChild(sheetPlayerWrap);

    sheetShowVideoCheck.addEventListener('change', function() {
        sheetPicker.classList.toggle('show-video', sheetShowVideoCheck.checked);
    });

    const sheetStationList = document.createElement('div');
    sheetStationList.className = 'sheetStationList';
    sheetPicker.appendChild(sheetStationList);

    // Custom URL paste form — same UX as the desktop popover, mirrored at
    // mobile-safe input font sizes (handled in style.css).
    const sheetPasteRow = document.createElement('div');
    sheetPasteRow.className = 'sheetPasteRow';
    const sheetPasteBtn = document.createElement('button');
    sheetPasteBtn.type = 'button';
    sheetPasteBtn.className = 'sheetPasteBtn';
    sheetPasteBtn.textContent = '+ Paste YouTube URL';
    sheetPasteRow.appendChild(sheetPasteBtn);

    const sheetPasteForm = document.createElement('div');
    sheetPasteForm.className = 'sheetPasteForm';
    sheetPasteForm.style.display = 'none';
    const sheetPasteName = document.createElement('input');
    sheetPasteName.type = 'text';
    sheetPasteName.className = 'sheetPasteName';
    sheetPasteName.placeholder = 'Station name (optional)';
    const sheetPasteUrl = document.createElement('input');
    sheetPasteUrl.type = 'text';
    sheetPasteUrl.className = 'sheetPasteUrl';
    sheetPasteUrl.placeholder = 'https://youtube.com/watch?v=…';
    const sheetPasteError = document.createElement('div');
    sheetPasteError.className = 'sheetPasteError';
    sheetPasteError.style.display = 'none';
    sheetPasteForm.appendChild(sheetPasteName);
    sheetPasteForm.appendChild(sheetPasteUrl);
    sheetPasteForm.appendChild(sheetPasteError);
    sheetPasteRow.appendChild(sheetPasteForm);
    sheetPicker.appendChild(sheetPasteRow);

    // Volume row — sits directly below the paste-URL button. Speaker icon on
    // the left doubles as a mute toggle; native range in the middle drives
    // the controller in real time; small percentage readout on the right
    // stays in lockstep. Mobile-safe: the row reserves a 44px+ hit zone even
    // though the visible thumb is small.
    const sheetVolumeRow = document.createElement('div');
    sheetVolumeRow.className = 'sheetVolumeRow';

    const SHEET_VOL_ICON_ON =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M15 8a5 5 0 0 1 0 8"/>' +
        '<path d="M17.7 5a9 9 0 0 1 0 14"/>' +
        '<path d="M6 15h-2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1-1.5 .5l-3.5-4.5"/>' +
        '</svg>';
    const SHEET_VOL_ICON_OFF =
        '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M6 15h-2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h2l3.5-4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1-1.5 .5l-3.5-4.5"/>' +
        '<path d="M16 10l4 4"/>' +
        '<path d="M20 10l-4 4"/>' +
        '</svg>';

    const sheetVolumeIcon = document.createElement('button');
    sheetVolumeIcon.type = 'button';
    sheetVolumeIcon.className = 'sheetVolumeIcon';
    sheetVolumeIcon.setAttribute('aria-label', 'Mute');
    sheetVolumeIcon.title = 'Mute';
    sheetVolumeIcon.innerHTML = SHEET_VOL_ICON_ON;

    const sheetVolumeSlider = document.createElement('input');
    sheetVolumeSlider.type = 'range';
    sheetVolumeSlider.min = '0';
    sheetVolumeSlider.max = '100';
    sheetVolumeSlider.step = '1';
    sheetVolumeSlider.className = 'sheetVolumeSlider';
    sheetVolumeSlider.setAttribute('aria-label', 'Volume');

    const sheetVolumePct = document.createElement('span');
    sheetVolumePct.className = 'sheetVolumePct';
    sheetVolumePct.setAttribute('aria-live', 'polite');
    sheetVolumePct.textContent = '50%';

    sheetVolumeRow.appendChild(sheetVolumeIcon);
    sheetVolumeRow.appendChild(sheetVolumeSlider);
    sheetVolumeRow.appendChild(sheetVolumePct);
    sheetPicker.appendChild(sheetVolumeRow);

    sheetVolumeSlider.addEventListener('input', function() {
        const ctl = getMusicController();
        if (!ctl) return;
        const v = parseInt(sheetVolumeSlider.value, 10);
        if (isFinite(v)) ctl.setVolume(v / 100);
    });
    sheetVolumeIcon.addEventListener('click', function() {
        const ctl = getMusicController();
        if (!ctl) return;
        const snap = ctl.getState();
        ctl.setMuted(!snap.muted);
    });

    sheetPasteBtn.addEventListener('click', function() {
        const open = sheetPasteForm.style.display !== 'none';
        sheetPasteForm.style.display = open ? 'none' : '';
        if (!open) setTimeout(function() { sheetPasteUrl.focus(); }, 0);
    });
    sheetPasteUrl.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const ctl = getMusicController();
        if (!ctl) return;
        const parsed = parseYouTubeUrl(sheetPasteUrl.value);
        if (!parsed) {
            sheetPasteError.textContent = "Couldn't read that URL. Try a watch / playlist / live link.";
            sheetPasteError.style.display = '';
            return;
        }
        const station = ctl.addCustomStation(sheetPasteName.value, sheetPasteUrl.value);
        if (!station) {
            sheetPasteError.textContent = "Couldn't add that station.";
            sheetPasteError.style.display = '';
            return;
        }
        sheetPasteName.value = '';
        sheetPasteUrl.value = '';
        sheetPasteError.style.display = 'none';
        sheetPasteForm.style.display = 'none';
    });

    sheetExpanded.appendChild(sheetPicker);

    sheetMusicMore.addEventListener('click', function() {
        bottomSheet.setAttribute('data-view', 'picker');
    });
    sheetPickerBack.addEventListener('click', function() {
        bottomSheet.setAttribute('data-view', 'controls');
    });

    sheetMusicPlayPause.addEventListener('click', function() {
        const ctl = getMusicController();
        if (!ctl) return;
        const status = ctl.getState().status;
        if (status === 'PLAYING' || status === 'BUFFERING') {
            ctl.pause();
        } else {
            ctl.play(sheetPlayerTarget);
        }
    });

    bottomSheet.appendChild(sheetBackdrop);
    bottomSheet.appendChild(sheetNub);
    bottomSheet.appendChild(sheetPeek);
    bottomSheet.appendChild(sheetExpanded);
    base.appendChild(bottomSheet);

    // ── Persistent bottom tab bar (mobile only) ──
    // Two destinations — Projects, Agent — pinned to the
    // bottom of the viewport at ≤1023px. Tapping a tab routes through
    // applyActiveView() so the same code path drives mobile tabs and the
    // desktop pill switcher; the active tab class is set in
    // applyActiveView. The bar height is exposed as `--mobile-tab-h` so
    // the bottom-sheet PEEK / IDLE / swipe-zone layers stack directly
    // above it without any per-element coupling. Hidden on desktop via
    // CSS (#mobileTabBar { display: none }).
    const mobileTabBar = document.createElement('nav');
    mobileTabBar.id = 'mobileTabBar';
    mobileTabBar.setAttribute('role', 'tablist');
    mobileTabBar.setAttribute('aria-label', 'Mobile bottom navigation');

    function buildMobileTab(viewKey, label, iconSvg, displayLabel) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mobileTab';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-pressed', 'false');
        btn.dataset.view = viewKey;
        btn.setAttribute('aria-label', label);
        const icon = document.createElement('span');
        icon.className = 'mobileTabIcon';
        icon.setAttribute('aria-hidden', 'true');
        icon.innerHTML = iconSvg;
        const text = document.createElement('span');
        text.className = 'mobileTabLabel';
        // Visible label can differ from the accessible name: callers may pass
        // a separate `displayLabel` so the on-screen text changes while the
        // aria-label (and any selectors keyed off it) stay put.
        text.textContent = displayLabel || label;
        btn.appendChild(icon);
        btn.appendChild(text);
        btn.addEventListener('click', function() {
            // The AGENT tab always navigates now, even on projects with no routed
            // repo — the view itself renders an in-place "unavailable" message
            // instead of a dead board, so there's no early-return no-op here.
            applyActiveView(viewKey);
        });
        return btn;
    }

    // Inline SVG icons (24×24, currentColor stroke) — no icon library per
    // CLAUDE.md. List glyph. Built from <rect>
    // and <path> primitives so the SVG markup stays distinct from the
    // ghost / kebab assertions in unrelated tests.
    const ICON_LIST =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<line x1="8" y1="6" x2="20" y2="6"/>' +
        '<line x1="8" y1="12" x2="20" y2="12"/>' +
        '<line x1="8" y1="18" x2="20" y2="18"/>' +
        '<rect x="3" y="5" width="2" height="2" rx="1" fill="currentColor"/>' +
        '<rect x="3" y="11" width="2" height="2" rx="1" fill="currentColor"/>' +
        '<rect x="3" y="17" width="2" height="2" rx="1" fill="currentColor"/>' +
        '</svg>';
    // Agent — a robot glyph signalling the autonomous-agent work queue,
    // built from path primitives like the others (no icon library).
    const ICON_AGENT =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="5" y="8" width="14" height="10" rx="2"/>' +
        '<path d="M12 4 L12 8"/>' +
        '<circle cx="12" cy="3" r="1"/>' +
        '<path d="M9 12 L9 13"/>' +
        '<path d="M15 12 L15 13"/>' +
        '<path d="M2 12 L2 14"/>' +
        '<path d="M22 12 L22 14"/>' +
        '</svg>';

    // Structure — a layered-stack / sitemap glyph signalling the "map of the
    // source" intent, built from path primitives like the others (no icon
    // library).
    const ICON_STRUCTURE =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M12 3 L20 7 L12 11 L4 7 Z"/>' +
        '<path d="M4 12 L12 16 L20 12"/>' +
        '<path d="M4 16.5 L12 20.5 L20 16.5"/>' +
        '</svg>';

    const mobileTabProjects = buildMobileTab('projects', 'Projects', ICON_LIST, 'Tasks View');
    const mobileTabAgent = buildMobileTab('agent', 'Agent', ICON_AGENT);
    const mobileTabStructure = buildMobileTab('structure', 'Structure', ICON_STRUCTURE);
    mobileTabProjects.id = 'mobileTabProjects';
    mobileTabAgent.id = 'mobileTabAgent';
    mobileTabStructure.id = 'mobileTabStructure';

    // Small hollow "no-repo" marker shown on the AGENT tab only while
    // body.agentUnavailable is set (CSS toggles its display). The tab stays fully
    // tappable — the marker signals the project has no routed repo, and tapping
    // opens the in-view unavailable message rather than a live board.
    const mobileTabAgentMarker = document.createElement('span');
    mobileTabAgentMarker.className = 'agentNoRepoMarker';
    mobileTabAgentMarker.setAttribute('aria-hidden', 'true');
    mobileTabAgent.appendChild(mobileTabAgentMarker);

    // Small filled "working" dot leading the AGENT tab, shown only while
    // body.agentWorking is set (the persistent working watch toggles that class
    // from mount-independent state, so the dot stays lit even after the user
    // leaves the Agent tab). Inserted as the FIRST child so it reads as a
    // leading indicator; CSS keys its display and pulse off body.agentWorking,
    // mirroring the agentNoRepoMarker conditional-marker pattern.
    const mobileTabAgentWorkingDot = document.createElement('span');
    mobileTabAgentWorkingDot.className = 'agentWorkingDot';
    mobileTabAgentWorkingDot.setAttribute('aria-hidden', 'true');
    mobileTabAgent.insertBefore(mobileTabAgentWorkingDot, mobileTabAgent.firstChild);

    // Same hollow "no-repo" marker on the STRUCTURE tab — a repo-less project
    // can't be mapped, so the tab stays tappable (it opens the unlinked-repo
    // empty state) but carries the marker while body.agentUnavailable is set.
    const mobileTabStructureMarker = document.createElement('span');
    mobileTabStructureMarker.className = 'agentNoRepoMarker';
    mobileTabStructureMarker.setAttribute('aria-hidden', 'true');
    mobileTabStructure.appendChild(mobileTabStructureMarker);

    mobileTabBar.appendChild(mobileTabProjects);
    mobileTabBar.appendChild(mobileTabAgent);
    mobileTabBar.appendChild(mobileTabStructure);
    base.appendChild(mobileTabBar);

    // Mirror refreshSheetVisibility for the tab bar — hide it whenever
    // the drawer is open or the NO PROJECTS empty state owns the screen
    // so it doesn't paint over either surface. The same MutationObserver
    // wired into refreshSheetVisibility() picks up these calls because
    // both functions read off main1.classList and #emptyState's class.
    function refreshTabBarVisibility() {
        const drawerOpen = main1.classList.contains('sidebar-open');
        const noProjects = !!document.querySelector('#emptyState.emptyStateNoProjects');
        mobileTabBar.classList.toggle('hidden-by-drawer', drawerOpen);
        mobileTabBar.classList.toggle('hidden-by-empty', noProjects);
    }
    window.mobileTabBarRefreshVisibility = refreshTabBarVisibility;

    // ── State machine ──
    // setSheetState centralizes the IDLE/PEEK/EXPANDED transition so we can
    // funnel all the visibility plumbing (hide on drawer, hide on NO
    // PROJECTS, etc.) through a single call.
    let sheetIdleGraceTimer = null;
    function clearIdleGraceTimer() {
        if (sheetIdleGraceTimer !== null) {
            clearTimeout(sheetIdleGraceTimer);
            sheetIdleGraceTimer = null;
        }
    }
    function setSheetState(next) {
        if (next !== 'IDLE' && next !== 'PEEK' && next !== 'EXPANDED') return;
        if (next !== 'IDLE') clearIdleGraceTimer();
        if (bottomSheet.getAttribute('data-state') === next) return;
        bottomSheet.setAttribute('data-state', next);
        if (next === 'EXPANDED') {
            document.documentElement.classList.add('bottom-sheet-expanded');
        } else {
            document.documentElement.classList.remove('bottom-sheet-expanded');
            // Closing collapses any view-swap so the next open lands on
            // the default controls view, not whichever drilldown the user
            // last had open.
            bottomSheet.setAttribute('data-view', 'controls');
        }
    }

    // Drive PEEK/IDLE off whether either utility is active. Timer is
    // "active" while running, paused, or in the post-complete acknowledgement
    // window; music is "active" while PLAYING or BUFFERING.
    function utilityIsActive() {
        const pomCtl = getPomodoroController();
        const musicCtl = getMusicController();
        const pomActive = pomCtl ? (function() {
            const s = pomCtl.getState().status;
            return s === 'RUNNING' || s === 'PAUSED' || s === 'COMPLETE_UNACKED';
        })() : false;
        const musicActive = musicCtl ? (function() {
            const s = musicCtl.getState().status;
            return s === 'PLAYING' || s === 'BUFFERING';
        })() : false;
        return { pomActive: pomActive, musicActive: musicActive, any: pomActive || musicActive };
    }

    function refreshAutoState() {
        const current = bottomSheet.getAttribute('data-state');
        if (current === 'EXPANDED') return; // user-driven; don't override
        const active = utilityIsActive();
        if (active.any) {
            clearIdleGraceTimer();
            setSheetState('PEEK');
        } else if (current === 'PEEK') {
            // 3s grace so a completion frame ("00:00 — Break time!") is
            // legible before we collapse to IDLE.
            if (sheetIdleGraceTimer === null) {
                sheetIdleGraceTimer = setTimeout(function() {
                    sheetIdleGraceTimer = null;
                    if (!utilityIsActive().any &&
                        bottomSheet.getAttribute('data-state') === 'PEEK') {
                        setSheetState('IDLE');
                    }
                }, 3000);
            }
        } else {
            setSheetState('IDLE');
        }
    }

    function syncPomodoroSheet(snap) {
        snap = snap || (getPomodoroController() && getPomodoroController().getState());
        if (!snap) return;
        const seconds = Math.max(0, Math.round((snap.remainingMs || 0) / 1000));
        const mm = Math.floor(seconds / 60);
        const ss = seconds - mm * 60;
        const formatted = (mm < 10 ? '0' + mm : '' + mm) + ':' + (ss < 10 ? '0' + ss : '' + ss);
        peekTime.textContent = formatted;
        sheetPomTime.textContent = formatted;
        peekPomodoro.setAttribute('data-status', snap.status);
        peekPomodoro.style.display = (snap.status === 'RUNNING' || snap.status === 'PAUSED' || snap.status === 'COMPLETE_UNACKED') ? '' : 'none';
        Object.keys(pomModeButtons).forEach(function(mode) {
            pomModeButtons[mode].classList.toggle('active', snap.mode === mode);
        });
        if (snap.status === 'RUNNING') sheetPomPrimary.textContent = 'Pause';
        else if (snap.status === 'PAUSED') sheetPomPrimary.textContent = 'Resume';
        else sheetPomPrimary.textContent = 'Start';
        refreshAutoState();
    }

    function syncMusicSheet(snap) {
        snap = snap || (getMusicController() && getMusicController().getState());
        if (!snap) return;
        const stationName = snap.activeStation ? snap.activeStation.name : '';
        peekStation.textContent = stationName;
        sheetMusicStation.textContent = stationName;
        sheetMusicTitle.textContent = snap.nowPlaying && snap.nowPlaying.title ? snap.nowPlaying.title : '';
        const isPlaying = snap.status === 'PLAYING' || snap.status === 'BUFFERING';
        peekMusic.setAttribute('data-status', snap.status);
        peekMusic.classList.toggle('active', isPlaying);
        peekMusic.style.display = isPlaying ? '' : 'none';
        sheetMusicPlayPause.textContent = isPlaying ? '❚❚' : '▶';
        sheetMusicPlayPause.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
        const pct = Math.round((snap.volume || 0) * 100);
        sheetVolumeSlider.value = String(pct);
        sheetVolumePct.textContent = pct + '%';
        sheetVolumeRow.classList.toggle('muted', !!snap.muted);
        sheetVolumeIcon.innerHTML = snap.muted ? SHEET_VOL_ICON_OFF : SHEET_VOL_ICON_ON;
        sheetVolumeIcon.setAttribute('aria-label', snap.muted ? 'Unmute' : 'Mute');
        sheetVolumeIcon.title = snap.muted ? 'Unmute' : 'Mute';
        renderSheetStationList(snap);
        refreshAutoState();
    }

    function renderSheetStationList(snap) {
        sheetStationList.textContent = '';
        function addRow(station, isCustom) {
            const row = document.createElement('div');
            row.className = 'sheetStationRow' + (snap.activeStationId === station.id ? ' active' : '');
            row.dataset.stationId = station.id;
            const name = document.createElement('button');
            name.type = 'button';
            name.className = 'sheetStationName';
            name.textContent = station.name;
            name.addEventListener('click', function() {
                const ctl = getMusicController();
                if (ctl) ctl.setStation(station.id);
            });
            const genre = document.createElement('span');
            genre.className = 'sheetStationGenre';
            genre.textContent = (station.genre || '').toUpperCase();
            row.appendChild(name);
            row.appendChild(genre);
            if (isCustom) {
                const remove = document.createElement('button');
                remove.type = 'button';
                remove.className = 'sheetStationRemove';
                remove.setAttribute('aria-label', 'Remove ' + station.name);
                remove.textContent = '×';
                remove.addEventListener('click', function(e) {
                    e.stopPropagation();
                    const ctl = getMusicController();
                    if (ctl) ctl.removeCustomStation(station.id);
                });
                row.appendChild(remove);
            }
            sheetStationList.appendChild(row);
        }
        if (snap.customStations && snap.customStations.length) {
            const head = document.createElement('div');
            head.className = 'sheetStationSection';
            head.textContent = 'Your stations';
            sheetStationList.appendChild(head);
            snap.customStations.forEach(function(s) { addRow(s, true); });
        }
        const head = document.createElement('div');
        head.className = 'sheetStationSection';
        head.textContent = 'Curated';
        sheetStationList.appendChild(head);
        snap.curatedStations.forEach(function(s) { addRow(s, false); });
    }

    // Subscribe controllers — these may not be ready at component() time but
    // ensure* lazy-creates them. setTimeout 0 mirrors the pattern used for
    // syncMusicIcon's subscription above.
    setTimeout(function() {
        const pomCtl = getPomodoroController();
        if (pomCtl) {
            pomCtl.subscribe(syncPomodoroSheet);
            syncPomodoroSheet(pomCtl.getState());
        }
        const musicCtl = getMusicController();
        if (musicCtl) {
            musicCtl.subscribe(syncMusicSheet);
            syncMusicSheet(musicCtl.getState());
        }
        refreshAutoState();
    }, 0);

    // Tap / drag to expand. Native click on the nub or peek strip expands;
    // pointermove-based drag-up is wired below for a tactile feel.
    sheetNub.addEventListener('click', function() { setSheetState('EXPANDED'); });
    sheetPeek.addEventListener('click', function(e) {
        // Suppress click if pointer interaction marked a drag — the
        // pointerup handler stamps `data-suppress-click` to coordinate.
        if (sheetPeek.dataset.suppressClick === '1') {
            delete sheetPeek.dataset.suppressClick;
            return;
        }
        setSheetState('EXPANDED');
    });

    // Backdrop tap. When the picker drilldown is active, the backdrop tap
    // first returns to the controls view (per acceptance criteria); a second
    // tap then dismisses. This matches the spec line: "Backdrop tap on the
    // picker drilldown returns to controls view, not all the way to dismiss".
    sheetBackdrop.addEventListener('click', function() {
        if (bottomSheet.getAttribute('data-view') === 'picker') {
            bottomSheet.setAttribute('data-view', 'controls');
            return;
        }
        // Return to whichever lower state applies.
        const active = utilityIsActive();
        setSheetState(active.any ? 'PEEK' : 'IDLE');
    });

    // Escape closes EXPANDED, returning to the lower state. Capture phase so
    // we win over the mobile drawer's Escape handler when both could fire.
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        if (bottomSheet.getAttribute('data-state') !== 'EXPANDED') return;
        e.preventDefault();
        e.stopPropagation();
        if (bottomSheet.getAttribute('data-view') === 'picker') {
            bottomSheet.setAttribute('data-view', 'controls');
            return;
        }
        const active = utilityIsActive();
        setSheetState(active.any ? 'PEEK' : 'IDLE');
    }, true);

    // Drag-down to dismiss / drag-up to expand. Pointer events cover mouse
    // + pen here; the richer touch-event swipe handler below owns the
    // touch path so finger gestures get the wider bottom-edge hit zone
    // and translate-with-finger feel. Bailing on pointerType === 'touch'
    // prevents the two handlers from double-firing on the same gesture.
    function attachDragGesture(targetEl, intent) {
        // intent: 'expand' for nub/peek (drag-up opens), 'dismiss' for
        // sheetDragHandle (drag-down closes).
        let startY = 0;
        let pointerId = null;
        let dragging = false;
        targetEl.addEventListener('pointerdown', function(e) {
            if (e.isPrimary === false) return;
            if (e.pointerType === 'touch') return;
            startY = e.clientY;
            pointerId = e.pointerId;
            dragging = true;
            try { targetEl.setPointerCapture(pointerId); } catch (err) { /* defensive */ }
        });
        targetEl.addEventListener('pointermove', function(e) {
            if (!dragging || e.pointerId !== pointerId) return;
            const dy = e.clientY - startY;
            if (intent === 'expand' && dy < -10) {
                dragging = false;
                try { targetEl.releasePointerCapture(pointerId); } catch (err) { /* defensive */ }
                if (targetEl === sheetPeek) sheetPeek.dataset.suppressClick = '1';
                setSheetState('EXPANDED');
            } else if (intent === 'dismiss' && dy > 0) {
                const h = sheetExpanded.getBoundingClientRect().height || 1;
                if (dy / h > 0.3) {
                    dragging = false;
                    try { targetEl.releasePointerCapture(pointerId); } catch (err) { /* defensive */ }
                    const active = utilityIsActive();
                    setSheetState(active.any ? 'PEEK' : 'IDLE');
                }
            }
        });
        targetEl.addEventListener('pointerup', function(e) {
            if (e.pointerId !== pointerId) return;
            dragging = false;
            try { targetEl.releasePointerCapture(pointerId); } catch (err) { /* defensive */ }
        });
        targetEl.addEventListener('pointercancel', function() { dragging = false; });
    }
    attachDragGesture(sheetNub, 'expand');
    attachDragGesture(sheetPeek, 'expand');
    attachDragGesture(sheetDragHandle, 'dismiss');

    // ── Touch-event swipe gesture for opening / closing the bottom sheet ──
    // Adds a swipe-up alternative to tap on the handle (and a reverse
    // swipe-down to dismiss while open). Touch path is separated from the
    // pointer-event drag above so we can: (a) widen the hit zone via a
    // thin invisible strip along the bottom edge so the user doesn't have
    // to hit the small visual handle, (b) translate the sheet with the
    // finger so the gesture feels physical, and (c) commit on a 40px
    // distance OR a short upward velocity rather than the pointer path's
    // 10px instant threshold. Coarse-pointer gated so desktop mouse drag
    // keeps the existing handler unchanged.
    const sheetSwipeZone = document.createElement('div');
    sheetSwipeZone.className = 'sheetSwipeZone';
    sheetSwipeZone.setAttribute('aria-hidden', 'true');
    bottomSheet.insertBefore(sheetSwipeZone, sheetNub);

    function isCoarsePointer() {
        try {
            return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
        } catch (err) { return false; }
    }

    const SHEET_SWIPE_INTENT_PX   = 8;
    const SHEET_SWIPE_COMMIT_PX   = 40;
    const SHEET_SWIPE_VELOCITY_PX = 0.5; // px/ms — short upward flick

    // Live inline transform applied to sheetExpanded so the finger drags
    // the sheet 1:1. Cleared on commit / snap-back; the CSS class-driven
    // transition resumes after clearing so the snap animates.
    function setSheetDragTransform(translatePx) {
        sheetExpanded.style.transition = 'none';
        sheetExpanded.style.transform = 'translateY(' + translatePx + 'px)';
    }
    function clearSheetDragTransform() {
        sheetExpanded.style.transform = '';
        sheetExpanded.style.transition = '';
    }

    function attachSheetTouchSwipe(targetEl, mode) {
        // mode: 'open' (swipe-up from IDLE/PEEK → EXPANDED),
        //       'close' (swipe-down from EXPANDED → lower state).
        let startX = 0;
        let startY = 0;
        let startTime = 0;
        let originState = '';
        let active = false;
        let resolved = false;
        let sheetHeight = 320;
        let lastY = 0;
        let lastTime = 0;
        // For 'close' mode the listener lives on the whole drawer container
        // so a swipe-down anywhere on the panel (not just the tiny drag
        // handle) dismisses. When the touch starts inside a scrollable
        // child that is already scrolled, defer to native scroll instead
        // of stealing the gesture.
        let scrollableAtStart = null;
        let scrollableTopAtStart = 0;

        function findScrollableAncestor(node) {
            let el = node;
            while (el && el !== targetEl && el !== document.body) {
                try {
                    const cs = window.getComputedStyle(el);
                    if (cs && /(auto|scroll)/.test(cs.overflowY) &&
                        el.scrollHeight > el.clientHeight) {
                        return el;
                    }
                } catch (err) { /* defensive */ }
                el = el.parentElement;
            }
            return null;
        }

        targetEl.addEventListener('touchstart', function(event) {
            if (!isCoarsePointer()) return;
            if (event.touches.length !== 1) return;
            const state = bottomSheet.getAttribute('data-state');
            if (mode === 'open' && state === 'EXPANDED') return;
            if (mode === 'close' && state !== 'EXPANDED') return;
            const t = event.touches[0];
            startX = t.clientX;
            startY = t.clientY;
            lastY = startY;
            startTime = (event.timeStamp || Date.now());
            lastTime = startTime;
            originState = state;
            active = true;
            resolved = false;
            const measured = sheetExpanded.getBoundingClientRect().height;
            sheetHeight = measured > 0 ? measured : 320;
            scrollableAtStart = (mode === 'close')
                ? findScrollableAncestor(event.target)
                : null;
            scrollableTopAtStart = scrollableAtStart ? scrollableAtStart.scrollTop : 0;
        }, { passive: true });

        targetEl.addEventListener('touchmove', function(event) {
            if (!active || event.touches.length !== 1) return;
            const t = event.touches[0];
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            lastY = t.clientY;
            lastTime = (event.timeStamp || Date.now());
            if (!resolved) {
                // Wait until the gesture's direction is clearly vertical
                // and past the intent threshold before committing the
                // path. Horizontal-dominant or wrong-direction releases
                // the gesture without altering sheet state.
                if (Math.abs(dy) < SHEET_SWIPE_INTENT_PX) return;
                if (Math.abs(dx) > Math.abs(dy)) {
                    active = false;
                    return;
                }
                if (mode === 'open' && dy >= 0) { active = false; return; }
                if (mode === 'close' && dy <= 0) { active = false; return; }
                // Yield to inner scroll when the touch started inside a
                // scrollable child that wasn't already at the top — the
                // user means to scroll up through content, not dismiss.
                if (mode === 'close' && scrollableAtStart && scrollableTopAtStart > 0) {
                    active = false;
                    return;
                }
                resolved = true;
                if (mode === 'open') {
                    // Promote to EXPANDED so the sheet is in the visual
                    // stack while we apply the live offset. The inline
                    // transform overrides the CSS translateY(0) target.
                    bottomSheet.setAttribute('data-state', 'EXPANDED');
                    if (targetEl === sheetPeek) sheetPeek.dataset.suppressClick = '1';
                }
            }
            if (mode === 'open') {
                const progress = Math.min(1, Math.max(0, -dy / sheetHeight));
                setSheetDragTransform((1 - progress) * sheetHeight);
            } else {
                const offset = Math.max(0, Math.min(sheetHeight, dy));
                setSheetDragTransform(offset);
            }
            if (event.cancelable) event.preventDefault();
        }, { passive: false });

        function endGesture(event) {
            if (!active) return;
            active = false;
            const wasResolved = resolved;
            resolved = false;
            if (!wasResolved) return;
            const touch = (event.changedTouches && event.changedTouches[0]) || null;
            const finalY = touch ? touch.clientY : lastY;
            const finalT = (event.timeStamp || Date.now());
            const dy = finalY - startY;
            const dt = Math.max(1, finalT - startTime);
            clearSheetDragTransform();
            if (mode === 'open') {
                const velocity = -dy / dt;
                const committed = ((-dy) >= SHEET_SWIPE_COMMIT_PX) ||
                                  (velocity >= SHEET_SWIPE_VELOCITY_PX);
                if (committed) {
                    setSheetState('EXPANDED');
                } else {
                    // Force the attribute back via setAttribute since
                    // setSheetState bails when the current value already
                    // matches the next state.
                    bottomSheet.setAttribute('data-state', originState);
                    setSheetState(originState);
                }
            } else {
                const velocity = dy / dt;
                const committed = (dy >= SHEET_SWIPE_COMMIT_PX) ||
                                  (velocity >= SHEET_SWIPE_VELOCITY_PX);
                if (committed) {
                    const act = utilityIsActive();
                    setSheetState(act.any ? 'PEEK' : 'IDLE');
                }
                // else: stay EXPANDED; cleared transform lets CSS snap back.
            }
        }
        targetEl.addEventListener('touchend', endGesture);
        targetEl.addEventListener('touchcancel', function() {
            if (!active) return;
            active = false;
            const wasResolved = resolved;
            resolved = false;
            clearSheetDragTransform();
            if (wasResolved && mode === 'open') {
                bottomSheet.setAttribute('data-state', originState);
                setSheetState(originState);
            }
        });
    }

    attachSheetTouchSwipe(sheetNub, 'open');
    attachSheetTouchSwipe(sheetPeek, 'open');
    attachSheetTouchSwipe(sheetSwipeZone, 'open');
    // Close swipe binds to the whole drawer container — not just the tiny
    // drag handle — so the swipe-down dismiss stays available after the
    // user has interacted with controls inside the drawer. The handler
    // bails on inner scrollable regions that aren't already at scrollTop=0
    // so native scrolling is preserved.
    attachSheetTouchSwipe(sheetExpanded, 'close');

    // Expose a tiny imperative API for tests + visibility coordination from
    // the drawer / empty-state hooks below.
    function refreshSheetVisibility() {
        const drawerOpen = main1.classList.contains('sidebar-open');
        const noProjects = !!document.querySelector('#emptyState.emptyStateNoProjects');
        // hide entirely when drawer covers everything or no projects exist
        bottomSheet.classList.toggle('hidden-by-drawer', drawerOpen);
        bottomSheet.classList.toggle('hidden-by-empty', noProjects);
        if (drawerOpen || noProjects) {
            if (bottomSheet.getAttribute('data-state') === 'EXPANDED') {
                // Collapsing here keeps Escape/backdrop handlers from
                // firing against an off-screen sheet that the user can't see.
                const active = utilityIsActive();
                setSheetState(active.any ? 'PEEK' : 'IDLE');
            }
        }
        // Tab bar follows the same hide rules — the drawer-open and
        // NO-PROJECTS states are the two surfaces the bar shouldn't paint
        // over.
        refreshTabBarVisibility();
    }
    // Watch the mainList classList + empty-state mutations so the sheet hides
    // when NO PROJECTS appears or is removed.
    setTimeout(function() {
        try {
            const observer = new MutationObserver(refreshSheetVisibility);
            observer.observe(mainList, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        } catch (err) { /* defensive */ }
        refreshSheetVisibility();
    }, 0);
    window.bottomSheetRefreshVisibility = refreshSheetVisibility;

    return {
        bottomSheet,
        mobileTabBar,
        refreshSheetVisibility,
        refreshTabBarVisibility,
    };
}
