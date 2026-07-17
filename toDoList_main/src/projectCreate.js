import { listLogic } from './listLogic.js';

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
