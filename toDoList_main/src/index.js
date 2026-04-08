import _, { remove } from 'lodash';
import './style.css';
import { component, restoreFromStorage } from './main.js';
import { listLogic } from './listLogic.js';
import Icon from './icon.png';
import button from './addProj_button.svg';



document.body.appendChild(component()); // page DOM elements

restoreFromStorage(); // rebuild sidebar + todos from localStorage after DOM exists