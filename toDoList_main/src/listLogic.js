import './style.css';
import { toDo } from './toDo.js';

var listLogic = () => {

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

        allProjectsTotal = Object.keys(allProjects).length;
        console.log(projectName + " added");

    }

    // **************** WORKING ON ****************
    // FUNCTION (REMOVE PROJECTS): - responsible for removing named projects inside allProjects array
    //                             - projectName property needs to be passed to function to identify 
    function removeProject(allProjectsTotal){

        let before =  allProjectsTotal;

        let projectDes = prompt("Which project would you like to remove?");

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
    function addToDo(projectName) {
        console.log("called addToDo function");

        let projectDes = prompt("Which project would you like to add a list item to?");

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
        allProjects[projectDes].push(listItem);

        console.log(allProjects[projectDes]);// show items in project


        // add new DOM element with toDo list to the DOM

    };

    // FUNCTION (EDIT TODO LIST ITEMS): - responsible for editing specified project array items
    //                                 - called when gui item section is clicked on
    function editToDo() {

        console.log("called editToDo function");

        let projectDes = prompt("Which project would you like to edit?");
        let itemPos = prompt("Indicate item position within project array.");

        console.log(allProjects[projectDes][itemPos]);




    };




    // **************** TESTING INPUTS/FUNCTIONS **************** //


    // addProject(); // - asks for project name, Adds new project
    
    // removeProject(allProjectsTotal); // -  Removes designated Project, determines if project was exists/was removed

    // addToDo(); // - asks for project, Adds empty toDo item to designated projects

    // editToDo(); // - asks for which project, prompts for details - function that edits toDo listItems

    // listProjects();

    // ********************* TESTING PRINTS ********************* //

    
    

    
    // *********************************************************** // 


    

}; // Ends CurrentSession


export { listLogic };