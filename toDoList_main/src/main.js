import './style.css';
import { listLogic } from './listLogic.js';
import button from './addProj_button.svg';



function component() {


    // GLOBAL VARIABLES

    
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


    // var mainChild = mainList.childNodes[1];

    // on click should temporarily disable ability to continue clicking
    itemButton.style.pointerEvents = "none";


    // ********************** CLICK LISTENERS ********************** //

    // Click Listener: That adds new project element
    projButton.addEventListener("click", function(){

        console.log("Called projButton");

        // on click should temporarily disable ability to continue clicking
        projButton.style.pointerEvents = "none";
        
        
        // click ability returns dependent on if user successfully adds title to project

        // selects projects list div by ID
        const sideMaDiv = document.getElementById("sideMa");

        const projChild = document.createElement("div");

        const titleInput = document.createElement("input");
        const closeButton = document.createElement("div");
        const spacer = document.createElement("div");


        projChild.classList.add("unselectedProject"); 
        projChild.id = "projChild";

        // First Project Input
        titleInput.type = "text";
        titleInput.id = "projInput";
        titleInput.placeholder = "New Project";
        
        titleInput.value = "";
        titleInput.style.border = "none";

        closeButton.id = "closeButton";
        // closeButton.style.border = "0.5px solid black";


        // Create element with textbox for input
        sideMaDiv.appendChild(projChild);
        projChild.appendChild(titleInput);
        projChild.appendChild(closeButton);
        projChild.appendChild(spacer);
   
        // spacer.style.border = "1px solid red";
        spacer.style.width = "12px";

        let currentProperty = "";
        let newProperty = "";
        let firstTime = 0;

        let projectArray = [];
        let projectName = "";

        // ****** INPUT LISTENER ****** 
        // Press enter after Project title input to set element information
        titleInput.addEventListener("keydown", function(event) {

            console.log("Called projButton > titleInput");


            // Get Project names and store into an array using - logicList.js
            let projectsList = listLogic.listProjectsArray();

            let exists = 0;

            let count = 0;

            // on click should temporarily disable ability to continue clicking
            itemButton.style.pointerEvents = "none";

            const mainDiv = document.querySelector('#mainList');

            var childNodes = mainDiv.childNodes;

            // querySelect all the projChild elements, change their classes to unselectedProject
            var projOnChild = document.querySelector('.selectedProject');

            let enteredText = "";
            let trimmedText = "";
            let projectItems = [];



            if (event.key === "Enter") {

                console.log("Clicked Enter");

                enteredText = titleInput.value;
                newProperty = titleInput.value;

                // console.log("You entered: " + enteredText);
                titleInput.blur();


                // CHECKER - name variable set to switch on/off when a project name match occurs - variable
                while(count < projectsList.length){

                    if(projectsList[count] === enteredText){


                        exists = 1;

                        titleInput.textContent = "INVALID";
                        titleInput.style.color = 'red';
                        
                        return;
                    }

                    count++;

                }

            }



            // if title entered has a length > 0 characters & there are no project name matches
            if ((enteredText.length > 0) && (exists === 0)){

                // projChild.style.backgroundColor = "none";
                titleInput.style.color = 'black';

                trimmedText = enteredText.trim();
                
                titleInput.textContent = trimmedText; // - NEW
                titleInput.value = trimmedText; // - NEW - ensures text is moved to the middle of div
                titleInput.style.fontSize = "14px"; // - NEW
                
                

                if(firstTime === 0){

                    // - send title to addProject() in listLogic.js to add property to allProjects array
                    projectItems = listLogic.addProject(trimmedText); 
                    
                    projectArray = projectItems.array;
                    projectName = projectItems.string;


                    firstTime = 1;
                    currentProperty = titleInput.textContent;
                    
                    selectProject(); // changes selection to element
                    clearToDos();

                    // function returns updated project array for DOM
                    projectItems = listLogic.listItems(projectName); 
                    
                }

                else{
                    
                    // - send title to editToDo() in listLogic.js to edit currentProperty to allProjects array 
                    projectItems = listLogic.editProject(currentProperty, newProperty); 

                    projectArray = projectItems.array;
                    projectName = projectItems.string;

                    currentProperty = newProperty;

                    selectProject(); // changes selection to element
                    clearToDos();


                    // function returns updated project array for DOM
                    projectItems = listLogic.listItems(projectName);
                    
                }


                // Based on the designated allProjects array, take those items and add them to the DOM in 
                // the form of toDo items
                addAllToDo_DOM(projectArray, projectName);
                


                listLogic.listProjects();
                

                // On Click - should bring back ability to use add projects button 
                projButton.style.pointerEvents = "auto"; 
                
                // NOTE: projChild > titleInput


                // *** LISTENERS ***

                // when element is clicked change selection to that element
                projChild.addEventListener("click", function(){



                    console.log("called project selection")

                    // check if latest DOM element's title is '' 'blank',
                    // if it is blank 'turn on' the toDo item button to allow clicking
                    const toDoContainer = document.getElementById('mainList');

                    var containerLength = toDoContainer.childNodes.length;
                    
                    var lastChildRef = containerLength - 1;
                    
                    if(containerLength > 1){

                        // console.log(toDoContainer.childNodes[lastChildRef].firstChild.value); // gets toDo item title
                        
                        let lastChildTitle = toDoContainer.childNodes[lastChildRef].firstChild.value;

                        if(lastChildTitle === ""){
                            
                            // onclick makes sure to enable add item button when appropriate
                            itemButton.style.pointerEvents = "none";     

                        }

                        else {

                            // should turn off the add item button when appropriate
                            itemButton.style.pointerEvents = "auto";

                        }

                    }



                    let fresh = 0;


                    if(fresh === 0){

                        projOnChild = document.querySelector('.selectedProject'); //  latest selection
                    
                        fresh = 1;
                    }

                    // console.log("projOnChild: " + projOnChild);

                    selectProject(); // 1 - Changes selected element

                    projOnChild = document.querySelector('.selectedProject'); //  latest selection

                    if(projOnChild != null){

                        // on click should temporarily disable ability to continue clicking
                        itemButton.style.pointerEvents = "auto";

                        var innerValue = projOnChild.textContent; // pulls projectName
                        var arrayValues = listLogic.listItems(innerValue);// pulls projectArray

                        console.log(innerValue);
                        console.log(arrayValues);

                        clearToDos(); // 2 - Clears previous childNode under toDo List



                        /** WORKING MOSTLY */
                        addAllToDo_DOM(arrayValues, innerValue); // 3 - Adds the appropriate elements back into toDo List
                    }

                    

                    
                
                });


                // *** FUNCTIONS ***

                // changes an elements selection
                function selectProject(){

                    if(projOnChild != null){
            
                        // console.log("selectedProject exists");

                        projOnChild.classList.remove("selectedProject");
                        projOnChild.classList.add("unselectedProject");
                    
                    }
                    // changing ONLY the selected project
                    if(projChild.classList.contains("unselectedProject")){
        
                        projChild.classList.remove("unselectedProject");
                        projChild.classList.add("selectedProject");
        
        
                        // console.log("Class changed to selectedProject");
                        
                    }



                }

                function clearToDos(){

                    const mainDiv = document.getElementById('mainList');                    
                    
                    let elementIndex = 1;

                    // let result = mainDiv.contains(childNodes[elementIndex]);

                    while(mainDiv.contains(childNodes[elementIndex])){
                        
                        // mainDiv = document.getElementById('mainList');
    
                        mainDiv.removeChild(childNodes[elementIndex]); // remove childNodes
                        
                    
                    }                 

                    // console.log(childNodes);


                }


            }


            
        }); // Ends "Enter" keydown function

        // Removes selected project elements from DOM/Logic
        closeButton.addEventListener("click", function() {

            console.log("Called projButton > closeButton");

            const mainList = document.getElementById("mainList");
            let mainChild = document.getElementById("toDoChild");

            let property = titleInput.value;
            // let projectLength = listLogic.projectLength(property);
            // let i = 0;

            // DOM - Removes project DOM element
            projChild.parentNode.removeChild(projChild);

            // DOM - Removes item DOM elements associated with project
            while(mainList.contains(mainChild)){

                console.log(mainChild);

                if((mainChild.nextSibling != null) && (mainChild.nextSibling.id === 'descSibling')){ // ***** TESTING *****
                    
                    mainList.removeChild(mainChild.nextSibling);
                
                }                


                mainList.removeChild(mainChild);

                mainChild = document.getElementById("toDoChild"); // should re-assign mainChild to next DOM element
                

            }
            
            listLogic.listItems(property);

            // LOGIC - Need to call logic function that removes property from allProjects[] array
            listLogic.removeProject(property);

            listLogic.listItems(property);
            
            // LOGIC - Lists all existing projects in logic
            listLogic.listProjects();

            // On Click - should bring back ability to use add projects button 
            projButton.style.pointerEvents = "auto"; 


        }); // Ends "closeButton" click function
        

        // ****** Focus/Shadow LISTENERS ******
        titleInput.addEventListener("focus", function() {
            this.style.background = "rgba(0, 0, 0, 0)";
            projChild.style.boxShadow = "none";
            projChild.style.background = "white";             
        });
  

        projChild.addEventListener("mouseenter", function() {
            // this.style.border = "1px solid red";
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.background = "lightgrey";  
        });
        
        projChild.addEventListener("mouseleave", function() {
            // this.style.border = "none";
            this.style.boxShadow = "none";
            this.style.background = "white";  
        });  

        closeButton.addEventListener("mouseenter", function() {
            this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
            this.style.border = "0.05px solid black";
            // this.style.background = "lightgrey";  
        });
        
        closeButton.addEventListener("mouseleave", function() {
            // this.style.border = "none";
            this.style.boxShadow = "none";
            this.style.border = "none";
            // this.style.background = "white";         
        });

    }); 

    // Click Listener: That adds new item element
    itemButton.addEventListener("click", function() { 

        console.log("Called itemButton");

        // on click should temporarily disable ability to continue clicking
        itemButton.style.pointerEvents = "none";

        // get currentProject based on the 'selectedElement'

        const currentProject = document.querySelector('.selectedProject').textContent; //  latest selection

        console.log(currentProject);
        // const currentProject = (mainList.childNodes[1]).getAttribute('data-value');

        // declare elements needed, make similar to the adding projects version
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

        

        // ** DESCRIPTION ** - creates and reference description div element //
        const descSibling = document.createElement('div');

        const descSpacer1 = document.createElement('div');
        const descInput = document.createElement('input');
        const descSpacer2 = document.createElement('div');



        toDoChild.style.border = "0.5px solid black"; 
        toDoChild.id = "toDoChild";

        dateText.id = "dateText";
        dateText.textContent = "Due:";

        dueInput.id = "dueInput";
        dueInput.style.fontSize = "10px"; // - NEW
        
        month.id = "month";
        month.placeholder = 1;

        day.id = "day";
        day.placeholder = 1;

        year.id = "year";
        year.placeholder = 2023;

        dash.id = "dash";
        dash.textContent = "/";

        dash2.id = "dash";
        dash2.textContent = "/";

        spacer.id = "spacer";

        // First Project Input
        toDoInput.type = "text";
        toDoInput.id = "toDoInput";
        toDoInput.placeholder = "New Item";
        toDoInput.style.fontSize = "14px"; // - NEW
        
        toDoInput.value = "";
        toDoInput.style.border = "none";

        closeButtonToDo.id = "closeButtonToDo";

        descSibling.id ="descSibling";

        descSpacer1.id = "descSpacer1";
        descInput.id = "descInput";
        descSpacer2.id = "descSpacer2";

        descInput.type ="text";
        descInput.placeholder = "Type description here...";
        descInput.style.fontSize = "12px"; // - NEW

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



        let counter = 1;


        let clickSwitch = 0;

        // Need logic to edit current DOM info
        toDoInput.addEventListener("keydown", function(event) {

            console.log("Called itemButton > toDoInput");
            
            // console.log("Pressed enter for new item - " + counter);
            // console.log("Project name - " + toDoName);

            let enteredText = "";
            let trimmedText = "";

            let arraySlot = "";
            let toDoArray = [];
            let toDoName = "";
            let toDoLength = "";
            let projectItems = [];
            let toDoItems = [];

            

            if (event.key === "Enter") {
                enteredText = toDoInput.value;

                console.log("Entered newToDo keydown function: " + enteredText);

                toDoInput.blur();

            }


            // if title entered has a length > 0 characters
            if (enteredText.length > 0){


                // ********************************* ISSUES STEM FROM HERE ********************************* //
                
                // newToDo elements are being added to the [1] index instead of 

                // let currentProjectLength = listLogic.projectLength(currentProject); 
                // console.log("currentProjectLength: " + currentProjectLength);

                toDoArray = listLogic.listItems(currentProject); // project array
                toDoName = currentProject; // projectName
                toDoLength = listLogic.projectLength(currentProject); // >>> 2


                if(toDoArray[0]["tit"].length > 0){ //  --> this should mean it's assigned a title already

                    toDoItems = listLogic.addToDo(currentProject, enteredText); 

                    toDoArray = toDoItems.array; // project array
                    toDoName = toDoItems.string; // projectName
                    toDoLength = toDoItems.lengths; // >>> 2

                    clickSwitch = 1;
                }
                
                else{ 

                    toDoArray = listLogic.listItems(currentProject); // project array
                    toDoName = currentProject; // projectName
                    toDoLength = listLogic.projectLength(currentProject); // >>> 2


                }


                // ***************************************************************************************** //



                arraySlot = toDoArray[toDoLength - 1]; //  >>> 2 - 1

                trimmedText = enteredText.trim();
                    
                toDoInput.textContent = trimmedText; // - NEW
                toDoInput.value = trimmedText; // - NEW - ensures text is moved to the middle of div
                toDoInput.style.fontSize = "14px"; // - NEW
                
                let monthValue = month.value;
                let dayValue = day.value;
                let yearValue = year.value;

                let dateSet = (monthValue + '-' + dayValue + '-' + yearValue);

                let switcher = 0; // used for turning on/off description node

                arraySlot["due"] = dateSet;    
                arraySlot["tit"] = trimmedText;

                closeButtonToDo.dataset.info = (toDoLength - 1);


                projectItems = listLogic.listItems(currentProject);  

                // console.log(projectItems);

                // on click should temporarily disable ability to continue clicking
                itemButton.style.pointerEvents = "auto";

                // *************************** WORK IN PROGRESS *************************** // 

                toDoChild.addEventListener("click", function(event){

                    console.log("clickSwitch: " + clickSwitch);

                    if(clickSwitch === 1){

                        console.log("Calling itemButton > toDoChild click");


                        const clickedElement = event.target;


                        const mainList = toDoChild.parentElement;

                        let descText = "";
                        let descTrimmed = "";

                        // Covers the clicking of CloseButtonToDo
                        if(clickedElement.id === 'closeButtonToDo'){
                            
                            console.log("Called stop propagation of DIV");
                            event.stopPropagation(); // Prevent the parent's click event
                            
                        }

                        // Covers the clicking of toDoInput
                        if(clickedElement.tagName === 'INPUT'){

                            console.log(clickedElement);
                            
                            console.log("Called stop propagation of INPUT");
                            event.stopPropagation(); // Prevent the parent's click event

                            
                        }                    
                    

                        if((clickedElement.tagName != 'INPUT') && (clickedElement.id != 'closeButtonToDo')){

                            console.log("Called descSibling append if statement");

                            // Switches description node on/off depending on click value - switcher
                            if(switcher === 0){

                                mainList.insertBefore(descSibling, toDoChild.nextSibling);

                                descSibling.appendChild(descSpacer1);
                                descSibling.appendChild(descInput);
                                descSibling.appendChild(descSpacer2);

                                descInput.textContent = arraySlot["desc"];
                                descInput.value = arraySlot["desc"];

                                // if descInput value is greater than 0 set it as the textContent
                                if(arraySlot["desc"].length > 0){

                                    console.log("Previously inputted value is valid");
                                    descInput.textContent = arraySlot["desc"];
                                    descInput.value = arraySlot["desc"];

                                }


                                switcher = 1;
                            }

                            else{

                        
                                if(toDoChild.nextSibling != null){

                                    mainList.removeChild(toDoChild.nextSibling)
                                
                                }
                                

                                switcher = 0;
                            }


                       

                            // ***** CLICK LISTENERS *****
                            
                            // Need listener to be able to set DOM descInput value
                            descInput.addEventListener("keydown", function(event) {
        
                                descText = "";

                                if (event.key === "Enter") {
                                    descText = descInput.value;
                    
                                    console.log("Entered descInput keydown function: " + descText);
                    
                                    descInput.blur();
                    
                                }
                    
                    
                                // if description entered has a length > 0 characters
                                if (descText.length > 0){
                                    
                                    // DOM - set the text within the element
                                    descTrimmed = descText.trim();
                            
                                    descInput.textContent = descTrimmed; // - NEW
                                    descInput.value = descTrimmed; // - NEW - ensures text is moved to the middle of div
                                    descInput.style.fontSize = "12px"; // - NEW



                                    // LOGIC - set the array parameter array project[0]['desc']
                                    arraySlot["desc"] = descTrimmed;

                                    toDoArray = listLogic.listItems(currentProject); // project array
                                    console.log(toDoArray);

                                    descInput.style.border = "none";

                                }
                                else{

                                    descInput.style.border = "1px solid red";
                                    // console.log("Your description is not long enough.");


                                }


                            }); 
                        }
                    }
                    
                });


                // *********************************************************************** //



            }            
            
                
        }); // Ends "Enter" keydown function

        closeButtonToDo.addEventListener("click", function(){

            console.log("Called itemButton > closeButtonToDo");
                
 
                // store index of toDo item in variable
                let pos = closeButtonToDo.dataset.info;
                let project = currentProject;
                
                let currentLength = listLogic.projectLength(project);// need function to return current length of the project array


                // if currentLength is 1, clear div information
                if(currentLength === 1){

                    if((toDoChild.nextSibling != null) && (toDoChild.nextSibling.id === 'descSibling')){ // ***** TESTING *****
                    
                        mainListDiv.removeChild(toDoChild.nextSibling);
                    
                    }

                    toDoInput.value = "";
                    
                    // remove item from project array, needs to identify the index of project effected
                    listLogic.removeToDo(project, 0, currentLength);

                    // create function that lists project elements
                    let array = listLogic.listItems(project);
                    console.log(array);
                }

                else{

                    if((toDoChild.nextSibling != null) && (toDoChild.nextSibling.id === 'descSibling')){
                        
                        mainListDiv.removeChild(toDoChild.nextSibling);
                    
                    }
                    // remove item from DOM
                    mainListDiv.removeChild(toDoChild);

                    // remove item from project array, needs to identify the index of project effected
                    listLogic.removeToDo(project, pos, currentLength);

                    // create function that lists project elements
                    listLogic.listItems(project);
                    
                    // Adjusts dataset-info for childNode elements

                    const closeButtonElements = document.querySelectorAll('#closeButtonToDo');

                    let currentValue = "";

                    let adjustedValue = "";

                    if(closeButtonElements[pos] != null){
                       
                        currentValue = closeButtonElements[pos].dataset.info; // 1

                        adjustedValue = currentValue - 1;

                        closeButtonElements[pos].dataset.info = adjustedValue; // 0

                        console.log(closeButtonElements[pos].dataset.info);
                    }

                    adjustedValue++;

                    while(closeButtonElements[adjustedValue] != null){

                        closeButtonElements[adjustedValue].dataset.info = adjustedValue;
                        console.log(closeButtonElements[adjustedValue].dataset.info);

                        adjustedValue++;
                    }

                    // console.log(closeButtonElements[pos].dataset.info); // new value is 0

                    // create function that lists project elements
                    let array = listLogic.listItems(project);
                    console.log(array);
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

    // addProj Shadow listener
    projButton.addEventListener("mouseenter", function() {
        this.style.boxShadow = "0 3px 8px rgba(0, 0, 0, 0.2)";
      });
      
    projButton.addEventListener("mouseleave", function() {
        this.style.boxShadow = "none";
    });

    // addItem Shadow listener
    itemButton.addEventListener("mouseenter", function() {
        this.style.boxShadow = "0 3px 8px rgba(0, 0, 0, 0.2)";
      });
      
    itemButton.addEventListener("mouseleave", function() {
        this.style.boxShadow = "none";
    });




    // ********************** GLOBAL DOM FUNCTIONS ********************** //

    // AddToDo Item function
    // should just do the job of adding the DOM element
    // add to button and event listeners after 
    function addAllToDo_DOM(items, name){

        console.log("Called addAllToDo_DOM");

        // project name
        let toDoArray = items; //  items array [] without project name
        let toDoName = name;
        let counter = 0;


        // declare elements needed, make similar to the adding projects version
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

        // ** DESCRIPTION ** - creates and reference description div element //
        const descSibling = document.createElement('div');

        const descSpacer1 = document.createElement('div');
        const descInput = document.createElement('input');
        const descSpacer2 = document.createElement('div');

        toDoChild.style.border = "0.5px solid black"; 
        toDoChild.id = "toDoChild";

        dateText.id = "dateText";
        dateText.textContent = "Due:";

        dueInput.id = "dueInput";
        dueInput.style.fontSize = "10px"; // - NEW
        
        month.id = "month";
        month.placeholder = 1;

        day.id = "day";
        day.placeholder = 1;

        year.id = "year";
        year.placeholder = 2023;

        dash.id = "dash";
        dash.textContent = "/";

        dash2.id = "dash";
        dash2.textContent = "/";

        spacer.id = "spacer";

        // First Project Input
        toDoInput.type = "text";
        toDoInput.id = "toDoInput";
        toDoInput.placeholder = "New Item";
        toDoInput.style.fontSize = "14px"; // - NEW
        
        toDoInput.value = "";
        toDoInput.style.border = "none";

        closeButtonToDo.id = "closeButtonToDo";       

        descSibling.id ="descSibling";

        descSpacer1.id = "descSpacer1";
        descInput.id = "descInput";
        descSpacer2.id = "descSpacer2";

        descInput.type ="text";
        descInput.placeholder = "Type description here...";
        descInput.style.fontSize = "12px"; // - NEW

        descInput.value = "";
        descInput.style.border = "none";



        if(((toDoArray[0].tit).length) > 0){


            while(counter < toDoArray.length){


                regenToDos(toDoArray[counter], counter); // designates project item, along with array position
                    
                counter++;
            }            

        }

        else{

/*             console.log("passed into initialToDo,");
            console.log(toDoArray[counter]); */
            addInitialToDo(toDoArray[counter], counter); // designates project item, along with array position
            
            counter++;
        }




        // Meant for newToDos
        function addInitialToDo(item, index){

            console.log("Called addAllToDo_DOM > addInitialToDo");

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
            
            toDoChild.setAttribute('data-value', toDoName); // sets the first toDo data-value

            let switcher = 0;

            let clickSwitch = 0;

            // EDITS TITLE & DATE OF ITEM ELEMENT
            toDoInput.addEventListener("keydown", function(event) {

                toDoChild.setAttribute('data-value', toDoName); // sets the first toDo data-value

                // need to re-reference item being the first item of a project
                item = toDoArray[0];


                let enteredText = "";
                let trimmedText = "";
                let projectItems = [];
                let projects = [];

                if (event.key === "Enter") {
                    enteredText = toDoInput.value;

                    console.log("Entered initialToDo keydown function: " + enteredText);

                    toDoInput.blur();

                }

                // if title entered has a length > 0 characters
                if (enteredText.length > 0){

                    // console.log("entered value > 0, initialToDo");
                    // console.log(item);

                    trimmedText = enteredText.trim();
                    
                    toDoInput.textContent = trimmedText; // - NEW
                    toDoInput.value = trimmedText; // - NEW - ensures text is moved to the middle of div
                    toDoInput.style.fontSize = "14px"; // - NEW
                    

                    let monthValue = month.value;
                    let dayValue = day.value;
                    let yearValue = year.value;

                    let dateSet = (monthValue + '-' + dayValue + '-' + yearValue);

                    item["due"] = dateSet;
                    item["pri"] = 2;
                    item["tit"] = trimmedText;


                    closeButtonToDo.dataset.info = index;

                    // on click should temporarily disable ability to continue clicking
                    itemButton.style.pointerEvents = "auto";
                    
                    // console.log("toDoName: " + toDoName);

                    projectItems = listLogic.listItems(toDoName);  

                    console.log(projectItems);
                    
                    clickSwitch = 1;
                }

                
            }); // Ends "Enter" keydown function

            // Set to generate array ['desc'] up on clicking
            toDoChild.addEventListener("click", function(event){

                console.log("clickSwitch: " + clickSwitch);

                if(clickSwitch === 1){
                    console.log("initialToDo > toDoChild click listener - BEFORE");
                    
                    console.log(switcher);

                    const clickedElement = event.target;

                    // re-generate what already exists as a part of the item array
                    const mainList = toDoChild.parentElement;

                    let descText = "";
                    let descTrimmed = "";

                    // Covers the clicking of CloseButtonToDo
                    if(clickedElement.id === 'closeButtonToDo'){
                        
                        console.log("Called stop propagation of DIV");
                        event.stopPropagation(); // Prevent the parent's click event
                        
                    }

                    // Covers the clicking of toDoInput
                    if(clickedElement.tagName === 'INPUT'){
                        
                        console.log("Called stop propagation of INPUT");
                        event.stopPropagation(); // Prevent the parent's click event

                        
                    }

                
                    if((clickedElement.tagName != 'INPUT') && (clickedElement.id != 'closeButtonToDo')){

                        // Switches description node on/off depending on click value - switcher
                        if(switcher === 0){

                            mainList.insertBefore(descSibling, toDoChild.nextSibling);

                            descSibling.appendChild(descSpacer1);
                            descSibling.appendChild(descInput);
                            descSibling.appendChild(descSpacer2);

                            descInput.textContent = item["desc"];
                            descInput.value = item["desc"];

                            // if descInput value is greater than 0 set it as the textContent
                            if(item["desc"].length > 0){

                                console.log("Previously inputted value is valid");
                                descInput.textContent = item["desc"];
                                descInput.value = item["desc"];

                            }


                            switcher = 1;
                        }

                        else{

                                if(toDoChild.nextSibling != null){

                                    mainList.removeChild(toDoChild.nextSibling);
                                
                                }
                                switcher = 0;
                            }

                            // ***** CLICK LISTENERS *****

                            // allow keydown event for descInput to change the current description
                            descInput.addEventListener("keydown", function(event) {
            
                                descText = "";

                                if (event.key === "Enter") {
                                    descText = descInput.value;
                        
                                    console.log("Entered descInput keydown function: " + descText);
                        
                                    descInput.blur();
                        
                                }
                        
                        
                                    // if description entered has a length > 0 characters
                                if (descText.length > 0){
                                        
                                    // DOM - set the text within the element
                                    descTrimmed = descText.trim();
                                
                                    descInput.textContent = descTrimmed; // - NEW
                                    descInput.value = descTrimmed; // - NEW - ensures text is moved to the middle of div
                                    descInput.style.fontSize = "12px"; // - NEW



                                    // LOGIC - set the array parameter array project[0]['desc']
                                    item["desc"] = descTrimmed;

                                    toDoArray = listLogic.listItems(toDoName); // project array
                                    console.log(toDoArray);

                                    descInput.style.border = "none";

                                }

                                else{

                                    descInput.style.border = "1px solid red";
                                    // console.log("Your description is not long enough.");


                                }


                            });

                    }
                }
            });

            closeButtonToDo.addEventListener("click", function(){

                console.log("Entered closeButtonToDo");
                console.log(descInput);

                // remove toDoChild sibling
                const mainList = toDoChild.parentElement;


                    if(toDoChild.nextSibling != null){

                        mainList.removeChild(toDoChild.nextSibling);
                    
                    }


                //  Clears and renews old toDoChild information 
                item['tit'] = "";
                item['pri'] = 0;
                item['desc'] = "";
                item['due'] = "";

                console.log("Entered initialToDo closeButton function");
 
                // store index of toDo item in variable
                let pos = closeButtonToDo.dataset.info;
                let project = toDoName;
                
                let currentLength = listLogic.projectLength(project);// need function to return current length of the project array


                // if currentLength is 1, clear div information
                if(currentLength === 1){

                    // on click should temporarily disable ability to continue clicking
                    itemButton.style.pointerEvents = "none";

                    toDoInput.value = "";
                    
                    // remove item from project array, needs to identify the index of project effected
                    listLogic.removeToDo(project, pos, currentLength);

                    // create function that lists project elements
                    let array = listLogic.listItems(project);
                    console.log(array);
                }

                else{

                    // remove item from DOM
                    mainListDiv.removeChild(toDoChild);

                    // remove item from project array, needs to identify the index of project effected
                    listLogic.removeToDo(project, pos, currentLength); 

                    // create function that lists project elements
                    listLogic.listItems(project);


                    const closeButtonElements = document.querySelectorAll('#closeButtonToDo');

                    let currentValue = "";

                    let adjustedValue = "";

                    if(closeButtonElements[pos] != null){
                       
                        

                        currentValue = closeButtonElements[pos].dataset.info; // 1

                        adjustedValue = currentValue - 1;

                        closeButtonElements[pos].dataset.info = adjustedValue; // 0

                        console.log(closeButtonElements[pos].dataset.info);

                        clickSwitch = 0; // unsure if this is necessary?
                    }

                    adjustedValue++;

                    while(closeButtonElements[adjustedValue] != null){

                        closeButtonElements[adjustedValue].dataset.info = adjustedValue;
                        console.log(closeButtonElements[adjustedValue].dataset.info);

                        adjustedValue++;
                    }

                    // console.log(closeButtonElements[pos].dataset.info); // new value is 0

                    // create function that lists project elements
                    let array = listLogic.listItems(project);
                    console.log(array);

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

        // Meant for oldToDos re-generation, passes in array[i] and starting index of 0
        function regenToDos(item, index){ 

            console.log("Called addAllToDo_DOM > regenToDos");


            // declare elements needed, make similar to the adding projects version
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

            // ** DESCRIPTION ** - creates and reference description div element //
            const descSibling = document.createElement('div');

            const descSpacer1 = document.createElement('div');
            const descInput = document.createElement('input');
            const descSpacer2 = document.createElement('div');


            toDoChild.style.border = "0.5px solid black"; 
            toDoChild.id = "toDoChild";

            dateText.id = "dateText";
            dateText.textContent = "Due:";

            dueInput.id = "dueInput";
            dueInput.style.fontSize = "10px"; // - NEW
            
            month.id = "month";
            month.placeholder = 1;

            day.id = "day";
            day.placeholder = 1;

            year.id = "year";
            year.placeholder = 2023;

            dash.id = "dash";
            dash.textContent = "/";

            dash2.id = "dash";
            dash2.textContent = "/";

            spacer.id = "spacer";

            // First Project Input
            toDoInput.type = "text";
            toDoInput.id = "toDoInput";
            toDoInput.placeholder = "New Item";
            toDoInput.style.fontSize = "14px"; // - NEW
            
            toDoInput.value = "";
            toDoInput.style.border = "none";

            closeButtonToDo.id = "closeButtonToDo";  

            descSibling.id ="descSibling";

            descSpacer1.id = "descSpacer1";
            descInput.id = "descInput";
            descSpacer2.id = "descSpacer2";
    
            descInput.type ="text";
            descInput.placeholder = "Type description here...";
            descInput.style.fontSize = "12px"; // - NEW
    
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
            
            toDoChild.setAttribute('data-value', toDoName);


            toDoInput.textContent = item.tit;
            toDoInput.value = item.tit; 
            toDoInput.style.fontSize = "16px"; 


            let dateSet = item["due"];
            let dateSplit = item["due"].split('-');

            let monthSet = "";
            let daySet = "";
            let yearSet = "";
            
            if((dateSet === "--") || (dateSet === "X-X-XXXX")){
                
                console.log("Date has not been set by user.");
                
            }

            else{

                monthSet = parseInt(dateSplit[0], 10); // Convert to an integer (base 10)
                daySet = parseInt(dateSplit[1], 10);
                yearSet = parseInt(dateSplit[2], 10);
                
                month.textContent = monthSet;
                month.value = monthSet;
    
                day.textContent = daySet;
                day.value = daySet;
    
                year.textContent = yearSet;
                year.value = yearSet;            
            
            }


            item["due"] = dateSet;            
            item["tit"] = item.tit;

            closeButtonToDo.dataset.info = index;

            let switcher = 0;

            let clickSwitch = 1;

            // EDITS TITLE OF ITEM ELEMENT
            toDoInput.addEventListener("keydown", function(event) {

                toDoChild.setAttribute('data-value', toDoName); // sets the first toDo data-value

                // need to re-reference item being the first item of a project
                item = toDoArray[0];
                
                let enteredText = "";
                let trimmedText = "";

                if (event.key === "Enter") {
                    enteredText = toDoInput.value;

                    console.log("You entered: " + enteredText);
                    toDoInput.blur();

                }

                // if title entered has a length > 0 characters
                if (enteredText.length > 0){

                    trimmedText = enteredText.trim();
                    
                    toDoInput.textContent = trimmedText; // - NEW
                    toDoInput.value = trimmedText; // - NEW - ensures text is moved to the middle of div
                    toDoInput.style.fontSize = "14px"; // - NEW

                    let monthValue = month.value;
                    let dayValue = day.value;
                    let yearValue = year.value;

                    let dateSet = (monthValue + '-' + dayValue + '-' + yearValue);

                    item["due"] = dateSet;
                    item["tit"] = trimmedText;


                    closeButtonToDo.dataset.info = index;
                    clickSwitch = 1;

                }

                
            }); // Ends "Enter" keydown function

            // Set to generate array ['desc'] up on clicking
            toDoChild.addEventListener("click", function(event){

                console.log("clickSwitch: " + clickSwitch);

                if(clickSwitch === 1){

                console.log("regenToDos > toDoChild click listener");


                const clickedElement = event.target;

                // re-generate what already exists as a part of the item array
                const mainList = toDoChild.parentElement;

                let descText = "";
                let descTrimmed = "";

                // Covers the clicking of CloseButtonToDo
                if(clickedElement.id === 'closeButtonToDo'){
                        
                    console.log("Called stop propagation of DIV");
                    event.stopPropagation(); // Prevent the parent's click event
                        
                }

                    // Covers the clicking of toDoInput
                if(clickedElement.tagName === 'INPUT'){
                        
                    console.log("Called stop propagation of INPUT");
                    event.stopPropagation(); // Prevent the parent's click event

                        
                }
                
                if((clickedElement.tagName != 'INPUT') && (clickedElement.id != 'closeButtonToDo')){

                    // Switches description node on/off depending on click value - switcher
                    if(switcher === 0){

                        mainList.insertBefore(descSibling, toDoChild.nextSibling);

                        descSibling.appendChild(descSpacer1);
                        descSibling.appendChild(descInput);
                        descSibling.appendChild(descSpacer2);

                        descInput.textContent = item["desc"];
                        descInput.value = item["desc"];

                        // if descInput value is greater than 0 set it as the textContent
                        if(item["desc"].length > 0){

                            console.log("Previously inputted value is valid");
                            descInput.textContent = item["desc"];
                            descInput.value = item["desc"];

                        }


                        switcher = 1;
                    }

                    else{

                            if(toDoChild.nextSibling != null){

                                mainList.removeChild(toDoChild.nextSibling);
                            
                            }
                            switcher = 0;
                        }

                        // ***** CLICK LISTENERS *****

                        // allow keydown event for descInput to change the current description
                        descInput.addEventListener("keydown", function(event) {
        
                            descText = "";

                            if (event.key === "Enter") {
                                descText = descInput.value;
                    
                                console.log("Entered descInput keydown function: " + descText);
                    
                                descInput.blur();
                    
                            }
                    
                    
                                // if description entered has a length > 0 characters
                            if (descText.length > 0){
                                    
                                // DOM - set the text within the element
                                descTrimmed = descText.trim();
                            
                                descInput.textContent = descTrimmed; // - NEW
                                descInput.value = descTrimmed; // - NEW - ensures text is moved to the middle of div
                                descInput.style.fontSize = "12px"; // - NEW



                                // LOGIC - set the array parameter array project[0]['desc']
                                item["desc"] = descTrimmed;

                                toDoArray = listLogic.listItems(toDoName); // project array
                                console.log(toDoArray);

                                descInput.style.border = "none";

                            }

                            else{

                                descInput.style.border = "1px solid red";
                                // console.log("Your description is not long enough.");


                            }


                        });

                }
            }


            });

            closeButtonToDo.addEventListener("click", function(){

                console.log("Entered regenToDo closeButton function");
                // console.log(closeButtonToDo.dataset.info);
 
                // store index of toDo item in variable
                let pos = closeButtonToDo.dataset.info;
                let project = toDoName;
                
                let currentLength = listLogic.projectLength(project);// need function to return current length of the project array


                // if currentLength is 1, clear div information
                if(currentLength === 1){

                    if((toDoChild.nextSibling != null) && (toDoChild.nextSibling.id === 'descSibling')){ // ***** TESTING *****
                    
                        mainListDiv.removeChild(toDoChild.nextSibling);
                    
                    }

                    toDoInput.value = "";
                    
                    // remove item from project array, needs to identify the index of project effected
                    listLogic.removeToDo(project, pos, currentLength); // ******* ERROR - Index out of bounds ******* 

                    // create function that lists project elements
                    let array = listLogic.listItems(project);
                    console.log(array);

                    clickSwitch = 0;
                }

                else{

                    console.log("Entered regenToDo > else > removeChild");

                    if((toDoChild.nextSibling != null) && (toDoChild.nextSibling.id === 'descSibling')){

                        // removes description node form DOM
                        mainListDiv.removeChild(toDoChild.nextSibling);

                    }

                    // remove item from DOM
                    mainListDiv.removeChild(toDoChild);

                    // remove item from project array, needs to identify the index of project effected
                    listLogic.removeToDo(project, pos, currentLength); // ******* ERROR - Index out of bounds *******

                    // create function that lists project elements
                    listLogic.listItems(project);

                    clickSwitch = 0;
                }


                // re-generate DOM array elements using function

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

    };





    return base; 

};    


export { component };




// ********************************************** BUG BASHING ********************************************** //
/** 
 * FIXED - 1. When multiple projects are added, then all are removed, 
 *            it will not remove the last project to exist other than 'Default'.
 *            The existing properties will be { 'Default', 'Project 1' }
 *  
 * PROBLEM - 2. Having issues with deletion/addition of DOM/Array elements
 *         - issue is still present when deleting first element and adding new element,
 *         - two new DOM elements remain after deletion of each element 
 * 
 * FIXED - 3. When clicking on different projects the addToDo button will disable
 *              unnecessarily, leading to not being able to add new toDo items. 
 * 
 * FIXED - 4. When removing projects, the initial project is also removed BUT,
 *         -    all projects after the initial project remain and are unable to be
 *         -    removed.
 * 
 * PROBLEM - 5. When creating a new project with the same name as another the toDo items
 *              end up being deleted unexpectedly. I think the regen function takes the project name
 *              and regenerating the listed array according to that name.
 *           - use validation to prevent duplicate project names from being created mistakenly
 * 
 * FIXED - 6. Enable drop down to see toDo item descriptions
 * 
 * FIXED - 7. Pressing close button on initial toDo item causes description to populate 
 *              ISSUE: when pressing the closebutton it is also activating the toDoChild click for turning on/off the description leading to an error
 * 
 * FIXED - 8. Continuing toDo elements do not clear the descInput of the description element after removing 
 *            parent toDoChild node.
 * 
 * FIXED - 9. Unable to append descSibling elements to mainList after regenToDo is run, so after swapping
 *              between projects. 
 * 
 * FIXED - 10. When creating three toDo items, the first one with a desc and the third one with a desc, and
 *               clicking the closeButton of the second item, this removes it's 'sibling' being the third
 *               toDoChild. This shouldn't happen.
 * 
 * FIXED - 11. When clicking the closeButton of the 'initial toDo' it is also removing the next element,
 *               prevent this by manipulating your eventpropagation() commands. The if/else on the second one 
 *               is improper.
 * 
 * FIXED - 12. When clicking CloseButtonToDo on project 2 > item 1, descSibling element is not being removed 
 *               for some reason.
 * 
 * FIXED - 13. When clicking on CloseButtonToDo for project 2, not properly removing toDoChild.nextSibling 
 * 
 * 
 * 
 * 
*/
// ******************************************************************************************************** //
