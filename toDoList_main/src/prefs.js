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
export const TASK_SORT_KEY = 'todoapp_taskSort';
export const CHAT_PANE_COLLAPSED_KEY = 'todoapp_chatPaneCollapsed';
export const TODO_MD_SHOW_COMPLETED_KEY = 'todoapp_todoMdShowCompleted';
export const STRUCTURE_LENS_KEY = 'todoapp_structureLens';

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

// ── active top-level view (projects vs. conceive) ──
// The main panel hosts two top-level views: the project view and the
// Conceive incubator. The pill bar in the top nav switches between them;
// this pref restores the active view across reloads. Default is 'projects'
// so first-time users (or anyone whose storage was cleared) land on the
// project list; any stored value other than the known tokens also falls
// back to 'projects' so a stale or hand-edited pref (including a legacy
// 'inbox'/'today' value from the retired Inbox view, or a legacy 'calendar'
// value from the retired Calendar view) can't desync the renderer.
export function getActiveView() {
    try {
        const v = localStorage.getItem(ACTIVE_VIEW_KEY);
        if (v === 'projects') return 'projects';
        if (v === 'conceive') return 'conceive';
        if (v === 'structure') return 'structure';
        return 'projects';
    } catch (e) {
        return 'projects';
    }
}

export function setActiveView(view) {
    try {
        let stored = 'projects';
        if (view === 'conceive') stored = 'conceive';
        else if (view === 'structure') stored = 'structure';
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

// ── task sort order (None / Due date / Status) ──
// The Sort dropdown above the task list reorders visible rows for render only;
// the underlying manual `pos` order is never touched, so selecting 'none'
// restores the user's hand-arranged order intact. The choice is GLOBAL across
// projects (mirroring getTaskFilter/setTaskFilter) and persists so a sorted
// session is restored on reload. 'due' sorts ascending by due date; 'status'
// groups in_progress → active → idea. Any stored value other than the three
// known tokens falls back to 'none' so a stale or hand-edited pref can't
// desync the list.
export function getTaskSort() {
    try {
        const v = localStorage.getItem(TASK_SORT_KEY);
        if (v === 'due' || v === 'status') return v;
        return 'none';
    } catch (e) {
        return 'none';
    }
}

export function setTaskSort(sort) {
    try {
        const stored = (sort === 'due' || sort === 'status') ? sort : 'none';
        localStorage.setItem(TASK_SORT_KEY, stored);
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

// ── desktop chat pane collapsed/expanded ──
// At desktop widths (≥1024px) the persistent chat pane can be collapsed so the
// task pane fills the viewport. Default is expanded (false) so a fresh install
// shows the two-pane layout. The value is purely cosmetic — at mobile widths
// the slide-up sheet ignores it — so a stale or hand-edited value can't break
// anything; any non-'true' value reads as expanded.
export function isChatPaneCollapsed() {
    try {
        return localStorage.getItem(CHAT_PANE_COLLAPSED_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

export function setChatPaneCollapsed(collapsed) {
    try {
        localStorage.setItem(CHAT_PANE_COLLAPSED_KEY, collapsed ? 'true' : 'false');
    } catch (e) { /* ignore quota/private-mode */ }
}

// ── TODO.md viewer: show completed entries ──
// The read-only TODO.md viewer card hides completed (`- [x]`) entries by
// default so the active backlog isn't buried under shipped work; a header
// toggle reveals them. Default is OFF (completed hidden) on first load and
// after a localStorage clear, so only `true` reads as "show completed". This
// is a render-side control only — the file on disk and the pipeline's
// server-side read of it are untouched.
export function isTodoMdShowCompleted() {
    try {
        return localStorage.getItem(TODO_MD_SHOW_COMPLETED_KEY) === 'true';
    } catch (e) {
        return false;
    }
}

export function setTodoMdShowCompleted(show) {
    try {
        localStorage.setItem(TODO_MD_SHOW_COMPLETED_KEY, show ? 'true' : 'false');
    } catch (e) { /* ignore quota/private-mode */ }
}

// ── Structure tab lens (Code vs. UI) ──
// The Structure tab swaps between two renderings of a repo: the Code lens (its
// published source map) and the UI lens (a live map of the running app's
// on-screen regions). The choice persists so the tab reopens on the lens you
// last used. Default is 'ui' — reference-in-chat is the reason to open the tab,
// so the UI lens leads. Any stored value other than the two known tokens falls
// back to 'ui' so a stale or hand-edited pref can't desync the view.
export function getStructureLens() {
    try {
        const v = localStorage.getItem(STRUCTURE_LENS_KEY);
        if (v === 'code') return 'code';
        return 'ui';
    } catch (e) {
        return 'ui';
    }
}

export function setStructureLens(lens) {
    try {
        const stored = lens === 'code' ? 'code' : 'ui';
        localStorage.setItem(STRUCTURE_LENS_KEY, stored);
    } catch (e) { /* ignore quota/private-mode */ }
}

// ── Structure tab open/closed tree state (per repo + lens) ──
// The Structure tab's tree (Code-lens folders, published-map file groups, live-
// map regions) otherwise resets to its default expansion on every reload. We
// remember the set of "exception" node keys per repo + lens so the tree comes
// back the way it was left: open folder paths (Code lens), open region selectors
// (live UI map), or collapsed file names (published UI map — which defaults every
// header to expanded, so the exceptions it records are the collapsed ones). The
// whole thing is one object keyed by `<repo>:<lens>`, LRU-ordered (freshest entry
// last) and capped so it can't grow unbounded as repos and lenses accumulate.
export const STRUCTURE_TREE_KEY = 'todoapp_structureTree';
const STRUCTURE_TREE_MAX_ENTRIES = 24;

function readStructureTreeStore() {
    try {
        const raw = localStorage.getItem(STRUCTURE_TREE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        return {};
    }
}

// The stored array of node keys for repo + lens, or null when none is stored
// (the caller then falls back to that lens's default expansion on first open).
export function getStructureTreeState(repo, lens) {
    if (!repo || !lens) return null;
    const store = readStructureTreeStore();
    const val = store[repo + ':' + lens];
    return Array.isArray(val) ? val.slice() : null;
}

// Persist the array of node keys for repo + lens, re-inserting the entry at the
// tail (most-recently-used) and pruning the oldest entries past the cap.
export function setStructureTreeState(repo, lens, keys) {
    if (!repo || !lens) return;
    try {
        const store = readStructureTreeStore();
        const k = repo + ':' + lens;
        // Delete-then-reassign moves the key to the tail of iteration order, so
        // the freshest entry is last and the oldest sit at the front for pruning.
        delete store[k];
        store[k] = Array.isArray(keys) ? keys.slice() : [];
        const allKeys = Object.keys(store);
        if (allKeys.length > STRUCTURE_TREE_MAX_ENTRIES) {
            allKeys.slice(0, allKeys.length - STRUCTURE_TREE_MAX_ENTRIES)
                .forEach(function (old) { delete store[old]; });
        }
        localStorage.setItem(STRUCTURE_TREE_KEY, JSON.stringify(store));
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
