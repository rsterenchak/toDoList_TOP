import { listLogic } from './listLogic.js';
import { applyProjectAccent } from './projectMenu.js';

// Programmatic project-create used by the desktop project-picker dropdown's
// inline "+ new project" input. Rather than inventing a parallel create path,
// this drives the SAME #projButton row-build + Enter-commit the mobile + button
// uses — so the backing sidebar #projChild row, the active selection, the
// badges, and the todo render all land identically — but supplies the name
// programmatically instead of opening the drawer for the user to type. The
// picker has already validated the name (non-empty, unique); the guards here
// are defensive against a future caller. The #projButton element (built in
// main.js) is resolved by id at call time so this module keeps no reference
// back into main.js.
export function createProjectByName(name) {
    const trimmed = (name || '').trim();
    if (trimmed.length === 0) return false;
    const existing = (listLogic.listProjectsArray && listLogic.listProjectsArray()) || [];
    if (existing.indexOf(trimmed) !== -1) return false;
    const projButton = document.getElementById('projButton');
    if (!projButton) return false;
    projButton.click();
    const sideMaDiv = document.getElementById('sideMa');
    const rows = sideMaDiv ? sideMaDiv.querySelectorAll('#projChild') : [];
    const newRow = rows.length ? rows[rows.length - 1] : null;
    if (!newRow) return false;
    const input = newRow.querySelector('#projInput');
    if (!input) return false;
    input.value = trimmed;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return true;
}

// changes an element's selection — behaviour-preserving extraction of the
// per-row selectProject helper from main.js's #projButton create/rename commit
// path. The three DOM nodes it reads (the previously selected row, the row
// being selected, and that row's title input) were closures over the row-build
// scope in main.js, so they arrive here as params; applyProjectAccent and
// listLogic are imported directly. main.js keeps a thin local selectProject()
// wrapper so its call sites stay unchanged.
export function selectProjectRow(projOnChild, projChild, titleInput) {

    if (projOnChild != null) {

        // console.log("selectedProject exists");

        projOnChild.classList.remove("selectedProject");
        projOnChild.classList.add("unselectedProject");

    }
    // changing ONLY the selected project
    if (projChild.classList.contains("unselectedProject")) {

        projChild.classList.remove("unselectedProject");
        projChild.classList.add("selectedProject");


        // console.log("Class changed to selectedProject");

    }

    // Newly-committed projects default to null color; also
    // covers editProject renames by re-reading current color.
    applyProjectAccent(document.getElementById('mainList'), listLogic.getProjectColor(titleInput.value));

}
