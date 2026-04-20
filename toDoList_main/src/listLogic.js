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

    // INITIAL: define allProjects object that dynamically stores arrays as new properties 
    const allProjects = {};


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

    // Sanitize loaded data — fix any bad date values (NaN, empty, malformed)
    // and backfill `completed` for items saved before the check-off feature existed.
    Object.keys(allProjects).forEach(function(key) {
        allProjects[key].forEach(function(item) {
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
    // Strip any legacy trailing blanks first — stored arrays from prior
    // versions always carried one, but the current rule is blank-only-when
    // empty-or-all-completed. sortCompletedInPlace re-adds one as needed.
    Object.keys(allProjects).forEach(function(key) {
        allProjects[key] = allProjects[key].filter(function(i) {
            return i.tit !== '';
        });
        sortCompletedInPlace(allProjects[key]);
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

        projectName = projectName.trim();

        allProjects[projectName] = [];
        allProjects[projectName].push(listItem);

        allProjectsTotal = Object.keys(allProjects).length;

        saveToStorage();
        
        return {
            array: allProjects[projectName],
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
    // Guards against adding a duplicate blank placeholder — the sort can place
    // a blank between uncompleted and completed items, so the existing blank
    // may live mid-array rather than at the end.
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

        // If trying to add a blank placeholder, skip if one already exists anywhere
        if (itemTitle === '') {
            const arr = allProjects[projectDes];
            if (arr.some(function(i){ return i.tit === ''; })) {
                return {
                    array: allProjects[projectName],
                    string: projectName,
                    lengths: allProjects[projectName].length
                };
            }
        }

        let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri, itemPos);
        allProjects[projectDes].push(listItem);

        saveToStorage();

        return {
            array: allProjects[projectName],
            string: projectName, 
            lengths: allProjects[projectName].length
        };
    };


    // FUNCTION (REMOVE TODO LIST ITEMS)
    // Delegates the placeholder invariant (blank row only when empty or
    // all-completed) to sortCompletedInPlace.
    function removeToDo(project, index, length) {

        if (!allProjects[project]) return;

        index = parseInt(index, 10);

        if (index >= 0 && index < allProjects[project].length) {
            allProjects[project].splice(index, 1);
        }

        sortCompletedInPlace(allProjects[project]);

        saveToStorage();
    };


    // Remove a todo item by its title — avoids index/DOM sync issues
    function removeToDoByTitle(project, title) {

        if (!allProjects[project]) return;

        const arr = allProjects[project];
        const idx = arr.findIndex(function(i){ return i.tit === title; });

        if (idx === -1) {
            console.warn("removeToDoByTitle: title not found —", title);
            return;
        }

        arr.splice(idx, 1);

        sortCompletedInPlace(allProjects[project]);

        saveToStorage();
    };


    function editProject(currentProperty, newProperty) {

        allProjects[newProperty] = allProjects[currentProperty];
        delete allProjects[currentProperty];

        allProjectsTotal = Object.keys(allProjects).length;

        saveToStorage();

        return {
            array: allProjects[newProperty],
            string: newProperty
        };
    };

    function listItems(project){
        return allProjects[project];
    };

    function projectLength(project){
        if (!project || !allProjects[project]) return 0;
        return allProjects[project].length;
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
    function reorderToDo(project, fromIndex, toIndex) {

        if (!allProjects[project]) return;
        const arr = allProjects[project];

        fromIndex = parseInt(fromIndex, 10);
        toIndex   = parseInt(toIndex, 10);

        if (isNaN(fromIndex) || isNaN(toIndex)) return;
        if (fromIndex < 0 || fromIndex >= arr.length) return;
        if (toIndex   < 0 || toIndex   >= arr.length) return;
        if (fromIndex === toIndex) return;

        const moved = arr.splice(fromIndex, 1)[0];
        arr.splice(toIndex, 0, moved);

        saveToStorage();
    }


    // Stable-partition a project array so uncompleted items lead and
    // completed items trail. The blank placeholder row is conditional: it
    // only renders when every real item is completed or the project is
    // empty — otherwise the always-visible "+" add-item button is the user's
    // way to create new rows. An explicitly-added blank (e.g. from the "+"
    // button while uncompleted items exist) is preserved at the end of the
    // uncompleted block so the user can finish typing before the sort
    // reclassifies it.
    function sortCompletedInPlace(arr) {
        if (!arr) return;

        const blanks      = arr.filter(function(i) { return i.tit === ''; });
        const uncompleted = arr.filter(function(i) { return i.tit !== '' && !i.completed; });
        const completed   = arr.filter(function(i) { return i.tit !== '' &&  i.completed; });

        let blank = blanks.length > 0 ? blanks[0] : null;
        // Auto-create a placeholder only when there's nothing uncompleted to
        // type next to — matches the invariant new empty projects start with.
        if (!blank && uncompleted.length === 0) {
            blank = toDo('', '', '', 1, 0);
        }

        arr.length = 0;
        for (let i = 0; i < uncompleted.length; i++) arr.push(uncompleted[i]);
        if (blank) arr.push(blank);
        for (let i = 0; i < completed.length; i++)   arr.push(completed[i]);
    }


    // Sort the given project's items so completed entries sit beneath
    // uncompleted ones. Preserves the trailing blank placeholder row.
    function sortCompletedToBottom(project) {
        if (!allProjects[project]) return;
        sortCompletedInPlace(allProjects[project]);
        saveToStorage();
    }


    return {
        addProject,
        removeProject,
        listProjects,
        listProjectsArray,
        addToDo,
        removeToDo,
        removeToDoByTitle,
        editProject,
        listItems,
        projectLength,
        reorderProject,
        reorderToDo,
        sortCompletedToBottom,
        saveToStorage
    };

})();