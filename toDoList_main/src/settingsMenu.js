// Desktop settings-menu (gear dropdown) subsystem, extracted from the
// ~5,900-line component() in main.js following the same closure-to-factory
// pattern as projectPicker.js. createSettingsMenu() receives the gear button
// DOM node component() builds plus the five component()/main.js functions the
// menu calls (injected, never imported back from main.js — that would be
// circular) and returns the menu's public methods { open, close, toggle }.
//
// The menu items delegate to existing modules, so those are imported here
// directly rather than injected: Theme flips through theme.js, the floating
// ghost toggle through companion.js, Help/Export/Import/Configure-inject/
// Sign-out through modals.js / jsonImportExport.js / inject.js / migration.js /
// supabaseClient.js, and the replay-tour entry through coachmark.js +
// welcomeCarousel.js. Only what is built or defined inside main.js's
// component() — the gear button and the five view/render helpers — is injected.
import { listLogic } from './listLogic.js';
import {
    isCompanionEnabled,
    setCompanionEnabled,
    ensureCompanion,
    destroyCompanion,
} from './companion.js';
import {
    applyTheme,
    getCurrentTheme,
    THEME_KEY,
} from './theme.js';
import { showHelpModal } from './modals.js';
import { exportToJson, openImportPicker } from './jsonImportExport.js';
import { startCoachmarkTour } from './coachmark.js';
import { startWelcomeCarousel, isMobileCarouselViewport } from './welcomeCarousel.js';
import { supabase } from './supabaseClient.js';
import { wipeLocalUserDataOnSignOut } from './migration.js';
import { showInjectSettingsModal } from './inject.js';

export function createSettingsMenu(deps) {
    const {
        settingsToggle,
        applyActiveView,
        applyCompanionGhostPreference,
        rebuildAfterImport,
        seedSampleTodosIntoActiveProjectIfEmpty,
        isFocusInTextInput,
    } = deps;

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
        // The handler switches to the Projects view and force-seeds the
        // sample project when the user has none so the tour's callouts
        // always have real targets. Re-seeding is skipped when the user
        // already has projects so a sample can't surprise-appear.
        const replayTourItem = buildSettingsMenuItem(
            'Replay welcome tour',
            '›',
            function() {
                applyActiveView('projects');
                if (listLogic.listProjectsArray().length === 0) {
                    listLogic.seedSampleProject({ force: true });
                    rebuildAfterImport();
                } else {
                    // Active project may hold only the blank placeholder.
                    // The desktop coachmark steps for #duePill and
                    // #descToggle need a real titled row to anchor
                    // against, so seed starter todos into it.
                    seedSampleTodosIntoActiveProjectIfEmpty();
                }
                // rAF defer so the data-view flip and any re-render have
                // a layout pass before the tour reads bounding rects for
                // the spotlight cut-out.
                requestAnimationFrame(function() {
                    if (isMobileCarouselViewport()) startWelcomeCarousel();
                    else startCoachmarkTour();
                });
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

        // DATA section — manual escape hatch. Export downloads the user's
        // entire Supabase dataset as a portable JSON file; Import reads
        // such a file back, shows a destructive confirmation, and replaces
        // the user's data on confirm. Sits between Help and Account so
        // the data-management actions cluster together.
        menu.appendChild(buildSettingsMenuDivider());
        const dataHeading = document.createElement('div');
        dataHeading.className = 'settingsMenuSectionHeading';
        dataHeading.textContent = 'Data';
        dataHeading.setAttribute('role', 'presentation');
        menu.appendChild(dataHeading);

        const exportItem = buildSettingsMenuItem(
            'Export to JSON',
            '',
            function() { exportToJson(); }
        );
        menu.appendChild(exportItem);

        const importItem = buildSettingsMenuItem(
            'Import from JSON',
            '',
            function() { openImportPicker(rebuildAfterImport); }
        );
        menu.appendChild(importItem);

        // Configure inject — opens the per-device Inject settings modal,
        // where the user pastes a Cloudflare Worker URL + shared secret so
        // the "Inject to TODO.md" button on todo description panels has
        // somewhere to send to. Config is per-device, not synced.
        const injectConfigItem = buildSettingsMenuItem(
            'Configure inject',
            '',
            function() { showInjectSettingsModal(); }
        );
        menu.appendChild(injectConfigItem);

        // ACCOUNT section — Phase 4 auth gate's sign-out exit. Mirrors
        // the HELP section pattern: a divider + small heading followed by
        // the row(s). Tap calls supabase.auth.signOut; the app-level
        // onAuthStateChange listener installed in index.js takes care of
        // re-rendering the magic-link modal once the session clears.
        menu.appendChild(buildSettingsMenuDivider());
        const accountHeading = document.createElement('div');
        accountHeading.className = 'settingsMenuSectionHeading';
        accountHeading.textContent = 'Account';
        accountHeading.setAttribute('role', 'presentation');
        menu.appendChild(accountHeading);

        const signOutItem = buildSettingsMenuItem(
            'Sign out',
            '',
            function() {
                hideSettingsMenu();
                wipeLocalUserDataOnSignOut().then(function() { supabase.auth.signOut(); });
            }
        );
        menu.appendChild(signOutItem);

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

    // Presence-check toggle: the gear click handler in main.js routes here
    // so there is one open/close decision, mirroring the inline check the
    // handler used before the extraction.
    function toggleSettingsMenu() {
        if (document.getElementById('settingsMenu')) {
            hideSettingsMenu();
        } else {
            showSettingsMenu();
        }
    }

    return {
        open: showSettingsMenu,
        close: hideSettingsMenu,
        toggle: toggleSettingsMenu,
    };
}
