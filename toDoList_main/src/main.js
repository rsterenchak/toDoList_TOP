import './style.css';
import { listLogic } from './listLogic.js';
import {
    isCompanionEnabled,
    setCompanionEnabled,
    ensureCompanion,
    destroyCompanion,
} from './companion.js';
import {
    isCompactTitlesOn,
    setCompactTitlesOn,
    readSidebarWidthPref,
    writeSidebarWidthPref,
    hasSidebarWidthPref,
    isCompletedSectionOpen,
    setCompletedSectionOpen,
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
    showShortcutsModal,
    updateChangelogDot,
    notifyUpdateAvailable,
    applyPendingUpdate,
    createShortcutsHelpFab,
    isAnyModalOrPopoverOpen,
} from './modals.js';
import { updateEmptyState, updateCompletedSection } from './emptyState.js';
import { applyProjectAccent } from './projectMenu.js';
import {
    attachProjectContextMenu,
    attachProjectDrag,
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
} from './exportImport.js';
import button from './addProj_button.svg';


// Apply the saved theme during import, before component() — sets data-theme
// on <html> before any rendering happens. See theme.js for the persistence
// key, the matchMedia fallback, and the toggle button factory.
applyTheme(resolveInitialTheme());


// Persisted UI preference: compact-titles mode. When on, long todo titles are
// visually truncated with a trailing ellipsis instead of overflowing or
// wrapping. The underlying data is unchanged; CSS keys off
// `data-compact-titles="on"` on <html> to apply text-overflow.
//
// All persisted UI prefs (compact-titles, completed-section open/closed flag,
// sidebar width, changelog last-seen marker) live in prefs.js; the
// completed-section flag is consumed by emptyState.js.
function applyCompactTitles(on) {
    document.documentElement.setAttribute('data-compact-titles', on ? 'on' : 'off');
}

// Apply the saved preference before component() builds the DOM so the very
// first paint already matches the saved state — same pattern as applyTheme.
applyCompactTitles(isCompactTitlesOn());


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

    // sidebarToggle lives at the top of the rail, not in the nav. The rail
    // owns its own toggle so the hamburger is visually anchored to the
    // surface it controls. On mobile viewports the rail is replaced with the
    // existing overlay drawer, so the toggle still slides the full sidebar.

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
    }

    function onSettingsKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            hideSettingsMenu();
            settingsToggle.focus();
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
        // No state pill: action is one-shot, not a toggle.
        const exportItem = buildSettingsMenuItem(
            'Export JSON',
            '',
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

    nav.appendChild(settingsToggle);
    nav.appendChild(importFileInput);

    base.appendChild(nav);
    base.appendChild(main);
    base.appendChild(foot);
    base.appendChild(sidebarOverlay);

    // Floating help FAB — pinned to the bottom-right of the viewport. Opens
    // the keyboard shortcuts modal. CSS hides it on coarse-pointer devices
    // (touch viewports) and while another modal/popover is open via the
    // body[data-modal-open="true"] attribute toggled in modals.js.
    const shortcutsHelpFab = createShortcutsHelpFab();
    base.appendChild(shortcutsHelpFab);

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

    // ── stale-export reminder ──
    // Sits between the version label on the left and the open/done counts on
    // the right. exportImport.js owns the visibility logic (driven off
    // todoapp_lastExportedAt and a "has any todos" check); refreshStaleHint
    // is called here on first paint and again whenever the import flow
    // completes or an export finishes.
    const staleExportHint = createStaleExportHint();
    foot.appendChild(staleExportHint);

    footCounts.appendChild(footOpen);
    footCounts.appendChild(footDone);
    foot.appendChild(footCounts);

    // Initial unseen-indicator paint — deferred so the dot element is in the DOM.
    setTimeout(updateChangelogDot, 0);
    setTimeout(refreshStaleHint, 0);

    main.appendChild(main1);
    main.appendChild(sidebarResizer);
    main.appendChild(main2);

    // Sidebar layout (flex column):
    //   sideTitle  — top: hamburger toggle (always) + "PROJECTS" label
    //                (visible only in full mode; rail mode hides it via CSS)
    //   sideMain   — middle: scrollable project rows
    //   addProj    — bottom: "+" add-project button. In rail mode the button
    //                renders with a dashed border; in full mode it stays a
    //                solid surface chip.
    main1.appendChild(sideTitle);
    main1.appendChild(sideMain);
    main1.appendChild(addProj);

    sideTitle.appendChild(sidebarToggle);
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

    // Compact-titles toggle — pixel-art stacked-lines glyph (three horizontal
    // bars, each shorter than the last). Sits immediately to the LEFT of the
    // Expand All control so the two display-only viewport controls live
    // together. Outline (off) / filled accent (on) is driven by aria-pressed
    // in style.css; persisted state is reapplied in applyCompactTitles().
    const COMPACT_TITLES_SVG =
        '<svg class="compactTitlesIcon" viewBox="0 0 7 7" width="14" height="14" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">' +
        '<rect x="0" y="1" width="7" height="1"/>' +
        '<rect x="0" y="3" width="5" height="1"/>' +
        '<rect x="0" y="5" width="3" height="1"/>' +
        '</svg>';

    const compactTitlesBtn = document.createElement('button');
    compactTitlesBtn.type = 'button';
    compactTitlesBtn.id   = 'compactTitlesToggle';
    compactTitlesBtn.className = 'compactTitlesBtn';
    compactTitlesBtn.title = 'Compact titles';
    compactTitlesBtn.setAttribute('aria-label', 'Compact titles');
    compactTitlesBtn.innerHTML = COMPACT_TITLES_SVG;

    function syncCompactTitlesBtn() {
        compactTitlesBtn.setAttribute('aria-pressed', isCompactTitlesOn() ? 'true' : 'false');
    }
    syncCompactTitlesBtn();

    compactTitlesBtn.addEventListener('click', function () {
        const next = !isCompactTitlesOn();
        setCompactTitlesOn(next);
        applyCompactTitles(next);
        syncCompactTitlesBtn();
    });

    bulkDescActions.appendChild(compactTitlesBtn);

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

    // Global "Ctrl+\" (or Cmd+\ on macOS) shortcut — always jump straight to
    // the placeholder new-task input. Companion to the bare-`\` toggle: from
    // a committed todo the toggle would route to the sidebar (default
    // direction), so users mid-list need a one-step "back to the new-task
    // line" shortcut. Chord-style means we don't need a typing-surface guard
    // — it can't fire mid-typing by accident.
    document.addEventListener('keydown', function(e) {
        if (e.key !== '\\') return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        focusBlankToDoInput();
        e.preventDefault();
    });

    // Global "Ctrl+Enter" (or Cmd+Enter) shortcut — toggle the Completed
    // section. When CLOSING (was open → now closed), apply the `.todo-active`
    // marker class to the first committed open todo so the user lands in
    // keyboard-nav mode on the open list (same idiom as arrow-nav: the row
    // is highlighted, not its input). When OPENING (was closed → now open),
    // we leave focus alone — the user expanded the section to look at it,
    // not to be teleported back to the open list.
    document.addEventListener('keydown', function(e) {
        if (e.key !== 'Enter') return;
        if (!(e.ctrlKey || e.metaKey)) return;
        if (e.altKey || e.shiftKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        const wasOpen = isCompletedSectionOpen();
        setCompletedSectionOpen(!wasOpen);
        const mainListDiv = document.getElementById('mainList');
        if (mainListDiv) updateCompletedSection(mainListDiv);
        if (wasOpen && mainListDiv) {
            // Find the first committed open todo row (skip the placeholder,
            // which has an empty value, and any completed rows).
            const openRows = mainListDiv.querySelectorAll('#toDoChild:not(.completed)');
            let target = null;
            for (let i = 0; i < openRows.length; i++) {
                const input = openRows[i].querySelector('#toDoInput');
                if (input && input.value && input.value.trim().length > 0) {
                    target = openRows[i];
                    break;
                }
            }
            if (target) {
                // Single-active-row invariant: clear stale `.todo-active`
                // markers on any other rows before tagging the new target.
                mainListDiv.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                    if (el !== target) el.classList.remove('todo-active');
                });
                target.classList.add('todo-active');
                // Focus the row element itself (tabindex="-1"), matching the
                // arrow-nav pattern — the user is in nav mode, not edit mode.
                target.focus();
            }
        }
        e.preventDefault();
    });

    // Global "?" shortcut — open the keyboard shortcuts modal. Same guards as
    // the "n" shortcut: skip while typing in a text-entry surface or while
    // another modal/popover already has the user's attention. Modifier keys
    // are ignored so Shift+/ (which produces "?") still triggers, while the
    // browser's own Cmd-? / Ctrl-? bindings remain untouched.
    document.addEventListener('keydown', function(e) {
        if (e.key !== '?') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const ae = document.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        if (isAnyModalOrPopoverOpen()) return;
        showShortcutsModal();
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

    // Global "\" toggle — flip focus between the projects sidebar and the
    // blank-placeholder new-task input. Three branches:
    //   1. Focus in the sidebar (`#sideMa` or any descendant) → jump to the
    //      placeholder input.
    //   2. Focus in the placeholder input itself (empty `#toDoInput`) → jump
    //      back to the sidebar (selected project, or first project as
    //      fallback).
    //   3. Focus anywhere else → if in any other typing surface (committed
    //      todo title, description input, etc.) bail so `\` types normally;
    //      otherwise default to "go to sidebar" so the shortcut still works
    //      when nothing meaningful has focus yet.
    document.addEventListener('keydown', function(e) {
        if (e.key !== '\\') return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isAnyModalOrPopoverOpen()) return;
        const ae = document.activeElement;
        const sideMa = document.getElementById('sideMa');
        const inSidebar = !!(ae && sideMa && sideMa.contains(ae));
        const inPlaceholder = !!(ae && ae.id === 'toDoInput' && (ae.value || '') === '');

        if (inSidebar) {
            focusBlankToDoInput();
            e.preventDefault();
            return;
        }
        if (inPlaceholder) {
            const target = document.querySelector('#projChild.selectedProject') ||
                           document.querySelector('#projChild');
            if (!target) return;
            target.focus();
            e.preventDefault();
            return;
        }
        // Other typing surfaces — let the keystroke through.
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const target = document.querySelector('#projChild.selectedProject') ||
                       document.querySelector('#projChild');
        if (!target) return;
        target.focus();
        e.preventDefault();
    });

    // Delegated keyboard nav on the projects sidebar — only fires while a
    // project row itself has focus (i.e. the user arrived via `\`). When the
    // focus is inside the row's `#projInput` (rename mode), we skip so the
    // existing input keydown logic owns Enter/Arrow behavior.
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
            const rows = Array.prototype.slice.call(sideMain.querySelectorAll('#projChild'));
            const idx = rows.indexOf(row);
            const next = e.key === 'ArrowDown' ? rows[idx + 1] : rows[idx - 1];
            if (!next) return;
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
            const closeBtn = currentRow.querySelector('#closeButtonToDo');
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
        // tabindex makes the row reachable by the global `\` shortcut and by
        // arrow-key navigation in the sideMa keydown handler.
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
        // tabindex makes the row reachable by the global `\` shortcut and by
        // arrow-key navigation in the sideMa keydown handler.
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