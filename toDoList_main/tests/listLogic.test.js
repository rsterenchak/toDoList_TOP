import { listLogic } from '../src/listLogic.js';

// ── PROJECTS ─────────────────────────────────────────────────────────
describe('listLogic — projects', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    it('starts with no projects', () => {
        expect(listLogic.listProjectsArray()).toEqual([]);
    });

    it('addProject registers a new project', () => {
        listLogic.addProject('Groceries');
        expect(listLogic.listProjectsArray()).toContain('Groceries');
    });

    it('addProject trims whitespace from the name', () => {
        listLogic.addProject('  Chores  ');
        expect(listLogic.listProjectsArray()).toContain('Chores');
        expect(listLogic.listProjectsArray()).not.toContain('  Chores  ');
    });

    it('removeProject deletes the named project', () => {
        listLogic.addProject('Groceries');
        listLogic.removeProject('Groceries');
        expect(listLogic.listProjectsArray()).not.toContain('Groceries');
    });

    it('editProject renames a project and preserves its items', () => {
        listLogic.addProject('Old');
        listLogic.addToDo('Old', 'Milk');
        listLogic.editProject('Old', 'New');

        expect(listLogic.listProjectsArray()).toContain('New');
        expect(listLogic.listProjectsArray()).not.toContain('Old');
        const titles = listLogic.listItems('New').map(i => i.tit);
        expect(titles).toContain('Milk');
    });

    it('projectLength returns 0 for a missing project', () => {
        expect(listLogic.projectLength('DoesNotExist')).toBe(0);
    });
});


// ── TODOS ────────────────────────────────────────────────────────────
describe('listLogic — todos', () => {
    beforeEach(() => {
        listLogic._reset();
        listLogic.addProject('Groceries');
    });

    it('new project starts with one blank placeholder', () => {
        const items = listLogic.listItems('Groceries');
        expect(items).toHaveLength(1);
        expect(items[0].tit).toBe('');
    });

    it('addToDo appends a todo with the given title', () => {
        listLogic.addToDo('Groceries', 'Milk');
        const titles = listLogic.listItems('Groceries').map(i => i.tit);
        expect(titles).toContain('Milk');
    });

    it('blank placeholder stays pinned at index 0 after adding todos', () => {
        listLogic.addToDo('Groceries', 'Milk');
        listLogic.addToDo('Groceries', 'Bread');
        expect(listLogic.listItems('Groceries')[0].tit).toBe('');
    });

    it('does not create duplicate blank placeholders', () => {
        listLogic.addToDo('Groceries', '');
        listLogic.addToDo('Groceries', '');
        const blanks = listLogic.listItems('Groceries').filter(i => i.tit === '');
        expect(blanks).toHaveLength(1);
    });

    it('addToDo on a missing project returns an empty result without throwing', () => {
        const result = listLogic.addToDo('DoesNotExist', 'Milk');
        expect(result.array).toEqual([]);
        expect(result.lengths).toBe(0);
    });

    it('removeToDoByItem removes the matching todo by reference', () => {
        listLogic.addToDo('Groceries', 'Milk');
        listLogic.addToDo('Groceries', 'Bread');

        const milk = listLogic.listItems('Groceries').find(i => i.tit === 'Milk');
        listLogic.removeToDoByItem('Groceries', milk);

        const titles = listLogic.listItems('Groceries').map(i => i.tit);
        expect(titles).not.toContain('Milk');
        expect(titles).toContain('Bread');
    });

    it('removeToDoByItem deletes only the referenced item when titles collide', () => {
        // Duplicate titles are allowed in the data model — the whole reason
        // removeToDoByTitle was replaced with removeToDoByItem. This test
        // locks that invariant down.
        listLogic.addToDo('Groceries', 'Milk');
        listLogic.addToDo('Groceries', 'Milk');

        const items = listLogic.listItems('Groceries').filter(i => i.tit === 'Milk');
        expect(items).toHaveLength(2);

        listLogic.removeToDoByItem('Groceries', items[0]);

        const remaining = listLogic.listItems('Groceries').filter(i => i.tit === 'Milk');
        expect(remaining).toHaveLength(1);
        expect(remaining[0]).toBe(items[1]);   // the *other* one survived
    });

    it('removeToDoByItem is a no-op when the item is not in the project', () => {
        listLogic.addToDo('Groceries', 'Milk');
        const lengthBefore = listLogic.projectLength('Groceries');

        const stranger = { tit: 'Ghost', completed: false };
        listLogic.removeToDoByItem('Groceries', stranger);

        expect(listLogic.projectLength('Groceries')).toBe(lengthBefore);
    });
});


// ── COMPLETED-SORT INVARIANT ─────────────────────────────────────────
describe('listLogic — completed sorting', () => {
    beforeEach(() => {
        listLogic._reset();
        listLogic.addProject('Work');
    });

    it('sortCompletedToBottom moves completed items beneath uncompleted ones', () => {
        listLogic.addToDo('Work', 'A');
        listLogic.addToDo('Work', 'B');
        listLogic.addToDo('Work', 'C');

        const items = listLogic.listItems('Work');
        items.find(i => i.tit === 'A').completed = true;

        listLogic.sortCompletedToBottom('Work');

        const titles = listLogic.listItems('Work').map(i => i.tit);
        // blank first, then uncompleted B and C, then completed A
        expect(titles).toEqual(['', 'B', 'C', 'A']);
    });

    it('sortCompletedToBottom preserves the blank placeholder at index 0', () => {
        listLogic.addToDo('Work', 'A');
        listLogic.addToDo('Work', 'B');
        listLogic.listItems('Work').find(i => i.tit === 'A').completed = true;

        listLogic.sortCompletedToBottom('Work');

        expect(listLogic.listItems('Work')[0].tit).toBe('');
    });
});


// ── REORDERING ───────────────────────────────────────────────────────
describe('listLogic — reordering', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    it('reorderProject moves a project to a new index', () => {
        listLogic.addProject('A');
        listLogic.addProject('B');
        listLogic.addProject('C');

        listLogic.reorderProject(0, 2);   // A moves to the end

        expect(listLogic.listProjectsArray()).toEqual(['B', 'C', 'A']);
    });

    it('reorderProject is a no-op when indexes are equal', () => {
        listLogic.addProject('A');
        listLogic.addProject('B');
        listLogic.reorderProject(1, 1);
        expect(listLogic.listProjectsArray()).toEqual(['A', 'B']);
    });

    it('reorderProject ignores out-of-bounds indexes', () => {
        listLogic.addProject('A');
        listLogic.addProject('B');
        listLogic.reorderProject(0, 99);
        expect(listLogic.listProjectsArray()).toEqual(['A', 'B']);
    });

    it('reorderToDo reorders against the non-blank slice', () => {
        // Caller passes indexes relative to the non-blank slice — the blank
        // placeholder is never at an index the drag layer sees. This test
        // locks that contract down.
        listLogic.addProject('P');
        listLogic.addToDo('P', 'A');
        listLogic.addToDo('P', 'B');
        listLogic.addToDo('P', 'C');

        listLogic.reorderToDo('P', 0, 2);   // A moves to end of non-blank slice

        const titles = listLogic.listItems('P').map(i => i.tit);
        expect(titles).toEqual(['', 'B', 'C', 'A']);
    });

    it('reorderToDo re-pins the blank placeholder at index 0', () => {
        listLogic.addProject('P');
        listLogic.addToDo('P', 'A');
        listLogic.addToDo('P', 'B');

        listLogic.reorderToDo('P', 0, 1);

        expect(listLogic.listItems('P')[0].tit).toBe('');
    });

    it('reorderToDo clamps completed items to the bottom', () => {
        // Per the comment in listLogic.js, reorderToDo runs sortCompletedInPlace
        // after the move so a drop above a completed item still keeps the
        // completed item at the bottom.
        listLogic.addProject('P');
        listLogic.addToDo('P', 'A');
        listLogic.addToDo('P', 'B');
        listLogic.addToDo('P', 'C');
        listLogic.listItems('P').find(i => i.tit === 'C').completed = true;
        listLogic.sortCompletedToBottom('P');   // starting state: ['', A, B, C(done)]

        // Try to move C above A. Expected: C still ends up at the bottom.
        listLogic.reorderToDo('P', 2, 0);

        const titles = listLogic.listItems('P').map(i => i.tit);
        expect(titles[titles.length - 1]).toBe('C');
    });
});


// ── STORAGE ──────────────────────────────────────────────────────────
describe('listLogic — storage', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    it('saveToStorage persists the current project state', () => {
        listLogic.addProject('Groceries');
        listLogic.addToDo('Groceries', 'Milk');
        listLogic.saveToStorage();

        const raw = localStorage.getItem('allProjects');
        expect(raw).not.toBeNull();

        const parsed = JSON.parse(raw);
        expect(Object.keys(parsed)).toContain('Groceries');
        expect(parsed.Groceries.map(i => i.tit)).toContain('Milk');
    });

    it('_reset clears both in-memory state and localStorage', () => {
        listLogic.addProject('Groceries');
        listLogic._reset();

        expect(listLogic.listProjectsArray()).toEqual([]);
        expect(localStorage.getItem('allProjects')).toBeNull();
    });
});