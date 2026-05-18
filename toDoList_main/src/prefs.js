// Centralised localStorage accessors for user preferences.
//
// All keys live behind the `todoapp_` prefix (see CLAUDE.md "Persistence")
// and every getter/setter wraps the raw localStorage call in try/catch so
// private-browsing or quota-exceeded states don't take down the rest of the
// app — failures degrade silently to the documented default.
//
// Theme persistence stays alongside the theme module; everything else
// (completed section, sidebar width, changelog last-seen) is consolidated
// here so the persisted surface is auditable in one place.

export const COMPLETED_SECTION_KEY = 'todoapp_completedSectionOpen';
export const SIDEBAR_WIDTH_KEY = 'todoapp_sidebarWidth';
export const CHANGELOG_LAST_SEEN_KEY = 'todoapp_changelogLastSeen';
export const LAST_EXPORTED_AT_KEY = 'todoapp_lastExportedAt';
export const SIDEBAR_RAIL_KEY = 'todoapp_sidebarRail';
export const ACTIVE_VIEW_KEY = 'todoapp_active_view';
export const ONBOARDING_COMPLETE_KEY = 'todoapp_onboardingComplete';

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

// ── active top-level view (today vs. projects vs. calendar) ──
// The main panel hosts three top-level views: the Today dashboard, the
// project view, and the Calendar month grid. The pill bar in the top
// nav switches between them; this pref restores the active view across
// reloads. Default is 'projects' so first-time users (or anyone whose
// storage was cleared) land on the project list; any stored value
// other than the three known tokens also falls back to 'projects' so
// a stale or hand-edited pref can't desync the renderer.
export function getActiveView() {
    try {
        const v = localStorage.getItem(ACTIVE_VIEW_KEY);
        if (v === 'projects') return 'projects';
        if (v === 'calendar') return 'calendar';
        if (v === 'today') return 'today';
        return 'projects';
    } catch (e) {
        return 'projects';
    }
}

export function setActiveView(view) {
    try {
        let stored = 'today';
        if (view === 'projects') stored = 'projects';
        else if (view === 'calendar') stored = 'calendar';
        localStorage.setItem(ACTIVE_VIEW_KEY, stored);
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

// ── first-run coachmark tour flag ──
// The spotlight tour runs once on the first load when no projects exist.
// Setting this flag prevents it from auto-running again; the settings menu
// exposes a "Replay welcome tour" entry that clears the flag and restarts
// the tour on demand.
export function isOnboardingComplete() {
    try {
        return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

export function setOnboardingComplete(complete) {
    try {
        if (complete) {
            localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
        } else {
            localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
        }
    } catch (e) { /* ignore quota/private-mode */ }
}
