import { describe, it, expect, beforeEach } from 'vitest';
import { listLogic } from '../src/listLogic.js';

// getTodoById resolves a committed todo by id across every project, returning a
// read-only { id, title, description } view (or null). It backs the Claude
// sheet's task-scope chip, which stores only the id and re-reads the text on
// every render/turn — so a rename must surface live and a deletion must return
// null (collapsing the chip to unscoped) rather than a stale copy.
describe('listLogic.getTodoById', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    function firstCommitted(projectName) {
        return listLogic.listItems(projectName).find((i) => i.tit !== '');
    }

    it('returns null for a blank, missing, or unknown id', () => {
        expect(listLogic.getTodoById(null)).toBe(null);
        expect(listLogic.getTodoById('')).toBe(null);
        expect(listLogic.getTodoById('does-not-exist')).toBe(null);
    });

    it('resolves a todo across projects to { id, title, description }', () => {
        listLogic.addProject('A');
        listLogic.addProject('B');
        listLogic.addToDo('A', 'Task in A');
        listLogic.addToDo('B', 'Task in B');
        const b = firstCommitted('B');
        b.desc = 'Details for B';

        const view = listLogic.getTodoById(b.id);
        expect(view).toEqual({ id: b.id, title: 'Task in B', description: 'Details for B' });
    });

    it('defaults description to an empty string when the todo has none', () => {
        listLogic.addProject('A');
        listLogic.addToDo('A', 'No desc');
        const item = firstCommitted('A');
        expect(listLogic.getTodoById(item.id).description).toBe('');
    });

    it('reflects a live rename rather than a stale title', () => {
        listLogic.addProject('A');
        listLogic.addToDo('A', 'Old title');
        const item = firstCommitted('A');
        item.tit = 'New title';
        expect(listLogic.getTodoById(item.id).title).toBe('New title');
    });

    it('returns null once the todo is deleted', () => {
        listLogic.addProject('A');
        listLogic.addToDo('A', 'Doomed');
        const item = firstCommitted('A');
        const id = item.id;
        expect(listLogic.getTodoById(id)).not.toBe(null);
        listLogic.removeToDoByItem('A', item);
        expect(listLogic.getTodoById(id)).toBe(null);
    });

    it('does not mutate the underlying todo (read-only view)', () => {
        listLogic.addProject('A');
        listLogic.addToDo('A', 'Immutable');
        const item = firstCommitted('A');
        const view = listLogic.getTodoById(item.id);
        view.title = 'hacked';
        view.description = 'hacked';
        expect(item.tit).toBe('Immutable');
        expect(item.desc || '').toBe('');
    });
});
