import _, { remove } from 'lodash';
import './style.css';
import './main.js';
import { toDo } from './toDo.js';
import Icon from './icon.png';



var initialPage = () => {

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
    

    // FUNCTION (CURRENT PROJECTS): - responsible for placing newly named projects into allProjects array
    //                              - 
    function listProjects(){

        console.log(allProjects);

    }

    // FUNCTION (NEW PROJECTS): - responsible for placing newly named projects into allProjects array
    //           - activates when onClick for new project takes place.
    //           - takes in user input for project name and stores it in the allProjects array
    function addProject(){

        // Sets variable for 'empty' list item
        let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri);

        // store prompted user input for project name
        var projectName = prompt("Enter New Project Name: ");


        // set projectName as a new property of the allProjects object
        allProjects[projectName] = [];

        // empty array (empty item) NEEDS to also be pushed for allProjects to 'recognize' as an array
        allProjects[projectName].push(listItem);

        console.log(projectName + " added");

    }

    // **************** WORKING ON ****************
    // FUNCTION (REMOVE PROJECTS): - responsible for removing named projects inside allProjects array
    //                             - projectName property needs to be passed to function to identify 
    function removeProject(){

        

        let projectDes = prompt("Which project would you like to remove?");

        delete allProjects[projectDes]; // user try/catch for error when user doesn't match projectName
            

        listProjects();

    }


    // FUNCTION (ADD TODO LIST ITEMS): - responsible for adding new items to a designated project
    //                                 - called when add button under a project is clicked
    function addToDo(projectName) {
        console.log("called addToDo function");

        // Project should be passed into function as variable - 'projectName'
        // var selectedProject = projectName;

        // based on the project selected, take in new variables for object
        let itemTitle = 'addToDo_title';
        let itemDesc = 'addToDo_Desc';
        let itemDue = 'addToDo_DateDue';
        let itemPri = 1;
    

        // with the new variables, instantiate the new toDo list object
        let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri);    

        // push that new object to the allProjects array
        allProjects[projectName].push(listItem);

        // add new DOM element with toDo list to the DOM

    };









    // **************** TESTING INPUTS/FUNCTIONS **************** //

    
    // addToDo(projectName); // - ADDS TO DEFAULT PROJECT

    addProject(); // - Adds new project
    
    removeProject(); // -  Removes designated Project
    

    // ********************* TESTING PRINTS ********************* //

    
    

    
    // *********************************************************** // 

    // event listeners for button clicks will remain here with the caveat that,
    // the actual actions that will change the DOM will take place using a different module

    // on 'Add' button click (should be in sidebar),
    // - prompt user for project title
    // - creates project_array that is stored in allProjects array

    // on 'Add' button click (should be in center under project heading)
    // - prompts user for toDo[title, description, dueDate, priority]
    // - creates and stores itself into proejcts_array




    

}; // Ends CurrentSession


// document.body.appendChild(component());
initialPage();



// Personal notes,
// Start with console logic,
// 1.) Create js module for objects


// PROJECT TIPS  
// 1 - define todo objects in own module
//     should have the following properties, title, description,
//     dueDate, and priority. later include notes & checklist

// 2 - should have projects or separate lists of 'todo's'

// 3 - Keep Application Logic separated form DOM-related changes

// 4 - toDo list should be able to do the following,
//     1. view all projects
//     2. view all todos in each project (probably just the title and duedate… perhaps changing color for different priorities)
//     3. expand a single todo to see/edit its details
//     4. delete a todo


