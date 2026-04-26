import './style.css';
import { toDo } from './toDo.js';



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
    // concrete color via the PROJECT_COLOR_HEX table in main.js.
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


    function _reset() {
        Object.keys(allProjects).forEach(function(k) { delete allProjects[k]; });
        localStorage.clear();
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
        _reset
    };

})();