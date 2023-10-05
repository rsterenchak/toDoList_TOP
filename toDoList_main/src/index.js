import _, { remove } from 'lodash';
import './style.css';
import { component } from'./main.js';
import { listLogic } from './listLogic.js';
import Icon from './icon.png';
import button from './addProj_button.svg';



document.body.appendChild(component()); // page DOM elements



// ******** PROJECT TIPS ********  
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


// ******** LOADING STORAGE ********
// 1. SET - Figure out how to store data (within storage ie LocalStorage()) populated within array
//
// 2. GET - Figure out how to display that information from session -> session
//
//
//