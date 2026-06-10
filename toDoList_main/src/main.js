import './style.css';
import { listLogic } from './listLogic.js';
import {
    isCompanionEnabled,
    setCompanionEnabled,
    ensureCompanion,
    destroyCompanion,
} from './companion.js';
import {
    ensurePomodoro,
    nextSuggestedMode,
    createPomodoroUI,
} from './pomodoro.js';
import {
    ensureMusic,
    parseYouTubeUrl,
    createPomodoroSubscriber,
    createMusicUI,
} from './music.js';
import {
    isCompletedSectionOpen,
    setCompletedSectionOpen,
    getActiveView,
    setActiveView,
    isOnboardingComplete,
    isChatPaneCollapsed,
    setChatPaneCollapsed,
    getTaskSort,
    setTaskSort,
} from './prefs.js';
import {
    applyTheme,
    resolveInitialTheme,
    getCurrentTheme,
    THEME_KEY,
} from './theme.js';
import {
    showChangelogModal,
    showHelpModal,
    updateChangelogDot,
    notifyUpdateAvailable,
    applyPendingUpdate,
    hasPendingUpdate,
    isAnyModalOrPopoverOpen,
} from './modals.js';
import { mountClaudeSheet } from './claudeSheet.js';
import { updateCompletedSection, updateEmptyState } from './emptyState.js';
import { applyProjectAccent } from './projectMenu.js';
import {
    attachProjectContextMenu,
    attachProjectDrag,
    attachProjectInjectIndicator,
    deleteProjectFlow,
} from './projectRow.js';
import { createProjectPicker } from './projectPicker.js';
import { createSettingsMenu } from './settingsMenu.js';
import {
    addAllToDo_DOM,
    addToDos_restore,
    focusBlankToDoInput,
    focusBlankToDoInputIfDesktop,
    reorderToDoDOM,
} from './toDoRow.js';
import { resetMobileCreateSession } from './mobileTaskCreate.js';
import { wireStatusLabelDelegation } from './todoStatus.js';
import { buildTaskFilterBar, applyTaskFilter } from './taskFilter.js';
import { prefersReducedMotion } from './dragDrop.js';
import { applyDueUrgency, updateDuePillLabel } from './dueDate.js';
import {
    initCalendarView,
    renderCalendarView,
    resetCalendarStateToToday,
    shiftCalendarMonth,
    formatCalendarKeyForDate,
    getCalendarSelectedKey,
} from './calendarView.js';
import { renderInbox } from './inboxView.js';
import { attachDragDropImport } from './exportImport.js';
import { exportToJson, openImportPicker } from './jsonImportExport.js';
import { maybeStartFirstRunTour, startCoachmarkTour } from './coachmark.js';
import { startWelcomeCarousel, isMobileCarouselViewport } from './welcomeCarousel.js';
import { supabase } from './supabaseClient.js';
import { wipeLocalUserDataOnSignOut } from './migration.js';
import {
    initInjectConfig,
    initInjectTargets,
    showInjectSettingsModal,
} from './inject.js';
import { placeViewerCard, setViewerCardTapHandler } from './todoMdViewer.js';
import { isMobileViewport } from './viewport.js';
import { openCompletedMobileSheet, openViewerMobileSheet, isAnyMobileSheetOpen } from './mobileSheets.js';
import button from './addProj_button.svg';

// Hydrate the inject config cache from localStorage before any inject
// button gets rendered — buildToDoRow / showDescEditorModal both call
// isInjectConfigured() at render time, which reads the cached values.
initInjectConfig();

// Inject the applyActiveView back-edge into the calendar module so
// jumpToProjectTodo can switch to the Projects view without a circular
// import (applyActiveView lives here and itself calls renderCalendarView).
initCalendarView({ applyActiveView });

// touch: verify SW revisioning 2026-05-31 //

// Apply the saved theme during import, before component() — sets data-theme
// on <html> before any rendering happens. See theme.js for the persistence
// key, the matchMedia fallback, and the toggle button factory.
applyTheme(resolveInitialTheme());


// The projects sidebar is a slide-in overlay drawer at every breakpoint
// (see component() and style.css). The legacy desktop "icon rail vs. full
// column" presentation and its `todoapp_sidebarRail` preference have been
// retired; drop the now-meaningless key on load so it doesn't linger in
// storage for existing users.
try {
    localStorage.removeItem('todoapp_sidebarRail');
} catch (e) { /* ignore private-mode / quota */ }


// Sync the rail-mode initial chip and hover tooltip on a project row from
// its current name. The chip uses the first non-whitespace character
// uppercased; the title attribute holds the full name and drives the
// custom 300ms-delay tooltip via CSS. Empty / whitespace names fall back
// to "?" so the chip never collapses to zero width.
function applyProjectInitial(projChild, name) {
    if (!projChild) return;
    const trimmed = (name || '').trim();
    const initial = trimmed.length > 0 ? trimmed.charAt(0).toUpperCase() : '?';
    projChild.setAttribute('data-initial', initial);
    projChild.setAttribute('data-project-name', trimmed);
    projChild.setAttribute('title', trimmed);
}


function component() {


    // GLOBAL VARIABLES


    console.log("Initialized DOM");

    const base = document.createElement('div');
    const nav = document.createElement('div');
    const main = document.createElement('div');
    const foot = document.createElement('div');

    const main1 = document.createElement('div');
    const main2 = document.createElement('div');

    const sideTitle = document.createElement('div');
    const sideMain = document.createElement('div');

    const addProj = document.createElement('div');
    const projButton = document.createElement('div');

    const mainList = document.createElement('div');

    const sidebarToggle  = document.createElement('button');
    const sidebarOverlay = document.createElement('div');

    base.id ='outerContainer';
    nav.id = 'navBar';
    main.id = 'mainSec';
    foot.id = 'footBar';

    main1.id = 'sideBar';
    main2.id = 'mainBar';
    // Seed the CSS routing attribute at creation so #mainBar never sits in
    // the DOM without a data-view value. Without this seed, there is a
    // window between component() returning and applyActiveView() running
    // where the attribute is unset; if any later code path checks the
    // attribute during that window, the mobile tab bar's .active class
    // and the data-view attribute can drift out of sync, leaving
    // #mobileProjHeader hidden by the [data-view="inbox"] / "calendar"
    // rules even when the Projects tab is the active mobile tab.
    // applyActiveView() remains the canonical writer for subsequent flips.
    main2.dataset.view = 'projects';
    // Mirror the routing attribute onto <body> as well. At desktop widths the
    // workspace pill + counts are lifted out of #mainBar into #navBar, so the
    // #mainBar[data-view] rules that hide them in INBOX / CALENDAR no longer
    // reach them; body[data-view] gives a hook that still does. applyActiveView
    // keeps the two in lockstep on every flip.
    document.body.dataset.view = 'projects';

    sideTitle.id = 'sideTit';
    sideMain.id = 'sideMa';

    addProj.id = 'addProj';
    projButton.id = 'projButton';
    // tabindex makes the "+" reachable as a keyboard target when the user
    // arrow-navigates past the last project row (sideMa keydown handler
    // below) and so its own keydown listener can fire on Enter / ArrowUp.
    projButton.setAttribute('tabindex', '0');
    projButton.setAttribute('role', 'button');
    projButton.setAttribute('aria-label', 'Add new project');

    mainList.id = 'mainList';
    // Bridge description panels and the COMPLETED section so they can't
    // simultaneously expand and visually collide. See the helper for the
    // full contract — the listener attaches in capture phase so it can run
    // before the original descToggle / completedHeader click handlers.
    wireExclusiveCompletedDescCollapse(mainList);
    // Single delegated handler for the per-row status badges. One listener on
    // the list parent (rather than a per-row binding) avoids the double-fire
    // that module-level registration can hit under the entry-bundle re-eval.
    wireStatusLabelDelegation(mainList);

    sidebarToggle.id        = 'sidebarToggle';
    sidebarToggle.type      = 'button';
    sidebarToggle.innerHTML = '☰';
    sidebarToggle.setAttribute('aria-label', 'Toggle projects sidebar');

    sidebarOverlay.id = 'sidebarOverlay';

    // sidebarToggle lives in the nav so the global controls (hamburger left,
    // ghost right) share one horizontal band. The breadcrumb row below then
    // reads as a clean second row of project-scoped chrome. The sidebar is an
    // overlay drawer at every breakpoint, so the nav-anchored toggle slides
    // the same drawer in/out on desktop and mobile alike.

    // ── ghost menu trigger (far right of nav) ──
    // Single 36px ghost icon button replaces the previous save/import/kebab
    // cluster. Clicking it opens a dropdown with Theme and Toggle floating
    // ghost rows. The trigger itself stays anchored to the top-right; the
    // floating-ghost companion (toggled from inside the menu) is the one
    // that drifts around the viewport. A subtle hover-pulse animation on
    // the trigger hints first-time users that it's clickable — see
    // #settingsToggle keyframes in style.css.

    // ── pomodoro clock icon (sits left of the ghost menu trigger) ──
    // Single 36px clock icon button. Click opens a small popover with mode
    // tabs (Focus / Short / Long), an inline-editable MM:SS countdown, and
    // Start / Pause / Reset controls. While a session is running the icon
    // recolors to the accent and the SVG minute hand sweeps clockwise over
    // the session duration as ambient progress feedback. The popover follows
    // the same dismissal vocabulary as the settings menu (outside click,
    // Escape, icon re-click). The actual state machine + audio + favicon
    // swap + tab-title flash live in pomodoro.js.
    const pomodoroToggle = document.createElement('button');
    pomodoroToggle.id   = 'pomodoroToggle';
    pomodoroToggle.type = 'button';
    pomodoroToggle.setAttribute('aria-haspopup', 'dialog');
    pomodoroToggle.setAttribute('aria-expanded', 'false');
    pomodoroToggle.setAttribute('aria-label', 'Open Pomodoro timer');
    pomodoroToggle.title = 'Pomodoro';
    // Stroke-based stopwatch glyph: crown bar + top stem, an upper-right
    // side stem button, a circular dial, and a single minute hand. The hand
    // pivots around the dial center (12, 14) as the session progresses.
    pomodoroToggle.innerHTML =
        '<svg class="clockIcon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<line x1="10" y1="3" x2="14" y2="3"/>' +
        '<line x1="12" y1="3" x2="12" y2="7"/>' +
        '<line x1="17" y1="8.5" x2="18.5" y2="7"/>' +
        '<circle cx="12" cy="14" r="7"/>' +
        '<g class="clockIconHand" transform="rotate(0 12 14)">' +
        '<line x1="12" y1="14" x2="12" y2="9"/>' +
        '</g>' +
        '</svg>' +
        // Inline countdown, hidden until a session is running/paused (CSS keys
        // off the button's data-pomo-status). Populated by syncPomodoroIcon.
        '<span class="pomodoroCountdownInline" aria-hidden="true"></span>';

    function getPomodoroController() {
        return ensurePomodoro();
    }

    createPomodoroUI({ pomodoroToggle });

    // ── focus-music button (sits between pomodoro and the ghost menu) ──
    // 36×36 button with a 5-bar equalizer glyph that animates while playing
    // and settles flat when paused or idle. Click opens an anchored popover
    // hosting the YouTube IFrame Player iframe + station picker. The popover
    // is built once on first open and kept in the DOM (hidden via .open
    // class) on close so the iframe — and therefore the audio — survives.
    const musicToggle = document.createElement('button');
    musicToggle.id = 'musicToggle';
    musicToggle.type = 'button';
    musicToggle.setAttribute('aria-haspopup', 'dialog');
    musicToggle.setAttribute('aria-expanded', 'false');
    musicToggle.setAttribute('aria-label', 'Open focus music');
    musicToggle.title = 'Focus music';
    // Five bars rendered via inline spans — heights are fixed in the markup
    // so the visualizer reads even when the keyframe animation hasn't kicked
    // in (or is suppressed by prefers-reduced-motion). Animation is gated by
    // the parent button's data-music-status attribute via CSS.
    musicToggle.innerHTML =
        '<span class="musicVizBars" aria-hidden="true">' +
        '<span style="height:40%"></span>' +
        '<span style="height:80%"></span>' +
        '<span style="height:60%"></span>' +
        '<span style="height:90%"></span>' +
        '<span style="height:50%"></span>' +
        '</span>';

    function getMusicController() {
        return ensureMusic();
    }

    // Focus-music UI (now-playing strip + popover) lives in music.js alongside
    // the audio engine. The factory wires the toggle click, the controller
    // subscriptions, and the popover internally; it returns the now-playing
    // strip for component() to place in the layout below.
    const musicUI = createMusicUI({ musicToggle });

    // Pomodoro coordination stays here because it bridges two controllers:
    // pause music when an alert lands; resume on acknowledgment if the user
    // was playing before. Subscribed via the pure helper exported from
    // music.js so the coordination is independently testable.
    setTimeout(function() {
        const ctl = getMusicController();
        if (!ctl) return;
        const pomCtl = getPomodoroController();
        if (pomCtl) {
            pomCtl.subscribe(createPomodoroSubscriber(pomCtl, ctl));
        }
    }, 0);

    const settingsToggle = document.createElement('button');
    settingsToggle.id = 'settingsToggle';
    settingsToggle.type = 'button';
    settingsToggle.setAttribute('aria-haspopup', 'menu');
    settingsToggle.setAttribute('aria-expanded', 'false');
    settingsToggle.setAttribute('aria-label', 'Open menu');
    settingsToggle.title = 'Menu';
    settingsToggle.innerHTML =
        '<svg class="ghostIcon" viewBox="0 0 12 14" width="16" height="16" shape-rendering="crispEdges" aria-hidden="true">' +
        '<g class="ghostIconBody" fill="currentColor">' +
        '<rect x="3" y="0" width="6" height="1"/>' +
        '<rect x="2" y="1" width="8" height="1"/>' +
        '<rect x="0" y="2" width="12" height="10"/>' +
        '<rect x="0" y="12" width="2" height="2"/>' +
        '<rect x="3" y="12" width="2" height="2"/>' +
        '<rect x="6" y="12" width="2" height="2"/>' +
        '<rect x="9" y="12" width="2" height="2"/>' +
        '</g>' +
        '<g class="ghostIconEye">' +
        '<rect x="4" y="5" width="1" height="2"/>' +
        '<rect x="7" y="5" width="1" height="2"/>' +
        '</g>' +
        '</svg>';

    // Desktop settings-menu (gear dropdown) subsystem — extracted into
    // settingsMenu.js following the projectPicker.js closure-to-factory
    // pattern. The gear button (settingsToggle, built just above) is passed
    // in as a DOM node; the five view/render helpers the menu items call live
    // in main.js / component() and are injected (importing them back from
    // main.js would be circular). The factory imports the rest of its
    // dependencies (theme, companion, modals, inject, etc.) directly.
    const settingsMenu = createSettingsMenu({
        settingsToggle,
        applyActiveView,
        applyCompanionGhostPreference,
        rebuildAfterImport,
        seedSampleTodosIntoActiveProjectIfEmpty,
    });

    settingsToggle.addEventListener('click', function(event) {
        event.stopPropagation();
        settingsMenu.toggle();
    });

    nav.appendChild(sidebarToggle);
    nav.appendChild(pomodoroToggle);
    nav.appendChild(musicToggle);
    nav.appendChild(settingsToggle);

    // Header arrow-key navigation. ArrowLeft / ArrowRight walk focus
    // across the header controls (sidebarToggle → viewPillProjects
    // → viewPillInbox → viewPillCalendar → pomodoroToggle → musicToggle
    // → settingsToggle) so keyboard users can flow across the chrome
    // without tabbing. When the Calendar view is active, the walk also
    // includes calendarPrevBtn and calendarNextBtn between
    // viewPillCalendar and pomodoroToggle so the month-nav buttons stay
    // reachable; on other views they're hidden and skipped. The pill
    // references resolve at handler execution time, by which point
    // component() has finished initialising them. Bails when any
    // popover/modal is open so the in-popover focus management owns the
    // keystrokes; bails on any modifier so OS-level chords pass through.
    // stopPropagation keeps the document-level cross-pane handler from
    // also re-routing focus to a project row or new-task input.
    nav.addEventListener('keydown', function(e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        const order = [sidebarToggle, viewPillProjects, viewPillInbox, viewPillCalendar];
        if (getActiveView() === 'calendar') {
            order.push(calendarPrevBtn, calendarNextBtn);
        }
        order.push(pomodoroToggle, musicToggle, settingsToggle);
        const idx = order.indexOf(e.target);
        if (idx === -1) return;
        const nextIdx = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
        const nextBtn = order[nextIdx];
        if (!nextBtn) return;
        e.preventDefault();
        e.stopPropagation();
        nextBtn.focus();
    });

    // sidebarToggle ArrowDown — drop focus into the projects sidebar by
    // landing on the first project row. Mirrors the inverse transition the
    // sideMain ArrowUp handler already implements (top project →
    // sidebarToggle), so the boundary is symmetric: arrow up out of the
    // sidebar reaches the toggle, arrow down out of the toggle reaches the
    // sidebar. Without this, the document-level todo arrow-nav handler
    // catches the keystroke and lands focus on the first todo row in the
    // main pane instead — wrong target since the sidebar sits directly
    // below the toggle. stopPropagation keeps that document handler from
    // also firing.
    sidebarToggle.addEventListener('keydown', function(e) {
        if (e.key !== 'ArrowDown') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        const first = sideMain.querySelector('#projChild');
        if (first) first.focus();
    });

    // D2 — desktop two-pane shell. At desktop widths (≥1024px) #mainSplit lays
    // the main task pane and a persistent Claude chat pane side by side; the
    // Claude content node is relocated into #desktopChatPane by the sheet's
    // placeChatContent(). At mobile widths #mainSplit is display:contents, so
    // #mainSec keeps its #outerContainer grid-row, the chat pane is hidden, and
    // the chat lives in the slide-up sheet exactly as before.
    const mainSplit = document.createElement('div');
    mainSplit.id = 'mainSplit';

    // Desktop header consolidation — a thin sub-band that sits directly
    // beneath the top header (#navBar) at desktop widths and carries the
    // PROJECTS / INBOX / CALENDAR view tabs as underlined text (the pills
    // are restyled via CSS inside this container). Collapsed to a 0-height
    // display:none track on mobile, where the persistent #mobileTabBar is
    // the sole navigator. The #viewSwitcher tablist is relocated into it
    // below (it used to sit inside #navBar).
    const desktopViewSubBand = document.createElement('div');
    desktopViewSubBand.id = 'desktopViewSubBand';

    const desktopChatPane = document.createElement('div');
    desktopChatPane.id = 'desktopChatPane';
    desktopChatPane.setAttribute('aria-label', 'Claude assistant');

    // D3 — collapse/expand for the desktop chat pane. The collapse `›` seats at
    // the top-left of the pane (ahead of the relocated chat content); the expand
    // `‹` is a fixed tab on the right viewport edge, shown only while collapsed.
    // State rides body.chatPaneCollapsed and persists via prefs. Both controls
    // and the collapsed layout are desktop-only via CSS, so the class is inert at
    // mobile widths (the slide-up sheet ignores it). No resize handler is needed —
    // the media-query-scoped CSS does the breakpoint gating.
    const chatCollapseBtn = document.createElement('button');
    chatCollapseBtn.id = 'chatCollapseButton';
    chatCollapseBtn.type = 'button';
    chatCollapseBtn.setAttribute('aria-label', 'Collapse chat pane');
    chatCollapseBtn.textContent = '›';
    const chatExpandBtn = document.createElement('button');
    chatExpandBtn.id = 'chatExpandButton';
    chatExpandBtn.type = 'button';
    chatExpandBtn.setAttribute('aria-label', 'Expand chat pane');
    chatExpandBtn.textContent = '‹';
    function applyChatPaneCollapsed(collapsed) {
        document.body.classList.toggle('chatPaneCollapsed', collapsed);
        setChatPaneCollapsed(collapsed);
    }
    chatCollapseBtn.addEventListener('click', function() { applyChatPaneCollapsed(true); });
    chatExpandBtn.addEventListener('click', function() { applyChatPaneCollapsed(false); });
    // Seed the body class from the persisted pref before first paint so a
    // collapsed pane doesn't flash open on reload.
    document.body.classList.toggle('chatPaneCollapsed', isChatPaneCollapsed());

    desktopChatPane.appendChild(chatCollapseBtn);
    mainSplit.appendChild(main);
    mainSplit.appendChild(desktopChatPane);

    base.appendChild(nav);
    base.appendChild(musicUI.nowPlayingStrip);
    base.appendChild(mainSplit);
    // The view sub-band is placed by explicit grid-row (row 3) so its DOM
    // position among the grid children is free; append it after #mainSplit to
    // keep the nav → strip → main ordering the now-playing strip contract pins.
    base.appendChild(desktopViewSubBand);
    base.appendChild(chatExpandBtn);
    base.appendChild(foot);
    base.appendChild(sidebarOverlay);

    // Claude assistant launcher + sheet — the `⋯` launcher takes the
    // bottom-right slot the help `?` FAB used to hold. Help itself stays
    // reachable through the ghost menu's "Help" item and the global `?`
    // keypress. The launcher opens a bottom sheet on mobile and a docked
    // right-hand panel on wider viewports; CSS hides the launcher while
    // another modal / popover is open via the body:has(...) rules.
    mountClaudeSheet(base);

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
    // Three destinations — Projects, Today, Calendar — pinned to the
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

    function buildMobileTab(viewKey, label, iconSvg) {
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
        text.textContent = label;
        btn.appendChild(icon);
        btn.appendChild(text);
        btn.addEventListener('click', function() {
            applyActiveView(viewKey);
        });
        return btn;
    }

    // Inline SVG icons (24×24, currentColor stroke) — no icon library per
    // CLAUDE.md. List, inbox-tray, and calendar glyphs. Built from <rect>
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
    const ICON_INBOX =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M4 13 L8 13 L9.5 16 L14.5 16 L16 13 L20 13"/>' +
        '<path d="M4 13 L6.5 5 L17.5 5 L20 13 L20 19 L4 19 Z"/>' +
        '</svg>';
    const ICON_CALENDAR =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="3" y="5" width="18" height="16" rx="2"/>' +
        '<line x1="3" y1="10" x2="21" y2="10"/>' +
        '<line x1="8" y1="3" x2="8" y2="7"/>' +
        '<line x1="16" y1="3" x2="16" y2="7"/>' +
        '</svg>';

    const mobileTabProjects = buildMobileTab('projects', 'Projects', ICON_LIST);
    const mobileTabInbox    = buildMobileTab('inbox',    'Inbox',    ICON_INBOX);
    const mobileTabCalendar = buildMobileTab('calendar', 'Calendar', ICON_CALENDAR);
    mobileTabProjects.id = 'mobileTabProjects';
    mobileTabInbox.id    = 'mobileTabInbox';
    mobileTabCalendar.id = 'mobileTabCalendar';

    mobileTabBar.appendChild(mobileTabProjects);
    mobileTabBar.appendChild(mobileTabInbox);
    mobileTabBar.appendChild(mobileTabCalendar);
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

    // Footer — version label on the left, open/done counts for the selected
    // project on the right. Counts are recomputed by a MutationObserver that
    // watches #mainList (todo add/remove, .completed toggle) and #sideMa
    // (project selection class change), so they stay in sync without needing
    // hand-wired calls at every mutation site.
    const footVersion = document.createElement('span');
    const footCounts  = document.createElement('div');
    const footOpen    = document.createElement('span');
    const footDone    = document.createElement('span');

    footVersion.id = 'footVersion';
    footVersion.setAttribute('role', 'button');
    footVersion.setAttribute('tabindex', '0');
    footVersion.setAttribute('aria-haspopup', 'dialog');
    footVersion.setAttribute('aria-label', 'Open changelog');

    const footVersionLabel = document.createElement('span');
    footVersionLabel.id = 'footVersionLabel';
    footVersionLabel.textContent = 'task management v1.1';

    const changelogDot = document.createElement('span');
    changelogDot.id = 'changelogDot';
    changelogDot.setAttribute('aria-hidden', 'true');

    footVersion.appendChild(footVersionLabel);
    footVersion.appendChild(changelogDot);

    footVersion.addEventListener('click', function () {
        if (applyPendingUpdate()) return;
        showChangelogModal();
    });
    footVersion.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (applyPendingUpdate()) return;
            showChangelogModal();
        }
    });

    footCounts.id = 'footCounts';
    footOpen.id = 'footOpen';
    footDone.id = 'footDone';
    footOpen.textContent = '0 OPEN';
    footDone.textContent = '0 DONE';

    foot.appendChild(footVersion);

    footCounts.appendChild(footOpen);
    footCounts.appendChild(footDone);
    foot.appendChild(footCounts);

    // Initial unseen-indicator paint — deferred so the dot element is in the DOM.
    setTimeout(updateChangelogDot, 0);

    main.appendChild(main1);
    main.appendChild(main2);

    // Sidebar layout (flex column):
    //   sideTitle  — top: empty drawer header on mobile (holds the close X
    //                button; hidden via CSS on desktop). The PROJECTS label
    //                that used to live here moved out — the view-switch
    //                pills now sit in the top nav, and the project list
    //                begins directly at the sidebar's top padding.
    //   sideMain   — middle: scrollable project rows
    //   addProj    — bottom: "+" add-project button. In rail mode the button
    //                renders with a dashed border; in full mode it stays a
    //                solid surface chip.
    // On mobile (≤1023px) the sidebar splits into two equal halves via the
    // #sidebarTop / #sidebarBottom wrappers so the projects block
    // bottom-anchors to the vertical midpoint instead of pinning to the
    // top — the View/Appearance/footer block then top-anchors at the
    // midpoint. Desktop treats #sidebarTop as a flex:1 1 auto growth
    // region and #sidebarBottom is visually inert (its children are
    // display:none above 1023px), so desktop layout is unchanged.
    const sidebarTop = document.createElement('div');
    const sidebarBottom = document.createElement('div');
    sidebarTop.id = 'sidebarTop';
    sidebarBottom.id = 'sidebarBottom';
    main1.appendChild(sidebarTop);
    main1.appendChild(sidebarBottom);

    sidebarTop.appendChild(sideTitle);
    sidebarTop.appendChild(sideMain);
    sidebarTop.appendChild(addProj);

    addProj.appendChild(projButton);

    // ── mobile project header (STACK layout) ──
    // On the ≤1023px breakpoint the layout shifts to a STACK pattern: the
    // active project name renders as a screen-level header above the todo
    // list, with a "PROJECT N OF M" label, open/done counts, and a
    // swipe-on-title gesture (flanked by ‹ / › chevron affordances) that
    // jumps between projects. Hidden on desktop via CSS — desktop relies on
    // the sidebar rail/full pattern to surface the active project name. The
    // header rebuilds via the same MutationObserver path that drives the
    // footer counts so its label, counts, and chevron enable state stay in
    // sync without explicit calls from mutation sites.
    const mobileProjHeader   = document.createElement('div');
    const mobileProjLabel    = document.createElement('div');
    const mobileProjTitleRow = document.createElement('div');
    const mobileProjPrev     = document.createElement('button');
    const mobileProjName     = document.createElement('div');
    const mobileProjNext     = document.createElement('button');
    const mobileProjStats    = document.createElement('div');
    const mobileProjCounts   = document.createElement('div');
    const mobileProjOpen     = document.createElement('span');
    const mobileProjDone     = document.createElement('span');

    mobileProjHeader.id   = 'mobileProjHeader';
    mobileProjLabel.id    = 'mobileProjLabel';
    mobileProjTitleRow.id = 'mobileProjTitleRow';
    mobileProjPrev.id     = 'mobileProjPrev';
    mobileProjName.id     = 'mobileProjName';
    mobileProjNext.id     = 'mobileProjNext';
    mobileProjStats.id    = 'mobileProjStats';
    mobileProjCounts.id   = 'mobileProjCounts';
    mobileProjOpen.id     = 'mobileProjOpen';
    mobileProjDone.id     = 'mobileProjDone';

    mobileProjOpen.textContent = '0 open';
    mobileProjDone.textContent = '0 done';

    mobileProjPrev.type = 'button';
    mobileProjNext.type = 'button';
    mobileProjPrev.className = 'mobileProjChev';
    mobileProjNext.className = 'mobileProjChev';
    mobileProjPrev.textContent = '‹'; // ‹
    mobileProjNext.textContent = '›'; // ›
    mobileProjPrev.setAttribute('aria-label', 'Previous project');
    mobileProjNext.setAttribute('aria-label', 'Next project');

    mobileProjCounts.appendChild(mobileProjOpen);
    mobileProjCounts.appendChild(mobileProjDone);
    mobileProjStats.appendChild(mobileProjCounts);
    mobileProjTitleRow.appendChild(mobileProjPrev);
    mobileProjTitleRow.appendChild(mobileProjName);

    // Dense-mobile-header affordance (≤1023px only — hidden on desktop
    // via CSS): the ▾ chevron next to the project name advertises the
    // dropdown that opens the drawer (project picker). It lives in the
    // DOM at every viewport but the desktop styles keep it display:none
    // so the legacy ‹ › carousel pattern stays untouched above 1023px.
    const mobileProjChevron = document.createElement('span');
    mobileProjChevron.id = 'mobileProjChevron';
    mobileProjChevron.className = 'mobileProjDropdownChev';
    mobileProjChevron.setAttribute('aria-hidden', 'true');
    mobileProjChevron.textContent = '▾';

    mobileProjTitleRow.appendChild(mobileProjChevron);
    mobileProjTitleRow.appendChild(mobileProjNext);
    mobileProjHeader.appendChild(mobileProjLabel);
    mobileProjHeader.appendChild(mobileProjTitleRow);
    mobileProjHeader.appendChild(mobileProjStats);

    // Tap on name/chevron opens the drawer (the project picker on
    // mobile). Desktop ignores the gesture because the drawer pattern is
    // mobile-only, but the listener is harmless above 1023px.
    function openMobileDrawer() {
        if (!main1.classList.contains('sidebar-open')) {
            main1.classList.add('sidebar-open');
            if (typeof window.bottomSheetRefreshVisibility === 'function') {
                window.bottomSheetRefreshVisibility();
            }
        }
    }

    // ── desktop project-picker dropdown (≥1024px) ──
    // At desktop widths the slide-in drawer is replaced by an anchored
    // dropdown menu that opens directly below the project pill. It reads
    // the SAME project list + counts the drawer uses (listLogic), so the
    // two surfaces never drift, and routes a row click through the same
    // project-selection path the drawer's rows use (navigateToProjectByIndex
    // → #projChild.click()). The drawer stays the mobile (<1024px) trigger,
    // untouched. The element lives on document.body and is positioned off
    // the pill's bounding rect each time it opens.
    const projectPickerDropdown = document.createElement('div');
    projectPickerDropdown.id = 'projectPickerDropdown';
    projectPickerDropdown.setAttribute('role', 'menu');
    projectPickerDropdown.setAttribute('aria-hidden', 'true');
    document.body.appendChild(projectPickerDropdown);

    // Construct the desktop project-picker dropdown subsystem. The picker's
    // DOM nodes are built above and injected here, along with the component()
    // functions it calls (navigateToProjectByIndex / updateFooterCounts are
    // hoisted component() closures defined later; applyProjectInitial is
    // top-level in main.js). They are injected, never imported back from
    // main.js, so the module stays free of a circular dependency.
    const projectPicker = createProjectPicker({
        projectPickerDropdown,
        mobileProjName,
        mobileProjHeader,
        mobileProjChevron,
        sideMain,
        navigateToProjectByIndex,
        updateFooterCounts,
        applyProjectInitial,
    });

    // Single entry point for activating the project picker from the pill —
    // branches on viewport width so there is one click binding, not two:
    // desktop opens the anchored dropdown, mobile opens the slide-in drawer.
    function activateProjectPicker() {
        if (window.innerWidth >= 1024) {
            projectPicker.toggle();
        } else {
            openMobileDrawer();
        }
    }

    // Dismiss the dropdown on outside click (the pill itself is excluded — its
    // own handler toggles) and on Escape. The resize-to-mobile dismissal and the
    // open-state repositioning live inside the picker factory (which owns
    // positionProjectPicker); these two document-level dismissers route through
    // the picker's public API.
    document.addEventListener('click', function(e) {
        if (!projectPicker.isOpen()) return;
        if (projectPickerDropdown.contains(e.target)) return;
        if (mobileProjHeader.contains(e.target)) return;
        projectPicker.close();
    });
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        if (!projectPicker.isOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        projectPicker.close();
    }, true);

    mobileProjName.addEventListener('click', activateProjectPicker);
    mobileProjChevron.addEventListener('click', activateProjectPicker);

    // Make the whole pill clickable, not just the name + ▾ glyphs. At desktop
    // the header is a padded pill (D1c) whose body looked clickable (cursor:
    // pointer) but had no handler, so clicks landing on the padding / pill
    // background did nothing. Bind activation to the header itself so the
    // padding works too. The ‹ › carousel chevrons navigate prev/next project
    // at mobile and must NOT activate the picker, so ignore clicks from them.
    //
    // #mobileProjName and #mobileProjChevron carry their OWN click→activate
    // handlers (above), and they bubble up to this header listener too. With
    // the desktop dropdown, activation toggles (open ↔ close), so letting both
    // the direct handler and this bubbled one fire would toggle twice for a
    // single click — opening then immediately closing it. That double fire was
    // the "only opens sometimes" race: clicks on the padding fired once and
    // opened, clicks on the text fired twice and cancelled out. Skip here when
    // the click originated on the name or the ▾ chevron so exactly one toggle
    // runs per click regardless of where on the pill the click lands.
    mobileProjHeader.addEventListener('click', function(event) {
        if (!event.target.closest) return activateProjectPicker();
        if (event.target.closest('.mobileProjChev')) return;
        if (event.target.closest('#mobileProjName, #mobileProjChevron')) return;
        activateProjectPicker();
    });

    // ── top-level view switcher (Today / Projects) ──
    // Pill bar in the top nav (anchored immediately right of the
    // hamburger) toggles between the Today dashboard shell and the
    // existing project view. The active view is persisted in
    // localStorage under `todoapp_active_view` and restored on load;
    // the pill click handlers below route through applyActiveView so
    // the same code path runs for user clicks, initial restore, and
    // the auto-switch fired when a project row is clicked. The actual
    // show/hide is driven by a `data-view` attribute on #mainBar so
    // CSS can swap surfaces without per-element style writes. The
    // pills are inserted into `nav` after main2's children are wired
    // up below; insertBefore(pomodoroToggle) leaves the right-side
    // icon cluster's existing order untouched.
    const viewSwitcher = document.createElement('div');
    viewSwitcher.id = 'viewSwitcher';
    viewSwitcher.setAttribute('role', 'tablist');
    viewSwitcher.setAttribute('aria-label', 'Switch view');

    const viewPillInbox = document.createElement('button');
    viewPillInbox.id = 'viewPillInbox';
    viewPillInbox.type = 'button';
    viewPillInbox.className = 'viewPill';
    viewPillInbox.setAttribute('role', 'tab');
    viewPillInbox.setAttribute('aria-pressed', 'false');
    viewPillInbox.textContent = 'INBOX';

    const viewPillProjects = document.createElement('button');
    viewPillProjects.id = 'viewPillProjects';
    viewPillProjects.type = 'button';
    viewPillProjects.className = 'viewPill';
    viewPillProjects.setAttribute('role', 'tab');
    viewPillProjects.setAttribute('aria-pressed', 'false');
    viewPillProjects.textContent = 'PROJECTS';

    const viewPillCalendar = document.createElement('button');
    viewPillCalendar.id = 'viewPillCalendar';
    viewPillCalendar.type = 'button';
    viewPillCalendar.className = 'viewPill';
    viewPillCalendar.setAttribute('role', 'tab');
    viewPillCalendar.setAttribute('aria-pressed', 'false');
    viewPillCalendar.textContent = 'CALENDAR';

    viewSwitcher.appendChild(viewPillProjects);
    viewSwitcher.appendChild(viewPillInbox);
    viewSwitcher.appendChild(viewPillCalendar);

    viewPillInbox.addEventListener('click', function() {
        applyActiveView('inbox');
    });
    viewPillProjects.addEventListener('click', function() {
        applyActiveView('projects');
    });
    viewPillCalendar.addEventListener('click', function() {
        applyActiveView('calendar');
    });

    // ArrowDown drop-in from any of the three view pills into the visible
    // main pane. Mirrors the sidebarToggle → first project row transition
    // for the spatially-adjacent content directly beneath the pills. The
    // destination depends on the currently active view so the keystroke
    // lands on rendered items rather than a hidden node:
    //   • PROJECTS — the blank-placeholder #toDoInput in #mainList (or
    //     #emptyStateInput when the project is empty, or the first
    //     committed #toDoChild row as a last resort).
    //   • TODAY    — the first .todayRow.todoRowCard div in #inboxSections.
    //     Lands on the row container (tabindex="-1"), not the inner
    //     .todayRowTitle button, so the subsequent ArrowDown advances rows
    //     via the document-level Today nav handler instead of being eaten
    //     by the "anchor focus to the row container" branch.
    //   • CALENDAR — the selected (.isSelected) .calendarCell, falling
    //     back to the first in-month cell (.calendarCell:not(.outOfMonth))
    //     so the cold-start case (no prior selection) lands inside the
    //     visible month rather than on a leading day from the prior month.
    // Without these handlers the document-level todo arrow-nav handler at
    // best lands focus on a stale .todo-active row and at worst silently
    // no-ops — leaving the rendered items unreachable from the header
    // chrome. stopPropagation keeps that document handler from also firing
    // and clobbering the focus we just placed.
    function dropFocusIntoMainView(e) {
        if (e.key !== 'ArrowDown') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        // Calendar pill drops focus onto the month-nav arrow pair
        // first rather than straight into the grid, so the arrows are
        // reachable from the keyboard. The arrows then own their own
        // ArrowDown drop-in into the grid using the same fallback chain
        // as firstFocusableInActiveMainView's calendar branch.
        if (e.target === viewPillCalendar && getActiveView() === 'calendar') {
            e.preventDefault();
            e.stopPropagation();
            calendarPrevBtn.focus();
            return;
        }
        const target = firstFocusableInActiveMainView();
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        // For TODAY, mark the row .todo-active so the document-level Today
        // nav handler treats it as the current row on the next keystroke
        // instead of re-anchoring from "no current row → first row".
        if (target.classList && target.classList.contains('todayRow')) {
            const sections = document.getElementById('inboxSections');
            if (sections) {
                sections.querySelectorAll('.todayRow.todoRowCard.todo-active').forEach(function(el) {
                    if (el !== target) el.classList.remove('todo-active');
                });
            }
            target.classList.add('todo-active');
        }
        target.focus();
    }
    viewPillProjects.addEventListener('keydown', dropFocusIntoMainView);
    viewPillInbox.addEventListener('keydown', dropFocusIntoMainView);
    viewPillCalendar.addEventListener('keydown', dropFocusIntoMainView);

    // ── Today dashboard shell ──
    // Date header, count summary, overdue/today/upcoming sections, and
    // an empty state that only shows when every bucket is empty. The
    // shell sits in the main panel alongside the project view and
    // toggles via #mainBar's data-view attribute so neither view
    // re-renders the other on switch.
    const inboxView = document.createElement('div');
    inboxView.id = 'inboxView';

    const inboxDateHeader = document.createElement('div');
    inboxDateHeader.id = 'inboxDateHeader';

    const inboxCountSummary = document.createElement('div');
    inboxCountSummary.id = 'inboxCountSummary';

    const inboxEmpty = document.createElement('div');
    inboxEmpty.id = 'inboxEmpty';
    inboxEmpty.textContent = 'No items due yet — add a todo from any project to see it here';

    // Mobile-only ghost spacer that anchors the Today view when the bucket
    // counts are short. The .viewGhostSpacer rule is gated to ≤1023px in
    // style.css, so the element is inert on desktop. flex:1 fills the
    // remaining vertical column inside #inboxView (which is already
    // flex-direction: column), centering the ghost + caption in whatever
    // space is left below the date header / counts / sections. The
    // companion-ghost preference applies via the body class set in
    // applyCompanionGhostPreference — it hides the painted ghost while
    // leaving the spacer's reserved space intact so the layout doesn't
    // shift when the user toggles it.
    const inboxGhostSpacer = document.createElement('div');
    inboxGhostSpacer.id = 'inboxGhostSpacer';
    inboxGhostSpacer.className = 'viewGhostSpacer';
    inboxGhostSpacer.setAttribute('aria-hidden', 'true');
    const inboxGhostMascot = document.createElement('div');
    inboxGhostMascot.className = 'viewGhostMascot';
    const inboxGhostCaption = document.createElement('div');
    inboxGhostCaption.className = 'viewGhostCaption';
    inboxGhostCaption.textContent = 'Nothing else due';
    inboxGhostSpacer.appendChild(inboxGhostMascot);
    inboxGhostSpacer.appendChild(inboxGhostCaption);

    inboxView.appendChild(inboxDateHeader);
    inboxView.appendChild(inboxCountSummary);
    inboxView.appendChild(inboxEmpty);
    inboxView.appendChild(inboxGhostSpacer);

    // ── Calendar view shell ──
    // Month grid on the left + day-detail panel on the right. The grid
    // renders 7 columns × 5-6 rows including leading/trailing days from
    // adjacent months; clicking a cell selects that date and re-renders
    // the day-detail panel. The panel reuses buildTodayRow with
    // { hideDuePill: true } so the row layout matches the Today view
    // sans the redundant date pill (the date is implied by selection).
    // Calendar visible-month + selected-date state lives in module-level
    // vars (calendarVisibleYear/Month/SelectedDate) so the prev/next
    // buttons and cell-click handlers can mutate them without threading
    // refs through every callback.
    const calendarView = document.createElement('div');
    calendarView.id = 'calendarView';

    const calendarGridSide = document.createElement('div');
    calendarGridSide.id = 'calendarGridSide';

    const calendarHeader = document.createElement('div');
    calendarHeader.id = 'calendarHeader';

    const calendarPrevBtn = document.createElement('button');
    calendarPrevBtn.type = 'button';
    calendarPrevBtn.id = 'calendarPrev';
    calendarPrevBtn.className = 'calendarNavBtn';
    calendarPrevBtn.setAttribute('aria-label', 'Previous month');
    calendarPrevBtn.textContent = '‹';

    const calendarMonthLabel = document.createElement('div');
    calendarMonthLabel.id = 'calendarMonthLabel';

    const calendarNextBtn = document.createElement('button');
    calendarNextBtn.type = 'button';
    calendarNextBtn.id = 'calendarNext';
    calendarNextBtn.className = 'calendarNavBtn';
    calendarNextBtn.setAttribute('aria-label', 'Next month');
    calendarNextBtn.textContent = '›';

    calendarHeader.appendChild(calendarPrevBtn);
    calendarHeader.appendChild(calendarMonthLabel);
    calendarHeader.appendChild(calendarNextBtn);

    const calendarDowRow = document.createElement('div');
    calendarDowRow.id = 'calendarDowRow';
    ['S','M','T','W','T','F','S'].forEach(function(c, idx) {
        const cell = document.createElement('div');
        cell.className = 'calendarDowCell';
        cell.textContent = c;
        cell.setAttribute('data-dow', String(idx));
        calendarDowRow.appendChild(cell);
    });

    const calendarGrid = document.createElement('div');
    calendarGrid.id = 'calendarGrid';

    calendarGridSide.appendChild(calendarHeader);
    calendarGridSide.appendChild(calendarDowRow);
    calendarGridSide.appendChild(calendarGrid);

    const calendarPanel = document.createElement('div');
    calendarPanel.id = 'calendarDayPanel';
    const calendarPanelHeader = document.createElement('h3');
    calendarPanelHeader.id = 'calendarDayHeader';
    const calendarPanelCount = document.createElement('div');
    calendarPanelCount.id = 'calendarDayCount';
    const calendarPanelList = document.createElement('div');
    calendarPanelList.id = 'calendarDayList';
    calendarPanel.appendChild(calendarPanelHeader);
    calendarPanel.appendChild(calendarPanelCount);
    calendarPanel.appendChild(calendarPanelList);

    calendarView.appendChild(calendarGridSide);
    calendarView.appendChild(calendarPanel);

    calendarPrevBtn.addEventListener('click', function() {
        shiftCalendarMonth(-1);
    });
    calendarNextBtn.addEventListener('click', function() {
        shiftCalendarMonth(1);
    });

    // Arrow-key navigation for the calendar month-nav pair. The buttons
    // form an isolated horizontal pair reached vertically via ArrowDown
    // from #viewPillCalendar: ArrowLeft/ArrowRight traverse between
    // calendarPrev and calendarNext as the inter-arrow path; on the
    // matching-direction edge (ArrowLeft on calendarPrev, ArrowRight on
    // calendarNext) the keystroke activates the button instead of
    // clamping, advancing or retreating the visible month via the
    // existing click handler. Focus stays on the same arrow afterward
    // because renderCalendarView() only rebuilds #calendarGrid, not
    // the header that owns these buttons. ArrowUp returns to
    // #viewPillCalendar; ArrowDown drops into the grid using the same
    // fallback chain as firstFocusableInActiveMainView's calendar branch.
    // The buttons live inside #calendarView (not #nav), so their keydown
    // never bubbles to the nav listener — they need their own handler.
    // The nine-control walk order documented here mirrors the nav
    // handler's extended order when the active view is calendar.
    // Bails on modifier chords and while any modal/popover is open;
    // bails entirely when the active view is not calendar so the
    // listeners no-op for views where the buttons are hidden.
    // preventDefault + stopPropagation keep the document-level
    // cross-pane handler from also firing.
    function calendarNavArrowKey(e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' &&
            e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        if (getActiveView() !== 'calendar') return;
        const order = [sidebarToggle, viewPillProjects, viewPillInbox, viewPillCalendar, calendarPrevBtn, calendarNextBtn, pomodoroToggle, musicToggle, settingsToggle];
        if (order.indexOf(e.target) === -1) return;
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            viewPillCalendar.focus();
            return;
        }
        if (e.key === 'ArrowDown') {
            const target = firstFocusableInActiveMainView();
            if (!target) return;
            e.preventDefault();
            e.stopPropagation();
            target.focus();
            return;
        }
        if (e.key === 'ArrowRight') {
            e.preventDefault();
            e.stopPropagation();
            if (e.target === calendarPrevBtn) calendarNextBtn.focus();
            else if (e.target === calendarNextBtn) calendarNextBtn.click();
            return;
        }
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            if (e.target === calendarNextBtn) calendarPrevBtn.focus();
            else if (e.target === calendarPrevBtn) calendarPrevBtn.click();
            return;
        }
    }
    calendarPrevBtn.addEventListener('keydown', calendarNavArrowKey);
    calendarNextBtn.addEventListener('keydown', calendarNavArrowKey);

    // The view tabs ride in the desktop sub-band beneath the top header, not
    // in #navBar. They are desktop-only (display:none on mobile, where
    // #mobileTabBar owns navigation), so a single permanent home in the
    // sub-band is correct at every breakpoint.
    desktopViewSubBand.appendChild(viewSwitcher);
    const taskFilterBar = buildTaskFilterBar();

    main2.appendChild(inboxView);
    main2.appendChild(calendarView);
    main2.appendChild(mobileProjHeader);
    // Status filter pills (ALL / Active / Ideas) sit above the list — below the
    // mobile project header, above the compose row inside #mainList. Built once
    // here and never cleared by the list's rebuild cycles; the render paths in
    // toDoRow.js call applyTaskFilter() after each rebuild to refresh counts and
    // row visibility.
    main2.appendChild(taskFilterBar);
    main2.appendChild(mainList);
    applyTaskFilter();

    // ── mobile drawer close (X) button ──
    // Adds an explicit dismiss affordance to the sidebar drawer at the
    // ≤1023px breakpoint so the modal-style three-way close vocabulary
    // (X button, backdrop tap, Escape) is fully covered. Hidden on
    // desktop via CSS — the sidebar there is a persistent rail/full
    // pane, not a modal drawer.
    const mobileSidebarClose = document.createElement('button');
    mobileSidebarClose.id   = 'mobileSidebarClose';
    mobileSidebarClose.type = 'button';
    mobileSidebarClose.setAttribute('aria-label', 'Close projects drawer');
    mobileSidebarClose.innerHTML = '×';
    sideTitle.appendChild(mobileSidebarClose);

    // Bulk description control — single toggle anchored to the right end of
    // the top add-task row. Lives as an absolutely-positioned overlay inside
    // #mainBar so the list can scroll beneath it without dragging the button
    // along. Clicks are dispatched to each row's own #descToggle so the
    // per-row switcher state in wireDescToggle stays in sync with the DOM.
    //
    // The per-project "Sort by due" toggle rides in the same wrapper to
    // the LEFT of Expand All; it persists on the project record via
    // listLogic and re-renders the active project's rows on flip.
    // Task-list controls overlay anchored at the top-right of the list. Hosts
    // the Sort dropdown (None / Due date / Status). Hidden on mobile via CSS —
    // the drawer's "Expand all descriptions" toggle owns that surface there.
    const bulkDescActions = document.createElement('div');
    bulkDescActions.id = 'bulkDescActions';

    // ── Sort dropdown ──
    // Replaces the former per-project "Sort by due" checkbox and the "Expand
    // All" button. The choice is GLOBAL across projects (prefs todoapp_taskSort)
    // and a pure render concern: selecting a sort reorders the visible rows
    // only — the manual `pos` order is never touched, so picking None restores
    // the hand-arranged order. The menu reuses the #projContextMenu /
    // #settingsMenu visual vocabulary and closes three ways (item select,
    // outside click, Escape).
    const TASK_SORT_OPTIONS = [
        { key: 'none',   label: 'None' },
        { key: 'due',    label: 'Due date' },
        { key: 'status', label: 'Status', subtitle: 'In Progress · Active · Idea' },
    ];

    const taskSortBtn = document.createElement('button');
    taskSortBtn.type = 'button';
    taskSortBtn.id = 'taskSortBtn';
    taskSortBtn.className = 'bulkDescBtn taskSortBtn';
    taskSortBtn.setAttribute('aria-haspopup', 'menu');
    taskSortBtn.setAttribute('aria-expanded', 'false');
    const taskSortBtnLabel = document.createElement('span');
    taskSortBtnLabel.className = 'bulkDescLabel';
    const taskSortBtnCaret = document.createElement('span');
    taskSortBtnCaret.className = 'bulkDescCaret';
    taskSortBtnCaret.textContent = '▾';
    taskSortBtnCaret.setAttribute('aria-hidden', 'true');
    taskSortBtn.appendChild(taskSortBtnLabel);
    taskSortBtn.appendChild(taskSortBtnCaret);
    bulkDescActions.appendChild(taskSortBtn);
    main2.appendChild(bulkDescActions);

    function taskSortButtonText(key) {
        if (key === 'due') return 'Sort: Due';
        if (key === 'status') return 'Sort: Status';
        return 'Sort';
    }

    function syncTaskSortButton() {
        const key = getTaskSort();
        taskSortBtnLabel.textContent = taskSortButtonText(key);
        taskSortBtn.setAttribute('data-sort', key);
    }
    syncTaskSortButton();

    function rerenderActiveProjectRows() {
        const activeName = activeProjectName();
        if (!activeName) return;
        const mainListDiv = document.getElementById('mainList');
        if (!mainListDiv) return;
        while (mainListDiv.firstChild) mainListDiv.removeChild(mainListDiv.firstChild);
        addAllToDo_DOM(listLogic.listItems(activeName), activeName);
    }

    function onTaskSortOutsideClick(event) {
        const menu = document.getElementById('taskSortMenu');
        if (!menu) return;
        if (menu.contains(event.target) || taskSortBtn.contains(event.target)) return;
        hideTaskSortMenu();
    }

    function onTaskSortKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            hideTaskSortMenu();
            taskSortBtn.focus();
        }
    }

    function hideTaskSortMenu() {
        const existing = document.getElementById('taskSortMenu');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        taskSortBtn.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onTaskSortOutsideClick, true);
        document.removeEventListener('keydown', onTaskSortKeydown, true);
        window.removeEventListener('resize', hideTaskSortMenu);
        window.removeEventListener('scroll', hideTaskSortMenu, true);
    }

    function applyTaskSortChoice(key) {
        setTaskSort(key);
        syncTaskSortButton();
        // Re-render so the new order lands, then re-apply the status filter so
        // its hide-class settles on the now-correctly-ordered rows.
        rerenderActiveProjectRows();
        applyTaskFilter();
    }

    function showTaskSortMenu() {
        const current = getTaskSort();
        const menu = document.createElement('div');
        menu.id = 'taskSortMenu';
        menu.setAttribute('role', 'menu');
        TASK_SORT_OPTIONS.forEach(function(opt) {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'taskSortMenuItem' + (opt.key === current ? ' selected' : '');
            item.setAttribute('role', 'menuitemradio');
            item.setAttribute('aria-checked', opt.key === current ? 'true' : 'false');
            item.setAttribute('data-sort', opt.key);
            const label = document.createElement('span');
            label.className = 'taskSortMenuItemLabel';
            label.textContent = opt.label;
            item.appendChild(label);
            if (opt.subtitle) {
                const sub = document.createElement('span');
                sub.className = 'taskSortMenuItemSub';
                sub.textContent = opt.subtitle;
                item.appendChild(sub);
            }
            item.addEventListener('click', function() {
                hideTaskSortMenu();
                applyTaskSortChoice(opt.key);
            });
            menu.appendChild(item);
        });
        document.body.appendChild(menu);

        // Anchor beneath the trigger, right-aligned, clamped to the viewport —
        // mirrors the settings menu's positioning.
        const rect = taskSortBtn.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.right - menuRect.width;
        if (left < 4) left = 4;
        if (top + menuRect.height > window.innerHeight) {
            top = Math.max(4, window.innerHeight - menuRect.height - 4);
        }
        menu.style.top = top + 'px';
        menu.style.left = left + 'px';

        taskSortBtn.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onTaskSortOutsideClick, true);
        document.addEventListener('keydown', onTaskSortKeydown, true);
        window.addEventListener('resize', hideTaskSortMenu);
        window.addEventListener('scroll', hideTaskSortMenu, true);
    }

    taskSortBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        if (document.getElementById('taskSortMenu')) {
            hideTaskSortMenu();
        } else {
            showTaskSortMenu();
        }
    });

    // ── bulk description expand/collapse state ──
    // Formerly owned by the on-screen "Expand All" button (retired in favour of
    // the Sort dropdown). The state now lives here as a module-scoped flag so
    // the two remaining entry points — the Ctrl+Enter chord and the mobile
    // drawer's "Expand all descriptions" toggle — share one source of truth.
    let bulkDescExpanded = false;
    function isBulkDescExpanded() {
        return bulkDescExpanded;
    }
    function toggleBulkDescriptions() {
        bulkDescExpanded = !bulkDescExpanded;
        if (bulkDescExpanded) expandAllDescriptions();
        else collapseAllDescriptions();
        return bulkDescExpanded;
    }

    // Desktop header consolidation — relocate the workspace pill
    // (#mobileProjHeader) and its open/done counts (#mobileProjStats) into the
    // top header (#navBar) at desktop widths, and return them to the stacked
    // project header inside #mainBar at mobile widths. The nodes are MOVED, not
    // duplicated, so their event wiring (drawer open on tap, ‹ › carousel,
    // swipe-to-navigate) and the single updateMobileProjHeader writer that
    // drives the counts all survive the move. Idempotent: a no-op when the
    // nodes already sit in the container matching the current breakpoint, so it
    // is safe to call on every resize. The view tabs already have a permanent
    // home in the desktop sub-band; only the pill + counts shuttle across the
    // 1024px boundary.
    function placeDesktopHeader() {
        const desktop = window.innerWidth >= 1024;
        if (desktop) {
            if (mobileProjHeader.parentNode !== nav) {
                nav.insertBefore(mobileProjHeader, pomodoroToggle);
            }
            // Counts sit inline to the right of the pill, ahead of the chip
            // cluster — lifted out of the pill so they read as header text
            // rather than part of the clickable drawer trigger.
            if (mobileProjStats.parentNode !== nav) {
                nav.insertBefore(mobileProjStats, pomodoroToggle);
            }
        } else {
            if (mobileProjHeader.parentNode !== main2) {
                main2.insertBefore(mobileProjHeader, taskFilterBar);
            }
            if (mobileProjStats.parentNode !== mobileProjHeader) {
                mobileProjHeader.appendChild(mobileProjStats);
            }
        }
    }
    placeDesktopHeader();
    window.addEventListener('resize', placeDesktopHeader);

    function activeProjectName() {
        const selected = document.querySelector('.selectedProject');
        if (!selected) return '';
        const projInput = selected.querySelector('#projInput');
        return projInput ? (projInput.value || '').trim() : '';
    }

    // ── STACK mobile drawer settings entry + footer ──
    // The drawer's previous always-visible View / Appearance toggle rows
    // (Show completed, Expand all descriptions, Dark theme, Companion
    // ghost) reclaimed ~200px of vertical space. They now live behind a
    // single "Settings" button at the bottom of #sidebarBottom which
    // opens a modal grouping the same four toggles under VIEW and
    // APPEARANCE sub-headers. Each toggle preserves its original label,
    // state source, and click handler — only the rendering location
    // moves. The drawer footer (version label + project count) remains
    // visible in the sidebar, sitting beneath the Settings button.
    function createDrawerToggleRow(labelText, getState, onToggle) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'drawerToggleRow';
        row.setAttribute('role', 'switch');
        const labelEl = document.createElement('span');
        labelEl.className = 'drawerToggleLabel';
        labelEl.textContent = labelText;
        const pill = document.createElement('span');
        pill.className = 'drawerTogglePill';
        function refresh() {
            const on = !!getState();
            row.classList.toggle('on', on);
            row.setAttribute('aria-checked', on ? 'true' : 'false');
            pill.textContent = on ? 'ON' : 'OFF';
        }
        row.appendChild(labelEl);
        row.appendChild(pill);
        row.addEventListener('click', function() {
            onToggle();
            refresh();
        });
        refresh();
        return { row: row, refresh: refresh };
    }

    // Drawer-styled row that surfaces a display-only label/value pair.
    // Mirrors createDrawerToggleRow's shape (returns { row, refresh })
    // so callers can re-read the value from valueGetter whenever they
    // re-show the surface — used by the Settings modal's About section
    // so the live project count reflects every add/remove without
    // remounting the row. The right-side value sits in a muted pill
    // matching the OFF state of .drawerTogglePill; the row itself is a
    // <div> (not a button) since there's nothing to tap.
    function createDrawerInfoRow(labelText, valueGetter) {
        const row = document.createElement('div');
        row.className = 'drawerInfoRow';
        const labelEl = document.createElement('span');
        labelEl.className = 'drawerInfoLabel';
        labelEl.textContent = labelText;
        const pill = document.createElement('span');
        pill.className = 'settingsInfoPill';
        function refresh() {
            pill.textContent = String(valueGetter());
        }
        row.appendChild(labelEl);
        row.appendChild(pill);
        refresh();
        return { row: row, refresh: refresh };
    }

    // Paint the service-worker update cue on the About → Version row.
    // When a new worker is waiting (hasPendingUpdate()), the muted value
    // pill is replaced by a tappable accent-colored "Update available"
    // pill that calls applyPendingUpdate (skipWaiting + reload — the
    // same flow the desktop footer's #footVersion runs). When no update
    // is pending the row reverts to its read-only state. Idempotent —
    // safe to call from both the initial render and the
    // appUpdateAvailable event handler while the modal is open.
    function paintAboutVersionUpdateCue(versionRow) {
        if (!versionRow) return;
        const existingPill = versionRow.querySelector('.settingsAboutUpdatePill');
        if (hasPendingUpdate()) {
            versionRow.classList.add('hasUpdate');
            if (existingPill) return;
            const updatePill = document.createElement('button');
            updatePill.type = 'button';
            updatePill.className = 'settingsAboutUpdatePill';
            updatePill.textContent = 'Update available';
            updatePill.setAttribute('aria-label', 'Update available — tap to reload');
            updatePill.addEventListener('click', function() {
                applyPendingUpdate();
            });
            versionRow.appendChild(updatePill);
        } else {
            versionRow.classList.remove('hasUpdate');
            if (existingPill && existingPill.parentNode) {
                existingPill.parentNode.removeChild(existingPill);
            }
        }
    }

    // Drawer-styled row that triggers a one-shot flow instead of toggling
    // a setting. Same 44px tap target and label typography as
    // createDrawerToggleRow, but the right-aligned slot holds a static
    // chevron glyph instead of an ON/OFF pill — the chevron tells the
    // user "tap me to go somewhere" while the pill says "tap me to flip".
    function createDrawerActionRow(labelText, onActivate) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'drawerActionRow';
        const labelEl = document.createElement('span');
        labelEl.className = 'drawerToggleLabel';
        labelEl.textContent = labelText;
        const chev = document.createElement('span');
        chev.className = 'drawerActionChevron';
        chev.setAttribute('aria-hidden', 'true');
        chev.textContent = '›';
        row.appendChild(labelEl);
        row.appendChild(chev);
        row.addEventListener('click', onActivate);
        return row;
    }

    // Show completed — mirrors the in-list #completedHeader caret. When the
    // caret is mounted (project has at least one completed row) we route
    // through its click so its own caret/aria-expanded flip in lockstep;
    // when the caret isn't mounted yet we still write the pref so the
    // setting takes effect the moment the first task is completed.
    function buildShowCompletedToggle() {
        return createDrawerToggleRow(
            'Show completed',
            function() { return isCompletedSectionOpen(); },
            function() {
                const header = document.getElementById('completedHeader');
                if (header) {
                    header.click();
                    return;
                }
                const next = !isCompletedSectionOpen();
                setCompletedSectionOpen(next);
                const list = document.getElementById('mainList');
                if (list) list.classList.toggle('completedCollapsed', !next);
            }
        );
    }

    // Expand all descriptions — mirrors the bulk desc toggle in the main
    // column header. Routing through the button's click keeps the
    // .expanded class + Expand/Collapse label flip in one place.
    function buildExpandAllToggle() {
        return createDrawerToggleRow(
            'Expand all descriptions',
            function() { return isBulkDescExpanded(); },
            function() { toggleBulkDescriptions(); }
        );
    }

    // Dark theme — mirrors the settings-menu Theme item. Same
    // theme-transitioning class + applyTheme + localStorage write so the
    // 220ms cross-fade is identical to the menu path.
    function buildDarkThemeToggle() {
        return createDrawerToggleRow(
            'Dark theme',
            function() { return getCurrentTheme() === 'dark'; },
            function() {
                const next = getCurrentTheme() === 'light' ? 'dark' : 'light';
                document.documentElement.classList.add('theme-transitioning');
                applyTheme(next);
                try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* quota/private-mode */ }
                setTimeout(function() {
                    document.documentElement.classList.remove('theme-transitioning');
                }, 220);
            }
        );
    }

    // Companion ghost — mirrors the settings-menu Toggle floating ghost.
    function buildCompanionToggle() {
        return createDrawerToggleRow(
            'Companion ghost',
            function() { return isCompanionEnabled(); },
            function() {
                const next = !isCompanionEnabled();
                setCompanionEnabled(next);
                if (next) ensureCompanion();
                else      destroyCompanion();
                applyCompanionGhostPreference();
            }
        );
    }

    const drawerSettingsBtn = document.createElement('button');
    drawerSettingsBtn.id = 'drawerSettingsBtn';
    drawerSettingsBtn.type = 'button';
    drawerSettingsBtn.setAttribute('aria-haspopup', 'dialog');
    drawerSettingsBtn.setAttribute('aria-expanded', 'false');

    const drawerSettingsBtnLabel = document.createElement('span');
    drawerSettingsBtnLabel.className = 'drawerSettingsBtnLabel';
    drawerSettingsBtnLabel.textContent = 'Settings';
    drawerSettingsBtn.appendChild(drawerSettingsBtnLabel);

    // Mobile-chrome service-worker update cue — the desktop footer's
    // #footVersion dot is hidden at ≤1023px, so the mobile gear/settings
    // entry point picks up an equivalent dot via the .hasUpdate class.
    // Mirrors the #changelogDot pattern on #footVersion. The dot is
    // painted by CSS; this element just exists so the class hook has
    // somewhere to apply paint. Toggled in lockstep with the same
    // appUpdateAvailable event the Settings modal listens for.
    const drawerSettingsBtnUpdateDot = document.createElement('span');
    drawerSettingsBtnUpdateDot.id = 'drawerSettingsBtnUpdateDot';
    drawerSettingsBtnUpdateDot.className = 'drawerSettingsBtnUpdateDot';
    drawerSettingsBtnUpdateDot.setAttribute('aria-hidden', 'true');
    drawerSettingsBtn.appendChild(drawerSettingsBtnUpdateDot);

    function refreshDrawerSettingsBtnUpdateCue() {
        if (hasPendingUpdate()) {
            drawerSettingsBtn.classList.add('hasUpdate');
            drawerSettingsBtn.setAttribute('data-has-update', 'true');
        } else {
            drawerSettingsBtn.classList.remove('hasUpdate');
            drawerSettingsBtn.removeAttribute('data-has-update');
        }
    }
    // Initial paint covers the rare second-load case where the worker
    // was already waiting at register-time and the event fired before
    // this listener was attached.
    refreshDrawerSettingsBtnUpdateCue();
    document.addEventListener('appUpdateAvailable', refreshDrawerSettingsBtnUpdateCue);

    // Wrap the Settings button so flex centering can apply to the wrap
    // without rearranging the footer sibling inside #sidebarBottom.
    const drawerSettingsBtnWrap = document.createElement('div');
    drawerSettingsBtnWrap.id = 'drawerSettingsBtnWrap';
    drawerSettingsBtnWrap.appendChild(drawerSettingsBtn);

    const drawerFooter = document.createElement('div');
    drawerFooter.id = 'drawerFooter';
    const drawerFooterVersion = document.createElement('span');
    drawerFooterVersion.id = 'drawerFooterVersion';
    drawerFooterVersion.textContent = 'v1.1';
    const drawerFooterCount = document.createElement('span');
    drawerFooterCount.id = 'drawerFooterCount';
    drawerFooterCount.textContent = '0 projects';
    drawerFooter.appendChild(drawerFooterVersion);
    drawerFooter.appendChild(drawerFooterCount);

    sidebarBottom.appendChild(drawerSettingsBtnWrap);
    sidebarBottom.appendChild(drawerFooter);

    function refreshDrawerProjectCount() {
        const count = listLogic.listProjectsArray().length;
        drawerFooterCount.textContent = count + (count === 1 ? ' project' : ' projects');
    }

    function refreshDrawerSections() {
        // The four toggles now live inside the Settings modal which builds
        // its rows from scratch on every open, so per-toggle refresh calls
        // here would refresh detached buttons. The drawer footer's project
        // count is the only piece that still needs syncing on drawer open.
        refreshDrawerProjectCount();
    }
    refreshDrawerProjectCount();

    // Settings modal — three-way close (X button, backdrop, Escape) per
    // CLAUDE.md. Lives in the same DOM at all viewports but only reachable
    // via #drawerSettingsBtn, which is itself drawer-bound and therefore
    // mobile-only via CSS.
    function showSettingsModal() {
        const prior = document.getElementById('settingsModalBackdrop');
        if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

        const backdrop = document.createElement('div');
        backdrop.id = 'settingsModalBackdrop';

        const dialog = document.createElement('div');
        dialog.id = 'settingsModal';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'settingsModalTitle');

        const header = document.createElement('div');
        header.id = 'settingsModalHeader';

        const title = document.createElement('div');
        title.id = 'settingsModalTitle';
        title.textContent = 'Settings';

        const closeX = document.createElement('button');
        closeX.id = 'settingsModalClose';
        closeX.type = 'button';
        closeX.setAttribute('aria-label', 'Close settings');
        closeX.textContent = '×';

        header.appendChild(title);
        header.appendChild(closeX);

        const body = document.createElement('div');
        body.id = 'settingsModalBody';

        const viewSection = document.createElement('section');
        viewSection.id = 'settingsViewSection';
        viewSection.className = 'settingsSection';
        const viewHeading = document.createElement('div');
        viewHeading.className = 'settingsSectionHeading';
        viewHeading.textContent = 'View';
        viewSection.appendChild(viewHeading);
        viewSection.appendChild(buildShowCompletedToggle().row);
        viewSection.appendChild(buildExpandAllToggle().row);

        const appearanceSection = document.createElement('section');
        appearanceSection.id = 'settingsAppearanceSection';
        appearanceSection.className = 'settingsSection';
        const appearanceHeading = document.createElement('div');
        appearanceHeading.className = 'settingsSectionHeading';
        appearanceHeading.textContent = 'Appearance';
        appearanceSection.appendChild(appearanceHeading);
        appearanceSection.appendChild(buildDarkThemeToggle().row);
        appearanceSection.appendChild(buildCompanionToggle().row);

        // About section — surfaces the version label + live project count
        // that used to live in #footBar / #drawerFooter on mobile. Two
        // info rows, both built from createDrawerInfoRow so the muted-pill
        // value chrome matches the OFF state of the toggle pills above.
        // The project-count valueGetter reads listLogic.listProjectsArray()
        // on every modal open, so the count stays live without an explicit
        // refresh wire.
        const aboutSection = document.createElement('section');
        aboutSection.id = 'settingsAboutSection';
        aboutSection.className = 'settingsSection';
        const aboutHeading = document.createElement('div');
        aboutHeading.className = 'settingsSectionHeading';
        aboutHeading.textContent = 'About';
        aboutSection.appendChild(aboutHeading);
        aboutSection.appendChild(createDrawerInfoRow('Version', function() {
            return 'v1.1';
        }).row);
        aboutSection.appendChild(createDrawerInfoRow('Projects', function() {
            const count = listLogic.listProjectsArray().length;
            return count + (count === 1 ? ' Project' : ' Projects');
        }).row);
        // Service-worker update cue. When a new worker is waiting, the
        // Version row gains a tappable "Update available" pill that
        // routes to applyPendingUpdate (the same skipWaiting + reload
        // path the desktop footer uses). The row is the first
        // .drawerInfoRow child of the About section; paintAboutVersionUpdateCue
        // toggles the pill in lockstep with the appUpdateAvailable event.
        const versionRow = aboutSection.querySelector('.drawerInfoRow');
        // Hovering the Version row surfaces the full build string the
        // abbreviated "v1.1" pill stands in for (matches the desktop
        // footer's "task management v1.1" label).
        if (versionRow) versionRow.setAttribute('title', 'task management v1.1');
        paintAboutVersionUpdateCue(versionRow);

        // HELP section — single Replay welcome tour entry that dispatches
        // by viewport. On touch / narrow viewports the carousel runs; on
        // mouse / wide viewports the desktop spotlight tour runs. Tapping
        // closes the settings modal first so the flow lands on a clean
        // surface. Replay never re-seeds the sample project.
        const helpSection = document.createElement('section');
        helpSection.id = 'settingsHelpSection';
        helpSection.className = 'settingsSection';
        const helpHeading = document.createElement('div');
        helpHeading.className = 'settingsSectionHeading';
        helpHeading.textContent = 'Help';
        helpSection.appendChild(helpHeading);
        const replayRow = createDrawerActionRow('Replay welcome tour', function() {
            close();
            applyActiveView('projects');
            if (listLogic.listProjectsArray().length === 0) {
                listLogic.seedSampleProject({ force: true });
                rebuildAfterImport();
            } else {
                // Active project may hold only the blank placeholder.
                // The desktop coachmark steps for #duePill and
                // #descToggle need a real titled row to anchor against,
                // so seed starter todos into it.
                seedSampleTodosIntoActiveProjectIfEmpty();
            }
            // rAF defer so the data-view flip and any re-render have a
            // layout pass before the tour reads bounding rects for the
            // spotlight cut-out.
            requestAnimationFrame(function() {
                if (isMobileCarouselViewport()) startWelcomeCarousel();
                else startCoachmarkTour();
            });
        });
        helpSection.appendChild(replayRow);

        // Data section — manual JSON export / import. Export downloads
        // the user's Supabase dataset; Import reads such a file back,
        // shows a destructive confirmation, and replaces the user's data
        // on confirm. Mirrors the desktop settings menu's Data section.
        const dataSection = document.createElement('section');
        dataSection.id = 'settingsDataSection';
        dataSection.className = 'settingsSection';
        const dataHeading = document.createElement('div');
        dataHeading.className = 'settingsSectionHeading';
        dataHeading.textContent = 'Data';
        dataSection.appendChild(dataHeading);
        const exportRow = createDrawerActionRow('Export to JSON', function() {
            close();
            exportToJson();
        });
        dataSection.appendChild(exportRow);
        const importRow = createDrawerActionRow('Import from JSON', function() {
            close();
            openImportPicker(rebuildAfterImport);
        });
        dataSection.appendChild(importRow);
        // Configure inject — mirrors the desktop ghost menu row. Lives in
        // the Data section alongside Export/Import so the per-device
        // Worker URL + shared secret are reachable from a phone too.
        const injectRow = createDrawerActionRow('Configure inject', function() {
            close();
            showInjectSettingsModal();
        });
        dataSection.appendChild(injectRow);

        // Account section — Phase 4 auth gate's sign-out exit. Mirrors
        // the HELP / About section pattern at the same heading typography
        // so the row chrome reads consistently. Tap closes the modal first
        // so the auth modal lands on a clean surface when the app-level
        // onAuthStateChange listener re-renders it.
        const accountSection = document.createElement('section');
        accountSection.id = 'settingsAccountSection';
        accountSection.className = 'settingsSection';
        const accountHeading = document.createElement('div');
        accountHeading.className = 'settingsSectionHeading';
        accountHeading.textContent = 'Account';
        accountSection.appendChild(accountHeading);
        const signOutRow = createDrawerActionRow('Sign out', function() {
            close();
            wipeLocalUserDataOnSignOut().then(function() { supabase.auth.signOut(); });
        });
        accountSection.appendChild(signOutRow);

        body.appendChild(viewSection);
        body.appendChild(appearanceSection);
        body.appendChild(aboutSection);
        body.appendChild(helpSection);
        body.appendChild(dataSection);
        body.appendChild(accountSection);

        dialog.appendChild(header);
        dialog.appendChild(body);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        const previouslyFocused = document.activeElement;
        closeX.focus();
        drawerSettingsBtn.setAttribute('aria-expanded', 'true');

        // Keep the About-section version row's update cue in sync while
        // the modal is open. The handler reference is held so close() can
        // remove it without leaking across reopen cycles.
        function onAppUpdateAvailableForModal() {
            paintAboutVersionUpdateCue(versionRow);
        }
        document.addEventListener('appUpdateAvailable', onAppUpdateAvailableForModal);

        let closed = false;
        function close() {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeydown, true);
            document.removeEventListener('appUpdateAvailable', onAppUpdateAvailableForModal);
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            drawerSettingsBtn.setAttribute('aria-expanded', 'false');
            if (previouslyFocused &&
                typeof previouslyFocused.focus === 'function' &&
                document.contains(previouslyFocused)) {
                previouslyFocused.focus();
            }
        }

        function onKeydown(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
            }
        }

        closeX.addEventListener('click', close);
        backdrop.addEventListener('click', function(event) {
            if (event.target === backdrop) close();
        });
        document.addEventListener('keydown', onKeydown, true);
    }

    drawerSettingsBtn.addEventListener('click', function() {
        showSettingsModal();
    });

    // ── sidebar toggle logic ──
    function isMobile() { return window.innerWidth < 1024; }

    // The projects sidebar is an overlay drawer at every breakpoint. open /
    // close / state all key off the `sidebar-open` class on #sideBar plus the
    // #sidebarOverlay backdrop — the same mechanism the mobile drawer has
    // always used, now unified across desktop too (no more persistent rail /
    // full column).
    function openSidebar() {
        // Drawer state could have drifted while it was closed (theme toggled
        // via settings menu, Expand All toggled by Ctrl+Enter, a project
        // added/removed). Re-sync the drawer mirrors so the ON/OFF pills and
        // footer count match reality on every open.
        refreshDrawerSections();
        main1.classList.add('sidebar-open');
        sidebarOverlay.classList.add('visible');
        if (typeof window.bottomSheetRefreshVisibility === 'function') {
            window.bottomSheetRefreshVisibility();
        }
    }

    function closeSidebar() {
        main1.classList.remove('sidebar-open');
        sidebarOverlay.classList.remove('visible');
        if (typeof window.bottomSheetRefreshVisibility === 'function') {
            window.bottomSheetRefreshVisibility();
        }
    }

    function sidebarIsOpen() {
        return main1.classList.contains('sidebar-open');
    }

    // The hamburger slides the overlay drawer in/out at every breakpoint.
    sidebarToggle.addEventListener('click', function() {
        sidebarIsOpen() ? closeSidebar() : openSidebar();
    });

    sidebarOverlay.addEventListener('click', closeSidebar);

    // X-button close inside the drawer header. Mirrors the backdrop click
    // and the Escape handler below so the drawer satisfies CLAUDE.md's
    // three-way modal close vocabulary at all breakpoints.
    mobileSidebarClose.addEventListener('click', function() {
        closeSidebar();
        sidebarToggle.focus();
    });

    // Escape closes the drawer, completing the modal close vocabulary
    // (X button, backdrop tap, Escape). Capture phase so an open drawer
    // always wins over downstream Escape handlers (which would otherwise
    // consume the keystroke for popovers and modals mounted underneath the
    // drawer's backdrop). Bails when another modal/popover is already open so
    // its own Escape handling owns the keystroke. The drawer exists at every
    // breakpoint now, so there is no desktop bail.
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        if (!sidebarIsOpen()) return;
        if (isAnyModalOrPopoverOpen()) return;
        e.preventDefault();
        e.stopPropagation();
        closeSidebar();
        sidebarToggle.focus();
    }, true);

    // STACK browse-and-decide: tapping a project row in the mobile drawer
    // updates the active project but deliberately keeps the drawer open so
    // the user can compare projects side by side. The drawer dismisses only
    // through the three-way close vocabulary (X button, backdrop, Escape).

    // Clear todo-active on all rows when clicking outside any todo row
    // and collapse any rows that were auto-expanded into mobile-read mode
    // by a tap (data-mobile-read="true"). Mobile-read collapse must respect
    // the descSibling — tapping inside the description input should not
    // collapse the row out from under the user mid-edit; only a tap that
    // lands outside both the row and its description triggers collapse.
    document.addEventListener('click', function(e) {
        const insideRow = e.target.closest('#toDoChild');
        const insideDesc = e.target.closest('#descSibling');
        const insideStats = e.target.closest('#statsSibling');
        if (!insideRow && !insideStats) {
            document.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                el.classList.remove('todo-active');
            });
        }
        if (!insideRow && !insideDesc && !insideStats) {
            document.querySelectorAll('#toDoChild[data-mobile-read="true"]').forEach(function(el) {
                const dt = el.querySelector('#descToggle');
                if (dt && dt.classList.contains('open')) {
                    dt.click();
                }
            });
        }
    });

    // Global "Ctrl+Enter" (or Cmd+Enter) shortcut — toggle inline descriptions
    // on every open task at once. Routed through toggleBulkDescriptions() so the
    // chord and the mobile drawer's "Expand all descriptions" toggle share one
    // expand/collapse state (the on-screen Expand All button was retired in
    // favour of the Sort dropdown).
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        toggleBulkDescriptions();
        e.preventDefault();
    });

    // Global "Ctrl+Backspace" (or Cmd+Backspace) shortcut — toggle the
    // sidebar exactly the way the hamburger does, so the whole chrome stays
    // reachable from the keyboard. Routed through `sidebarToggle.click()`
    // so the chord drives the unified overlay drawer at all breakpoints,
    // staying in lockstep with the on-screen control. Skipped while focus is
    // inside an editable
    // surface so Ctrl+Backspace still deletes the previous word while
    // typing in task titles or descriptions. The preventDefault below stops
    // the browser's default "go back" gesture from firing when we consume
    // the chord.
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Backspace') return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        sidebarToggle.click();
        e.preventDefault();
    });

    // Global "?" shortcut — open the help modal. Same guards as the "n"
    // shortcut: skip while typing in a text-entry surface or while another
    // modal/popover already has the user's attention. Modifier keys are
    // ignored so Shift+/ (which produces "?") still triggers, while the
    // browser's own Cmd-? / Ctrl-? bindings remain untouched.
    document.addEventListener('keydown', function(e) {
        if (e.key !== '?') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (isAnyModalOrPopoverOpen()) return;
        showHelpModal();
        e.preventDefault();
    });

    // Global "Ctrl+Delete" (or Cmd+Delete) shortcut — toggle the description
    // panel of the currently active todo row. Resolves the active row from
    // focus (preferred) and falls back to the `.todo-active` marker the
    // arrow-nav handler maintains. Skips the placeholder (its descToggle is
    // hidden via display:none). Chord-style means we don't need the typing-
    // surface guard — toggling a description while editing the title is a
    // feature, not a hazard. The bare `Delete` (no Ctrl) still routes to the
    // arrow-nav handler's confirm-delete path; that handler bails when any
    // modifier is held, so the two never collide.
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Delete') return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        const ae = document.activeElement;
        let row = (ae && ae.closest) ? ae.closest('#toDoChild') : null;
        if (!row) {
            const mainListDiv = document.getElementById('mainList');
            if (mainListDiv) row = mainListDiv.querySelector('#toDoChild.todo-active');
        }
        if (!row) return;
        const descToggle = row.querySelector('#descToggle');
        if (!descToggle) return;
        if (descToggle.style.display === 'none') return; // placeholder row
        descToggle.click();
        e.preventDefault();
    });

    // ArrowLeft / ArrowRight cross-pane focus shortcuts. Left jumps focus to
    // the active project's rail icon; right jumps focus to the visible new-
    // task input (empty-state input when the project is empty, otherwise the
    // blank placeholder `#toDoInput`). Bails when focus is already inside an
    // editable input/textarea/contentEditable so the arrow keys still move
    // the caret while the user is typing — the shortcut only fires when
    // focus is on the body, on a project rail icon, or on any non-editable
    // element (e.g. a committed todo row in nav mode).
    //
    // Exception: ArrowLeft also fires when focus is in a placeholder new-task
    // input (the blank `#toDoInput` row or `#emptyStateInput`) AND the caret
    // is at position 0 with no selection. Lets the user "back out" of an
    // empty/just-started new-task field into the projects column without
    // first having to tab or click away.
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        // Gated to the Projects view so the Calendar view can claim
        // ArrowLeft / ArrowRight for grid traversal without conflict.
        // The Today view does not need these cross-pane shortcuts — the
        // sidebar is the same projects column either way, but the right
        // side has no new-task input to receive ArrowRight.
        if (getActiveView() !== 'projects') return;
        const ae = document.activeElement;
        const isInputLike = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));

        let allowFromPlaceholder = false;
        if (isInputLike && e.key === 'ArrowLeft' && ae.tagName === 'INPUT') {
            const atStart = ae.selectionStart === 0 && ae.selectionEnd === 0;
            if (atStart) {
                if (ae.id === 'emptyStateInput') {
                    allowFromPlaceholder = true;
                } else if (ae.id === 'toDoInput') {
                    const row = ae.closest && ae.closest('#toDoChild');
                    if (row && row.querySelector('#addGlyph')) allowFromPlaceholder = true;
                }
            }
        }
        if (isInputLike && !allowFromPlaceholder) return;

        if (e.key === 'ArrowLeft') {
            const target = document.querySelector('#projChild.selectedProject') ||
                           document.querySelector('#projChild');
            if (!target) return;
            target.focus();
            e.preventDefault();
            return;
        }
        focusBlankToDoInput();
        e.preventDefault();
    });

    // Delegated keyboard nav on the projects sidebar — only fires while a
    // project row itself has focus (i.e. the user arrived via ArrowLeft or
    // by clicking a rail icon). When focus is inside the row's `#projInput`
    // (rename mode), we skip so the existing input keydown logic owns
    // Enter/Arrow behavior.
    sideMain.addEventListener('keydown', function(e) {
        const row = e.target.closest('#projChild');
        if (!row) return;
        if (e.target !== row) return; // focus is in #projInput, leave alone
        if (e.key === 'Enter') {
            e.preventDefault();
            // Not yet selected: synthesize a click so the keyboard path goes
            // through the same selection + items render + focus path the
            // mouse does. Already selected: just jump focus to the placeholder
            // — clicking again would unlock the project name for editing,
            // which is the wrong outcome for "Enter to enter the project".
            if (!row.classList.contains('selectedProject')) {
                row.click();
            } else {
                focusBlankToDoInputIfDesktop();
            }
            return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            // stopPropagation so the document-level todo arrow-nav handler
            // doesn't also fire and yank focus to a todo row right after
            // we hand focus to the projButton (or to the next project row).
            // Mirrors the same guard the projButton's own keydown uses.
            e.stopPropagation();
            const rows = Array.prototype.slice.call(sideMain.querySelectorAll('#projChild'));
            const idx = rows.indexOf(row);
            const next = e.key === 'ArrowDown' ? rows[idx + 1] : rows[idx - 1];
            if (!next) {
                // ArrowDown off the last project row falls through to the
                // "+" add-project button so the keyboard path can reach
                // new-project creation without grabbing the mouse. ArrowUp
                // off the first row jumps to the sidebarToggle in the
                // header so keyboard users can flow up into the header
                // chain — closes the loop with the projButton ->
                // footVersion bottom boundary so every chrome region is
                // reachable by arrows alone.
                if (e.key === 'ArrowDown') {
                    const projBtn = document.getElementById('projButton');
                    if (projBtn) projBtn.focus();
                } else {
                    const sidebarToggleEl = document.getElementById('sidebarToggle');
                    if (sidebarToggleEl) sidebarToggleEl.focus();
                }
                return;
            }
            next.focus();
            // Auto-select the project so its todos populate the main pane as
            // the user arrow-navigates. Synthesize a click — the click handler
            // owns the full selection + render dance, including
            // applyProjectAccent and addToDos_restore. Skip when already
            // selected (a click on a selected row unlocks its name for
            // editing, the wrong outcome for arrow nav).
            if (!next.classList.contains('selectedProject')) {
                next.click();
                // The click handler queues focusBlankToDoInputIfDesktop()
                // via setTimeout(0) which would steal focus to the
                // placeholder. Enqueue our own setTimeout AFTER it so focus
                // returns to the project row, letting the user keep
                // arrow-navigating without interruption.
                setTimeout(function() { next.focus(); }, 0);
            }
        }
    });

    // Arrow-key navigation, Enter to enter edit mode, Delete to confirm-delete
    // for committed todo rows in the active project. Up/Down move focus to the
    // previous/next committed row (no wrap — boundaries clamp). Enter focuses
    // the row's title input with the caret at the end. Delete fires the same
    // showConfirmModal flow as the row's `×` button. Backspace is accepted as
    // an alias for Delete so the keyboard shortcut works on Mac laptops,
    // whose only "Delete"-labeled key actually fires e.key === "Backspace"
    // (forward-delete from a full-size keyboard doesn't exist there).
    //
    // The blank placeholder row at index 0 is intentionally skipped — it's
    // already reachable via "n" and a direct click, and arrow nav is for
    // editing existing items, not creating new ones.
    //
    // Guards mirror the "n" / "?" shortcuts: any modal/popover open or the
    // user typing in a non-todo input absorbs the keystroke. Arrow keys are
    // additionally allowed when focus is in a #toDoInput inside #mainList so
    // a user mid-edit can still navigate rows; Enter and Delete defer to the
    // input's own keydown handlers in that case so character editing wins.
    document.addEventListener('keydown', function(e) {
        const isArrowUp   = e.key === 'ArrowUp';
        const isArrowDown = e.key === 'ArrowDown';
        const isArrow     = isArrowUp || isArrowDown;
        const isEnter     = e.key === 'Enter';
        const isDelete    = e.key === 'Delete' || e.key === 'Backspace';
        if (!isArrow && !isEnter && !isDelete) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        // Gated to the Projects view. Today and Calendar have their own
        // arrow-nav handler that walks their own surfaces; firing this one
        // on those views would yank focus to a stale .todo-active row in
        // the hidden #mainList.
        if (getActiveView() !== 'projects') return;

        const mainList = document.getElementById('mainList');
        if (!mainList) return;

        const ae = document.activeElement;
        const isToDoInput = !!(ae && ae.id === 'toDoInput' && mainList.contains(ae));
        const isEmptyStateInput = !!(ae && ae.id === 'emptyStateInput' && mainList.contains(ae));
        const isInputLike = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));

        // ArrowUp escape from the blank-placeholder #toDoInput (or
        // #emptyStateInput when the project is empty) back up to the
        // active view pill. Mirrors the ArrowDown drop-in wired on each
        // pill so the entry and exit paths are symmetric. Handled BEFORE
        // the isInputLike bail-out below so the #emptyStateInput branch
        // isn't filtered out by it. Without this escape, ArrowUp from
        // the placeholder falls through to the committed-list logic and
        // jumps to the last committed row — the wrong direction for a
        // user trying to return to the header chrome.
        if (isArrowUp && (isToDoInput || isEmptyStateInput)) {
            let onPlaceholderInput = false;
            if (isToDoInput && ae.closest) {
                const placeholderRow = ae.closest('#toDoChild');
                if (placeholderRow && placeholderRow.querySelector('#addGlyph')) {
                    onPlaceholderInput = true;
                }
            }
            if (onPlaceholderInput || isEmptyStateInput) {
                const pill = document.querySelector('#viewSwitcher .viewPill.active');
                if (pill) {
                    e.preventDefault();
                    e.stopPropagation();
                    pill.focus();
                    return;
                }
            }
        }

        if (isArrow) {
            if (isInputLike && !isToDoInput) return;
        } else {
            if (isInputLike) return;
        }

        // Delete on a focused project row routes to the project-deletion
        // confirmation flow instead of falling through to the todo path.
        // Without this gate, pressing Delete after clicking a project would
        // delete the first todo in the active list (whichever row carried
        // .todo-active at the time) rather than the project the user was
        // pointing at.
        if (isDelete) {
            const focusedProjRow = ae && ae.closest && ae.closest('#projChild');
            if (focusedProjRow) {
                // Backspace-only guard: require the keystroke to have
                // originated on the project row itself, not bubbled up from
                // a child. The projInput is already filtered by the
                // isInputLike bail-out above, but any future sub-control
                // that wires its own Backspace-to-row exit (mirroring the
                // todo-row pattern) would otherwise bubble here and fire
                // delete after focus moved. Delete (the literal forward-
                // delete key) keeps its from-anywhere behavior.
                if (e.key === 'Backspace' && e.target !== focusedProjRow) return;
                const projInput = focusedProjRow.querySelector('#projInput');
                deleteProjectFlow(focusedProjRow, projInput ? projInput.value : '');
                e.preventDefault();
                return;
            }
        }

        // Only committed rows participate — the blank placeholder at index 0
        // has no title yet and isn't a navigation target.
        const allRows = Array.from(mainList.querySelectorAll('#toDoChild'));
        const committed = allRows.filter(function(row) {
            const input = row.querySelector('#toDoInput');
            return !!(input && input.value && input.value.trim().length > 0);
        });
        if (committed.length === 0) return;

        let currentRow = null;
        if (ae && ae.closest) currentRow = ae.closest('#toDoChild');
        if (!currentRow) currentRow = mainList.querySelector('#toDoChild.todo-active');
        if (currentRow && committed.indexOf(currentRow) === -1) currentRow = null;

        if (isArrow) {
            const idx = currentRow ? committed.indexOf(currentRow) : -1;
            // ArrowUp off the top of the committed list lands in the blank
            // placeholder input above it — lets the user back into the new-
            // task field without grabbing the mouse.
            if (!isArrowDown && idx === 0) {
                const placeholderRow = allRows.find(function(row) {
                    return !!row.querySelector('#addGlyph');
                });
                const placeholderInput = placeholderRow ? placeholderRow.querySelector('#toDoInput') : null;
                if (placeholderInput) {
                    if (currentRow) currentRow.classList.remove('todo-active');
                    placeholderInput.focus();
                    placeholderInput.setSelectionRange(0, 0);
                    e.preventDefault();
                    return;
                }
            }
            let nextIdx;
            if (isArrowDown) {
                nextIdx = idx === -1 ? 0 : Math.min(idx + 1, committed.length - 1);
            } else {
                nextIdx = idx === -1 ? committed.length - 1 : Math.max(idx - 1, 0);
            }
            const target = committed[nextIdx];
            if (!target) return;
            mainList.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                if (el !== target) el.classList.remove('todo-active');
            });
            target.classList.add('todo-active');
            // Focus the row element itself (tabindex="-1") rather than its
            // input — the user is in nav mode, not edit mode. Enter switches
            // to edit mode by handing focus to the input.
            target.focus();
            e.preventDefault();
            return;
        }

        if (!currentRow) return;

        if (isEnter) {
            // Mirror the Delete guard below: require focus to be genuinely
            // on a todo row. Without this, Enter pressed while focus is on
            // an unrelated control (header toggles, sidebar toggle, etc.)
            // falls through to the .todo-active fallback and routes the
            // keystroke to the active todo's input — silently stealing
            // focus and preventDefault-ing the focused button's own
            // activation (e.g. blocking Enter from opening the pomodoro
            // popover).
            const focusedTodoRow = ae && ae.closest && ae.closest('#toDoChild');
            if (!focusedTodoRow || committed.indexOf(focusedTodoRow) === -1) return;
            // Fire only when focus is on the row element itself (nav mode).
            // When focus is on a sub-control (checkbox, due pill button,
            // expand caret, delete X, description), Enter must activate
            // that sub-control's own keydown handler instead of yanking
            // focus to the title input. The row gets focus via the arrow-
            // nav handler above (`target.focus()`); sub-controls receive
            // focus via Tab.
            if (ae !== focusedTodoRow) return;
            const input = focusedTodoRow.querySelector('#toDoInput');
            if (!input) return;
            input.focus();
            const end = input.value.length;
            input.setSelectionRange(end, end);
            e.preventDefault();
            return;
        }

        if (isDelete) {
            // Require focus to be genuinely on a todo row. The .todo-active
            // fallback used by Arrow / Enter would otherwise route Delete to
            // the first active todo even when focus was elsewhere — see the
            // sibling project-row branch above for context.
            const focusedTodoRow = ae && ae.closest && ae.closest('#toDoChild');
            if (!focusedTodoRow || committed.indexOf(focusedTodoRow) === -1) return;
            // Backspace-only guard: each sub-control (checkbox, duePill,
            // descToggle, statsToggle, closeButtonToDo) wires its own
            // Backspace-to-row exit handler that focuses the row before the
            // event bubbles here. Without this check the bubbled keystroke
            // would fire delete on the row the user just bounced into,
            // surprising someone who pressed Backspace only to back out of
            // edit mode. Delete (the literal forward-delete key) keeps its
            // from-anywhere behavior so the existing shortcut path is
            // unchanged for users with full-size keyboards.
            if (e.key === 'Backspace' && e.target !== focusedTodoRow) return;
            const closeBtn = focusedTodoRow.querySelector('#closeButtonToDo');
            if (closeBtn) closeBtn.click();
            e.preventDefault();
        }
    });

    // ── Today / Calendar view arrow-key navigation ──
    // Mirrors the Projects-view arrow-nav contract for the two dashboard
    // views so each surface has the same "press Down, focus the next item"
    // affordance. Branches off #mainBar's data-view attribute so a single
    // global listener covers both views without duplicating guards.
    //
    //   • TODAY    — ArrowUp / ArrowDown walk between .todayRow.todoRowCard
    //                rows inside #inboxSections in DOM order, clamping at
    //                the top and bottom (no wrap). Enter on a focused row
    //                fires the row's click handler (jump to the parent
    //                project) — when focus is on the title button instead,
    //                native Enter on the button bubbles to the row's click
    //                so the existing keyboard path keeps working.
    //   • CALENDAR — .calendarCell elements inside #calendarGrid form a
    //                7-column grid. ArrowLeft / ArrowRight move ±1 cell,
    //                ArrowUp / ArrowDown move ±7 cells, all clamped to the
    //                rendered range (no auto-advance to prev/next month).
    //                Enter fires the cell's existing click so the day-
    //                detail panel updates. Calendar cells are <button>s,
    //                so native Enter already activates them; we still
    //                handle Enter here to keep the contract uniform.
    //
    // Guards mirror the Projects-view handler: skip when any modal/popover
    // is open, when modifier keys are held, and when focus is in an editable
    // input/textarea/contentEditable outside the navigable surface.
    document.addEventListener('keydown', function(e) {
        const isUp    = e.key === 'ArrowUp';
        const isDown  = e.key === 'ArrowDown';
        const isLeft  = e.key === 'ArrowLeft';
        const isRight = e.key === 'ArrowRight';
        const isEnter = e.key === 'Enter';
        if (!isUp && !isDown && !isLeft && !isRight && !isEnter) return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;

        const mainBar = document.getElementById('mainBar');
        if (!mainBar) return;
        const view = mainBar.getAttribute('data-view');
        if (view !== 'inbox' && view !== 'calendar') return;

        const ae = document.activeElement;
        const isInputLike = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));

        if (view === 'inbox') {
            // ArrowLeft / ArrowRight are unused on Today — let them fall
            // through so caret movement in any focused input still works.
            if (isLeft || isRight) return;

            const sections = document.getElementById('inboxSections');
            if (!sections) return;
            const rows = Array.prototype.slice.call(sections.querySelectorAll('.todayRow.todoRowCard'));
            if (rows.length === 0) return;

            // Focus may be on the row itself, on a descendant control
            // (e.g. .todayRowTitle button when the user just dropped in
            // from the view pill), or elsewhere on the page.
            let currentRow = ae && ae.closest ? ae.closest('.todayRow.todoRowCard') : null;
            if (currentRow && !sections.contains(currentRow)) currentRow = null;

            // Skip when typing in an input outside the navigable surface;
            // descendant <button>s (the title) are fine — buttons aren't
            // editable so isInputLike is false there.
            if (isInputLike && !currentRow) return;

            if (isUp || isDown) {
                // Anchor focus to the row container when the user is on a
                // descendant (e.g. .todayRowTitle button). The next keystroke
                // moves between rows; the title button remains reachable via
                // Enter or Tab. Mirrors the .todo-active nav-mode behavior
                // committed Projects-view rows have.
                if (currentRow && ae !== currentRow) {
                    sections.querySelectorAll('.todayRow.todoRowCard.todo-active').forEach(function(el) {
                        if (el !== currentRow) el.classList.remove('todo-active');
                    });
                    currentRow.classList.add('todo-active');
                    currentRow.focus();
                    e.preventDefault();
                    return;
                }
                // ArrowUp boundary: escape the first row up to the TODAY pill
                // so keyboard users can walk into the header chrome without
                // reaching for the mouse. stopPropagation keeps the cross-pane
                // ArrowLeft/ArrowRight handler from also firing.
                if (isUp && currentRow && currentRow === rows[0]) {
                    const pill = document.getElementById('viewPillInbox');
                    if (pill) {
                        currentRow.classList.remove('todo-active');
                        pill.focus();
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }
                const idx = currentRow ? rows.indexOf(currentRow) : -1;
                let nextIdx;
                if (isDown) {
                    nextIdx = idx === -1 ? 0 : Math.min(idx + 1, rows.length - 1);
                } else {
                    nextIdx = idx === -1 ? rows.length - 1 : Math.max(idx - 1, 0);
                }
                const target = rows[nextIdx];
                if (!target) return;
                sections.querySelectorAll('.todayRow.todoRowCard.todo-active').forEach(function(el) {
                    if (el !== target) el.classList.remove('todo-active');
                });
                target.classList.add('todo-active');
                target.focus();
                e.preventDefault();
                return;
            }

            if (isEnter) {
                // Only fire row.click() when focus is on the row container
                // itself. When focus is on the title <button>, native Enter
                // already dispatches a click that bubbles up to the row's
                // own click handler — handling it here too would double-fire.
                if (!currentRow || ae !== currentRow) return;
                currentRow.click();
                e.preventDefault();
            }
            return;
        }

        // view === 'calendar'
        const grid = document.getElementById('calendarGrid');
        if (!grid) return;
        const cells = Array.prototype.slice.call(grid.querySelectorAll('.calendarCell'));
        if (cells.length === 0) return;

        let currentCell = ae && ae.closest ? ae.closest('.calendarCell') : null;
        if (currentCell && !grid.contains(currentCell)) currentCell = null;

        if (isInputLike && !currentCell) return;

        if (isEnter) {
            // Cells are <button>s, so native Enter already activates them.
            // Only handle the explicit-focus case to preserve the contract
            // with Today; skip otherwise to avoid double-fire.
            if (currentCell && ae === currentCell) {
                currentCell.click();
                e.preventDefault();
                return;
            }
            // Enter on a focused day-detail row fires the row's click
            // handler (jump to the parent project) — mirrors the Today
            // view's contract so keyboard users get the same affordance
            // as a mouse click on the row.
            const dayList = document.getElementById('calendarDayList');
            const panelRow = ae && ae.closest ? ae.closest('.todayRow.todoRowCard') : null;
            if (dayList && panelRow && dayList.contains(panelRow) && ae === panelRow) {
                panelRow.click();
                e.preventDefault();
            }
            return;
        }

        if (!currentCell) {
            // Day-detail panel branch: ArrowUp/ArrowDown walk
            // .todayRow.todoRowCard rows inside #calendarDayList in DOM
            // order, clamping at the ends (no wrap). Mirrors the Today
            // view's row-walk so the two views feel uniform. Descendant
            // focus (e.g. .todayRowTitle button) anchors to the row
            // container with .todo-active applied before the next
            // keystroke walks rows — same contract committed Projects-
            // view rows have.
            const dayList = document.getElementById('calendarDayList');
            const panelRows = dayList
                ? Array.prototype.slice.call(dayList.querySelectorAll('.todayRow.todoRowCard'))
                : [];
            const panelRow = ae && ae.closest ? ae.closest('.todayRow.todoRowCard') : null;
            const inPanel = !!(dayList && panelRow && dayList.contains(panelRow));

            if ((isUp || isDown) && inPanel && panelRows.length > 0) {
                // Anchor to the row container when focus is on a descendant.
                // Mirrors the Today branch above and the committed-row
                // .todo-active nav mode.
                if (ae !== panelRow) {
                    dayList.querySelectorAll('.todayRow.todoRowCard.todo-active').forEach(function(el) {
                        if (el !== panelRow) el.classList.remove('todo-active');
                    });
                    panelRow.classList.add('todo-active');
                    panelRow.focus();
                    e.preventDefault();
                    return;
                }

                // Panel→grid boundary: ArrowUp from the first
                // .todayRow.todoRowCard lifts focus back into the grid,
                // mirroring the grid→panel ArrowDown boundary below.
                // Resolves the landing cell via the same fallback chain
                // as renderCalendarView's post-rebuild re-focus:
                // calendarSelectedKey → today → last cell.
                if (isUp && panelRow === panelRows[0]) {
                    let target = null;
                    const selectedKey = getCalendarSelectedKey();
                    if (selectedKey) {
                        target = grid.querySelector('.calendarCell[data-date="' + selectedKey + '"]');
                    }
                    if (!target) {
                        const todayKey = formatCalendarKeyForDate(new Date());
                        target = grid.querySelector('.calendarCell[data-date="' + todayKey + '"]');
                    }
                    if (!target) target = cells[cells.length - 1];
                    if (target) {
                        panelRow.classList.remove('todo-active');
                        target.focus();
                        e.preventDefault();
                        e.stopPropagation();
                        return;
                    }
                }

                // In-panel row walk: ArrowUp/ArrowDown step by one row,
                // clamping at the ends. The first-row ArrowUp escape
                // above runs before this branch, so the clamp here only
                // bites at the bottom edge (ArrowDown on the last row).
                const idx = panelRows.indexOf(panelRow);
                if (idx === -1) return;
                const nextIdx = isDown
                    ? Math.min(idx + 1, panelRows.length - 1)
                    : Math.max(idx - 1, 0);
                if (nextIdx === idx) {
                    e.preventDefault();
                    return;
                }
                const targetRow = panelRows[nextIdx];
                dayList.querySelectorAll('.todayRow.todoRowCard.todo-active').forEach(function(el) {
                    if (el !== targetRow) el.classList.remove('todo-active');
                });
                targetRow.classList.add('todo-active');
                targetRow.focus();
                e.preventDefault();
                return;
            }
            return;
        }
        const idx = cells.indexOf(currentCell);
        if (idx === -1) return;

        // ArrowUp boundary: escape the top row of cells (idx < 7 in the
        // 7-column grid) up to the side-nearest month-nav arrow so the
        // arrow pair is reachable from the grid without Tab. Columns 0-2
        // (Sun/Mon/Tue) escape to #calendarPrev; columns 3-6
        // (Wed/Thu/Fri/Sat) escape to #calendarNext — the Wednesday tie
        // goes right because reading order is already moving rightward
        // when focus hits the middle column. outOfMonth cells in the top
        // row follow the same rule (the visual leading-day distinction
        // doesn't affect the return path). stopPropagation keeps the
        // cross-pane ArrowLeft/ArrowRight handler from also firing.
        if (isUp && idx < 7) {
            const target = document.getElementById((idx % 7) <= 2 ? 'calendarPrev' : 'calendarNext');
            if (target) {
                target.focus();
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }

        // Grid→panel boundary: ArrowDown from a cell in the last rendered
        // grid row (idx >= totalCells - 7) drops focus into the first
        // .todayRow.todoRowCard inside #calendarDayList when at least one
        // is present, instead of clamping. "Last row" reads off grid child
        // count so the rule works whether the month renders 5 rows or 6,
        // and treats in-month and outOfMonth cells in that trailing row
        // identically (the visual difference is opacity, not navigability).
        if (isDown) {
            const totalCells = grid.children.length;
            if (idx >= totalCells - 7) {
                const dayList = document.getElementById('calendarDayList');
                const firstPanelRow = dayList ? dayList.querySelector('.todayRow.todoRowCard') : null;
                if (firstPanelRow) {
                    firstPanelRow.focus();
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
            }
        }

        // ±1 for left/right, ±7 for up/down (7-column grid). Clamp to the
        // rendered range — no auto-advance to prev/next month.
        let nextIdx = idx;
        if (isLeft)       nextIdx = Math.max(idx - 1, 0);
        else if (isRight) nextIdx = Math.min(idx + 1, cells.length - 1);
        else if (isUp)    nextIdx = (idx - 7) >= 0 ? idx - 7 : idx;
        else if (isDown)  nextIdx = (idx + 7) < cells.length ? idx + 7 : idx;

        e.preventDefault();
        if (nextIdx === idx) return;
        const target = cells[nextIdx];
        if (target) target.focus();
    });

    // *** HELPER: clears all toDo DOM elements from mainList (index 1 onward) ***
    function clearToDos_global() {
        const mainDiv = document.getElementById('mainList');
        while (mainDiv.firstChild) {
            mainDiv.removeChild(mainDiv.firstChild);
        }
    }

    // ********************** CLICK LISTENERS ********************** //

    // Click Listener: That adds new project element
    projButton.addEventListener("click", function(){

        console.log("Called projButton");

        // Creating a project implies the user wants the project view —
        // switch back from TODAY so the new row's todo list lands in
        // front of the user instead of behind the dashboard shell.
        applyActiveView('projects');

        // on click should temporarily disable ability to continue clicking
        projButton.style.pointerEvents = "none";


        // click ability returns dependent on if user successfully adds title to project

        // selects projects list div by ID
        const sideMaDiv = document.getElementById("sideMa");

        const projChild = document.createElement("div");

        const titleInput = document.createElement("input");
        const badge = document.createElement("div");
        const spacer = document.createElement("div");


        projChild.classList.add("unselectedProject");
        projChild.id = "projChild";
        // tabindex makes the row reachable by the global ArrowLeft shortcut
        // and by arrow-key navigation in the sideMa keydown handler.
        projChild.setAttribute('tabindex', '0');

        // First Project Input
        titleInput.type = "text";
        titleInput.autocomplete = "off";
        titleInput.id = "projInput";
        titleInput.placeholder = "New Project";
        titleInput.value = "";
        titleInput.style.border = "none";
        // new rows start unlocked — user needs to type a name immediately
        titleInput.style.pointerEvents = "auto";
        titleInput.style.cursor = "text";

        // Right-aligned incomplete-count pill. Stays empty (hidden via CSS)
        // until the row commits and updateAllProjectBadges runs against the
        // committed name; this keeps the in-progress new-project row from
        // showing a stray "0" while the user is still typing the name.
        badge.className = "projBadge";
        badge.setAttribute('aria-hidden', 'true');

        // Create element with textbox for input
        sideMaDiv.appendChild(projChild);
        projChild.appendChild(titleInput);
        projChild.appendChild(badge);
        projChild.appendChild(spacer);

        // spacer.style.border = "1px solid red";
        spacer.style.width = "12px";

        let currentProperty = "";
        let newProperty = "";
        let firstTime = 0;

        let projectArray = [];
        let projectName = "";

        // Set when Enter triggers the explicit blur on line ~2679 so the
        // blur handler below doesn't re-enter the commit path.
        let committingViaEnter = false;

        // ****** INPUT LISTENER ******
        // Press enter after Project title input to set element information
        titleInput.addEventListener("keydown", function(event) {

            console.log("Called projButton > titleInput");


            // Get Project names and store into an array using - logicList.js
            let projectsList = listLogic.listProjectsArray();

            let exists = 0;

            let count = 0;

            const mainDiv = document.querySelector('#mainList');

            var childNodes = mainDiv.childNodes;

            // querySelect all the projChild elements, change their classes to unselectedProject
            var projOnChild = document.querySelector('.selectedProject');

            let enteredText = "";
            let trimmedText = "";
            let projectItems = [];



            if (event.key === "Enter") {

                console.log("Clicked Enter");

                enteredText = titleInput.value;
                newProperty = titleInput.value;

                // console.log("You entered: " + enteredText);
                committingViaEnter = true;

                // Empty rename on an already-committed project: refuse to
                // commit and revert the input to its last good name. Without
                // this, the input keeps the empty value visually while the
                // data still lives under currentProperty — re-selecting the
                // project then reads "" and fails to render any todos.
                if (firstTime !== 0 && enteredText.trim().length === 0) {
                    titleInput.value = currentProperty;
                    titleInput.style.color = "";
                    titleInput.style.pointerEvents = "none";
                    titleInput.style.cursor = "default";
                    titleInput.blur();
                    return;
                }

                titleInput.blur();


                // CHECKER - name variable set to switch on/off when a project name match occurs - variable
                while(count < projectsList.length){

                    if(projectsList[count] === enteredText){


                        exists = 1;

                        titleInput.textContent = "INVALID";
                        titleInput.style.color = 'red';

                        return;
                    }

                    count++;

                }

            }



            // if title entered has a length > 0 characters & there are no project name matches
            if ((enteredText.length > 0) && (exists === 0)){

                // projChild.style.backgroundColor = "none";
                titleInput.style.color = '';

                trimmedText = enteredText.trim();

                titleInput.textContent = trimmedText;
                titleInput.value = trimmedText;
                titleInput.style.fontSize = "14px";
                titleInput.style.pointerEvents = "none";
                titleInput.style.cursor = "default";



                if(firstTime === 0){

                    // - send title to addProject() in listLogic.js to add property to allProjects array
                    projectItems = listLogic.addProject(trimmedText);

                    projectArray = projectItems.array;
                    projectName = projectItems.string;


                    firstTime = 1;
                    currentProperty = titleInput.textContent;

                    selectProject(); // changes selection to element
                    clearToDos();

                    // function returns updated project array for DOM
                    projectItems = listLogic.listItems(projectName);

                }

                else{

                    // - send title to editToDo() in listLogic.js to edit currentProperty to allProjects array
                    projectItems = listLogic.editProject(currentProperty, newProperty);

                    projectArray = projectItems.array;
                    projectName = projectItems.string;

                    currentProperty = newProperty;

                    selectProject(); // changes selection to element
                    clearToDos();


                    // function returns updated project array for DOM
                    projectItems = listLogic.listItems(projectName);

                }

                // re-arm drag — the earlier blur() ran before addProject/editProject,
                // so attachProjectDrag's blur sync saw an uncommitted name
                projChild.setAttribute('draggable', 'true');

                // Sync the rail-mode initial chip + tooltip from the
                // committed name. Covers both first-time create and rename.
                applyProjectInitial(projChild, trimmedText);


                // Based on the designated allProjects array, take those items and add them to the DOM in
                // the form of toDo items
                addAllToDo_DOM(projectArray, projectName);
                focusBlankToDoInputIfDesktop();



                listLogic.listProjects();


                // On Click - should bring back ability to use add projects button
                projButton.style.pointerEvents = "auto";

                // NOTE: projChild > titleInput


                // *** LISTENERS ***

                // when element is clicked change selection to that element
                projChild.addEventListener("click", function(event){

                    console.log("called project selection");

                    // Clicking a project always means the user wants the
                    // project view active — switch back from TODAY if
                    // needed before resolving the selection.
                    applyActiveView('projects');

                    const alreadySelected = projChild.classList.contains('selectedProject');

                    if (!alreadySelected) {
                        // deselect whatever is currently selected
                        const current = document.querySelector('.selectedProject');
                        if (current) {
                            const prevInput = current.querySelector('#projInput');
                            if (prevInput) {
                                prevInput.style.pointerEvents = "none";
                                prevInput.style.cursor = "default";
                                prevInput.blur();
                            }
                            current.classList.remove("selectedProject");
                            current.classList.add("unselectedProject");
                        }

                        projChild.classList.remove("unselectedProject");
                        projChild.classList.add("selectedProject");

                        var innerValue = titleInput.value;
                        var arrayValues = listLogic.listItems(innerValue);

                        clearToDos();
                        applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(innerValue));

                        if(arrayValues){
                            addAllToDo_DOM(arrayValues, innerValue);
                        }
                        focusBlankToDoInputIfDesktop();

                        return;
                    }

                    // already selected — unlock the input for editing
                    titleInput.style.pointerEvents = "auto";
                    titleInput.style.cursor = "text";
                    titleInput.focus();

                });


                // *** FUNCTIONS ***

                // changes an elements selection
                function selectProject(){

                    if(projOnChild != null){

                        // console.log("selectedProject exists");

                        projOnChild.classList.remove("selectedProject");
                        projOnChild.classList.add("unselectedProject");

                    }
                    // changing ONLY the selected project
                    if(projChild.classList.contains("unselectedProject")){

                        projChild.classList.remove("unselectedProject");
                        projChild.classList.add("selectedProject");


                        // console.log("Class changed to selectedProject");

                    }

                    // Newly-committed projects default to null color; also
                    // covers editProject renames by re-reading current color.
                    applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(titleInput.value));

                }

                function clearToDos(){
                    clearToDos_global();
                }


            }



        }); // Ends "Enter" keydown function


        // ****** Focus/Shadow LISTENERS ******
        titleInput.addEventListener("focus", function() {
            if (titleInput.style.pointerEvents === "none") {
                titleInput.blur();
                return;
            }
            this.style.background = "rgba(0, 0, 0, 0)";
            projChild.style.boxShadow = "none";
            projChild.style.background = "var(--bg-active)";
        });

        // Click-away while the input is still in its initial unsubmitted
        // state: a non-empty value commits the project (same effect as
        // pressing Enter); an empty value silently discards the half-built
        // row so the user isn't left with a stranded, unselectable project.
        titleInput.addEventListener("blur", function() {
            if (committingViaEnter) {
                committingViaEnter = false;
                return;
            }
            // Once the row is committed, the only blur concern here is
            // catching a cleared-input strand: revert to the last good
            // name so the input stays in sync with the project's data key.
            if (firstTime !== 0) {
                if (titleInput.value.trim().length === 0) {
                    titleInput.value = currentProperty;
                    titleInput.style.color = "";
                }
                return;
            }

            const trimmed = titleInput.value.trim();
            if (trimmed.length === 0) {
                if (projChild.parentNode) {
                    projChild.parentNode.removeChild(projChild);
                }
                projButton.style.pointerEvents = "auto";
                return;
            }

            // Re-dispatch as Enter so the existing commit path (duplicate
            // check, addProject, selectProject, DOM wiring) runs once and
            // stays in one place.
            titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        });

        projChild.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.background = "var(--bg-hover)";
        });

        projChild.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.background = "transparent";
        });

        attachProjectContextMenu(projChild, titleInput);
        attachProjectDrag(projChild, titleInput);
        attachProjectInjectIndicator(projChild, titleInput);

        // Focus the new input synchronously inside this same user-gesture
        // tick. iOS Safari only summons the soft keyboard when .focus() is
        // called during the tap's gesture; deferring it (setTimeout, await,
        // requestAnimationFrame) drops the keyboard silently.
        titleInput.focus();

    });

    // ********************** SHADOW LISTENERS ********************** //

    // addProj Shadow listener
    projButton.addEventListener("mouseenter", function() {
        this.style.boxShadow = "0 3px 8px rgba(0, 0, 0, 0.2)";
      });

    projButton.addEventListener("mouseleave", function() {
        this.style.boxShadow = "none";
    });

    // projButton keyboard nav. Enter triggers the add-project click flow
    // (same path the mouse uses), ArrowUp returns focus to the last
    // committed project row — closing the loop opened by the sideMa
    // ArrowDown handler above. stopPropagation keeps the document-level
    // todo arrow-nav handler from also firing and stealing focus to a
    // todo row when no project row is the current focus target.
    projButton.addEventListener('keydown', function(e) {
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            projButton.click();
            return;
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            const rows = sideMain.querySelectorAll('#projChild');
            const last = rows[rows.length - 1];
            if (last) last.focus();
            return;
        }
        if (e.key === 'ArrowDown') {
            // ArrowDown off the bottom of the sidebar lands on the
            // version label area in the footer — the existing focusable
            // #footVersion button is queried fresh so the focus-visible
            // styling already wired for it (the dotted underline on
            // #footVersionLabel) lights up without new CSS.
            e.preventDefault();
            e.stopPropagation();
            const fv = document.getElementById('footVersion');
            if (fv) fv.focus();
        }
    });




    // Walk every committed sidebar project row and stamp its incomplete
    // count into the row's `.projBadge` child. Driven off the same
    // MutationObserver signal that powers updateFooterCounts so badges
    // refresh on every add / complete / uncomplete / delete of a todo
    // and every add / rename / delete of a project — keeping all sidebar
    // counts in lockstep without per-callsite wiring.
    function updateAllProjectBadges() {
        if (!sideMain) return;
        const rows = sideMain.querySelectorAll('#projChild');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const input = row.querySelector('#projInput');
            const badge = row.querySelector('.projBadge');
            if (!badge) continue;
            const name = input ? input.value.trim() : '';
            // Uncommitted rows (new-project input still empty, or input
            // mid-rename with an empty value) have no project to count
            // against — clear the badge so the row stays clean instead
            // of displaying a stray "0" during the input flow.
            if (!name || listLogic.listProjectsArray().indexOf(name) === -1) {
                badge.textContent = '';
                badge.setAttribute('data-empty', 'true');
                continue;
            }
            const count = listLogic.getProjectIncompleteCount(name);
            badge.textContent = String(count);
            badge.removeAttribute('data-empty');
        }
    }

    function updateFooterCounts() {
        updateAllProjectBadges();
        const selected = sideMain.querySelector('.selectedProject');
        let open = 0, done = 0;
        let name = '';
        if (selected) {
            const input = selected.querySelector('#projInput');
            name = input ? input.value.trim() : '';
            const items = listLogic.listItems(name) || [];
            items.forEach(function(i) {
                if (!i.tit) return;
                if (i.completed) done++; else open++;
            });
        }
        footOpen.textContent = open + ' OPEN';
        footDone.textContent = done + ' DONE';

        updateMobileProjHeader(name, open, done);
    }

    // Resolve the project name at the given index in the authoritative
    // listLogic order and route the selection through the matching
    // #projChild click — the same path the sidebar uses. Returns true
    // when the navigation committed (i.e. the target index resolved to
    // a real, non-active project), false otherwise. Centralising the
    // routing keeps the chevron click and the swipe gesture sharing one
    // selection codepath so the existing accent + addAllToDo_DOM dance
    // runs unchanged.
    function navigateToProjectByIndex(targetIdx) {
        const projects = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
        const total = projects.length;
        if (total === 0) return false;
        if (targetIdx < 0 || targetIdx >= total) return false;
        const targetName = projects[targetIdx];
        const rows = sideMain.querySelectorAll('#projChild');
        for (let i = 0; i < rows.length; i++) {
            const inp = rows[i].querySelector('#projInput');
            if (inp && inp.value.trim() === targetName) {
                rows[i].click();
                if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(10); } catch (_) { /* noop */ }
                }
                return true;
            }
        }
        return false;
    }

    mobileProjPrev.addEventListener('click', function() {
        const projects = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
        const activeName = mobileProjName.textContent || '';
        const activeIdx  = activeName ? projects.indexOf(activeName) : -1;
        if (activeIdx > 0) navigateToProjectByIndex(activeIdx - 1);
    });
    mobileProjNext.addEventListener('click', function() {
        const projects = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
        const activeName = mobileProjName.textContent || '';
        const activeIdx  = activeName ? projects.indexOf(activeName) : -1;
        if (activeIdx >= 0 && activeIdx < projects.length - 1) navigateToProjectByIndex(activeIdx + 1);
    });

    // ── swipe-on-title gesture (mobile only) ──
    // Horizontal swipe on the title row navigates prev/next project,
    // mirroring the chevron clicks. Hard-stop at the ends with a small
    // rubber-band translate so the user feels the boundary. Vertical
    // dominant gestures fall through to native scroll — we never
    // preventDefault until we're sure the gesture is horizontal-dominant
    // and past a small intent threshold. Scoped to the title row only;
    // row swipe-to-delete already owns horizontal gestures over
    // #mainList below.
    let swipeStartX = 0;
    let swipeStartY = 0;
    let swipeActive = false;
    let swipeHorizontal = false;
    const SWIPE_COMMIT_PX = 40;
    const SWIPE_INTENT_PX = 10;
    const RUBBER_BAND = 0.25;

    function clearSwipeTransform() {
        mobileProjTitleRow.style.transform = '';
        mobileProjTitleRow.style.transition = 'transform 160ms ease';
        setTimeout(function() {
            mobileProjTitleRow.style.transition = '';
        }, 200);
    }

    function activeProjectIndex() {
        const projects = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
        const activeName = mobileProjName.textContent || '';
        return { projects: projects, idx: activeName ? projects.indexOf(activeName) : -1 };
    }

    mobileProjTitleRow.addEventListener('touchstart', function(event) {
        if (event.touches.length !== 1) return;
        const t = event.touches[0];
        swipeStartX = t.clientX;
        swipeStartY = t.clientY;
        swipeActive = true;
        swipeHorizontal = false;
        mobileProjTitleRow.style.transition = '';
    }, { passive: true });

    mobileProjTitleRow.addEventListener('touchmove', function(event) {
        if (!swipeActive || event.touches.length !== 1) return;
        const t = event.touches[0];
        const dx = t.clientX - swipeStartX;
        const dy = t.clientY - swipeStartY;
        if (!swipeHorizontal) {
            if (Math.abs(dx) < SWIPE_INTENT_PX && Math.abs(dy) < SWIPE_INTENT_PX) return;
            if (Math.abs(dy) > Math.abs(dx)) {
                swipeActive = false;
                return;
            }
            swipeHorizontal = true;
        }
        const state = activeProjectIndex();
        const atStart = state.idx <= 0;
        const atEnd   = state.idx >= state.projects.length - 1;
        let translate = dx;
        if ((dx > 0 && atStart) || (dx < 0 && atEnd)) {
            translate = dx * RUBBER_BAND;
        }
        mobileProjTitleRow.style.transform = 'translateX(' + translate + 'px)';
        if (event.cancelable) event.preventDefault();
    }, { passive: false });

    function endSwipe(event) {
        if (!swipeActive) return;
        const wasHorizontal = swipeHorizontal;
        swipeActive = false;
        swipeHorizontal = false;
        if (!wasHorizontal) {
            clearSwipeTransform();
            return;
        }
        const touch = (event.changedTouches && event.changedTouches[0]) || null;
        const dx = touch ? (touch.clientX - swipeStartX) : 0;
        clearSwipeTransform();
        if (Math.abs(dx) < SWIPE_COMMIT_PX) return;
        const state = activeProjectIndex();
        if (state.idx < 0) return;
        if (dx < 0 && state.idx < state.projects.length - 1) {
            navigateToProjectByIndex(state.idx + 1);
        } else if (dx > 0 && state.idx > 0) {
            navigateToProjectByIndex(state.idx - 1);
        }
    }

    mobileProjTitleRow.addEventListener('touchend', endSwipe);
    mobileProjTitleRow.addEventListener('touchcancel', function() {
        if (swipeActive) {
            swipeActive = false;
            swipeHorizontal = false;
            clearSwipeTransform();
        }
    });

    // Rebuild the mobile project header (label, name, counts, chevron
    // enable state) off the same observer signal updateFooterCounts
    // uses. The chevrons' disabled state is recomputed each pass since
    // project add / rename / delete don't reliably surface as a single
    // mutation on #sideMa alone — driving disabled off authoritative
    // state keeps the boundaries honest.
    function updateMobileProjHeader(activeName, open, done) {
        const projects = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
        const total = projects.length;
        const activeIdx = activeName ? projects.indexOf(activeName) : -1;

        if (total > 0 && activeIdx >= 0) {
            mobileProjLabel.textContent = 'PROJECT ' + (activeIdx + 1) + ' OF ' + total;
            mobileProjName.textContent  = activeName;
            mobileProjHeader.removeAttribute('data-empty');
            // Per-project accent flows into the title via --proj-accent on
            // the header; mobileProjName resolves it through CSS
            // var(--proj-accent, var(--accent)).
            applyProjectAccent(mobileProjHeader, listLogic.getProjectColor(activeName));
        } else {
            mobileProjLabel.textContent = '';
            mobileProjName.textContent  = '';
            mobileProjHeader.setAttribute('data-empty', 'true');
            applyProjectAccent(mobileProjHeader, null);
        }

        mobileProjOpen.textContent = open + ' open';
        mobileProjDone.textContent = done + ' done';

        const atStart = activeIdx <= 0;
        const atEnd   = activeIdx < 0 || activeIdx >= total - 1;
        mobileProjPrev.disabled = atStart;
        mobileProjNext.disabled = atEnd;
        mobileProjPrev.setAttribute('aria-disabled', atStart ? 'true' : 'false');
        mobileProjNext.setAttribute('aria-disabled', atEnd ? 'true' : 'false');
    }

    const footObserver = new MutationObserver(updateFooterCounts);
    footObserver.observe(mainList, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
    });
    footObserver.observe(sideMain, {
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'value']
    });

    setTimeout(updateFooterCounts, 0);

    // Mount the desktop companion on first boot when the pref allows and
    // the viewport qualifies. Deferred by a tick so document.body exists
    // (index.js appends the component right after component() returns).
    setTimeout(ensureCompanion, 0);

    // Mirror the desktop companion-enabled flag onto a body class so the
    // mobile empty-state ghost spacer (Today + Projects views) can hide its
    // ghost when the user has turned the floating companion off. Deferred
    // for the same reason as ensureCompanion above — document.body has to
    // exist before the class can be toggled.
    setTimeout(applyCompanionGhostPreference, 0);

    // Window-level drag-and-drop import. Dropping a .json file anywhere on
    // the page routes through the same parse → validate → confirm → replace
    // pipeline as the file picker, with rebuildAfterImport as the
    // post-replace UI redraw. Pointer-coarse devices skip the listeners
    // entirely (the function early-returns).
    attachDragDropImport(rebuildAfterImport);

    return base;

};


// Wipe the live project sidebar + todo list and rebuild from listLogic's
// current state. Called after a successful import once
// listLogic.replaceAllProjects has rewritten storage. Mirrors the boot
// sequence (clear, then restoreFromStorage) so any post-restore selection
// and accent logic still runs.
//
// Passes { fromSync: true } through restoreFromStorage so the post-import
// per-project sort that addToDos_restore triggers flags itself as
// reconciliation work and skips per-row Supabase mirror writes.
//
// Also passes { deferSave: true } so the per-project sort runs in memory
// but skips its own storage write — replaceAllProjects already sorted
// and persisted the imported tree upstream, so the rebuild's re-sort is
// a defensive no-op and its write is pure duplication.
function rebuildAfterImport() {

    const sideMaDiv = document.getElementById('sideMa');
    const mainListDiv = document.getElementById('mainList');

    if (sideMaDiv) {
        const existing = sideMaDiv.querySelectorAll('#projChild');
        existing.forEach(function(node) {
            if (node.parentNode) node.parentNode.removeChild(node);
        });
    }
    if (mainListDiv) {
        while (mainListDiv.firstChild) mainListDiv.removeChild(mainListDiv.firstChild);
    }

    restoreFromStorage({ fromSync: true, deferSave: true });
}


// Replay-tour helper: when the user has projects but the currently
// selected one holds only the blank placeholder, push the same starter
// todos seedSampleProject ships so the desktop coachmark steps that
// anchor against per-row chrome (#duePill, #descToggle) have a real
// titled row to point at. A no-op when no project is selected, when the
// active project already has any titled item, or when the seed itself
// declines (listLogic.seedSampleTodos returns false). Re-renders the
// main list in place so the new rows appear without touching the
// sidebar selection.
function seedSampleTodosIntoActiveProjectIfEmpty() {
    const selected = document.querySelector('.selectedProject');
    if (!selected) return;
    const projInput = selected.querySelector('#projInput');
    const activeName = projInput ? projInput.value.trim() : '';
    if (!activeName) return;

    const items = listLogic.listItems(activeName) || [];
    const hasReal = items.some(function(it) { return it && it.tit !== ''; });
    if (hasReal) return;

    if (!listLogic.seedSampleTodos(activeName)) return;

    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    while (mainListDiv.firstChild) mainListDiv.removeChild(mainListDiv.firstChild);
    addToDos_restore(listLogic.listItems(activeName), activeName);
}


export { component, restoreFromStorage, notifyUpdateAvailable };


// Phase 5: one-shot full re-render hook for Supabase hydration. The
// boot path calls restoreFromStorage off the local cache so the UI
// has something to show immediately; listLogic.hydrateFromSupabase
// then reconciles against the backend in the background and
// dispatches this event when the in-memory tree has been replaced.
// The listener clears the sidebar + main list DOM and replays
// restoreFromStorage so the rebuild is mechanical — same code path
// as initial load, no special-case "diff and patch" logic to keep
// in sync with the renderer.
// The webpack entry was collapsed to a single bundle, so main.js's module
// body evaluates exactly once at boot and this listener registers a single
// time — no double-eval guard is needed.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('listLogicHydrated', function onHydrate() {
        const sideMaDiv = document.getElementById('sideMa');
        const mainListDiv = document.getElementById('mainList');
        if (sideMaDiv) {
            while (sideMaDiv.firstChild) sideMaDiv.removeChild(sideMaDiv.firstChild);
        }
        if (mainListDiv) {
            while (mainListDiv.firstChild) mainListDiv.removeChild(mainListDiv.firstChild);
        }
        try {
            restoreFromStorage({ fromSync: true });
        } catch (e) {
            console.warn('[listLogicHydrated] re-render failed:', e);
        }
        // Warm the inject_targets cache now that the user's session is
        // ready — without it the inject buttons can't tell "no target
        // mapped" from "targets just not loaded yet" and stick on the
        // no-target call-to-action even when a route exists.
        try {
            initInjectTargets();
        } catch (e) {
            console.warn('[listLogicHydrated] initInjectTargets failed:', e);
        }
    });
}

// Reorder the active project's rows whenever a due-date edit lands while the
// global sort is set to Due. Without this, the row stayed in its original DOM
// slot after the user picked a new date and the new ordering only surfaced on
// the next sort change or page reload. reorderToDoDOM re-parents existing rows
// via appendChild so event listeners + open description/stats panels survive
// the reorder.
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('todoDueDateChanged', function onDueChange(evt) {
        const project = evt && evt.detail && evt.detail.project;
        if (!project) return;
        if (getTaskSort() !== 'due') return;
        try {
            reorderToDoDOM(project);
        } catch (e) {
            console.warn('[todoDueDateChanged] reorder failed:', e);
        }
    });
}

// Center-screen confirmation flash for the mobile swipe-to-complete gesture.
// toDoRow.js dispatches `todoSwipeRightComplete` from its swipe onRight handler
// when the row goes uncompleted → completed (swiping right to un-complete an
// already-completed row stays silent). The listener is registered once at
// module-eval time (the single-entry bundle evaluates main.js exactly once).
// Each fire spawns a short-lived DOM node that removes itself when the
// animation ends, so rapid-fire swipes never leak overlapping overlays.
function playSwipeCompleteCheckmark() {
    if (prefersReducedMotion()) return;
    if (typeof document === 'undefined' || !document.body) return;
    const flash = document.createElement('div');
    flash.className = 'swipeCompleteFlash';
    flash.setAttribute('aria-hidden', 'true');
    const ripple = document.createElement('div');
    ripple.className = 'swipeCompleteFlashRipple';
    const check = document.createElement('div');
    check.className = 'swipeCompleteFlashCheck';
    check.textContent = '✓';
    flash.appendChild(ripple);
    flash.appendChild(check);
    document.body.appendChild(flash);
    setTimeout(function() {
        if (flash.parentNode) flash.parentNode.removeChild(flash);
    }, 1200);
}

if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    document.addEventListener('todoSwipeRightComplete', playSwipeCompleteCheckmark);
}


// Bulk open/close every committed row's description panel. Clicks the row's
// own #descToggle so the closure-scoped `switcher` inside wireDescToggle
// stays in sync with the DOM — individual per-row toggles keep working
// after a bulk action. Blank placeholder rows hide their #descToggle
// (display: none), so filtering on that skips them.
//
// The dataset.bulkDescToggle marker tells the exclusive-collapse listener
// (see wireExclusiveCompletedDescCollapse) that synthetic clicks emitted
// from this loop are an explicit user override and should NOT auto-collapse
// the COMPLETED section. The marker is cleared in a finally so an
// in-iteration throw can't leave it stuck on.
function expandAllDescriptions() {
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    mainListDiv.dataset.bulkDescToggle = '1';
    try {
        mainListDiv.querySelectorAll('#descToggle').forEach(function(toggle) {
            if (toggle.style.display === 'none') return;
            if (!toggle.classList.contains('open')) toggle.click();
        });
    } finally {
        delete mainListDiv.dataset.bulkDescToggle;
    }
}

function collapseAllDescriptions() {
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    mainListDiv.dataset.bulkDescToggle = '1';
    try {
        mainListDiv.querySelectorAll('#descToggle').forEach(function(toggle) {
            if (toggle.classList.contains('open')) toggle.click();
        });
    } finally {
        delete mainListDiv.dataset.bulkDescToggle;
    }
}


// Mutually-exclusive collapse between todo description panels and the
// COMPLETED section. Without this guard, an open description panel and an
// expanded Completed block can visually collide because both regions claim
// the same vertical space in the list — the prior CSS-reflow fix wasn't
// enough on its own. The contract: only one of {any open description, the
// COMPLETED section} is allowed to be expanded at a time. Opening one
// auto-collapses the other.
//
// Wired in capture phase on #mainList so we run BEFORE the original
// descToggle / completedHeader click handlers. That lets us synthesize a
// click on the "other" affordance (header.click() to collapse Completed, or
// the bulk collapseAllDescriptions helper) before the just-clicked target
// flips, reusing the existing animation/state writers rather than
// introducing a separate "exclusive accordion" abstraction.
//
// The bulk EXPAND ALL control sets mainListDiv.dataset.bulkDescToggle for
// the duration of its iteration; this listener bails when the marker is
// present so "expand everything" remains an explicit user override that
// does not nuke the open Completed section. The same marker protects
// against synthetic re-entry from the synthesized header.click() /
// collapseAllDescriptions() calls below.
function wireExclusiveCompletedDescCollapse(mainListDiv) {
    if (!mainListDiv) return;
    mainListDiv.addEventListener('click', function(event) {
        if (mainListDiv.dataset.bulkDescToggle === '1') return;
        const target = event.target;
        if (!target || typeof target.closest !== 'function') return;

        const dt = target.closest('#descToggle');
        if (dt && mainListDiv.contains(dt)) {
            // descToggle.click that is about to OPEN (not currently .open).
            // Blank placeholder rows hide their descToggle (display: none)
            // so a click can only reach this branch on a committed row.
            if (!dt.classList.contains('open') && isCompletedSectionOpen()) {
                const header = mainListDiv.querySelector('#completedHeader');
                if (header) {
                    mainListDiv.dataset.bulkDescToggle = '1';
                    try { header.click(); }
                    finally { delete mainListDiv.dataset.bulkDescToggle; }
                }
            }
            return;
        }

        const ch = target.closest('#completedHeader');
        if (ch && mainListDiv.contains(ch)) {
            // Mobile: the inline accordion fails to render the completed
            // list reliably on touch (the Rendered / Raw viewer tabs end up
            // unreachable). Replace the inline toggle with a slide-up
            // bottom sheet — the rest of this handler is for the desktop
            // accordion path, so stop the click here on mobile.
            if (isMobileViewport()) {
                event.preventDefault();
                event.stopImmediatePropagation();
                openCompletedMobileSheet();
                return;
            }
            // completedHeader click that is about to OPEN (current persisted
            // flag is false). Close every open description so the expanded
            // Completed block can sit cleanly below the open todo rows.
            if (!isCompletedSectionOpen()) {
                collapseAllDescriptions();
            }
        }
    }, true);
}

// Wire the viewer card's mobile tap-to-open-sheet behavior. The viewer card
// is built in todoMdViewer.js but the mobile-sheet machinery (and its state)
// lives in mobileSheets.js, so the card-tap logic is registered as a handler
// rather than imported — preserving the exact tap behavior without a circular
// import.
setViewerCardTapHandler(function(card, event) {
    if (!isMobileViewport()) return;
    if (event.target.closest('button, [role="tab"], a, input, label')) return;
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv || !mainListDiv.contains(card)) return;
    // Bail when either mobile sheet is already open — a second sheet on
    // top would be redundant and strand the card in the wrong overlay.
    if (isAnyMobileSheetOpen()) return;
    openViewerMobileSheet(card);
});


// restoreFromStorage — call this AFTER component() is appended to document.body
// so that getElementById calls resolve against the live DOM.
//
// `opts.fromSync: true` is threaded through to the auto-selected project's
// addToDos_restore call so the per-project sort fires as reconciliation
// work and skips its Supabase mirror writes. The user-triggered re-render
// paths reached later (project click, rename commit) keep their existing
// behaviour because they don't read opts.
function restoreFromStorage(opts) {

    // First-run seeding: both the desktop spotlight tour and the mobile
    // welcome carousel anchor against the seeded sample project, so seed
    // on every viewport when onboarding hasn't completed. The seed itself
    // is idempotent — todoapp_sampleSeeded keeps it once-per-install.
    let sampleJustSeeded = false;
    if (!isOnboardingComplete()) {
        sampleJustSeeded = listLogic.seedSampleProject();
    }

    const savedProjects = listLogic.listProjectsArray();

    if (savedProjects.length === 0) {
        updateEmptyState(document.getElementById('mainList'));
        applyActiveView(getActiveView());
        // First-run tour — reaches here only when seeding was skipped
        // (mobile, already-seeded, or onboarding done); the function
        // itself gates on the persisted onboarding flag.
        maybeStartFirstRunTour();
        return;
    }

    savedProjects.forEach(function(projectName) {

        const sideMaDiv = document.getElementById("sideMa");
        const mainListDiv = document.getElementById("mainList");
        const projButton  = document.getElementById("projButton");

        const projChild   = document.createElement("div");
        const titleInput  = document.createElement("input");
        const badge       = document.createElement("div");
        const spacer      = document.createElement("div");

        projChild.classList.add("unselectedProject");
        projChild.id = "projChild";
        // tabindex makes the row reachable by the global ArrowLeft shortcut
        // and by arrow-key navigation in the sideMa keydown handler.
        projChild.setAttribute('tabindex', '0');
        applyProjectAccent(projChild, listLogic.getProjectColor(projectName));
        applyProjectInitial(projChild, projectName);

        titleInput.type        = "text";
        titleInput.autocomplete = "off";
        titleInput.id          = "projInput";
        titleInput.value       = projectName;
        titleInput.style.border = "none";
        titleInput.style.fontSize = "14px";
        titleInput.style.pointerEvents = "none";
        titleInput.style.cursor = "default";

        badge.className = "projBadge";
        badge.setAttribute('aria-hidden', 'true');

        spacer.style.width  = "12px";

        sideMaDiv.appendChild(projChild);
        projChild.appendChild(titleInput);
        projChild.appendChild(badge);
        projChild.appendChild(spacer);

        // track current name for rename
        let currentProperty = projectName;
        let renameHandledByEnter = false;

        // rename on Enter — mirrors the editProject flow for new projects
        titleInput.addEventListener("keydown", function(event) {

            if (event.key !== "Enter") return;

            const newName = titleInput.value.trim();
            // Empty rename: refuse to commit and snap the input back to the
            // last good name. Letting an empty value linger in titleInput
            // detaches the row from the project's data key, which downstream
            // click/render paths read directly off titleInput.value.
            if (newName.length === 0) {
                titleInput.value = currentProperty;
                titleInput.style.color = "";
                titleInput.style.pointerEvents = "none";
                titleInput.style.cursor = "default";
                renameHandledByEnter = true;
                titleInput.blur();
                return;
            }

            // no-op if name hasn't changed
            if (newName === currentProperty) {
                titleInput.style.color = "";
                titleInput.style.pointerEvents = "none";
                titleInput.style.cursor = "default";
                renameHandledByEnter = true;
                titleInput.blur();
                return;
            }

            // check for duplicate names (excluding self)
            const existing = listLogic.listProjectsArray();
            const duplicate = existing.some(function(n) { return n === newName && n !== currentProperty; });
            if (duplicate) {
                titleInput.style.color = "red";
                return;
            }

            titleInput.style.color = "";
            listLogic.editProject(currentProperty, newName);
            currentProperty = newName;
            titleInput.value = newName;
            applyProjectInitial(projChild, newName);
            titleInput.style.pointerEvents = "none";
            titleInput.style.cursor = "default";
            renameHandledByEnter = true;
            titleInput.blur();

            // if this project is selected, re-render its todos under the new name
            if (projChild.classList.contains('selectedProject')) {
                const mainDiv = document.getElementById('mainList');
                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }
                const items = listLogic.listItems(newName);
                if (items) {
                    const hasReal = items.some(function(i) { return i.tit !== ""; });
                    if (hasReal) {
                        addToDos_restore(items, newName);
                    } else {
                        addAllToDo_DOM(items, newName);
                    }
                }
                focusBlankToDoInputIfDesktop();
            }

        });

        titleInput.addEventListener("focus", function() {
            if (titleInput.style.pointerEvents === "none") {
                titleInput.blur();
                return;
            }
            titleInput.style.cursor = "text";
        });

        titleInput.addEventListener("blur", function() {
            titleInput.style.cursor = "default";

            // Enter already handled this rename — don't double-process
            if (renameHandledByEnter) {
                renameHandledByEnter = false;
                return;
            }

            // commit rename on blur (e.g. user clicks away without pressing Enter)
            const newName = titleInput.value.trim();
            // Empty value on blur: revert the input to the last good name so
            // the row stays in sync with its data key. Without this, clicking
            // away from a cleared input strands the project — the title shows
            // nothing, and the next click reads "" as the lookup key.
            if (newName.length === 0) {
                titleInput.value = currentProperty;
                titleInput.style.color = "";
                return;
            }
            if (newName === currentProperty) return;

            // check for duplicate names (excluding self)
            const existing = listLogic.listProjectsArray();
            const duplicate = existing.some(function(n) { return n === newName && n !== currentProperty; });
            if (duplicate) {
                // revert to the last committed name
                titleInput.value = currentProperty;
                titleInput.style.color = "";
                return;
            }

            titleInput.style.color = "";
            listLogic.editProject(currentProperty, newName);
            currentProperty = newName;
            applyProjectInitial(projChild, newName);

            // re-render todos if this project is selected
            if (projChild.classList.contains('selectedProject')) {
                const mainDiv = document.getElementById('mainList');
                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }
                const items = listLogic.listItems(newName);
                if (items) {
                    const hasReal = items.some(function(i) { return i.tit !== ""; });
                    if (hasReal) {
                        addToDos_restore(items, newName);
                    } else {
                        addAllToDo_DOM(items, newName);
                    }
                }
                focusBlankToDoInputIfDesktop();
            }
        });

        // select this project and show its todos
        projChild.addEventListener("click", function(event) {

            // Clicking a project always switches the top-level view back
            // to PROJECTS — TODAY is a dashboard, not a project context.
            applyActiveView('projects');

            const alreadySelected = projChild.classList.contains('selectedProject');

            // first click — select the project
            if (!alreadySelected) {
                const current = document.querySelector('.selectedProject');
                if (current) {
                    // lock the previously selected project's input
                    const prevInput = current.querySelector('#projInput');
                    if (prevInput) {
                        prevInput.style.pointerEvents = "none";
                        prevInput.style.cursor = "default";
                        prevInput.blur();
                    }
                    current.classList.remove("selectedProject");
                    current.classList.add("unselectedProject");
                }
                projChild.classList.remove("unselectedProject");
                projChild.classList.add("selectedProject");

                // STACK mobile inline-expand: project switch resets the
                // session-scoped date chip back to Today and clears the
                // chaining-mode placeholder so the new project's first
                // blank reads as a fresh "Add a task…" rather than a
                // continuation from the previous project.
                resetMobileCreateSession();

                const name  = titleInput.value;
                const items = listLogic.listItems(name);
                clearToDos_restore();
                applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(name));

                const hasRealItems = items && items.some(function(i){ return i.tit !== ""; });
                if (hasRealItems) {
                    addToDos_restore(items, name);
                } else if (items) {
                    addAllToDo_DOM(items, name);
                }
                focusBlankToDoInputIfDesktop();

                return;
            }

            // already selected — any click unlocks the input for editing
            titleInput.style.pointerEvents = "auto";
            titleInput.style.cursor = "text";
            titleInput.focus();
        });

        projChild.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.background = "var(--bg-hover)";
        });
        projChild.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.background = "transparent";
        });

        attachProjectContextMenu(projChild, titleInput);
        attachProjectDrag(projChild, titleInput);
        attachProjectInjectIndicator(projChild, titleInput);

    });

    // auto-select last project and render its todos
    const lastProject     = savedProjects[savedProjects.length - 1];
    const allProjChildren = document.querySelectorAll('#projChild');
    const lastChild       = allProjChildren[allProjChildren.length - 1];

    if (lastChild) {
        lastChild.classList.remove("unselectedProject");
        lastChild.classList.add("selectedProject");
    }
    applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(lastProject));

    const lastItems       = listLogic.listItems(lastProject);
    const lastHasReal     = lastItems && lastItems.some(function(i){ return i.tit !== ""; });
    if (lastHasReal) {
        addToDos_restore(lastItems, lastProject, opts);
    } else if (lastItems) {
        addAllToDo_DOM(lastItems, lastProject);
    }
    focusBlankToDoInputIfDesktop();

    // Honour the persisted top-level view. When the saved view is
    // 'inbox', this also clears the auto-selected last project so the
    // sidebar reads as "no active project" — Today owns the main panel
    // and the project list is just navigation chrome at that point.
    applyActiveView(getActiveView());

    // First-run welcome tour — fires once when the just-seeded sample
    // project has produced live DOM targets (sidebar row, due pill,
    // description chevron). Returning users whose projects already
    // existed before this load skip this path entirely.
    if (sampleJustSeeded) {
        maybeStartFirstRunTour();
    }

}

// Resolves the first focusable element of whichever main-pane view is
// currently active. Used by the ArrowDown drop-in handler wired on each
// view pill so the keystroke lands on rendered items rather than on a
// hidden node when the user is on a different view than the pill they
// pressed from. Returns null when no suitable target is found (e.g.,
// before component() finishes wiring).
function firstFocusableInActiveMainView() {
    const view = getActiveView();
    if (view === 'inbox') {
        // The Inbox view renders the cross-project ideas list (renderInbox).
        // Its rows expose a status-label control but no ArrowDown drop-in
        // target is wired for this view, so there is no focusable element to
        // hand the keystroke to.
        return null;
    }
    if (view === 'calendar') {
        const grid = document.getElementById('calendarGrid');
        if (grid) {
            const selected = grid.querySelector('.calendarCell.isSelected');
            if (selected) return selected;
            // Skip leading days from the prior month so the cold-start case
            // (no prior selection) lands inside the visible month instead
            // of on a dimmed outOfMonth cell.
            const firstInMonth = grid.querySelector('.calendarCell:not(.outOfMonth)');
            if (firstInMonth) return firstInMonth;
            const first = grid.querySelector('.calendarCell');
            if (first) return first;
        }
        return null;
    }
    // PROJECTS view (default) — prefer the empty-state input when the
    // project has no todos, then the blank-placeholder row's #toDoInput,
    // then the first committed row's tabindex="-1" focus target.
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return null;
    const esInput = mainListDiv.querySelector('#emptyStateInput');
    if (esInput) return esInput;
    const allRows = mainListDiv.querySelectorAll('#toDoChild');
    for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        if (row.querySelector('#addGlyph')) {
            const input = row.querySelector('#toDoInput');
            if (input) return input;
        }
    }
    if (allRows.length > 0) return allRows[0];
    return null;
}

// Apply the top-level Inbox / Projects view. Module-scope so both the
// in-component pill click handlers and the restoreFromStorage auto-init
// path can route through one entry point. Writes the chosen view to
// localStorage, flips #mainBar's data-view attribute (the CSS show/hide
// hook for the two surfaces), syncs the pill .active state, and — when
// switching to today — clears any selected project in the sidebar and
// refreshes the date header text. Safe to call before component() has
// run; missing nodes short-circuit silently so the boot order stays
// flexible.
function applyActiveView(view) {
    let safe = 'projects';
    if (view === 'inbox') safe = 'inbox';
    else if (view === 'calendar') safe = 'calendar';
    setActiveView(safe);

    const mainBar = document.getElementById('mainBar');
    if (mainBar) mainBar.setAttribute('data-view', safe);
    // Mirror onto <body> so the desktop header's relocated pill + counts hide
    // in INBOX / CALENDAR — at desktop widths they live in the top header, no
    // longer under the task-pane grid, so the pane-scoped rules can't reach
    // them.
    document.body.setAttribute('data-view', safe);

    const pillInbox    = document.getElementById('viewPillInbox');
    const pillProjects = document.getElementById('viewPillProjects');
    const pillCalendar = document.getElementById('viewPillCalendar');
    if (pillInbox) {
        pillInbox.classList.toggle('active', safe === 'inbox');
        pillInbox.setAttribute('aria-pressed', safe === 'inbox' ? 'true' : 'false');
    }
    if (pillProjects) {
        pillProjects.classList.toggle('active', safe === 'projects');
        pillProjects.setAttribute('aria-pressed', safe === 'projects' ? 'true' : 'false');
    }
    if (pillCalendar) {
        pillCalendar.classList.toggle('active', safe === 'calendar');
        pillCalendar.setAttribute('aria-pressed', safe === 'calendar' ? 'true' : 'false');
    }

    // Mirror the active state on the mobile bottom tab bar so the same
    // applyActiveView call keeps both navigators in sync — desktop pills
    // and mobile tabs cannot drift.
    const tabProjects = document.getElementById('mobileTabProjects');
    const tabInbox    = document.getElementById('mobileTabInbox');
    const tabCalendar = document.getElementById('mobileTabCalendar');
    if (tabProjects) {
        tabProjects.classList.toggle('active', safe === 'projects');
        tabProjects.setAttribute('aria-pressed', safe === 'projects' ? 'true' : 'false');
    }
    if (tabInbox) {
        tabInbox.classList.toggle('active', safe === 'inbox');
        tabInbox.setAttribute('aria-pressed', safe === 'inbox' ? 'true' : 'false');
    }
    if (tabCalendar) {
        tabCalendar.classList.toggle('active', safe === 'calendar');
        tabCalendar.setAttribute('aria-pressed', safe === 'calendar' ? 'true' : 'false');
    }

    if (safe === 'inbox') {
        // The sidebar selection persists across view switches. Sidebar
        // and #mobileProjHeader are hidden on TODAY anyway, so the
        // lingering .selectedProject has zero visual effect — and on the
        // return trip to PROJECTS, updateMobileProjHeader re-paints from
        // the still-selected row instead of being stuck with
        // data-empty="true".
        renderInbox();
    } else if (safe === 'calendar') {
        // Same reasoning as TODAY — keep .selectedProject set so PROJECTS
        // returns to a populated mobile header. CALENDAR owns the main
        // panel; the sidebar is hidden so the lingering class is
        // invisible until PROJECTS reactivates.
        resetCalendarStateToToday();
        renderCalendarView();
    }

}

// Mirror the desktop companion-enabled flag onto body.companion-ghost-off so
// the mobile empty-state ghost spacers on Today and Projects can hide their
// painted ghost when the user has the floating companion turned off. The
// spacer's reserved flex space stays in place (visibility:hidden, not
// display:none) so the layout doesn't shift on toggle. Idempotent — called
// from initial setup and from every flip of the companion toggle.
function applyCompanionGhostPreference() {
    if (!document.body) return;
    document.body.classList.toggle('companion-ghost-off', !isCompanionEnabled());
}


// ── helpers used only by restoreFromStorage ──

function clearToDos_restore() {
    const mainDiv = document.getElementById('mainList');
    while (mainDiv.firstChild) {
        mainDiv.removeChild(mainDiv.firstChild);
    }
}



// ********************************************** BUG BASHING ********************************************** //
/**
 * FIXED - 1. When multiple projects are added, then all are removed,
 *            it will not remove the last project to exist other than 'Default'.
 *            The existing properties will be { 'Default', 'Project 1' }
 *
 * PROBLEM - 2. Having issues with deletion/addition of DOM/Array elements
 *         - issue is still present when deleting first element and adding new element,
 *         - two new DOM elements remain after deletion of each element
 *
 * FIXED - 3. When clicking on different projects the addToDo button will disable
 *              unnecessarily, leading to not being able to add new toDo items.
 *
 * FIXED - 4. When removing projects, the initial project is also removed BUT,
 *         -    all projects after the initial project remain and are unable to be
 *         -    removed.
 *
 * PROBLEM - 5. When creating a new project with the same name as another the toDo items
 *              end up being deleted unexpectedly. I think the regen function takes the project name
 *              and regenerating the listed array according to that name.
 *           - use validation to prevent duplicate project names from being created mistakenly
 *
 * FIXED - 6. Enable drop down to see toDo item descriptions
 *
 * FIXED - 7. Pressing close button on initial toDo item causes description to populate
 *              ISSUE: when pressing the closebutton it is also activating the toDoChild click for turning on/off the description leading to an error
 *
 * FIXED - 8. Continuing toDo elements do not clear the descInput of the description element after removing
 *            parent toDoChild node.
 *
 * FIXED - 9. Unable to append descSibling elements to mainList after regenToDo is run, so after swapping
 *              between projects.
 *
 * FIXED - 10. When creating three toDo items, the first one with a desc and the third one with a desc, and
 *               clicking the closeButton of the second item, this removes it's 'sibling' being the third
 *               toDoChild. This shouldn't happen.
 *
 * FIXED - 11. When clicking the closeButton of the 'initial toDo' it is also removing the next element,
 *               prevent this by manipulating your eventpropagation() commands. The if/else on the second one
 *               is improper.
 *
 * FIXED - 12. When clicking CloseButtonToDo on project 2 > item 1, descSibling element is not being removed
 *               for some reason.
 *
 * FIXED - 13. When clicking on CloseButtonToDo for project 2, not properly removing toDoChild.nextSibling
 *
 *
 *
 *
*/
// ******************************************************************************************************** //