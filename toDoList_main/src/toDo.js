import './style.css';



// FACTORY FUNCTION: TODO OBJECT
// Store list items in objects
const toDo = (title, description, dueDate, priority, position) => {
    let tit = title;
    let desc = description;
    let due = dueDate;
    let pri = priority;
    let pos = position;
    let completed = false;
    // null = one-off task. Otherwise an object shaped
    // { pattern, interval, intervalUnit, basis, endDate } — see
    // listLogic.js's nextDueDate for the supported pattern values.
    let recurrence = null;

    // console.log("Called toDo Object");


    return {tit, desc, due, pri, pos, completed, recurrence};
  };
  

  export { toDo };