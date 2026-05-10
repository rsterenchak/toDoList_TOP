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

    const sideHead = document.createElement('div');

    const addProj = document.createElement('div');
    const projButton = document.createElement('div');

    const mainTitle = document.createElement('div');
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

    sideTitle.id = 'sideTit';
    sideMain.id = 'sideMa';

    sideHead.id = 'sideHead';

    addProj.id = 'addProj';
    projButton.id = 'projButton';
    // tabindex makes the "+" reachable as a keyboard target when the user
    // arrow-navigates past the last project row (sideMa keydown handler
    // below) and so its own keydown listener can fire on Enter / ArrowUp.
    projButton.setAttribute('tabindex', '0');
    projButton.setAttribute('role', 'button');
    projButton.setAttribute('aria-label', 'Add new project');

    mainTitle.id = 'mainTitle';
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

    function onPomodoroKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            hidePomodoroPopover();
            pomodoroToggle.focus();
        }
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
        }
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
        }
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
            },
            'settingsMenuItem--ghost'
        );
        menu.appendChild(ghostItem);

        // Help — opens the same help modal as the floating `?` button and
        // the global `?` keypress. Sits at the bottom of the menu so the
        // global utilities cluster (Theme, Ghost, Help) reads as one group.
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
    //   sideTitle  — top: "PROJECTS" label (visible only in full mode;
    //                hidden via CSS in rail mode since it's empty there)
    //   sideMain   — middle: scrollable project rows
    //   addProj    — bottom: "+" add-project button. In rail mode the button
    //                renders with a dashed border; in full mode it stays a
    //                solid surface chip.
    main1.appendChild(sideTitle);
    main1.appendChild(sideMain);
    main1.appendChild(addProj);

    sideTitle.appendChild(sideHead);
    addProj.appendChild(projButton);

    main2.appendChild(mainTitle);
    main2.appendChild(mainList);

    sideHead.textContent = 'Projects';

    // ── breadcrumb (top-left of main column) ──
    // Rail mode shows only single-letter chips, so the active project's full
    // name appears textually only here. "<Project Name> · <N> open" stays
    // current via the same MutationObserver path that drives the footer
    // counts. Hidden in full sidebar mode where the project name is already
    // visible in the rail expansion.
    const mainCrumb = document.createElement('div');
    mainCrumb.id = 'mainCrumb';
    const mainCrumbName = document.createElement('span');
    mainCrumbName.id = 'mainCrumbName';
    const mainCrumbSep = document.createElement('span');
    mainCrumbSep.id = 'mainCrumbSep';
    mainCrumbSep.textContent = '·';
    mainCrumbSep.setAttribute('aria-hidden', 'true');
    const mainCrumbCount = document.createElement('span');
    mainCrumbCount.id = 'mainCrumbCount';
    mainCrumb.appendChild(mainCrumbName);
    mainCrumb.appendChild(mainCrumbSep);
    mainCrumb.appendChild(mainCrumbCount);
    mainTitle.appendChild(mainCrumb);

    // Bulk description control — single toggle in the Todo Items header,
    // right-aligned. Clicks are dispatched to each row's own #descToggle so
    // the per-row switcher state in wireDescToggle stays in sync with the DOM.
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
    mainTitle.appendChild(bulkDescActions);

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

    // ── sidebar toggle logic ──
    function isMobile() { return window.innerWidth <= 700; }

    function openSidebar() {
        if (isMobile()) {
            main1.classList.add('sidebar-open');
            sidebarOverlay.classList.add('visible');
        } else {
            main.classList.remove('sidebar-collapsed');
        }
    }

    function closeSidebar() {
        if (isMobile()) {
            main1.classList.remove('sidebar-open');
            sidebarOverlay.classList.remove('visible');
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

    if (window.matchMedia('(pointer: coarse)').matches) {
        main1.addEventListener('click', function(e) {
            const onProjChild = e.target.closest('#projChild');
            const onInput     = e.target.tagName === 'INPUT';
            if (onProjChild && !onInput) { closeSidebar(); }
        });
    }

    // Clear todo-active on all rows when clicking outside any todo row
    document.addEventListener('click', function(e) {
        if (!e.target.closest('#toDoChild')) {
            document.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                el.classList.remove('todo-active');
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
                // off the first row stays on it (no wrap).
                if (e.key === 'ArrowDown') {
                    const projBtn = document.getElementById('projButton');
                    if (projBtn) projBtn.focus();
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

        const mainList = document.getElementById('mainList');
        if (!mainList) return;

        const ae = document.activeElement;
        const isToDoInput = !!(ae && ae.id === 'toDoInput' && mainList.contains(ae));
        const isInputLike = !!(ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable));

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
            const input = currentRow.querySelector('#toDoInput');
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


        // Create element with textbox for input
        sideMaDiv.appendChild(projChild);
        projChild.appendChild(titleInput);
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
        }
    });




    function updateFooterCounts() {
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

        // Breadcrumb in the main column mirrors the active project name and
        // open count. In rail mode this is the only place the full name
        // appears textually; in full-sidebar mode CSS hides it to avoid
        // duplicating what's already in the rail expansion.
        if (name) {
            mainCrumbName.textContent = name;
            mainCrumbCount.textContent = open + ' open';
            mainCrumb.removeAttribute('data-empty');
        } else {
            mainCrumbName.textContent = '';
            mainCrumbCount.textContent = '';
            mainCrumb.setAttribute('data-empty', 'true');
        }
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

    const savedProjects = listLogic.listProjectsArray();

    if (savedProjects.length === 0) {
        updateEmptyState(document.getElementById('mainList'));
        return;
    }

    savedProjects.forEach(function(projectName) {

        const sideMaDiv = document.getElementById("sideMa");
        const mainListDiv = document.getElementById("mainList");
        const projButton  = document.getElementById("projButton");

        const projChild   = document.createElement("div");
        const titleInput  = document.createElement("input");
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

        spacer.style.width  = "12px";

        sideMaDiv.appendChild(projChild);
        projChild.appendChild(titleInput);
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