import './style.css';
import { toDo } from './toDo.js';
import { isSampleSeeded, setSampleSeeded } from './prefs.js';
import { supabase } from './supabaseClient.js';


// ── UUID HELPER ──────────────────────────────────────────────────────
// Crypto.randomUUID is available on every browser since 2021 and inside
// jsdom (which the test suite runs under). Fall back to null so a
// missing crypto in a stripped-down runtime doesn't crash the IIFE —
// the persistence layer treats a null id as "needs server-assigned id".
function genId() {
    if (typeof globalThis !== 'undefined'
        && globalThis.crypto
        && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return null;
}


// ── DATE FORMAT CONVERSION ───────────────────────────────────────────
// The in-memory shape stores due dates as "M-D-YYYY" strings to match
// what the renderer expects. Supabase stores them as ISO YYYY-MM-DD
// dates. Conversion happens at the persistence boundary so neither
// the renderer nor the Supabase calls need to know about both formats.
export function dueStringToISO(due) {
    if (!due || typeof due !== 'string') return null;
    if (due === '' || due === '--' || due === 'X-X-XXXX') return null;
    const parts = due.split('-');
    if (parts.length !== 3) return null;
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
    const mm = m < 10 ? '0' + m : '' + m;
    const dd = d < 10 ? '0' + d : '' + d;
    return y + '-' + mm + '-' + dd;
}

export function isoToDueString(iso) {
    if (!iso || typeof iso !== 'string') return '';
    const parts = iso.split('-');
    if (parts.length !== 3) return '';
    const y = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    const d = parseInt(parts[2], 10);
    if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
    return m + '-' + d + '-' + y;
}


// ── PERSISTENCE-PAYLOAD BUILDERS ─────────────────────────────────────
// Build the exact row shape Supabase expects, with explicit field
// mapping from the in-memory shorthand (`tit`/`desc`/`due`/`pri`/`pos`)
// to the column names declared in the Phase 2 schema
// (`title`/`description`/`due_date`/`priority`/`position`). Centralised
// so a future schema column gets added in one place and so no call site
// can slip back to an `Object.assign({}, item, …)` shortcut that would
// silently smuggle the in-memory field names into the network payload
// and have Supabase drop them.
function toTodoRowPayload(item, projectId) {
    return {
        id: item.id,
        project_id: projectId,
        title: item.tit,
        description: item.desc || null,
        due_date: dueStringToISO(item.due),
        priority: item.pri == null ? null : String(item.pri),
        position: item.pos,
        completed: !!item.completed,
        status: normalizeTodoStatus(item.status),
        recurrence: item.recurrence || null,
        // The injected-entry marker id, synced so a task's shipped-run dot reads
        // identically across devices (the shared TODO.md checkbox is the truth).
        // Nullable; the write path only forwards it when set, so the sync
        // degrades to current local behavior when the column is absent.
        entry_id: item.entryId || null,
        // Acknowledgement timestamp for a shipped entry — drives the derived
        // REVIEW badge (unset = unacknowledged). Synced so an acknowledgement on
        // one device clears the badge everywhere. Nullable; forwarded only when
        // set (see persistMutation) so a pre-migration server degrades cleanly.
        entry_reviewed_at: item.entryReviewedAt || null,
    };
}

// Allowed values for a todo's workflow `status`, mirroring the CHECK
// constraint on the Supabase `todos.status` column. 'active' is the
// default for new todos and the fallback for any legacy/corrupt value.
const TODO_STATUSES = ['active', 'in_progress', 'idea'];

// Coerce an arbitrary status value to a known one. Missing, non-string,
// or out-of-vocabulary values normalise to 'active' so cached data that
// predates the field — and any future-unknown value — stays usable.
function normalizeTodoStatus(value) {
    return TODO_STATUSES.indexOf(value) === -1 ? 'active' : value;
}

function toProjectRowPayload(entry, name, position) {
    return {
        id: entry.id,
        name: name,
        color: entry.color || null,
        position: position,
        target_id: entry.target_id || null,
        stages: entry.stages || null,
        lifecycle: entry.lifecycle || DEFAULT_LIFECYCLE,
        hide_dates: !!entry.hideDates,
    };
}


// Recurrence vocabulary used by `sanitizeRecurrence`. Declared above the
// `listLogic` IIFE because the IIFE's storage-restore pass calls
// sanitizeRecurrence on every loaded item — Babel transpiles the original
// `const` to `var`, which hoists the binding but not the value, so leaving
// these next to nextDueDate() (further down the file) makes them read as
// `undefined` during the IIFE's evaluation and crashes with
// "Cannot read properties of undefined (reading 'indexOf')".
const RECURRENCE_PATTERNS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'];
const RECURRENCE_UNITS    = ['day', 'week', 'month', 'year'];

// Used by summarizeRecurringMissPattern. Hoisted above the IIFE for the
// same Babel-transpilation reason as RECURRENCE_PATTERNS above — the
// helper inside the closure reaches for these constants at runtime, and
// declaring them next to the pure helpers (further down the file) would
// leave the binding undefined during the IIFE's evaluation pass.
const WEEKDAY_NAMES = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday',
    'Thursday', 'Friday', 'Saturday'
];
const MISS_MONTH_SHORT = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];


// ── PER-PROJECT LIFECYCLE STAGES ─────────────────────────────────────
// Each project carries an ordered `stages` list (the Conceive view's
// lifecycle surface) plus a `lifecycle` shape label. Two shapes exist:
// Iterative and Spec. The Iterative shape is a direction board — a one-line
// North star plus three lanes (Now / Next / Later); the Spec shape is the
// classic SDLC set (Why / Concept / Requirements / Design / Build plan). New
// projects seed the Iterative board shape — most personal apps are built
// iteratively — while Spec stays available for the shape chooser. Legacy
// projects persisted under the old 'SDLC' label are treated as Spec-shaped;
// legacy Iterative projects persisted with the old Why / Concept / Next up /
// Iterations stages keep those stages (they are never reseeded) and the
// Conceive view falls back to the stage renderer for them.
// Declared above the `listLogic` IIFE for the same Babel-transpilation
// reason as RECURRENCE_PATTERNS — the IIFE's load-time migrate pass
// calls seedStages() on any project missing its stage list.
const BOARD_STAGE_LABELS = ['North star', 'Now', 'Next', 'Later'];
const SPEC_STAGE_LABELS = ['Why', 'Concept', 'Requirements', 'Design', 'Build plan'];
const LIFECYCLE_ITERATIVE = 'iterative';
const LIFECYCLE_SPEC = 'spec';
const DEFAULT_LIFECYCLE = LIFECYCLE_ITERATIVE;

// Pick the ordered stage labels for a lifecycle shape. Spec — and its legacy
// 'SDLC' alias persisted before shapes existed — seeds the five-stage SDLC
// set; everything else, including 'iterative' and any unset/unknown value,
// seeds the Iterative board set, matching the default new-project shape.
function stageLabelsForLifecycle(lifecycle) {
    return (lifecycle === LIFECYCLE_SPEC || lifecycle === 'SDLC')
        ? SPEC_STAGE_LABELS
        : BOARD_STAGE_LABELS;
}

// Build the ordered stage list for a shape, each stage seeded with an empty
// body and a fresh id. The ordered array serializes directly into the existing
// allProjects localStorage blob (no separate key). Defaults to the Iterative
// shape when no lifecycle is supplied.
function seedStages(lifecycle) {
    return stageLabelsForLifecycle(lifecycle).map(function(label) {
        return { id: genId(), label: label, body: '' };
    });
}

// Coerce an arbitrary stages value into a clean ordered list. Used on the
// untrusted import path (replaceAllProjects) and the Supabase adopt path: a
// missing or empty list re-seeds the shape's default set (Iterative unless the
// project's lifecycle is Spec); otherwise existing ids are preserved (so stage
// targeting round-trips) and label/body are forced to strings.
function normalizeStages(stages, lifecycle) {
    if (!Array.isArray(stages) || stages.length === 0) return seedStages(lifecycle);
    return stages.map(function(s) {
        if (!s || typeof s !== 'object') {
            return { id: genId(), label: '', body: '' };
        }
        return {
            id: (typeof s.id === 'string' && s.id.length > 0) ? s.id : genId(),
            label: typeof s.label === 'string' ? s.label : '',
            body: typeof s.body === 'string' ? s.body : '',
        };
    });
}

// Map a project row's (or local entry's) stored stages/lifecycle onto an
// in-memory entry, backfilling the default SDLC set when the value is
// missing or empty — a Supabase row predating the `stages` column returns
// null, and a fresh-local project predates nothing. normalizeStages already
// re-seeds on a missing/empty list, so the null→SDLC backfill lives in ONE
// place (the seed array is never duplicated). Shared by the Supabase hydrate
// adopt branch and the realtime apply so server-null and fresh-local seed
// identically, the same way the load-time backfill seeds.
function stagesFromRow(row) {
    return normalizeStages(row && row.stages, lifecycleFromRow(row));
}
function lifecycleFromRow(row) {
    return (row && typeof row.lifecycle === 'string' && row.lifecycle.length > 0)
        ? row.lifecycle
        : DEFAULT_LIFECYCLE;
}


// ── CONCEIVE SHIPPED LOG ─────────────────────────────────────────────
// The Now / Next / Later board carries a fifth, auto-managed "Shipped" stage
// that records every app-initiated run against the project — no manual
// journaling. The stage is NOT part of the seeded board set (BOARD_STAGE_LABELS
// above): it is created lazily on the first append (appendConceiveLogEntry) so
// board projects that predate this feature gain it for free. Its body is a
// JSON-serialized array of run log records `{ id, title, verdict, summary,
// date }`, newest-first, deduped by `id` (the run's entry marker). Storing the
// log inside the existing `stages` array means it syncs across devices via the
// same per-row persistence path stage edits already use — no new column, no new
// sync path, no toProjectRowPayload field.
const SHIPPED_STAGE_LABEL = 'Shipped';

// Parse a Shipped stage body into an array of log records. Fails safe to an
// empty array on a missing/blank body or ANY JSON parse error — it never
// throws, so a corrupted body surfaces as an empty log rather than crashing the
// board renderer.
function parseShippedLog(body) {
    if (typeof body !== 'string' || !body.trim()) return [];
    try {
        const parsed = JSON.parse(body);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

// Whether a project's stage list is the Now / Next / Later board shape — its
// lanes include a "Now". The Shipped log is only kept for board-shape projects
// (the same gate the Conceive view uses to pick the board renderer).
function stagesAreBoard(stages) {
    return Array.isArray(stages) && stages.some(function(s) {
        return s && s.label === 'Now';
    });
}

// The legacy Iterative stage that predates the Now / Next / Later board. Its
// presence (with no 'Now') is the signature of a pre-board Iterative project.
const LEGACY_ITERATIVE_MARKER = 'Next up';

// Whether a project qualifies for the one-time legacy-Iterative → board reseed
// run by the load-time migrate pass. All three must hold: the shape is
// Iterative (or unset/defaulted to it — never Spec/SDLC), the stages carry the
// legacy 'Next up' marker and NOT already 'Now' (so board projects are skipped),
// and the project is pristine — every stage body empty after trimming. The
// auto-managed Shipped stage is excluded from the emptiness check, so a
// populated Shipped log never blocks the migration. Pristine by construction means swapping the labels strands no user
// content, so the reseed is lossless.
function isLegacyIterativePristine(entry) {
    if (!entry || typeof entry !== 'object') return false;
    const lifecycle = (typeof entry.lifecycle === 'string' && entry.lifecycle.length > 0)
        ? entry.lifecycle
        : DEFAULT_LIFECYCLE;
    if (lifecycle !== LIFECYCLE_ITERATIVE) return false;
    const stages = entry.stages;
    if (!Array.isArray(stages) || stages.length === 0) return false;
    if (stagesAreBoard(stages)) return false;
    const hasLegacyMarker = stages.some(function(s) {
        return s && s.label === LEGACY_ITERATIVE_MARKER;
    });
    if (!hasLegacyMarker) return false;
    return stages
        .filter(function(s) { return s && s.label !== SHIPPED_STAGE_LABEL; })
        .every(function(s) { return !(s && s.body && s.body.trim()); });
}


// ORIGINAL FUNCTION CALL,
export const listLogic = (function () {
    

    // localStorage.clear(); // using only for testing


    // INITIAL: toDo item variables
    let itemTitle = '';
    let itemDesc = '';
    let itemDue = '';
    let itemPri = 1;

    // INITIAL: define allProjects object that dynamically stores per-project
    // entries as `{ items: [todos], color: null|string }` under each project
    // name. The `items` array is the todo list for the project; `color` is
    // the optional per-project accent key (one of six curated slots) or null
    // when the project uses the theme accent.
    const allProjects = {};

    // Keys for the 6 curated per-project accent swatches. `null` is the reset
    // slot and maps back to var(--accent) at render time.
    const PROJECT_COLOR_KEYS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'];


    // ********************* STORAGE HANDLING ********************* //

    // HELPER: persist current state of allProjects to localStorage. This is
    // the single funnel every mutation routes through — adds, removes,
    // edits, completion toggles, reorders, recurrence config, project
    // colors, sort fixups, and the bulk replace path.
    //
    // Accepts an unused `opts` so the sync-safe and defensive-normalize
    // callers can keep their `saveToStorage(opts)` forwarding shape (the
    // saveToStorageCallers lint contract). The fromSync flag is interpreted
    // by callers' persistMutation gates, not here.
    function saveToStorage(_opts) {
        localStorage.setItem('allProjects', JSON.stringify(allProjects));
        if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
            try {
                document.dispatchEvent(new CustomEvent('dataChanged'));
            } catch (e) { /* CustomEvent unsupported — listeners refresh on next mutation */ }
        }
    }

    // INIT: restore any previously saved projects from localStorage
    const stored_raw = localStorage.getItem('allProjects');

    if (stored_raw) {

        const stored_deserialized = JSON.parse(stored_raw);
        const savedKeys = Object.keys(stored_deserialized);

        if (savedKeys.length > 0) {
            console.log("Restoring projects from localStorage:", savedKeys);
            savedKeys.forEach(function(key) {
                allProjects[key] = stored_deserialized[key];
            });
        } else {
            console.log("localStorage found but empty.");
        }

    } else {

        console.log("No localStorage entry — fresh start.");
        saveToStorage();

    }

    // Migrate + sanitize loaded data:
    // - Legacy shape was `allProjects[name] = [todos]`; new shape is
    //   `allProjects[name] = { items: [todos], color: null|string }`. Wrap
    //   arrays in place so the rest of the module can assume the new shape.
    // - Fix any bad date values (NaN, empty, malformed) and backfill
    //   `completed` for items saved before the check-off feature existed.
    // - Backfill `color` with null on any project missing it; clamp unknown
    //   color keys to null so a corrupt or renamed palette can't leak
    //   undefined CSS values into the renderer.
    // Drop any orphaned empty-key project entries from storage. These can
    // exist on installs that hit the pre-fix empty-rename bug, where an
    // empty title was briefly committed as a real key and stranded the
    // project's todos there.
    Object.keys(allProjects).forEach(function(key) {
        if (typeof key !== 'string' || key.trim().length === 0) {
            delete allProjects[key];
        }
    });

    Object.keys(allProjects).forEach(function(key) {
        const entry = allProjects[key];
        if (Array.isArray(entry)) {
            allProjects[key] = { id: genId(), items: entry, color: null, sortByDue: false, hideDates: false, target_id: null, stages: seedStages(), lifecycle: DEFAULT_LIFECYCLE };
        } else if (!entry || typeof entry !== 'object') {
            allProjects[key] = { id: genId(), items: [], color: null, sortByDue: false, hideDates: false, target_id: null, stages: seedStages(), lifecycle: DEFAULT_LIFECYCLE };
        } else {
            if (!Array.isArray(entry.items)) entry.items = [];
            // Backfill the lifecycle shape + stages on projects saved before
            // the Conceive-per-project feature existed; any project missing a
            // valid stage list gets the default set for its shape (Iterative
            // unless it already records the Spec/SDLC shape), the same way
            // color / sortByDue are backfilled below. The shape is set first so
            // the seeded stages match it.
            if (typeof entry.lifecycle !== 'string' || entry.lifecycle.length === 0) {
                entry.lifecycle = DEFAULT_LIFECYCLE;
            }
            if (!Array.isArray(entry.stages) || entry.stages.length === 0) {
                entry.stages = seedStages(entry.lifecycle);
            }
            // One-time lossless reseed of pristine legacy-Iterative projects to
            // the Now / Next / Later board. Projects created before the board
            // shipped keep their old Why / Concept / Next up / Iterations stages
            // and never gained the board, so Conceive falls back to the stage
            // renderer and the shape chooser can't fix them (they already read as
            // Iterative). When such a project has no user content to lose, swap
            // its stages for the board seed. Persist through the same
            // saveToStorage + persistMutation route setProjectShape uses so the
            // reseed saves locally and mirrors to Supabase (bumping updated_at).
            // Idempotent: after the reseed the stages include 'Now' and drop
            // 'Next up', so this can't fire again on a later load or another
            // device.
            if (isLegacyIterativePristine(entry)) {
                entry.stages = seedStages(LIFECYCLE_ITERATIVE);
                saveToStorage();
                if (entry.id) {
                    persistMutation({
                        op: 'update',
                        table: 'projects',
                        payload: toProjectRowPayload(
                            entry,
                            key,
                            Object.keys(allProjects).indexOf(key)
                        ),
                    });
                }
            }
            if (typeof entry.color !== 'string' && entry.color !== null) entry.color = null;
            if (typeof entry.color === 'string' && PROJECT_COLOR_KEYS.indexOf(entry.color) === -1) {
                entry.color = null;
            }
            if (typeof entry.sortByDue !== 'boolean') entry.sortByDue = false;
            // Per-project display preference hiding due-date pills; legacy
            // installs predate it and default to off (dates shown).
            if (typeof entry.hideDates !== 'boolean') entry.hideDates = false;
            // Default to null when the field is absent; legacy installs predate
            // the inject-routing feature and have no per-project target.
            if (typeof entry.target_id !== 'string') entry.target_id = null;
            // Backfill the persistence-layer id on legacy projects so
            // every entry in the in-memory map has a stable identifier
            // for Supabase round-trips.
            if (typeof entry.id !== 'string' || entry.id.length === 0) {
                entry.id = genId();
            }
        }
        allProjects[key].items.forEach(function(item) {
            if (typeof item.completed !== 'boolean') {
                item.completed = false;
            }
            // Backfill the workflow status on todos cached before the field
            // existed. Anything missing or out-of-vocabulary becomes
            // 'active' so old caches survive forward-compatibly.
            item.status = normalizeTodoStatus(item.status);
            // Clean up the recurrence field on load: anything non-object
            // becomes null (one-off task), and a partial object is forced
            // through sanitizeRecurrence so downstream code can trust it.
            if (item.recurrence === undefined) {
                item.recurrence = null;
            } else if (item.recurrence !== null) {
                item.recurrence = sanitizeRecurrence(item.recurrence);
            }
            // Backfill the persistence-layer id on legacy todos so
            // every item in the in-memory tree has a stable identifier
            // for Supabase round-trips.
            if (typeof item.id !== 'string' || item.id.length === 0) {
                item.id = genId();
            }
            if (!item.due || item.due === "" || item.due === "--" || item.due === "X-X-XXXX") return;
            const parts = item.due.split('-');
            const m = parseInt(parts[0], 10);
            const d = parseInt(parts[1], 10);
            const y = parseInt(parts[2], 10);
            // if any part is NaN, clear the due date
            if (isNaN(m) || isNaN(d) || isNaN(y)) {
                item.due = "";
            }
        });
    });

    // Group completed items beneath uncompleted ones in every project so
    // restored state mirrors the same order the UI maintains during use.
    Object.keys(allProjects).forEach(function(key) {
        sortCompletedInPlace(allProjects[key].items);
    });

    // ************************************************************* //


    let allProjectsTotal = Object.keys(allProjects).length; 

    function listProjects(){
        console.log(Object.keys(allProjects));
    }

    function listProjectsArray(){
        let projectsArray = Object.keys(allProjects);
        return projectsArray;
    }

    // @category: user-mutation-only
    function addProject(projectName){

        let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri);

        projectName = (projectName || '').trim();

        // Empty names break lookup-by-name everywhere downstream; reject
        // here so no UI path can corrupt storage with a '' key.
        if (projectName.length === 0) {
            return { array: [], string: '' };
        }

        const projectId = genId();
        allProjects[projectName] = { id: projectId, items: [listItem], color: null, sortByDue: false, hideDates: false, target_id: null, stages: seedStages(), lifecycle: DEFAULT_LIFECYCLE };

        allProjectsTotal = Object.keys(allProjects).length;

        saveToStorage();
        persistMutation({
            op: 'insert',
            table: 'projects',
            payload: toProjectRowPayload(
                allProjects[projectName],
                projectName,
                allProjectsTotal - 1
            ),
        });

        return {
            array: allProjects[projectName].items,
            string: projectName
        };
    }

    // @category: user-mutation-only
    function removeProject(projectName){

        let before = Object.keys(allProjects).length;
        let projectDes = projectName;
        const doomed = allProjects[projectDes];

        delete allProjects[projectDes];

        let after = Object.keys(allProjects).length;

        if(after < before){
            console.log(projectDes + " was removed");
        } else {
            console.log(projectDes + " was not removed");
        }

        saveToStorage();
        if (doomed && doomed.id) {
            persistMutation({
                op: 'delete',
                table: 'projects',
                payload: { id: doomed.id },
            });
        }
    }


    // FUNCTION (ADD TODO LIST ITEMS)
    // Skips if a blank placeholder already exists (invariant: one blank per project).
    // @category: user-mutation-only
    function addToDo(projectName, toDoName) {

        let projectDes = projectName;
        let itemTitle  = toDoName;
        let itemDesc   = '';
        let itemDue    = '';
        let itemPri    = 1;
        let itemPos    = 0;

        if (!allProjects[projectDes]) {
            console.error("addToDo: project not found —", projectDes);
            return { array: [], string: projectName, lengths: 0 };
        }

        const arr = allProjects[projectDes].items;

        // Skip duplicate blank placeholders — exactly one is pinned at the top of each list.
        if (itemTitle === '' && arr.some(function(i) { return i.tit === ''; })) {
            return {
                array: arr,
                string: projectName,
                lengths: arr.length
            };
        }

        let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri, itemPos);
        listItem.id = crypto.randomUUID();   // ADD THIS LINE
        arr.push(listItem);



        saveToStorage();
        if (listItem.tit !== '') {
            persistMutation({
                op: 'insert',
                table: 'todos',
                payload: toTodoRowPayload(
                    listItem,
                    allProjects[projectDes].id || null
                ),
            });
        }
        // Re-pin the blank placeholder to index 0.
        sortCompletedInPlace(arr);
        
        return {
            array: arr,
            string: projectName,
            lengths: arr.length
        };
    };


    // FUNCTION (REMOVE TODO LIST ITEMS)
    // Maintains the invariant that a blank placeholder is pinned at index 0.
    // @category: user-mutation-only
    function removeToDo(project, index, length) {

        if (!allProjects[project]) return;

        const arr = allProjects[project].items;
        index = parseInt(index, 10);

        let removed = null;
        if (index >= 0 && index < arr.length) {
            removed = arr[index];
            arr.splice(index, 1);
        }

        sortCompletedInPlace(arr);

        saveToStorage();
        if (removed && removed.id && removed.tit !== '') {
            persistMutation({
                op: 'delete',
                table: 'todos',
                payload: { id: removed.id },
            });
        }
    };


    // Remove a todo item by object-reference — title-based lookup is unsafe
    // because the data model permits duplicate titles (a new row committed
    // while a completed row with the same title still exists), which would
    // otherwise delete the wrong row. A stale/empty input value also can't
    // misfire and accidentally splice the blank placeholder.
    // Maintains the invariant that a blank placeholder is pinned at index 0.
    // @category: user-mutation-only
    function removeToDoByItem(project, item) {

        if (!allProjects[project]) return;

        const arr = allProjects[project].items;
        const idx = arr.indexOf(item);

        if (idx === -1) {
            console.warn("removeToDoByItem: item not found in project —", project);
            return;
        }

        arr.splice(idx, 1);

        sortCompletedInPlace(arr);

        saveToStorage();
        if (item && item.id && item.tit !== '') {
            persistMutation({
                op: 'delete',
                table: 'todos',
                payload: { id: item.id },
            });
        }
    };


    // Re-insert a previously-removed todo item at a specific position in the
    // project's items array. Backs the mobile swipe-delete "undo" path: the
    // caller captures the array index before splicing the item out so this
    // function can restore the item to the same slot. sortCompletedInPlace
    // still runs afterward, so the final landing slot may shift if the item
    // is completed (re-partitioned to the bottom) or the requested index
    // collides with the pinned blank placeholder at index 0 — both are
    // expected outcomes that preserve the model invariants.
    // @category: user-mutation-only
    function insertToDoAt(project, item, index) {

        if (!allProjects[project] || !item) return;

        const arr = allProjects[project].items;
        // Reject duplicate re-inserts — the caller is expected to call this
        // exactly once per remove, so a duplicate here usually signals a
        // racing event (e.g. two UNDO taps) and would corrupt the array.
        if (arr.indexOf(item) !== -1) return;

        const clamped = Math.min(Math.max(parseInt(index, 10) || 0, 0), arr.length);
        arr.splice(clamped, 0, item);

        sortCompletedInPlace(arr);

        saveToStorage();
        if (item && item.tit !== '') {
            if (!item.id) item.id = genId();
            persistMutation({
                op: 'insert',
                table: 'todos',
                payload: toTodoRowPayload(
                    item,
                    allProjects[project].id || null
                ),
            });
        }
    };


    // Promote an existing blank-placeholder item to a real Supabase row.
    // The Enter-to-commit handler in toDoRow.js mutates `item.tit` in
    // place on the blank placeholder rather than re-routing through
    // `addToDo`, so the placeholder — filtered from every prior write
    // because its title was empty — has never been INSERTed. Without
    // this call, the row only lives in localStorage and the followup
    // `sortCompletedToBottom` fires UPDATEs against an id Supabase has
    // never seen (silently 204s), so the row never lands in the
    // backend. The caller has already done the in-memory mutation and
    // the localStorage save; this function only handles the missing
    // INSERT. Defensive on an empty title so a future caller can't
    // smuggle a blank row past the persistence boundary.
    // @category: user-mutation-only
    function commitBlankPlaceholder(projectName, item) {

        if (!projectName || !allProjects[projectName] || !item) return;
        if (!item.tit || item.tit === '') return;

        if (!item.id) item.id = genId();
        persistMutation({
            op: 'insert',
            table: 'todos',
            payload: toTodoRowPayload(
                item,
                allProjects[projectName].id || null
            ),
        });
    }


    // Push an in-place edit of an already-committed todo to Supabase.
    // The Enter-to-commit handler in toDoRow.js is the sole caller and
    // routes here when the row being committed is NOT a blank
    // placeholder being promoted for the first time — without this
    // branch, the handler fired `commitBlankPlaceholder` on every
    // Enter, which re-INSERTed an already-existing row and tripped
    // Supabase's unique-constraint check on todos_pkey with a 409 and
    // PostgreSQL code 23505. Caller has already mutated `item` (title
    // and friends) in place and called `saveToStorage()`; this
    // function only handles the matching Supabase UPDATE. Gates on
    // `item.id` (the row must already exist in the backend) and on a
    // non-empty title (blank placeholders never reach Supabase),
    // mirroring the guards in commitBlankPlaceholder so the two
    // functions form a complete cover of the commit-vs-edit branches.
    // @category: user-mutation-only
    function editToDoItem(projectName, item) {

        if (!projectName || !allProjects[projectName] || !item) return;
        if (!item.id) return;
        if (!item.tit || item.tit === '') return;

        persistMutation({
            op: 'update',
            table: 'todos',
            payload: toTodoRowPayload(
                item,
                allProjects[projectName].id || null
            ),
        });
    }


    // Flip a committed todo's completed flag and persist the change. The UI
    // layer used to mutate `item.completed` directly and lean on the
    // follow-up `sortCompletedToBottom` to flush the change to storage,
    // but that sort short-circuits when the array order is already
    // canonical (toggling the last uncompleted item, or the first
    // completed item, leaves the partition position-for-position the
    // same). The mutation then stayed in memory only and the next page
    // load — including the swipe-right completion path on mobile —
    // restored the row to its previous state. Routing the toggle through
    // here makes the localStorage write unconditional and mirrors the
    // change to Supabase the same way the title-edit path does.
    // @category: user-mutation-only
    function setToDoCompleted(projectName, item, completed) {

        if (!projectName || !allProjects[projectName] || !item) return;
        const next = !!completed;
        if (item.completed === next) return;

        item.completed = next;
        saveToStorage();

        if (item.id && item.tit && item.tit !== '') {
            persistMutation({
                op: 'update',
                table: 'todos',
                payload: toTodoRowPayload(
                    item,
                    allProjects[projectName].id || null
                ),
            });
        }
    }


    // Set a committed todo's workflow status ('active' | 'in_progress' |
    // 'idea') and persist the change. Mirrors setToDoCompleted: writes
    // localStorage unconditionally and mirrors to Supabase via the same
    // update path. Out-of-vocabulary values are rejected (no-op) so a bad
    // caller can't push an illegal value past the column's CHECK constraint.
    // @category: user-mutation-only
    function setToDoStatus(projectName, item, status) {

        if (!projectName || !allProjects[projectName] || !item) return;
        if (TODO_STATUSES.indexOf(status) === -1) return;
        if (item.status === status) return;

        item.status = status;
        saveToStorage();

        if (item.id && item.tit && item.tit !== '') {
            persistMutation({
                op: 'update',
                table: 'todos',
                payload: toTodoRowPayload(
                    item,
                    allProjects[projectName].id || null
                ),
            });
        }
    }


    // @category: user-mutation-only
    function editProject(currentProperty, newProperty) {

        // Reject empty/whitespace renames — a '' key collides with the
        // blank-placeholder semantics in todos and breaks every name-keyed
        // lookup in the UI (selection, render, color, length).
        const trimmed = (newProperty || '').trim();
        if (trimmed.length === 0) {
            return {
                array: allProjects[currentProperty] ? allProjects[currentProperty].items : undefined,
                string: currentProperty
            };
        }

        allProjects[trimmed] = allProjects[currentProperty];
        if (trimmed !== currentProperty) delete allProjects[currentProperty];

        allProjectsTotal = Object.keys(allProjects).length;

        saveToStorage();
        const entry = allProjects[trimmed];
        if (entry && entry.id) {
            persistMutation({
                op: 'update',
                table: 'projects',
                payload: toProjectRowPayload(
                    entry,
                    trimmed,
                    Object.keys(allProjects).indexOf(trimmed)
                ),
            });
        }

        return {
            array: allProjects[trimmed] ? allProjects[trimmed].items : undefined,
            string: trimmed
        };
    };

    function listItems(project){
        const entry = allProjects[project];
        return entry ? entry.items : undefined;
    };

    function projectLength(project){
        if (!project || !allProjects[project]) return 0;
        return allProjects[project].items.length;
    };

    function removeElementAtIndex(arr, index) {
        if (index >= 0 && index < arr.length) {
            arr.splice(index, 1);
            return arr;
        } else {
            console.log("else error: " + index);
            console.error("Index out of bounds");
            return arr;
        }
    }


    // Move a project from one index to another.
    // Object keys preserve insertion order in modern JS, so we rebuild
    // the object in the new order to persist the reorder.
    // @category: user-mutation-only
    function reorderProject(fromIndex, toIndex) {

        const keys = Object.keys(allProjects);
        fromIndex = parseInt(fromIndex, 10);
        toIndex   = parseInt(toIndex, 10);

        if (isNaN(fromIndex) || isNaN(toIndex)) return;
        if (fromIndex < 0 || fromIndex >= keys.length) return;
        if (toIndex   < 0 || toIndex   >= keys.length) return;
        if (fromIndex === toIndex) return;

        const moved = keys.splice(fromIndex, 1)[0];
        keys.splice(toIndex, 0, moved);

        const snapshot = {};
        keys.forEach(function(k) { snapshot[k] = allProjects[k]; });

        Object.keys(allProjects).forEach(function(k) { delete allProjects[k]; });
        keys.forEach(function(k) { allProjects[k] = snapshot[k]; });

        saveToStorage();
        // Push the new ordering up so other devices see the same order.
        // One update per affected project — small N (project count), and
        // a single bulk-update isn't available on a per-row field through
        // the postgrest API without raw SQL.
        keys.forEach(function(k, idx) {
            const entry = allProjects[k];
            if (!entry || !entry.id) return;
            persistMutation({
                op: 'update',
                table: 'projects',
                payload: toProjectRowPayload(entry, k, idx),
            });
        });
    }


    // Move a todo item within its project's array from one index to another.
    // Callers (drag-drop) pass indexes relative to the *non-blank* slice —
    // the blank placeholder pinned at index 0 is filtered out of the drag
    // layer's sibling list, so its indexes never include it. Reorder the
    // non-blank slice, then run sortCompletedInPlace to re-pin the blank at
    // index 0 and partition completed entries to the bottom — the drop may
    // have crossed the uncompleted/completed boundary, and the invariant
    // (completed items always sit beneath uncompleted ones) is enforced
    // here so any future reorder caller benefits.
    // @category: user-mutation-only
    function reorderToDo(project, fromIndex, toIndex) {

        if (!allProjects[project]) return;
        const arr = allProjects[project].items;

        fromIndex = parseInt(fromIndex, 10);
        toIndex   = parseInt(toIndex, 10);

        if (isNaN(fromIndex) || isNaN(toIndex)) return;
        if (fromIndex === toIndex) return;

        const nonBlank = arr.filter(function(i) { return i.tit !== ''; });

        if (fromIndex < 0 || fromIndex >= nonBlank.length) return;
        if (toIndex   < 0 || toIndex   >= nonBlank.length) return;

        const moved = nonBlank.splice(fromIndex, 1)[0];
        nonBlank.splice(toIndex, 0, moved);

        // Preserve the existing blank placeholder object so any in-flight
        // state on it (e.g. date placeholders) survives the rebuild.
        const existingBlank = arr.find(function(i) { return i.tit === ''; });
        arr.length = 0;
        if (existingBlank) arr.push(existingBlank);
        for (let i = 0; i < nonBlank.length; i++) arr.push(nonBlank[i]);

        sortCompletedInPlace(arr);

        saveToStorage();
        // Mirror the new pos values to Supabase so other devices see
        // the same order. Skip the blank placeholder; only real rows
        // exist in the backend.
        const projId = allProjects[project].id || null;
        arr.forEach(function(it, idx) {
            if (!it || it.tit === '' || !it.id) return;
            it.pos = idx;
            persistMutation({
                op: 'update',
                table: 'todos',
                payload: toTodoRowPayload(it, projId),
            });
        });
    }


    // Pin the blank placeholder to index 0, followed by uncompleted items,
    // then completed items at the bottom. The placeholder is the sole entry
    // point for new todos, so it must always be present and always reachable
    // without scrolling past completed work.
    function sortCompletedInPlace(arr) {
        if (!arr) return;

        // Preserve the existing blank object when possible so any in-flight
        // state (e.g. date placeholders) survives the sort.
        let blank = null;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].tit === '') { blank = arr[i]; break; }
        }
        if (!blank) blank = toDo('', '', '', 1, 0);

        const uncompleted = arr.filter(function(i) { return i.tit !== '' && !i.completed; });
        const completed   = arr.filter(function(i) { return i.tit !== '' && !!i.completed; });

        arr.length = 0;
        arr.push(blank);
        for (let i = 0; i < uncompleted.length; i++) arr.push(uncompleted[i]);
        for (let i = 0; i < completed.length; i++)   arr.push(completed[i]);
    }


    // Sort the given project's items so completed entries sit beneath
    // uncompleted ones. Preserves the trailing blank placeholder row.
    //
    // `opts.fromSync: true` flags the sort as reconciliation work the
    // Supabase backend already knows about, so the per-row persistMutation
    // mirror writes are suppressed.
    //
    // `opts.deferSave: true` runs the sort in memory but skips the
    // saveToStorage call entirely. The post-import rebuild path passes
    // this because replaceAllProjects has already sorted and persisted
    // every project just upstream, making the rebuild's per-project
    // re-sort a defensive no-op whose storage write duplicates work
    // that's already on disk.
    //
    // Skips the in-memory rewrite AND the saveToStorage call when the
    // desired order matches the current order position-for-position.
    // Render entry points (project switch, restoreFromStorage) reach
    // this function with data that's already correctly sorted on disk.
    // @category: defensive-normalize
    function sortCompletedToBottom(project, opts) {
        if (!allProjects[project]) return;
        const arr = allProjects[project].items;

        // Compute the would-be sorted order without mutating yet so the
        // noop check below has both sides to compare. Mirrors the partition
        // logic in sortCompletedInPlace.
        let blank = null;
        for (let i = 0; i < arr.length; i++) {
            if (arr[i].tit === '') { blank = arr[i]; break; }
        }
        const blankExisted = !!blank;
        if (!blank) blank = toDo('', '', '', 1, 0);

        const uncompleted = [];
        const completed = [];
        for (let i = 0; i < arr.length; i++) {
            const it = arr[i];
            if (it.tit === '') continue;
            if (it.completed) completed.push(it);
            else uncompleted.push(it);
        }

        const desiredLen = 1 + uncompleted.length + completed.length;
        let unchanged = blankExisted && arr.length === desiredLen && arr[0] === blank;
        if (unchanged) {
            let idx = 1;
            for (let i = 0; i < uncompleted.length && unchanged; i++) {
                if (arr[idx++] !== uncompleted[i]) unchanged = false;
            }
            for (let i = 0; i < completed.length && unchanged; i++) {
                if (arr[idx++] !== completed[i]) unchanged = false;
            }
        }
        if (unchanged) return;

        arr.length = 0;
        arr.push(blank);
        for (let i = 0; i < uncompleted.length; i++) arr.push(uncompleted[i]);
        for (let i = 0; i < completed.length; i++)   arr.push(completed[i]);

        if (opts && opts.deferSave === true) return;
        saveToStorage(opts);
        // Mirror to Supabase only on user-driven re-sorts. The sync /
        // import path passes opts.fromSync to mute the local mutation
        // marker; treat that same flag as the signal that this rewrite
        // is reconciliation work the backend already knows about.
        if (opts && opts.fromSync === true) return;
        const projId = allProjects[project].id || null;
        arr.forEach(function(it, idx) {
            if (!it || it.tit === '' || !it.id) return;
            it.pos = idx;
            persistMutation({
                op: 'update',
                table: 'todos',
                payload: toTodoRowPayload(it, projId),
            });
        });
    }


    // Count the project's currently-open todos: non-blank, non-completed
    // items only. The blank placeholder pinned at index 0 is part of the
    // data model (the "add a task" input) and is never user-visible work,
    // so it's filtered alongside completed entries. Returns 0 for unknown
    // project names and for projects whose items list is missing.
    function getProjectIncompleteCount(projectName) {
        const entry = allProjects[projectName];
        if (!entry || !Array.isArray(entry.items)) return 0;
        let count = 0;
        for (let i = 0; i < entry.items.length; i++) {
            const item = entry.items[i];
            if (!item || !item.tit) continue;
            if (item.completed) continue;
            count++;
        }
        return count;
    }


    // Read the persisted per-project color key, or null when the project is
    // using the theme accent (or doesn't exist). Callers map the key to a
    // concrete color via the PROJECT_COLOR_HEX table in projectMenu.js.
    function getProjectColor(projectName) {
        const entry = allProjects[projectName];
        if (!entry) return null;
        return entry.color || null;
    }

    // Read-only accessor for a project's stable id (the Supabase row id). Used
    // by views that query per-project child tables (e.g. the Agent queue board
    // scopes agent_queue by project_id). Returns null for an unknown project or
    // one that has no id yet.
    function getProjectId(projectName) {
        const entry = allProjects[projectName];
        if (!entry) return null;
        return entry.id || null;
    }

    // Flag a project's todo for the autonomous agent by inserting an
    // agent_queue row (state 'triaging', auto true) that the triage sweep then
    // picks up. The task's title and description are denormalised into
    // `context` so the downstream triage workflow needs no `todos` access. All
    // agent_queue writes route through here — the Agent view's "Give to agent"
    // control calls this and never writes to Supabase directly, matching the
    // "all data-model mutations live in listLogic" convention. Returns a
    // { ok, error? } result so the caller can surface a non-blocking failure
    // and re-enable its control. The double-flag guard is layered: the view
    // only renders the button for tasks not already queued, and a unique
    // constraint on agent_queue(todo_id) is the cross-device backstop.
    // @category: user-mutation-only
    async function flagTaskForAgent(todoId) {
        if (!todoId) return { ok: false, error: 'Missing task id.' };
        // Resolve the todo and its owning project from the in-memory model.
        let item = null;
        let projectId = null;
        const names = Object.keys(allProjects);
        for (let i = 0; i < names.length; i++) {
            const entry = allProjects[names[i]];
            if (!entry || !Array.isArray(entry.items)) continue;
            const found = entry.items.find(function (it) {
                return it && it.id === todoId;
            });
            if (found) { item = found; projectId = entry.id || null; break; }
        }
        if (!item || !projectId) return { ok: false, error: 'Task not found.' };
        const row = {
            project_id: projectId,
            todo_id: todoId,
            state: 'triaging',
            auto: true,
            context: {
                title: item.tit || '',
                description: item.desc || null,
            },
        };
        try {
            const result = await Promise.resolve(
                supabase.from('agent_queue').insert(row)
            );
            if (result && result.error) {
                return {
                    ok: false,
                    error: (result.error && result.error.message) || 'Insert failed.',
                };
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: (e && e.message) || 'Insert failed.' };
        }
    }

    // Answer a needs_words agent_queue row: append the user's reply to the
    // row's `thread` and flip its `state` back to 'triaging' so the triage
    // sweep re-picks it up with the answer in hand. All agent_queue writes
    // route through here — the Agent view's needs_words answer control calls
    // this and never writes to Supabase directly, matching the "all
    // data-model mutations live in listLogic" convention. `currentThread` is
    // the row's existing thread (may be undefined/null); the new user message
    // is appended non-destructively. Whitespace-only answers are rejected
    // before any write. Returns a { ok, error? } result so the caller can
    // surface a non-blocking failure and re-enable its control.
    // @category: user-mutation-only
    async function answerAgentTask(rowId, answerText, currentThread) {
        if (!rowId) return { ok: false, error: 'Missing row id.' };
        const text = typeof answerText === 'string' ? answerText.trim() : '';
        if (!text) return { ok: false, error: 'Empty answer.' };
        const thread = [
            ...(Array.isArray(currentThread) ? currentThread : []),
            { role: 'user', text: text, ts: new Date().toISOString() },
        ];
        try {
            const result = await Promise.resolve(
                supabase
                    .from('agent_queue')
                    .update({ thread: thread, state: 'triaging' })
                    .eq('id', rowId)
            );
            if (result && result.error) {
                return {
                    ok: false,
                    error: (result.error && result.error.message) || 'Update failed.',
                };
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: (e && e.message) || 'Update failed.' };
        }
    }


    // Remove an agent_queue row entirely — the "Shelve + unflag" action on a
    // Stuck (failed / no_change) card. Deleting the row drops the task from the
    // queue, so it reappears in the Not-assigned bucket (its todo_id is no
    // longer among the loaded rows). All agent_queue writes route through here —
    // the Agent view calls this and never touches Supabase directly, matching
    // the "all data-model mutations live in listLogic" convention (mirrors
    // flagTaskForAgent / setAgentRunState). Returns a { ok, error? } result so
    // the caller can surface a non-blocking failure and re-enable its control.
    // @category: user-mutation-only
    async function unflagAgentTask(rowId) {
        if (!rowId) return { ok: false, error: 'Missing row id.' };
        try {
            const result = await Promise.resolve(
                supabase
                    .from('agent_queue')
                    .delete()
                    .eq('id', rowId)
            );
            if (result && result.error) {
                return {
                    ok: false,
                    error: (result.error && result.error.message) || 'Delete failed.',
                };
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: (e && e.message) || 'Delete failed.' };
        }
    }

    // Persist a drafted agent_queue row's run state as it walks the dispatch
    // pipeline (dispatched → running → shipped / failed / no_change). The Agent
    // view's Dispatch control calls this at each transition — inject/dispatch
    // kickoff, each poll tick, and the terminal reconcile — and never writes to
    // Supabase directly, matching the "all data-model mutations live in
    // listLogic" convention (mirrors flagTaskForAgent / answerAgentTask).
    // `patch` may carry any of { state, draft, run_id, pr_url, pr_number,
    // failure_reason, entry_id, correlation_id }; only those keys are written,
    // and only when present, so a mid-pipeline tick can update just `state`
    // without clobbering the ids stored at kickoff. `draft` lets the
    // needs_mockup launcher stash the pasted-back entry as it flips the row to
    // `drafted`. Returns a { ok, error? } result so the caller can surface a
    // non-blocking failure.
    // @category: user-mutation-only
    async function setAgentRunState(rowId, patch) {
        if (!rowId) return { ok: false, error: 'Missing row id.' };
        const src = (patch && typeof patch === 'object') ? patch : {};
        const allowed = ['state', 'draft', 'run_id', 'pr_url', 'pr_number', 'failure_reason', 'entry_id', 'correlation_id'];
        const update = {};
        allowed.forEach(function (key) {
            if (src[key] !== undefined) update[key] = src[key];
        });
        if (Object.keys(update).length === 0) {
            return { ok: false, error: 'Nothing to update.' };
        }
        try {
            const result = await Promise.resolve(
                supabase
                    .from('agent_queue')
                    .update(update)
                    .eq('id', rowId)
            );
            if (result && result.error) {
                return {
                    ok: false,
                    error: (result.error && result.error.message) || 'Update failed.',
                };
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: (e && e.message) || 'Update failed.' };
        }
    }

    // Read the set of aspect IDs a project has marked "committed to GitLab" from
    // the `aspect_submissions` table (row-presence = committed). The coverage
    // detail modal calls this before/while opening so each shipped aspect's
    // "Committed to GitLab" checkbox and the manual aspect's "mark done" tick
    // reflect stored state, and the header's "N committed to GitLab" count is
    // accurate. RLS scopes the table to the user's projects via the
    // project-ownership sub-select (no user_id column, like agent_queue/todos),
    // so the query filters on project_id only. Returns a Set of committed aspect
    // IDs — empty on a missing id or any failure, so the modal degrades to
    // all-unchecked rather than erroring.
    // @category: user-mutation-only
    async function getAspectSubmissions(projectId) {
        if (!projectId) return new Set();
        try {
            const result = await Promise.resolve(
                supabase
                    .from('aspect_submissions')
                    .select('aspect')
                    .eq('project_id', projectId)
            );
            if (result && result.error) return new Set();
            const rows = (result && result.data) || [];
            const set = new Set();
            rows.forEach(function (r) {
                const a = r && typeof r.aspect === 'string' ? r.aspect.trim() : '';
                if (a) set.add(a);
            });
            return set;
        } catch (e) {
            return new Set();
        }
    }

    // Toggle a project+aspect's "committed to GitLab" tick in `aspect_submissions`
    // (row-presence = committed): upsert the (project_id, aspect) row when
    // `committed` is true, delete it when false. The coverage detail modal calls
    // this after optimistically flipping the tick, reverting on a non-ok result.
    // Returns a { ok, error? } result matching setAgentRunState / unflagAgentTask
    // so the caller can surface a non-blocking failure and revert.
    // @category: user-mutation-only
    async function setAspectSubmitted(projectId, aspect, committed) {
        const asp = typeof aspect === 'string' ? aspect.trim() : '';
        if (!projectId || !asp) {
            return { ok: false, error: 'Missing project or aspect.' };
        }
        try {
            const result = committed
                ? await Promise.resolve(
                    supabase
                        .from('aspect_submissions')
                        .upsert(
                            { project_id: projectId, aspect: asp },
                            { onConflict: 'project_id,aspect' }
                        )
                )
                : await Promise.resolve(
                    supabase
                        .from('aspect_submissions')
                        .delete()
                        .eq('project_id', projectId)
                        .eq('aspect', asp)
                );
            if (result && result.error) {
                return {
                    ok: false,
                    error: (result.error && result.error.message) || 'Update failed.',
                };
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: (e && e.message) || 'Update failed.' };
        }
    }


    // Read the most recent stored refactor-scan row for a repo. The Structure
    // tab's NEXT REFACTOR card calls this on render to recover the last scan's
    // target file + sha (so it can short-circuit the Worker scan) and its
    // per-candidate `dismissed` skips. The `refactor_scans` table is keyed on
    // `user_id` directly (the inject_targets pattern, NOT the todos table), so
    // `user_id` is filtered explicitly here. Returns { ok, row } where `row` is
    // the newest row for the repo or null when none exists; { ok:false, error }
    // on failure so the card can show a quiet inline error and never a toast.
    // @category: user-mutation-only
    async function loadLatestRefactorScan(repo) {
        if (!repo) return { ok: false, error: 'Missing repo.' };
        try {
            const sessionResult = await supabase.auth.getSession();
            const session = sessionResult
                && sessionResult.data
                && sessionResult.data.session;
            if (!session) return { ok: false, error: 'Not signed in.' };
            const result = await Promise.resolve(
                supabase
                    .from('refactor_scans')
                    .select()
                    .eq('user_id', session.user.id)
                    .eq('repo', repo)
                    .order('scanned_at', { ascending: false })
                    .limit(1)
            );
            if (result && result.error) {
                return {
                    ok: false,
                    error: (result.error && result.error.message) || 'Load failed.',
                };
            }
            const rows = (result && result.data) || [];
            return { ok: true, row: rows.length ? rows[0] : null };
        } catch (e) {
            return { ok: false, error: (e && e.message) || 'Load failed.' };
        }
    }

    // Read the most recent stored capture row for a repo. The Structure tab's
    // RUN & CAPTURE card calls this on mount to recover the last capture's
    // readout (exit code, command, stdout/stderr) — or to resume an in-flight
    // one. Mirrors loadLatestRefactorScan exactly, swapping `refactor_scans` →
    // `run_outputs` and `scanned_at` → `created_at`. Like `refactor_scans`,
    // `run_outputs` carries a `user_id` column (NOT the todos pattern), so the
    // `user_id` filter is correct here. Returns { ok, row } where `row` is the
    // newest row for the repo or null when none exists; { ok:false, error } on
    // failure so the card can stay quietly idle and never a toast.
    // @category: user-mutation-only
    async function loadLatestCapture(repo) {
        if (!repo) return { ok: false, error: 'Missing repo.' };
        try {
            const sessionResult = await supabase.auth.getSession();
            const session = sessionResult
                && sessionResult.data
                && sessionResult.data.session;
            if (!session) return { ok: false, error: 'Not signed in.' };
            const result = await Promise.resolve(
                supabase
                    .from('run_outputs')
                    .select()
                    .eq('user_id', session.user.id)
                    .eq('repo', repo)
                    .order('created_at', { ascending: false })
                    .limit(1)
            );
            if (result && result.error) {
                return {
                    ok: false,
                    error: (result.error && result.error.message) || 'Load failed.',
                };
            }
            const rows = (result && result.data) || [];
            return { ok: true, row: rows.length ? rows[0] : null };
        } catch (e) {
            return { ok: false, error: (e && e.message) || 'Load failed.' };
        }
    }

    // Append a candidate `name` to a stored scan row's `dismissed` array — the
    // NEXT REFACTOR card's "Skip" action, which permanently hides that candidate
    // so the card advances to the next-cheapest one. Reads the row's current
    // `dismissed` (keyed on user_id/repo/target_file, the inject_targets pattern)
    // and writes it back with the name appended, non-destructively and only once.
    // All scan writes route through here. Returns { ok, error? }.
    // @category: user-mutation-only
    async function dismissRefactorCandidate(repo, targetFile, name) {
        if (!repo || !targetFile || !name) {
            return { ok: false, error: 'Missing argument.' };
        }
        try {
            const sessionResult = await supabase.auth.getSession();
            const session = sessionResult
                && sessionResult.data
                && sessionResult.data.session;
            if (!session) return { ok: false, error: 'Not signed in.' };
            const userId = session.user.id;
            const readResult = await Promise.resolve(
                supabase
                    .from('refactor_scans')
                    .select('dismissed')
                    .eq('user_id', userId)
                    .eq('repo', repo)
                    .eq('target_file', targetFile)
                    .limit(1)
            );
            if (readResult && readResult.error) {
                return {
                    ok: false,
                    error: (readResult.error && readResult.error.message) || 'Update failed.',
                };
            }
            const rows = (readResult && readResult.data) || [];
            const current = rows.length && Array.isArray(rows[0].dismissed)
                ? rows[0].dismissed
                : [];
            if (current.indexOf(name) !== -1) return { ok: true };
            const next = current.concat([name]);
            const result = await Promise.resolve(
                supabase
                    .from('refactor_scans')
                    .update({ dismissed: next })
                    .eq('user_id', userId)
                    .eq('repo', repo)
                    .eq('target_file', targetFile)
            );
            if (result && result.error) {
                return {
                    ok: false,
                    error: (result.error && result.error.message) || 'Update failed.',
                };
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: (e && e.message) || 'Update failed.' };
        }
    }


    // Stamp an injected entry's id onto the source todo so its row's run-status
    // glyph lights. The Agent board's dispatch path injects a drafted entry into
    // the routed TODO.md but tracks state only on the agent_queue row; without
    // writing the entry id back to the originating task — matched by the agent
    // row's `todo_id`, which equals the item's `id` — the task row's
    // #descIndicator glyph never shows, because it resolves purely from
    // `item.entryId` against the shared TODO.md marker cache. Mirrors the inject
    // button's injectDescription stamp: sets `entryId` + `injectedAt`, saves, and
    // mirrors the change to Supabase (entry_id rides in toTodoRowPayload) so the
    // id survives a reload and reaches other devices. Scans every project for the
    // matching id since the caller (agentView) has only the id, not the project.
    // No-op (returns { ok:false }) when an id is missing or the todo isn't found.
    // @category: user-mutation-only
    function stampTodoEntryId(todoId, entryId) {
        if (!todoId || !entryId) return { ok: false, error: 'Missing id.' };
        let found = null;
        let foundProject = null;
        const names = Object.keys(allProjects);
        for (let i = 0; i < names.length; i++) {
            const entry = allProjects[names[i]];
            if (!entry || !entry.items) continue;
            const hit = entry.items.find(function (it) { return it && it.id === todoId; });
            if (hit) { found = hit; foundProject = names[i]; break; }
        }
        if (!found) return { ok: false, error: 'Todo not found.' };

        found.entryId = entryId;
        found.injectedAt = Date.now();
        saveToStorage();

        if (found.id && found.tit && found.tit !== '') {
            persistMutation({
                op: 'update',
                table: 'todos',
                payload: toTodoRowPayload(
                    found,
                    allProjects[foundProject].id || null
                ),
            });
        }
        return { ok: true };
    }


    // Acknowledge a shipped entry by stamping `entry_reviewed_at` onto its
    // source todo, clearing the derived REVIEW badge for that row. Mirrors
    // stampTodoEntryId exactly — a single-field write on a todo keyed by id:
    // scans every project for the matching id (the badge tap has only the id),
    // stamps an ISO timestamp, saves locally, and mirrors to Supabase
    // (entry_reviewed_at rides in toTodoRowPayload) so the acknowledgement
    // survives a reload and reaches other devices. The manual `status` field is
    // never touched here. No-op (returns { ok:false }) when the id is missing or
    // the todo isn't found.
    // @category: user-mutation-only
    function markEntryReviewed(todoId) {
        if (!todoId) return { ok: false, error: 'Missing id.' };
        let found = null;
        let foundProject = null;
        const names = Object.keys(allProjects);
        for (let i = 0; i < names.length; i++) {
            const entry = allProjects[names[i]];
            if (!entry || !entry.items) continue;
            const hit = entry.items.find(function (it) { return it && it.id === todoId; });
            if (hit) { found = hit; foundProject = names[i]; break; }
        }
        if (!found) return { ok: false, error: 'Todo not found.' };

        found.entryReviewedAt = new Date().toISOString();
        saveToStorage();

        if (found.id && found.tit && found.tit !== '') {
            persistMutation({
                op: 'update',
                table: 'todos',
                payload: toTodoRowPayload(
                    found,
                    allProjects[foundProject].id || null
                ),
            });
        }
        return { ok: true };
    }


    // Resolve a TODO.md entry marker id to its source todo and report whether
    // that entry has been acknowledged. Scans every project for a todo whose
    // `entryId` matches the marker (marker ids are globally unique, mirroring
    // markEntryReviewed's own scan) and returns
    // { found, todoId, reviewed } — `reviewed` is true only when the resolved
    // todo carries an `entryReviewedAt` stamp. Read-only: the acknowledgement
    // write stays in markEntryReviewed. Returns the not-found shape when the id
    // is missing or resolves to nothing, so an unresolvable marker reads as
    // "not an unreviewed shipped entry" at the call sites.
    function getEntryReviewInfo(entryId) {
        if (!entryId) return { found: false, todoId: null, reviewed: false };
        const names = Object.keys(allProjects);
        for (let i = 0; i < names.length; i++) {
            const entry = allProjects[names[i]];
            if (!entry || !entry.items) continue;
            const hit = entry.items.find(function (it) {
                return it && it.entryId === entryId;
            });
            if (hit) {
                return {
                    found: true,
                    todoId: hit.id || null,
                    reviewed: !!hit.entryReviewedAt,
                };
            }
        }
        return { found: false, todoId: null, reviewed: false };
    }


    // Resolve a committed todo by its id across all projects, returning a small
    // read-only view { id, title, description } — or null when the id no longer
    // resolves (task deleted, or never existed). Read-only: it never mutates,
    // so callers that only need a task's current text (e.g. the Claude sheet's
    // task-scope chip, which stores the id and re-reads the title/description on
    // every render and turn) always see the live values — a rename is reflected
    // and a deletion collapses the chip rather than surfacing stale text.
    function getTodoById(todoId) {
        if (!todoId) return null;
        const names = Object.keys(allProjects);
        for (let i = 0; i < names.length; i++) {
            const entry = allProjects[names[i]];
            if (!entry || !entry.items) continue;
            const hit = entry.items.find(function (it) {
                return it && it.id === todoId;
            });
            if (hit) {
                return {
                    id: hit.id,
                    title: hit.tit || '',
                    description: hit.desc || '',
                };
            }
        }
        return null;
    }


    // Write a per-project color key. Pass null (or any non-valid key) to
    // reset back to the theme accent.
    // @category: user-mutation-only
    function setProjectColor(projectName, colorKey) {
        const entry = allProjects[projectName];
        if (!entry) return;
        if (colorKey && PROJECT_COLOR_KEYS.indexOf(colorKey) !== -1) {
            entry.color = colorKey;
        } else {
            entry.color = null;
        }
        saveToStorage();
        if (entry.id) {
            persistMutation({
                op: 'update',
                table: 'projects',
                payload: toProjectRowPayload(
                    entry,
                    projectName,
                    Object.keys(allProjects).indexOf(projectName)
                ),
            });
        }
    }


    // ── PROJECT INJECT-ROUTING ──
    // Per-project FK to inject_targets.id. NULL means the project has no
    // routing — its inject button renders in the "Set inject target" state
    // and the inject POST is blocked. Reads are synchronous (the field
    // lives on the cached project entry); the setter mirrors the change
    // to Supabase via the same persistMutation funnel every other project
    // mutation uses.
    function getProjectTargetId(projectName) {
        const entry = allProjects[projectName];
        if (!entry) return null;
        return entry.target_id || null;
    }

    // @category: user-mutation-only
    function setProjectTargetId(projectName, targetId) {
        const entry = allProjects[projectName];
        if (!entry) return;
        entry.target_id = (typeof targetId === 'string' && targetId.length > 0)
            ? targetId
            : null;
        saveToStorage();
        if (entry.id) {
            persistMutation({
                op: 'update',
                table: 'projects',
                payload: toProjectRowPayload(
                    entry,
                    projectName,
                    Object.keys(allProjects).indexOf(projectName)
                ),
            });
        }
    }

    // Clear target_id on every project pointing at the given target id.
    // Called by the inject settings modal after a target delete so the
    // local cache stays in sync with the FK's ON DELETE SET NULL on the
    // database side — without it, dropdowns would keep showing the
    // deleted target's nickname until the next page reload. opts forwards
    // through to saveToStorage so a future caller wiring this off a
    // realtime DELETE event can pass `{ fromSync: true }` and suppress
    // the per-row Supabase mirror writes downstream.
    // @category: sync-safe
    function clearProjectTargetId(targetId, opts) {
        if (!targetId) return;
        let mutated = false;
        Object.keys(allProjects).forEach(function(name) {
            const entry = allProjects[name];
            if (entry && entry.target_id === targetId) {
                entry.target_id = null;
                mutated = true;
            }
        });
        if (mutated) saveToStorage(opts);
    }


    // Per-project auto-sort-by-due-date preference. Render-time only: the
    // flag controls whether the rendering layer iterates items in sorted
    // order, but the underlying items array (and each item's `pos`) is
    // never mutated, so toggling off restores the user's manual order.
    function getProjectSortByDue(projectName) {
        const entry = allProjects[projectName];
        if (!entry) return false;
        return !!entry.sortByDue;
    }

    // @category: user-mutation-only
    function setProjectSortByDue(projectName, on) {
        const entry = allProjects[projectName];
        if (!entry) return;
        entry.sortByDue = !!on;
        saveToStorage();
    }


    // Per-project display preference that hides every task's due-date pill.
    // Display-only: the stored `due` on each item is never read for display
    // while this is on, but is never cleared or edited, so toggling off
    // restores the pills untouched. Unlike sortByDue this DOES sync across
    // devices, so the setter mirrors the change to Supabase through the same
    // toProjectRowPayload + persistMutation funnel setProjectColor uses.
    function getProjectHideDates(projectName) {
        const entry = allProjects[projectName];
        if (!entry) return false;
        return !!entry.hideDates;
    }

    // @category: user-mutation-only
    function setProjectHideDates(projectName, on) {
        const entry = allProjects[projectName];
        if (!entry) return;
        entry.hideDates = !!on;
        saveToStorage();
        if (entry.id) {
            persistMutation({
                op: 'update',
                table: 'projects',
                payload: toProjectRowPayload(
                    entry,
                    projectName,
                    Object.keys(allProjects).indexOf(projectName)
                ),
            });
        }
    }


    // ── PER-PROJECT LIFECYCLE STAGES ──
    // The Conceive view renders the selected project's ordered `stages`
    // list (seeded with the SDLC set) and edits stage bodies. Reads return
    // the LIVE array so the view always sees current bodies; writes route
    // through the same saveToStorage funnel every other project mutation
    // uses, then mirror to the project's Supabase row so lifecycle thinking
    // syncs across devices (stages live on the existing `projects` row).
    function getProjectStages(projectName) {
        const entry = allProjects[projectName];
        if (!entry || !Array.isArray(entry.stages)) return [];
        return entry.stages;
    }

    function getProjectLifecycle(projectName) {
        const entry = allProjects[projectName];
        if (!entry) return DEFAULT_LIFECYCLE;
        return entry.lifecycle || DEFAULT_LIFECYCLE;
    }

    // Set the body text of a single stage, targeted by project name + stage
    // id (stages are an ordered list, not fixed keys). No-op when the
    // project or the stage id is unknown.
    // @category: user-mutation-only
    function setProjectStageBody(projectName, stageId, text) {
        const entry = allProjects[projectName];
        if (!entry || !Array.isArray(entry.stages)) return null;
        const stage = entry.stages.find(function(s) { return s.id === stageId; });
        if (!stage) return null;
        stage.body = typeof text === 'string' ? text : '';
        saveToStorage();
        // Mirror the stage edit to the project's Supabase row, exactly the
        // way setProjectColor does. Routing through toProjectRowPayload
        // bumps the whole row (and its updated_at) so a stage edit wins the
        // coarse per-row last-write-wins on the next cross-device hydrate.
        if (entry.id) {
            persistMutation({
                op: 'update',
                table: 'projects',
                payload: toProjectRowPayload(
                    entry,
                    projectName,
                    Object.keys(allProjects).indexOf(projectName)
                ),
            });
        }
        return stage;
    }

    // Replace a project's stages with a fresh seed for the given shape and set
    // its lifecycle. Used by the Conceive shape chooser, which is only offered
    // while the project is still pristine (no stage has text), so swapping the
    // stage set never destroys written content. Builds the shape's seed via the
    // same seedStages() helper the create-time default uses (fresh ids, empty
    // bodies), persists locally, then mirrors to the project's Supabase row
    // through the same toProjectRowPayload + persistMutation update path
    // setProjectStageBody uses — bumping the row's updated_at so the reseed wins
    // last-write-wins on the next cross-device hydrate. The shape is canonicalized
    // ('SDLC' → 'spec') so the stored lifecycle is always 'iterative' or 'spec'.
    // @category: user-mutation-only
    function setProjectShape(projectName, shape) {
        const entry = allProjects[projectName];
        if (!entry) return null;
        const lifecycle = (shape === LIFECYCLE_SPEC || shape === 'SDLC')
            ? LIFECYCLE_SPEC
            : LIFECYCLE_ITERATIVE;
        entry.lifecycle = lifecycle;
        entry.stages = seedStages(lifecycle);
        saveToStorage();
        if (entry.id) {
            persistMutation({
                op: 'update',
                table: 'projects',
                payload: toProjectRowPayload(
                    entry,
                    projectName,
                    Object.keys(allProjects).indexOf(projectName)
                ),
            });
        }
        return entry.stages;
    }

    // Move one line from a source stage's body to the end of a target stage's
    // body, in a single mutation. Used by the Iterative direction board's card
    // "promote" control (Later → Next, Next → Now): each non-empty line of a
    // lane's body renders as a card, and promoting a card relocates its exact
    // line to the next lane up. The line is targeted by its raw index in the
    // source body (split on '\n') so duplicate lines promote unambiguously.
    // No-op (returns null) when the project, either stage, or the line index is
    // unknown, or when the addressed line is blank. Persists locally and mirrors
    // the whole project row to Supabase through the same toProjectRowPayload +
    // persistMutation path setProjectStageBody / setProjectShape use, bumping the
    // row's updated_at so the move wins last-write-wins on the next hydrate.
    // @category: user-mutation-only
    function promoteStageLine(projectName, fromStageId, toStageId, lineIndex) {
        const entry = allProjects[projectName];
        if (!entry || !Array.isArray(entry.stages)) return null;
        const fromStage = entry.stages.find(function(s) { return s.id === fromStageId; });
        const toStage = entry.stages.find(function(s) { return s.id === toStageId; });
        if (!fromStage || !toStage) return null;
        const fromLines = (fromStage.body || '').split('\n');
        if (!Number.isInteger(lineIndex) || lineIndex < 0 || lineIndex >= fromLines.length) {
            return null;
        }
        const moved = fromLines[lineIndex];
        if (!moved || !moved.trim()) return null;
        fromLines.splice(lineIndex, 1);
        fromStage.body = fromLines.join('\n');
        const toBody = toStage.body || '';
        toStage.body = (toBody && toBody.trim())
            ? toBody.replace(/\s*$/, '') + '\n' + moved.trim()
            : moved.trim();
        saveToStorage();
        if (entry.id) {
            persistMutation({
                op: 'update',
                table: 'projects',
                payload: toProjectRowPayload(
                    entry,
                    projectName,
                    Object.keys(allProjects).indexOf(projectName)
                ),
            });
        }
        return { from: fromStage, to: toStage };
    }

    // Append a run log record to a board project's auto-managed "Shipped" stage.
    // Gated to board-shape projects (stages include a "Now" lane) — other shapes
    // and unknown projects append nothing. The Shipped stage is created lazily
    // when absent, so board projects that predate this feature gain it on their
    // first append. Idempotent by `record.id` (the run's entry marker): a record
    // whose id already exists is skipped, since status polling can fire the
    // completion handler more than once and a log synced from another device may
    // already hold the run. New records prepend so the list stays newest-first
    // without a sort. Persists locally and mirrors the whole row to Supabase
    // through the same toProjectRowPayload + persistMutation path the other stage
    // mutations use, bumping the row's updated_at so the append wins
    // last-write-wins on the next cross-device hydrate. Returns the stored record
    // on append, or null on any no-op (non-board / unknown project, bad record,
    // or duplicate id).
    // @category: user-mutation-only
    function appendConceiveLogEntry(projectName, record) {
        const entry = allProjects[projectName];
        if (!entry || !Array.isArray(entry.stages)) return null;
        if (!stagesAreBoard(entry.stages)) return null;
        if (!record || typeof record !== 'object') return null;
        const id = (typeof record.id === 'string' && record.id.length > 0)
            ? record.id
            : (record.id != null ? String(record.id) : '');
        if (!id) return null;

        let shipped = entry.stages.find(function(s) {
            return s && s.label === SHIPPED_STAGE_LABEL;
        });
        if (!shipped) {
            shipped = { id: genId(), label: SHIPPED_STAGE_LABEL, body: '' };
            entry.stages.push(shipped);
        }

        const log = parseShippedLog(shipped.body);
        if (log.some(function(r) { return r && r.id === id; })) return null; // dedup

        const clean = {
            id: id,
            title: typeof record.title === 'string' ? record.title : '',
            verdict: record.verdict === 'nochange' ? 'nochange' : 'shipped',
            summary: typeof record.summary === 'string' ? record.summary : '',
            date: typeof record.date === 'string' ? record.date : '',
        };
        log.unshift(clean);
        shipped.body = JSON.stringify(log);
        saveToStorage();
        if (entry.id) {
            persistMutation({
                op: 'update',
                table: 'projects',
                payload: toProjectRowPayload(
                    entry,
                    projectName,
                    Object.keys(allProjects).indexOf(projectName)
                ),
            });
        }
        return clean;
    }

    // Read a board project's Shipped log as a parsed array (newest-first).
    // Returns [] for a non-board / unknown project or an absent / corrupt Shipped
    // stage — never throws. The Conceive view calls this to render the collapsed
    // Shipped section; all JSON parsing lives here so the view never touches it.
    function getConceiveLog(projectName) {
        const entry = allProjects[projectName];
        if (!entry || !Array.isArray(entry.stages)) return [];
        const shipped = entry.stages.find(function(s) {
            return s && s.label === SHIPPED_STAGE_LABEL;
        });
        if (!shipped) return [];
        return parseShippedLog(shipped.body);
    }


    // ── RECURRENCE ───────────────────────────────────────────────────
    // Write a recurrence config onto a todo item by reference. Pass null
    // (or a non-object) to clear recurrence and revert to a one-off task.
    // Sanitizes the object so a hand-edited or partial config can't poison
    // downstream date math: missing fields fall back to safe defaults, the
    // pattern is clamped to a known value, and `interval` is forced to a
    // positive integer.
    // @category: user-mutation-only
    function setRecurrence(project, item, recurrence) {
        if (!allProjects[project]) return;
        if (!item) return;
        if (!recurrence || typeof recurrence !== 'object') {
            item.recurrence = null;
            saveToStorage();
        } else {
            item.recurrence = sanitizeRecurrence(recurrence);
            saveToStorage();
        }
        if (item.id && item.tit !== '') {
            persistMutation({
                op: 'update',
                table: 'todos',
                payload: toTodoRowPayload(
                    item,
                    allProjects[project].id || null
                ),
            });
        }
    }


    // Advance a recurring todo's due date to its next occurrence. Used by
    // the row's checkbox handler in place of the standard mark-complete
    // path. Returns true if the todo was advanced, false if it should
    // instead be treated as a normal one-off completion (no recurrence
    // configured, or the next due exceeds the configured end date).
    //
    // Side effect: pushes a frozen completed clone of the original into
    // the project's items array before mutating the original. The clone
    // captures the just-completed occurrence as a historical entry — its
    // `due` is pinned to the date that was just satisfied and recurrence
    // is cleared so the clone itself doesn't chain. Repeated advances
    // therefore stack one completed entry per occurrence alongside the
    // still-recurring original.
    // @category: user-mutation-only
    function advanceRecurringTodo(project, item, completionDate) {
        if (!allProjects[project] || !item || !item.recurrence) return false;

        const next = nextDueDate(item.due, item.recurrence, completionDate || new Date());
        if (!next) return false;

        const end = item.recurrence.endDate;
        if (end) {
            const endDate = parseEndDate(end);
            if (endDate && next > endDate) return false;
        }

        const arr = allProjects[project].items;
        const completedClone = {
            id: genId(),
            tit: item.tit,
            desc: item.desc,
            due: item.due,
            pri: item.pri,
            pos: item.pos,
            completed: true,
            status: normalizeTodoStatus(item.status),
            recurrence: null,
            created_at: item.created_at || null,
        };
        arr.push(completedClone);

        item.due = formatDueParts(next);
        item.completed = false;
        sortCompletedInPlace(arr);
        saveToStorage();
        // Two separate writes: one INSERT for the frozen historical
        // clone, one UPDATE for the still-recurring original whose due
        // just advanced.
        const projId = allProjects[project].id || null;
        if (completedClone.tit !== '') {
            persistMutation({
                op: 'insert',
                table: 'todos',
                payload: toTodoRowPayload(completedClone, projId),
            });
        }
        if (item.id && item.tit !== '') {
            persistMutation({
                op: 'update',
                table: 'todos',
                payload: toTodoRowPayload(item, projId),
            });
        }
        return true;
    }


    // ── RECURRING TASK STATS ─────────────────────────────────────────
    // Compute hit/miss/streak stats for a recurring task within a rolling
    // window. Walks the project's completed clones (pushed by
    // advanceRecurringTodo) plus the original recurring item to derive the
    // expected occurrence sequence from an anchor forward to today; a hit
    // is an expected date that matches a clone's `due`, a miss is any
    // expected date strictly before today with no matching clone. Today
    // can be a hit (when a clone for today exists) but is never a miss —
    // the day isn't over, so it stays "in-flight" for miss purposes until
    // midnight rolls over.
    //
    // Returns `{ expectedDates, hits, misses, currentStreak, bestStreak,
    // hitRate, completedCount }`. `expectedDates` and `misses` are clipped
    // to the window; `hits` is the full set of completed-clone YYYY-MM-DD
    // keys (so the renderer can colour any cell in the grid). Streaks are
    // computed over the full all-time expected sequence per the task spec,
    // not the windowed slice.
    function getRecurringTaskStats(projectName, item, windowKey, now) {
        const empty = {
            expectedDates: [],
            hits: new Set(),
            misses: [],
            currentStreak: 0,
            bestStreak: 0,
            hitRate: 0,
            completedCount: 0,
        };

        const entry = allProjects[projectName];
        if (!entry || !Array.isArray(entry.items)) return empty;
        if (!item || !item.recurrence) return empty;

        const recurrence = sanitizeRecurrence(item.recurrence);
        if (!recurrence) return empty;

        const referenceNow = now instanceof Date ? now : new Date();
        const today = new Date(
            referenceNow.getFullYear(),
            referenceNow.getMonth(),
            referenceNow.getDate()
        );

        // Build the hit-key set from every completed sibling sharing the
        // original's title — these are the frozen clones spawned by
        // advanceRecurringTodo. Track the earliest one so we can anchor
        // the expected-occurrence walk.
        const cloneHitKeys = new Set();
        let earliestClone = null;
        entry.items.forEach(function(it) {
            if (it === item) return;
            if (!it || !it.completed) return;
            if (it.tit !== item.tit) return;
            const d = parseDueParts(it.due);
            if (!d) return;
            cloneHitKeys.add(formatCalendarKey(d));
            if (!earliestClone || d < earliestClone) earliestClone = d;
        });

        // Anchor preference (per task spec): earliest completed clone's
        // due, falling back to the original's current due (proxy for
        // creation since the data model doesn't store a created-at), and
        // finally today so the function never throws on missing data.
        let anchor = earliestClone || parseDueParts(item.due) || today;
        anchor = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());

        // Walk expected occurrences forward from anchor up to and
        // including today. The safety cap prevents pathological data
        // (e.g. a malformed recurrence whose `next` doesn't advance) from
        // hanging the renderer.
        const allExpected = [];
        const MAX_OCCURRENCES = 5000;
        let current = anchor;
        let safety = 0;
        while (current.getTime() <= today.getTime() && safety < MAX_OCCURRENCES) {
            allExpected.push(current);
            const next = nextDueDate(formatDueParts(current), recurrence, current);
            if (!next || next.getTime() <= current.getTime()) break;
            current = next;
            safety++;
        }

        // Window cutoff: trailing N days including today. 'all' returns
        // the unfiltered sequence; any unrecognised value defaults to 30d
        // to match the drawer's default selection.
        let windowStart = null;
        if (windowKey === '14d') {
            windowStart = addDays(today, -13);
        } else if (windowKey === '90d') {
            windowStart = addDays(today, -89);
        } else if (windowKey === 'all') {
            windowStart = null;
        } else {
            windowStart = addDays(today, -29);
        }

        const expectedDates = windowStart
            ? allExpected.filter(function(d) {
                return d.getTime() >= windowStart.getTime();
            })
            : allExpected.slice();

        const misses = expectedDates.filter(function(d) {
            if (d.getTime() >= today.getTime()) return false;
            return !cloneHitKeys.has(formatCalendarKey(d));
        });

        // Hit rate / completedCount: today now counts in both numerator
        // (when a clone for today exists) and denominator (whenever today
        // is an expected occurrence). Future dates never appear in
        // expectedDates because the walker stops at today, so we can use
        // expectedDates directly without re-filtering.
        const hitsInWindow = expectedDates.filter(function(d) {
            return cloneHitKeys.has(formatCalendarKey(d));
        });
        const hitRate = expectedDates.length > 0
            ? hitsInWindow.length / expectedDates.length
            : 0;
        const completedCount = hitsInWindow.length;

        // Streaks: all-time. The walker walks expected dates backwards
        // from today's index. When today is a hit, today starts the run
        // and we continue back through yesterday and earlier. When today
        // is expected but not yet a hit, we skip today (it's still
        // in-flight, neither hit nor miss) and start at yesterday — a
        // long historic run isn't broken just because the user hasn't
        // checked today off yet. Best streak is the longest run anywhere
        // in the all-time expected sequence (today included).
        const todayKey = formatCalendarKey(today);
        let streakStart = allExpected.length - 1;
        if (streakStart >= 0
            && allExpected[streakStart].getTime() === today.getTime()
            && !cloneHitKeys.has(todayKey)) {
            streakStart--;
        }
        let currentStreak = 0;
        for (let i = streakStart; i >= 0; i--) {
            if (cloneHitKeys.has(formatCalendarKey(allExpected[i]))) {
                currentStreak++;
            } else {
                break;
            }
        }

        let bestStreak = 0;
        let run = 0;
        for (let i = 0; i < allExpected.length; i++) {
            if (cloneHitKeys.has(formatCalendarKey(allExpected[i]))) {
                run++;
                if (run > bestStreak) bestStreak = run;
            } else {
                run = 0;
            }
        }

        return {
            expectedDates: expectedDates,
            hits: cloneHitKeys,
            misses: misses,
            currentStreak: currentStreak,
            bestStreak: bestStreak,
            hitRate: hitRate,
            completedCount: completedCount,
        };
    }


    // ── RECURRING MISS PATTERN SUMMARY ──────────────────────────────
    // Derive a single sentence the stats drawer renders above the
    // missed-dates list. Surfaces the most informative pattern hiding in
    // the miss set so a long pile of dates collapses into one signal the
    // user can act on. Returns `null` when there are no misses (the
    // drawer suppresses the callout entirely in that case). Otherwise
    // returns `{ kind, text }` where `kind` is one of:
    //
    //   'abandoned'  — a long contiguous miss run ending at yesterday
    //   'weekday'    — one or two weekdays absorb the bulk of the misses
    //   'recentSlip' — strong first half of the window, weak second half
    //   'fallback'   — many misses but no clear pattern
    //   'lowCount'   — 1–2 misses; phrasing names the dates directly
    //
    // Priority order: abandoned → weekday → recentSlip → fallback. The
    // 1–2 miss case short-circuits to `lowCount` before the pattern
    // checks run, since a long stat sentence would feel out of scale
    // when there are barely any misses to summarise. Pure function: no
    // DOM, no localStorage, no Date.now() — pass `now` for testability.
    function summarizeRecurringMissPattern(stats, now) {
        if (!stats || !Array.isArray(stats.misses) || stats.misses.length === 0) {
            return null;
        }

        const missCount = stats.misses.length;
        const referenceNow = now instanceof Date ? now : new Date();
        const today = new Date(
            referenceNow.getFullYear(),
            referenceNow.getMonth(),
            referenceNow.getDate()
        );
        const yesterday = addDays(today, -1);

        // Misses arrive newest-last from getRecurringTaskStats (the
        // expected-dates walk is forward in time). Sort defensively so
        // any caller-supplied ordering can't drift the pattern math.
        const sortedMisses = stats.misses.slice().sort(function(a, b) {
            return a.getTime() - b.getTime();
        });

        // ── lowCount: 1–2 misses get explicit-date phrasing ──
        if (missCount <= 2) {
            const formatted = sortedMisses.map(formatMissShortDate);
            let text;
            if (missCount === 1) {
                text = 'Missed ' + formatted[0];
            } else {
                const sameWeekday =
                    sortedMisses[0].getDay() === sortedMisses[1].getDay();
                text = 'Missed ' + formatted[0] + ' and ' + formatted[1];
                if (sameWeekday) {
                    const dowName = sortedMisses[0].toLocaleString(
                        undefined,
                        { weekday: 'long' }
                    );
                    text += ' — both ' + dowName + 's';
                }
            }
            return { kind: 'lowCount', text: text };
        }

        // Convenience: missed-date YYYY-MM-DD key set so the abandoned
        // run scan can compare against the expected sequence without
        // re-running the formatter on every iteration.
        const missKeySet = new Set(sortedMisses.map(function(d) {
            return formatCalendarKey(d);
        }));

        // ── abandoned: longest contiguous miss run ending at yesterday
        // is ≥ 7 AND ≥ 50% of the window's misses fall inside the run.
        // Walks the expected sequence backwards from yesterday — only
        // expected-occurrence days count toward the run, so a daily
        // cadence and a weekdays cadence both yield a clean run length. ──
        const expectedBeforeToday = (stats.expectedDates || []).filter(function(d) {
            return d.getTime() < today.getTime();
        }).sort(function(a, b) { return a.getTime() - b.getTime(); });

        let runLength = 0;
        let runEndsAtYesterday = false;
        if (expectedBeforeToday.length > 0) {
            const last = expectedBeforeToday[expectedBeforeToday.length - 1];
            if (last.getTime() === yesterday.getTime()
                && missKeySet.has(formatCalendarKey(last))) {
                runEndsAtYesterday = true;
                for (let i = expectedBeforeToday.length - 1; i >= 0; i--) {
                    if (missKeySet.has(formatCalendarKey(expectedBeforeToday[i]))) {
                        runLength++;
                    } else {
                        break;
                    }
                }
            }
        }

        if (runEndsAtYesterday && runLength >= 7 && runLength >= missCount * 0.5) {
            // Last hit = newest expected date strictly before today whose
            // key sits in the hit set. May be absent when the user has
            // never satisfied the recurrence inside the window — the
            // phrasing branches on that case.
            let lastHit = null;
            const hits = stats.hits instanceof Set ? stats.hits : new Set();
            for (let i = expectedBeforeToday.length - 1; i >= 0; i--) {
                if (hits.has(formatCalendarKey(expectedBeforeToday[i]))) {
                    lastHit = expectedBeforeToday[i];
                    break;
                }
            }
            const text = lastHit
                ? 'Last hit was ' + formatMissShortDate(lastHit)
                    + ' — ' + runLength + ' consecutive misses since.'
                : runLength + ' consecutive misses, no completions in this window.';
            return { kind: 'abandoned', text: text };
        }

        // ── weekday concentration: one or two weekdays account for the
        // bulk of the misses. Requires the expected sequence to span
        // ≥ 4 distinct weekdays so weekly/biweekly cadences (which only
        // ever land on one weekday) don't trip the rule. ──
        const weekdayBuckets = [0, 0, 0, 0, 0, 0, 0];
        const expectedByDOW = [0, 0, 0, 0, 0, 0, 0];
        expectedBeforeToday.forEach(function(d) {
            expectedByDOW[d.getDay()]++;
        });
        sortedMisses.forEach(function(d) {
            weekdayBuckets[d.getDay()]++;
        });

        const expectedWeekdays = expectedByDOW.filter(function(c) {
            return c > 0;
        }).length;

        if (expectedWeekdays >= 4) {
            const dowRates = [];
            for (let i = 0; i < 7; i++) {
                if (expectedByDOW[i] === 0) continue;
                dowRates.push({
                    dow: i,
                    rate: weekdayBuckets[i] / expectedByDOW[i],
                    misses: weekdayBuckets[i],
                    expected: expectedByDOW[i],
                });
            }
            const high = dowRates.filter(function(r) {
                return r.rate >= 0.6;
            });
            if (high.length === 1 || high.length === 2) {
                const highSet = {};
                high.forEach(function(r) { highSet[r.dow] = true; });
                const others = dowRates.filter(function(r) {
                    return !highSet[r.dow];
                });
                const othersAvg = others.length
                    ? others.reduce(function(sum, r) { return sum + r.rate; }, 0) / others.length
                    : 0;
                const highAvg = high.reduce(function(sum, r) {
                    return sum + r.rate;
                }, 0) / high.length;
                if (highAvg >= othersAvg * 1.5) {
                    // Sort so the bigger contributor reads first.
                    high.sort(function(a, b) { return b.misses - a.misses; });
                    let text;
                    if (high.length === 1) {
                        const wd = WEEKDAY_NAMES[high[0].dow];
                        const pct = Math.round(high[0].rate * 100);
                        text = pct + '% of your ' + wd + ' occurrences are missed';
                    } else {
                        const totalHighMisses = high[0].misses + high[1].misses;
                        const pct = Math.round((totalHighMisses / missCount) * 100);
                        const wd1 = WEEKDAY_NAMES[high[0].dow];
                        const wd2 = WEEKDAY_NAMES[high[1].dow];
                        text = wd1 + 's and ' + wd2 + 's account for '
                            + pct + '% of your misses';
                    }
                    return { kind: 'weekday', text: text };
                }
            }
        }

        // ── recentSlip: strong first half, weak second half. Only fires
        // when the window has ≥ 14 expected occurrences so a small
        // window can't read into noise as a slip. ──
        if (expectedBeforeToday.length >= 14) {
            const midIdx = Math.floor(expectedBeforeToday.length / 2);
            const firstHalf = expectedBeforeToday.slice(0, midIdx);
            const secondHalf = expectedBeforeToday.slice(midIdx);
            const hitSet = stats.hits instanceof Set ? stats.hits : new Set();
            const firstHits = firstHalf.filter(function(d) {
                return hitSet.has(formatCalendarKey(d));
            }).length;
            const secondHits = secondHalf.filter(function(d) {
                return hitSet.has(formatCalendarKey(d));
            }).length;
            const firstRate = firstHits / firstHalf.length;
            const secondRate = secondHits / secondHalf.length;
            if (firstRate >= 0.7 && secondRate <= 0.3) {
                const midDate = formatMissShortDate(secondHalf[0]);
                const firstPct = Math.round(firstRate * 100);
                const secondPct = Math.round(secondRate * 100);
                const text = 'Strong start (' + firstPct + '% hits through '
                    + midDate + ') but slipped recently ('
                    + secondPct + '% since).';
                return { kind: 'recentSlip', text: text };
            }
        }

        // ── fallback: misses with no clear pattern. Fires for any
        // count ≥ 3 (since the 1–2 case is already handled by
        // lowCount above) so the drawer is never left without a
        // callout when there are misses to summarise — the
        // acceptance criteria require a callout for every non-zero
        // miss count. ──
        const expectedCount = expectedBeforeToday.length || missCount;
        const text = 'Missed ' + missCount + ' of ' + expectedCount
            + ' occurrences. No clear pattern.';
        return { kind: 'fallback', text: text };
    }


    // ── TODAY DASHBOARD AGGREGATION ─────────────────────────────────
    // Walk every project's items once and bucket non-completed todos with
    // due dates into overdue / today / upcoming relative to the start of
    // the local day. Returns `{ overdue, today, upcoming, counts }` where
    // each bucket is an array of `{ item, project, due }` entries sorted
    // by due date (earliest first), with title alphabetical as the
    // tiebreaker. The optional `now` parameter is for tests — production
    // callers pass nothing and the aggregation uses the system clock.
    function getTodayAggregation(now) {
        const referenceNow = now instanceof Date ? now : new Date();
        const startOfToday = new Date(
            referenceNow.getFullYear(),
            referenceNow.getMonth(),
            referenceNow.getDate()
        );
        const msPerDay = 24 * 60 * 60 * 1000;
        const upcomingCutoff = new Date(startOfToday.getTime() + 7 * msPerDay);

        const overdue = [];
        const today = [];
        const upcoming = [];

        Object.keys(allProjects).forEach(function(projectName) {
            const entry = allProjects[projectName];
            if (!entry || !Array.isArray(entry.items)) return;
            entry.items.forEach(function(item) {
                if (!item || !item.tit) return;
                if (item.completed) return;
                const dueDate = parseDueParts(item.due);
                if (!dueDate) return;
                const dueStart = new Date(
                    dueDate.getFullYear(),
                    dueDate.getMonth(),
                    dueDate.getDate()
                ).getTime();
                const todayStart = startOfToday.getTime();
                const bucketEntry = {
                    item: item,
                    project: projectName,
                    due: new Date(dueStart),
                };
                if (dueStart < todayStart) {
                    overdue.push(bucketEntry);
                } else if (dueStart === todayStart) {
                    today.push(bucketEntry);
                } else if (dueStart <= upcomingCutoff.getTime()) {
                    upcoming.push(bucketEntry);
                }
            });
        });

        const sortFn = function(a, b) {
            const diff = a.due.getTime() - b.due.getTime();
            if (diff !== 0) return diff;
            return String(a.item.tit).localeCompare(String(b.item.tit));
        };
        overdue.sort(sortFn);
        today.sort(sortFn);
        upcoming.sort(sortFn);

        return {
            overdue: overdue,
            today: today,
            upcoming: upcoming,
            counts: {
                overdue: overdue.length,
                today: today.length,
                upcoming: upcoming.length,
            },
        };
    }


    // ── CALENDAR MONTH AGGREGATION ──────────────────────────────────
    // Build the month-grid payload for the Calendar view. Returns a map
    // keyed by ISO `YYYY-MM-DD` strings, where each value is an array of
    // `{ item, project }` entries for the incomplete todos due on that
    // date. The returned keys span every cell of the visible grid: the
    // first day of the month is back-aligned to the prior Sunday (so the
    // grid starts on a Sunday column), and the last day of the month is
    // forward-aligned to the following Saturday — leading/trailing days
    // from adjacent months are included so the grid is always complete.
    // Dates with no incomplete todos still appear as keys with an empty
    // array so the renderer can iterate the grid by looking up each cell
    // without missing-key fallbacks. Completed todos and items with no
    // due date are excluded.
    function getCalendarMonth(year, month) {
        const yr = parseInt(year, 10);
        const mn = parseInt(month, 10);
        if (isNaN(yr) || isNaN(mn)) return {};

        const firstOfMonth = new Date(yr, mn, 1);
        const startOffset = firstOfMonth.getDay(); // 0 Sun .. 6 Sat
        const gridStart = new Date(yr, mn, 1 - startOffset);

        const lastOfMonth = new Date(yr, mn + 1, 0);
        const endOffset = 6 - lastOfMonth.getDay();
        const gridEnd = new Date(yr, mn, lastOfMonth.getDate() + endOffset);

        const msPerDay = 24 * 60 * 60 * 1000;
        const totalDays = Math.round((gridEnd.getTime() - gridStart.getTime()) / msPerDay) + 1;

        const result = {};
        for (let i = 0; i < totalDays; i++) {
            const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
            result[formatCalendarKey(d)] = [];
        }

        Object.keys(allProjects).forEach(function(projectName) {
            const entry = allProjects[projectName];
            if (!entry || !Array.isArray(entry.items)) return;
            entry.items.forEach(function(item) {
                if (!item || !item.tit) return;
                if (item.completed) return;
                const dueDate = parseDueParts(item.due);
                if (!dueDate) return;
                const key = formatCalendarKey(dueDate);
                if (Object.prototype.hasOwnProperty.call(result, key)) {
                    result[key].push({ item: item, project: projectName });
                }
            });
        });

        return result;
    }


    // ── DUE-ON-DATE QUERY ──────────────────────────────────────────
    // Returns every incomplete todo whose due date matches the supplied
    // date. The argument is the ISO `YYYY-MM-DD` calendar key used by the
    // Calendar grid (formatCalendarKey). Returns an array of
    // `{ item, project }` entries sorted by project name (then position
    // within the project) so the mobile Today tab renders a stable order
    // across re-paints. Items with no due date and completed items are
    // excluded; the bottom-tab Today destination shows only what is
    // strictly due today, not the broader overdue/upcoming buckets.
    function getAllTodosDueOn(dateISO) {
        if (typeof dateISO !== 'string') return [];
        const parts = dateISO.split('-');
        if (parts.length !== 3) return [];
        const y = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10);
        const d = parseInt(parts[2], 10);
        if (isNaN(y) || isNaN(m) || isNaN(d)) return [];
        const targetKey = formatCalendarKey(new Date(y, m - 1, d));

        const out = [];
        const projectNames = Object.keys(allProjects).sort();
        projectNames.forEach(function(projectName) {
            const entry = allProjects[projectName];
            if (!entry || !Array.isArray(entry.items)) return;
            entry.items.forEach(function(item) {
                if (!item || !item.tit) return;
                if (item.completed) return;
                const dueDate = parseDueParts(item.due);
                if (!dueDate) return;
                if (formatCalendarKey(dueDate) !== targetKey) return;
                out.push({ item: item, project: projectName });
            });
        });
        return out;
    }


    // Cross-project read backing the INBOX view: every committed, not-yet-
    // completed todo whose workflow status is 'idea', gathered from every
    // project, newest capture first. Mirrors getAllTodosDueOn's shape and
    // intent — it walks the same in-memory `allProjects` model the per-
    // project views render from, so the LIVE item reference is returned.
    // That live reference matters: the INBOX rows reuse the entry-#2 status
    // popover, which mutates the item in place through setToDoStatus, so the
    // returned object must be the same one the model holds (a detached
    // Supabase row would corrupt the persisted payload). Blank placeholders
    // (empty title) and completed items are skipped. Sorted by `created_at`
    // descending; items without a timestamp sort last so a legacy cache row
    // can't jump to the top. Returns an array of `{ item, project }`.
    function getIdeaTodosAcrossProjects() {
        const out = [];
        const projectNames = Object.keys(allProjects);
        projectNames.forEach(function(projectName) {
            const entry = allProjects[projectName];
            if (!entry || !Array.isArray(entry.items)) return;
            entry.items.forEach(function(item) {
                if (!item || !item.tit) return;
                if (item.completed) return;
                if (normalizeTodoStatus(item.status) !== 'idea') return;
                out.push({ item: item, project: projectName });
            });
        });
        out.sort(function(a, b) {
            const ca = (a.item && a.item.created_at) || '';
            const cb = (b.item && b.item.created_at) || '';
            if (ca === cb) return 0;
            // Newest first; missing timestamps ('') sink to the bottom.
            if (!ca) return 1;
            if (!cb) return -1;
            return ca < cb ? 1 : -1;
        });
        return out;
    }


    function _reset() {
        Object.keys(allProjects).forEach(function(k) { delete allProjects[k]; });
        localStorage.clear();
        allProjectsTotal = 0;
    }


    // ── FIRST-RUN SAMPLE PROJECT ──────────────────────────────────────
    // Seed a "Getting started" sample project with a handful of starter
    // todos so the welcome coachmark tour has live DOM targets to anchor
    // to. Gated on a separate todoapp_sampleSeeded flag (independent of
    // the onboarding-complete flag) so a user who deletes the sample
    // doesn't get it back on the next load. Returns true when a seed
    // was written.
    //
    // Pass `{ force: true }` to bypass the once-per-install flag — the
    // replay-tour path uses this so the tour always has real targets to
    // anchor to. The "don't clobber real data" guard (projects already
    // exist) still applies in force mode; the caller is responsible for
    // skipping the call when the user has their own projects so a sample
    // can't surprise-appear.
    // @category: user-mutation-only
    function seedSampleProject(options) {
        const force = options && options.force === true;
        if (!force && isSampleSeeded()) return false;
        if (Object.keys(allProjects).length > 0) return false;

        const name = 'Getting started';
        const blank = toDo('', '', '', 1, 0);
        const sampleItems = [
            blank,
            toDo(
                'Welcome — check the box to mark a task complete',
                '',
                '',
                1,
                0
            ),
            toDo(
                'Click the date pill to set a due date',
                '',
                '',
                1,
                0
            ),
            toDo(
                'Click the chevron to add notes here',
                'Descriptions live in this panel — great for links, references, or longer thoughts. Press Ctrl/Cmd + Enter to expand every row at once.',
                '',
                1,
                0
            ),
            toDo(
                'Rename or delete this project when you\'re ready',
                '',
                '',
                1,
                0
            ),
        ];

        const projectId = genId();
        allProjects[name] = { id: projectId, items: sampleItems, color: null, sortByDue: false, target_id: null };
        allProjectsTotal = Object.keys(allProjects).length;

        saveToStorage();
        setSampleSeeded(true);
        persistMutation({
            op: 'insert',
            table: 'projects',
            payload: toProjectRowPayload(
                allProjects[name],
                name,
                allProjectsTotal - 1
            ),
        });
        sampleItems.forEach(function(it) {
            if (!it || it.tit === '') return;
            persistMutation({
                op: 'insert',
                table: 'todos',
                payload: toTodoRowPayload(it, projectId),
            });
        });
        return true;
    }


    // Append the same four starter todos seedSampleProject ships into an
    // existing project that currently has zero real (titled) items. Backs
    // the replay-tour path: when the user has a project of their own but
    // hasn't added any todos yet, the desktop coachmark steps that anchor
    // against per-row chrome (#duePill, #descToggle) need a real titled
    // row to point at. Reuses the existing addToDo path so the
    // single-blank-placeholder invariant is preserved; the chevron row
    // then has its description backfilled so step 3 has substance to
    // open. Returns true when seeding ran, false when the project is
    // missing or already has any titled item.
    // @category: user-mutation-only
    function seedSampleTodos(projectName) {
        const entry = allProjects[projectName];
        if (!entry || !Array.isArray(entry.items)) return false;
        if (entry.items.some(function(it) { return it && it.tit !== ''; })) {
            return false;
        }

        const chevronTitle = 'Click the chevron to add notes here';
        const titles = [
            'Welcome — check the box to mark a task complete',
            'Click the date pill to set a due date',
            chevronTitle,
            'Rename or delete this project when you\'re ready',
        ];
        titles.forEach(function(t) {
            addToDo(projectName, t);
        });

        const items = entry.items;
        let chevronItem = null;
        for (let i = 0; i < items.length; i++) {
            if (items[i].tit === chevronTitle) {
                items[i].desc = 'Descriptions live in this panel — great for links, references, or longer thoughts. Press Ctrl/Cmd + Enter to expand every row at once.';
                chevronItem = items[i];
                break;
            }
        }
        saveToStorage();
        if (chevronItem && chevronItem.id) {
            persistMutation({
                op: 'update',
                table: 'todos',
                payload: toTodoRowPayload(chevronItem, entry.id || null),
            });
        }
        return true;
    }


    // Wipe all in-memory + persisted project state and replace it with the
    // given list. Used by the JSON import flow (validation lives next to the
    // import handler; once the file is accepted the entire project tree is
    // overwritten in one pass — no partial-overwrite states, per the task
    // spec). Accepts an array of `{ name, items, color }` entries; falls back
    // to safe defaults on missing fields so a slightly-off import file can't
    // brick the app. Returns the count of projects that were written.
    //
    // `opts.fromSync: true` flags the replace as reconciliation work the
    // Supabase backend already knows about, so per-row persistMutation
    // mirror writes are suppressed.
    // @category: sync-safe
    function replaceAllProjects(projects, opts) {

        if (!Array.isArray(projects)) return 0;

        Object.keys(allProjects).forEach(function(k) { delete allProjects[k]; });

        projects.forEach(function(entry) {
            if (!entry || typeof entry !== 'object') return;
            const name = typeof entry.name === 'string' ? entry.name.trim() : '';
            if (name.length === 0) return;
            // Reject duplicate names — last-wins would silently destroy data,
            // so the import surfaces it as a missing project the user can
            // re-export and re-import after fixing.
            if (Object.prototype.hasOwnProperty.call(allProjects, name)) return;

            const items = Array.isArray(entry.items) ? entry.items : [];
            let color = entry.color;
            if (typeof color !== 'string' && color !== null) color = null;
            if (typeof color === 'string' && PROJECT_COLOR_KEYS.indexOf(color) === -1) {
                color = null;
            }

            // Sanitize each item the same way the load-time path does so a
            // hand-edited or older-version export can't pass corrupt fields
            // (NaN dates, missing completed flag, malformed recurrence) into
            // the renderer.
            items.forEach(function(item) {
                if (!item || typeof item !== 'object') return;
                if (typeof item.completed !== 'boolean') item.completed = false;
                if (item.recurrence === undefined) {
                    item.recurrence = null;
                } else if (item.recurrence !== null) {
                    item.recurrence = sanitizeRecurrence(item.recurrence);
                }
                if (!item.id) item.id = genId();
                if (!item.due || item.due === '' || item.due === '--' || item.due === 'X-X-XXXX') return;
                const parts = String(item.due).split('-');
                const m = parseInt(parts[0], 10);
                const d = parseInt(parts[1], 10);
                const y = parseInt(parts[2], 10);
                if (isNaN(m) || isNaN(d) || isNaN(y)) item.due = '';
            });

            const sortByDue = typeof entry.sortByDue === 'boolean' ? entry.sortByDue : false;
            const hideDates = typeof entry.hideDates === 'boolean' ? entry.hideDates : false;
            const lifecycle = (typeof entry.lifecycle === 'string' && entry.lifecycle.length > 0)
                ? entry.lifecycle
                : DEFAULT_LIFECYCLE;
            const stages = normalizeStages(entry.stages, lifecycle);
            allProjects[name] = { id: genId(), items: items, color: color, sortByDue: sortByDue, hideDates: hideDates, target_id: null, stages: stages, lifecycle: lifecycle };
            sortCompletedInPlace(allProjects[name].items);
        });

        allProjectsTotal = Object.keys(allProjects).length;
        saveToStorage(opts);

        // Backend translation of "wipe + bulk-insert". The persistMutation
        // truncate path removes every existing row for the user; the
        // bulkInsert paths write the new tree under their new UUIDs.
        // Sequencing matters — truncate must finish before the inserts
        // land or the inserts race against the delete on the same user_id.
        (async function rebuildSupabase() {
            try {
                await persistMutation({ op: 'truncate', table: 'todos' });
                await persistMutation({ op: 'truncate', table: 'projects' });
                const projectRows = [];
                const todoRows = [];
                Object.keys(allProjects).forEach(function(name, idx) {
                    const entry = allProjects[name];
                    projectRows.push(toProjectRowPayload(entry, name, idx));
                    entry.items.forEach(function(it, itemIdx) {
                        if (!it || it.tit === '') return;
                        it.pos = itemIdx;
                        todoRows.push(toTodoRowPayload(it, entry.id));
                    });
                });
                if (projectRows.length > 0) {
                    // bulkInsert payload shape: { rows: [...] }; per-row
                    // mapping inside persistMutation handles user_id and
                    // any field translation. But persistMutation's
                    // bulkInsert variant inserts the rows as-is — bypass
                    // it and fan out to per-row inserts so the same
                    // payload-translation path runs.
                    projectRows.forEach(function(p) {
                        persistMutation({
                            op: 'insert',
                            table: 'projects',
                            payload: p,
                        });
                    });
                }
                todoRows.forEach(function(t) {
                    persistMutation({
                        op: 'insert',
                        table: 'todos',
                        payload: t,
                    });
                });
            } catch (e) {
                console.warn('[replaceAllProjects] backend rebuild failed:', e);
            }
        })();

        return allProjectsTotal;
    }


    // Snapshot the current project tree as a plain array of
    // `{ name, items, color, sortByDue, hideDates, target_id, stages, lifecycle }`
    // entries — the shape consumed by replaceAllProjects and the export
    // file. Iteration order matches Object.keys(allProjects), preserving
    // the user's project order.
    function snapshotProjects() {
        return Object.keys(allProjects).map(function(name) {
            const entry = allProjects[name];
            return {
                name: name,
                items: Array.isArray(entry.items) ? entry.items.slice() : [],
                color: entry.color || null,
                sortByDue: !!entry.sortByDue,
                hideDates: !!entry.hideDates,
                target_id: entry.target_id || null,
                stages: Array.isArray(entry.stages) ? entry.stages.slice() : [],
                lifecycle: entry.lifecycle || DEFAULT_LIFECYCLE,
            };
        });
    }


    // ── SUPABASE PERSISTENCE LAYER ──────────────────────────────────
    // Phase 5 backend migration: every user-mutation funnel function
    // routes through persistMutation in addition to its existing
    // saveToStorage write. The localStorage write stays as the offline
    // cache; Supabase becomes the source of truth on next hydrate.
    //
    // persistMutation is fire-and-forget on the caller side — the in-
    // memory mutation already happened, the localStorage write already
    // ran, and the Supabase round-trip just mirrors that to the server.
    // Failures log via console.warn without rolling back (Phase 6 adds
    // an offline retry queue + a visible sync-issues indicator).
    //
    // Self-echo tracking: every id this client writes goes into the
    // _selfEchoIds set so the realtime subscription can ignore the
    // matching INSERT/UPDATE/DELETE events it sees flow back through
    // Postgres's logical replication. Without this filter, the client
    // would re-apply its own writes and bounce its own optimistic state.
    const _selfEchoIds = new Set();
    let _realtimeChannels = [];

    // Tracks whether realtime channels are wanted — set true once
    // subscribeToRealtime establishes channels (only reached at boot
    // after the session is confirmed), cleared on sign-out. resubscribe-
    // ToRealtime gates on this so a wake trigger can't open channels for
    // a signed-out user.
    let _realtimeWanted = false;

    // In-flight project INSERT promises keyed by project id. Any todo
    // operation referencing one of these ids awaits the parent INSERT
    // before issuing its own request, so the FK relationship is
    // established on the server before the child row arrives. Without
    // this gate, a fast "create project → commit todo" sequence on
    // mobile (where network reordering and tab-suspension are common)
    // can let the child INSERT reach Supabase first; the server rejects
    // it with a foreign-key constraint violation and the row is
    // silently dropped — the user then sees the project rehydrate
    // empty on the next reload.
    const _pendingProjectInserts = new Map();

    function noteSelfEcho(id) {
        if (!id) return;
        _selfEchoIds.add(id);
    }

    async function persistMutation(req) {

        if (!req || !req.op || !req.table) return;
        try {
            const sessionResult = await supabase.auth.getSession();
            const session = sessionResult
                && sessionResult.data
                && sessionResult.data.session;
            if (!session) return;
            const userId = session.user.id;

            const op = req.op;
            const table = req.table;
            const payload = req.payload || {};
            console.log('[persistMutation] called:', op, table, JSON.stringify(payload));

            // FK ordering gate: serialize child todo writes behind any
            // in-flight INSERT for the same project so the parent row
            // always lands first.
            if (table === 'todos' && payload && payload.project_id) {
                const pending = _pendingProjectInserts.get(payload.project_id);
                if (pending) {
                    try {
                        await pending;
                    } catch (_) {
                        // The project INSERT's own failure is logged
                        // by its own persistMutation call; let this
                        // todo write attempt anyway so the rest of the
                        // mutation path stays uniform.
                    }
                }
            }

            if (op === 'insert') {
                let row;
                if (table === 'projects') {
                    row = {
                        id: payload.id,
                        user_id: userId,
                        name: payload.name,
                        color: payload.color || null,
                        position: payload.position == null ? 0 : payload.position,
                        target_id: payload.target_id || null,
                        stages: payload.stages || null,
                        lifecycle: payload.lifecycle || DEFAULT_LIFECYCLE,
                        hide_dates: !!payload.hide_dates,
                    };
                } else if (table === 'todos') {
                    // DO NOT add user_id to todos queries or payloads —
                    // see tests/listLogicSchema.test.js. The todos table
                    // has no user_id column; per-user access is enforced
                    // by RLS via a sub-select against the parent project.
                    //
                    // Blank-placeholder filter at the persistence boundary
                    // — these are render artifacts, not real rows. The
                    // payload arrives already in Supabase column shape
                    // (built by toTodoRowPayload), so the check is on
                    // `title` not the in-memory `tit`.
                    if (!payload.title || payload.title === '') return;
                    row = {
                        id: payload.id,
                        project_id: payload.project_id,
                        title: payload.title,
                        description: payload.description || null,
                        due_date: payload.due_date,
                        priority: payload.priority == null ? null : String(payload.priority),
                        position: payload.position,
                        completed: !!payload.completed,
                        status: normalizeTodoStatus(payload.status),
                        recurrence: payload.recurrence || null,
                    };
                    // Only forward the entry marker id when set: this keeps the
                    // write compatible with a server that predates the nullable
                    // entry_id column — todos without an id (the vast majority)
                    // upsert exactly as before, so the sync degrades gracefully
                    // rather than failing every write on an unknown column.
                    if (payload.entry_id) row.entry_id = payload.entry_id;
                    // Same graceful-degradation contract for the acknowledgement
                    // timestamp: forward only when set.
                    if (payload.entry_reviewed_at) row.entry_reviewed_at = payload.entry_reviewed_at;
                } else {
                    return;
                }
                noteSelfEcho(row.id);

                // Wrap the builder in a real Promise so child todo
                // writes that await this entry via the FK gate hit
                // cached resolution rather than re-triggering the
                // underlying request.
                const insertPromise = Promise.resolve(supabase.from(table).insert(row));
                if (table === 'projects' && row.id) {
                    _pendingProjectInserts.set(row.id, insertPromise);
                }

                let result;
                try {
                    result = await insertPromise;
                } finally {
                    if (table === 'projects' && row.id) {
                        _pendingProjectInserts.delete(row.id);
                    }
                }
                if (result && result.error) {
                    console.warn('[persistMutation] insert error:', result.error);
                }
                return result;
            }

            if (op === 'update') {
                if (!payload.id) return;
                let row;
                if (table === 'projects') {
                    row = {
                        name: payload.name,
                        color: payload.color || null,
                        position: payload.position == null ? 0 : payload.position,
                        target_id: payload.target_id || null,
                        stages: payload.stages || null,
                        lifecycle: payload.lifecycle || DEFAULT_LIFECYCLE,
                        hide_dates: !!payload.hide_dates,
                    };
                } else if (table === 'todos') {
                    // DO NOT add user_id to todos queries or payloads —
                    // see tests/listLogicSchema.test.js. The todos table
                    // has no user_id column; per-user access is enforced
                    // by RLS via a sub-select against the parent project.
                    row = {
                        project_id: payload.project_id,
                        title: payload.title,
                        description: payload.description || null,
                        due_date: payload.due_date,
                        priority: payload.priority == null ? null : String(payload.priority),
                        position: payload.position,
                        completed: !!payload.completed,
                        status: normalizeTodoStatus(payload.status),
                        recurrence: payload.recurrence || null,
                    };
                    // See the insert path: forward entry_id only when set so the
                    // update stays compatible with a pre-migration server.
                    if (payload.entry_id) row.entry_id = payload.entry_id;
                    if (payload.entry_reviewed_at) row.entry_reviewed_at = payload.entry_reviewed_at;
                } else {
                    return;
                }
                noteSelfEcho(payload.id);
                const result = await supabase
                    .from(table)
                    .update(row)
                    .eq('id', payload.id);
                if (result && result.error) {
                    console.warn('[persistMutation] update error:', result.error);
                }
                return result;
            }

            if (op === 'delete') {
                if (!payload.id) return;
                noteSelfEcho(payload.id);
                const result = await supabase
                    .from(table)
                    .delete()
                    .eq('id', payload.id);
                if (result && result.error) {
                    console.warn('[persistMutation] delete error:', result.error);
                }
                return result;
            }

            if (op === 'truncate') {
                const result = await supabase
                    .from(table)
                    .delete()
                    .eq('user_id', userId);
                if (result && result.error) {
                    console.warn('[persistMutation] truncate error:', result.error);
                }
                return result;
            }

            if (op === 'bulkInsert') {
                const rows = Array.isArray(payload.rows) ? payload.rows : [];
                if (rows.length === 0) return;
                rows.forEach(function(r) { noteSelfEcho(r.id); });
                const result = await supabase.from(table).insert(rows);
                if (result && result.error) {
                    console.warn('[persistMutation] bulkInsert error:', result.error);
                }
                return result;
            }
        } catch (e) {
            console.warn('[persistMutation] failed:', e);
        }
    }

    // Single-flight guard: after magic-link sign-in, hydrateFromSupabase
    // is invoked twice in the same tick — once by the initial boot path
    // and once by the SIGNED_IN auth listener — and the overlap can wipe
    // the sidebar mid-merge. A subsequent (non-overlapping) call still
    // runs, because `finally` releases the flag.
    let hydrationInFlight = false;

    // Snapshot of the project ids the server acknowledged on the previous
    // successful hydrate. Lets the next hydrate tell a project the server
    // deleted (id was in this snapshot, now absent from the remote
    // response) apart from one created offline (id never in the snapshot).
    // Stored as a JSON id array under the todoapp_ prefix convention.
    const LAST_SEEN_SERVER_PROJECT_IDS_KEY = 'todoapp_lastSeenServerProjectIds';

    function readLastSeenServerProjectIds() {
        try {
            const raw = localStorage.getItem(LAST_SEEN_SERVER_PROJECT_IDS_KEY);
            if (!raw) return new Set();
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? new Set(arr) : new Set();
        } catch (_) {
            return new Set();
        }
    }

    function writeLastSeenServerProjectIds(ids) {
        try {
            localStorage.setItem(
                LAST_SEEN_SERVER_PROJECT_IDS_KEY,
                JSON.stringify(Array.isArray(ids) ? ids : [])
            );
        } catch (_) { /* ignore */ }
    }

    // Reconcile the offline cache against Supabase. Runs once after the
    // auth gate confirms a session. Strategy:
    //   • Pull all of the user's projects + todos from Supabase
    //   • Walk both sides: remote-only → adopt, local-only → push,
    //     intersection → last-write-wins on updated_at when present
    //   • Rewrite allProjects in place, persist the merged tree to
    //     localStorage, then dispatch listLogicHydrated for the UI to
    //     do a one-shot full re-render.
    //
    // Blank placeholders are re-pinned to index 0 of every project's
    // items array via sortCompletedInPlace — they never round-trip
    // through Supabase (the filter is inside persistMutation).
    async function hydrateFromSupabase() {
        if (hydrationInFlight) return;
        hydrationInFlight = true;
        try {
            const sessionResult = await supabase.auth.getSession();
            const session = sessionResult
                && sessionResult.data
                && sessionResult.data.session;
            if (!session) return;
            const userId = session.user.id;

            const projRes = await supabase
                .from('projects')
                .select('*')
                .eq('user_id', userId)
                .order('position', { ascending: true });

            // DO NOT add user_id to todos queries or payloads — see
            // tests/listLogicSchema.test.js. The todos table has no
            // user_id column; per-user access is enforced by RLS
            // through a sub-select against the parent project, so
            // filtering server-side by user is automatic and the
            // client-side query stays scoped to project_id only.
            const todoRes = await supabase
                .from('todos')
                .select('*')
                .order('position', { ascending: true });

            if (projRes && projRes.error) {
                console.warn('[hydrateFromSupabase] projects error:', projRes.error);
                return;
            }
            if (todoRes && todoRes.error) {
                console.warn('[hydrateFromSupabase] todos error:', todoRes.error);
                return;
            }

            const remoteProjects = (projRes && projRes.data) || [];
            const remoteTodos = (todoRes && todoRes.data) || [];

            const remoteByName = {};
            const remoteById = {};
            remoteProjects.forEach(function(p) {
                remoteByName[p.name] = p;
                remoteById[p.id] = p;
            });

            // Index local entries by their stable id so reconciliation can
            // match a remote row to its local counterpart even after a
            // rename (when name no longer agrees but id still does). Keying
            // by name here is what produced the cross-device duplicate.
            const localById = {};
            Object.keys(allProjects).forEach(function(name) {
                const e = allProjects[name];
                if (e && e.id) localById[e.id] = { name: name, entry: e };
            });

            // Index local todo items by their stable id so the merge below can
            // preserve a locally-known entry id when the remote row's entry_id
            // column is null (a server row that predates the migration). Without
            // this, hydrating a pre-migration row would drop the id and the
            // run-status glyph would vanish until the next mutation pushed it up.
            const localTodosById = {};
            Object.keys(allProjects).forEach(function(name) {
                const items = allProjects[name] && allProjects[name].items;
                if (Array.isArray(items)) {
                    items.forEach(function(it) {
                        if (it && it.id) localTodosById[it.id] = it;
                    });
                }
            });

            // Server-acknowledged project ids from the previous hydrate.
            const lastSeenServerProjectIds = readLastSeenServerProjectIds();

            const todosByProjectId = {};
            remoteTodos.forEach(function(t) {
                if (!todosByProjectId[t.project_id]) {
                    todosByProjectId[t.project_id] = [];
                }
                todosByProjectId[t.project_id].push(t);
            });

            const merged = {};

            // Adopt remote projects, with last-write-wins reconciliation
            // against the local cache when the same name exists on both
            // sides. updated_at comparison drives the pick; the loser is
            // mirrored back into Supabase so the two sides converge.
            remoteProjects.forEach(function(p) {
                // Match by stable id first (survives a rename), falling
                // back to name for rows that predate id-stamping.
                const byId = localById[p.id];
                const localEntry = byId ? byId.entry : allProjects[p.name];
                const remoteUpdatedAt = p.updated_at ? Date.parse(p.updated_at) : 0;
                const localUpdatedAt = (localEntry && localEntry.updated_at)
                    ? Date.parse(localEntry.updated_at)
                    : 0;
                let chosenColor = p.color;
                // Stages/lifecycle ride the project row's whole-row LWW just
                // like color: adopt the remote values (backfilling the SDLC
                // default when the server row predates the columns and
                // returns null), but keep the local copy when the local
                // entry is the newer write.
                let chosenStages = stagesFromRow(p);
                let chosenLifecycle = lifecycleFromRow(p);
                // hideDates rides the whole-row LWW like color: adopt the
                // remote value, but keep the local copy when the local entry
                // is the newer write.
                let chosenHideDates = !!p.hide_dates;
                if (localEntry && localUpdatedAt > remoteUpdatedAt) {
                    chosenColor = localEntry.color;
                    if (Array.isArray(localEntry.stages) && localEntry.stages.length > 0) {
                        chosenStages = localEntry.stages;
                    }
                    if (localEntry.lifecycle) chosenLifecycle = localEntry.lifecycle;
                    chosenHideDates = !!localEntry.hideDates;
                }
                merged[p.name] = {
                    id: p.id,
                    items: [],
                    color: chosenColor || null,
                    sortByDue: !!(localEntry && localEntry.sortByDue),
                    hideDates: chosenHideDates,
                    target_id: p.target_id || null,
                    stages: chosenStages,
                    lifecycle: chosenLifecycle,
                };
                const rows = todosByProjectId[p.id] || [];
                rows.forEach(function(t) {
                    merged[p.name].items.push({
                        id: t.id,
                        tit: t.title || '',
                        desc: t.description || '',
                        due: isoToDueString(t.due_date),
                        pri: t.priority == null ? 1 : t.priority,
                        pos: t.position == null ? 0 : t.position,
                        completed: !!t.completed,
                        status: normalizeTodoStatus(t.status),
                        recurrence: t.recurrence || null,
                        // Round-trip the injected-entry marker id so the row's
                        // run-status glyph resolves cross-device. When the
                        // column is null (server predates the migration), fall
                        // back to a locally-known id so pre-migration rows keep
                        // their glyph through the transition and push it up on
                        // the next mutation; still undefined when neither has it.
                        entryId: t.entry_id
                            || (localTodosById[t.id] && localTodosById[t.id].entryId)
                            || undefined,
                        // Round-trip the acknowledgement timestamp so the derived
                        // REVIEW badge stays cleared cross-device. Falls back to a
                        // locally-known value when the server column is null.
                        entryReviewedAt: t.entry_reviewed_at
                            || (localTodosById[t.id] && localTodosById[t.id].entryReviewedAt)
                            || undefined,
                        created_at: t.created_at || null,
                    });
                });
            });

            // Push local-only projects up to Supabase. Their todos go
            // through persistMutation one-by-one (blank placeholders
            // are filtered inside persistMutation, so the no-op cost
            // is paid there).
            Object.keys(allProjects).forEach(function(name) {
                if (remoteByName[name]) return;
                const local = allProjects[name];
                // A renamed project is adopted above under its new remote
                // name; its old local name reaches here as "local-only".
                // Skip it when its id already exists remotely so it is not
                // re-INSERTed (which would collide on the id primary key
                // and leave a duplicate under the stale name).
                if (local.id && remoteById[local.id]) return;
                // Cross-device deletion: this id was acknowledged by the
                // server on a prior hydrate (it's in the snapshot) but is
                // absent from the current remote response — the server
                // removed it on another device. Drop the entry from the
                // merged tree and skip the INSERT that would resurrect it.
                // Its todos live nested under the entry, so omitting the
                // entry cascade-drops them to match the server's cascade.
                if (local.id && lastSeenServerProjectIds.has(local.id) && !remoteById[local.id]) {
                    return;
                }
                if (!local.id) local.id = genId();
                merged[name] = {
                    id: local.id,
                    items: Array.isArray(local.items) ? local.items.slice() : [],
                    color: local.color || null,
                    sortByDue: !!local.sortByDue,
                    hideDates: !!local.hideDates,
                    target_id: local.target_id || null,
                    stages: stagesFromRow(local),
                    lifecycle: lifecycleFromRow(local),
                };
                persistMutation({
                    op: 'insert',
                    table: 'projects',
                    payload: toProjectRowPayload(merged[name], name, 0),
                });
                merged[name].items.forEach(function(it, idx) {
                    if (!it.id) it.id = genId();
                    it.pos = idx;
                    persistMutation({
                        op: 'insert',
                        table: 'todos',
                        payload: toTodoRowPayload(it, local.id),
                    });
                });
            });

            // Rewrite allProjects in place so any external references
            // to the same object survive.
            Object.keys(allProjects).forEach(function(k) { delete allProjects[k]; });
            Object.keys(merged).forEach(function(name) {
                allProjects[name] = merged[name];
                sortCompletedInPlace(allProjects[name].items);
            });

            allProjectsTotal = Object.keys(allProjects).length;
            saveFromRealtime({ fromSync: true });

            // Refresh the baseline so the next hydrate measures deletions
            // against the server set this run actually saw.
            writeLastSeenServerProjectIds(remoteProjects.map(function(p) { return p.id; }));

            if (typeof document !== 'undefined' && typeof CustomEvent === 'function') {
                try {
                    document.dispatchEvent(new CustomEvent('listLogicHydrated'));
                } catch (_) { /* ignore */ }
            }
        } catch (e) {
            console.warn('[hydrateFromSupabase] failed:', e);
        } finally {
            hydrationInFlight = false;
        }
    }

    // Subscribe to realtime change streams on the user's projects and
    // todos tables. Two channels — one per table — so a temporary glitch
    // on one stream doesn't take down both. Self-echo filtering happens
    // via _selfEchoIds: any id that this client wrote recently is in the
    // set, and the corresponding event is dropped without re-applying.
    function subscribeToRealtime() {
        if (_realtimeChannels.length > 0) return;
        if (!supabase || typeof supabase.channel !== 'function') return;

        try {
            const projectsChannel = supabase
                .channel('public:projects')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'projects' },
                    handleProjectsRealtime)
                .subscribe();
            const todosChannel = supabase
                .channel('public:todos')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'todos' },
                    handleTodosRealtime)
                .subscribe();
            _realtimeChannels.push(projectsChannel, todosChannel);
            _realtimeWanted = true;
        } catch (e) {
            console.warn('[subscribeToRealtime] failed:', e);
        }
    }

    // Re-open the realtime channels after a wake (return-to-visible or
    // network restore). A backgrounded PWA or sleeping desktop tab can
    // silently drop the websocket, leaving the channels stale with no
    // recovery; tearing them down and re-subscribing resumes live push.
    // The co-firing re-hydrate backfills whatever was missed during the
    // gap, so an unconditional teardown+re-open on wake is acceptable.
    function resubscribeToRealtime() {
        // No-op when signed out — never open channels without a session.
        if (!_realtimeWanted) return;
        // Inline only the channel-removal loop here — the self-echo set and
        // the in-memory project cache are deliberately left untouched (those
        // are torn down on sign-out, not on a wake). subscribeToRealtime
        // early-returns when _realtimeChannels.length > 0, so the array
        // MUST be reset before re-subscribing or the re-open no-ops.
        _realtimeChannels.forEach(function(ch) {
            try {
                if (supabase && typeof supabase.removeChannel === 'function') {
                    supabase.removeChannel(ch);
                }
            } catch (_) { /* ignore */ }
        });
        _realtimeChannels = [];
        subscribeToRealtime();
    }

    // Thin wrapper around saveToStorage so the realtime handlers stay
    // out of the @category contract (their Supabase-fixed `(evt)`
    // signature doesn't accept an opts parameter the audit could
    // detect). Routing through this helper keeps the fromSync flag
    // visible at every call site that mirrors an incoming server
    // change into localStorage.
    // @category: sync-safe
    function saveFromRealtime(opts) {
        saveToStorage(opts);
    }

    function handleProjectsRealtime(evt) {
        if (!evt) return;
        const row = evt.new || evt.old;
        if (!row || !row.id) return;
        if (_selfEchoIds.has(row.id)) {
            _selfEchoIds.delete(row.id);
            return;
        }
        if (evt.eventType === 'INSERT' || evt.eventType === 'UPDATE') {
            const name = evt.new && evt.new.name;
            if (!name) return;
            // Locate the existing entry by stable id first so a rename
            // (same id, new name) updates in place rather than spawning a
            // second entry under the new name and orphaning the old one.
            // Fall back to name for rows that predate id-stamping.
            let existingName = null;
            const keys = Object.keys(allProjects);
            for (let i = 0; i < keys.length; i++) {
                if (allProjects[keys[i]].id === evt.new.id) {
                    existingName = keys[i];
                    break;
                }
            }
            if (existingName === null && allProjects[name]) existingName = name;
            if (existingName !== null) {
                const existing = allProjects[existingName];
                existing.color = evt.new.color || null;
                existing.id = evt.new.id;
                existing.target_id = evt.new.target_id || null;
                // A hide-dates toggle made on another device arrives as a
                // project UPDATE — apply it live so the pills appear/disappear.
                existing.hideDates = !!evt.new.hide_dates;
                // A stage edit made on another device arrives as a project
                // UPDATE — apply it live (same null→SDLC backfill as hydrate).
                existing.stages = stagesFromRow(evt.new);
                existing.lifecycle = lifecycleFromRow(evt.new);
                if (existingName !== name) {
                    // Rename in place: move the entry (with its items) to
                    // the new name key and drop the stale one.
                    delete allProjects[existingName];
                    allProjects[name] = existing;
                }
            } else {
                allProjects[name] = {
                    id: evt.new.id,
                    items: [],
                    color: evt.new.color || null,
                    sortByDue: false,
                    hideDates: !!evt.new.hide_dates,
                    target_id: evt.new.target_id || null,
                    stages: stagesFromRow(evt.new),
                    lifecycle: lifecycleFromRow(evt.new),
                };
                sortCompletedInPlace(allProjects[name].items);
            }
        } else if (evt.eventType === 'DELETE') {
            const oldId = evt.old && evt.old.id;
            Object.keys(allProjects).forEach(function(name) {
                if (allProjects[name].id === oldId) delete allProjects[name];
            });
        }
        saveFromRealtime({ fromSync: true });
    }

    function handleTodosRealtime(evt) {
        if (!evt) return;
        const row = evt.new || evt.old;
        if (!row || !row.id) return;
        if (_selfEchoIds.has(row.id)) {
            _selfEchoIds.delete(row.id);
            return;
        }
        const findProjectByPid = function(pid) {
            const names = Object.keys(allProjects);
            for (let i = 0; i < names.length; i++) {
                if (allProjects[names[i]].id === pid) return allProjects[names[i]];
            }
            return null;
        };
        if (evt.eventType === 'INSERT' || evt.eventType === 'UPDATE') {
            const proj = findProjectByPid(evt.new.project_id);
            if (!proj) return;
            const idx = proj.items.findIndex(function(i) { return i.id === evt.new.id; });
            const mapped = {
                id: evt.new.id,
                tit: evt.new.title || '',
                desc: evt.new.description || '',
                due: isoToDueString(evt.new.due_date),
                pri: evt.new.priority == null ? 1 : evt.new.priority,
                pos: evt.new.position == null ? 0 : evt.new.position,
                completed: !!evt.new.completed,
                status: normalizeTodoStatus(evt.new.status),
                recurrence: evt.new.recurrence || null,
                created_at: evt.new.created_at || null,
            };
            // Carry the injected-entry marker id so the row's run-status glyph
            // resolves cross-device — but ONLY when the column is present, so an
            // unrelated UPDATE (which returns entry_id: null) never clobbers a
            // good local id via the Object.assign below.
            if (evt.new.entry_id) mapped.entryId = evt.new.entry_id;
            // Same guard for the acknowledgement timestamp: carry it only when
            // present so an unrelated UPDATE never clears a local acknowledgement.
            if (evt.new.entry_reviewed_at) mapped.entryReviewedAt = evt.new.entry_reviewed_at;
            if (idx === -1) {
                proj.items.push(mapped);
            } else {
                Object.assign(proj.items[idx], mapped);
            }
            sortCompletedInPlace(proj.items);
        } else if (evt.eventType === 'DELETE') {
            const oldId = evt.old.id;
            Object.keys(allProjects).forEach(function(name) {
                const arr = allProjects[name].items;
                const idx = arr.findIndex(function(i) { return i.id === oldId; });
                if (idx !== -1) {
                    arr.splice(idx, 1);
                    sortCompletedInPlace(arr);
                }
            });
        }
        saveFromRealtime({ fromSync: true });
    }

    // Sign-out hook: clear in-memory + cached state and tear down the
    // realtime subscriptions. The auth modal will be re-rendered by
    // index.js's onAuthStateChange listener.
    function handleSignOut() {
        _realtimeChannels.forEach(function(ch) {
            try {
                if (supabase && typeof supabase.removeChannel === 'function') {
                    supabase.removeChannel(ch);
                }
            } catch (_) { /* ignore */ }
        });
        _realtimeChannels = [];
        _realtimeWanted = false;
        _selfEchoIds.clear();

        Object.keys(allProjects).forEach(function(k) { delete allProjects[k]; });
        try { localStorage.removeItem('allProjects'); } catch (_) { /* ignore */ }
        allProjectsTotal = 0;
    }


    return {
        addProject,
        removeProject,
        listProjects,
        listProjectsArray,
        addToDo,
        removeToDo,
        removeToDoByItem,
        insertToDoAt,
        commitBlankPlaceholder,
        editToDoItem,
        setToDoCompleted,
        setToDoStatus,
        editProject,
        listItems,
        projectLength,
        reorderProject,
        reorderToDo,
        sortCompletedToBottom,
        getProjectColor,
        getProjectId,
        flagTaskForAgent,
        answerAgentTask,
        setAgentRunState,
        getAspectSubmissions,
        setAspectSubmitted,
        loadLatestRefactorScan,
        loadLatestCapture,
        dismissRefactorCandidate,
        stampTodoEntryId,
        markEntryReviewed,
        getEntryReviewInfo,
        getTodoById,
        unflagAgentTask,
        setProjectColor,
        getProjectSortByDue,
        setProjectSortByDue,
        getProjectHideDates,
        setProjectHideDates,
        getProjectStages,
        getProjectLifecycle,
        setProjectStageBody,
        setProjectShape,
        promoteStageLine,
        appendConceiveLogEntry,
        getConceiveLog,
        getProjectTargetId,
        setProjectTargetId,
        clearProjectTargetId,
        getProjectIncompleteCount,
        PROJECT_COLOR_KEYS,
        saveToStorage,
        replaceAllProjects,
        snapshotProjects,
        setRecurrence,
        advanceRecurringTodo,
        getRecurringTaskStats,
        summarizeRecurringMissPattern,
        getTodayAggregation,
        getCalendarMonth,
        getAllTodosDueOn,
        getIdeaTodosAcrossProjects,
        seedSampleProject,
        seedSampleTodos,
        persistMutation,
        hydrateFromSupabase,
        subscribeToRealtime,
        resubscribeToRealtime,
        handleSignOut,
        _reset
    };

})();


// Short "Mon DD" formatter for miss-pattern callouts. Mirrors toDoRow's
// own formatShortDate but lives here so the listLogic helpers stay
// importable without reaching into the row module.
function formatMissShortDate(d) {
    return MISS_MONTH_SHORT[d.getMonth()] + ' ' + d.getDate();
}


// Sort-for-render helper used when a project's `sortByDue` toggle is on.
// Returns a new array (input is not mutated) with the blank placeholder
// pinned to index 0, uncompleted items sorted ascending by due date, and
// completed items grouped at the bottom in the same ascending-by-due
// order. Items without a due date sink to the bottom of their respective
// group so an unset row never displaces a row that has a date set. The
// underlying `pos` field is never touched — toggling sortByDue off
// restores the user's manual order intact.
export function sortItemsByDueForRender(items) {
    if (!Array.isArray(items)) return [];

    let blank = null;
    const uncompleted = [];
    const completed = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it) continue;
        if (it.tit === '' && !blank) {
            blank = it;
            continue;
        }
        if (it.completed) completed.push({ item: it, idx: i });
        else uncompleted.push({ item: it, idx: i });
    }

    const cmp = function(a, b) {
        const da = parseDueParts(a.item.due);
        const db = parseDueParts(b.item.due);
        if (da && db) {
            const diff = da.getTime() - db.getTime();
            if (diff !== 0) return diff;
            return a.idx - b.idx;
        }
        if (da && !db) return -1;
        if (!da && db) return 1;
        return a.idx - b.idx;
    };
    uncompleted.sort(cmp);
    completed.sort(cmp);

    const out = [];
    if (blank) out.push(blank);
    uncompleted.forEach(function(w) { out.push(w.item); });
    completed.forEach(function(w) { out.push(w.item); });
    return out;
}


// Sort-for-render helper used when the global task sort is set to 'status'.
// Returns a new array (input is not mutated) with the blank placeholder pinned
// to index 0, uncompleted items grouped by workflow status in the order
// in_progress → active → idea, and completed items grouped at the bottom in the
// same status order. Within each status group the items keep their existing
// array order (the manual `pos` order), so a hand-arranged sequence inside a
// status group is never destroyed by turning Status sort on — and because the
// underlying `pos` field is never touched, switching the sort back to 'none'
// restores the user's manual order intact. Cached todos lacking a status field
// normalise to 'active', matching the rest of the data model.
const STATUS_SORT_RANK = { in_progress: 0, active: 1, idea: 2 };
export function sortItemsByStatusForRender(items) {
    if (!Array.isArray(items)) return [];

    let blank = null;
    const uncompleted = [];
    const completed = [];
    for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it) continue;
        if (it.tit === '' && !blank) {
            blank = it;
            continue;
        }
        if (it.completed) completed.push({ item: it, idx: i });
        else uncompleted.push({ item: it, idx: i });
    }

    const cmp = function(a, b) {
        const ra = STATUS_SORT_RANK[normalizeTodoStatus(a.item.status)];
        const rb = STATUS_SORT_RANK[normalizeTodoStatus(b.item.status)];
        if (ra !== rb) return ra - rb;
        return a.idx - b.idx;
    };
    uncompleted.sort(cmp);
    completed.sort(cmp);

    const out = [];
    if (blank) out.push(blank);
    uncompleted.forEach(function(w) { out.push(w.item); });
    completed.forEach(function(w) { out.push(w.item); });
    return out;
}


// ── RECURRENCE PURE HELPERS ─────────────────────────────────────────
// Module-level exports so these are importable from tests and from any
// module that needs the date math without reaching through listLogic's
// closure. Pure functions only — no localStorage, no DOM.

// Pin the day-of-month after a month or year shift so e.g. Jan 31 → Feb 28
// (or Feb 29 in a leap year), Mar 31 → Apr 30, etc. Without this, the native
// Date setMonth/setFullYear rolls over into the next month.
function clampToMonthEnd(year, monthIdx, day) {
    const lastDay = new Date(year, monthIdx + 1, 0).getDate();
    return Math.min(day, lastDay);
}

function addMonths(date, months) {
    const targetMonth = date.getMonth() + months;
    const targetYear  = date.getFullYear() + Math.floor(targetMonth / 12);
    const wrappedMonth = ((targetMonth % 12) + 12) % 12;
    const day = clampToMonthEnd(targetYear, wrappedMonth, date.getDate());
    return new Date(targetYear, wrappedMonth, day);
}

function addYears(date, years) {
    const targetYear = date.getFullYear() + years;
    const day = clampToMonthEnd(targetYear, date.getMonth(), date.getDate());
    return new Date(targetYear, date.getMonth(), day);
}

function addDays(date, days) {
    const out = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    out.setDate(out.getDate() + days);
    return out;
}

// Parse storage-format "M-D-YYYY" or fall back to a Date instance.
function parseDueParts(due) {
    if (due instanceof Date) {
        return new Date(due.getFullYear(), due.getMonth(), due.getDate());
    }
    if (!due || typeof due !== 'string') return null;
    if (due === '' || due === '--' || due === 'X-X-XXXX') return null;
    const parts = due.split('-');
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
    return new Date(y, m - 1, d);
}

function formatDueParts(date) {
    return (date.getMonth() + 1) + '-' + date.getDate() + '-' + date.getFullYear();
}

// ISO YYYY-MM-DD key used by the Calendar month grid. Local fields only —
// the renderer compares against `new Date(y, m, d)` cells, so a UTC-based
// toISOString() would drift the key by a day in non-UTC timezones.
export function formatCalendarKey(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return y + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (d < 10 ? '0' + d : '' + d);
}

function parseEndDate(end) {
    if (!end) return null;
    if (end instanceof Date) return new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const parsed = new Date(end);
    if (isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

// Force the input recurrence into a known shape so downstream code can read
// it without defensive checks. Unknown patterns/units fall back to defaults.
export function sanitizeRecurrence(recurrence) {
    if (!recurrence || typeof recurrence !== 'object') return null;
    let pattern = recurrence.pattern;
    if (RECURRENCE_PATTERNS.indexOf(pattern) === -1) pattern = 'daily';

    let intervalUnit = recurrence.intervalUnit;
    if (RECURRENCE_UNITS.indexOf(intervalUnit) === -1) intervalUnit = 'day';

    let interval = parseInt(recurrence.interval, 10);
    if (isNaN(interval) || interval < 1) interval = 1;

    const basis = recurrence.basis === 'completionDate' ? 'completionDate' : 'dueDate';

    let endDate = null;
    if (typeof recurrence.endDate === 'string' && recurrence.endDate.length > 0) {
        endDate = recurrence.endDate;
    }

    return {
        pattern: pattern,
        interval: interval,
        intervalUnit: intervalUnit,
        basis: basis,
        endDate: endDate,
    };
}

// Compute the next due date for a recurring todo. Returns a Date in local
// time, or null if the inputs can't yield a meaningful next occurrence.
//   currentDue      — the todo's `due` field ("M-D-YYYY") or a Date instance
//   recurrence      — sanitized recurrence object (see sanitizeRecurrence)
//   completionDate  — when the user checked the box; used when basis === 'completionDate'
export function nextDueDate(currentDue, recurrence, completionDate) {
    if (!recurrence || typeof recurrence !== 'object') return null;
    const sanitized = sanitizeRecurrence(recurrence);

    const basisDate = sanitized.basis === 'completionDate'
        ? (completionDate instanceof Date ? completionDate : new Date(completionDate || Date.now()))
        : parseDueParts(currentDue);

    // No basis to advance from — when basis is dueDate but the todo has no
    // due date, fall back to today so the next occurrence is still meaningful.
    const seed = basisDate
        ? new Date(basisDate.getFullYear(), basisDate.getMonth(), basisDate.getDate())
        : new Date();

    switch (sanitized.pattern) {
        case 'daily':
            return addDays(seed, 1);
        case 'weekdays': {
            // Skip Sat/Sun — Friday rolls to Monday (+3), Saturday to Monday (+2).
            const dow = seed.getDay(); // 0 Sun .. 6 Sat
            let delta = 1;
            if (dow === 5) delta = 3;       // Fri → Mon
            else if (dow === 6) delta = 2;  // Sat → Mon
            else if (dow === 0) delta = 1;  // Sun → Mon
            return addDays(seed, delta);
        }
        case 'weekly':
            return addDays(seed, 7);
        case 'monthly':
            return addMonths(seed, 1);
        case 'yearly':
            return addYears(seed, 1);
        case 'custom':
            switch (sanitized.intervalUnit) {
                case 'day':   return addDays(seed, sanitized.interval);
                case 'week':  return addDays(seed, 7 * sanitized.interval);
                case 'month': return addMonths(seed, sanitized.interval);
                case 'year':  return addYears(seed, sanitized.interval);
                default:      return addDays(seed, sanitized.interval);
            }
        default:
            return null;
    }
}