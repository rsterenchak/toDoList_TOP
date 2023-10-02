import './style.css';
import { toDo } from './toDo.js';



// ORIGINAL FUNCTION CALL,
export const listLogic = (function () {
    
    
    // Array.prototype.addProject = addProject;
    // Array.prototype.listProjects = listProjects;

    // console.log("Initialized ListLogic");

    // INITIAL: toDo item variables
    let itemTitle = '';
    let itemDesc = '';
    let itemDue = '';
    let itemPri = 1;


    // INITIAL: define allProjects object that dynamically stores arrays as new properties 
    const allProjects = {
        // new array properties would be stored here

    }; 

    // INITIAL: Sets the initial Project name and is used later to store new project names within addProject
    var projectName = 'Default';  

    // INITIAL: Initial Empty Item
    let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri);

    // INITIAL: Sets Default project
    allProjects[projectName] = [];

    // INITIAL: Adds 'empty' list item to project array
    allProjects[projectName].push(listItem);
    
    let allProjectsTotal = Object.keys(allProjects).length; 

    // FUNCTION (CURRENT PROJECTS): - responsible for placing newly named projects into allProjects array
    //                              - 
    function listProjects(){

        console.log(Object.keys(allProjects));

    }
    // FUNCTION (CURRENT PROJECTS): - responsible for placing newly named projects into allProjects array
    //                              - 
    function listProjectsArray(){

        let projectsArray = Object.keys(allProjects);

        return projectsArray;

    }

    // FUNCTION (NEW PROJECTS): - responsible for placing newly named projects into allProjects array
    //           - activates when onClick for new project takes place.
    //           - takes in user input for project name and stores it in the allProjects array
    function addProject(projectName){

        // console.log("Enter addProject function");
        // Sets variable for 'empty' list item
        let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri);

        // store prompted user input for project name
        // var projectName = prompt("Enter New Project Name: ");

        projectName = projectName.trim();

        // set projectName as a new property of the allProjects object
        allProjects[projectName] = [];

        // empty array (empty item) NEEDS to also be pushed for allProjects to 'recognize' as an array
        allProjects[projectName].push(listItem);

        allProjectsTotal = Object.keys(allProjects).length;
        // console.log(projectName + " added");

        // console.log(allProjects[projectName]);
        return {
            array: allProjects[projectName],
            string: projectName
        };// return project array

    }

    // **************** WORKING ON ****************
    // FUNCTION (REMOVE PROJECTS): - responsible for removing named projects inside allProjects array
    //                             - projectName property needs to be passed to function to identify 
    function removeProject(projectName){

        let before =  Object.keys(allProjects).length;

        let projectDes = projectName;

        delete allProjects[projectDes]; 

        let after = Object.keys(allProjects).length;

        // check if property was removed by checking if the number of allProjects properties was reduced*
        if(after < before){

            console.log(projectDes + " was removed");

        }
        else{

            console.log(projectDes + " was not removed");

        }

        

    }


    // FUNCTION (ADD TODO LIST ITEMS): - responsible for adding new items to a designated project
    //                                 - called when add button under a project is clicked
    function addToDo(projectName, toDoName) {

        // console.log("called addToDo function");

        let projectDes = projectName;

        // Project should be passed into function as variable - 'projectName'
        // var selectedProject = projectName;

        // based on the project selected, take in new variables for object
        let itemTitle = toDoName;
        let itemDesc = '';
        let itemDue = '';
        let itemPri = 1;
        let itemPos = 0;

        // with the new variables, instantiate the new toDo list object
        let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri, itemPos);    

        // push that new object to the allProjects array
        allProjects[projectDes].push(listItem);

        return {
            array: allProjects[projectName],
            string: projectName, 
            lengths: (allProjects[projectName]).length
        };// return project array        


    };

    function removeToDo(project, index, length) { // project 1, pos 1, length is 3
        // console.log("called removeToDo function");

        // based on the project selected, take in new variables for object
        let itemTitle = '';
        let itemDesc = '';
        let itemDue = '';
        let itemPri = 1;
        let itemPos = 0;

        // with the new variables, instantiate the new toDo list object
        let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri, itemPos);    
    

        index = parseInt(index, 10);

        // console.log("index: " + index);

        // if the length of the project array is 1 and the index is 0,
        // instead of removing the array logic/DOM entirely just reset it
        // otherwise just remove the logic/DOM

        if((length === 1) && (index === 0)){

            console.log("Only a single item exists");

            // pop() item from project array
            allProjects[project].pop(index);

            // console.log(allProjects[project]); //  check array

            // push that new object to the allProjects array
            allProjects[project].push(listItem);    

            // console.log(allProjects[project]); //  check array

        }

        else{
            
            removeElementAtIndex(allProjects[project], index);
            // console.log((allProjects[project]));

        }

    };

    // FUNCTION (EDIT TODO LIST ITEMS): - responsible for editing specified project array items
    //                                  - called when gui item section is clicked on
    //                                  - **** WILL NOT WORK AFTER SECOND EDIT ****
    function editProject(currentProperty, newProperty) {

        // set projectName as a new property of the allProjects object
        allProjects[newProperty] = allProjects[currentProperty];
        delete allProjects[currentProperty];

        allProjectsTotal = Object.keys(allProjects).length;

        

        return {
            array: allProjects[newProperty],
            string: newProperty
        }; // return project array

    };

    function listItems(project){

        let projectName = project;
        let projectArray = allProjects[projectName];


        return projectArray;

    };

    function projectLength(project){

        let projectLength = (allProjects[project]).length;

        return projectLength;
    };

    function removeElementAtIndex(arr, index) {
        if (index >= 0 && index < arr.length) {
          arr.splice(index, 1);
          return arr;
        } else {
          console.log("else error: " + index);  
          console.error("Index out of bounds");
          return arr; // Return the original array if the index is out of bounds
        }
    }
  

    return { 
        addProject, 
        removeProject, 
        listProjects,
        listProjectsArray,
        addToDo, 
        removeToDo, 
        editProject,
        listItems, 
        projectLength 
        
    };


    // **************** TESTING INPUTS/FUNCTIONS **************** //


    // addProject(); // - asks for project name, Adds new project
    
    // removeProject(allProjectsTotal); // -  Removes designated Project, determines if project was exists/was removed

    // addToDo(); // - asks for project, Adds empty toDo item to designated projects

    // editToDo(); // - asks for which project, prompts for details - function that edits toDo listItems

    // listProjects();

    // ********************* TESTING PRINTS ********************* //

    
    

    
    // *********************************************************** // 


    // window.addProject = addProject; // makes addProject() function available to user globally
})();// Ends CurrentSession


// **** IMPORTANT IDEA ****: To get around the issue of not being able to export nested functions
//            Attach each function to the listLogic() object prototype