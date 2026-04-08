/*
 * ATTENTION: The "eval" devtool has been used (maybe by default in mode: "development").
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
/******/ 	var __webpack_modules__ = ({

/***/ "./src/listLogic.js":
/*!**************************!*\
  !*** ./src/listLogic.js ***!
  \**************************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   listLogic: () => (/* binding */ listLogic)\n/* harmony export */ });\n/* harmony import */ var _style_css__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./style.css */ \"./src/style.css\");\n/* harmony import */ var _toDo_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./toDo.js */ \"./src/toDo.js\");\n\n\n\n// ORIGINAL FUNCTION CALL,\nvar listLogic = function () {\n  // localStorage.clear(); // using only for testing\n\n  // INITIAL: toDo item variables\n  var itemTitle = '';\n  var itemDesc = '';\n  var itemDue = '';\n  var itemPri = 1;\n\n  // INITIAL: define allProjects object that dynamically stores arrays as new properties \n  var allProjects = {\n\n    // new array properties would be stored here\n  };\n\n  // ********************* STORAGE HANDLING ********************* //\n\n  // HELPER: persist current state of allProjects to localStorage\n  function saveToStorage() {\n    localStorage.setItem('allProjects', JSON.stringify(allProjects));\n  }\n\n  // INIT: restore any previously saved projects from localStorage\n  var stored_raw = localStorage.getItem('allProjects');\n  if (stored_raw) {\n    var stored_deserialized = JSON.parse(stored_raw);\n    var savedKeys = Object.keys(stored_deserialized);\n    if (savedKeys.length > 0) {\n      console.log(\"Restoring projects from localStorage:\", savedKeys);\n      savedKeys.forEach(function (key) {\n        allProjects[key] = stored_deserialized[key];\n      });\n    } else {\n      console.log(\"localStorage found but empty.\");\n    }\n  } else {\n    console.log(\"No localStorage entry — fresh start.\");\n    saveToStorage();\n  }\n\n  // ************************************************************* //\n\n  /*     // INITIAL: Sets the initial Project name and is used later to store new project names within addProject\n      var projectName = 'Default';  \n  \n      // INITIAL: Initial Empty Item\n      let listItem = toDo(itemTitle, itemDesc, itemDue, itemPri);\n  \n      // INITIAL: Sets Default project\n      allProjects[projectName] = [];\n  \n      // INITIAL: Adds 'empty' list item to project array\n      allProjects[projectName].push(listItem); */\n\n  var allProjectsTotal = Object.keys(allProjects).length;\n\n  // FUNCTION (CURRENT PROJECTS): - responsible for placing newly named projects into allProjects array\n  //                              - \n  function listProjects() {\n    console.log(Object.keys(allProjects));\n  }\n\n  // FUNCTION (CURRENT PROJECTS): - responsible for placing newly named projects into allProjects array\n  //                              - \n  function listProjectsArray() {\n    var projectsArray = Object.keys(allProjects);\n    return projectsArray;\n  }\n\n  // FUNCTION (NEW PROJECTS): - responsible for placing newly named projects into allProjects array\n  //           - activates when onClick for new project takes place.\n  //           - takes in user input for project name and stores it in the allProjects array\n  function addProject(projectName) {\n    // console.log(\"Enter addProject function\");\n    // Sets variable for 'empty' list item\n    var listItem = (0,_toDo_js__WEBPACK_IMPORTED_MODULE_1__.toDo)(itemTitle, itemDesc, itemDue, itemPri);\n    projectName = projectName.trim();\n\n    // set projectName as a new property of the allProjects object\n    allProjects[projectName] = [];\n\n    // empty array (empty item) NEEDS to also be pushed for allProjects to 'recognize' as an array\n    allProjects[projectName].push(listItem);\n    allProjectsTotal = Object.keys(allProjects).length;\n    saveToStorage();\n    console.log(localStorage);\n    return {\n      array: allProjects[projectName],\n      string: projectName\n    }; // return project array\n  }\n\n  // **************** WORKING ON ****************\n  // FUNCTION (REMOVE PROJECTS): - responsible for removing named projects inside allProjects array\n  //                             - projectName property needs to be passed to function to identify \n  function removeProject(projectName) {\n    var before = Object.keys(allProjects).length;\n    var projectDes = projectName;\n    delete allProjects[projectDes];\n    var after = Object.keys(allProjects).length;\n    if (after < before) {\n      console.log(projectDes + \" was removed\");\n    } else {\n      console.log(projectDes + \" was not removed\");\n    }\n    saveToStorage();\n  }\n\n  // FUNCTION (ADD TODO LIST ITEMS): - responsible for adding new items to a designated project\n  //                                 - called when add button under a project is clicked\n  function addToDo(projectName, toDoName) {\n    // console.log(\"called addToDo function\");\n\n    var projectDes = projectName;\n\n    // Project should be passed into function as variable - 'projectName'\n    // var selectedProject = projectName;\n\n    // based on the project selected, take in new variables for object\n    var itemTitle = toDoName;\n    var itemDesc = '';\n    var itemDue = '';\n    var itemPri = 1;\n    var itemPos = 0;\n\n    // with the new variables, instantiate the new toDo list object\n    var listItem = (0,_toDo_js__WEBPACK_IMPORTED_MODULE_1__.toDo)(itemTitle, itemDesc, itemDue, itemPri, itemPos);\n\n    // push that new object to the allProjects array\n    if (!allProjects[projectDes]) {\n      console.error(\"addToDo: project not found —\", projectDes);\n      return {\n        array: [],\n        string: projectName,\n        lengths: 0\n      };\n    }\n    allProjects[projectDes].push(listItem);\n    saveToStorage();\n    return {\n      array: allProjects[projectName],\n      string: projectName,\n      lengths: allProjects[projectName].length\n    }; // return project array        \n  }\n\n  ;\n  function removeToDo(project, index, length) {\n    if (!allProjects[project]) return;\n    index = parseInt(index, 10);\n    var actualLength = allProjects[project].length;\n\n    // if this is the only real item, reset to a single blank placeholder\n    if (actualLength <= 1) {\n      var listItem = (0,_toDo_js__WEBPACK_IMPORTED_MODULE_1__.toDo)('', '', '', 1, 0);\n      allProjects[project] = [listItem];\n    } else {\n      removeElementAtIndex(allProjects[project], index);\n\n      // if after removal no real items remain (only blanks), ensure exactly one blank\n      var hasReal = allProjects[project].some(function (i) {\n        return i.tit !== \"\";\n      });\n      if (!hasReal) {\n        var _listItem = (0,_toDo_js__WEBPACK_IMPORTED_MODULE_1__.toDo)('', '', '', 1, 0);\n        allProjects[project] = [_listItem];\n      }\n    }\n    saveToStorage();\n  }\n  ;\n\n  // Remove a todo item by its title — avoids index/DOM sync issues\n  function removeToDoByTitle(project, title) {\n    if (!allProjects[project]) return;\n    var arr = allProjects[project];\n    var idx = arr.findIndex(function (i) {\n      return i.tit === title;\n    });\n    if (idx === -1) {\n      console.warn(\"removeToDoByTitle: title not found —\", title);\n      return;\n    }\n    arr.splice(idx, 1);\n\n    // if no real items remain, reset to a single blank placeholder\n    var hasReal = arr.some(function (i) {\n      return i.tit !== \"\";\n    });\n    if (!hasReal) {\n      allProjects[project] = [(0,_toDo_js__WEBPACK_IMPORTED_MODULE_1__.toDo)('', '', '', 1, 0)];\n    }\n    saveToStorage();\n  }\n  ;\n\n  // FUNCTION (EDIT TODO LIST ITEMS): - responsible for editing specified project array items\n  //                                  - called when gui item section is clicked on\n  //                                  - **** WILL NOT WORK AFTER SECOND EDIT ****\n  function editProject(currentProperty, newProperty) {\n    // set projectName as a new property of the allProjects object\n    allProjects[newProperty] = allProjects[currentProperty];\n    delete allProjects[currentProperty];\n    allProjectsTotal = Object.keys(allProjects).length;\n    saveToStorage();\n    return {\n      array: allProjects[newProperty],\n      string: newProperty\n    }; // return project array\n  }\n\n  ;\n  function listItems(project) {\n    var projectName = project;\n    var projectArray = allProjects[projectName];\n    return projectArray;\n  }\n  ;\n  function projectLength(project) {\n    if (!project || !allProjects[project]) return 0;\n    var projectLength = allProjects[project].length;\n    return projectLength;\n  }\n  ;\n  function removeElementAtIndex(arr, index) {\n    if (index >= 0 && index < arr.length) {\n      arr.splice(index, 1);\n      return arr;\n    } else {\n      console.log(\"else error: \" + index);\n      console.error(\"Index out of bounds\");\n      return arr; // Return the original array if the index is out of bounds\n    }\n  }\n\n  return {\n    addProject: addProject,\n    removeProject: removeProject,\n    listProjects: listProjects,\n    listProjectsArray: listProjectsArray,\n    addToDo: addToDo,\n    removeToDo: removeToDo,\n    removeToDoByTitle: removeToDoByTitle,\n    editProject: editProject,\n    listItems: listItems,\n    projectLength: projectLength,\n    saveToStorage: saveToStorage\n  };\n\n  // **************** TESTING INPUTS/FUNCTIONS **************** //\n\n  // addProject(); // - asks for project name, Adds new project\n\n  // removeProject(allProjectsTotal); // -  Removes designated Project, determines if project was exists/was removed\n\n  // addToDo(); // - asks for project, Adds empty toDo item to designated projects\n\n  // editToDo(); // - asks for which project, prompts for details - function that edits toDo listItems\n\n  // listProjects();\n\n  // ********************* TESTING PRINTS ********************* //\n\n  // *********************************************************** // \n\n  // window.addProject = addProject; // makes addProject() function available to user globally\n}(); // Ends CurrentSession\n\n// **** IMPORTANT IDEA ****: To get around the issue of not being able to export nested functions\n//            Attach each function to the listLogic() object prototype\n\n//# sourceURL=webpack://todolist_main/./src/listLogic.js?");

/***/ }),

/***/ "./src/toDo.js":
/*!*********************!*\
  !*** ./src/toDo.js ***!
  \*********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   toDo: () => (/* binding */ toDo)\n/* harmony export */ });\n/* harmony import */ var _style_css__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./style.css */ \"./src/style.css\");\n\n\n// FACTORY FUNCTION: TODO OBJECT\n// Store list items in objects\nvar toDo = function toDo(title, description, dueDate, priority, position) {\n  var tit = title;\n  var desc = description;\n  var due = dueDate;\n  var pri = priority;\n  var pos = position;\n\n  // console.log(\"Called toDo Object\");\n\n  return {\n    tit: tit,\n    desc: desc,\n    due: due,\n    pri: pri,\n    pos: pos\n  };\n};\n\n\n//# sourceURL=webpack://todolist_main/./src/toDo.js?");

/***/ }),

/***/ "./node_modules/css-loader/dist/cjs.js!./src/style.css":
/*!*************************************************************!*\
  !*** ./node_modules/css-loader/dist/cjs.js!./src/style.css ***!
  \*************************************************************/
/***/ ((module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (__WEBPACK_DEFAULT_EXPORT__)\n/* harmony export */ });\n/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../node_modules/css-loader/dist/runtime/noSourceMaps.js */ \"./node_modules/css-loader/dist/runtime/noSourceMaps.js\");\n/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../node_modules/css-loader/dist/runtime/api.js */ \"./node_modules/css-loader/dist/runtime/api.js\");\n/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../node_modules/css-loader/dist/runtime/getUrl.js */ \"./node_modules/css-loader/dist/runtime/getUrl.js\");\n/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__);\n// Imports\n\n\n\nvar ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! ./Zector.otf */ \"./src/Zector.otf\"), __webpack_require__.b);\nvar ___CSS_LOADER_URL_IMPORT_1___ = new URL(/* asset import */ __webpack_require__(/*! ./addProj_button.svg */ \"./src/addProj_button.svg\"), __webpack_require__.b);\nvar ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));\nvar ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);\nvar ___CSS_LOADER_URL_REPLACEMENT_1___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_1___);\n// Module\n___CSS_LOADER_EXPORT___.push([module.id, `@font-face {\n  font-family: 'MyFont';\n  src: url(${___CSS_LOADER_URL_REPLACEMENT_0___});\n}\n\n/* ── VOID THEME ── */\n\n:root {\n  --bg-base:       #0F0F0F;\n  --bg-elevated:   #161616;\n  --bg-surface:    #1C1C1C;\n  --bg-hover:      #1a1828;\n  --bg-active:     #16142a;\n\n  --border-dim:    #242424;\n  --border-mid:    #2E2E2E;\n  --border-bright: #3A3A3A;\n\n  --accent:        #6C5DF5;\n  --accent-dim:    rgba(108, 93, 245, 0.25);\n  --accent-text:   #9D8FFF;\n\n  --text-primary:  #E4E4E4;\n  --text-secondary:#888888;\n  --text-muted:    #484848;\n  --text-danger:   #E05555;\n\n  --radius-sm:     4px;\n  --radius-md:     6px;\n\n  --sidebar-w:     200px;\n  --nav-h:         44px;\n  --foot-h:        36px;\n  --row-h:         48px;\n  --item-h:        44px;\n  --touch:         44px;\n}\n\n/* ── RESET ── */\n*, *::before, *::after {\n  box-sizing: border-box;\n  -webkit-tap-highlight-color: transparent;\n}\n\nhtml, body {\n  height: 100%;\n  margin: 0;\n}\n\nbody {\n  padding: 16px;\n  background: var(--bg-base);\n  color: var(--text-primary);\n  font-family: 'Trebuchet MS', 'Lucida Grande', sans-serif;\n  overflow: hidden;\n}\n\n/* OUTER SHELL */\n#outerContainer {\n  display: grid;\n  grid-template-rows: var(--nav-h) 1fr var(--foot-h);\n  height: calc(100dvh - 32px);\n  border: 0.5px solid var(--border-mid);\n  border-radius: 10px;\n  overflow: hidden;\n  background: var(--bg-elevated);\n}\n\n/* NAV BAR */\n#navBar {\n  background: var(--bg-elevated);\n  border-bottom: 0.5px solid var(--border-dim);\n  display: flex;\n  align-items: center;\n  padding: 0 16px;\n  gap: 10px;\n  position: relative;\n  z-index: 10;\n}\n\n#sidebarToggle {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  background: none;\n  border: none;\n  cursor: pointer;\n  color: var(--text-secondary);\n  font-size: 16px;\n  line-height: 1;\n  border-radius: var(--radius-sm);\n  transition: color 0.15s ease, background 0.15s ease;\n  width: 32px;\n  height: 32px;\n  flex-shrink: 0;\n  padding: 0;\n}\n\n#sidebarToggle:hover {\n  color: var(--accent-text);\n  background: var(--bg-hover);\n}\n\n#navBar::before {\n  content: '';\n  display: inline-block;\n  width: 10px;\n  height: 10px;\n  border-radius: 50%;\n  background: var(--accent);\n  flex-shrink: 0;\n}\n\n#navBar::after {\n  content: '';\n  display: inline-block;\n  width: 10px;\n  height: 10px;\n  border-radius: 50%;\n  background: #444;\n  box-shadow: 18px 0 0 #444;\n  margin-left: auto;\n  margin-right: 8px;\n  flex-shrink: 0;\n}\n\n/* FOOTER */\n#footBar {\n  background: var(--bg-elevated);\n  border-top: 0.5px solid var(--border-dim);\n  display: flex;\n  align-items: center;\n  padding: 0 16px;\n}\n\n#footBar::after {\n  content: 'task management v1.1';\n  font-size: 10px;\n  letter-spacing: 0.12em;\n  color: #555;\n  text-transform: uppercase;\n}\n\n/* MAIN SECTION */\n#mainSec {\n  display: grid;\n  grid-template-columns: var(--sidebar-w) 1fr;\n  overflow: hidden;\n  position: relative;\n  transition: grid-template-columns 0.25s ease;\n}\n\n/* SIDEBAR */\n#sideBar {\n  display: grid;\n  grid-template-rows: var(--row-h) 1fr;\n  border-right: 0.5px solid var(--border-dim);\n  background: var(--bg-elevated);\n  overflow: hidden;\n  transition: border-color 0.25s ease;\n  min-width: 0;\n}\n\n#sideTit {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 0 14px;\n  border-bottom: 0.5px solid var(--border-dim);\n  background: var(--bg-elevated);\n  flex-shrink: 0;\n  white-space: nowrap;\n  overflow: hidden;\n}\n\n#sideHead {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: 0.14em;\n  color: var(--accent-text);\n  text-transform: uppercase;\n}\n\n#sideMa {\n  display: grid;\n  background: var(--bg-elevated);\n  grid-template-rows: repeat(auto-fit, minmax(var(--item-h), var(--item-h)));\n  align-content: start;\n  overflow-y: auto;\n  overflow-x: hidden;\n  -webkit-overflow-scrolling: touch;\n}\n\n/* ADD PROJECT */\n#addProj {\n  display: grid;\n  border-bottom: 0.5px solid var(--border-dim);\n  justify-content: center;\n  align-content: center;\n  background: transparent;\n  height: var(--row-h);\n}\n\n#projButton {\n  border: none;\n  width: var(--touch);\n  height: var(--touch);\n  background: transparent url(${___CSS_LOADER_URL_REPLACEMENT_1___}) center/22px 22px no-repeat;\n  opacity: 0.7;\n  cursor: pointer;\n  transition: opacity 0.15s ease;\n}\n#projButton:hover { opacity: 1; }\n\n/* PROJECT ROWS */\n#projChild {\n  display: grid;\n  align-content: center;\n  grid-template-columns: 1fr 22px 12px;\n  cursor: pointer;\n  background: transparent;\n  height: var(--item-h);\n  padding: 0 12px 0 14px;\n  transition: background 0.12s ease;\n  border-bottom: 0.5px solid var(--border-dim);\n  border-left: 3px solid transparent;\n  white-space: nowrap;\n  overflow: hidden;\n}\n#projChild:hover { background: var(--bg-hover); }\n\n.unselectedProject {\n  border-left: 3px solid transparent;\n  border-top: none;\n  border-right: none;\n  border-bottom: 0.5px solid var(--border-dim);\n}\n\n.selectedProject {\n  border-left: 3px solid var(--accent) !important;\n  border-top: none;\n  border-right: none;\n  border-bottom: 0.5px solid var(--border-dim) !important;\n  background: var(--bg-active) !important;\n}\n\n#projInput {\n  font-size: 14px;\n  font-family: 'Trebuchet MS', sans-serif;\n  background: transparent;\n  color: #E8E8E8;\n  border: none;\n  width: 100%;\n  letter-spacing: 0.02em;\n  caret-color: #9D8FFF;\n  padding: 0;\n  min-width: 0;\n  overflow: hidden;\n  text-overflow: ellipsis;\n}\n#projInput::placeholder { color: var(--text-muted); font-style: italic; }\n#projInput:focus { outline: none; background: transparent; color: #E8E8E8; }\n#projInput:focus::placeholder { color: transparent; }\n#projInput:-webkit-autofill,\n#projInput:-webkit-autofill:hover,\n#projInput:-webkit-autofill:focus {\n  -webkit-text-fill-color: #E8E8E8;\n  -webkit-box-shadow: 0 0 0px 1000px #1C1C1C inset;\n}\n\n#closeButton {\n  width: 28px;\n  height: 28px;\n  align-self: center;\n  justify-self: center;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: 3px;\n  transition: background 0.12s ease, color 0.12s ease;\n  font-size: 18px;\n  line-height: 1;\n  color: #777;\n}\n#closeButton::after { content: '×'; display: block; }\n#closeButton:hover { color: #E8E8E8; background: rgba(255,255,255,0.08); }\n\n/* MAIN BAR */\n#mainBar {\n  display: grid;\n  grid-template-rows: var(--row-h) 1fr;\n  background: var(--bg-base);\n  overflow: hidden;\n  min-width: 0;\n}\n\n#mainTitle {\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  padding: 0 14px;\n  border-bottom: 0.5px solid var(--border-dim);\n  background: var(--bg-elevated);\n  flex-shrink: 0;\n}\n\n#mainHead {\n  font-size: 12px;\n  font-weight: 700;\n  letter-spacing: 0.14em;\n  color: var(--accent-text);\n  text-transform: uppercase;\n}\n\n#mainList {\n  display: grid;\n  grid-template-rows: repeat(auto-fit, minmax(54px, 54px));\n  align-content: start;\n  background: var(--bg-base);\n  overflow-y: auto;\n  overflow-x: hidden;\n  -webkit-overflow-scrolling: touch;\n  padding: 4px 0;\n  position: relative;\n}\n\n/* TODO ROWS */\n#toDoChild {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  cursor: pointer;\n  background: var(--bg-surface);\n  height: var(--item-h);\n  padding: 0 10px 0 14px;\n  border: 0.5px solid var(--border-bright);\n  border-radius: 6px;\n  margin: 5px 8px;\n  transition: background 0.10s ease;\n  gap: 8px;\n  min-width: 0;\n  overflow: hidden;\n}\n#toDoChild:hover { background: var(--bg-hover); }\n\n#toDoInput {\n  font-size: 13px;\n  font-family: 'Trebuchet MS', sans-serif;\n  background: transparent;\n  color: #E8E8E8;\n  border: none;\n  letter-spacing: 0.02em;\n  caret-color: #9D8FFF;\n  min-width: 0;\n  flex: 1 1 0;  /* takes all remaining space, can shrink */\n  align-self: center;\n}\n#toDoInput:-webkit-autofill,\n#toDoInput:-webkit-autofill:hover,\n#toDoInput:-webkit-autofill:focus {\n  -webkit-text-fill-color: #E8E8E8;\n  -webkit-box-shadow: 0 0 0px 1000px #141414 inset;\n}\n#toDoInput::placeholder { color: var(--text-muted); font-style: italic; }\n#toDoInput:focus { outline: none; background: transparent; color: var(--text-primary); }\n#toDoInput:focus::placeholder { color: transparent; }\n\n/* DATE */\n#dateText {\n  font-size: 10px;\n  letter-spacing: 0.06em;\n  text-transform: uppercase;\n  color: #666;\n  text-align: right;\n  white-space: nowrap;\n  flex-shrink: 0;\n}\n\n#dueInput {\n  display: flex;\n  flex-direction: row;\n  align-items: center;\n  border-radius: var(--radius-sm);\n  background: var(--bg-surface);\n  border: 0.5px solid var(--border-mid);\n  padding: 2px 4px;\n  flex-shrink: 0;\n  gap: 1px;\n  min-width: 0;\n}\n\n#month, #day, #year {\n  font-size: 11px;\n  font-family: 'Trebuchet MS', monospace;\n  border: none;\n  text-align: center;\n  background: transparent;\n  color: #AAAAAA;\n  width: 18px;\n  flex-shrink: 0;\n}\n#year { width: 36px; }\n\n#month:focus, #day:focus, #year:focus { outline: none; color: #E8E8E8; }\n#month::placeholder, #day::placeholder, #year::placeholder { color: #555; }\n#month:focus::placeholder, #day:focus::placeholder, #year:focus::placeholder { color: transparent; }\n\n#dash { font-size: 11px; color: #555; flex-shrink: 0; }\n#spacer { display: none; } /* spacer not needed in flex layout */\n\n/* CLOSE BUTTON (todo) */\n#closeButtonToDo {\n  width: 24px;\n  height: 24px;\n  flex-shrink: 0;\n  cursor: pointer;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  border-radius: 3px;\n  transition: background 0.12s ease, color 0.12s ease;\n  font-size: 18px;\n  line-height: 1;\n  color: #555;\n}\n#closeButtonToDo::after { content: '×'; display: block; }\n#closeButtonToDo:hover { color: #E8E8E8; background: rgba(255,255,255,0.08); }\n\n/* DESCRIPTION ROW */\n#descSibling {\n  display: grid;\n  grid-template-columns: 14px 1fr 14px;\n  background: var(--bg-surface);\n  border: 0.5px solid var(--border-mid);\n  border-top: none;\n  border-radius: 0 0 6px 6px;\n  margin: -9px 8px 5px;\n  min-height: 34px;\n  align-items: center;\n  border-left: 2px solid var(--accent-dim);\n}\n\n#descInput {\n  font-size: 12px;\n  font-family: 'Trebuchet MS', sans-serif;\n  background: transparent;\n  color: #BBBBBB;\n  border: none;\n  width: 100%;\n  padding: 8px 0;\n  letter-spacing: 0.02em;\n}\n#descInput::placeholder { color: var(--text-muted); font-style: italic; }\n#descInput:focus { outline: none; color: var(--text-primary); border-bottom: 0.5px solid var(--accent-dim); }\n#descInput:focus::placeholder { color: transparent; }\n\n/* SCROLLBARS */\n#sideMa::-webkit-scrollbar, #mainList::-webkit-scrollbar { width: 3px; }\n#sideMa::-webkit-scrollbar-track, #mainList::-webkit-scrollbar-track { background: transparent; }\n#sideMa::-webkit-scrollbar-thumb, #mainList::-webkit-scrollbar-thumb { background: var(--border-bright); border-radius: 2px; }\n\n/* OVERLAY — only used on touch/mobile */\n#sidebarOverlay {\n  display: none;\n  position: fixed;\n  inset: 0;\n  background: rgba(0,0,0,0.5);\n  z-index: 8;\n  backdrop-filter: blur(2px);\n  -webkit-backdrop-filter: blur(2px);\n}\n#sidebarOverlay.visible { display: block; }\n\n/* ══════════════════════════════════════════\n   DESKTOP > 700px\n   Hamburger collapses sidebar IN the grid.\n   No overlay. Sidebar never slides over content.\n══════════════════════════════════════════ */\n@media (min-width: 701px) {\n\n  /* collapsed: grid shrinks sidebar column to 0 */\n  #mainSec.sidebar-collapsed {\n    grid-template-columns: 0px 1fr;\n  }\n\n  #mainSec.sidebar-collapsed #sideBar {\n    border-right-color: transparent;\n  }\n\n  /* overlay never needed on desktop */\n  #sidebarOverlay { display: none !important; }\n}\n\n/* ══════════════════════════════════════════\n   MOBILE ≤ 700px\n══════════════════════════════════════════ */\n@media (max-width: 700px) {\n\n  body { padding: 0; }\n\n  #outerContainer {\n    border-radius: 0;\n    border: none;\n    height: 100dvh;\n  }\n\n  #mainSec {\n    grid-template-columns: 1fr;\n    transition: none;\n  }\n\n  #sideBar {\n    position: absolute;\n    top: 0;\n    left: 0;\n    width: var(--sidebar-w);\n    height: 100%;\n    z-index: 9;\n    transform: translateX(-100%);\n    transition: transform 0.25s ease;\n    border-right: 0.5px solid var(--border-mid);\n  }\n\n  #sideBar.sidebar-open {\n    transform: translateX(0);\n  }\n\n  #toDoChild {\n    margin: 4px 6px;\n    padding: 0 8px 0 12px;\n  }\n}\n\n/* ══════════════════════════════════════════\n   PHONE  ≤ 420px — hide date only where\n   there is genuinely no room for it\n══════════════════════════════════════════ */\n@media (max-width: 420px) {\n  #dateText, #dueInput { display: none; }\n}\n\n/* ══════════════════════════════════════════\n   LARGE DESKTOP ≥ 1200px\n══════════════════════════════════════════ */\n@media (min-width: 1200px) {\n\n  :root { --sidebar-w: 240px; }\n\n  body { padding: 28px; }\n\n  #outerContainer {\n    height: calc(100dvh - 56px);\n    max-width: 1400px;\n    margin: 0 auto;\n  }\n}`, \"\"]);\n// Exports\n/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (___CSS_LOADER_EXPORT___);\n\n\n//# sourceURL=webpack://todolist_main/./src/style.css?./node_modules/css-loader/dist/cjs.js");

/***/ }),

/***/ "./node_modules/css-loader/dist/runtime/api.js":
/*!*****************************************************!*\
  !*** ./node_modules/css-loader/dist/runtime/api.js ***!
  \*****************************************************/
/***/ ((module) => {

eval("\n\n/*\n  MIT License http://www.opensource.org/licenses/mit-license.php\n  Author Tobias Koppers @sokra\n*/\nmodule.exports = function (cssWithMappingToString) {\n  var list = [];\n\n  // return the list of modules as css string\n  list.toString = function toString() {\n    return this.map(function (item) {\n      var content = \"\";\n      var needLayer = typeof item[5] !== \"undefined\";\n      if (item[4]) {\n        content += \"@supports (\".concat(item[4], \") {\");\n      }\n      if (item[2]) {\n        content += \"@media \".concat(item[2], \" {\");\n      }\n      if (needLayer) {\n        content += \"@layer\".concat(item[5].length > 0 ? \" \".concat(item[5]) : \"\", \" {\");\n      }\n      content += cssWithMappingToString(item);\n      if (needLayer) {\n        content += \"}\";\n      }\n      if (item[2]) {\n        content += \"}\";\n      }\n      if (item[4]) {\n        content += \"}\";\n      }\n      return content;\n    }).join(\"\");\n  };\n\n  // import a list of modules into the list\n  list.i = function i(modules, media, dedupe, supports, layer) {\n    if (typeof modules === \"string\") {\n      modules = [[null, modules, undefined]];\n    }\n    var alreadyImportedModules = {};\n    if (dedupe) {\n      for (var k = 0; k < this.length; k++) {\n        var id = this[k][0];\n        if (id != null) {\n          alreadyImportedModules[id] = true;\n        }\n      }\n    }\n    for (var _k = 0; _k < modules.length; _k++) {\n      var item = [].concat(modules[_k]);\n      if (dedupe && alreadyImportedModules[item[0]]) {\n        continue;\n      }\n      if (typeof layer !== \"undefined\") {\n        if (typeof item[5] === \"undefined\") {\n          item[5] = layer;\n        } else {\n          item[1] = \"@layer\".concat(item[5].length > 0 ? \" \".concat(item[5]) : \"\", \" {\").concat(item[1], \"}\");\n          item[5] = layer;\n        }\n      }\n      if (media) {\n        if (!item[2]) {\n          item[2] = media;\n        } else {\n          item[1] = \"@media \".concat(item[2], \" {\").concat(item[1], \"}\");\n          item[2] = media;\n        }\n      }\n      if (supports) {\n        if (!item[4]) {\n          item[4] = \"\".concat(supports);\n        } else {\n          item[1] = \"@supports (\".concat(item[4], \") {\").concat(item[1], \"}\");\n          item[4] = supports;\n        }\n      }\n      list.push(item);\n    }\n  };\n  return list;\n};\n\n//# sourceURL=webpack://todolist_main/./node_modules/css-loader/dist/runtime/api.js?");

/***/ }),

/***/ "./node_modules/css-loader/dist/runtime/getUrl.js":
/*!********************************************************!*\
  !*** ./node_modules/css-loader/dist/runtime/getUrl.js ***!
  \********************************************************/
/***/ ((module) => {

eval("\n\nmodule.exports = function (url, options) {\n  if (!options) {\n    options = {};\n  }\n  if (!url) {\n    return url;\n  }\n  url = String(url.__esModule ? url.default : url);\n\n  // If url is already wrapped in quotes, remove them\n  if (/^['\"].*['\"]$/.test(url)) {\n    url = url.slice(1, -1);\n  }\n  if (options.hash) {\n    url += options.hash;\n  }\n\n  // Should url be wrapped?\n  // See https://drafts.csswg.org/css-values-3/#urls\n  if (/[\"'() \\t\\n]|(%20)/.test(url) || options.needQuotes) {\n    return \"\\\"\".concat(url.replace(/\"/g, '\\\\\"').replace(/\\n/g, \"\\\\n\"), \"\\\"\");\n  }\n  return url;\n};\n\n//# sourceURL=webpack://todolist_main/./node_modules/css-loader/dist/runtime/getUrl.js?");

/***/ }),

/***/ "./node_modules/css-loader/dist/runtime/noSourceMaps.js":
/*!**************************************************************!*\
  !*** ./node_modules/css-loader/dist/runtime/noSourceMaps.js ***!
  \**************************************************************/
/***/ ((module) => {

eval("\n\nmodule.exports = function (i) {\n  return i[1];\n};\n\n//# sourceURL=webpack://todolist_main/./node_modules/css-loader/dist/runtime/noSourceMaps.js?");

/***/ }),

/***/ "./src/style.css":
/*!***********************!*\
  !*** ./src/style.css ***!
  \***********************/
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (__WEBPACK_DEFAULT_EXPORT__)\n/* harmony export */ });\n/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! !../node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js */ \"./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js\");\n/* harmony import */ var _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! !../node_modules/style-loader/dist/runtime/styleDomAPI.js */ \"./node_modules/style-loader/dist/runtime/styleDomAPI.js\");\n/* harmony import */ var _node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! !../node_modules/style-loader/dist/runtime/insertBySelector.js */ \"./node_modules/style-loader/dist/runtime/insertBySelector.js\");\n/* harmony import */ var _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2__);\n/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__ = __webpack_require__(/*! !../node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js */ \"./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js\");\n/* harmony import */ var _node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3__);\n/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__ = __webpack_require__(/*! !../node_modules/style-loader/dist/runtime/insertStyleElement.js */ \"./node_modules/style-loader/dist/runtime/insertStyleElement.js\");\n/* harmony import */ var _node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4__);\n/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__ = __webpack_require__(/*! !../node_modules/style-loader/dist/runtime/styleTagTransform.js */ \"./node_modules/style-loader/dist/runtime/styleTagTransform.js\");\n/* harmony import */ var _node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default = /*#__PURE__*/__webpack_require__.n(_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5__);\n/* harmony import */ var _node_modules_css_loader_dist_cjs_js_style_css__WEBPACK_IMPORTED_MODULE_6__ = __webpack_require__(/*! !!../node_modules/css-loader/dist/cjs.js!./style.css */ \"./node_modules/css-loader/dist/cjs.js!./src/style.css\");\n\n      \n      \n      \n      \n      \n      \n      \n      \n      \n\nvar options = {};\n\noptions.styleTagTransform = (_node_modules_style_loader_dist_runtime_styleTagTransform_js__WEBPACK_IMPORTED_MODULE_5___default());\noptions.setAttributes = (_node_modules_style_loader_dist_runtime_setAttributesWithoutAttributes_js__WEBPACK_IMPORTED_MODULE_3___default());\n\n      options.insert = _node_modules_style_loader_dist_runtime_insertBySelector_js__WEBPACK_IMPORTED_MODULE_2___default().bind(null, \"head\");\n    \noptions.domAPI = (_node_modules_style_loader_dist_runtime_styleDomAPI_js__WEBPACK_IMPORTED_MODULE_1___default());\noptions.insertStyleElement = (_node_modules_style_loader_dist_runtime_insertStyleElement_js__WEBPACK_IMPORTED_MODULE_4___default());\n\nvar update = _node_modules_style_loader_dist_runtime_injectStylesIntoStyleTag_js__WEBPACK_IMPORTED_MODULE_0___default()(_node_modules_css_loader_dist_cjs_js_style_css__WEBPACK_IMPORTED_MODULE_6__[\"default\"], options);\n\n\n\n\n       /* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (_node_modules_css_loader_dist_cjs_js_style_css__WEBPACK_IMPORTED_MODULE_6__[\"default\"] && _node_modules_css_loader_dist_cjs_js_style_css__WEBPACK_IMPORTED_MODULE_6__[\"default\"].locals ? _node_modules_css_loader_dist_cjs_js_style_css__WEBPACK_IMPORTED_MODULE_6__[\"default\"].locals : undefined);\n\n\n//# sourceURL=webpack://todolist_main/./src/style.css?");

/***/ }),

/***/ "./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js":
/*!****************************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js ***!
  \****************************************************************************/
/***/ ((module) => {

eval("\n\nvar stylesInDOM = [];\nfunction getIndexByIdentifier(identifier) {\n  var result = -1;\n  for (var i = 0; i < stylesInDOM.length; i++) {\n    if (stylesInDOM[i].identifier === identifier) {\n      result = i;\n      break;\n    }\n  }\n  return result;\n}\nfunction modulesToDom(list, options) {\n  var idCountMap = {};\n  var identifiers = [];\n  for (var i = 0; i < list.length; i++) {\n    var item = list[i];\n    var id = options.base ? item[0] + options.base : item[0];\n    var count = idCountMap[id] || 0;\n    var identifier = \"\".concat(id, \" \").concat(count);\n    idCountMap[id] = count + 1;\n    var indexByIdentifier = getIndexByIdentifier(identifier);\n    var obj = {\n      css: item[1],\n      media: item[2],\n      sourceMap: item[3],\n      supports: item[4],\n      layer: item[5]\n    };\n    if (indexByIdentifier !== -1) {\n      stylesInDOM[indexByIdentifier].references++;\n      stylesInDOM[indexByIdentifier].updater(obj);\n    } else {\n      var updater = addElementStyle(obj, options);\n      options.byIndex = i;\n      stylesInDOM.splice(i, 0, {\n        identifier: identifier,\n        updater: updater,\n        references: 1\n      });\n    }\n    identifiers.push(identifier);\n  }\n  return identifiers;\n}\nfunction addElementStyle(obj, options) {\n  var api = options.domAPI(options);\n  api.update(obj);\n  var updater = function updater(newObj) {\n    if (newObj) {\n      if (newObj.css === obj.css && newObj.media === obj.media && newObj.sourceMap === obj.sourceMap && newObj.supports === obj.supports && newObj.layer === obj.layer) {\n        return;\n      }\n      api.update(obj = newObj);\n    } else {\n      api.remove();\n    }\n  };\n  return updater;\n}\nmodule.exports = function (list, options) {\n  options = options || {};\n  list = list || [];\n  var lastIdentifiers = modulesToDom(list, options);\n  return function update(newList) {\n    newList = newList || [];\n    for (var i = 0; i < lastIdentifiers.length; i++) {\n      var identifier = lastIdentifiers[i];\n      var index = getIndexByIdentifier(identifier);\n      stylesInDOM[index].references--;\n    }\n    var newLastIdentifiers = modulesToDom(newList, options);\n    for (var _i = 0; _i < lastIdentifiers.length; _i++) {\n      var _identifier = lastIdentifiers[_i];\n      var _index = getIndexByIdentifier(_identifier);\n      if (stylesInDOM[_index].references === 0) {\n        stylesInDOM[_index].updater();\n        stylesInDOM.splice(_index, 1);\n      }\n    }\n    lastIdentifiers = newLastIdentifiers;\n  };\n};\n\n//# sourceURL=webpack://todolist_main/./node_modules/style-loader/dist/runtime/injectStylesIntoStyleTag.js?");

/***/ }),

/***/ "./node_modules/style-loader/dist/runtime/insertBySelector.js":
/*!********************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/insertBySelector.js ***!
  \********************************************************************/
/***/ ((module) => {

eval("\n\nvar memo = {};\n\n/* istanbul ignore next  */\nfunction getTarget(target) {\n  if (typeof memo[target] === \"undefined\") {\n    var styleTarget = document.querySelector(target);\n\n    // Special case to return head of iframe instead of iframe itself\n    if (window.HTMLIFrameElement && styleTarget instanceof window.HTMLIFrameElement) {\n      try {\n        // This will throw an exception if access to iframe is blocked\n        // due to cross-origin restrictions\n        styleTarget = styleTarget.contentDocument.head;\n      } catch (e) {\n        // istanbul ignore next\n        styleTarget = null;\n      }\n    }\n    memo[target] = styleTarget;\n  }\n  return memo[target];\n}\n\n/* istanbul ignore next  */\nfunction insertBySelector(insert, style) {\n  var target = getTarget(insert);\n  if (!target) {\n    throw new Error(\"Couldn't find a style target. This probably means that the value for the 'insert' parameter is invalid.\");\n  }\n  target.appendChild(style);\n}\nmodule.exports = insertBySelector;\n\n//# sourceURL=webpack://todolist_main/./node_modules/style-loader/dist/runtime/insertBySelector.js?");

/***/ }),

/***/ "./node_modules/style-loader/dist/runtime/insertStyleElement.js":
/*!**********************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/insertStyleElement.js ***!
  \**********************************************************************/
/***/ ((module) => {

eval("\n\n/* istanbul ignore next  */\nfunction insertStyleElement(options) {\n  var element = document.createElement(\"style\");\n  options.setAttributes(element, options.attributes);\n  options.insert(element, options.options);\n  return element;\n}\nmodule.exports = insertStyleElement;\n\n//# sourceURL=webpack://todolist_main/./node_modules/style-loader/dist/runtime/insertStyleElement.js?");

/***/ }),

/***/ "./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js":
/*!**********************************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js ***!
  \**********************************************************************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

eval("\n\n/* istanbul ignore next  */\nfunction setAttributesWithoutAttributes(styleElement) {\n  var nonce =  true ? __webpack_require__.nc : 0;\n  if (nonce) {\n    styleElement.setAttribute(\"nonce\", nonce);\n  }\n}\nmodule.exports = setAttributesWithoutAttributes;\n\n//# sourceURL=webpack://todolist_main/./node_modules/style-loader/dist/runtime/setAttributesWithoutAttributes.js?");

/***/ }),

/***/ "./node_modules/style-loader/dist/runtime/styleDomAPI.js":
/*!***************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/styleDomAPI.js ***!
  \***************************************************************/
/***/ ((module) => {

eval("\n\n/* istanbul ignore next  */\nfunction apply(styleElement, options, obj) {\n  var css = \"\";\n  if (obj.supports) {\n    css += \"@supports (\".concat(obj.supports, \") {\");\n  }\n  if (obj.media) {\n    css += \"@media \".concat(obj.media, \" {\");\n  }\n  var needLayer = typeof obj.layer !== \"undefined\";\n  if (needLayer) {\n    css += \"@layer\".concat(obj.layer.length > 0 ? \" \".concat(obj.layer) : \"\", \" {\");\n  }\n  css += obj.css;\n  if (needLayer) {\n    css += \"}\";\n  }\n  if (obj.media) {\n    css += \"}\";\n  }\n  if (obj.supports) {\n    css += \"}\";\n  }\n  var sourceMap = obj.sourceMap;\n  if (sourceMap && typeof btoa !== \"undefined\") {\n    css += \"\\n/*# sourceMappingURL=data:application/json;base64,\".concat(btoa(unescape(encodeURIComponent(JSON.stringify(sourceMap)))), \" */\");\n  }\n\n  // For old IE\n  /* istanbul ignore if  */\n  options.styleTagTransform(css, styleElement, options.options);\n}\nfunction removeStyleElement(styleElement) {\n  // istanbul ignore if\n  if (styleElement.parentNode === null) {\n    return false;\n  }\n  styleElement.parentNode.removeChild(styleElement);\n}\n\n/* istanbul ignore next  */\nfunction domAPI(options) {\n  if (typeof document === \"undefined\") {\n    return {\n      update: function update() {},\n      remove: function remove() {}\n    };\n  }\n  var styleElement = options.insertStyleElement(options);\n  return {\n    update: function update(obj) {\n      apply(styleElement, options, obj);\n    },\n    remove: function remove() {\n      removeStyleElement(styleElement);\n    }\n  };\n}\nmodule.exports = domAPI;\n\n//# sourceURL=webpack://todolist_main/./node_modules/style-loader/dist/runtime/styleDomAPI.js?");

/***/ }),

/***/ "./node_modules/style-loader/dist/runtime/styleTagTransform.js":
/*!*********************************************************************!*\
  !*** ./node_modules/style-loader/dist/runtime/styleTagTransform.js ***!
  \*********************************************************************/
/***/ ((module) => {

eval("\n\n/* istanbul ignore next  */\nfunction styleTagTransform(css, styleElement) {\n  if (styleElement.styleSheet) {\n    styleElement.styleSheet.cssText = css;\n  } else {\n    while (styleElement.firstChild) {\n      styleElement.removeChild(styleElement.firstChild);\n    }\n    styleElement.appendChild(document.createTextNode(css));\n  }\n}\nmodule.exports = styleTagTransform;\n\n//# sourceURL=webpack://todolist_main/./node_modules/style-loader/dist/runtime/styleTagTransform.js?");

/***/ }),

/***/ "./src/Zector.otf":
/*!************************!*\
  !*** ./src/Zector.otf ***!
  \************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

eval("module.exports = __webpack_require__.p + \"3d8b4735b9012eee8086.otf\";\n\n//# sourceURL=webpack://todolist_main/./src/Zector.otf?");

/***/ }),

/***/ "./src/addProj_button.svg":
/*!********************************!*\
  !*** ./src/addProj_button.svg ***!
  \********************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

eval("module.exports = __webpack_require__.p + \"7bfd4a4cf945aaf710dd.svg\";\n\n//# sourceURL=webpack://todolist_main/./src/addProj_button.svg?");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			id: moduleId,
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = __webpack_modules__;
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat get default export */
/******/ 	(() => {
/******/ 		// getDefaultExport function for compatibility with non-harmony modules
/******/ 		__webpack_require__.n = (module) => {
/******/ 			var getter = module && module.__esModule ?
/******/ 				() => (module['default']) :
/******/ 				() => (module);
/******/ 			__webpack_require__.d(getter, { a: getter });
/******/ 			return getter;
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/define property getters */
/******/ 	(() => {
/******/ 		// define getter functions for harmony exports
/******/ 		__webpack_require__.d = (exports, definition) => {
/******/ 			for(var key in definition) {
/******/ 				if(__webpack_require__.o(definition, key) && !__webpack_require__.o(exports, key)) {
/******/ 					Object.defineProperty(exports, key, { enumerable: true, get: definition[key] });
/******/ 				}
/******/ 			}
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/global */
/******/ 	(() => {
/******/ 		__webpack_require__.g = (function() {
/******/ 			if (typeof globalThis === 'object') return globalThis;
/******/ 			try {
/******/ 				return this || new Function('return this')();
/******/ 			} catch (e) {
/******/ 				if (typeof window === 'object') return window;
/******/ 			}
/******/ 		})();
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/hasOwnProperty shorthand */
/******/ 	(() => {
/******/ 		__webpack_require__.o = (obj, prop) => (Object.prototype.hasOwnProperty.call(obj, prop))
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/make namespace object */
/******/ 	(() => {
/******/ 		// define __esModule on exports
/******/ 		__webpack_require__.r = (exports) => {
/******/ 			if(typeof Symbol !== 'undefined' && Symbol.toStringTag) {
/******/ 				Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
/******/ 			}
/******/ 			Object.defineProperty(exports, '__esModule', { value: true });
/******/ 		};
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/publicPath */
/******/ 	(() => {
/******/ 		var scriptUrl;
/******/ 		if (__webpack_require__.g.importScripts) scriptUrl = __webpack_require__.g.location + "";
/******/ 		var document = __webpack_require__.g.document;
/******/ 		if (!scriptUrl && document) {
/******/ 			if (document.currentScript)
/******/ 				scriptUrl = document.currentScript.src;
/******/ 			if (!scriptUrl) {
/******/ 				var scripts = document.getElementsByTagName("script");
/******/ 				if(scripts.length) {
/******/ 					var i = scripts.length - 1;
/******/ 					while (i > -1 && !scriptUrl) scriptUrl = scripts[i--].src;
/******/ 				}
/******/ 			}
/******/ 		}
/******/ 		// When supporting browsers where an automatic publicPath is not supported you must specify an output.publicPath manually via configuration
/******/ 		// or pass an empty string ("") and set the __webpack_public_path__ variable from your code to use your own logic.
/******/ 		if (!scriptUrl) throw new Error("Automatic publicPath is not supported in this browser");
/******/ 		scriptUrl = scriptUrl.replace(/#.*$/, "").replace(/\?.*$/, "").replace(/\/[^\/]+$/, "/");
/******/ 		__webpack_require__.p = scriptUrl;
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/jsonp chunk loading */
/******/ 	(() => {
/******/ 		__webpack_require__.b = document.baseURI || self.location.href;
/******/ 		
/******/ 		// object to store loaded and loading chunks
/******/ 		// undefined = chunk not loaded, null = chunk preloaded/prefetched
/******/ 		// [resolve, reject, Promise] = chunk loading, 0 = chunk loaded
/******/ 		var installedChunks = {
/******/ 			"list": 0
/******/ 		};
/******/ 		
/******/ 		// no chunk on demand loading
/******/ 		
/******/ 		// no prefetching
/******/ 		
/******/ 		// no preloaded
/******/ 		
/******/ 		// no HMR
/******/ 		
/******/ 		// no HMR manifest
/******/ 		
/******/ 		// no on chunks loaded
/******/ 		
/******/ 		// no jsonp function
/******/ 	})();
/******/ 	
/******/ 	/* webpack/runtime/nonce */
/******/ 	(() => {
/******/ 		__webpack_require__.nc = undefined;
/******/ 	})();
/******/ 	
/************************************************************************/
/******/ 	
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	// This entry module can't be inlined because the eval devtool is used.
/******/ 	var __webpack_exports__ = __webpack_require__("./src/listLogic.js");
/******/ 	
/******/ })()
;