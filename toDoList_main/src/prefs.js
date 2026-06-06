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
export const ACTIVE_VIEW_KEY = 'todoapp_active_view';
export const ONBOARDING_COMPLETE_KEY = 'todoapp_onboardingComplete';
export const SAMPLE_SEEDED_KEY = 'todoapp_sampleSeeded';
export const MUSIC_VISUALIZER_ENABLED_KEY = 'todoapp_musicVisualizerEnabled';
export const MUSIC_VISUALIZER_STYLE_KEY = 'todoapp_musicVisualizerStyle';
export const TASK_FILTER_KEY = 'todoapp_taskFilter';

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

// ── active top-level view (inbox vs. projects vs. calendar) ──
// The main panel hosts three top-level views: the Inbox view, the
// project view, and the Calendar month grid. The pill bar in the top
// nav switches between them; this pref restores the active view across
// reloads. Default is 'projects' so first-time users (or anyone whose
// storage was cleared) land on the project list; any stored value
// other than the three known tokens also falls back to 'projects' so
// a stale or hand-edited pref can't desync the renderer. A legacy
// stored value of 'today' (from before the Inbox rename) migrates to
// 'inbox' on read so existing users don't see undefined behavior.
export function getActiveView() {
    try {
        const v = localStorage.getItem(ACTIVE_VIEW_KEY);
        if (v === 'projects') return 'projects';
        if (v === 'calendar') return 'calendar';
        if (v === 'inbox' || v === 'today') return 'inbox';
        return 'projects';
    } catch (e) {
        return 'projects';
    }
}

export function setActiveView(view) {
    try {
        let stored = 'projects';
        if (view === 'inbox') stored = 'inbox';
        else if (view === 'calendar') stored = 'calendar';
        localStorage.setItem(ACTIVE_VIEW_KEY, stored);
    } catch (e) { /* ignore quota/private-mode */ }
}

// ── task status filter (ALL / Active / Ideas) ──
// The pill row above the task list filters visible rows by their workflow
// status. 'all' shows everything, 'active' shows active + in_progress work,
// 'ideas' shows idea-status rows. The choice persists so a filtered session
// is restored on reload; any stored value other than the three known tokens
// falls back to 'all' so a stale or hand-edited pref can't desync the list.
export function getTaskFilter() {
    try {
        const v = localStorage.getItem(TASK_FILTER_KEY);
        if (v === 'active' || v === 'ideas') return v;
        return 'all';
    } catch (e) {
        return 'all';
    }
}

export function setTaskFilter(filter) {
    try {
        const stored = (filter === 'active' || filter === 'ideas') ? filter : 'all';
        localStorage.setItem(TASK_FILTER_KEY, stored);
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

// ── sample-project seeded flag ──
// Tracks whether the first-run "Getting started" sample project has been
// seeded for this install. Gates the seeding side of the welcome flow so a
// user who deletes the sample project doesn't get it back on the next load;
// the tour's replay path also reads this so a manual replay can't re-seed.
export function isSampleSeeded() {
    try {
        return localStorage.getItem(SAMPLE_SEEDED_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

export function setSampleSeeded(seeded) {
    try {
        if (seeded) {
            localStorage.setItem(SAMPLE_SEEDED_KEY, 'true');
        } else {
            localStorage.removeItem(SAMPLE_SEEDED_KEY);
        }
    } catch (e) { /* ignore quota/private-mode */ }
}

// ── music visualizer (focus-music popover) ──
// The visualizer is a decorative overlay that covers the YouTube iframe
// footprint inside the music popover. Useful when YouTube video is
// blocked (corporate networks) and the embed renders as an inert black
// rectangle. Defaults are intentionally conservative: disabled by default
// so first-time users keep the existing iframe-only behavior, with
// "starfield" pre-selected when they do enable it.
const VALID_VISUALIZER_STYLES = ['starfield', 'blobs', 'rings', 'bars', 'ghost'];

export function isMusicVisualizerEnabled() {
    try {
        return localStorage.getItem(MUSIC_VISUALIZER_ENABLED_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

export function setMusicVisualizerEnabled(enabled) {
    try {
        localStorage.setItem(MUSIC_VISUALIZER_ENABLED_KEY, enabled ? 'true' : 'false');
    } catch (e) { /* ignore quota/private-mode */ }
}

export function getMusicVisualizerStyle() {
    try {
        const v = localStorage.getItem(MUSIC_VISUALIZER_STYLE_KEY);
        if (VALID_VISUALIZER_STYLES.indexOf(v) !== -1) return v;
        return 'starfield';
    } catch (e) {
        return 'starfield';
    }
}

export function setMusicVisualizerStyle(style) {
    try {
        const stored = VALID_VISUALIZER_STYLES.indexOf(style) !== -1 ? style : 'starfield';
        localStorage.setItem(MUSIC_VISUALIZER_STYLE_KEY, stored);
    } catch (e) { /* ignore quota/private-mode */ }
}
