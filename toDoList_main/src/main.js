import './style.css';
import button from './addProj_button.svg';
import { add } from 'lodash';


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

    // FUNCTION: That adds new project


    return base; 

};    


export { component };