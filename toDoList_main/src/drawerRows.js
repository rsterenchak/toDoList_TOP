// Drawer-row factories and the mobile Settings modal's per-setting toggle
// builders, extracted verbatim from main.js. Behaviour-preserving move: the
// function bodies are unchanged from their former home in main.js. The only
// wiring difference is that the module-level state helpers these builders read
// (prefs, theme, and companion state) are imported here directly, and
// buildCompanionToggle takes applyCompanionGhostPreference as a parameter
// because that helper is local to main.js and cannot be imported here.
import { isCompletedSectionOpen, setCompletedSectionOpen } from './prefs.js';
import { applyTheme, getCurrentTheme, THEME_KEY } from './theme.js';
import {
    isCompanionEnabled,
    setCompanionEnabled,
    ensureCompanion,
    destroyCompanion,
} from './companion.js';

export function createDrawerToggleRow(labelText, getState, onToggle) {
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
export function createDrawerInfoRow(labelText, valueGetter) {
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

// Drawer-styled row that triggers a one-shot flow instead of toggling
// a setting. Same 44px tap target and label typography as
// createDrawerToggleRow, but the right-aligned slot holds a static
// chevron glyph instead of an ON/OFF pill — the chevron tells the
// user "tap me to go somewhere" while the pill says "tap me to flip".
export function createDrawerActionRow(labelText, onActivate) {
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
export function buildShowCompletedToggle() {
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

// Dark theme — mirrors the settings-menu Theme item. Same
// theme-transitioning class + applyTheme + localStorage write so the
// 220ms cross-fade is identical to the menu path.
export function buildDarkThemeToggle() {
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
// applyCompanionGhostPreference is main.js-local (it mirrors the enabled
// flag onto the body class for the mobile empty-state spacers), so it is
// passed in rather than imported.
export function buildCompanionToggle(applyCompanionGhostPreference) {
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
