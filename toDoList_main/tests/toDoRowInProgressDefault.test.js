import { describe, it, expect, beforeEach } from 'vitest';
import { buildToDoRow } from '../src/toDoRow.js';
import { listLogic } from '../src/listLogic.js';
import { PHASE_FILTER_KEY } from '../src/prefs.js';

// A task typed into the blank "Add a task" placeholder while the IN PROGRESS
// filter pill is selected used to land with the toDo() factory's default
// `active` status — so taskFilter's `inprogress` matcher (status
// `in_progress`, or a derived draft/running phase) rejected it and the row the
// user had just typed disappeared the moment they pressed Enter. The Enter
// commit handler in buildToDoRow now reads getPhaseFilter() and defaults the
// new item to `in_progress` when that filter is the active one.
//
// The default must apply ONLY to the first-commit branch (promoting the blank
// placeholder). Re-committing an already-committed row — an in-place title
// edit, which routes through the `else` / editToDoItem branch — must leave
// whatever status the user picked alone.

let projectSeq = 0;

function freshProject() {
    const name = 'InProgressDefaultProj' + (++projectSeq);
    listLogic.addProject(name);
    return name;
}

// Build the project's blank placeholder row, mounted in #mainList so the row's
// drag wiring can resolve a container.
function buildPlaceholderRow(project) {
    listLogic.addToDo(project, '');
    const items = listLogic.listItems(project);
    const blank = items.filter(function(i) { return !i.tit; }).pop();
    const row = buildToDoRow(blank, project);
    document.getElementById('mainList').appendChild(row);
    return { row: row, item: blank };
}

function pressEnterWithTitle(row, title) {
    const input = row.querySelector('#toDoInput');
    input.value = title;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
}

describe('new tasks default to in_progress while the IN PROGRESS filter is active', () => {

    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '<div id="mainList"></div>';
    });

    it('commits the new task as in_progress when the phase filter is inprogress', () => {
        localStorage.setItem(PHASE_FILTER_KEY, 'inprogress');
        const project = freshProject();
        const built = buildPlaceholderRow(project);

        pressEnterWithTitle(built.row, 'Filtered-in task');

        expect(built.item.tit).toBe('Filtered-in task');
        expect(built.item.status).toBe('in_progress');
    });

    it('the committed row carries the IN PROGRESS badge and row class, so it survives the filter', () => {
        localStorage.setItem(PHASE_FILTER_KEY, 'inprogress');
        const project = freshProject();
        const built = buildPlaceholderRow(project);

        pressEnterWithTitle(built.row, 'Badged task');

        // The status badge is built later in the same handler, off item.status —
        // so the default has to be set before that point, not after.
        expect(built.row.querySelector('.todoStatusLabel')).toBeTruthy();
        expect(built.row.classList.contains('todo-row--in_progress')).toBe(true);
    });

    it('leaves the factory default alone when the ALL filter is active', () => {
        localStorage.setItem(PHASE_FILTER_KEY, 'all');
        const project = freshProject();
        const built = buildPlaceholderRow(project);

        pressEnterWithTitle(built.row, 'Unfiltered task');

        expect(built.item.status).toBe('active');
    });

    it('leaves the factory default alone when no filter preference is stored', () => {
        const project = freshProject();
        const built = buildPlaceholderRow(project);

        pressEnterWithTitle(built.row, 'Default-filter task');

        expect(built.item.status).toBe('active');
    });

    it('leaves the factory default alone when the DONE filter is active', () => {
        localStorage.setItem(PHASE_FILTER_KEY, 'done');
        const project = freshProject();
        const built = buildPlaceholderRow(project);

        pressEnterWithTitle(built.row, 'Done-filtered task');

        expect(built.item.status).toBe('active');
    });

    it('does not rewrite the status of an already-committed row re-committed by title edit', () => {
        localStorage.setItem(PHASE_FILTER_KEY, 'inprogress');
        const project = freshProject();

        // A committed row the user has explicitly parked as an idea...
        listLogic.addToDo(project, 'Parked idea');
        const committed = listLogic.listItems(project).filter(function(i) {
            return i.tit === 'Parked idea';
        })[0];
        committed.status = 'idea';
        const committedRow = buildToDoRow(committed, project);
        document.getElementById('mainList').appendChild(committedRow);

        // ...with a blank placeholder still present, so Enter on the committed
        // row takes the edit branch rather than the first-commit branch.
        buildPlaceholderRow(project);

        pressEnterWithTitle(committedRow, 'Parked idea, renamed');

        expect(committed.tit).toBe('Parked idea, renamed');
        expect(committed.status).toBe('idea');
    });
});
