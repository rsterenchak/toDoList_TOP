import './style.css';


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


    base.id ='outerContainer';
    nav.id = 'navBar';
    main.id = 'mainSec';
    foot.id = 'footBar';

    main1.id = 'sideBar';
    main2.id = 'mainBar';

    sideTitle.id = 'sideTit';
    sideMain.id = 'sideMa';

    base.appendChild(nav);
    base.appendChild(main);
    base.appendChild(foot);

    main.appendChild(main1);
    main.appendChild(main2);

    main1.appendChild(sideTitle);
    main1.appendChild(sideMain);



    return base; 

};    


export { component };