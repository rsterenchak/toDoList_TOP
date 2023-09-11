import _, { remove } from 'lodash';
import './style.css';
import { component } from'./main.js';
import { listLogic } from './listLogic.js';
import Icon from './icon.png';
import button from './addProj_button.svg';



document.body.appendChild(component()); // page DOM elements



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


