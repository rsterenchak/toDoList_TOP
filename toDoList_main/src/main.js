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



    // ********************** CLICK LISTENERS ********************** //

    // Click Listener: That adds new project element
    projButton.addEventListener("click", function(){

        console.log("Pressed add project button.");

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
        titleInput.placeholder = "Enter project title here";
        
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
                titleInput.style.fontSize = "9px"; // - NEW
                
                

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
                    // projectItems = listLogic.listItems(); 
                    
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
                    // projectItems = listLogic.listItems();
                    
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

                    console.log("projOnChild: " + projOnChild);

                    selectProject(); // 1 - Changes selected element

                    projOnChild = document.querySelector('.selectedProject'); //  latest selection

                    var innerValue = projOnChild.textContent; // pulls projectName
                    var arrayValues = listLogic.listItems(innerValue);// pulls projectArray

                    console.log(innerValue);
                    console.log(arrayValues);

                    

                    clearToDos(); // 2 - Clears previous childNode under toDo List
                    
                    /** NOT WORKING */
                    addAllToDo_DOM(arrayValues, innerValue); // 3 - Adds the appropriate elements back into toDo List
                    
                
                });


                // *** FUNCTIONS ***

                // changes an elements selection
                function selectProject(){

                    if(projOnChild != null){
            
                        console.log("selectedProject exists");

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

                    const mainDiv = document.querySelector('#mainList');                    


                    if(mainDiv.contains(childNodes[1])){

                        console.log("Contains more than one node");
    
                        mainDiv.removeChild(childNodes[1]); // remove childNodes
                        
                        console.log(childNodes);
                    
                    }                    

                }


            }

            
        }); // Ends "Enter" keydown function

        // Removes selected project elements from DOM/Logic
        closeButton.addEventListener("click", function() {

            const mainList = document.getElementById("mainList");
            const mainChild = document.getElementById("toDoChild");

            let property = titleInput.value;
            let projectLength = listLogic.projectLength(property);
            let i = 0;

            // DOM - Removes project DOM element
            projChild.parentNode.removeChild(projChild);

            // DOM - Removes item DOM elements associated with project
            while(i < projectLength){

                mainList.removeChild(mainChild);

                i++;
            }
            

            // LOGIC - Need to call logic function that removes property from allProjects[] array
            listLogic.removeProject(property);

            // LOGIC - Removes toDo logic elements associated with project

            
            // LOGIC - Lists all existing projects in logic
            listLogic.listProjects();

            // On Click - should bring back ability to use add projects button 
            projButton.style.pointerEvents = "auto"; 


        }); // Ends "closeButton" click function

        // Clicking on projChild needs remove old items then generate items based on a project's existing array items
        // IDEAS: 
        // - Need listener to work when projChild is clicked or when input for new element is set
/*         projChild.addEventListener("click", function(){

            console.log("Entered projChild click listener");
            
            // what if each projChild had datasetinfo to be able to point to it and manipulate its stylings

            const mainDiv = document.querySelector('#mainList');

            var childNodes = mainDiv.childNodes;
            let inputLength = (titleInput.value).length;

            // querySelect all the projChild elements, change their classes to unselectedProject
            var projOnChild = document.querySelector('.selectedProject');
            var toDoChildren = document.querySelector('#projChild');





            if(inputLength > 0){

                if(projOnChild != null){
            
                    projOnChild.classList.remove("selectedProject");
                    projOnChild.classList.add("unselectedProject");
                
                }
                // changing ONLY the selected project
                if(projChild.classList.contains("unselectedProject")){
    
                    projChild.classList.remove("unselectedProject");
                    projChild.classList.add("selectedProject");
    
    
                    console.log("Class changed to selectedProject");
                    
                }

                // need projectName
                let projArray = listLogic.listItems(projectName);// need function to return array

                if(mainDiv.contains(childNodes[1])){

                    console.log("Contains more than one node");

                    mainDiv.removeChild(childNodes[1]); // remove childNodes
                    
                    console.log(childNodes);
                
                }

                console.log(projArray);
                // addAllToDo_DOM(projArray, projectName);
            
            }



        }); */
        


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

    }); // Ends Project button listener

    // Click Listener: That adds new item element





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




    // GLOBAL DOM FUNCTIONS

    // AddToDo Item function
    // should just do the job of adding the DOM element
    // add to button and event listeners after 
    function addAllToDo_DOM(items, name){

        // project name
        let toDoArray = items; //  items array [] without project name
        let toDoName = name;
        let counter = 0;



        // declare elements needed, make similar to the adding projects version
        const mainListDiv = document.getElementById("mainList");
        const toDoChild = document.createElement("div");

        const toDoInput = document.createElement("input");
        const closeButtonToDo = document.createElement("div");
        const spacer = document.createElement("div");

        toDoChild.style.border = "1px solid green"; 
        toDoChild.id = "toDoChild";

        // First Project Input
        toDoInput.type = "text";
        toDoInput.id = "toDoInput";
        toDoInput.placeholder = "New Item";
        
        // toDoInput.value = "";
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

            addNewToDo(toDoArray[counter], counter); // designates project item, along with array position

        }




        // Meant for newToDos
        function addNewToDo(item, index){


            mainListDiv.appendChild(toDoChild);
            toDoChild.appendChild(toDoInput);
            toDoChild.appendChild(spacer);
            toDoChild.appendChild(closeButtonToDo);   


            // EDITS TITLE OF ITEM ELEMENT
            toDoInput.addEventListener("keydown", function(event) {

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
                    toDoInput.style.fontSize = "9px"; // - NEW
                    
                    item["tit"] = trimmedText;

                    closeButtonToDo.dataset.info = index;

                    
                    console.log("item title: " + item["tit"]);
                    console.log(item);
                }

                
            }); // Ends "Enter" keydown function

            closeButtonToDo.addEventListener("click", function(){

                console.log("Entered click function");
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

        // Meant for oldToDos re-generation
        function regenToDos(item, index){


            mainListDiv.appendChild(toDoChild);
            toDoChild.appendChild(toDoInput);
            toDoChild.appendChild(spacer);
            toDoChild.appendChild(closeButtonToDo);   
            
            
            console.log("inside re-gen toDo function: " + item.tit);


            toDoInput.textContent = item.tit; // - NEW
            toDoInput.value = item.tit; // - NEW - ensures text is moved to the middle of div
            toDoInput.style.fontSize = "9px"; // - NEW
            
            item["tit"] = item.tit;

            closeButtonToDo.dataset.info = index;


            // EDITS TITLE OF ITEM ELEMENT
            toDoInput.addEventListener("keydown", function(event) {

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
                    toDoInput.style.fontSize = "9px"; // - NEW
                    
                    item["tit"] = trimmedText;

                    closeButtonToDo.dataset.info = index;


                }

                
            }); // Ends "Enter" keydown function

            closeButtonToDo.addEventListener("click", function(){

                console.log("Entered click function");
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

        // if you decide to use the addToDo DOM button, use a listener

    };





    return base; 

};    


export { component };