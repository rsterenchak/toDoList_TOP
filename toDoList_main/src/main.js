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


    var mainChild = mainList.childNodes[1];

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

            // on click should temporarily disable ability to continue clicking
            itemButton.style.pointerEvents = "none";

            const mainDiv = document.querySelector('#mainList');

            var childNodes = mainDiv.childNodes;

            // querySelect all the projChild elements, change their classes to unselectedProject
            var projOnChild = document.querySelector('.selectedProject');

            let enteredText = "";
            let trimmedText = "";
            let projectItems = [];

            // let projectArray = [];
            // let projectName = "";

            if (event.key === "Enter") {
                enteredText = titleInput.value;
                newProperty = titleInput.value;

                // console.log("You entered: " + enteredText);
                titleInput.blur();

            }

            // if title entered has a length > 0 characters
            if (enteredText.length > 0){

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
                    
                    // console.log("*** Project selection Changed ***");
                    let fresh = 0;


                    if(fresh === 0){

                        projOnChild = document.querySelector('.selectedProject'); //  latest selection
                    
                        fresh = 1;
                    }

                    // console.log("projOnChild: " + projOnChild);

                    selectProject(); // 1 - Changes selected element

                    projOnChild = document.querySelector('.selectedProject'); //  latest selection

                    if(projOnChild != null){

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
            const mainChild = document.getElementById("toDoChild");

            let property = titleInput.value;
            let projectLength = listLogic.projectLength(property);
            let i = 0;

            // DOM - Removes project DOM element
            projChild.parentNode.removeChild(projChild);

            // DOM - Removes item DOM elements associated with project
            while(mainList.contains(mainChild)){

                mainList.removeChild(mainChild);

                // i++;
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

                    console.log(toDoArray);
                    console.log(toDoName);
                    console.log(toDoLength);

                }
                
                else{ 

                    toDoArray = listLogic.listItems(currentProject); // project array
                    toDoName = currentProject; // projectName
                    toDoLength = listLogic.projectLength(currentProject); // >>> 2

                    console.log(toDoArray);
                    console.log(toDoName);
                    console.log(toDoLength);
                    

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

                arraySlot["due"] = dateSet;    
                arraySlot["tit"] = trimmedText;

                closeButtonToDo.dataset.info = (toDoLength - 1);


                projectItems = listLogic.listItems(currentProject);  

                console.log(projectItems);

                // on click should temporarily disable ability to continue clicking
                itemButton.style.pointerEvents = "auto";
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

                    toDoInput.value = "";
                    
                    // remove item from project array, needs to identify the index of project effected
                    listLogic.removeToDo(project, 0, currentLength);

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

/*      console.log(toDoArray[0].tit);
        console.log(toDoArray.length);
        console.log((toDoArray[0].tit).length);
 */

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
                    

                }

                
            }); // Ends "Enter" keydown function

            closeButtonToDo.addEventListener("click", function(){


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
            
/*             let monthValue = month.value;
            let dayValue = day.value;
            let yearValue = year.value;
 */

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


                }

                
            }); // Ends "Enter" keydown function

            closeButtonToDo.addEventListener("click", function(){

                console.log("Entered regenToDo closeButton function");
                // console.log(closeButtonToDo.dataset.info);
 
                // store index of toDo item in variable
                let pos = closeButtonToDo.dataset.info;
                let project = toDoName;
                
                let currentLength = listLogic.projectLength(project);// need function to return current length of the project array


                // if currentLength is 1, clear div information
                if(currentLength === 1){

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




// ********************* BUGS LIST ********************* //
/** 
 * FIXED - 1. When multiple projects are added, then all are removed, 
 * it will not remove the last project to exist other than 'Default'.
 * The existing properties will be { 'Default', 'Project 1' }
 *  
 * PROBLEM - 2. Having issues with deletion/addition of DOM/Array elements
 *   
 * 
 * 
*/
// ***************************************************** //
