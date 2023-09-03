import _ from 'lodash';
import './style.css';
import './main.js';
import { toDo } from './toDo.js';
import Icon from './icon.png';

var initialPage = () => {


    // define allProjects array - local 
    const allProjects = []; // Creates an empty array

    // define projects array - module
    const project = []; // Creates an empty array

    // define toDo object - module***
    let listItem = toDo('title', 'description', 'dueDate', 'priority');

    project.push(listItem);

    console.log(listItem); // prints item
    console.log(project); // prints projects array

    


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


