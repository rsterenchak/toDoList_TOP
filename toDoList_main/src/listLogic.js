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
    // Guards against adding a duplicate blank placeholder at the end.
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

        // If trying to add a blank placeholder, skip if one already exists at the end
        if (itemTitle === '') {
            const arr = allProjects[projectDes];
            if (arr.length > 0 && arr[arr.length - 1].tit === '') {
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
    // Always leaves exactly one blank placeholder when no real items remain.
    function removeToDo(project, index, length) {

        if (!allProjects[project]) return;

        index = parseInt(index, 10);

        // Splice out the target item
        if (index >= 0 && index < allProjects[project].length) {
            allProjects[project].splice(index, 1);
        }

        // Strip ALL blank placeholders from the array
        allProjects[project] = allProjects[project].filter(function(i) {
            return i.tit !== '';
        });

        // If no real items remain, add exactly one blank placeholder
        if (allProjects[project].length === 0) {
            allProjects[project].push(toDo('', '', '', 1, 0));
        }

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

        // Strip blanks then ensure one placeholder remains if no real items left
        allProjects[project] = allProjects[project].filter(function(i) {
            return i.tit !== '';
        });

        if (allProjects[project].length === 0) {
            allProjects[project].push(toDo('', '', '', 1, 0));
        }

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
        saveToStorage
    };

})();