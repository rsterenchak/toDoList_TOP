import './style.css';
import { listLogic } from './listLogic.js';
import button from './addProj_button.svg';



function component() {


    // GLOBAL


    
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

        const editedInput = document.createElement("input");

        const projTemp = document.createElement("div");


        projChild.style.border = "1px solid blue"; 
        projChild.id = "projChild";

        // First Project Input
        titleInput.type = "text";
        titleInput.id = "projInput";
        titleInput.placeholder = "Enter project title here";
        
        titleInput.value = "";
        titleInput.style.border = "1px solid red";


        // Edited Project Input
        editedInput.type = "text";
        editedInput.id = "projInput";
        editedInput.placeholder = "Enter project title here";
        
        editedInput.value = "";
        editedInput.style.border = "1px solid green";


        // Create element with textbox for input
        sideMaDiv.appendChild(projChild);
        projChild.appendChild(titleInput);

        let currentProperty = "";
        let newProperty = "";
        let firstTime = 0;

        // ****** INPUT LISTENER ****** 
        // Press enter after Project title input to set element information
        titleInput.addEventListener("keydown", function(event) {

            let enteredText = "";
            

            if (event.key === "Enter") {
                enteredText = titleInput.value;
                newProperty = titleInput.value;

                console.log("You entered: " + enteredText);
                titleInput.blur();

            }

            // if title entered has a length > 0 characters
            if (enteredText.length > 0){

                // assign id of the input element to the new div
                // projTemp.id = projTemp; - ORIGINAL
                // titleInput.id = projTemp; - NEW

                // - set newDiv textContent to 'enteredText'
                // projTemp.textContent = enteredText; - ORIGINAL
                // projTemp.style.fontSize = "9px"; - ORIGINAL

                titleInput.textContent = enteredText; // - NEW
                titleInput.style.fontSize = "9px"; // - NEW

                // - replaceChild() titleInput with projTemp
                // titleInput.parentNode.replaceChild(projTemp, titleInput); - ORIGINAL

                
                // projTemp.style.border = "1px solid orange"; - ORIGINAL

                
                if(firstTime === 0){

                    // - send title to addProject() in listLogic.js to add property to allProjects array
                    listLogic.addProject(enteredText);
                    firstTime = 1;
                    currentProperty = titleInput.textContent;
                }

                else{
                    
                    // console.log("Current Property: " + currentProperty);
                    // console.log("New Property: " + newProperty);

                    // - send title to editToDo() in listLogic.js to edit currentProperty to allProjects array 
                    listLogic.editToDo(currentProperty, newProperty);

                    currentProperty = newProperty;
                }

                listLogic.listProjects();
                

                // On Click - should bring back ability to use add projects button 
                projButton.style.pointerEvents = "auto"; 
                
                // NOTE: projChild > titleInput

            }

            
        }); // Ends "Enter" keydown function



        // ****** Focus/Shadow LISTENERS ******
        titleInput.addEventListener("focus", function() {
            this.style.background = "rgba(0, 0, 0, 0)";
            projChild.style.boxShadow = "none";
            projChild.style.background = "white";             
        });

        editedInput.addEventListener("focus", function() {
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



    return base; 

};    


export { component };