import './style.css';



// FACTORY FUNCTION: TODO OBJECT
// Store list items in objects
const toDo = (title, description, dueDate, priority, position) => {
    let tit = title;
    let desc = description;
    let due = dueDate;
    let pri = priority;
    let pos = position;

    // console.log("Called toDo Object");

    
    return {tit, desc, due, pri, pos};
  };
  

  export { toDo };