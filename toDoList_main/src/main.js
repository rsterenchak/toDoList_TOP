import './style.css';
// Pipeline verification no-op (entry 1ab046ed) — non-functional marker comment.
// reload-on-update test — safe to remove (entry ddbe5425) — non-functional marker comment.
// Pipeline verification no-op (entry ccda7890) — non-functional marker comment.
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
    ensureFocusMode,
} from './focusMode.js';
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
import {
    createDrawerToggleRow,
    buildCompanionToggle as buildCompanionToggleRow,
} from './drawerRows.js';
import { mountClaudeSheet } from './claudeSheet.js';
import { syncClaudeSheetForProject, openChatWithTask } from './claudeSheet.js';
import { isClaudeUnavailable, showClaudeUnavailableTooltip } from './claudeSheet.js';
import { updateCompletedSection, updateEmptyState } from './emptyState.js';
import { applyProjectAccent } from './projectMenu.js';
import {
    attachProjectContextMenu,
    attachProjectDrag,
    attachProjectInjectIndicator,
    attachProjectRunSpinner,
    deleteProjectFlow,
} from './projectRow.js';
import { createProjectPicker } from './projectPicker.js';
import { createProjectByName, selectProjectRow } from './projectCreate.js';
import { createProjRunSpinner } from './projRunSpinner.js';
import { createViewSwitcher } from './viewSwitcher.js';
import { createTaskSort } from './taskSort.js';
import { createDesktopHeaderPlacement } from './desktopHeaderPlacement.js';
import { createFooterCounts } from './footerCounts.js';
import { createSettingsModal } from './settingsModal.js';
import { createSidebarDrawer } from './sidebarDrawer.js';
import { createMobileProjSwipeNav } from './mobileProjSwipeNav.js';
import { createSettingsMenu } from './settingsMenu.js';
import { createMobileUtilitySheet } from './mobileUtilitySheet.js';
import {
    addAllToDo_DOM,
    addToDos_restore,
    focusBlankToDoInput,
    focusBlankToDoInputIfDesktop,
    reorderToDoDOM,
    setDiscussTaskHandler,
} from './toDoRow.js';
import { resetMobileCreateSession } from './mobileTaskCreate.js';
import { createMobileUpdatePill } from './mobileUpdatePill.js';
import { wireStatusLabelDelegation, setReviewBadgeTapHandler } from './todoStatus.js';
import { buildTaskFilterBar, applyTaskFilter, firstFocusableInTaskFilterBar, taskFilterArrowTarget } from './taskFilter.js';
import { dropFocusIntoMainView } from './viewFocusNav.js';
import { updateAllProjectBadges, navigateToProjectByIndex } from './projectBadges.js';
import { prefersReducedMotion } from './dragDrop.js';
import { applyDueUrgency, updateDuePillLabel } from './dueDate.js';
import {
    renderAgentView,
    subscribeAgentView,
    unsubscribeAgentView,
    syncAgentAvailabilityForProject,
    startAgentWorkingWatch,
} from './agentView.js';
import {
    startAgentQueueSubscription,
    loadAllQueueRows,
    getWaitingQuestionCounts,
    onQueueChange,
} from './agentQueueStore.js';
import { renderStructureView, captureStructureSnapshot } from './structureView.js';
import { setLocateTabSwitch } from './structureCanvas.js';
import { attachDragDropImport } from './exportImport.js';
import { maybeStartFirstRunTour } from './coachmark.js';
import {
    initInjectConfig,
    initInjectTargets,
} from './inject.js';
import { placeViewerCard, setViewerCardTapHandler, setOverflowSheetController, openViewerAnchoredToEntry } from './todoMdViewer.js';
import { isMobileViewport } from './viewport.js';
import { openCompletedMobileSheet, openViewerMobileSheet, openOverflowMobileSheet, closeOverflowMobileSheet, isAnyMobileSheetOpen } from './mobileSheets.js';
import button from './addProj_button.svg';

// Hydrate the inject config cache from localStorage before any inject
// button gets rendered — buildToDoRow / showDescEditorModal both call
// isInjectConfigured() at render time, which reads the cached values.
initInjectConfig();

// Give the Structure canvas's "Locate" action a way back to Tasks View without
// making that leaf module import this heavy entry (which would form a cycle).
setLocateTabSwitch(function () { applyActiveView('projects'); });

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
    // #mobileProjHeader hidden by the [data-view="agent"]
    // rules even when the Projects tab is the active mobile tab.
    // applyActiveView() remains the canonical writer for subsequent flips.
    main2.dataset.view = 'projects';
    // Mirror the routing attribute onto <body> as well so any body-scoped
    // data-view hooks stay in lockstep with #mainBar. applyActiveView keeps
    // the two aligned on every flip.
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

    // ── focus-mode button (sits between music and the settings gear) ──
    // Desktop-only — hidden on mobile the same way the pomodoro/music/settings
    // toggles are. Clicking it enters focus mode: a calm, endlessly-drifting
    // space scene that hides the dashboard for distraction-free studying. The
    // scene + transition live in style.css; the controller (overlay DOM, the
    // music/pomodoro corner cluster, Esc/affordance exit) lives in
    // focusMode.js and is created lazily via the ensureFocusMode singleton.
    const focusModeToggle = document.createElement('button');
    focusModeToggle.id = 'focusModeToggle';
    focusModeToggle.type = 'button';
    focusModeToggle.setAttribute('aria-label', 'Enter focus mode');
    focusModeToggle.title = 'Focus mode';
    // Stroke-based "focus" glyph: a star/sparkle inside a soft frame, evoking
    // the calm starfield the mode opens into. currentColor ties it to the
    // button's themed color so it adapts across dark and light.
    focusModeToggle.innerHTML =
        '<svg class="focusModeIcon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z"/>' +
        '<circle cx="18" cy="17" r="1"/>' +
        '<circle cx="6.5" cy="16.5" r="0.8"/>' +
        '</svg>';

    function getFocusModeController() {
        return ensureFocusMode();
    }

    focusModeToggle.addEventListener('click', function(event) {
        event.stopPropagation();
        const ctl = getFocusModeController();
        if (ctl) ctl.activate();
    });

    const settingsToggle = document.createElement('button');
    settingsToggle.id = 'settingsToggle';
    settingsToggle.type = 'button';
    settingsToggle.setAttribute('aria-haspopup', 'menu');
    settingsToggle.setAttribute('aria-expanded', 'false');
    settingsToggle.setAttribute('aria-label', 'Open menu');
    settingsToggle.title = 'Menu';
    // Solid settings gear: a filled gear body in currentColor with a hollow
    // centre hub punched out via fill-rule="evenodd" (the inner circle subpath
    // overlaps the gear body, so the overlap renders empty). currentColor ties
    // the glyph to #settingsToggle's themed `color`, so it adapts to dark and
    // light without per-theme overrides.
    settingsToggle.innerHTML =
        '<svg class="gearIcon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
        '<path fill="currentColor" fill-rule="evenodd" d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14.1 2h-4a.49.49 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64L4.27 11.02c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.14.24.43.34.69.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.05.24.25.42.49.42h4c.24 0 .44-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.26.12.55.02.69-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>' +
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
    nav.appendChild(focusModeToggle);
    nav.appendChild(settingsToggle);

    // Header arrow-key navigation. ArrowLeft / ArrowRight walk focus
    // across the header controls (sidebarToggle → viewPillProjects
    // → pomodoroToggle → musicToggle → focusModeToggle → settingsToggle)
    // so keyboard users can flow across the chrome without tabbing. The
    // pill references resolve at handler execution time, by which point
    // component() has finished initialising them. Bails when any
    // popover/modal is open so the in-popover focus management owns the
    // keystrokes; bails on any modifier so OS-level chords pass through.
    // stopPropagation keeps the document-level cross-pane handler from
    // also re-routing focus to a project row or new-task input.
    nav.addEventListener('keydown', function(e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        const order = [sidebarToggle, viewPillProjects, pomodoroToggle, musicToggle, focusModeToggle, settingsToggle];
        const idx = order.indexOf(e.target);
        if (idx === -1) return;
        const nextIdx = e.key === 'ArrowRight' ? idx + 1 : idx - 1;
        let nextBtn = order[nextIdx];
        if (!nextBtn) return;
        // The view switcher is one internally-navigable group in this chain, not
        // a fixed tab stop: entering it from either neighbour lands on the pill
        // that currently owns the roving tabindex (the active view's pill), and
        // the switcher's own ArrowLeft/Right handler then cycles among the three
        // pills with wraparound. Fall back to the Projects pill if the roving
        // marker is somehow absent.
        if (nextBtn === viewPillProjects) {
            nextBtn = document.querySelector('#viewSwitcher .viewPill[tabindex="0"]') || viewPillProjects;
        }
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
    chatExpandBtn.addEventListener('click', function() {
        // On a project with no routed repo the pane is unavailable, not merely
        // collapsed: re-opening it is a no-op that explains why instead.
        if (isClaudeUnavailable()) {
            showClaudeUnavailableTooltip(chatExpandBtn);
            return;
        }
        applyChatPaneCollapsed(false);
    });
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
    // The bottom-anchored Pomodoro/music sheet (IDLE nub / PEEK strip /
    // EXPANDED controls + music picker) and the persistent mobile tab bar are
    // built in mobileUtilitySheet.js via the same closure-to-factory injection
    // pattern settingsMenu.js / projectPicker.js use. The factory appends
    // #bottomSheet and #mobileTabBar into `base` itself and installs
    // window.bottomSheetRefreshVisibility / window.mobileTabBarRefreshVisibility,
    // so the call site stays a pure wire-up.
    createMobileUtilitySheet({
        base,
        main1,
        mainList,
        applyActiveView,
        getPomodoroController,
        getMusicController,
    });

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
    // Variant C wrappers: a left column stacking label / name-row / counts,
    // and a vertically-stacked ‹ / › chevron column seated to its right. Both
    // dissolve on desktop (display:contents / display:none) so the compact
    // pill layout is unaffected.
    const mobileProjMain     = document.createElement('div');
    const mobileProjChevCol  = document.createElement('div');

    mobileProjHeader.id   = 'mobileProjHeader';
    mobileProjLabel.id    = 'mobileProjLabel';
    mobileProjTitleRow.id = 'mobileProjTitleRow';
    mobileProjPrev.id     = 'mobileProjPrev';
    mobileProjName.id     = 'mobileProjName';
    mobileProjNext.id     = 'mobileProjNext';
    mobileProjStats.id    = 'mobileProjStats';
    mobileProjCounts.id   = 'mobileProjCounts';
    mobileProjMain.id     = 'mobileProjMain';
    mobileProjChevCol.id  = 'mobileProjChevCol';

    mobileProjPrev.type = 'button';
    mobileProjNext.type = 'button';
    mobileProjPrev.className = 'mobileProjChev';
    mobileProjNext.className = 'mobileProjChev';
    mobileProjPrev.textContent = '‹'; // ‹
    mobileProjNext.textContent = '›'; // ›
    mobileProjPrev.setAttribute('aria-label', 'Previous project');
    mobileProjNext.setAttribute('aria-label', 'Next project');

    mobileProjStats.appendChild(mobileProjCounts);

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

    // Mobile-header title pill: wrap the project name + ▾ chevron in one
    // container so they center as a single unit and the subtle pill border can
    // contain them together. Previously the chevron was a loose sibling of the
    // name in the title row, so a two-line wrap detached it to the row corner;
    // grouping them locks the ▾ immediately beside the (now one-line) name.
    // The wrapper is transparent at desktop (display:contents) so the desktop
    // project pill layout is unchanged. The pill itself has no click handler —
    // taps on its padding bubble to the #mobileProjHeader handler, which the
    // name/chevron own-handler guard deliberately does not skip for it, so a
    // tap anywhere on the pill opens the picker exactly once.
    // Icon-first desktop pill affordance: a small rounded "open/total" badge
    // (e.g. "7/19") that sits inline between the project name and the ▾
    // chevron. It replaces the separate open/done counts row at desktop
    // widths; on mobile it is hidden (the counts render as their own line in
    // the left column) so the same #mobileProjCounts writer isn't duplicated.
    const mobileProjCountBadge = document.createElement('span');
    mobileProjCountBadge.id = 'mobileProjCountBadge';
    mobileProjCountBadge.className = 'mobileProjCountBadge';
    mobileProjCountBadge.setAttribute('aria-hidden', 'true');

    const mobileProjPill = document.createElement('div');
    mobileProjPill.id = 'mobileProjPill';
    mobileProjPill.appendChild(mobileProjName);
    mobileProjPill.appendChild(mobileProjCountBadge);
    mobileProjPill.appendChild(mobileProjChevron);

    // Cross-device run indicator: a small purple spinner that trails the
    // project name + ▾ caret on both breakpoints (the pill is the project
    // trigger on desktop dropdown and mobile drawer alike). It spins only while
    // the active project's routed repo has an in-flight run, surfaced via the
    // Worker's `active_runs` probe — so a run started on another device shows
    // here. Decorative (the pill already names the project), so aria-hidden,
    // and pointer-events:none so it never blocks the pill's click-to-open.
    const mobileProjRunSpinner = document.createElement('span');
    mobileProjRunSpinner.id = 'mobileProjRunSpinner';
    mobileProjRunSpinner.className = 'mobileProjRunSpinner';
    mobileProjRunSpinner.setAttribute('aria-hidden', 'true');

    mobileProjTitleRow.appendChild(mobileProjPill);
    mobileProjTitleRow.appendChild(mobileProjRunSpinner);
    // Variant C: the left column stacks label · name-row · counts; the ‹ ›
    // carousel chevrons move into a vertical column seated to its right. The
    // ‹ › buttons keep their own click handlers and disabled wiring — only
    // their DOM home changes — and the swipe gesture stays on the title row.
    mobileProjChevCol.appendChild(mobileProjPrev);
    mobileProjChevCol.appendChild(mobileProjNext);
    mobileProjMain.appendChild(mobileProjLabel);
    mobileProjMain.appendChild(mobileProjTitleRow);
    mobileProjMain.appendChild(mobileProjStats);
    mobileProjHeader.appendChild(mobileProjMain);
    mobileProjHeader.appendChild(mobileProjChevCol);

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

    // Footer/header count writer — behaviour-preserving extraction into
    // footerCounts.js. Instantiated here (ahead of the project picker below)
    // because updateFooterCounts is injected into that subsystem; the three DOM
    // refs it reads are already built above and updateMobileProjHeader is a
    // hoisted declaration defined later in this scope.
    const { updateFooterCounts } = createFooterCounts({
        sideMain,
        footOpen,
        footDone,
        updateMobileProjHeader,
    });

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
        // The desktop dropdown's header "+ new project" button reveals an
        // inline name input in the dropdown; committing it routes here with the
        // typed name. createProjectByName drives the EXACT same #projButton
        // create+select path the mobile + button uses, so naming and the
        // post-create active-selection behave identically across both surfaces
        // — the dropdown just supplies the name instead of the sidebar drawer.
        onCreateProjectNamed: createProjectByName,
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
        // The inline create input owns Escape first: cancel + clear it without
        // collapsing the whole dropdown. Only when no inline input is open does
        // Escape dismiss the dropdown itself.
        if (projectPicker.cancelInlineCreate()) return;
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

    // ── top-level view switcher (Projects / Agent) ──
    // Pill bar in the top nav (anchored immediately right of the
    // hamburger) toggles between the project view and the Agent
    // queue board. The active view is persisted in
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

    const viewPillProjects = document.createElement('button');
    viewPillProjects.id = 'viewPillProjects';
    viewPillProjects.type = 'button';
    viewPillProjects.className = 'viewPill';
    viewPillProjects.setAttribute('role', 'tab');
    viewPillProjects.setAttribute('aria-pressed', 'false');
    viewPillProjects.textContent = 'Task View';

    const viewPillAgent = document.createElement('button');
    viewPillAgent.id = 'viewPillAgent';
    viewPillAgent.type = 'button';
    viewPillAgent.className = 'viewPill';
    viewPillAgent.setAttribute('role', 'tab');
    viewPillAgent.setAttribute('aria-pressed', 'false');
    viewPillAgent.textContent = 'AGENT';
    // Same hollow "no-repo" marker as the mobile tab, shown only while
    // body.agentUnavailable is set. A real <span> (not a pseudo-element) because
    // the pill's ::after is already the active-underline bar.
    const viewPillAgentMarker = document.createElement('span');
    viewPillAgentMarker.className = 'agentNoRepoMarker';
    viewPillAgentMarker.setAttribute('aria-hidden', 'true');
    viewPillAgent.appendChild(viewPillAgentMarker);
    // Small filled "working" dot leading the AGENT label ("● AGENT"), shown only
    // while body.agentWorking is set. The persistent working watch keeps that
    // class live independent of the Agent view being mounted, so the dot pulses
    // even after switching to Tasks or Structure. Inserted before the label so
    // it reads as a leading indicator; CSS mirrors the agentNoRepoMarker pattern.
    const viewPillAgentWorkingDot = document.createElement('span');
    viewPillAgentWorkingDot.className = 'agentWorkingDot';
    viewPillAgentWorkingDot.setAttribute('aria-hidden', 'true');
    viewPillAgent.insertBefore(viewPillAgentWorkingDot, viewPillAgent.firstChild);

    const viewPillStructure = document.createElement('button');
    viewPillStructure.id = 'viewPillStructure';
    viewPillStructure.type = 'button';
    viewPillStructure.className = 'viewPill';
    viewPillStructure.setAttribute('role', 'tab');
    viewPillStructure.setAttribute('aria-pressed', 'false');
    viewPillStructure.textContent = 'STRUCTURE';
    // Same hollow "no-repo" marker as the AGENT pill, shown only while
    // body.agentUnavailable is set — a repo-less project can't be mapped.
    const viewPillStructureMarker = document.createElement('span');
    viewPillStructureMarker.className = 'agentNoRepoMarker';
    viewPillStructureMarker.setAttribute('aria-hidden', 'true');
    viewPillStructure.appendChild(viewPillStructureMarker);

    viewSwitcher.appendChild(viewPillProjects);
    viewSwitcher.appendChild(viewPillAgent);
    viewSwitcher.appendChild(viewPillStructure);

    viewPillProjects.addEventListener('click', function() {
        applyActiveView('projects');
    });
    viewPillAgent.addEventListener('click', function() {
        // The AGENT tab always opens now — on a project with no routed repo the
        // view renders an in-place "unavailable" message rather than a dead board,
        // so there's no reason to intercept the tap.
        applyActiveView('agent');
    });
    viewPillStructure.addEventListener('click', function() {
        applyActiveView('structure');
    });

    // ArrowDown drop-in from the view pills into the visible main pane lives in
    // viewFocusNav.js (dropFocusIntoMainView); it mirrors the sidebarToggle →
    // first project row transition for the content directly beneath the pills.
    viewPillProjects.addEventListener('keydown', dropFocusIntoMainView);
    viewPillAgent.addEventListener('keydown', dropFocusIntoMainView);

    // Roving-tabindex ArrowLeft/ArrowRight navigation across the three view
    // pills. The switcher is an ARIA tablist, so exactly one pill is in the Tab
    // order at a time (tabindex 0) while the others are tabindex -1; ArrowLeft /
    // ArrowRight move focus among them and hand the roving 0 to the newly-focused
    // pill. Movement wraps: ArrowRight on the last pill (STRUCTURE) lands on the
    // first (Task View) and ArrowLeft on the first lands on the last. The active
    // pill's tabindex is kept in sync by applyActiveView; the baseline below just
    // seeds the pre-restore state (PROJECTS is the default view).
    //
    // This takes priority over the header-wide nav ArrowLeft/Right walk: the
    // handler stopPropagation()s so neither the document-level cross-pane
    // handler (which would yank focus into the task pane in Projects view) nor
    // any ancestor listener also fires. Enter/Space activation is left to native
    // <button> behaviour, so the click handlers above keep switching views on
    // those keys. The nav walk still enters the switcher as one group via
    // viewSwitcherEntryPill(), so from the header chrome the switcher reads as a
    // single, internally-navigable stop rather than one fixed tab stop.
    const viewSwitcherPills = [viewPillProjects, viewPillAgent, viewPillStructure];
    viewPillProjects.setAttribute('tabindex', '0');
    viewPillAgent.setAttribute('tabindex', '-1');
    viewPillStructure.setAttribute('tabindex', '-1');
    const { viewSwitcherArrowNav } = createViewSwitcher({ viewSwitcherPills });
    viewPillProjects.addEventListener('keydown', viewSwitcherArrowNav);
    viewPillAgent.addEventListener('keydown', viewSwitcherArrowNav);
    viewPillStructure.addEventListener('keydown', viewSwitcherArrowNav);

    // ── Agent view shell ──
    // Empty container the agentView module owns at runtime — renderAgentView()
    // fills it with the project's agent-queue buckets (or an empty state). Toggled
    // via #mainBar's data-view attribute like the projects surface, so
    // neither view re-renders the other on switch.
    const agentView = document.createElement('div');
    agentView.id = 'agentView';

    // Empty container the structureView module owns at runtime —
    // renderStructureView() fills it with the selected project's repo label and
    // source tree.
    // Toggled via #mainBar's data-view attribute like the other surfaces, so
    // switching views never re-renders the others.
    const structureView = document.createElement('div');
    structureView.id = 'structureView';

    // The view tabs ride in the desktop sub-band beneath the top header, not
    // in #navBar. They are desktop-only (display:none on mobile, where
    // #mobileTabBar owns navigation), so a single permanent home in the
    // sub-band is correct at every breakpoint.
    desktopViewSubBand.appendChild(viewSwitcher);
    const taskFilterBar = buildTaskFilterBar();

    main2.appendChild(agentView);
    main2.appendChild(structureView);
    main2.appendChild(mobileProjHeader);
    // Status filter pills (ALL / Active / Ideas) sit above the list — below the
    // mobile project header, above the compose row inside #mainList. Built once
    // here and never cleared by the list's rebuild cycles; the render paths in
    // toDoRow.js call applyTaskFilter() after each rebuild to refresh counts and
    // row visibility.
    main2.appendChild(taskFilterBar);
    main2.appendChild(mainList);
    applyTaskFilter();

    // Arrow-key nav for the status/sort filter bar, making it a two-way stop
    // between #viewSwitcher and the todo list. A focused control inside the bar
    // (the desktop cycle pill, a mobile status segment, or the Sort trigger)
    // escapes up to the active view pill on ArrowUp and drops into the todo
    // list on ArrowDown — reusing the same list-only target the pill drop-in
    // and intra-list ArrowUp already agree on. Delegated on the bar so the Sort
    // trigger appended later is covered too. Gated to PROJECTS (the only view
    // where the bar is visible), and stopPropagation keeps the document-level
    // todo arrow handler from also firing and clobbering the focus we place.
    taskFilterBar.addEventListener('keydown', function (e) {
        const isUp = e.key === 'ArrowUp';
        const isDown = e.key === 'ArrowDown';
        if (!isUp && !isDown) return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        if (getActiveView() !== 'projects') return;
        const control = e.target && e.target.closest &&
            e.target.closest('.taskCyclePill, .taskFilterSeg, #taskSortBtn, #taskSortBtnMobile');
        if (!control) return;
        const target = isUp
            ? document.querySelector('#viewSwitcher .viewPill.active')
            : firstFocusableInActiveMainView();
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        target.focus();
    });

    // Left/Right roving focus between the status filter control and the Sort
    // trigger. Unlike the ArrowUp/Down stop above (scoped to #taskFilterBar),
    // the desktop Sort trigger (#taskSortBtn) lives in the sibling
    // #bulkDescActions overlay, so this listener sits on their shared parent
    // (main2) to reach a focused control on either side. Gated exactly like the
    // vertical handler — modifier-free, PROJECTS view only, no open
    // modal/popover — and only acts when a real filter/sort control is focused,
    // so Left/Right in the new-task input is left alone. Only the two horizontal
    // arrows are intercepted, so Enter/Space (activate) and the click-to-cycle /
    // click-to-open behaviours are untouched; preventDefault/stopPropagation
    // fire only on a real move so the document todo-arrow handler can't clobber
    // the focus we place. taskFilterArrowTarget clamps at both ends (no wrap).
    main2.addEventListener('keydown', function (e) {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        if (getActiveView() !== 'projects') return;
        const control = e.target && e.target.closest &&
            e.target.closest('.taskCyclePill, .taskFilterSeg, #taskSortBtn, #taskSortBtnMobile');
        if (!control) return;
        const target = taskFilterArrowTarget(control, e.key);
        if (!target) return;
        e.preventDefault();
        e.stopPropagation();
        target.focus();
    });

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

    // ── Mobile Sort trigger ──
    // The desktop Sort dropdown lives in #bulkDescActions, which is
    // display:none at the mobile breakpoint — leaving phones with no way to
    // change the task sort after the Expand-All→Sort refactor. This compact
    // trigger rides at the right end of the status-filter row (#taskFilterBar),
    // opposite the status filter tabs and separated from them by a vertical
    // divider, and is shown ONLY where #bulkDescActions is hidden (CSS-gated to
    // the mobile breakpoint), so exactly one Sort trigger is ever visible. On
    // mobile it opens a bottom SHEET (#taskSortSheet) rather than the desktop
    // dropdown, but drives the same getTaskSort/setTaskSort/applyTaskSortChoice/
    // syncTaskSortButton machinery, so desktop and mobile share one sort state.
    // Two-line on mobile: a "⇅ Sort" top line plus the current sort label
    // beneath it (green when a sort is active, dimmed "None" otherwise). The
    // desktop #taskSortBtn keeps its own inline label. An aria-label (kept
    // current by syncTaskSortButton) names the control + active sort.

    // Thin vertical divider between the three filter segments and the Sort
    // trigger. Mobile-only (CSS-gated). It sits at the far RIGHT of the filter
    // bar as its own chat-launcher-style chip (see the mount below), no longer
    // fused into the segmented surface.
    const mobileSortBtn = document.createElement('button');
    mobileSortBtn.type = 'button';
    mobileSortBtn.id = 'taskSortBtnMobile';
    mobileSortBtn.className = 'bulkDescBtn taskSortBtn taskSortBtnMobile';
    mobileSortBtn.setAttribute('aria-haspopup', 'dialog');
    mobileSortBtn.setAttribute('aria-expanded', 'false');
    // Icon-only trigger: a single ⇅ sort glyph (no "Sort" word, no current-sort
    // label line). The glyph carries its own font-size so it survives the
    // ≤420px .bulkDescBtn font-size:0 label collapse. When a sort other than
    // None is active the glyph itself tints accent purple (CSS-gated on the
    // button's data-sort) — the old corner dot read as a notification badge and
    // was retired in favour of tinting the icon.
    const mobileSortBtnGlyph = document.createElement('span');
    mobileSortBtnGlyph.className = 'taskSortBtnMobileGlyph';
    mobileSortBtnGlyph.textContent = '⇅';
    mobileSortBtnGlyph.setAttribute('aria-hidden', 'true');
    mobileSortBtn.appendChild(mobileSortBtnGlyph);

    // Mount the Sort trigger directly onto the filter bar (not into the
    // segmented control) so hiding the segmented control on the mobile
    // breakpoint doesn't also hide Sort — the mobile block pushes it to the
    // row's far edge with margin-left:auto. The trigger stays display:none on
    // desktop (the #bulkDescActions overlay owns Sort there), so exactly one
    // Sort trigger is ever visible.
    const mobileSortHost = taskFilterBar;
    mobileSortHost.appendChild(mobileSortBtn);

    function taskSortButtonText(key) {
        if (key === 'due') return 'Sort: Due';
        if (key === 'status') return 'Sort: Status';
        return 'Sort';
    }

    function rerenderActiveProjectRows() {
        const activeName = activeProjectName();
        if (!activeName) return;
        const mainListDiv = document.getElementById('mainList');
        if (!mainListDiv) return;
        while (mainListDiv.firstChild) mainListDiv.removeChild(mainListDiv.firstChild);
        addAllToDo_DOM(listLogic.listItems(activeName), activeName);
    }

    // Shared three-affordance dismiss wiring for CLAUDE.md's modal rule (close
    // on Escape, backdrop click, and an explicit close control) plus focus
    // restoration on close. Consolidates the previously hand-rolled copies for
    // the task-sort dropdown, the task-sort bottom sheet, and the settings modal
    // so the three-way-dismiss contract can't silently drift between them. Every
    // affordance is optional: backdrop-style sheets/modals pass closeBtn +
    // backdrop, while the anchored dropdown passes only onClose + restoreFocusTo
    // and keeps its own outside-click / resize / scroll dismissal alongside.
    // onClose runs the caller's teardown at most once; restoreFocusTo (an
    // element or a function returning one) is focused afterwards when it is
    // still focusable and in the document. Returns { close, removeKeydown }:
    // close() is the guarded close the wired affordances share (call it from an
    // extra affordance such as a menu item), and removeKeydown() detaches the
    // capture-phase Escape listener from a caller's own teardown path, for hide
    // functions (the dropdown/sheet) that are also reachable without close().
    function wireDismissable(options) {
        const onClose = options.onClose;
        const closeBtn = options.closeBtn;
        const backdrop = options.backdrop;
        const restoreFocusTo = options.restoreFocusTo;
        const preventDefaultOnEscape = options.preventDefaultOnEscape;
        let closed = false;

        function removeKeydown() {
            document.removeEventListener('keydown', onKeydown, true);
        }

        function close() {
            if (closed) return;
            closed = true;
            removeKeydown();
            onClose();
            if (restoreFocusTo) {
                const target = typeof restoreFocusTo === 'function'
                    ? restoreFocusTo()
                    : restoreFocusTo;
                if (target && typeof target.focus === 'function' && document.contains(target)) {
                    try { target.focus(); } catch (_) { /* focus is best-effort */ }
                }
            }
        }

        function onKeydown(event) {
            if (event.key === 'Escape') {
                if (preventDefaultOnEscape) event.preventDefault();
                event.stopPropagation();
                close();
            }
        }

        document.addEventListener('keydown', onKeydown, true);
        if (closeBtn) closeBtn.addEventListener('click', close);
        if (backdrop) {
            backdrop.addEventListener('click', function(event) {
                if (event.target === backdrop) close();
            });
        }

        return { close: close, removeKeydown: removeKeydown };
    }

    // Whichever Sort trigger is currently on-screen anchors the menu and is
    // exempted from the outside-click dismissal. offsetParent is null for a
    // display:none element, so this resolves to the desktop overlay button on
    // wide layouts and the filter-row button on mobile.
    function activeSortTrigger() {
        if (mobileSortBtn.offsetParent !== null) return mobileSortBtn;
        return taskSortBtn;
    }

    function onTaskSortOutsideClick(event) {
        const menu = document.getElementById('taskSortMenu');
        if (!menu) return;
        if (menu.contains(event.target) ||
            taskSortBtn.contains(event.target) ||
            mobileSortBtn.contains(event.target)) return;
        hideTaskSortMenu();
    }

    function applyTaskSortChoice(key) {
        setTaskSort(key);
        syncTaskSortButton();
        // Re-render so the new order lands, then re-apply the status filter so
        // its hide-class settles on the now-correctly-ordered rows.
        rerenderActiveProjectRows();
        applyTaskFilter();
    }

    function toggleTaskSortMenu(event) {
        event.stopPropagation();
        if (document.getElementById('taskSortMenu')) {
            hideTaskSortMenu();
        } else {
            showTaskSortMenu();
        }
    }

    function toggleTaskSortSheet(event) {
        event.stopPropagation();
        if (document.getElementById('taskSortSheetBackdrop')) {
            hideTaskSortSheet();
        } else {
            showTaskSortSheet();
        }
    }

    // The five sort-surface functions were extracted into taskSort.js (a
    // behaviour-preserving move). The factory closes over the DOM triggers, the
    // sort get/label helpers, TASK_SORT_OPTIONS, the shared dismiss wiring, and
    // the two callbacks that reach back into this cluster (applyTaskSortChoice,
    // onTaskSortOutsideClick — both defined above, hoisted). The returned
    // functions are destructured so every call site below reads unchanged.
    const taskSort = createTaskSort({
        getTaskSort,
        taskSortButtonText,
        taskSortBtnLabel,
        taskSortBtn,
        mobileSortBtn,
        TASK_SORT_OPTIONS,
        wireDismissable,
        activeSortTrigger,
        applyTaskSortChoice,
        onTaskSortOutsideClick,
    });
    const {
        syncTaskSortButton,
        hideTaskSortMenu,
        showTaskSortMenu,
        hideTaskSortSheet,
        showTaskSortSheet,
    } = taskSort;
    syncTaskSortButton();

    taskSortBtn.addEventListener('click', toggleTaskSortMenu);
    mobileSortBtn.addEventListener('click', toggleTaskSortSheet);

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
    const { placeDesktopHeader } = createDesktopHeaderPlacement({
        nav,
        main2,
        pomodoroToggle,
        mobileProjHeader,
        mobileProjStats,
        mobileProjMain,
        taskFilterBar,
    });
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
    // Expand all descriptions — mirrors the bulk desc toggle in the main
    // column header. Routing through the button's click keeps the
    // .expanded class + Expand/Collapse label flip in one place. The
    // drawer-row factories (createDrawerToggleRow / createDrawerInfoRow /
    // createDrawerActionRow) and the other three toggle builders now live
    // in drawerRows.js; this builder stays here because it closes over the
    // main-local isBulkDescExpanded / toggleBulkDescriptions helpers.
    function buildExpandAllToggle() {
        return createDrawerToggleRow(
            'Expand all descriptions',
            function() { return isBulkDescExpanded(); },
            function() { toggleBulkDescriptions(); }
        );
    }

    // Companion ghost — the builder lives in drawerRows.js; it needs the
    // main-local applyCompanionGhostPreference (which mirrors the enabled
    // flag onto the body class), so we supply it here while keeping the
    // zero-arg call site unchanged.
    function buildCompanionToggle() {
        return buildCompanionToggleRow(applyCompanionGhostPreference);
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

    // Lower-center mobile update-reload pill (see mobileUpdatePill.js). The
    // controller owns its own single-instance state; we hand it the three
    // collaborators it needs by injection.
    const { showMobileUpdatePill, removeMobileUpdatePill } = createMobileUpdatePill({
        isMobile,
        hasPendingUpdate,
        applyPendingUpdate,
    });

    // Surface on the update-available event, remove when the update is
    // applied from any surface, and check once at mount for the case where
    // the worker was already waiting before this wiring ran.
    document.addEventListener('appUpdateAvailable', showMobileUpdatePill);
    document.addEventListener('appUpdateApplied', removeMobileUpdatePill);
    showMobileUpdatePill();

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
    // mobile-only via CSS. Behaviour-preserving extraction into
    // settingsModal.js: the two main-local toggle builders, wireDismissable,
    // the #drawerSettingsBtn node, and the top-level view/import/seed helpers
    // are injected (defined in this scope, so importing them back would cycle);
    // everything else the modal uses is imported directly by the module.
    const { showSettingsModal } = createSettingsModal({
        buildExpandAllToggle,
        buildCompanionToggle,
        wireDismissable,
        drawerSettingsBtn,
        applyActiveView,
        rebuildAfterImport,
        seedSampleTodosIntoActiveProjectIfEmpty,
    });

    drawerSettingsBtn.addEventListener('click', function() {
        showSettingsModal();
    });

    // ── sidebar toggle logic ──
    function isMobile() { return window.innerWidth < 1024; }

    // The projects sidebar is an overlay drawer at every breakpoint. open /
    // close / state all key off the `sidebar-open` class on #sideBar plus the
    // #sidebarOverlay backdrop — the same mechanism the mobile drawer has
    // always used, now unified across desktop too (no more persistent rail /
    // full column). Behaviour-preserving extraction into sidebarDrawer.js: the
    // two DOM nodes and refreshDrawerSections are passed directly; the
    // spinner-poll helpers are created later in this scope, so they are passed
    // as thunks and resolved lazily at open/close time (as the originals were).
    const { openSidebar, closeSidebar } = createSidebarDrawer({
        main1,
        sidebarOverlay,
        refreshDrawerSections,
        startDrawerSpinnerPoll: () => startDrawerSpinnerPoll(),
        stopDrawerSpinnerPoll: () => stopDrawerSpinnerPoll(),
    });

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
        // Gated to the Projects view. The Inbox view does not need these
        // cross-pane shortcuts — the sidebar is the same projects column
        // either way, but the right side has no new-task input to receive
        // ArrowRight.
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
        // Gated to the Projects view. The Inbox view has its own
        // arrow-nav handler that walks its own surface; firing this one
        // on that view would yank focus to a stale .todo-active row in
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
                // Land on the status/sort filter bar first (it sits between the
                // list and the view switcher); only a second ArrowUp from there
                // reaches the active view pill. The filter bar is display:none
                // outside PROJECTS, so firstFocusableInTaskFilterBar returns
                // null and we fall straight back to the pill.
                const target = firstFocusableInTaskFilterBar() ||
                    document.querySelector('#viewSwitcher .viewPill.active');
                if (target) {
                    e.preventDefault();
                    e.stopPropagation();
                    target.focus();
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

                // A create or rename just rebuilt this row's committed name, so
                // re-derive its (and every row's) triage-question count from the
                // already-loaded all-projects cache. Explicit call — the paint is
                // deliberately not observer-driven (see updateAllProjectQuestionCounts).
                updateAllProjectQuestionCounts();


                // On Click - should bring back ability to use add projects button
                projButton.style.pointerEvents = "auto";

                // NOTE: projChild > titleInput


                // *** LISTENERS ***

                // when element is clicked change selection to that element
                projChild.addEventListener("click", function(event){

                    console.log("called project selection");

                    // Clicking a project normally means the user wants the
                    // project view active — switch back from TODAY if
                    // needed before resolving the selection. The one
                    // exception is AGENT: it's a second lens on the SAME
                    // selected project, so a click there keeps Agent
                    // active and just re-renders it for the newly selected
                    // project (handled below once the selection resolves).
                    const stayOnAgent = getActiveView() === 'agent';
                    // STRUCTURE, like AGENT, is a second lens on the SAME
                    // selected project — a click here keeps it active and just
                    // re-renders the tab against the newly selected project's
                    // repo (handled below once the selection resolves).
                    const stayOnStructure = getActiveView() === 'structure';
                    if (!stayOnAgent && !stayOnStructure) {
                        applyActiveView('projects');
                    }

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

                        // Auto-open the Claude sheet for repo-backed projects,
                        // auto-close it for projects with no repo configured.
                        syncClaudeSheetForProject(innerValue);
                        // Gate the AGENT tab off in lockstep — same repo test,
                        // one shared body flag as the Claude gate.
                        const agentAvailable = syncAgentAvailabilityForProject(innerValue);

                        // When Agent or Structure is the active view, the
                        // click didn't switch away from it — re-render it so it
                        // reflects the newly selected project (Agent's queue
                        // board; Structure's resolved repo + map). If the newly
                        // selected project has no repo while AGENT is active, the
                        // board is now dead — fall back to PROJECTS rather than
                        // leave it on screen.
                        if (stayOnAgent) {
                            if (!agentAvailable) {
                                applyActiveView('projects');
                            } else {
                                renderAgentView();
                            }
                        } else if (stayOnStructure) {
                            renderStructureView();
                        }

                        return;
                    }

                    // already selected — unlock the input for editing
                    titleInput.style.pointerEvents = "auto";
                    titleInput.style.cursor = "text";
                    titleInput.focus();

                });


                // *** FUNCTIONS ***

                // changes an elements selection — thin wrapper over the
                // selectProjectRow helper extracted to projectCreate.js; the
                // three DOM-node closures from this row-build scope are passed
                // as params so the call sites below stay unchanged.
                function selectProject(){
                    selectProjectRow(projOnChild, projChild, titleInput);
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
        attachProjectRunSpinner(projChild, titleInput);

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
    // Swipe gesture state shared between the touchstart/move/cancel handlers
    // below and the extracted endSwipe (mobileProjSwipeNav.js); held in one
    // object so endSwipe's active/horizontal resets stay visible to the inline
    // handlers.
    const swipeState = { startX: 0, startY: 0, active: false, horizontal: false };
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
        swipeState.startX = t.clientX;
        swipeState.startY = t.clientY;
        swipeState.active = true;
        swipeState.horizontal = false;
        mobileProjTitleRow.style.transition = '';
    }, { passive: true });

    mobileProjTitleRow.addEventListener('touchmove', function(event) {
        if (!swipeState.active || event.touches.length !== 1) return;
        const t = event.touches[0];
        const dx = t.clientX - swipeState.startX;
        const dy = t.clientY - swipeState.startY;
        if (!swipeState.horizontal) {
            if (Math.abs(dx) < SWIPE_INTENT_PX && Math.abs(dy) < SWIPE_INTENT_PX) return;
            if (Math.abs(dy) > Math.abs(dx)) {
                swipeState.active = false;
                return;
            }
            swipeState.horizontal = true;
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

    // endSwipe (the touchend arm) extracted to mobileProjSwipeNav.js; the
    // shared swipeState, commit threshold, and two main-local helpers are
    // passed in so the touchend call site below stays unchanged.
    const { endSwipe } = createMobileProjSwipeNav({
        swipeState,
        SWIPE_COMMIT_PX,
        clearSwipeTransform,
        activeProjectIndex,
    });

    mobileProjTitleRow.addEventListener('touchend', endSwipe);
    mobileProjTitleRow.addEventListener('touchcancel', function() {
        if (swipeState.active) {
            swipeState.active = false;
            swipeState.horizontal = false;
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
            // Counts for both surfaces: mobile left-column line + desktop badge.
            mobileProjCounts.textContent = open + ' open · ' + done + ' done';
            mobileProjCountBadge.textContent = open + '/' + (open + done);
            mobileProjHeader.removeAttribute('data-empty');
            // Per-project accent flows into the title via --proj-accent on
            // the header; mobileProjName resolves it through CSS
            // var(--proj-accent, var(--accent)).
            applyProjectAccent(mobileProjHeader, listLogic.getProjectColor(activeName));
        } else {
            mobileProjLabel.textContent = '';
            mobileProjName.textContent  = '';
            mobileProjCounts.textContent = '';
            mobileProjCountBadge.textContent = '';
            mobileProjHeader.setAttribute('data-empty', 'true');
            applyProjectAccent(mobileProjHeader, null);
        }

        const atStart = activeIdx <= 0;
        const atEnd   = activeIdx < 0 || activeIdx >= total - 1;
        mobileProjPrev.disabled = atStart;
        mobileProjNext.disabled = atEnd;
        mobileProjPrev.setAttribute('aria-disabled', atStart ? 'true' : 'false');
        mobileProjNext.setAttribute('aria-disabled', atEnd ? 'true' : 'false');

        // On a genuine active-project change, re-resolve the repo and re-probe
        // the cross-device run signal. updateMobileProjHeader is the single
        // header writer driven by the footer MutationObserver, so this rides
        // that existing path rather than adding a second observer; the
        // last-project guard keeps it from re-polling on every unrelated
        // mutation (todo add/complete) that also bumps the counts.
        if (activeName !== projRunSpinnerLastProject) {
            projRunSpinnerLastProject = activeName;
            // Recompute the AGENT tab's no-repo gate here too, so it stays live
            // on non-click active-project changes (cold boot, create/rename,
            // delete-reselect, re-hydrate) that don't route through a click.
            syncAgentAvailabilityForProject(activeName);
            // Clear any stale spin immediately — the new project may have no
            // routed repo or no in-flight run — then re-poll for the truth.
            mobileProjRunSpinner.classList.remove('mobileProjRunSpinner--active');
            refreshProjRunSpinner();
        }
    }

    // ── Cross-device run spinners ──
    // The active-project trigger spinner and the per-project drawer-row spinners
    // both live in projRunSpinner.js; the factory closes over the three DOM refs
    // it paints (mobileProjName, mobileProjRunSpinner, sideMain) and keeps its
    // own request-token / interval state. Only the entry points the rest of
    // main.js wires up are destructured back out here.
    let projRunSpinnerLastProject = null;
    const PROJ_RUN_SPINNER_INTERVAL_MS = 10000;

    const {
        refreshProjRunSpinner,
        startDrawerSpinnerPoll,
        stopDrawerSpinnerPoll,
    } = createProjRunSpinner({ mobileProjName, mobileProjRunSpinner, sideMain });

    // Light background cadence (~10s), and only while the tab is visible so it
    // never polls in the background; a fresh poll also fires the moment the tab
    // becomes visible again. Plus one poll on load.
    setInterval(function () {
        if (document.visibilityState === 'visible') refreshProjRunSpinner();
    }, PROJ_RUN_SPINNER_INTERVAL_MS);
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') refreshProjRunSpinner();
    });
    setTimeout(refreshProjRunSpinner, 0);

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

    // Prime the all-projects agent-queue cache and paint the switcher's
    // per-project "triage question waiting" counts, then keep them live. The
    // store's realtime channel (idempotent to open here) refreshes the cache on
    // every `agent_queue` push, and onQueueChange repaints from that fresh cache
    // without a project switch or re-render. Row-set changes (create / rename /
    // restore) repaint via explicit updateAllProjectQuestionCounts() calls on
    // those paths — NOT via a sidebar MutationObserver, whose childList signal
    // the paint's own span insertion would re-trigger into a hang.
    startAgentQueueSubscription();
    loadAllQueueRows().then(updateAllProjectQuestionCounts);
    onQueueChange(updateAllProjectQuestionCounts);

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

    // Start the persistent, mount-independent agent-working watch once the shell
    // is up. It toggles body.agentWorking (driving the nav "● Agent" dot) from a
    // slim always-on watch and is guarded against double-init internally, so a
    // second component() call (or a re-evaluated bundle) won't stack a second
    // channel/poller. Deferred a tick so document.body exists, matching the
    // ensureCompanion / applyCompanionGhostPreference calls above.
    setTimeout(startAgentWorkingWatch, 0);

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


export { component, restoreFromStorage, notifyUpdateAvailable, updateAllProjectQuestionCounts };


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
        // Preserve the user's current project across this in-session
        // re-render. restoreFromStorage's tail otherwise auto-selects the
        // first project — the right cold-boot default but wrong here, where
        // the periodic Supabase re-hydrate would snap the view away from the
        // project being worked in every few minutes. Capture the selection
        // by name (mirroring how restoreFromStorage addresses projects)
        // before the sidebar is cleared.
        let activeProject = '';
        const selectedRow = document.querySelector('#projChild.selectedProject');
        if (selectedRow) {
            const projInput = selectedRow.querySelector('#projInput');
            activeProject = projInput ? (projInput.value || '').trim() : '';
        }
        if (sideMaDiv) {
            while (sideMaDiv.firstChild) sideMaDiv.removeChild(sideMaDiv.firstChild);
        }
        if (mainListDiv) {
            while (mainListDiv.firstChild) mainListDiv.removeChild(mainListDiv.firstChild);
        }
        try {
            restoreFromStorage({ fromSync: true, selectProject: activeProject || undefined });
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

// Wire the tasks-surface `⌁ REVIEW` badge to open the project's TODO.md viewer
// anchored to the shipped entry (instead of stamping the acknowledgement from
// the row). todoStatus.js owns the badge but must not import todoMdViewer.js /
// main.js (module-cycle + inject.js isolation), so it invokes this registered
// handler with the entry's marker id + project name. On touch the inline card is
// cramped, so open the mobile bottom sheet first (moving the card into it), then
// anchor; on desktop openViewerAnchoredToEntry expands the inline card and
// scrolls. The anchor no-ops gracefully when the marker isn't in the body, so
// the viewer still opens.
setReviewBadgeTapHandler(function(entryId, projectName) {
    if (isMobileViewport()) {
        const card = document.querySelector('#mainList #todoMdViewerCard');
        if (card && !isAnyMobileSheetOpen()) openViewerMobileSheet(card);
    }
    openViewerAnchoredToEntry(entryId);
});

// Wire the todo row's "Discuss" action to open the Claude sheet scoped to the
// task. toDoRow.js owns the button but must not import claudeSheet.js (that
// would close the toDoRow → claudeSheet → modals → toDoRow cycle), so it invokes
// this registered handler with the todo id.
setDiscussTaskHandler(function(todoId) {
    openChatWithTask(todoId);
});

// Wire the viewer's "⋯" overflow button to open a mobile bottom-sheet menu
// instead of the anchored dropdown on touch. The viewer (todoMdViewer.js)
// owns the menu element + its item handlers and decides mobile-vs-desktop;
// it DOM-moves the menu into / out of the sheet, so the controller is just
// the sheet open/close pair — registered here to avoid a circular import.
setOverflowSheetController({
    open: openOverflowMobileSheet,
    close: closeOverflowMobileSheet,
});


// ── Per-project "triage question waiting" count in the switcher ──
// Walk every committed sidebar project row and stamp an amber count of the
// project's `agent_queue` rows parked in `needs_words` (the ASKING triage
// state), so a question waiting in a project that's off-screen still reaches the
// user without switching to it. A project with none shows nothing (the
// `.hasQuestionCount` class both reveals the badge and reserves its grid column,
// so a zero-count row keeps its normal layout). The count is separate from the
// purple `.projBadge` incomplete-todo count and, unlike it, is live off
// `agent_queue` realtime pushes rather than todo mutations.
//
// This paint is driven EXPLICITLY from the paths that (re)build project rows —
// the create/rename commit, the initial/rehydrate/import restore, and every
// realtime `agent_queue` push (via onQueueChange). It is NEVER wired to a
// `childList`/`subtree` MutationObserver on the sidebar: the paint mutates that
// subtree (it inserts the badge span and toggles a class), so such an observer
// would re-trigger the paint on its own writes and hang the tab — exactly the
// regression that reverted the first attempt.
//
// Two independent defences make a stray re-entry a bounded no-op rather than a
// hang:
//   1. A module-level in-flight guard: a recursive call returns immediately.
//   2. Idempotency: a paint whose counts already match the DOM performs ZERO
//      writes (no textContent set, no class toggle), so it can't feed a mutation
//      signal back to any caller.
//
// HARD REQUIREMENT: the count must never be able to break the switcher's render.
// All counts are resolved into a plain name→count map ONCE, before the row loop,
// inside a try/catch that falls back to an empty map; the loop then only reads
// that map with a default of zero and never calls into the store or listLogic.
// The count needs no todo data — it derives entirely from `agent_queue` rows and
// their `project_id` (see getWaitingQuestionCounts).
let _questionCountPaintInFlight = false;
function updateAllProjectQuestionCounts() {
    // Re-entrancy guard — cheap insurance against a future caller triggering this
    // recursively. Set on entry, cleared in `finally`, so a second call while one
    // is running returns immediately instead of hanging the tab.
    if (_questionCountPaintInFlight) return;
    _questionCountPaintInFlight = true;
    try {
        const sideMain = document.getElementById('sideMa');
        if (!sideMain) return;
        let counts;
        try {
            counts = getWaitingQuestionCounts() || {};
        } catch (e) {
            counts = {};
        }
        const rows = sideMain.querySelectorAll('#projChild');
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            const input = row.querySelector('#projInput');
            const name = input ? input.value.trim() : '';
            const count = name ? (counts[name] || 0) : 0;
            let badge = row.querySelector('.projQuestionCount');
            if (count > 0) {
                const text = String(count);
                if (!badge) {
                    badge = document.createElement('span');
                    badge.className = 'projQuestionCount';
                    // Sit just before the trailing incomplete-count pill.
                    const projBadge = row.querySelector('.projBadge');
                    if (projBadge) row.insertBefore(badge, projBadge);
                    else row.appendChild(badge);
                }
                // Idempotent writes — skip each DOM mutation whose result already
                // matches, so a paint that changes nothing performs zero writes.
                if (badge.textContent !== text) badge.textContent = text;
                const label = count + ' triage '
                    + (count === 1 ? 'question' : 'questions') + ' waiting on you';
                if (badge.getAttribute('aria-label') !== label) {
                    badge.setAttribute('aria-label', label);
                }
                if (badge.title !== 'Triage questions waiting on you') {
                    badge.title = 'Triage questions waiting on you';
                }
                if (!row.classList.contains('hasQuestionCount')) {
                    row.classList.add('hasQuestionCount');
                }
            } else {
                if (badge && badge.textContent !== '') badge.textContent = '';
                if (row.classList.contains('hasQuestionCount')) {
                    row.classList.remove('hasQuestionCount');
                }
            }
        }
    } finally {
        _questionCountPaintInFlight = false;
    }
}

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

                // Auto-open the Claude sheet for repo-backed projects,
                // auto-close it for projects with no repo configured.
                syncClaudeSheetForProject(name);
                // Gate the AGENT tab off in lockstep (this handler already
                // switched to PROJECTS above, so no dead-board fallback needed).
                syncAgentAvailabilityForProject(name);

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
        attachProjectRunSpinner(projChild, titleInput);

    });

    // auto-select the FIRST project (top of the sidebar's display order,
    // honouring drag-and-drop reorder — listProjectsArray returns projects
    // in that order) and render its todos. An in-session re-render (the
    // Supabase re-hydrate) may pass opts.selectProject to preserve the
    // active project; honour it when that project still exists after the
    // reconcile, otherwise fall back to the cold-boot first-project default.
    const honorSelect     = !!(opts && opts.selectProject &&
        savedProjects.indexOf(opts.selectProject) !== -1);
    const targetProject   = honorSelect
        ? opts.selectProject
        : savedProjects[0];
    const allProjChildren = document.querySelectorAll('#projChild');

    let targetChild = null;
    if (honorSelect) {
        // Locate the preserved project's row by its #projInput value rather
        // than by DOM index, since it may not be the last child.
        for (let i = 0; i < allProjChildren.length; i++) {
            const projInput = allProjChildren[i].querySelector('#projInput');
            if (projInput && (projInput.value || '').trim() === targetProject) {
                targetChild = allProjChildren[i];
                break;
            }
        }
    }
    if (!targetChild) {
        targetChild = allProjChildren[0];
    }

    if (targetChild) {
        // deselect whatever is currently selected before marking the new
        // row, mirroring the two click-driven select paths — otherwise a
        // programmatic/restore select while another row is already selected
        // leaves two rows carrying .selectedProject at once, and the
        // first-match reader (getSelectedProjectName / resolveProjectRepo)
        // picks the wrong repo. Guard against deselecting targetChild itself
        // so a same-project re-select doesn't toggle it off.
        const current = document.querySelector('.selectedProject');
        if (current && current !== targetChild) {
            const prevInput = current.querySelector('#projInput');
            if (prevInput) {
                prevInput.style.pointerEvents = "none";
                prevInput.style.cursor = "default";
                prevInput.blur();
            }
            current.classList.remove("selectedProject");
            current.classList.add("unselectedProject");
        }
        targetChild.classList.remove("unselectedProject");
        targetChild.classList.add("selectedProject");
    }
    applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(targetProject));

    const lastItems       = listLogic.listItems(targetProject);
    const lastHasReal     = lastItems && lastItems.some(function(i){ return i.tit !== ""; });
    if (lastHasReal) {
        addToDos_restore(lastItems, targetProject, opts);
    } else if (lastItems) {
        addAllToDo_DOM(lastItems, targetProject);
    }
    focusBlankToDoInputIfDesktop();

    // Honour the persisted top-level view (Projects or Agent); a
    // legacy stored 'inbox'/'today'/'conceive' value falls back to Projects.
    applyActiveView(getActiveView());

    // This restore rebuilt the entire sidebar (initial boot, re-hydrate, or
    // post-import), so repaint the per-project triage-question counts against
    // whatever all-projects cache is currently loaded. Explicit call — the paint
    // is deliberately not observer-driven (see updateAllProjectQuestionCounts).
    updateAllProjectQuestionCounts();

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
export function firstFocusableInActiveMainView() {
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

// Apply the top-level Projects / Agent view. Module-scope so both the
// in-component pill click handlers and the restoreFromStorage auto-init
// path can route through one entry point. Writes the chosen view to
// localStorage, flips #mainBar's data-view attribute (the CSS show/hide
// hook for the two surfaces), and syncs the pill .active state. Safe to
// call before component() has run; missing nodes short-circuit silently so
// the boot order stays flexible.
function applyActiveView(view) {
    // Leaving Tasks View: snapshot the live layout for the Structure block canvas
    // while the app's regions are still on screen (another view hides them).
    if (getActiveView() === 'projects' && (view === 'agent' || view === 'structure')) {
        captureStructureSnapshot();
    }

    let safe = 'projects';
    if (view === 'agent') safe = 'agent';
    else if (view === 'structure') safe = 'structure';
    setActiveView(safe);

    const mainBar = document.getElementById('mainBar');
    if (mainBar) mainBar.setAttribute('data-view', safe);
    // Mirror onto <body> so the desktop header's relocated pill + counts can
    // be hidden per view — at desktop widths they live in the top header, no
    // longer under the task-pane grid, so the pane-scoped rules can't reach
    // them.
    document.body.setAttribute('data-view', safe);

    const pillProjects = document.getElementById('viewPillProjects');
    if (pillProjects) {
        pillProjects.classList.toggle('active', safe === 'projects');
        pillProjects.setAttribute('aria-pressed', safe === 'projects' ? 'true' : 'false');
        pillProjects.setAttribute('tabindex', safe === 'projects' ? '0' : '-1');
    }
    const pillAgent = document.getElementById('viewPillAgent');
    if (pillAgent) {
        pillAgent.classList.toggle('active', safe === 'agent');
        pillAgent.setAttribute('aria-pressed', safe === 'agent' ? 'true' : 'false');
        pillAgent.setAttribute('tabindex', safe === 'agent' ? '0' : '-1');
    }
    const pillStructure = document.getElementById('viewPillStructure');
    if (pillStructure) {
        pillStructure.classList.toggle('active', safe === 'structure');
        pillStructure.setAttribute('aria-pressed', safe === 'structure' ? 'true' : 'false');
        pillStructure.setAttribute('tabindex', safe === 'structure' ? '0' : '-1');
    }

    // Mirror the active state on the mobile bottom tab bar so the same
    // applyActiveView call keeps both navigators in sync — desktop pills
    // and mobile tabs cannot drift.
    const tabProjects = document.getElementById('mobileTabProjects');
    const tabAgent = document.getElementById('mobileTabAgent');
    const tabStructure = document.getElementById('mobileTabStructure');
    if (tabProjects) {
        tabProjects.classList.toggle('active', safe === 'projects');
        tabProjects.setAttribute('aria-pressed', safe === 'projects' ? 'true' : 'false');
    }
    if (tabAgent) {
        tabAgent.classList.toggle('active', safe === 'agent');
        tabAgent.setAttribute('aria-pressed', safe === 'agent' ? 'true' : 'false');
    }
    if (tabStructure) {
        tabStructure.classList.toggle('active', safe === 'structure');
        tabStructure.setAttribute('aria-pressed', safe === 'structure' ? 'true' : 'false');
    }

    if (safe === 'agent') {
        // The sidebar selection persists across the switch but is hidden
        // while AGENT owns the main panel, so the lingering
        // .selectedProject has no visual effect. Opening the view paints the
        // cached rows and opens the realtime subscription (which refreshes).
        renderAgentView();
        subscribeAgentView();
    } else {
        // Leaving the Agent view (to Projects or Structure) tears down its
        // realtime channel so a backgrounded board holds no open socket.
        unsubscribeAgentView();
    }
    if (safe === 'structure') {
        // The Structure view maps the selected project's linked repo, so it
        // renders fresh on each switch (resolving the repo from the selection).
        renderStructureView();
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