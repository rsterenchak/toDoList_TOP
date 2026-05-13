import './style.css';
import { toDo } from './toDo.js';


// Recurrence vocabulary used by `sanitizeRecurrence`. Declared above the
// `listLogic` IIFE because the IIFE's storage-restore pass calls
// sanitizeRecurrence on every loaded item — Babel transpiles the original
// `const` to `var`, which hoists the binding but not the value, so leaving
// these next to nextDueDate() (further down the file) makes them read as
// `undefined` during the IIFE's evaluation and crashes with
// "Cannot read properties of undefined (reading 'indexOf')".
const RECURRENCE_PATTERNS = ['daily', 'weekdays', 'weekly', 'monthly', 'yearly', 'custom'];
const RECURRENCE_UNITS    = ['day', 'week', 'month', 'year'];


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

    // HELPER: persist current state of allProjects to localStorage
    function saveToStorage() {
        localStorage.setItem('allProjects', JSON.stringify(allProjects));
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
            allProjects[key] = { items: entry, color: null };
        } else if (!entry || typeof entry !== 'object') {
            allProjects[key] = { items: [], color: null };
        } else {
            if (!Array.isArray(entry.items)) entry.items = [];
            if (typeof entry.color !== 'string' && entry.color !== null) entry.color = null;
            if (typeof entry.color === 'string' && PROJECT_COLOR_KEYS.indexOf(entry.color) === -1) {
                entry.color = null;
            }
        }
        allProjects[key].items.forEach(function(item) {
            if (typeof item.completed !== 'boolean') {
                item.completed = false;
            }
            // Clean up the recurrence field on load: anything non-object
            // becomes null (one-off task), and a partial object is forced
            // through sanitizeRecurrence so downstream code can trust it.
            if (item.recurrence === undefined) {
                item.recurrence = null;
            } else if (item.recurrence !== null) {
                item.recurrence = sanitizeRecurrence(item.recurrence);
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

    function addProject(projectName){

        let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri);

        projectName = (projectName || '').trim();

        // Empty names break lookup-by-name everywhere downstream; reject
        // here so no UI path can corrupt storage with a '' key.
        if (projectName.length === 0) {
            return { array: [], string: '' };
        }

        allProjects[projectName] = { items: [listItem], color: null };

        allProjectsTotal = Object.keys(allProjects).length;

        saveToStorage();

        return {
            array: allProjects[projectName].items,
            string: projectName
        };
    }

    function removeProject(projectName){

        let before = Object.keys(allProjects).length;
        let projectDes = projectName;

        delete allProjects[projectDes]; 

        let after = Object.keys(allProjects).length;

        if(after < before){
            console.log(projectDes + " was removed");
        } else {
            console.log(projectDes + " was not removed");
        }

        saveToStorage();
    }


    // FUNCTION (ADD TODO LIST ITEMS)
    // Skips if a blank placeholder already exists (invariant: one blank per project).
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
        arr.push(listItem);

        // Re-pin the blank placeholder to index 0.
        sortCompletedInPlace(arr);

        saveToStorage();

        return {
            array: arr,
            string: projectName,
            lengths: arr.length
        };
    };


    // FUNCTION (REMOVE TODO LIST ITEMS)
    // Maintains the invariant that a blank placeholder is pinned at index 0.
    function removeToDo(project, index, length) {

        if (!allProjects[project]) return;

        const arr = allProjects[project].items;
        index = parseInt(index, 10);

        if (index >= 0 && index < arr.length) {
            arr.splice(index, 1);
        }

        sortCompletedInPlace(arr);

        saveToStorage();
    };


    // Remove a todo item by object-reference — title-based lookup is unsafe
    // because the data model permits duplicate titles (a new row committed
    // while a completed row with the same title still exists), which would
    // otherwise delete the wrong row. A stale/empty input value also can't
    // misfire and accidentally splice the blank placeholder.
    // Maintains the invariant that a blank placeholder is pinned at index 0.
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
    };


    // Re-insert a previously-removed todo item at a specific position in the
    // project's items array. Backs the mobile swipe-delete "undo" path: the
    // caller captures the array index before splicing the item out so this
    // function can restore the item to the same slot. sortCompletedInPlace
    // still runs afterward, so the final landing slot may shift if the item
    // is completed (re-partitioned to the bottom) or the requested index
    // collides with the pinned blank placeholder at index 0 — both are
    // expected outcomes that preserve the model invariants.
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
    };


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
    function sortCompletedToBottom(project) {
        if (!allProjects[project]) return;
        sortCompletedInPlace(allProjects[project].items);
        saveToStorage();
    }


    // Read the persisted per-project color key, or null when the project is
    // using the theme accent (or doesn't exist). Callers map the key to a
    // concrete color via the PROJECT_COLOR_HEX table in projectMenu.js.
    function getProjectColor(projectName) {
        const entry = allProjects[projectName];
        if (!entry) return null;
        return entry.color || null;
    }


    // Write a per-project color key. Pass null (or any non-valid key) to
    // reset back to the theme accent.
    function setProjectColor(projectName, colorKey) {
        const entry = allProjects[projectName];
        if (!entry) return;
        if (colorKey && PROJECT_COLOR_KEYS.indexOf(colorKey) !== -1) {
            entry.color = colorKey;
        } else {
            entry.color = null;
        }
        saveToStorage();
    }


    // ── RECURRENCE ───────────────────────────────────────────────────
    // Write a recurrence config onto a todo item by reference. Pass null
    // (or a non-object) to clear recurrence and revert to a one-off task.
    // Sanitizes the object so a hand-edited or partial config can't poison
    // downstream date math: missing fields fall back to safe defaults, the
    // pattern is clamped to a known value, and `interval` is forced to a
    // positive integer.
    function setRecurrence(project, item, recurrence) {
        if (!allProjects[project]) return;
        if (!item) return;
        if (!recurrence || typeof recurrence !== 'object') {
            item.recurrence = null;
            saveToStorage();
            return;
        }
        item.recurrence = sanitizeRecurrence(recurrence);
        saveToStorage();
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
            tit: item.tit,
            desc: item.desc,
            due: item.due,
            pri: item.pri,
            pos: item.pos,
            completed: true,
            recurrence: null,
        };
        arr.push(completedClone);

        item.due = formatDueParts(next);
        item.completed = false;
        sortCompletedInPlace(arr);
        saveToStorage();
        return true;
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


    function _reset() {
        Object.keys(allProjects).forEach(function(k) { delete allProjects[k]; });
        localStorage.clear();
        allProjectsTotal = 0;
    }


    // Wipe all in-memory + persisted project state and replace it with the
    // given list. Used by the JSON import flow (validation lives next to the
    // import handler; once the file is accepted the entire project tree is
    // overwritten in one pass — no partial-overwrite states, per the task
    // spec). Accepts an array of `{ name, items, color }` entries; falls back
    // to safe defaults on missing fields so a slightly-off import file can't
    // brick the app. Returns the count of projects that were written.
    function replaceAllProjects(projects) {

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
                if (!item.due || item.due === '' || item.due === '--' || item.due === 'X-X-XXXX') return;
                const parts = String(item.due).split('-');
                const m = parseInt(parts[0], 10);
                const d = parseInt(parts[1], 10);
                const y = parseInt(parts[2], 10);
                if (isNaN(m) || isNaN(d) || isNaN(y)) item.due = '';
            });

            allProjects[name] = { items: items, color: color };
            sortCompletedInPlace(allProjects[name].items);
        });

        allProjectsTotal = Object.keys(allProjects).length;
        saveToStorage();

        return allProjectsTotal;
    }


    // Snapshot the current project tree as a plain array of
    // `{ name, items, color }` entries — the shape consumed by
    // replaceAllProjects and the export file. Iteration order matches
    // Object.keys(allProjects), preserving the user's project order.
    function snapshotProjects() {
        return Object.keys(allProjects).map(function(name) {
            const entry = allProjects[name];
            return {
                name: name,
                items: Array.isArray(entry.items) ? entry.items.slice() : [],
                color: entry.color || null,
            };
        });
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
        editProject,
        listItems,
        projectLength,
        reorderProject,
        reorderToDo,
        sortCompletedToBottom,
        getProjectColor,
        setProjectColor,
        PROJECT_COLOR_KEYS,
        saveToStorage,
        replaceAllProjects,
        snapshotProjects,
        setRecurrence,
        advanceRecurringTodo,
        getTodayAggregation,
        _reset
    };

})();


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