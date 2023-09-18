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


        projChild.style.border = "1px solid blue"; 
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

        // ****** INPUT LISTENER ****** 
        // Press enter after Project title input to set element information
        titleInput.addEventListener("keydown", function(event) {

            let enteredText = "";
            let trimmedText = "";
            let projectItems = [];

            let projectArray = [];
            let projectName = "";

            if (event.key === "Enter") {
                enteredText = titleInput.value;
                newProperty = titleInput.value;

                console.log("You entered: " + enteredText);
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
                    
                    // console.log(projectItems.array); // refers to project array
                    // console.log(projectItems.string); // refers to project name

                    projectArray = projectItems.array;
                    projectName = projectItems.string;


                    firstTime = 1;
                    currentProperty = titleInput.textContent;
                    
                    // function returns updated project array for DOM
                    // projectItems = listLogic.listItems(); 
                    
                }

                else{
                    
                    // - send title to editToDo() in listLogic.js to edit currentProperty to allProjects array 
                    projectItems = listLogic.editProject(currentProperty, newProperty); 

                    projectArray = projectItems.array;
                    projectName = projectItems.string;

                    currentProperty = newProperty;

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

            }

            
        }); // Ends "Enter" keydown function

        // Removes selected project elements from DOM/Logic
        closeButton.addEventListener("click", function() {

            let property = titleInput.value;


            // Need to remove the DOM element
            projChild.parentNode.removeChild(projChild);

            // Need to call logic function that removes property from allProjects[] array
            listLogic.removeProject(property);

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

        console.log(items);
        // console.log(items.length);
        // console.log(items[0]);
        // console.log(items[0]["tit"]);


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


        // adds 'existing items' to project items list
        while(counter < toDoArray.length){

            addtoDo(toDoArray[counter], counter); // designates project and item position in array
            
            

            counter++;
        }

        // console.log(toDoArray);
        // console.log(items[0]);




        // place generation of each toDoChild within a function with listeners for actions placed on them
        function addtoDo(item, index){


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
                    console.log(toDoArray);
                }

                
            }); // Ends "Enter" keydown function

            closeButtonToDo.addEventListener("click", function(){

                console.log("Entered click function");
                // console.log(closeButtonToDo.dataset.info);
 
                // store index of toDo item in variable
                let pos = closeButtonToDo.dataset.info;
                let project = toDoName;
                
                // need function to return current length of the project array

                // console.log("pos: " + pos);
                // console.log("project: " + toDoName);

                // remove item from DOM
                mainListDiv.removeChild(toDoChild);
    
                // remove item from project array, needs to identify the index of project effected
                listLogic.removeToDo(project, pos);

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