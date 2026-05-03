// Centralised localStorage accessors for user preferences.
//
// All keys live behind the `todoapp_` prefix (see CLAUDE.md "Persistence")
// and every getter/setter wraps the raw localStorage call in try/catch so
// private-browsing or quota-exceeded states don't take down the rest of the
// app — failures degrade silently to the documented default.
//
// Theme persistence stays alongside the theme module; everything else
// (compact titles, completed section, sidebar width, changelog last-seen)
// is consolidated here so the persisted surface is auditable in one place.

export const COMPACT_TITLES_KEY = 'todoapp_compactTitles';
export const COMPLETED_SECTION_KEY = 'todoapp_completedSectionOpen';
export const SIDEBAR_WIDTH_KEY = 'todoapp_sidebarWidth';
export const CHANGELOG_LAST_SEEN_KEY = 'todoapp_changelogLastSeen';
export const LAST_EXPORTED_AT_KEY = 'todoapp_lastExportedAt';
export const SIDEBAR_RAIL_KEY = 'todoapp_sidebarRail';

// ── compact titles ──
export function isCompactTitlesOn() {
    try {
        return localStorage.getItem(COMPACT_TITLES_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

export function setCompactTitlesOn(on) {
    try {
        localStorage.setItem(COMPACT_TITLES_KEY, on ? 'true' : 'false');
    } catch (e) { /* ignore quota/private-mode */ }
}

// ── completed section open/closed ──
export function isCompletedSectionOpen() {
    try {
        return localStorage.getItem(COMPLETED_SECTION_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

export function setCompletedSectionOpen(open) {
    try {
        localStorage.setItem(COMPLETED_SECTION_KEY, open ? 'true' : 'false');
    } catch (e) { /* ignore quota/private-mode */ }
}

// ── sidebar width ──
// Returns NaN when nothing is stored or the value can't be parsed; callers
// fall back to the responsive CSS default in that case.
export function readSidebarWidthPref() {
    try {
        return parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY), 10);
    } catch (e) {
        return NaN;
    }
}

export function writeSidebarWidthPref(width) {
    try {
        localStorage.setItem(SIDEBAR_WIDTH_KEY, String(width));
    } catch (e) { /* ignore quota/private-mode */ }
}

export function hasSidebarWidthPref() {
    try {
        return localStorage.getItem(SIDEBAR_WIDTH_KEY) !== null;
    } catch (e) {
        return false;
    }
}

// ── sidebar rail vs. full mode ──
// Rail mode (default) renders the projects sidebar as a narrow 54px icon
// rail showing first-letter chips; full mode expands to the named-project
// list. The hamburger inside the rail toggles between the two. Mobile
// keeps the existing drawer behavior regardless of this pref — the rail is
// a desktop-and-up affordance.
export function isSidebarRailOn() {
    try {
        const v = localStorage.getItem(SIDEBAR_RAIL_KEY);
        // Default to rail mode — this is the new baseline UX.
        return v === null ? true : v === 'true';
    } catch (e) {
        return true;
    }
}

export function setSidebarRailOn(on) {
    try {
        localStorage.setItem(SIDEBAR_RAIL_KEY, on ? 'true' : 'false');
    } catch (e) { /* ignore quota/private-mode */ }
}

// ── changelog last-seen marker ──
export function readChangelogLastSeen() {
    try {
        return localStorage.getItem(CHANGELOG_LAST_SEEN_KEY);
    } catch (e) {
        return null;
    }
}

export function writeChangelogLastSeen(dateStr) {
    try {
        localStorage.setItem(CHANGELOG_LAST_SEEN_KEY, dateStr);
    } catch (e) {
        // localStorage can throw in private-browsing or quota-exceeded states;
        // the dot re-appears next load, which is acceptable.
    }
}

// ── last-exported-at marker (manual JSON export) ──
// Drives the stale-export footer hint — when this is null or older than
// the threshold defined in exportImport.js, the hint surfaces. Updated by
// exportImport.js after every successful export.
export function readLastExportedAt() {
    try {
        return localStorage.getItem(LAST_EXPORTED_AT_KEY);
    } catch (e) {
        return null;
    }
}

export function writeLastExportedAt(isoString) {
    try {
        localStorage.setItem(LAST_EXPORTED_AT_KEY, isoString);
    } catch (e) { /* ignore quota/private-mode */ }
}
