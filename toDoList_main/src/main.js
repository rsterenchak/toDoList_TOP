import './style.css';
import { listLogic } from './listLogic.js';
import button from './addProj_button.svg';


// restoreFromStorage is assigned at the bottom of component() and exported here
// so index.js can call it after document.body.appendChild(component())
let restoreFromStorage = function() {};


function component() {

    console.log("Initialized DOM");

    const base = document.createElement('div');
    const nav = document.createElement('div');
    const main = document.createElement('div');
    const foot = document.createElement('div');

    const main1 = document.createElement('div');
    const main2 = document.createElement('div');

    const sideTitle = document.createElement('div');
    const sideMain = document.createElement('div');

    const sideHead = document.createElement('div');

    const addProj = document.createElement('div');
    const projButton = document.createElement('div');

    const mainTitle = document.createElement('div');
    const mainList = document.createElement('div');

    const mainHead = document.createElement('div');

    const addItem = document.createElement('div');
    const itemButton = document.createElement('div');

    base.id ='outerContainer';
    nav.id = 'navBar';
    main.id = 'mainSec';
    foot.id = 'footBar';

    main1.id = 'sideBar';
    main2.id = 'mainBar';

    sideTitle.id = 'sideTit';
    sideMain.id = 'sideMa';

    sideHead.id = 'sideHead';

    addProj.id = 'addProj';
    projButton.id = 'projButton';

    mainTitle.id = 'mainTitle';
    mainList.id = 'mainList';

    mainHead.id = 'mainHead';

    addItem.id = 'addItem';
    itemButton.id = 'itemButton';

    base.appendChild(nav);
    base.appendChild(main);
    base.appendChild(foot);

    main.appendChild(main1);
    main.appendChild(main2);

    main1.appendChild(sideTitle);
    main1.appendChild(sideMain);

    sideTitle.appendChild(sideHead);

    sideMain.appendChild(addProj);
    addProj.appendChild(projButton);

    main2.appendChild(mainTitle);
    main2.appendChild(mainList);

    mainTitle.appendChild(mainHead);

    mainList.appendChild(addItem);
    addItem.appendChild(itemButton);

    mainHead.textContent = 'toDo Items';
    sideHead.textContent = 'Projects';

    itemButton.style.pointerEvents = "none";

    // *** HELPER: clears all toDo DOM elements from mainList (index 1 onward) ***
    function clearToDos_global() {
        while (mainList.childNodes.length > 1) {
            mainList.removeChild(mainList.childNodes[1]);
        }
    }

    // *** HELPER: single source of truth for itemButton state ***
    function updateItemButton(project) {
        const items = listLogic.listItems(project);
        if (!items || items.length === 0) { itemButton.style.pointerEvents = "none"; return; }
        const lastItem = items[items.length - 1];
        itemButton.style.pointerEvents = (lastItem.tit === "") ? "none" : "auto";
    }

    // *** HELPER: build a sidebar project row and wire all its listeners ***
    // Used by both projButton click (new projects) AND restoreFromStorage (reload)
    function createProjectRow(projectName, isNew) {

        const sideMaDiv = document.getElementById("sideMa");

        const projChild   = document.createElement("div");
        const titleInput  = document.createElement("input");
        const closeButton = document.createElement("div");
        const spacer      = document.createElement("div");

        projChild.classList.add("unselectedProject");
        projChild.id = "projChild";

        titleInput.type = "text";
        titleInput.id = "projInput";
        titleInput.placeholder = "New Project";
        titleInput.value = isNew ? "" : projectName;
        titleInput.style.border = "none";
        titleInput.style.fontSize = "14px";

        closeButton.id = "closeButton";
        spacer.style.width = "12px";

        sideMaDiv.appendChild(projChild);
        projChild.appendChild(titleInput);
        projChild.appendChild(closeButton);
        projChild.appendChild(spacer);

        let currentProperty = projectName;
        let firstTime = isNew ? 0 : 1; // if restoring, project already exists in logic

        // ── select this project ──
        function selectThisProject() {
            const prev = document.querySelector('.selectedProject');
            if (prev) {
                prev.classList.remove("selectedProject");
                prev.classList.add("unselectedProject");
            }
            projChild.classList.remove("unselectedProject");
            projChild.classList.add("selectedProject");
        }

        // ── Enter key: name / rename project ──
        titleInput.addEventListener("keydown", function(event) {
            if (event.key !== "Enter") return;

            const enteredText = titleInput.value.trim();
            if (enteredText.length === 0) return;

            const projectsList = listLogic.listProjectsArray();
            const duplicate = projectsList.some(function(n) {
                return n === enteredText && n !== currentProperty;
            });

            if (duplicate) {
                titleInput.textContent = "INVALID";
                titleInput.style.color = 'red';
                return;
            }

            titleInput.style.color = '';
            titleInput.value = enteredText;
            titleInput.blur();

            let projectItems;

            if (firstTime === 0) {
                // brand new project
                projectItems = listLogic.addProject(enteredText);
                currentProperty = enteredText;
                firstTime = 1;
            } else {
                // rename existing
                projectItems = listLogic.editProject(currentProperty, enteredText);
                currentProperty = enteredText;
            }

            selectThisProject();
            clearToDos_global();
            addAllToDo_DOM(listLogic.listItems(currentProperty), currentProperty);
            projButton.style.pointerEvents = "auto";
        });

        // ── click: select project and show its todos ──
        projChild.addEventListener("click", function(event) {
            if (event.target === titleInput) return; // let rename work
            if (firstTime === 0) return;             // not named yet

            selectThisProject();

            const items = listLogic.listItems(currentProperty);
            clearToDos_global();
            if (items && items.length > 0) {
                addAllToDo_DOM(items, currentProperty);
            }
            updateItemButton(currentProperty);
        });

        // ── close: remove project ──
        closeButton.addEventListener("click", function() {
            const mainListEl = document.getElementById("mainList");
            let mainChild = document.getElementById("toDoChild");

            projChild.parentNode.removeChild(projChild);

            while (mainListEl.contains(mainChild)) {
                if (mainChild.nextSibling && mainChild.nextSibling.id === 'descSibling') {
                    mainListEl.removeChild(mainChild.nextSibling);
                }
                mainListEl.removeChild(mainChild);
                mainChild = document.getElementById("toDoChild");
            }

            listLogic.removeProject(currentProperty);
            listLogic.listProjects();
            projButton.style.pointerEvents = "auto";
        });

        // ── hover styles ──
        projChild.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.background = "#222222";
        });
        projChild.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.background = "transparent";
        });
        closeButton.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.border = "0.05px solid black";
        });
        closeButton.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.border = "none";
        });
        titleInput.addEventListener("focus", function() {
            this.style.background = "rgba(0, 0, 0, 0)";
            projChild.style.boxShadow = "none";
            projChild.style.background = "#1C1C1C";
        });

        return { projChild, titleInput, selectThisProject };
    }


    // ********************** CLICK LISTENERS ********************** //

    // Click Listener: adds new project row
    projButton.addEventListener("click", function() {
        console.log("Called projButton");
        projButton.style.pointerEvents = "none";
        itemButton.style.pointerEvents = "none";
        createProjectRow("", true);
    });


    // Click Listener: adds new todo item
    itemButton.addEventListener("click", function() {

        console.log("Called itemButton");
        itemButton.style.pointerEvents = "none";

        const selectedEl = document.querySelector('.selectedProject');
        if (!selectedEl) return;
        const currentProject = selectedEl.querySelector('#projInput')
            ? selectedEl.querySelector('#projInput').value
            : selectedEl.dataset.project;

        const mainListDiv = document.getElementById("mainList");
        const toDoChild = document.createElement("div");
        const toDoInput = document.createElement("input");
        const dueInput = document.createElement("div");
        const dateText = document.createElement("div");
        const month = document.createElement("input");
        const dash = document.createElement("div");
        const day = document.createElement("input");
        const dash2 = document.createElement("div");
        const year = document.createElement("input");
        const closeButtonToDo = document.createElement("div");
        const spacer = document.createElement("div");
        const descSibling = document.createElement('div');
        const descSpacer1 = document.createElement('div');
        const descInput = document.createElement('input');
        const descSpacer2 = document.createElement('div');

        toDoChild.style.border = "0.5px solid black";
        toDoChild.id = "toDoChild";
        dateText.id = "dateText";
        dateText.textContent = "Due:";
        dueInput.id = "dueInput";
        dueInput.style.fontSize = "10px";
        month.id = "month"; month.placeholder = 1;
        day.id = "day"; day.placeholder = 1;
        year.id = "year"; year.placeholder = 2023;
        dash.id = "dash"; dash.textContent = "/";
        dash2.id = "dash"; dash2.textContent = "/";
        spacer.id = "spacer";
        toDoInput.type = "text";
        toDoInput.id = "toDoInput";
        toDoInput.placeholder = "New Item";
        toDoInput.style.fontSize = "14px";
        toDoInput.value = "";
        toDoInput.style.border = "none";
        closeButtonToDo.id = "closeButtonToDo";
        descSibling.id = "descSibling";
        descSpacer1.id = "descSpacer1";
        descInput.id = "descInput";
        descSpacer2.id = "descSpacer2";
        descInput.type = "text";
        descInput.placeholder = "Type description here...";
        descInput.style.fontSize = "12px";
        descInput.value = "";
        descInput.style.border = "none";

        mainListDiv.appendChild(toDoChild);
        toDoChild.appendChild(toDoInput);
        toDoChild.appendChild(dateText);
        toDoChild.appendChild(dueInput);
        dueInput.appendChild(month);
        dueInput.appendChild(dash);
        dueInput.appendChild(day);
        dueInput.appendChild(dash2);
        dueInput.appendChild(year);
        toDoChild.appendChild(spacer);
        toDoChild.appendChild(closeButtonToDo);
        toDoChild.setAttribute('data-value', currentProject);

        let clickSwitch = 0;

        toDoInput.addEventListener("keydown", function(event) {
            if (event.key !== "Enter") return;

            const enteredText = toDoInput.value;
            toDoInput.blur();
            if (enteredText.length === 0) return;

            let toDoArray = listLogic.listItems(currentProject);
            let toDoLength;
            let arraySlot;

            if (toDoArray[0]["tit"].length > 0) {
                const toDoItems = listLogic.addToDo(currentProject, enteredText);
                toDoArray = toDoItems.array;
                toDoLength = toDoItems.lengths;
                clickSwitch = 1;
            } else {
                toDoLength = listLogic.projectLength(currentProject);
            }

            arraySlot = toDoArray[toDoLength - 1];

            const trimmedText = enteredText.trim();
            toDoInput.textContent = trimmedText;
            toDoInput.value = trimmedText;
            toDoInput.style.fontSize = "14px";

            const dateSet = month.value + '-' + day.value + '-' + year.value;
            let switcher = 0;

            arraySlot["due"] = dateSet;
            arraySlot["tit"] = trimmedText;
            closeButtonToDo.dataset.info = (toDoLength - 1);

            updateItemButton(currentProject);

            toDoChild.addEventListener("click", function(event) {
                if (clickSwitch !== 1) return;

                const clickedElement = event.target;
                const mainListRef = toDoChild.parentElement;

                if (clickedElement.id === 'closeButtonToDo') { event.stopPropagation(); return; }
                if (clickedElement.tagName === 'INPUT') { event.stopPropagation(); return; }

                if (switcher === 0) {
                    mainListRef.insertBefore(descSibling, toDoChild.nextSibling);
                    descSibling.appendChild(descSpacer1);
                    descSibling.appendChild(descInput);
                    descSibling.appendChild(descSpacer2);
                    descInput.value = arraySlot["desc"];
                    switcher = 1;
                } else {
                    if (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling') {
                        mainListRef.removeChild(toDoChild.nextSibling);
                    }
                    switcher = 0;
                }

                descInput.addEventListener("keydown", function(event) {
                    if (event.key !== "Enter") return;
                    const descText = descInput.value.trim();
                    if (descText.length > 0) {
                        descInput.value = descText;
                        arraySlot["desc"] = descText;
                        descInput.style.border = "none";
                    } else {
                        descInput.style.border = "1px solid red";
                    }
                    descInput.blur();
                });
            });
        });

        closeButtonToDo.addEventListener("click", function() {
            const pos = closeButtonToDo.dataset.info;
            const project = currentProject;
            const currentLength = listLogic.projectLength(project);

            if (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling') {
                mainListDiv.removeChild(toDoChild.nextSibling);
            }

            if (currentLength === 1) {
                toDoInput.value = "";
                listLogic.removeToDo(project, 0, currentLength);
                updateItemButton(project);
            } else {
                const closeButtonElements = document.querySelectorAll('#closeButtonToDo');
                mainListDiv.removeChild(toDoChild);
                listLogic.removeToDo(project, pos, currentLength);

                let pos_int = parseInt(pos, 10);
                let adjustedValue = pos_int;
                while (closeButtonElements[adjustedValue + 1] != null) {
                    closeButtonElements[adjustedValue + 1].dataset.info = adjustedValue;
                    adjustedValue++;
                }
                updateItemButton(project);
            }
        });

        closeButtonToDo.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.border = "0.05px solid black";
        });
        closeButtonToDo.addEventListener("mouseleave", function() {
            this.style.boxShadow = "none";
            this.style.border = "none";
        });
    });


    // ********************** SHADOW LISTENERS ********************** //

    projButton.addEventListener("mouseenter", function() { this.style.boxShadow = "0 3px 8px rgba(0, 0, 0, 0.2)"; });
    projButton.addEventListener("mouseleave", function() { this.style.boxShadow = "none"; });
    itemButton.addEventListener("mouseenter", function() { this.style.boxShadow = "0 3px 8px rgba(0, 0, 0, 0.2)"; });
    itemButton.addEventListener("mouseleave", function() { this.style.boxShadow = "none"; });


    // ********************** GLOBAL DOM FUNCTIONS ********************** //

    function addAllToDo_DOM(items, name) {

        console.log("Called addAllToDo_DOM");

        const toDoArray = items;
        const toDoName = name;
        let counter = 0;

        if (!toDoArray || toDoArray.length === 0) return;

        if (toDoArray[0].tit.length > 0) {
            while (counter < toDoArray.length) {
                regenToDos(toDoArray[counter], counter);
                counter++;
            }
        } else {
            addInitialToDo(toDoArray[counter], counter);
        }


        function addInitialToDo(item, index) {

            console.log("Called addAllToDo_DOM > addInitialToDo");

            const mainListDiv = document.getElementById("mainList");
            const toDoChild = document.createElement("div");
            const toDoInput = document.createElement("input");
            const dueInput = document.createElement("div");
            const dateText = document.createElement("div");
            const month = document.createElement("input");
            const dash = document.createElement("div");
            const day = document.createElement("input");
            const dash2 = document.createElement("div");
            const year = document.createElement("input");
            const closeButtonToDo = document.createElement("div");
            const spacer = document.createElement("div");
            const descSibling = document.createElement('div');
            const descSpacer1 = document.createElement('div');
            const descInput = document.createElement('input');
            const descSpacer2 = document.createElement('div');

            toDoChild.style.border = "0.5px solid black";
            toDoChild.id = "toDoChild";
            dateText.id = "dateText"; dateText.textContent = "Due:";
            dueInput.id = "dueInput"; dueInput.style.fontSize = "10px";
            month.id = "month"; month.placeholder = 1;
            day.id = "day"; day.placeholder = 1;
            year.id = "year"; year.placeholder = 2023;
            dash.id = "dash"; dash.textContent = "/";
            dash2.id = "dash"; dash2.textContent = "/";
            spacer.id = "spacer";
            toDoInput.type = "text"; toDoInput.id = "toDoInput";
            toDoInput.placeholder = "New Item"; toDoInput.style.fontSize = "14px";
            toDoInput.value = ""; toDoInput.style.border = "none";
            closeButtonToDo.id = "closeButtonToDo";
            descSibling.id = "descSibling";
            descSpacer1.id = "descSpacer1"; descInput.id = "descInput"; descSpacer2.id = "descSpacer2";
            descInput.type = "text"; descInput.placeholder = "Type description here...";
            descInput.style.fontSize = "12px"; descInput.value = ""; descInput.style.border = "none";

            mainListDiv.appendChild(toDoChild);
            toDoChild.appendChild(toDoInput);
            toDoChild.appendChild(dateText);
            toDoChild.appendChild(dueInput);
            dueInput.appendChild(month); dueInput.appendChild(dash);
            dueInput.appendChild(day); dueInput.appendChild(dash2); dueInput.appendChild(year);
            toDoChild.appendChild(spacer);
            toDoChild.appendChild(closeButtonToDo);
            toDoChild.setAttribute('data-value', toDoName);

            let switcher = 0;
            let clickSwitch = 0;

            toDoInput.addEventListener("keydown", function(event) {
                if (event.key !== "Enter") return;
                const enteredText = toDoInput.value;
                toDoInput.blur();
                if (enteredText.length === 0) return;

                item = toDoArray[0];
                const trimmedText = enteredText.trim();
                toDoInput.value = trimmedText;
                toDoInput.style.fontSize = "14px";

                const dateSet = month.value + '-' + day.value + '-' + year.value;
                item["due"] = dateSet;
                item["pri"] = 2;
                item["tit"] = trimmedText;

                closeButtonToDo.dataset.info = index;
                updateItemButton(toDoName);
                clickSwitch = 1;
            });

            toDoChild.addEventListener("click", function(event) {
                if (clickSwitch !== 1) return;

                const clickedElement = event.target;
                const mainListRef = toDoChild.parentElement;

                if (clickedElement.id === 'closeButtonToDo') { event.stopPropagation(); return; }
                if (clickedElement.tagName === 'INPUT') { event.stopPropagation(); return; }

                if (switcher === 0) {
                    mainListRef.insertBefore(descSibling, toDoChild.nextSibling);
                    descSibling.appendChild(descSpacer1);
                    descSibling.appendChild(descInput);
                    descSibling.appendChild(descSpacer2);
                    descInput.value = item["desc"] || "";
                    switcher = 1;
                } else {
                    if (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling') {
                        mainListRef.removeChild(toDoChild.nextSibling);
                    }
                    switcher = 0;
                }

                descInput.addEventListener("keydown", function(event) {
                    if (event.key !== "Enter") return;
                    const descText = descInput.value.trim();
                    if (descText.length > 0) {
                        descInput.value = descText;
                        item["desc"] = descText;
                        descInput.style.border = "none";
                    } else {
                        descInput.style.border = "1px solid red";
                    }
                    descInput.blur();
                });
            });

            closeButtonToDo.addEventListener("click", function() {
                const pos = closeButtonToDo.dataset.info;
                const project = toDoName;
                const currentLength = listLogic.projectLength(project);

                if (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling') {
                    toDoChild.parentElement.removeChild(toDoChild.nextSibling);
                }

                if (currentLength === 1) {
                    toDoInput.value = "";
                    listLogic.removeToDo(project, pos, currentLength);
                    updateItemButton(project);
                } else {
                    const closeButtonElements = document.querySelectorAll('#closeButtonToDo');
                    mainListDiv.removeChild(toDoChild);
                    listLogic.removeToDo(project, pos, currentLength);

                    let pos_int = parseInt(pos, 10);
                    let adj = pos_int;
                    while (closeButtonElements[adj + 1] != null) {
                        closeButtonElements[adj + 1].dataset.info = adj;
                        adj++;
                    }
                    updateItemButton(project);
                }
                clickSwitch = 0;
            });

            closeButtonToDo.addEventListener("mouseenter", function() {
                this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
                this.style.border = "0.05px solid black";
            });
            closeButtonToDo.addEventListener("mouseleave", function() {
                this.style.boxShadow = "none";
                this.style.border = "none";
            });
        }


        function regenToDos(item, index) {

            console.log("Called addAllToDo_DOM > regenToDos");

            const mainListDiv = document.getElementById("mainList");
            const toDoChild = document.createElement("div");
            const toDoInput = document.createElement("input");
            const dueInput = document.createElement("div");
            const dateText = document.createElement("div");
            const month = document.createElement("input");
            const dash = document.createElement("div");
            const day = document.createElement("input");
            const dash2 = document.createElement("div");
            const year = document.createElement("input");
            const closeButtonToDo = document.createElement("div");
            const spacer = document.createElement("div");
            const descSibling = document.createElement('div');
            const descSpacer1 = document.createElement('div');
            const descInput = document.createElement('input');
            const descSpacer2 = document.createElement('div');

            toDoChild.style.border = "0.5px solid black";
            toDoChild.id = "toDoChild";
            dateText.id = "dateText"; dateText.textContent = "Due:";
            dueInput.id = "dueInput"; dueInput.style.fontSize = "10px";
            month.id = "month"; month.placeholder = 1;
            day.id = "day"; day.placeholder = 1;
            year.id = "year"; year.placeholder = 2023;
            dash.id = "dash"; dash.textContent = "/";
            dash2.id = "dash"; dash2.textContent = "/";
            spacer.id = "spacer";
            toDoInput.type = "text"; toDoInput.id = "toDoInput";
            toDoInput.placeholder = "New Item"; toDoInput.style.fontSize = "16px";
            toDoInput.value = item.tit; toDoInput.style.border = "none";
            closeButtonToDo.id = "closeButtonToDo";
            descSibling.id = "descSibling";
            descSpacer1.id = "descSpacer1"; descInput.id = "descInput"; descSpacer2.id = "descSpacer2";
            descInput.type = "text"; descInput.placeholder = "Type description here...";
            descInput.style.fontSize = "12px";
            descInput.value = item.desc || "";
            descInput.style.border = "none";

            mainListDiv.appendChild(toDoChild);
            toDoChild.appendChild(toDoInput);
            toDoChild.appendChild(dateText);
            toDoChild.appendChild(dueInput);
            dueInput.appendChild(month); dueInput.appendChild(dash);
            dueInput.appendChild(day); dueInput.appendChild(dash2); dueInput.appendChild(year);
            toDoChild.appendChild(spacer);
            toDoChild.appendChild(closeButtonToDo);
            toDoChild.setAttribute('data-value', toDoName);

            // populate date
            const dateSet = item["due"];
            if (dateSet && dateSet !== "--" && dateSet !== "X-X-XXXX") {
                const parts = dateSet.split('-');
                month.value = parseInt(parts[0], 10) || "";
                day.value   = parseInt(parts[1], 10) || "";
                year.value  = parseInt(parts[2], 10) || "";
            }

            closeButtonToDo.dataset.info = index;

            let switcher = 0;
            let clickSwitch = 1;

            toDoInput.addEventListener("keydown", function(event) {
                if (event.key !== "Enter") return;
                const enteredText = toDoInput.value;
                toDoInput.blur();
                if (enteredText.length === 0) return;

                const trimmedText = enteredText.trim();
                toDoInput.value = trimmedText;
                toDoInput.style.fontSize = "14px";

                const newDate = month.value + '-' + day.value + '-' + year.value;
                item["due"] = newDate;
                item["tit"] = trimmedText;
                closeButtonToDo.dataset.info = index;
                clickSwitch = 1;
            });

            toDoChild.addEventListener("click", function(event) {
                if (clickSwitch !== 1) return;

                const clickedElement = event.target;
                const mainListRef = toDoChild.parentElement;

                if (clickedElement.id === 'closeButtonToDo') { event.stopPropagation(); return; }
                if (clickedElement.tagName === 'INPUT') { event.stopPropagation(); return; }

                if (switcher === 0) {
                    mainListRef.insertBefore(descSibling, toDoChild.nextSibling);
                    descSibling.appendChild(descSpacer1);
                    descSibling.appendChild(descInput);
                    descSibling.appendChild(descSpacer2);
                    descInput.value = item["desc"] || "";
                    switcher = 1;
                } else {
                    if (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling') {
                        mainListRef.removeChild(toDoChild.nextSibling);
                    }
                    switcher = 0;
                }

                descInput.addEventListener("keydown", function(event) {
                    if (event.key !== "Enter") return;
                    const descText = descInput.value.trim();
                    if (descText.length > 0) {
                        descInput.value = descText;
                        item["desc"] = descText;
                        descInput.style.border = "none";
                    } else {
                        descInput.style.border = "1px solid red";
                    }
                    descInput.blur();
                });
            });

            closeButtonToDo.addEventListener("click", function() {
                const pos = closeButtonToDo.dataset.info;
                const project = toDoName;
                const currentLength = listLogic.projectLength(project);

                if (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling') {
                    mainListDiv.removeChild(toDoChild.nextSibling);
                }

                if (currentLength === 1) {
                    toDoInput.value = "";
                    listLogic.removeToDo(project, pos, currentLength);
                    clickSwitch = 0;
                    updateItemButton(project);
                } else {
                    const closeButtonElements = document.querySelectorAll('#closeButtonToDo');
                    mainListDiv.removeChild(toDoChild);
                    listLogic.removeToDo(project, pos, currentLength);

                    let pos_int = parseInt(pos, 10);
                    let adj = pos_int;
                    while (closeButtonElements[adj + 1] != null) {
                        closeButtonElements[adj + 1].dataset.info = adj;
                        adj++;
                    }
                    clickSwitch = 0;
                    updateItemButton(project);
                }
            });

            closeButtonToDo.addEventListener("mouseenter", function() {
                this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
                this.style.border = "0.05px solid black";
            });
            closeButtonToDo.addEventListener("mouseleave", function() {
                this.style.boxShadow = "none";
                this.style.border = "none";
            });
        }

    } // end addAllToDo_DOM


    // ********************** RESTORE FROM STORAGE ********************** //
    // Assigned to the module-level variable so index.js can call it after
    // component() is appended to the DOM.

    restoreFromStorage = function() {

        const savedProjects = listLogic.listProjectsArray();
        if (savedProjects.length === 0) return;

        savedProjects.forEach(function(projectName) {
            createProjectRow(projectName, false);
        });

        // auto-select the last project and render its todos
        const allProjRows = document.querySelectorAll('#projChild');
        const lastRow = allProjRows[allProjRows.length - 1];
        if (lastRow) {
            lastRow.classList.remove("unselectedProject");
            lastRow.classList.add("selectedProject");
        }

        const lastProject = savedProjects[savedProjects.length - 1];
        const items = listLogic.listItems(lastProject);
        clearToDos_global();
        addAllToDo_DOM(items, lastProject);
        updateItemButton(lastProject);
    };


    return base;
}


export { component, restoreFromStorage };


// ********************************************** BUG BASHING ********************************************** //
/**
 * FIXED - 1. When multiple projects are added, then all are removed,
 *            it will not remove the last project to exist other than 'Default'.
 *
 * PROBLEM - 2. Having issues with deletion/addition of DOM/Array elements
 *
 * FIXED - 3. When clicking on different projects the addToDo button will disable
 *              unnecessarily.
 *
 * FIXED - 4. When removing projects, the initial project is also removed BUT,
 *              all projects after the initial project remain.
 *
 * PROBLEM - 5. Duplicate project name causes unexpected todo deletion.
 *           - validation added to prevent duplicate names.
 *
 * FIXED - 6. Enable drop down to see toDo item descriptions
 *
 * FIXED - 7. Pressing close button on initial toDo item causes description to populate.
 *
 * FIXED - 8. Continuing toDo elements do not clear the descInput after removing parent.
 *
 * FIXED - 9. Unable to append descSibling elements after regenToDo runs.
 *
 * FIXED - 10. Closing second item removes third item incorrectly.
 *
 * FIXED - 11. CloseButton on initial toDo removes next element.
 *
 * FIXED - 12. CloseButtonToDo on project 2 item 1 not removing descSibling.
 *
 * FIXED - 13. CloseButtonToDo for project 2 not removing toDoChild.nextSibling.
*/
// ******************************************************************************************************** //