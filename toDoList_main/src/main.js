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
    formatMMSS,
    parseMMSS,
    nextSuggestedMode,
    MODE_LABEL,
} from './pomodoro.js';
import {
    ensureMusic,
    parseYouTubeUrl,
    createPomodoroSubscriber,
    CURATED_STATIONS,
    youTubeUrlForStation,
    getStationById,
} from './music.js';
import {
    readSidebarWidthPref,
    writeSidebarWidthPref,
    hasSidebarWidthPref,
    isSidebarRailOn,
    setSidebarRailOn,
    isCompletedSectionOpen,
    setCompletedSectionOpen,
    getActiveView,
    setActiveView,
    isOnboardingComplete,
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
    createHelpFab,
    isAnyModalOrPopoverOpen,
} from './modals.js';
import { updateEmptyState } from './emptyState.js';
import { applyProjectAccent } from './projectMenu.js';
import {
    attachProjectContextMenu,
    attachProjectDrag,
    deleteProjectFlow,
} from './projectRow.js';
import {
    addAllToDo_DOM,
    addToDos_restore,
    focusBlankToDoInput,
    focusBlankToDoInputIfDesktop,
} from './toDoRow.js';
import { resetMobileCreateSession } from './mobileTaskCreate.js';
import { applyDueUrgency, updateDuePillLabel } from './dueDate.js';
import {
    exportTodosToFile,
    importFromFile,
    createStaleExportHint,
    refreshStaleHint,
    attachDragDropImport,
    formatRelativeExportedAt,
    refreshFooterExportLabel,
} from './exportImport.js';
import { readLastExportedAt } from './prefs.js';
import { maybeStartFirstRunTour, startCoachmarkTour } from './coachmark.js';
import { startWelcomeCarousel, isMobileCarouselViewport } from './welcomeCarousel.js';
import button from './addProj_button.svg';


// Apply the saved theme during import, before component() — sets data-theme
// on <html> before any rendering happens. See theme.js for the persistence
// key, the matchMedia fallback, and the toggle button factory.
applyTheme(resolveInitialTheme());


// Sidebar rail vs. full mode. Rail (default) is a 54px column of first-letter
// chips; full expands to the named project list. Driven by `data-sidebar-rail`
// on <html> so CSS can switch surfaces before the first paint, and toggled at
// runtime by the hamburger inside the rail (see component()).
function applySidebarRail(on) {
    document.documentElement.setAttribute('data-sidebar-rail', on ? 'on' : 'off');
}

applySidebarRail(isSidebarRailOn());


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
    const sidebarResizer = document.createElement('div');

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
    // #mobileProjHeader hidden by the [data-view="today"] / "calendar"
    // rules even when the Projects tab is the active mobile tab.
    // applyActiveView() remains the canonical writer for subsequent flips.
    main2.dataset.view = 'projects';

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

    sidebarToggle.id        = 'sidebarToggle';
    sidebarToggle.type      = 'button';
    sidebarToggle.innerHTML = '☰';
    sidebarToggle.setAttribute('aria-label', 'Toggle projects sidebar');

    sidebarOverlay.id = 'sidebarOverlay';

    sidebarResizer.id = 'sidebarResizer';
    sidebarResizer.setAttribute('role', 'separator');
    sidebarResizer.setAttribute('aria-orientation', 'vertical');
    sidebarResizer.setAttribute('aria-label', 'Resize projects sidebar');

    // sidebarToggle lives in the nav so the global controls (hamburger left,
    // ghost right) share one horizontal band. The breadcrumb row below then
    // reads as a clean second row of project-scoped chrome. On mobile
    // viewports the rail is replaced with the existing overlay drawer, so
    // the nav-anchored toggle still slides the full sidebar in/out.

    // ── ghost menu trigger (far right of nav) ──
    // Single 36px ghost icon button replaces the previous save/import/kebab
    // cluster. Clicking it opens a dropdown with Export JSON, Import JSON,
    // (divider), Theme, and Toggle floating ghost. The trigger itself stays
    // anchored to the top-right; the floating-ghost companion (toggled from
    // inside the menu) is the one that drifts around the viewport. A subtle
    // hover-pulse animation on the trigger hints first-time users that it's
    // clickable — see #settingsToggle keyframes in style.css.
    //
    // The dropdown closes on selection, outside click, or Escape. Drag-and-
    // drop import remains wired via attachDragDropImport; the menu's Import
    // JSON item proxies to a hidden file input that runs the same
    // importFromFile flow the old icon button used.
    const importFileInput = document.createElement('input');
    importFileInput.type = 'file';
    importFileInput.accept = '.json,application/json';
    importFileInput.id = 'importTodosInput';
    importFileInput.style.display = 'none';
    importFileInput.addEventListener('change', function() {
        const file = importFileInput.files && importFileInput.files[0];
        if (!file) return;
        importFromFile(file, function() { rebuildAfterImport(); });
        // Reset so re-selecting the same file fires change again.
        importFileInput.value = '';
    });

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
        '</svg>';

    function getPomodoroController() {
        return ensurePomodoro();
    }

    function syncPomodoroIcon() {
        const ctl = getPomodoroController();
        if (!ctl) return;
        const snap = ctl.getState();
        pomodoroToggle.setAttribute('data-pomo-status', snap.status);
        pomodoroToggle.setAttribute('data-pomo-mode',   snap.mode);
        const totalMs = (snap.durations[snap.mode] || 0) * 1000;
        let progress = 0;
        if (snap.status === 'RUNNING' && totalMs > 0) {
            progress = 1 - (snap.remainingMs / totalMs);
        } else if (snap.status === 'PAUSED' && totalMs > 0) {
            progress = 1 - (snap.remainingMs / totalMs);
        } else if (snap.status === 'COMPLETE_UNACKED') {
            progress = 1;
        }
        progress = Math.max(0, Math.min(1, progress));
        const hand = pomodoroToggle.querySelector('.clockIconHand');
        if (hand) hand.setAttribute('transform', 'rotate(' + (progress * 360).toFixed(2) + ' 12 14)');
    }

    function hidePomodoroPopover() {
        const existing = document.getElementById('pomodoroPopover');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        pomodoroToggle.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onPomodoroOutsideClick, true);
        document.removeEventListener('keydown', onPomodoroKeydown, true);
        window.removeEventListener('resize', hidePomodoroPopover);
        window.removeEventListener('scroll', hidePomodoroPopover, true);
    }

    function onPomodoroOutsideClick(event) {
        const pop = document.getElementById('pomodoroPopover');
        if (!pop) return;
        if (pop.contains(event.target) || pomodoroToggle.contains(event.target)) return;
        hidePomodoroPopover();
    }

    // True when focus sits in a text-entry surface where Backspace must keep
    // its native delete-character meaning. Used by the popover Backspace-to-
    // close handlers below to avoid hijacking the user's typing in inline
    // edit fields (countdown, paste-URL form, etc.).
    function isFocusInTextInput() {
        const ae = document.activeElement;
        if (!ae) return false;
        if (ae.tagName === 'TEXTAREA' || ae.isContentEditable) return true;
        if (ae.tagName !== 'INPUT') return false;
        const t = (ae.type || '').toLowerCase();
        return t === 'text' || t === 'url' || t === 'search' || t === 'tel' ||
               t === 'email' || t === 'password' || t === 'number';
    }

    // Shared arrow-key navigation for the pomodoro and music popovers. Walks
    // visible focusable controls inside `popover` with wrap-around. Returns
    // true when the keystroke was consumed so the caller can skip its own
    // handling. Defers to native semantics when focus is on a control whose
    // own arrow keys matter (range slider for ±value, text/textarea/CE for
    // caret movement). The settings menu uses its own [role="menuitem"]-only
    // walk in onSettingsKeydown — this helper covers the looser dialog-style
    // popovers where any visible button/input can be a stop.
    function popoverArrowNav(popover, event) {
        const isUp   = event.key === 'ArrowUp';
        const isDown = event.key === 'ArrowDown';
        const isHome = event.key === 'Home';
        const isEnd  = event.key === 'End';
        if (!isUp && !isDown && !isHome && !isEnd) return false;

        const ae = document.activeElement;
        if (ae) {
            const tag = ae.tagName;
            if (tag === 'TEXTAREA' || ae.isContentEditable) return false;
            if (tag === 'INPUT') {
                const t = (ae.type || '').toLowerCase();
                // Range step ↑↓; text-like inputs use ↑↓ for caret/history.
                if (t === 'range' || t === 'text' || t === 'url' || t === 'search' ||
                    t === 'tel' || t === 'email' || t === 'password' || t === 'number') {
                    return false;
                }
            }
        }

        const sel = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
        const items = Array.from(popover.querySelectorAll(sel)).filter(function(el) {
            // getClientRects is empty for display:none (and any display:none
            // ancestor), filtering out the hidden countdown-edit input and
            // the collapsed paste-URL form without a brittle style check.
            return el.getClientRects().length > 0 && el.tabIndex !== -1;
        });
        if (!items.length) return false;

        event.preventDefault();
        event.stopPropagation();

        const currentIdx = items.indexOf(ae);
        let nextIdx;
        if (isHome) nextIdx = 0;
        else if (isEnd) nextIdx = items.length - 1;
        else if (currentIdx === -1) nextIdx = isDown ? 0 : items.length - 1;
        else nextIdx = (currentIdx + (isDown ? 1 : -1) + items.length) % items.length;

        items[nextIdx].focus();
        return true;
    }

    function onPomodoroKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            hidePomodoroPopover();
            pomodoroToggle.focus();
            return;
        }
        const pop = document.getElementById('pomodoroPopover');
        if (!pop) return;

        // Backspace closes the popover (parity with the music popover) so
        // keyboard users have a one-key "back out" anywhere in the menu.
        // Skipped while editing the inline countdown so Backspace still
        // deletes characters in the duration input.
        if (event.key === 'Backspace' && !isFocusInTextInput()) {
            event.preventDefault();
            event.stopPropagation();
            hidePomodoroPopover();
            pomodoroToggle.focus();
            return;
        }

        pomodoroArrowNav(pop, event);
    }

    // 2D arrow navigation matching the pomodoro popover's visual layout.
    // Rows top-to-bottom: [Focus | Short | Long], [countdown], [Start | Reset],
    // [Suggest] (last row only present in the COMPLETE_UNACKED state). Left
    // /Right walk within a row, Up/Down between rows. Movement clamps at the
    // edges (no wrap) — Backspace owns the "exit the menu" affordance, so
    // wrap-around would only confuse the spatial model. Column index is
    // preserved across row jumps and clamped to the new row's length so a
    // Down from "Long" lands on Reset, not Start.
    function pomodoroArrowNav(pop, event) {
        const isLeft  = event.key === 'ArrowLeft';
        const isRight = event.key === 'ArrowRight';
        const isUp    = event.key === 'ArrowUp';
        const isDown  = event.key === 'ArrowDown';
        const isHome  = event.key === 'Home';
        const isEnd   = event.key === 'End';
        if (!isLeft && !isRight && !isUp && !isDown && !isHome && !isEnd) return;

        // Defer to native caret handling when the inline countdown editor
        // (a text input) has focus.
        if (isFocusInTextInput()) return;

        const rows = [];
        const tabs = Array.from(pop.querySelectorAll('.pomodoroTab'));
        if (tabs.length) rows.push(tabs);
        const countdown = pop.querySelector('.pomodoroCountdown');
        if (countdown && countdown.getClientRects().length > 0) rows.push([countdown]);
        const actions = [
            pop.querySelector('.pomodoroPrimaryBtn'),
            pop.querySelector('.pomodoroResetBtn'),
        ].filter(function(el) { return el && el.getClientRects().length > 0; });
        if (actions.length) rows.push(actions);
        const suggest = pop.querySelector('.pomodoroSuggestBtn');
        if (suggest && suggest.getClientRects().length > 0) rows.push([suggest]);
        if (!rows.length) return;

        const ae = document.activeElement;
        let curRow = -1, curCol = -1;
        outer: for (let r = 0; r < rows.length; r++) {
            for (let c = 0; c < rows[r].length; c++) {
                if (rows[r][c] === ae) { curRow = r; curCol = c; break outer; }
            }
        }

        // Entry from outside the grid (focus on the toggle): pick a corner
        // based on the arrow direction. Other keys with no current position
        // are no-ops so we don't pull focus on stray Left/Right.
        if (curRow === -1) {
            if (isDown || isHome) {
                event.preventDefault();
                event.stopPropagation();
                rows[0][0].focus();
            } else if (isUp || isEnd) {
                event.preventDefault();
                event.stopPropagation();
                rows[rows.length - 1][0].focus();
            }
            return;
        }

        let nextRow = curRow, nextCol = curCol;
        if (isLeft)       nextCol = Math.max(0, curCol - 1);
        else if (isRight) nextCol = Math.min(rows[curRow].length - 1, curCol + 1);
        else if (isUp)    nextRow = Math.max(0, curRow - 1);
        else if (isDown)  nextRow = Math.min(rows.length - 1, curRow + 1);
        else if (isHome)  { nextRow = 0; nextCol = 0; }
        else if (isEnd)   { nextRow = rows.length - 1; nextCol = rows[nextRow].length - 1; }

        // After a row change the preserved column may overrun the new row.
        nextCol = Math.min(nextCol, rows[nextRow].length - 1);
        if (nextRow === curRow && nextCol === curCol) return;

        event.preventDefault();
        event.stopPropagation();
        rows[nextRow][nextCol].focus();
    }

    function showPomodoroPopover() {
        const ctl = getPomodoroController();
        if (!ctl) return;

        const pop = document.createElement('div');
        pop.id = 'pomodoroPopover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Pomodoro timer');

        const header = document.createElement('div');
        header.className = 'pomodoroPopoverHeader';
        header.textContent = 'Pomodoro';
        pop.appendChild(header);

        // Mode tabs — switching while a countdown is running resets it to the
        // new mode's default. Same affordance the controller exposes via
        // setMode; the tab is just a UI alias.
        const tabs = document.createElement('div');
        tabs.className = 'pomodoroTabs';
        const tabConfig = [
            ['focus', 'Focus'],
            ['short', 'Short'],
            ['long',  'Long'],
        ];
        const tabButtons = {};
        tabConfig.forEach(function(pair) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'pomodoroTab';
            tab.dataset.mode = pair[0];
            tab.textContent = pair[1];
            tab.setAttribute('role', 'tab');
            tab.addEventListener('click', function() {
                ctl.setMode(pair[0]);
            });
            tabs.appendChild(tab);
            tabButtons[pair[0]] = tab;
        });
        pop.appendChild(tabs);

        // Inline-editable MM:SS countdown. Click to edit; Enter / blur commit
        // via parseMMSS, Escape reverts. Mobile-safe font-size handled in CSS.
        const countdownWrap = document.createElement('div');
        countdownWrap.className = 'pomodoroCountdownWrap';

        const countdown = document.createElement('button');
        countdown.type = 'button';
        countdown.className = 'pomodoroCountdown';
        countdown.setAttribute('aria-label', 'Edit duration');
        countdownWrap.appendChild(countdown);

        const countdownInput = document.createElement('input');
        countdownInput.type  = 'text';
        countdownInput.className = 'pomodoroCountdownInput';
        countdownInput.inputMode = 'numeric';
        countdownInput.maxLength = 5;
        countdownInput.style.display = 'none';
        countdownWrap.appendChild(countdownInput);

        pop.appendChild(countdownWrap);

        function commitCountdownEdit() {
            const parsed = parseMMSS(countdownInput.value);
            if (parsed !== null) {
                ctl.setDuration(ctl.getState().mode, parsed);
            }
            countdownInput.style.display = 'none';
            countdown.style.display = '';
        }

        countdown.addEventListener('click', function() {
            // Editing the duration mid-session would be ambiguous; gate
            // editing to IDLE so the inline input only appears when the
            // edit will actually take effect.
            const status = ctl.getState().status;
            if (status === 'RUNNING' || status === 'PAUSED') return;
            const snap = ctl.getState();
            countdownInput.value = formatMMSS(Math.round(snap.remainingMs / 1000));
            countdown.style.display = 'none';
            countdownInput.style.display = '';
            countdownInput.focus();
            countdownInput.select();
        });
        countdownInput.addEventListener('blur', commitCountdownEdit);
        countdownInput.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                commitCountdownEdit();
            } else if (event.key === 'Escape') {
                event.stopPropagation();
                countdownInput.style.display = 'none';
                countdown.style.display = '';
            }
        });

        // Action row — Start/Pause/Resume + Reset. The primary button label
        // tracks the current status.
        const actions = document.createElement('div');
        actions.className = 'pomodoroActions';

        const primaryBtn = document.createElement('button');
        primaryBtn.type = 'button';
        primaryBtn.className = 'pomodoroPrimaryBtn';

        const resetBtn = document.createElement('button');
        resetBtn.type = 'button';
        resetBtn.className = 'pomodoroResetBtn';
        resetBtn.textContent = 'Reset';

        actions.appendChild(primaryBtn);
        actions.appendChild(resetBtn);
        pop.appendChild(actions);

        primaryBtn.addEventListener('click', function() {
            const status = ctl.getState().status;
            if (status === 'RUNNING') {
                ctl.pause();
            } else {
                ctl.start();
                // Per the spec — Start closes the popover so the icon's
                // sweeping hand is the user's primary feedback channel.
                hidePomodoroPopover();
            }
        });

        resetBtn.addEventListener('click', function() {
            ctl.reset();
        });

        // Suggestion row — only renders when a session has just completed
        // and is awaiting acknowledgment. Auto-suggests the next mode.
        const suggestion = document.createElement('div');
        suggestion.className = 'pomodoroSuggestion';
        const suggestBtn = document.createElement('button');
        suggestBtn.type = 'button';
        suggestBtn.className = 'pomodoroSuggestBtn';
        suggestion.appendChild(suggestBtn);
        pop.appendChild(suggestion);

        suggestBtn.addEventListener('click', function() {
            const next = nextSuggestedMode(ctl.getState().mode);
            ctl.setMode(next);
            ctl.start();
            hidePomodoroPopover();
        });

        function syncPopoverFromState(snap) {
            // Active mode tab
            tabConfig.forEach(function(pair) {
                tabButtons[pair[0]].classList.toggle('active', snap.mode === pair[0]);
            });
            countdown.textContent = formatMMSS(Math.round((snap.remainingMs || 0) / 1000));
            // Primary button label and disabled state
            if (snap.status === 'RUNNING')        primaryBtn.textContent = 'Pause';
            else if (snap.status === 'PAUSED')    primaryBtn.textContent = 'Resume';
            else                                  primaryBtn.textContent = 'Start';
            // Suggestion only shows in the post-complete acknowledgment window
            if (snap.status === 'COMPLETE_UNACKED') {
                suggestion.style.display = '';
                const nextMode = nextSuggestedMode(snap.mode);
                suggestBtn.textContent = 'Start ' + (MODE_LABEL[nextMode] || nextMode).toLowerCase();
            } else {
                suggestion.style.display = 'none';
            }
        }

        const unsubscribe = ctl.subscribe(syncPopoverFromState);
        syncPopoverFromState(ctl.getState());

        document.body.appendChild(pop);

        // Anchor the popover beneath the trigger, right-aligned, clamped to
        // the viewport — mirrors the settings menu placement.
        const rect = pomodoroToggle.getBoundingClientRect();
        const popRect = pop.getBoundingClientRect();
        let top  = rect.bottom + 4;
        let left = rect.right - popRect.width;
        if (left < 4) left = 4;
        if (top + popRect.height > window.innerHeight) {
            top = Math.max(4, window.innerHeight - popRect.height - 4);
        }
        pop.style.top  = top + 'px';
        pop.style.left = left + 'px';

        pomodoroToggle.setAttribute('aria-expanded', 'true');

        // Acknowledge any pending alert the moment the user opens the
        // popover — the visit itself counts as acknowledgement, per the spec.
        if (ctl.getState().status === 'COMPLETE_UNACKED') ctl.acknowledge();

        document.addEventListener('click', onPomodoroOutsideClick, true);
        document.addEventListener('keydown', onPomodoroKeydown, true);
        window.addEventListener('resize', hidePomodoroPopover);
        window.addEventListener('scroll', hidePomodoroPopover, true);

        // Tear down the popover-scoped subscription on dismissal so the
        // controller doesn't keep notifying a removed DOM element.
        const origRemove = pop.parentNode ? null : null;
        const observer = new MutationObserver(function() {
            if (!document.contains(pop)) {
                unsubscribe();
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true });
    }

    pomodoroToggle.addEventListener('click', function(event) {
        event.stopPropagation();
        if (document.getElementById('pomodoroPopover')) {
            hidePomodoroPopover();
        } else {
            showPomodoroPopover();
        }
    });

    // ── Ctrl+Space global shortcut ──
    // Toggles the Pomodoro timer from anywhere in the app. We skip while the
    // user is typing in an input/textarea/contentEditable so Ctrl+Space can
    // still insert a space (and so IME completion chords still work).
    // On every toggle a brief status pill ("Paused" amber / "Play" purple)
    // surfaces inside the popover header for visual confirmation. If the
    // popover was closed, we open it just long enough for the pill to fade,
    // then auto-close it; if it was already open, only the pill fades.
    let pomodoroPillTimers = [];
    let pomodoroPillOpenedByShortcut = false;

    function clearPomodoroPillTimers() {
        for (let i = 0; i < pomodoroPillTimers.length; i++) {
            clearTimeout(pomodoroPillTimers[i]);
        }
        pomodoroPillTimers = [];
    }

    function buildPomodoroPillIcon(kind) {
        // Inline SVG keeps the pill icon-library-free, matching the rest of
        // main.js. The play triangle and pause bars are tiny (10px) so the
        // pill stays compact alongside its label.
        if (kind === 'paused') {
            return '<svg class="pomodoroStatusPillIcon" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
                '<rect x="3" y="2" width="2" height="8" rx="0.5" fill="currentColor"/>' +
                '<rect x="7" y="2" width="2" height="8" rx="0.5" fill="currentColor"/>' +
                '</svg>';
        }
        return '<svg class="pomodoroStatusPillIcon" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">' +
            '<path d="M3.5 2.2v7.6L10 6z" fill="currentColor"/>' +
            '</svg>';
    }

    function showPomodoroStatusPill(kind) {
        // Open the popover first if it's closed so we have a header to dock
        // the pill into. Track that we opened it so the auto-close timer
        // below knows to dismiss it after the pill fades.
        const wasOpenAlready = !!document.getElementById('pomodoroPopover');
        if (!wasOpenAlready) {
            showPomodoroPopover();
            pomodoroPillOpenedByShortcut = true;
        }
        const pop = document.getElementById('pomodoroPopover');
        if (!pop) return;
        const header = pop.querySelector('.pomodoroPopoverHeader');
        if (!header) return;

        // Cancel any in-flight pill so rapid repeated presses always reflect
        // the latest toggle rather than stacking stale fade-outs.
        clearPomodoroPillTimers();
        const existing = pop.querySelector('.pomodoroStatusPill');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

        const pill = document.createElement('div');
        pill.className = 'pomodoroStatusPill ' + (kind === 'paused' ? 'paused' : 'playing');
        pill.setAttribute('role', 'status');
        pill.innerHTML = buildPomodoroPillIcon(kind) +
            '<span class="pomodoroStatusPillLabel">' +
            (kind === 'paused' ? 'Paused' : 'Play') +
            '</span>';
        // Insert as a sibling between the header and whatever follows
        // (typically the tabs row).
        if (header.nextSibling) {
            header.parentNode.insertBefore(pill, header.nextSibling);
        } else {
            header.parentNode.appendChild(pill);
        }

        // Visible at full opacity for ~1.2s, then fade over ~400ms via the
        // .fading class (CSS transition). Auto-close path waits an extra
        // ~200ms after removal so the user sees the pill finish before the
        // popover blinks out.
        pomodoroPillTimers.push(setTimeout(function() {
            pill.classList.add('fading');
        }, 1200));
        pomodoroPillTimers.push(setTimeout(function() {
            if (pill.parentNode) pill.parentNode.removeChild(pill);
        }, 1600));
        pomodoroPillTimers.push(setTimeout(function() {
            // Timer-driven auto-close — this isn't a user-driven dismissal,
            // so it intentionally bypasses the modal's "close 3 ways"
            // convention. Only fires when the shortcut itself opened the
            // popover; if the user already had it open, we leave it alone.
            if (pomodoroPillOpenedByShortcut && document.getElementById('pomodoroPopover')) {
                hidePomodoroPopover();
            }
            pomodoroPillOpenedByShortcut = false;
        }, 1800));
    }

    document.addEventListener('keydown', function(e) {
        // Older Gecko reported the space key as 'Spacebar'; modern browsers
        // emit ' '. Accept both so the shortcut works across engines.
        if (e.key !== ' ' && e.key !== 'Spacebar') return;
        if (!e.ctrlKey) return;
        if (e.altKey || e.shiftKey || e.metaKey) return;
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const ctl = getPomodoroController();
        if (!ctl) return;
        const result = ctl.toggle();
        e.preventDefault();
        if (result === 'noop') return;
        showPomodoroStatusPill(result);
    });

    // Subscribe at controller-level too so the icon sweep + accent recolor
    // stay in sync regardless of whether the popover is open.
    setTimeout(function() {
        const ctl = getPomodoroController();
        if (!ctl) return;
        ctl.subscribe(syncPomodoroIcon);
        syncPomodoroIcon();
    }, 0);

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

    function syncMusicIcon() {
        const ctl = getMusicController();
        if (!ctl) return;
        const snap = ctl.getState();
        musicToggle.setAttribute('data-music-status', snap.status);
    }

    // Hidden popover lives in the DOM after the first open so the iframe
    // (and therefore the audio stream) isn't destroyed on close.
    let musicPopover = null;
    let musicSyncFromState = null;

    function hideMusicPopover() {
        if (!musicPopover) return;
        musicPopover.classList.remove('open');
        musicToggle.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onMusicOutsideClick, true);
        document.removeEventListener('keydown', onMusicKeydown, true);
        window.removeEventListener('resize', repositionMusicPopover);
        window.removeEventListener('scroll', repositionMusicPopover, true);
    }

    function onMusicOutsideClick(event) {
        if (!musicPopover) return;
        if (musicPopover.contains(event.target) || musicToggle.contains(event.target)) return;
        hideMusicPopover();
    }

    function onMusicKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            hideMusicPopover();
            musicToggle.focus();
            return;
        }

        // Backspace closes the popover from anywhere — the volume slider's
        // native ↑↓ handling traps keyboard users with no arrow-key exit, so
        // a "back out" key is essential. Skipped when typing in the paste-
        // URL form so Backspace still deletes characters there.
        if (event.key === 'Backspace' && !isFocusInTextInput()) {
            if (!musicPopover || !musicPopover.classList.contains('open')) return;
            event.preventDefault();
            event.stopPropagation();
            hideMusicPopover();
            musicToggle.focus();
            return;
        }

        if (!musicPopover || !musicPopover.classList.contains('open')) return;
        popoverArrowNav(musicPopover, event);
    }

    function repositionMusicPopover() {
        if (!musicPopover || !musicPopover.classList.contains('open')) return;
        const rect = musicToggle.getBoundingClientRect();
        const popRect = musicPopover.getBoundingClientRect();
        let top  = rect.bottom + 4;
        let left = rect.right - popRect.width;
        if (left < 4) left = 4;
        if (top + popRect.height > window.innerHeight) {
            top = Math.max(4, window.innerHeight - popRect.height - 4);
        }
        musicPopover.style.top  = top + 'px';
        musicPopover.style.left = left + 'px';
    }

    function buildMusicPopover() {
        const ctl = getMusicController();
        if (!ctl) return null;

        const pop = document.createElement('div');
        pop.id = 'musicPopover';
        pop.setAttribute('role', 'dialog');
        pop.setAttribute('aria-label', 'Focus music');

        const header = document.createElement('div');
        header.className = 'musicPopoverHeader';

        // Empty left slot keeps the centered title true-centered regardless
        // of the right-side icon-button width.
        const headerLeft = document.createElement('span');
        headerLeft.className = 'musicPopoverHeaderSpacer';
        headerLeft.setAttribute('aria-hidden', 'true');

        const headerTitle = document.createElement('span');
        headerTitle.className = 'musicPopoverHeaderTitle';
        headerTitle.textContent = 'Focus music';

        // Icon-only "open the active station on youtube.com" button, sitting
        // where users expect a modal control. Click resolves the URL from the
        // current controller state at click time so swapping stations doesn't
        // require rebuilding the header.
        const headerOpenExt = document.createElement('button');
        headerOpenExt.type = 'button';
        headerOpenExt.className = 'musicHeaderOpenExt';
        headerOpenExt.setAttribute('aria-label', 'Open in YouTube');
        headerOpenExt.title = 'Open in YouTube';
        headerOpenExt.innerHTML =
            '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<path d="M14 4h6v6"/>' +
            '<path d="M10 14 20 4"/>' +
            '<path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/>' +
            '</svg>';
        headerOpenExt.addEventListener('click', function() {
            const snap = ctl.getState();
            const station = getStationById(snap, snap.activeStationId);
            const href = youTubeUrlForStation(station) || 'https://www.youtube.com';
            window.open(href, '_blank', 'noopener');
        });

        header.appendChild(headerLeft);
        header.appendChild(headerTitle);
        header.appendChild(headerOpenExt);
        pop.appendChild(header);

        // Iframe target — the YT IFrame Player API replaces this <div> with
        // an actual iframe. Visible at 240×135 inside the popover so the
        // stream artwork shows through and YouTube's TOS embed-visibility
        // terms are honoured.
        const playerWrap = document.createElement('div');
        playerWrap.className = 'musicPlayerWrap';
        const playerTarget = document.createElement('div');
        playerTarget.id = 'musicPlayerTarget';
        playerWrap.appendChild(playerTarget);
        pop.appendChild(playerWrap);

        const nowPlaying = document.createElement('div');
        nowPlaying.className = 'musicNowPlaying';
        pop.appendChild(nowPlaying);

        // Station picker — custom first, curated below.
        const picker = document.createElement('div');
        picker.className = 'musicPicker';
        pop.appendChild(picker);

        function renderPicker(snap) {
            picker.textContent = '';

            if (snap.customStations && snap.customStations.length) {
                const head = document.createElement('div');
                head.className = 'musicPickerSection';
                head.textContent = 'Your stations';
                picker.appendChild(head);
                snap.customStations.forEach(function(station) {
                    picker.appendChild(stationRow(station, snap, true));
                });
            }

            const head = document.createElement('div');
            head.className = 'musicPickerSection';
            head.textContent = 'Curated';
            picker.appendChild(head);
            snap.curatedStations.forEach(function(station) {
                picker.appendChild(stationRow(station, snap, false));
            });

            // Paste-URL row at the bottom.
            const pasteRow = document.createElement('div');
            pasteRow.className = 'musicPasteRow';
            const pasteBtn = document.createElement('button');
            pasteBtn.type = 'button';
            pasteBtn.className = 'musicPasteBtn';
            pasteBtn.textContent = '+ Paste YouTube URL';
            pasteRow.appendChild(pasteBtn);

            const pasteForm = document.createElement('div');
            pasteForm.className = 'musicPasteForm';
            pasteForm.style.display = 'none';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.className = 'musicPasteNameInput';
            nameInput.placeholder = 'Station name (optional)';

            const urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.className = 'musicPasteUrlInput';
            urlInput.placeholder = 'https://youtube.com/watch?v=…';

            const errorMsg = document.createElement('div');
            errorMsg.className = 'musicPasteError';
            errorMsg.style.display = 'none';

            pasteForm.appendChild(nameInput);
            pasteForm.appendChild(urlInput);
            pasteForm.appendChild(errorMsg);
            pasteRow.appendChild(pasteForm);
            picker.appendChild(pasteRow);

            pasteBtn.addEventListener('click', function() {
                const open = pasteForm.style.display !== 'none';
                pasteForm.style.display = open ? 'none' : '';
                if (!open) {
                    setTimeout(function() { urlInput.focus(); }, 0);
                }
            });

            urlInput.addEventListener('keydown', function(event) {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                const parsed = parseYouTubeUrl(urlInput.value);
                if (!parsed) {
                    errorMsg.textContent = "Couldn't read that URL. Try a watch / playlist / live link.";
                    errorMsg.style.display = '';
                    return;
                }
                const station = ctl.addCustomStation(nameInput.value, urlInput.value);
                if (!station) {
                    errorMsg.textContent = "Couldn't add that station.";
                    errorMsg.style.display = '';
                    return;
                }
                nameInput.value = '';
                urlInput.value = '';
                errorMsg.style.display = 'none';
                pasteForm.style.display = 'none';
            });
        }

        function stationRow(station, snap, isCustom) {
            const row = document.createElement('div');
            row.className = 'musicStationRow' + (snap.activeStationId === station.id ? ' active' : '');
            row.dataset.stationId = station.id;

            const nameBtn = document.createElement('button');
            nameBtn.type = 'button';
            nameBtn.className = 'musicStationName';
            nameBtn.textContent = station.name;
            nameBtn.addEventListener('click', function() {
                ctl.setStation(station.id);
            });

            const genre = document.createElement('span');
            genre.className = 'musicStationGenre';
            genre.textContent = (station.genre || '').toUpperCase();

            row.appendChild(nameBtn);
            row.appendChild(genre);

            if (isCustom) {
                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'musicStationRemove';
                removeBtn.setAttribute('aria-label', 'Remove ' + station.name);
                removeBtn.textContent = '×';
                removeBtn.addEventListener('click', function(event) {
                    event.stopPropagation();
                    ctl.removeCustomStation(station.id);
                });
                row.appendChild(removeBtn);
            }
            return row;
        }

        // Primary play/pause + volume row.
        const controls = document.createElement('div');
        controls.className = 'musicControls';

        const primaryBtn = document.createElement('button');
        primaryBtn.type = 'button';
        primaryBtn.className = 'musicPrimaryBtn';
        primaryBtn.textContent = 'Play';
        primaryBtn.addEventListener('click', function() {
            const status = ctl.getState().status;
            if (status === 'PLAYING' || status === 'BUFFERING') {
                ctl.pause();
            } else {
                ctl.play(playerTarget);
            }
        });

        const volumeWrap = document.createElement('label');
        volumeWrap.className = 'musicVolumeWrap';
        const volumeInput = document.createElement('input');
        volumeInput.type = 'range';
        volumeInput.min = '0';
        volumeInput.max = '100';
        volumeInput.className = 'musicVolume';
        volumeInput.setAttribute('aria-label', 'Volume');
        volumeInput.addEventListener('input', function() {
            const v = parseInt(volumeInput.value, 10);
            if (isFinite(v)) ctl.setVolume(v / 100);
        });
        volumeWrap.appendChild(volumeInput);

        controls.appendChild(primaryBtn);
        controls.appendChild(volumeWrap);
        pop.appendChild(controls);

        function syncFromState(snap) {
            renderPicker(snap);
            volumeInput.value = String(Math.round((snap.volume || 0) * 100));
            if (snap.status === 'PLAYING' || snap.status === 'BUFFERING') {
                primaryBtn.textContent = 'Pause';
            } else {
                primaryBtn.textContent = 'Play';
            }
            if (snap.nowPlaying && snap.nowPlaying.title) {
                nowPlaying.textContent = snap.nowPlaying.title +
                    (snap.nowPlaying.author ? ' — ' + snap.nowPlaying.author : '');
            } else {
                nowPlaying.textContent = '';
            }
        }
        musicSyncFromState = syncFromState;
        ctl.subscribe(syncFromState);
        syncFromState(ctl.getState());

        return pop;
    }

    function showMusicPopover() {
        if (!musicPopover) {
            musicPopover = buildMusicPopover();
            if (!musicPopover) return;
            document.body.appendChild(musicPopover);
        }
        musicPopover.classList.add('open');
        // Force a sync now so a station added via setStation while the
        // popover was closed shows up active on next open.
        if (musicSyncFromState) {
            const ctl = getMusicController();
            if (ctl) musicSyncFromState(ctl.getState());
        }
        repositionMusicPopover();
        musicToggle.setAttribute('aria-expanded', 'true');
        document.addEventListener('click', onMusicOutsideClick, true);
        document.addEventListener('keydown', onMusicKeydown, true);
        window.addEventListener('resize', repositionMusicPopover);
        window.addEventListener('scroll', repositionMusicPopover, true);
    }

    musicToggle.addEventListener('click', function(event) {
        event.stopPropagation();
        if (musicPopover && musicPopover.classList.contains('open')) {
            hideMusicPopover();
        } else {
            showMusicPopover();
        }
    });

    // Keep the icon's playing/paused/idle treatment in sync regardless of
    // whether the popover is open.
    setTimeout(function() {
        const ctl = getMusicController();
        if (!ctl) return;
        ctl.subscribe(syncMusicIcon);
        syncMusicIcon();

        // Pomodoro coordination: pause music when an alert lands; resume on
        // acknowledgment if the user was playing before. Subscribed via the
        // pure helper exported from music.js so the coordination is
        // independently testable.
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

    // When the no-projects empty state is showing, its Create button is the
    // single keyboard affordance on the page (Enter creates the first
    // project). Returning focus to settingsToggle after the menu closes
    // would mean Enter just re-opens the menu instead of creating a
    // project — so prefer the Create button when present.
    function focusAfterSettingsClose() {
        const createBtn = document.getElementById('emptyStateCreateBtn');
        if (createBtn) { createBtn.focus(); return; }
        settingsToggle.focus();
    }

    function hideSettingsMenu() {
        const existing = document.getElementById('settingsMenu');
        if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
        settingsToggle.setAttribute('aria-expanded', 'false');
        document.removeEventListener('click', onSettingsOutsideClick, true);
        document.removeEventListener('keydown', onSettingsKeydown, true);
        window.removeEventListener('resize', hideSettingsMenu);
        window.removeEventListener('scroll', hideSettingsMenu, true);
    }

    function onSettingsOutsideClick(event) {
        const menu = document.getElementById('settingsMenu');
        if (!menu) return;
        if (menu.contains(event.target) || settingsToggle.contains(event.target)) return;
        hideSettingsMenu();
        focusAfterSettingsClose();
    }

    function onSettingsKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            hideSettingsMenu();
            focusAfterSettingsClose();
            return;
        }

        // Backspace closes the menu (parity with the music + pomodoro
        // popovers). The settings menu has no text-entry surfaces of its
        // own, but the guard mirrors the others for consistency in case an
        // input is added later.
        if (event.key === 'Backspace' && !isFocusInTextInput()) {
            event.preventDefault();
            event.stopPropagation();
            hideSettingsMenu();
            focusAfterSettingsClose();
            return;
        }

        // Arrow / Home / End nav across the menuitem rows. ArrowDown from the
        // toggle drops focus on the first item; ArrowUp from the toggle lands
        // on the last item. Within the menu, Up/Down wrap around so a long
        // press cycles indefinitely. Dividers have role="separator" and are
        // skipped naturally by the [role="menuitem"] selector. Enter/Space
        // activation is handled by the native <button> elements.
        const isUp   = event.key === 'ArrowUp';
        const isDown = event.key === 'ArrowDown';
        const isHome = event.key === 'Home';
        const isEnd  = event.key === 'End';
        if (!isUp && !isDown && !isHome && !isEnd) return;

        const menu = document.getElementById('settingsMenu');
        if (!menu) return;
        const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
        if (!items.length) return;

        event.preventDefault();
        event.stopPropagation();

        const currentIdx = items.indexOf(document.activeElement);
        let nextIdx;
        if (isHome) {
            nextIdx = 0;
        } else if (isEnd) {
            nextIdx = items.length - 1;
        } else if (currentIdx === -1) {
            // Focus is on the toggle (menu just opened) or somewhere outside
            // the item list — entry direction picks the target.
            nextIdx = isDown ? 0 : items.length - 1;
        } else {
            const delta = isDown ? 1 : -1;
            nextIdx = (currentIdx + delta + items.length) % items.length;
        }
        items[nextIdx].focus();
    }

    function buildSettingsMenuItem(labelText, stateText, onActivate, extraClass) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'settingsMenuItem' + (extraClass ? ' ' + extraClass : '');
        item.setAttribute('role', 'menuitem');
        const label = document.createElement('span');
        label.className = 'settingsMenuItemLabel';
        label.textContent = labelText;
        const state = document.createElement('span');
        state.className = 'settingsMenuItemState';
        state.textContent = stateText;
        if (!stateText) state.style.display = 'none';
        item.appendChild(label);
        item.appendChild(state);
        item.addEventListener('click', function() {
            hideSettingsMenu();
            onActivate();
            // After in-place actions (theme flip, ghost toggle, JSON export)
            // focus has nowhere to go — the menu was its parent, and the
            // action didn't open another control. Hand focus back to the
            // empty-state Create button when present so Enter still
            // creates a project. Skipped when onActivate opened something
            // that grabbed focus (e.g., Help modal), since that control
            // owns its own restoration.
            if (!document.activeElement || document.activeElement === document.body) {
                focusAfterSettingsClose();
            }
        });
        return item;
    }

    function buildSettingsMenuDivider() {
        const divider = document.createElement('div');
        divider.className = 'settingsMenuDivider';
        divider.setAttribute('role', 'separator');
        return divider;
    }

    function showSettingsMenu() {
        const menu = document.createElement('div');
        menu.id = 'settingsMenu';
        menu.setAttribute('role', 'menu');

        // Export JSON — writes the current snapshot to a downloadable file.
        // The state pill mirrors the footer's last-exported relative label so
        // the user sees how stale their last manual backup is at the moment
        // they're about to take a new one.
        const exportItem = buildSettingsMenuItem(
            'Export JSON',
            formatRelativeExportedAt(readLastExportedAt()),
            function() { exportTodosToFile(); }
        );
        menu.appendChild(exportItem);

        // Import JSON — proxies to the hidden file input the menu trigger
        // owns. The file's onchange handler runs the validate → confirm →
        // overwrite flow inside importFromFile.
        const importItem = buildSettingsMenuItem(
            'Import JSON',
            '',
            function() { importFileInput.click(); }
        );
        menu.appendChild(importItem);

        menu.appendChild(buildSettingsMenuDivider());

        // Theme — flips light ↔ dark and persists. Mirrors the inline toggle
        // logic that previously lived in theme.js's createThemeToggleButton:
        // brief `theme-transitioning` class drives the cross-fade timing.
        const themeItem = buildSettingsMenuItem(
            'Theme',
            getCurrentTheme() === 'light' ? 'Light' : 'Dark',
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
        menu.appendChild(themeItem);

        // Toggle floating ghost — flips the companion-enabled pref and
        // mounts/destroys the singleton DOM element accordingly. The state
        // pill on the right reflects current state; tapping the row toggles
        // it. Hidden on mobile viewports via CSS to match where the floating
        // companion actually runs (the static ghost-icon trigger above stays
        // available on every viewport).
        const ghostItem = buildSettingsMenuItem(
            'Toggle floating ghost',
            isCompanionEnabled() ? 'ON' : 'OFF',
            function() {
                const next = !isCompanionEnabled();
                setCompanionEnabled(next);
                if (next) ensureCompanion();
                else      destroyCompanion();
                applyCompanionGhostPreference();
            },
            'settingsMenuItem--ghost'
        );
        menu.appendChild(ghostItem);

        // HELP section — groups the replay-tour entry alongside the
        // existing Help modal entry so the global utilities sit under a
        // labelled cluster. Mirrors the View / Appearance / Help section
        // layout the mobile settings modal already uses; here a divider +
        // small heading stands in for the section chrome since the
        // popover is a flat list and not a sectioned modal.
        menu.appendChild(buildSettingsMenuDivider());
        const helpHeading = document.createElement('div');
        helpHeading.className = 'settingsMenuSectionHeading';
        helpHeading.textContent = 'Help';
        helpHeading.setAttribute('role', 'presentation');
        menu.appendChild(helpHeading);

        // Replay welcome tour — single entry on every viewport that
        // dispatches by viewport: the mobile carousel on coarse-pointer
        // narrow viewports, the desktop coachmark tour everywhere else.
        // The chevron in the state slot (in place of an ON/OFF pill)
        // signals "tap to start a flow" rather than "toggle a setting".
        // Seeding is once-per-install (todoapp_sampleSeeded), so a manual
        // replay never re-seeds the sample project.
        const replayTourItem = buildSettingsMenuItem(
            'Replay welcome tour',
            '›',
            function() {
                if (isMobileCarouselViewport()) startWelcomeCarousel();
                else startCoachmarkTour();
            },
            'settingsMenuItem--chevron'
        );
        menu.appendChild(replayTourItem);

        // Help — opens the same help modal as the floating `?` button and
        // the global `?` keypress. Lives under the HELP heading alongside
        // the replay-tour entry so the two help-adjacent actions cluster.
        const helpItem = buildSettingsMenuItem(
            'Help',
            '',
            function() { showHelpModal(); }
        );
        menu.appendChild(helpItem);

        document.body.appendChild(menu);

        // Anchor the menu beneath the trigger, right-aligned with it. Clamp
        // to the viewport so the menu always renders fully on-screen.
        const rect = settingsToggle.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        let top = rect.bottom + 4;
        let left = rect.right - menuRect.width;
        if (left < 4) left = 4;
        if (top + menuRect.height > window.innerHeight) {
            top = Math.max(4, window.innerHeight - menuRect.height - 4);
        }
        menu.style.top = top + 'px';
        menu.style.left = left + 'px';

        settingsToggle.setAttribute('aria-expanded', 'true');

        // Capture-phase listeners so outside interactions always close the
        // menu, mirroring the project context menu and due-date popover.
        document.addEventListener('click', onSettingsOutsideClick, true);
        document.addEventListener('keydown', onSettingsKeydown, true);
        window.addEventListener('resize', hideSettingsMenu);
        window.addEventListener('scroll', hideSettingsMenu, true);
    }

    settingsToggle.addEventListener('click', function(event) {
        event.stopPropagation();
        if (document.getElementById('settingsMenu')) {
            hideSettingsMenu();
        } else {
            showSettingsMenu();
        }
    });

    nav.appendChild(sidebarToggle);
    nav.appendChild(pomodoroToggle);
    nav.appendChild(musicToggle);
    nav.appendChild(settingsToggle);
    nav.appendChild(importFileInput);

    // Header arrow-key navigation. ArrowLeft / ArrowRight walk focus
    // across the header controls (sidebarToggle → viewPillProjects
    // → viewPillToday → viewPillCalendar → pomodoroToggle → musicToggle
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
        const order = [sidebarToggle, viewPillProjects, viewPillToday, viewPillCalendar];
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

    base.appendChild(nav);
    base.appendChild(main);
    base.appendChild(foot);
    base.appendChild(sidebarOverlay);

    // Floating help FAB — pinned to the bottom-right of the viewport. Opens
    // the help modal (topic sections + keyboard shortcuts). CSS hides it on
    // coarse-pointer devices (touch viewports) and while another modal /
    // popover is open via the body:has(...) rules in style.css.
    const helpFab = createHelpFab();
    base.appendChild(helpFab);

    // ── Mobile bottom sheet utility surface ──
    // Bottom-anchored sheet for STACK mobile (≤700px) that houses the
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
    // bottom of the viewport at ≤700px. Tapping a tab routes through
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
    // CLAUDE.md. List, target, and calendar glyphs. Built from <rect>
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
    const ICON_TARGET =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<path d="M21 12 a9 9 0 1 1 -18 0 a9 9 0 1 1 18 0"/>' +
        '<path d="M17 12 a5 5 0 1 1 -10 0 a5 5 0 1 1 10 0"/>' +
        '<rect x="11" y="11" width="2" height="2" rx="1" fill="currentColor"/>' +
        '</svg>';
    const ICON_CALENDAR =
        '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
        '<rect x="3" y="5" width="18" height="16" rx="2"/>' +
        '<line x1="3" y1="10" x2="21" y2="10"/>' +
        '<line x1="8" y1="3" x2="8" y2="7"/>' +
        '<line x1="16" y1="3" x2="16" y2="7"/>' +
        '</svg>';

    const mobileTabProjects = buildMobileTab('projects', 'Projects', ICON_LIST);
    const mobileTabToday    = buildMobileTab('today',    'Today',    ICON_TARGET);
    const mobileTabCalendar = buildMobileTab('calendar', 'Calendar', ICON_CALENDAR);
    mobileTabProjects.id = 'mobileTabProjects';
    mobileTabToday.id    = 'mobileTabToday';
    mobileTabCalendar.id = 'mobileTabCalendar';

    mobileTabBar.appendChild(mobileTabProjects);
    mobileTabBar.appendChild(mobileTabToday);
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
    const footExport  = document.createElement('span');
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
    footExport.id = 'footExport';
    footOpen.id = 'footOpen';
    footDone.id = 'footDone';
    // Initial copy is the never-exported state; refreshFooterExportLabel
    // overwrites it on first paint with the current relative timestamp.
    footExport.textContent = formatRelativeExportedAt(readLastExportedAt());
    footOpen.textContent = '0 OPEN';
    footDone.textContent = '0 DONE';

    foot.appendChild(footVersion);

    // ── stale-export reminder ──
    // Sits between the version label on the left and the open/done counts on
    // the right. exportImport.js owns the visibility logic (driven off
    // todoapp_lastExportedAt and a "has any todos" check); refreshStaleHint
    // is called here on first paint and again whenever the import flow
    // completes or an export finishes.
    const staleExportHint = createStaleExportHint();
    foot.appendChild(staleExportHint);

    footCounts.appendChild(footExport);
    footCounts.appendChild(footOpen);
    footCounts.appendChild(footDone);
    foot.appendChild(footCounts);

    // Initial unseen-indicator paint — deferred so the dot element is in the DOM.
    setTimeout(updateChangelogDot, 0);
    setTimeout(refreshStaleHint, 0);
    setTimeout(refreshFooterExportLabel, 0);

    main.appendChild(main1);
    main.appendChild(sidebarResizer);
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
    // On mobile (≤700px) the sidebar splits into two equal halves via the
    // #sidebarTop / #sidebarBottom wrappers so the projects block
    // bottom-anchors to the vertical midpoint instead of pinning to the
    // top — the View/Appearance/footer block then top-anchors at the
    // midpoint. Desktop treats #sidebarTop as a flex:1 1 auto growth
    // region and #sidebarBottom is visually inert (its children are
    // display:none above 700px), so desktop layout is unchanged.
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
    // On the ≤700px breakpoint the layout shifts to a STACK pattern: the
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

    // Dense-mobile-header affordance (≤700px only — hidden on desktop
    // via CSS): the ▾ chevron next to the project name advertises the
    // dropdown that opens the drawer (project picker). It lives in the
    // DOM at every viewport but the desktop styles keep it display:none
    // so the legacy ‹ › carousel pattern stays untouched above 700px.
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
    // mobile-only, but the listener is harmless above 700px.
    function openMobileDrawer() {
        if (!main1.classList.contains('sidebar-open')) {
            main1.classList.add('sidebar-open');
            if (typeof window.bottomSheetRefreshVisibility === 'function') {
                window.bottomSheetRefreshVisibility();
            }
        }
    }
    mobileProjName.addEventListener('click', openMobileDrawer);
    mobileProjChevron.addEventListener('click', openMobileDrawer);

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

    const viewPillToday = document.createElement('button');
    viewPillToday.id = 'viewPillToday';
    viewPillToday.type = 'button';
    viewPillToday.className = 'viewPill';
    viewPillToday.setAttribute('role', 'tab');
    viewPillToday.setAttribute('aria-pressed', 'false');
    viewPillToday.textContent = 'TODAY';

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
    viewSwitcher.appendChild(viewPillToday);
    viewSwitcher.appendChild(viewPillCalendar);

    viewPillToday.addEventListener('click', function() {
        applyActiveView('today');
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
    //   • TODAY    — the first .todayRow.todoRowCard div in #todaySections.
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
            const sections = document.getElementById('todaySections');
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
    viewPillToday.addEventListener('keydown', dropFocusIntoMainView);
    viewPillCalendar.addEventListener('keydown', dropFocusIntoMainView);

    // ── Today dashboard shell ──
    // Date header, count summary, overdue/today/upcoming sections, and
    // an empty state that only shows when every bucket is empty. The
    // shell sits in the main panel alongside the project view and
    // toggles via #mainBar's data-view attribute so neither view
    // re-renders the other on switch.
    const todayView = document.createElement('div');
    todayView.id = 'todayView';

    const todayDateHeader = document.createElement('div');
    todayDateHeader.id = 'todayDateHeader';

    const todayCountSummary = document.createElement('div');
    todayCountSummary.id = 'todayCountSummary';

    const todaySections = document.createElement('div');
    todaySections.id = 'todaySections';

    const todayEmpty = document.createElement('div');
    todayEmpty.id = 'todayEmpty';
    todayEmpty.textContent = 'No items due yet — add a todo from any project to see it here';

    // Mobile-only ghost spacer that anchors the Today view when the bucket
    // counts are short. The .viewGhostSpacer rule is gated to ≤700px in
    // style.css, so the element is inert on desktop. flex:1 fills the
    // remaining vertical column inside #todayView (which is already
    // flex-direction: column), centering the ghost + caption in whatever
    // space is left below the date header / counts / sections. The
    // companion-ghost preference applies via the body class set in
    // applyCompanionGhostPreference — it hides the painted ghost while
    // leaving the spacer's reserved space intact so the layout doesn't
    // shift when the user toggles it.
    const todayGhostSpacer = document.createElement('div');
    todayGhostSpacer.id = 'todayGhostSpacer';
    todayGhostSpacer.className = 'viewGhostSpacer';
    todayGhostSpacer.setAttribute('aria-hidden', 'true');
    const todayGhostMascot = document.createElement('div');
    todayGhostMascot.className = 'viewGhostMascot';
    const todayGhostCaption = document.createElement('div');
    todayGhostCaption.className = 'viewGhostCaption';
    todayGhostCaption.textContent = 'Nothing else due';
    todayGhostSpacer.appendChild(todayGhostMascot);
    todayGhostSpacer.appendChild(todayGhostCaption);

    todayView.appendChild(todayDateHeader);
    todayView.appendChild(todayCountSummary);
    todayView.appendChild(todaySections);
    todayView.appendChild(todayEmpty);
    todayView.appendChild(todayGhostSpacer);

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
    // calendarPrev and calendarNext but clamp at the boundary so focus
    // never leaves the pair horizontally; ArrowUp returns to
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
        const order = [sidebarToggle, viewPillProjects, viewPillToday, viewPillCalendar, calendarPrevBtn, calendarNextBtn, pomodoroToggle, musicToggle, settingsToggle];
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
            return;
        }
        if (e.key === 'ArrowLeft') {
            e.preventDefault();
            e.stopPropagation();
            if (e.target === calendarNextBtn) calendarPrevBtn.focus();
            return;
        }
    }
    calendarPrevBtn.addEventListener('keydown', calendarNavArrowKey);
    calendarNextBtn.addEventListener('keydown', calendarNavArrowKey);

    nav.insertBefore(viewSwitcher, pomodoroToggle);
    main2.appendChild(todayView);
    main2.appendChild(calendarView);
    main2.appendChild(mobileProjHeader);
    main2.appendChild(mainList);

    // ── mobile drawer close (X) button ──
    // Adds an explicit dismiss affordance to the sidebar drawer at the
    // ≤700px breakpoint so the modal-style three-way close vocabulary
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
    const bulkDescActions = document.createElement('div');
    bulkDescActions.id = 'bulkDescActions';

    const bulkDescToggleBtn = document.createElement('button');
    bulkDescToggleBtn.type = 'button';
    bulkDescToggleBtn.id  = 'bulkDescToggle';
    bulkDescToggleBtn.className = 'bulkDescBtn';
    const bulkDescLabel = document.createElement('span');
    bulkDescLabel.className = 'bulkDescLabel';
    bulkDescLabel.textContent = 'Expand All';
    const bulkDescCaret = document.createElement('span');
    bulkDescCaret.className = 'bulkDescCaret';
    bulkDescCaret.textContent = '▾';
    bulkDescCaret.setAttribute('aria-hidden', 'true');
    bulkDescToggleBtn.appendChild(bulkDescLabel);
    bulkDescToggleBtn.appendChild(bulkDescCaret);

    bulkDescActions.appendChild(bulkDescToggleBtn);
    main2.appendChild(bulkDescActions);

    bulkDescToggleBtn.addEventListener('click', function () {
        const expanded = bulkDescToggleBtn.classList.toggle('expanded');
        if (expanded) {
            expandAllDescriptions();
            bulkDescLabel.textContent = 'Collapse All';
        } else {
            collapseAllDescriptions();
            bulkDescLabel.textContent = 'Expand All';
        }
    });

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
            function() { return bulkDescToggleBtn.classList.contains('expanded'); },
            function() { bulkDescToggleBtn.click(); }
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
    drawerSettingsBtn.textContent = 'Settings';

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
            if (isMobileCarouselViewport()) startWelcomeCarousel();
            else startCoachmarkTour();
        });
        helpSection.appendChild(replayRow);

        body.appendChild(viewSection);
        body.appendChild(appearanceSection);
        body.appendChild(helpSection);

        dialog.appendChild(header);
        dialog.appendChild(body);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        const previouslyFocused = document.activeElement;
        closeX.focus();
        drawerSettingsBtn.setAttribute('aria-expanded', 'true');

        let closed = false;
        function close() {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeydown, true);
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
    function isMobile() { return window.innerWidth <= 700; }

    function openSidebar() {
        if (isMobile()) {
            // Drawer state could have drifted while it was closed (theme
            // toggled via settings menu, Expand All toggled by Ctrl+Enter,
            // a project added/removed). Re-sync the mobile mirrors so the
            // ON/OFF pills and footer count match reality on every open.
            refreshDrawerSections();
            main1.classList.add('sidebar-open');
            sidebarOverlay.classList.add('visible');
            if (typeof window.bottomSheetRefreshVisibility === 'function') {
                window.bottomSheetRefreshVisibility();
            }
        } else {
            main.classList.remove('sidebar-collapsed');
        }
    }

    function closeSidebar() {
        if (isMobile()) {
            main1.classList.remove('sidebar-open');
            sidebarOverlay.classList.remove('visible');
            if (typeof window.bottomSheetRefreshVisibility === 'function') {
                window.bottomSheetRefreshVisibility();
            }
        } else {
            main.classList.add('sidebar-collapsed');
        }
    }

    function sidebarIsOpen() {
        return isMobile()
            ? main1.classList.contains('sidebar-open')
            : !main.classList.contains('sidebar-collapsed');
    }

    // Desktop: hamburger toggles between the 54px icon rail (default) and
    // the full named-project sidebar. Mobile: the rail isn't shown — the
    // hamburger continues to slide the existing overlay drawer in/out.
    sidebarToggle.addEventListener('click', function() {
        if (isMobile()) {
            sidebarIsOpen() ? closeSidebar() : openSidebar();
            return;
        }
        const next = !isSidebarRailOn();
        setSidebarRailOn(next);
        applySidebarRail(next);
    });

    // Auto-expand the rail when a project input takes focus (Edit context
    // menu, keyboard nav into a row's input, programmatic focus). Without
    // this, users in rail mode would land on a hidden input with no
    // visible cursor.
    sideMain.addEventListener('focusin', function(event) {
        if (isMobile()) return;
        if (!isSidebarRailOn()) return;
        if (event.target && event.target.id === 'projInput') {
            setSidebarRailOn(false);
            applySidebarRail(false);
        }
    });

    sidebarOverlay.addEventListener('click', closeSidebar);

    // X-button close inside the mobile drawer. Mirrors the backdrop click
    // and the Escape handler below so the drawer satisfies CLAUDE.md's
    // three-way modal close vocabulary at the ≤700px breakpoint.
    mobileSidebarClose.addEventListener('click', function() {
        closeSidebar();
        sidebarToggle.focus();
    });

    // Escape closes the mobile drawer, completing the modal close
    // vocabulary (X button, backdrop tap, Escape). Capture phase so an
    // open drawer always wins over downstream Escape handlers (which
    // would otherwise consume the keystroke for popovers and modals
    // mounted underneath the drawer's backdrop). Bails when another
    // modal/popover is already open so its own Escape handling owns the
    // keystroke; bails on desktop where the sidebar is a persistent rail
    // rather than a modal drawer.
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Escape') return;
        if (!isMobile()) return;
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

    // Global "Ctrl+Enter" (or Cmd+Enter) shortcut — mirror the EXPAND ALL
    // button so the chord toggles inline descriptions on every open task at
    // once. Routed through the button's own click so the label and the
    // `.expanded` class flip in lockstep with the bulk action, which keeps
    // the visible state of the control honest after a keyboard invocation.
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        bulkDescToggleBtn.click();
        e.preventDefault();
    });

    // Global "Ctrl+Backspace" (or Cmd+Backspace) shortcut — toggle the
    // sidebar exactly the way the hamburger does, so the whole chrome stays
    // reachable from the keyboard. Routed through `sidebarToggle.click()`
    // so the desktop rail/full and mobile drawer branches stay in lockstep
    // with the on-screen control. Skipped while focus is inside an editable
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
    // showConfirmModal flow as the row's `×` button.
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
        const isDelete    = e.key === 'Delete';
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
    //                rows inside #todaySections in DOM order, clamping at
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
        if (view !== 'today' && view !== 'calendar') return;

        const ae = document.activeElement;
        const isInputLike = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));

        if (view === 'today') {
            // ArrowLeft / ArrowRight are unused on Today — let them fall
            // through so caret movement in any focused input still works.
            if (isLeft || isRight) return;

            const sections = document.getElementById('todaySections');
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
                    const pill = document.getElementById('viewPillToday');
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
                    if (calendarSelectedKey) {
                        target = grid.querySelector('.calendarCell[data-date="' + calendarSelectedKey + '"]');
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
        // 7-column grid) up to the CALENDAR pill so keyboard users can
        // walk into the header chrome without reaching for the mouse.
        // stopPropagation keeps the cross-pane ArrowLeft/ArrowRight
        // handler from also firing.
        if (isUp && idx < 7) {
            const pill = document.getElementById('viewPillCalendar');
            if (pill) {
                pill.focus();
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

    // ── sidebar resize logic ──
    // Allows the user to drag the vertical divider between the Projects sidebar
    // and the Todo Items panel. Width is persisted via localStorage (see
    // prefs.js for the read/write helpers) so it survives reloads. On mobile
    // viewports the sidebar is a drawer, so the handle is hidden via CSS and
    // we bail out here too.
    const SIDEBAR_MIN_W     = 120;

    function sidebarMaxWidth() {
        return Math.floor(window.innerWidth * 0.5);
    }

    function clampSidebarWidth(w) {
        return Math.max(SIDEBAR_MIN_W, Math.min(sidebarMaxWidth(), w));
    }

    function setSidebarWidth(w) {
        document.documentElement.style.setProperty('--sidebar-w', clampSidebarWidth(w) + 'px');
    }

    const savedWidth = readSidebarWidthPref();
    if (!isNaN(savedWidth)) setSidebarWidth(savedWidth);

    let resizeStartX = 0;
    let resizeStartW = 0;
    let resizing     = false;

    function readSidebarWidth() {
        const cs = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w');
        const px = parseInt(cs, 10);
        return isNaN(px) ? 200 : px;
    }

    function onResizeMove(e) {
        if (!resizing) return;
        const clientX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        setSidebarWidth(resizeStartW + (clientX - resizeStartX));
        if (e.cancelable) e.preventDefault();
    }

    function onResizeEnd() {
        if (!resizing) return;
        resizing = false;
        sidebarResizer.classList.remove('resizing');
        document.body.style.userSelect = '';
        writeSidebarWidthPref(readSidebarWidth());
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeEnd);
        document.removeEventListener('touchmove', onResizeMove);
        document.removeEventListener('touchend', onResizeEnd);
        document.removeEventListener('touchcancel', onResizeEnd);
    }

    function onResizeStart(e) {
        if (isMobile()) return;
        resizing = true;
        resizeStartX = (e.touches && e.touches[0]) ? e.touches[0].clientX : e.clientX;
        resizeStartW = readSidebarWidth();
        sidebarResizer.classList.add('resizing');
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onResizeMove);
        document.addEventListener('mouseup', onResizeEnd);
        document.addEventListener('touchmove', onResizeMove, { passive: false });
        document.addEventListener('touchend', onResizeEnd);
        document.addEventListener('touchcancel', onResizeEnd);
        if (e.cancelable) e.preventDefault();
    }

    sidebarResizer.addEventListener('mousedown', onResizeStart);
    sidebarResizer.addEventListener('touchstart', onResizeStart, { passive: false });

    // re-clamp on viewport resize so the sidebar can't exceed 50% of a newly
    // narrowed window (e.g. user rotates device or resizes browser).
    // Only touch the value if it's actually out of bounds so the responsive
    // default keeps applying when the user hasn't customised the width.
    window.addEventListener('resize', function() {
        if (isMobile()) return;
        const current = readSidebarWidth();
        const max     = sidebarMaxWidth();
        if (current > max) {
            setSidebarWidth(max);
            if (hasSidebarWidthPref()) {
                writeSidebarWidthPref(readSidebarWidth());
            }
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

        // Rail mode hides #projInput, so the user has no visible typing
        // surface for the new project name. Expand to full sidebar mode for
        // the entry — the user can re-collapse via the hamburger after.
        if (!isMobile() && isSidebarRailOn()) {
            setSidebarRailOn(false);
            applySidebarRail(false);
        }

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

    // Wire the desktop drag-and-drop import path. Mobile (pointer: coarse)
    // is bailed out inside attachDragDropImport — the file picker covers
    // mobile. Deferred so window listeners attach against the live DOM.
    setTimeout(function() {
        attachDragDropImport(function() { rebuildAfterImport(); });
    }, 0);

    return base;

};


// Wipe the live project sidebar + todo list and rebuild from listLogic's
// current state. Called after a successful import once
// listLogic.replaceAllProjects has rewritten storage. Mirrors the boot
// sequence (clear, then restoreFromStorage) so any post-restore selection
// and accent logic still runs.
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

    restoreFromStorage();
    refreshStaleHint();
}


export { component, restoreFromStorage, notifyUpdateAvailable };

// Bulk open/close every committed row's description panel. Clicks the row's
// own #descToggle so the closure-scoped `switcher` inside wireDescToggle
// stays in sync with the DOM — individual per-row toggles keep working
// after a bulk action. Blank placeholder rows hide their #descToggle
// (display: none), so filtering on that skips them.
function expandAllDescriptions() {
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    mainListDiv.querySelectorAll('#descToggle').forEach(function(toggle) {
        if (toggle.style.display === 'none') return;
        if (!toggle.classList.contains('open')) toggle.click();
    });
}

function collapseAllDescriptions() {
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    mainListDiv.querySelectorAll('#descToggle').forEach(function(toggle) {
        if (toggle.classList.contains('open')) toggle.click();
    });
}


// restoreFromStorage — call this AFTER component() is appended to document.body
// so that getElementById calls resolve against the live DOM.
function restoreFromStorage() {

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
        // Initial-load default: the saved view dictates whether the desktop
        // sidebar starts collapsed (TODAY) or expanded (PROJECTS), even
        // when applyActiveView's view-change guard would otherwise skip it.
        applyViewDefaultSidebar(getActiveView());
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
        addToDos_restore(lastItems, lastProject);
    } else if (lastItems) {
        addAllToDo_DOM(lastItems, lastProject);
    }
    focusBlankToDoInputIfDesktop();

    // Honour the persisted top-level view. When the saved view is
    // 'today', this also clears the auto-selected last project so the
    // sidebar reads as "no active project" — Today owns the main panel
    // and the project list is just navigation chrome at that point.
    applyActiveView(getActiveView());
    // Initial-load default: the saved view dictates whether the desktop
    // sidebar starts collapsed (TODAY) or expanded (PROJECTS), even
    // when applyActiveView's view-change guard would otherwise skip it.
    applyViewDefaultSidebar(getActiveView());

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
    if (view === 'today') {
        const sections = document.getElementById('todaySections');
        if (sections) {
            // Target the row container (tabindex="-1") rather than the inner
            // .todayRowTitle button. Landing on the row div lets the
            // document-level Today arrow-nav handler advance to the next row
            // on the subsequent ArrowDown; landing on the title button
            // triggers its "anchor focus to the row container" branch and
            // burns the keystroke without moving.
            const row = sections.querySelector('.todayRow.todoRowCard');
            if (row) return row;
            const focusable = sections.querySelector('button, input, [tabindex]:not([tabindex="-1"])');
            if (focusable) return focusable;
        }
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

// Apply the top-level Today / Projects view. Module-scope so both the
// in-component pill click handlers and the restoreFromStorage auto-init
// path can route through one entry point. Writes the chosen view to
// localStorage, flips #mainBar's data-view attribute (the CSS show/hide
// hook for the two surfaces), syncs the pill .active state, and — when
// switching to today — clears any selected project in the sidebar and
// refreshes the date header text. Safe to call before component() has
// run; missing nodes short-circuit silently so the boot order stays
// flexible.
function applyActiveView(view) {
    let safe = 'today';
    if (view === 'projects') safe = 'projects';
    else if (view === 'calendar') safe = 'calendar';
    const prevView = getActiveView();
    setActiveView(safe);

    const mainBar = document.getElementById('mainBar');
    if (mainBar) mainBar.setAttribute('data-view', safe);

    const pillToday    = document.getElementById('viewPillToday');
    const pillProjects = document.getElementById('viewPillProjects');
    const pillCalendar = document.getElementById('viewPillCalendar');
    if (pillToday) {
        pillToday.classList.toggle('active', safe === 'today');
        pillToday.setAttribute('aria-pressed', safe === 'today' ? 'true' : 'false');
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
    const tabToday    = document.getElementById('mobileTabToday');
    const tabCalendar = document.getElementById('mobileTabCalendar');
    if (tabProjects) {
        tabProjects.classList.toggle('active', safe === 'projects');
        tabProjects.setAttribute('aria-pressed', safe === 'projects' ? 'true' : 'false');
    }
    if (tabToday) {
        tabToday.classList.toggle('active', safe === 'today');
        tabToday.setAttribute('aria-pressed', safe === 'today' ? 'true' : 'false');
    }
    if (tabCalendar) {
        tabCalendar.classList.toggle('active', safe === 'calendar');
        tabCalendar.setAttribute('aria-pressed', safe === 'calendar' ? 'true' : 'false');
    }

    if (safe === 'today') {
        // The sidebar selection persists across view switches. Sidebar
        // and #mobileProjHeader are hidden on TODAY anyway, so the
        // lingering .selectedProject has zero visual effect — and on the
        // return trip to PROJECTS, updateMobileProjHeader re-paints from
        // the still-selected row instead of being stuck with
        // data-empty="true".
        refreshTodayDateHeader();
        renderTodayDashboard();
    } else if (safe === 'calendar') {
        // Same reasoning as TODAY — keep .selectedProject set so PROJECTS
        // returns to a populated mobile header. CALENDAR owns the main
        // panel; the sidebar is hidden so the lingering class is
        // invisible until PROJECTS reactivates.
        resetCalendarStateToToday();
        renderCalendarView();
    }

    // Switching views resets the desktop projects sidebar to the new
    // view's default: TODAY/CALENDAR collapse to the icon rail (the
    // dashboard owns the main panel, the project list is just
    // navigation chrome) and PROJECTS expands to the full named-project
    // sidebar. A no-op when the view hasn't actually changed so the
    // hamburger override the user took within the current view is
    // preserved.
    if (prevView !== safe) {
        applyViewDefaultSidebar(safe);
    }
}

// Reset the desktop projects sidebar to a view's default open/collapsed
// state. TODAY collapses to the 54px icon rail; PROJECTS expands to the
// full named-project sidebar. Mobile keeps its drawer behavior — the
// rail is a desktop-and-up affordance and the mobile drawer is hidden
// by default regardless of view.
function applyViewDefaultSidebar(view) {
    if (window.innerWidth <= 700) return;
    const wantRail = view !== 'projects';
    if (isSidebarRailOn() !== wantRail) {
        setSidebarRailOn(wantRail);
        applySidebarRail(wantRail);
    }
}

// Renders the Today view's date header in the user's locale, e.g.
// "Tuesday, May 13, 2026". Called on every switch to TODAY so the
// header reflects the current date even after the tab has been left
// open across midnight.
function refreshTodayDateHeader() {
    const header = document.getElementById('todayDateHeader');
    if (!header) return;
    const today = new Date();
    let text;
    try {
        text = today.toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        });
    } catch (e) {
        // Older runtimes without full Intl support fall back to the
        // default Date#toDateString — still date-shaped, just less
        // localised.
        text = today.toDateString();
    }
    header.textContent = text;
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


// ── Today dashboard renderer ──
// Pulls the aggregated overdue / today / upcoming buckets from
// listLogic.getTodayAggregation and replaces the contents of the
// count-summary line and #todaySections. The empty-state element
// shows only when every bucket is empty.
function renderTodayDashboard() {
    const summary  = document.getElementById('todayCountSummary');
    const sections = document.getElementById('todaySections');
    const empty    = document.getElementById('todayEmpty');
    if (!summary || !sections || !empty) return;

    const agg = listLogic.getTodayAggregation();
    const totalItems = agg.counts.overdue + agg.counts.today + agg.counts.upcoming;

    while (summary.firstChild) summary.removeChild(summary.firstChild);
    while (sections.firstChild) sections.removeChild(sections.firstChild);

    appendTodayCountSegment(summary, 'overdue', agg.counts.overdue, agg.counts.overdue + ' overdue');
    appendCountSeparator(summary);
    appendTodayCountSegment(summary, 'today', agg.counts.today, agg.counts.today + ' today');
    appendCountSeparator(summary);
    appendTodayCountSegment(summary, 'upcoming', agg.counts.upcoming, agg.counts.upcoming + ' upcoming');

    empty.style.display = totalItems === 0 ? '' : 'none';

    if (agg.counts.overdue > 0) {
        sections.appendChild(buildTodaySection('OVERDUE', 'overdue', agg.overdue));
    }
    if (agg.counts.today > 0) {
        sections.appendChild(buildTodaySection('TODAY', 'today', agg.today));
    }
    if (agg.counts.upcoming > 0) {
        sections.appendChild(buildTodaySection('UPCOMING', 'upcoming', agg.upcoming));
    }
}

function appendTodayCountSegment(parent, bucket, count, label) {
    const seg = document.createElement('span');
    seg.className = 'todayCountSegment';
    seg.setAttribute('data-bucket', bucket);
    seg.setAttribute('data-empty', count === 0 ? 'true' : 'false');

    const dot = document.createElement('span');
    dot.className = 'todayCountDot';
    dot.setAttribute('aria-hidden', 'true');

    const text = document.createElement('span');
    text.className = 'todayCountText';
    text.textContent = label;

    if (bucket === 'upcoming') {
        // Upcoming has no leading dot in the count summary line — only
        // overdue and today carry a colored dot. Keep the segment but
        // skip the dot for visual rhythm matching the spec.
        seg.appendChild(text);
    } else {
        seg.appendChild(dot);
        seg.appendChild(text);
    }
    parent.appendChild(seg);
}

function appendCountSeparator(parent) {
    const sep = document.createElement('span');
    sep.className = 'todayCountSep';
    sep.textContent = '·';
    sep.setAttribute('aria-hidden', 'true');
    parent.appendChild(sep);
}

function buildTodaySection(label, bucket, entries) {
    const section = document.createElement('section');
    section.className = 'todaySection';
    section.setAttribute('data-bucket', bucket);

    const header = document.createElement('h3');
    header.className = 'todaySectionHeader';
    header.textContent = label;
    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'todaySectionList';
    entries.forEach(function(entry) {
        list.appendChild(buildTodayRow(entry, bucket));
    });
    section.appendChild(list);

    return section;
}

// Build a single Today-view task row matching the Projects-view row card:
// checkbox → project pill → title → due pill (right-aligned). The project
// pill is a non-interactive purple-outline chip; the due pill mirrors the
// Projects-view due pill markup via updateDuePillLabel (calendar icon +
// label + chevron) but is display-only in this entry — clicking it does
// not open the date popover (interactivity is a follow-up entry).
// Checkbox toggles completion (recurring items go through
// advanceRecurringTodo); clicking the row body (outside the checkbox and
// pills) switches to PROJECTS, selects the parent project, and scrolls
// to the matching todo row.
//   options.hideDuePill — Calendar's day-detail panel shares this builder
//     but omits the due pill, since the date is implied by the selected
//     calendar cell. Pass an `onAfterToggle` callback when the caller's
//     surrounding view needs a custom re-render (e.g. the calendar
//     redraws the dot density on the toggled date).
// TODO: extract shared due-pill builder so both views render through the
// same factory rather than duplicating the markup invariants.
function buildTodayRow(entry, bucket, options) {
    options = options || {};
    const row = document.createElement('div');
    row.className = 'todayRow todoRowCard';
    row.setAttribute('data-bucket', bucket);
    // tabindex="-1" lets the view-aware arrow-nav handler programmatically
    // focus the row container without putting it in the browser tab order.
    // Tab still walks the checkbox / title button per their natural order;
    // ArrowUp/ArrowDown walk row containers via the global handler.
    row.setAttribute('tabindex', '-1');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'todayRowCheck';
    checkbox.checked = !!entry.item.completed;
    checkbox.setAttribute('aria-label', 'Mark ' + entry.item.tit + ' complete');
    checkbox.addEventListener('click', function(e) {
        e.stopPropagation();
    });
    checkbox.addEventListener('change', function() {
        handleTodayCheckboxToggle(entry, checkbox, options.onAfterToggle);
    });

    const projectPill = document.createElement('span');
    projectPill.className = 'todayRowProjectPill';
    projectPill.textContent = entry.project;
    projectPill.title = entry.project;

    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'todayRowTitle';
    title.textContent = entry.item.tit;
    title.title = entry.item.tit;

    row.appendChild(checkbox);
    row.appendChild(projectPill);
    row.appendChild(title);

    if (!options.hideDuePill) {
        const duePill = document.createElement('span');
        duePill.className = 'todayRowDuePill';
        duePill.setAttribute('aria-hidden', 'true');
        updateDuePillLabel(duePill, entry.item);
        row.appendChild(duePill);

        // .due-soon / .due-overdue keyed on daysUntilDue — the same urgency
        // classes the Projects-view rows use, so the shared CSS rules recolor
        // the due pill (amber for today / due-in-N-days ≤3, red for overdue).
        applyDueUrgency(row, entry.item);
    }

    // Row-level click jumps to the parent project. Clicks on the checkbox
    // stop propagation in its own handler; the pills are pointer-events:
    // none in CSS so they pass through. The title is a <button> so keyboard
    // Enter activates jump natively — mouse clicks on the title bubble up
    // to this listener.
    row.addEventListener('click', function(e) {
        if (e.target.closest('.todayRowCheck')) return;
        jumpToProjectTodo(entry.project, entry.item);
    });

    return row;
}

function handleTodayCheckboxToggle(entry, checkbox, onAfter) {
    const item = entry.item;
    const project = entry.project;
    const wasCompleted = !!item.completed;

    // Recurring branch mirrors the projects-view checkbox: when the
    // user checks a recurring todo, advance its due date instead of
    // marking it complete. Fall through to the standard completion
    // path when there's no recurrence or the next due exceeds endDate.
    if (checkbox.checked && !wasCompleted && item.recurrence) {
        const advanced = listLogic.advanceRecurringTodo(project, item, new Date());
        if (advanced) {
            if (typeof onAfter === 'function') onAfter();
            else renderTodayDashboard();
            return;
        }
    }

    item.completed = checkbox.checked;
    listLogic.sortCompletedToBottom(project);
    if (typeof onAfter === 'function') onAfter();
    else renderTodayDashboard();
}

// Switch to PROJECTS, select the named project (delegating to its
// projChild click handler so accent, sidebar state, and rendering all
// run through the canonical path), then scroll the matching todo row
// into view.
function jumpToProjectTodo(projectName, item) {
    const projRows = document.querySelectorAll('#projChild');
    let target = null;
    projRows.forEach(function(row) {
        const input = row.querySelector('#projInput');
        if (input && input.value === projectName) target = row;
    });
    if (!target) {
        applyActiveView('projects');
        return;
    }

    if (!target.classList.contains('selectedProject')) {
        target.click();
    } else {
        // Already selected — just flip the view back.
        applyActiveView('projects');
    }

    // Wait one frame so the row DOM is rebuilt before scrolling.
    requestAnimationFrame(function() {
        const mainList = document.getElementById('mainList');
        if (!mainList) return;
        const rows = mainList.querySelectorAll('#toDoChild');
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].__item === item) {
                try {
                    rows[i].scrollIntoView({ behavior: 'smooth', block: 'center' });
                } catch (_) {
                    rows[i].scrollIntoView();
                }
                break;
            }
        }
    });
}


// ── CALENDAR VIEW ──────────────────────────────────────────────────
// Visible month + selected date for the Calendar view. Module-scope so
// the prev/next month buttons and individual cell-click handlers can
// mutate the state without threading refs through every callback. Both
// values reset to today on every entry to the Calendar view — neither
// is persisted across reloads (the spec is explicit: "Selected date is
// not persisted across page reloads — always resets to today on load").
let calendarVisibleYear  = null;
let calendarVisibleMonth = null; // 0..11
let calendarSelectedKey  = null; // 'YYYY-MM-DD'

function resetCalendarStateToToday() {
    const today = new Date();
    calendarVisibleYear  = today.getFullYear();
    calendarVisibleMonth = today.getMonth();
    calendarSelectedKey  = formatCalendarKeyForDate(today);
}

function shiftCalendarMonth(delta) {
    if (calendarVisibleYear === null || calendarVisibleMonth === null) {
        resetCalendarStateToToday();
    }
    const target = new Date(calendarVisibleYear, calendarVisibleMonth + delta, 1);
    calendarVisibleYear  = target.getFullYear();
    calendarVisibleMonth = target.getMonth();
    // The selected date persists across month nav — it just becomes a
    // leading/trailing day in the new month's grid (or falls outside
    // the visible cells entirely).
    renderCalendarView();
}

// Local-time YYYY-MM-DD formatter. Mirrors listLogic.formatCalendarKey;
// duplicated here because main.js does not currently import private
// helpers from listLogic (only the public IIFE methods). Keep in sync.
function formatCalendarKeyForDate(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return y + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (d < 10 ? '0' + d : '' + d);
}

function parseCalendarKey(key) {
    if (!key || typeof key !== 'string') return null;
    const parts = key.split('-');
    if (parts.length !== 3) return null;
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return null;
    return new Date(y, m - 1, d);
}

const CALENDAR_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CALENDAR_WEEKDAY_NAMES = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];

// Full Calendar view render: month label, 7×5-6 grid with density dots,
// and the right-side day-detail panel for the currently selected date.
// Reads through listLogic.getCalendarMonth(), which returns one entry
// per visible grid cell so this function can iterate the keys without
// computing offsets a second time.
function renderCalendarView() {
    const grid       = document.getElementById('calendarGrid');
    const monthLabel = document.getElementById('calendarMonthLabel');
    if (!grid || !monthLabel) return;
    if (calendarVisibleYear === null || calendarVisibleMonth === null) {
        resetCalendarStateToToday();
    }

    monthLabel.textContent = CALENDAR_MONTH_NAMES[calendarVisibleMonth] + ' ' + calendarVisibleYear;

    // Capture whether focus is inside the current grid before the
    // teardown discards every cell node. The Calendar arrow-nav, Enter,
    // and Backspace handlers all key off a focused .calendarCell, so
    // without a re-focus pass the user is stranded on <body> after the
    // rebuild. grid.contains() restricts the gate to the live grid so
    // mobile taps — where the <button> never receives focus — don't
    // auto-focus a cell and summon the on-screen keyboard.
    const ae = document.activeElement;
    const hadFocusedCell = !!(ae && ae.closest && ae.closest('.calendarCell') && grid.contains(ae));

    while (grid.firstChild) grid.removeChild(grid.firstChild);

    const monthMap = listLogic.getCalendarMonth(calendarVisibleYear, calendarVisibleMonth);
    const keys = Object.keys(monthMap).sort(); // ISO sort = chronological

    const todayKey = formatCalendarKeyForDate(new Date());

    keys.forEach(function(key) {
        const dt = parseCalendarKey(key);
        if (!dt) return;

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'calendarCell';
        cell.setAttribute('data-date', key);
        cell.setAttribute('role', 'gridcell');

        const inMonth = dt.getMonth() === calendarVisibleMonth && dt.getFullYear() === calendarVisibleYear;
        if (!inMonth) cell.classList.add('outOfMonth');
        if (key === todayKey) cell.classList.add('isToday');
        if (key === calendarSelectedKey) cell.classList.add('isSelected');

        const dayNum = document.createElement('span');
        dayNum.className = 'calendarCellDay';
        dayNum.textContent = String(dt.getDate());
        cell.appendChild(dayNum);

        // Density indicator — 1/2/3+ dots for the number of incomplete
        // todos due on that date. Capped at 3 per spec; cells with no
        // todos render no dot strip at all so the day number sits cleanly.
        const todos = monthMap[key] || [];
        if (todos.length > 0) {
            const dotsWrap = document.createElement('span');
            dotsWrap.className = 'calendarCellDots';
            dotsWrap.setAttribute('aria-hidden', 'true');
            const dotCount = Math.min(todos.length, 3);
            for (let i = 0; i < dotCount; i++) {
                const dot = document.createElement('span');
                dot.className = 'calendarCellDot';
                dotsWrap.appendChild(dot);
            }
            cell.appendChild(dotsWrap);
        }

        cell.addEventListener('click', function() {
            calendarSelectedKey = key;
            renderCalendarView();
        });

        grid.appendChild(cell);
    });

    if (hadFocusedCell && calendarSelectedKey) {
        const refocus = grid.querySelector('.calendarCell[data-date="' + calendarSelectedKey + '"]');
        if (refocus) refocus.focus();
    }

    renderCalendarDayPanel(monthMap);
}

// Day-detail panel renderer — reads the already-built monthMap so the
// task list mirrors exactly what the grid's dot densities counted, and
// updates the panel header / count / row list in a single pass. Reuses
// buildTodayRow with { hideDuePill: true }; checkbox toggles re-render
// the whole calendar so the dot count for the toggled date refreshes
// in lockstep.
function renderCalendarDayPanel(monthMap) {
    const headerEl = document.getElementById('calendarDayHeader');
    const countEl  = document.getElementById('calendarDayCount');
    const listEl   = document.getElementById('calendarDayList');
    if (!headerEl || !countEl || !listEl) return;

    const dt = parseCalendarKey(calendarSelectedKey);
    if (!dt) {
        headerEl.textContent = '';
        countEl.textContent = '';
        while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
        return;
    }

    headerEl.textContent =
        CALENDAR_WEEKDAY_NAMES[dt.getDay()] + ' ' +
        CALENDAR_MONTH_NAMES[dt.getMonth()].toUpperCase() + ' ' +
        dt.getDate();

    const entries = monthMap[calendarSelectedKey] || [];
    if (entries.length === 0) {
        countEl.textContent = 'No items on this day';
    } else if (entries.length === 1) {
        countEl.textContent = '1 item';
    } else {
        countEl.textContent = entries.length + ' items';
    }

    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);

    entries.forEach(function(entry) {
        const row = buildTodayRow(entry, 'calendar', {
            hideDuePill: true,
            onAfterToggle: renderCalendarView,
        });
        listEl.appendChild(row);
    });
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