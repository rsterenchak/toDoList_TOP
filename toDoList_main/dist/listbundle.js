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

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   listLogic: () => (/* binding */ listLogic)\n/* harmony export */ });\n/* harmony import */ var _style_css__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ./style.css */ \"./src/style.css\");\n/* harmony import */ var _toDo_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ./toDo.js */ \"./src/toDo.js\");\n\n\n\n// ORIGINAL FUNCTION CALL,\nvar listLogic = function () {\n  // Array.prototype.addProject = addProject;\n  // Array.prototype.listProjects = listProjects;\n\n  // console.log(\"Initialized ListLogic\");\n\n  // INITIAL: toDo item variables\n  var itemTitle = '';\n  var itemDesc = '';\n  var itemDue = '';\n  var itemPri = 1;\n\n  // INITIAL: define allProjects object that dynamically stores arrays as new properties \n  var allProjects = {\n    // new array properties would be stored here\n  };\n\n  // INITIAL: Sets the initial Project name and is used later to store new project names within addProject\n  var projectName = 'Default';\n\n  // INITIAL: Initial Empty Item\n  var listItem = (0,_toDo_js__WEBPACK_IMPORTED_MODULE_1__.toDo)(itemTitle, itemDesc, itemDue, itemPri);\n\n  // INITIAL: Sets Default project\n  allProjects[projectName] = [];\n\n  // INITIAL: Adds 'empty' list item to project array\n  allProjects[projectName].push(listItem);\n  var allProjectsTotal = Object.keys(allProjects).length;\n\n  // FUNCTION (CURRENT PROJECTS): - responsible for placing newly named projects into allProjects array\n  //                              - \n  function listProjects() {\n    console.log(Object.keys(allProjects));\n  }\n\n  // FUNCTION (NEW PROJECTS): - responsible for placing newly named projects into allProjects array\n  //           - activates when onClick for new project takes place.\n  //           - takes in user input for project name and stores it in the allProjects array\n  function addProject(projectName) {\n    // console.log(\"Enter addProject function\");\n    // Sets variable for 'empty' list item\n    var listItem = (0,_toDo_js__WEBPACK_IMPORTED_MODULE_1__.toDo)(itemTitle, itemDesc, itemDue, itemPri);\n\n    // store prompted user input for project name\n    // var projectName = prompt(\"Enter New Project Name: \");\n\n    projectName = projectName.trim();\n\n    // set projectName as a new property of the allProjects object\n    allProjects[projectName] = [];\n\n    // empty array (empty item) NEEDS to also be pushed for allProjects to 'recognize' as an array\n    allProjects[projectName].push(listItem);\n    allProjectsTotal = Object.keys(allProjects).length;\n    // console.log(projectName + \" added\");\n\n    // console.log(allProjects[projectName]);\n    return {\n      array: allProjects[projectName],\n      string: projectName\n    }; // return project array\n  }\n\n  // **************** WORKING ON ****************\n  // FUNCTION (REMOVE PROJECTS): - responsible for removing named projects inside allProjects array\n  //                             - projectName property needs to be passed to function to identify \n  function removeProject(projectName) {\n    var before = Object.keys(allProjects).length;\n    var projectDes = projectName;\n    delete allProjects[projectDes];\n    var after = Object.keys(allProjects).length;\n\n    // check if property was removed by checking if the number of allProjects properties was reduced*\n    if (after < before) {\n      console.log(projectDes + \" was removed\");\n    } else {\n      console.log(projectDes + \" was not removed\");\n    }\n  }\n\n  // FUNCTION (ADD TODO LIST ITEMS): - responsible for adding new items to a designated project\n  //                                 - called when add button under a project is clicked\n  function addToDo(projectName, toDoName) {\n    // console.log(\"called addToDo function\");\n\n    var projectDes = projectName;\n\n    // Project should be passed into function as variable - 'projectName'\n    // var selectedProject = projectName;\n\n    // based on the project selected, take in new variables for object\n    var itemTitle = toDoName;\n    var itemDesc = '';\n    var itemDue = '';\n    var itemPri = 1;\n    var itemPos = 0;\n\n    // with the new variables, instantiate the new toDo list object\n    var listItem = (0,_toDo_js__WEBPACK_IMPORTED_MODULE_1__.toDo)(itemTitle, itemDesc, itemDue, itemPri, itemPos);\n\n    // push that new object to the allProjects array\n    allProjects[projectDes].push(listItem);\n    return {\n      array: allProjects[projectName],\n      string: projectName,\n      lengths: allProjects[projectName].length\n    }; // return project array        \n  }\n\n  ;\n  function removeToDo(project, index, length) {\n    // project 1, pos 1, length is 3\n    // console.log(\"called removeToDo function\");\n\n    // based on the project selected, take in new variables for object\n    var itemTitle = '';\n    var itemDesc = '';\n    var itemDue = '';\n    var itemPri = 1;\n    var itemPos = 0;\n\n    // with the new variables, instantiate the new toDo list object\n    var listItem = (0,_toDo_js__WEBPACK_IMPORTED_MODULE_1__.toDo)(itemTitle, itemDesc, itemDue, itemPri, itemPos);\n    index = parseInt(index, 10);\n\n    // console.log(\"index: \" + index);\n\n    // if the length of the project array is 1 and the index is 0,\n    // instead of removing the array logic/DOM entirely just reset it\n    // otherwise just remove the logic/DOM\n\n    if (length === 1 && index === 0) {\n      console.log(\"Only a single item exists\");\n\n      // pop() item from project array\n      allProjects[project].pop(index);\n\n      // console.log(allProjects[project]); //  check array\n\n      // push that new object to the allProjects array\n      allProjects[project].push(listItem);\n\n      // console.log(allProjects[project]); //  check array\n    } else {\n      removeElementAtIndex(allProjects[project], index);\n      // console.log((allProjects[project]));\n    }\n  }\n\n  ;\n\n  // FUNCTION (EDIT TODO LIST ITEMS): - responsible for editing specified project array items\n  //                                  - called when gui item section is clicked on\n  //                                  - **** WILL NOT WORK AFTER SECOND EDIT ****\n  function editProject(currentProperty, newProperty) {\n    // set projectName as a new property of the allProjects object\n    allProjects[newProperty] = allProjects[currentProperty];\n    delete allProjects[currentProperty];\n    allProjectsTotal = Object.keys(allProjects).length;\n    return {\n      array: allProjects[newProperty],\n      string: newProperty\n    }; // return project array\n  }\n\n  ;\n  function listItems(project) {\n    var projectName = project;\n    var projectArray = allProjects[projectName];\n    return projectArray;\n  }\n  ;\n  function projectLength(project) {\n    var projectLength = allProjects[project].length;\n    return projectLength;\n  }\n  ;\n  function removeElementAtIndex(arr, index) {\n    if (index >= 0 && index < arr.length) {\n      arr.splice(index, 1);\n      return arr;\n    } else {\n      console.log(\"else error: \" + index);\n      console.error(\"Index out of bounds\");\n      return arr; // Return the original array if the index is out of bounds\n    }\n  }\n\n  return {\n    addProject: addProject,\n    removeProject: removeProject,\n    listProjects: listProjects,\n    addToDo: addToDo,\n    removeToDo: removeToDo,\n    editProject: editProject,\n    listItems: listItems,\n    projectLength: projectLength\n  };\n\n  // **************** TESTING INPUTS/FUNCTIONS **************** //\n\n  // addProject(); // - asks for project name, Adds new project\n\n  // removeProject(allProjectsTotal); // -  Removes designated Project, determines if project was exists/was removed\n\n  // addToDo(); // - asks for project, Adds empty toDo item to designated projects\n\n  // editToDo(); // - asks for which project, prompts for details - function that edits toDo listItems\n\n  // listProjects();\n\n  // ********************* TESTING PRINTS ********************* //\n\n  // *********************************************************** // \n\n  // window.addProject = addProject; // makes addProject() function available to user globally\n}(); // Ends CurrentSession\n\n// **** IMPORTANT IDEA ****: To get around the issue of not being able to export nested functions\n//            Attach each function to the listLogic() object prototype\n\n//# sourceURL=webpack://todolist_main/./src/listLogic.js?");

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

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   \"default\": () => (__WEBPACK_DEFAULT_EXPORT__)\n/* harmony export */ });\n/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__ = __webpack_require__(/*! ../node_modules/css-loader/dist/runtime/noSourceMaps.js */ \"./node_modules/css-loader/dist/runtime/noSourceMaps.js\");\n/* harmony import */ var _node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0__);\n/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__ = __webpack_require__(/*! ../node_modules/css-loader/dist/runtime/api.js */ \"./node_modules/css-loader/dist/runtime/api.js\");\n/* harmony import */ var _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1__);\n/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__ = __webpack_require__(/*! ../node_modules/css-loader/dist/runtime/getUrl.js */ \"./node_modules/css-loader/dist/runtime/getUrl.js\");\n/* harmony import */ var _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default = /*#__PURE__*/__webpack_require__.n(_node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2__);\n// Imports\n\n\n\nvar ___CSS_LOADER_URL_IMPORT_0___ = new URL(/* asset import */ __webpack_require__(/*! ./Zector.otf */ \"./src/Zector.otf\"), __webpack_require__.b);\nvar ___CSS_LOADER_URL_IMPORT_1___ = new URL(/* asset import */ __webpack_require__(/*! ./addProj_button.svg */ \"./src/addProj_button.svg\"), __webpack_require__.b);\nvar ___CSS_LOADER_URL_IMPORT_2___ = new URL(/* asset import */ __webpack_require__(/*! ./close-svgrepo-com.svg */ \"./src/close-svgrepo-com.svg\"), __webpack_require__.b);\nvar ___CSS_LOADER_EXPORT___ = _node_modules_css_loader_dist_runtime_api_js__WEBPACK_IMPORTED_MODULE_1___default()((_node_modules_css_loader_dist_runtime_noSourceMaps_js__WEBPACK_IMPORTED_MODULE_0___default()));\nvar ___CSS_LOADER_URL_REPLACEMENT_0___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_0___);\nvar ___CSS_LOADER_URL_REPLACEMENT_1___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_1___);\nvar ___CSS_LOADER_URL_REPLACEMENT_2___ = _node_modules_css_loader_dist_runtime_getUrl_js__WEBPACK_IMPORTED_MODULE_2___default()(___CSS_LOADER_URL_IMPORT_2___);\n// Module\n___CSS_LOADER_EXPORT___.push([module.id, `@font-face {\n  font-family: 'MyFont';\n  src: url(${___CSS_LOADER_URL_REPLACEMENT_0___});\n}\n\nbody {\n  margin: 0px;\n  padding: 30px;\n  \n}\n\n#outerContainer {\n  display: grid;\n  \n  grid-template-rows: 5vh 85vh 10vh;\n\n}\n\n#navBar {\n\n  border: 1px solid black;\n  background-color: white;\n  \n\n}\n\n\n#mainSec {\n  display: grid;\n  grid-template-columns: 1fr 3fr;\n  \n}\n\n\n#footBar {\n\n  border: 1px solid black;\n  background-color: white;\n\n}\n\n\n\n\n#sideBar {\n  display: grid;\n  grid-template-rows: 1fr 11fr;\n}\n\n#sideTit {\n  display: grid;\n  justify-content: center;\n  align-content: center;\n  border: 1px solid black;\n  background-color: white;\n  \n}\n\n#sideHead {\n  font-family: 'MyFont';\n  font-size: 24px;\n  background-color: white;\n  \n}\n\n#sideMa {\n  display: grid;\n  border: 0.5px solid black;\n  grid-template-rows: repeat(auto-fit, minmax(30px, 30px));\n}\n\n\n#addProj {\n  display: grid;\n  border-bottom: 0.5px solid black;\n  justify-content: center;\n  align-content: center;\n  background-color: white;\n}\n\n#projButton {\n  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_1___});\n  background-size: cover; /* Adjust as needed */\n  border: 0.5px solid black;\n  width: 16px;\n  height: 16px;\n  background-color: white;\n}\n\n#projChild {\n  display: grid;\n  align-content: center;\n  justify-content: center;\n  grid-template-columns: 1fr 22px 12px;\n  cursor: pointer;\n  background-color: white;\n  \n}\n\n.unselectedProject {\n\n  border: 1px solid black;\n\n}\n\n.selectedProject {\n\n  border: 1px solid red;\n\n}\n\n\n#projInput {\n  font-size: 12px;\n  text-align: center;\n  background-color: rgba(0, 0, 0, 0);\n}\n\n#projInput:focus {\n  box-shadow: none;\n  background: white;\n  outline: none;\n  \n}\n\n\n#projInput:focus::placeholder {\n  \n  color: transparent;\n  background-color: rgba(0, 0, 0, 0);\n}\n\n\n\n#closeButton {\n  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_2___});\n  background-size: cover; /* Adjust as needed */\n  width: 12px;\n  height: 12px;\n  align-self: center;\n}\n\n\n\n#mainBar {\n  display: grid;\n  grid-template-rows: 1fr 11fr;\n}\n\n#mainTitle {\n  display: grid;\n  border: 1px solid black;\n  justify-content: center;\n  align-content: center;\n  background-color: white;\n\n}\n\n#mainHead {\n  font-family: 'MyFont';\n  font-size: 24px;  \n  background-color: white;\n\n}\n\n#mainList {\n  display: grid;\n  border: 0.5px solid black;\n  grid-template-rows: repeat(auto-fit, minmax(30px, 30px));\n}\n\n#addItem {\n  display: grid;\n  border-bottom: 0.5px solid black;\n  justify-content: center;\n  align-content: center;\n  background-color: white;\n  \n}\n\n#itemButton {\n  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_1___});\n  background-size: cover; /* Adjust as needed */\n  border: 0.5px solid black;\n  width: 16px;\n  height: 16px;\n}\n\n#toDoChild{\n  display: grid;\n  align-content: center;\n  justify-content: center;\n  grid-template-columns: 6fr 1fr 1fr 50px 20px;\n  cursor: pointer;\n  background-color: white;\n\n}\n\n#toDoInput {\n  font-size: 14px;\n  text-align: center;\n  justify-self: center;\n  background-color: rgb(242, 242, 242);\n}\n\n#toDoInput:focus {\n  box-shadow: none;\n  background: white;\n  outline: none;\n  \n}\n\n#toDoInput::placeholder {\n  \n\n}\n\n#toDoInput:focus::placeholder {\n  \n  color: transparent;\n  background-color: rgba(0, 0, 0, 0);\n}\n\n#dateText {\n  text-align: right;\n\n}\n\n#dueInput {\n  display: grid;\n  grid-template-columns: 18px 7px 18px 6px 40px;\n  border-radius: 2px;\n  background-color: rgb(242, 242, 242);\n  width: 95px;\n  text-align: center;\n  justify-content: center;\n  justify-self: end;\n\n\n}\n\n#dueInput:focus::placeholder {\n  \n  color: transparent;\n  background-color: rgba(0, 0, 0, 0);\n}\n\n\n\n#month {\n\n  font-size: 12px;\n  border: none;\n  text-align: center;\n  background-color: rgba(0, 0, 0, 0);\n}\n\n#month:focus {\n  outline: none;\n  border: none;\n  \n}\n\n#month:focus::placeholder {\n  color: transparent;\n}\n\n#day {\n\n  font-size: 12px;\n  border: none;\n  text-align: center;\n  background-color: rgba(0, 0, 0, 0);\n}\n\n#day:focus {\n  outline: none;\n  border: none;\n  \n}\n\n#day:focus::placeholder {\n  color: transparent;\n}\n\n#year {\n\n  font-size: 12px;\n  border: none;\n  text-align: center;\n  background-color: rgba(0, 0, 0, 0);\n}\n\n#year:focus {\n  outline: none;\n  border: none;\n  \n}\n\n#year:focus::placeholder {\n  color: transparent;\n}\n\n#dash {\n  align-self: center;\n  justify-self: center;\n  justify-content: center;\n  \n\n}\n\n#spacer {\n\n  border: 1px solid white;\n\n\n}\n\n#closeButtonToDo {\n  background-image: url(${___CSS_LOADER_URL_REPLACEMENT_2___});\n  background-size: cover; /* Adjust as needed */\n  width: 12px;\n  height: 12px;\n  align-self: center;\n}\n\n\n#descSibling {\n  display: grid;\n  grid-template-columns: 1fr 2fr 1fr;\n\n}\n\n#descSpacer1 {\n \n\n}\n\n#descInput {\n  border: 1px solid red;\n\n}\n\n#descSpacer2 {\n \n\n}`, \"\"]);\n// Exports\n/* harmony default export */ const __WEBPACK_DEFAULT_EXPORT__ = (___CSS_LOADER_EXPORT___);\n\n\n//# sourceURL=webpack://todolist_main/./src/style.css?./node_modules/css-loader/dist/cjs.js");

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

eval("module.exports = __webpack_require__.p + \"3be0ea4ac64cead2bf95.svg\";\n\n//# sourceURL=webpack://todolist_main/./src/addProj_button.svg?");

/***/ }),

/***/ "./src/close-svgrepo-com.svg":
/*!***********************************!*\
  !*** ./src/close-svgrepo-com.svg ***!
  \***********************************/
/***/ ((module, __unused_webpack_exports, __webpack_require__) => {

eval("module.exports = __webpack_require__.p + \"5c6cd17c4693737efbb3.svg\";\n\n//# sourceURL=webpack://todolist_main/./src/close-svgrepo-com.svg?");

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