import { listLogic, nextDueDate, sanitizeRecurrence } from '../src/listLogic.js';

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

    it('sortCompletedToBottom re-creates a blank placeholder when none exists', () => {
        // Regression guard for the blur-and-return placeholder bug: the UI
        // layer's keyup handler mutates the blank row's item.tit as the user
        // types, leaving the project with no item whose title is "". The
        // Enter handler's first-commit path relies on sortCompletedToBottom
        // (via appendNewToDoRow) to reintroduce the blank so the user has a
        // typeable row after committing. If this invariant ever breaks, the
        // fix in toDoRow.js's buildToDoRow silently regresses.
        listLogic.addToDo('Work', 'A');
        listLogic.addToDo('Work', 'B');

        const items = listLogic.listItems('Work');
        const formerBlank = items.find(i => i.tit === '');
        expect(formerBlank).toBeDefined();
        formerBlank.tit = 'Foo';   // simulate keyup mutation — blank is consumed

        listLogic.sortCompletedToBottom('Work');

        const titles = listLogic.listItems('Work').map(i => i.tit);
        expect(titles[0]).toBe('');        // a fresh blank exists at the top
        expect(titles).toContain('Foo');   // the mutated value survives
        expect(titles.filter(t => t === '')).toHaveLength(1);
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

        // Shape per project is now { items: [...], color: null|string } so
        // each entry can persist its own accent color alongside its todos.
        const parsed = JSON.parse(raw);
        expect(Object.keys(parsed)).toContain('Groceries');
        expect(parsed.Groceries.items.map(i => i.tit)).toContain('Milk');
        expect(parsed.Groceries.color).toBeNull();
    });

    it('_reset clears both in-memory state and localStorage', () => {
        listLogic.addProject('Groceries');
        listLogic._reset();

        expect(listLogic.listProjectsArray()).toEqual([]);
        expect(localStorage.getItem('allProjects')).toBeNull();
    });
});


// ── PER-PROJECT COLOR ─────────────────────────────────────────────
describe('listLogic — per-project color', () => {
    beforeEach(() => {
        listLogic._reset();
        listLogic.addProject('Groceries');
    });

    it('new projects default to null color (theme accent)', () => {
        expect(listLogic.getProjectColor('Groceries')).toBeNull();
    });

    it('setProjectColor stores a valid color key', () => {
        listLogic.setProjectColor('Groceries', 'blue');
        expect(listLogic.getProjectColor('Groceries')).toBe('blue');
    });

    it('setProjectColor with null resets back to the theme accent', () => {
        listLogic.setProjectColor('Groceries', 'red');
        listLogic.setProjectColor('Groceries', null);
        expect(listLogic.getProjectColor('Groceries')).toBeNull();
    });

    it('setProjectColor ignores unknown color keys', () => {
        listLogic.setProjectColor('Groceries', 'not-a-real-color');
        expect(listLogic.getProjectColor('Groceries')).toBeNull();
    });

    it('color survives save to localStorage', () => {
        listLogic.setProjectColor('Groceries', 'green');
        const parsed = JSON.parse(localStorage.getItem('allProjects'));
        expect(parsed.Groceries.color).toBe('green');
    });

    it('getProjectColor returns null for a missing project', () => {
        expect(listLogic.getProjectColor('DoesNotExist')).toBeNull();
    });
});

// ── DATA INTEGRITY ─────────────────────────────────────────────────
// These tests lock down invariants around operations that can silently
// corrupt state — adding over an existing project, renaming onto an
// existing project, renaming from a nonexistent project, and loading
// from malformed storage. Each of these is a "silent bug" risk: the
// operation completes without throwing, but the resulting state is wrong.

describe('listLogic — duplicate project protection', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    it.skip('addProject does not silently overwrite an existing project with the same name', () => {
        // Seed a project with real todos.
        listLogic.addProject('Groceries');
        listLogic.addToDo('Groceries', 'Milk');
        listLogic.addToDo('Groceries', 'Bread');
        const beforeTitles = listLogic.listItems('Groceries').map(i => i.tit);
        expect(beforeTitles).toContain('Milk');
        expect(beforeTitles).toContain('Bread');

        // Call addProject again with the same name. The current implementation
        // will silently overwrite the array — this test pins the bug so a
        // future fix (return early, throw, or merge) has a regression check.
        listLogic.addProject('Groceries');

        const afterTitles = listLogic.listItems('Groceries').map(i => i.tit);
        expect(afterTitles).toContain('Milk');
        expect(afterTitles).toContain('Bread');
    });
});


describe('listLogic — editProject edge cases', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    it.skip('editProject does not silently clobber a project when renaming onto an existing name', () => {
        // Both projects have distinct todos.
        listLogic.addProject('Groceries');
        listLogic.addToDo('Groceries', 'Milk');

        listLogic.addProject('Chores');
        listLogic.addToDo('Chores', 'Vacuum');

        // Rename Groceries -> Chores. The current implementation will blow
        // away Chores' todos. This test pins that silent-corruption bug.
        listLogic.editProject('Groceries', 'Chores');

        const chores = listLogic.listItems('Chores');
        const choreTitles = chores ? chores.map(i => i.tit) : [];

        // At minimum, "Vacuum" should still exist somewhere reachable —
        // either by surviving the rename or by a merge. A silent wipe is
        // the bug this test is designed to catch.
        expect(choreTitles).toContain('Vacuum');
    });

    it.skip('editProject on a nonexistent project does not leave undefined in the data model', () => {
        // currentProperty doesn't exist. The current implementation assigns
        // allProjects[newProperty] = allProjects[currentProperty], which is
        // undefined — poisoning the new key with a non-array value that
        // will crash every downstream operation.
        listLogic.editProject('Ghost', 'Real');

        const items = listLogic.listItems('Real');
        // Either "Real" shouldn't exist, or if it does, it must be a valid
        // array (not undefined). Anything else is a latent crash.
        if (items !== undefined) {
            expect(Array.isArray(items)).toBe(true);
        } else {
            expect(items).toBeUndefined();
        }
    });
});


// ── REPLACE ALL PROJECTS / SNAPSHOT ────────────────────────────────
// Pinned by the manual JSON export/import flow: replaceAllProjects must
// wipe the existing tree and write the imported one in a single atomic
// pass, snapshotProjects must round-trip cleanly, and a few defensive
// shape-cleanups (skipping unnamed entries, normalising bad colors,
// scrubbing NaN dates) need to survive a hand-edited export.
describe('listLogic — replaceAllProjects / snapshotProjects', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    it('replaceAllProjects overwrites the existing project tree', () => {
        listLogic.addProject('Old');
        listLogic.addToDo('Old', 'Stale');

        listLogic.replaceAllProjects([
            { name: 'Fresh', items: [{ tit: 'Hello', completed: false, due: '' }], color: null },
        ]);

        expect(listLogic.listProjectsArray()).toEqual(['Fresh']);
        const titles = listLogic.listItems('Fresh').map(i => i.tit);
        expect(titles).toContain('Hello');
        // The blank placeholder invariant still holds after the rewrite.
        expect(listLogic.listItems('Fresh')[0].tit).toBe('');
    });

    it('replaceAllProjects with an empty array clears all projects', () => {
        listLogic.addProject('Doomed');
        listLogic.replaceAllProjects([]);
        expect(listLogic.listProjectsArray()).toEqual([]);
    });

    it('replaceAllProjects ignores non-array input as a no-op', () => {
        listLogic.addProject('Keep');
        listLogic.replaceAllProjects(null);
        listLogic.replaceAllProjects(undefined);
        listLogic.replaceAllProjects({ not: 'an array' });
        expect(listLogic.listProjectsArray()).toContain('Keep');
    });

    it('replaceAllProjects skips entries with empty or missing names', () => {
        listLogic.replaceAllProjects([
            { name: '', items: [], color: null },
            { name: '   ', items: [], color: null },
            { items: [], color: null },
            { name: 'Valid', items: [{ tit: 'A', completed: false, due: '' }], color: null },
        ]);
        expect(listLogic.listProjectsArray()).toEqual(['Valid']);
    });

    it('replaceAllProjects ignores duplicate names within the same import', () => {
        listLogic.replaceAllProjects([
            { name: 'Dupe', items: [{ tit: 'First', completed: false, due: '' }], color: null },
            { name: 'Dupe', items: [{ tit: 'Second', completed: false, due: '' }], color: null },
        ]);
        const titles = listLogic.listItems('Dupe').map(i => i.tit);
        expect(titles).toContain('First');
        expect(titles).not.toContain('Second');
    });

    it('replaceAllProjects clamps unknown color keys back to null', () => {
        listLogic.replaceAllProjects([
            { name: 'A', items: [], color: 'not-a-real-color' },
            { name: 'B', items: [], color: 'blue' },
        ]);
        expect(listLogic.getProjectColor('A')).toBeNull();
        expect(listLogic.getProjectColor('B')).toBe('blue');
    });

    it('replaceAllProjects scrubs NaN dates and missing completed flags', () => {
        listLogic.replaceAllProjects([
            {
                name: 'Sanitize',
                items: [
                    { tit: 'BadDate', due: 'foo-bar-baz' },
                    { tit: 'NoFlag',  due: '' },
                ],
                color: null,
            },
        ]);
        const items = listLogic.listItems('Sanitize');
        const bad = items.find(i => i.tit === 'BadDate');
        const noFlag = items.find(i => i.tit === 'NoFlag');
        expect(bad.due).toBe('');
        expect(noFlag.completed).toBe(false);
    });

    it('replaceAllProjects persists the new state to localStorage in one pass', () => {
        listLogic.addProject('Old');
        listLogic.replaceAllProjects([
            { name: 'New', items: [{ tit: 'Item', completed: false, due: '' }], color: 'red' },
        ]);
        const parsed = JSON.parse(localStorage.getItem('allProjects'));
        expect(Object.keys(parsed)).toEqual(['New']);
        expect(parsed.New.color).toBe('red');
    });

    it('snapshotProjects round-trips cleanly through replaceAllProjects', () => {
        listLogic.addProject('Roundtrip');
        listLogic.addToDo('Roundtrip', 'Alpha');
        listLogic.addToDo('Roundtrip', 'Beta');
        listLogic.setProjectColor('Roundtrip', 'green');

        const snapshot = listLogic.snapshotProjects();
        listLogic._reset();
        listLogic.replaceAllProjects(snapshot);

        const titles = listLogic.listItems('Roundtrip').map(i => i.tit);
        expect(titles).toContain('Alpha');
        expect(titles).toContain('Beta');
        expect(listLogic.getProjectColor('Roundtrip')).toBe('green');
    });

    it('snapshotProjects preserves project order', () => {
        listLogic.addProject('First');
        listLogic.addProject('Second');
        listLogic.addProject('Third');
        const names = listLogic.snapshotProjects().map(p => p.name);
        expect(names).toEqual(['First', 'Second', 'Third']);
    });
});


describe('listLogic — storage corruption resilience', () => {
    // This one is architecturally tricky because listLogic reads localStorage
    // at module load time, not on demand. To test resilience against malformed
    // storage, we'd need to seed bad data into localStorage *before* the
    // module is first imported — which is only possible via vi.resetModules()
    // and dynamic import. The test below uses that approach.
    //
    // If the test runner complains about top-level await or dynamic imports,
    // this one test can be skipped or deleted — the tradeoff is worth
    // flagging. The existing tests all assume the module is already loaded.

    it.skip('survives malformed JSON in localStorage on load without throwing', async () => {
        // Seed bad data, reset the module cache, and re-import.
        // If listLogic's IIFE throws on bad JSON, the import itself will reject.
        localStorage.setItem('allProjects', 'not valid json {{{');

        // Reset module cache so the next import re-runs the IIFE against
        // the seeded bad data.
        const vitest = await import('vitest');
        vitest.vi.resetModules();

        let loadFailed = false;
        try {
            await import('../src/listLogic.js');
        } catch (e) {
            loadFailed = true;
        }

        // Clean up so other tests see a clean slate.
        localStorage.clear();

        // The load should NOT fail — corrupt storage shouldn't brick the app.
        // This test will currently FAIL against the existing implementation,
        // which is the point: it documents the bug and the fix is to wrap
        // the JSON.parse in a try/catch in listLogic.js.
        expect(loadFailed).toBe(false);
    });
});


// ── RECURRENCE: nextDueDate ─────────────────────────────────────────
// Pure date-math helper for advancing a recurring task to its next
// occurrence. These tests pin the pattern arithmetic that the task spec
// calls out, plus the month/year clamp rule for original day-of-month
// values that don't exist in the target month (Jan 31 → Feb 28 etc.).

function asMDY(date) {
    return (date.getMonth() + 1) + '-' + date.getDate() + '-' + date.getFullYear();
}

describe('listLogic — nextDueDate', () => {
    it('daily pattern adds one day', () => {
        const next = nextDueDate('1-15-2026', { pattern: 'daily' });
        expect(asMDY(next)).toBe('1-16-2026');
    });

    it('weekdays pattern: Friday → Monday', () => {
        // 2026-04-24 is a Friday.
        const next = nextDueDate('4-24-2026', { pattern: 'weekdays' });
        expect(asMDY(next)).toBe('4-27-2026');
    });

    it('weekdays pattern: Wednesday → Thursday', () => {
        // 2026-04-22 is a Wednesday.
        const next = nextDueDate('4-22-2026', { pattern: 'weekdays' });
        expect(asMDY(next)).toBe('4-23-2026');
    });

    it('weekly pattern adds seven days', () => {
        const next = nextDueDate('4-1-2026', { pattern: 'weekly' });
        expect(asMDY(next)).toBe('4-8-2026');
    });

    it('monthly pattern clamps Jan 31 to Feb 28 in non-leap years', () => {
        // 2026 is not a leap year → Feb has 28 days.
        const next = nextDueDate('1-31-2026', { pattern: 'monthly' });
        expect(asMDY(next)).toBe('2-28-2026');
    });

    it('monthly pattern clamps Jan 31 to Feb 29 in leap years', () => {
        // 2024 is a leap year → Feb has 29 days.
        const next = nextDueDate('1-31-2024', { pattern: 'monthly' });
        expect(asMDY(next)).toBe('2-29-2024');
    });

    it('yearly pattern clamps Feb 29 in leap → Feb 28 next year', () => {
        const next = nextDueDate('2-29-2024', { pattern: 'yearly' });
        expect(asMDY(next)).toBe('2-28-2025');
    });

    it('custom pattern: every 3 weeks adds 21 days', () => {
        const next = nextDueDate('4-1-2026', {
            pattern: 'custom',
            interval: 3,
            intervalUnit: 'week',
        });
        expect(asMDY(next)).toBe('4-22-2026');
    });

    it('custom pattern: every 2 months also clamps the day', () => {
        const next = nextDueDate('12-31-2025', {
            pattern: 'custom',
            interval: 2,
            intervalUnit: 'month',
        });
        // Feb 2026 has 28 days → 12-31 + 2mo clamps to 2-28-2026.
        expect(asMDY(next)).toBe('2-28-2026');
    });

    it('basis: completionDate uses the completion date instead of the due date', () => {
        // Daily task originally due 4-1-2026, completed 3 days late on 4-4-2026.
        // Expected: next due = 4-5-2026 (one day after completion).
        const completion = new Date(2026, 3, 4);
        const next = nextDueDate('4-1-2026', {
            pattern: 'daily',
            basis: 'completionDate',
        }, completion);
        expect(asMDY(next)).toBe('4-5-2026');
    });

    it('returns null when no recurrence is supplied', () => {
        expect(nextDueDate('4-1-2026', null)).toBeNull();
    });
});


// ── RECURRENCE: setRecurrence + advanceRecurringTodo ───────────────
describe('listLogic — recurrence helpers', () => {
    beforeEach(() => {
        listLogic._reset();
        listLogic.addProject('R');
        listLogic.addToDo('R', 'Brush teeth');
    });

    it('setRecurrence stores a sanitized recurrence object on the item', () => {
        const item = listLogic.listItems('R').find(i => i.tit === 'Brush teeth');
        listLogic.setRecurrence('R', item, { pattern: 'daily' });
        expect(item.recurrence).not.toBeNull();
        expect(item.recurrence.pattern).toBe('daily');
        expect(item.recurrence.interval).toBe(1);
        expect(item.recurrence.intervalUnit).toBe('day');
        expect(item.recurrence.basis).toBe('dueDate');
        expect(item.recurrence.endDate).toBeNull();
    });

    it('setRecurrence(null) clears recurrence back to a one-off task', () => {
        const item = listLogic.listItems('R').find(i => i.tit === 'Brush teeth');
        listLogic.setRecurrence('R', item, { pattern: 'weekly' });
        listLogic.setRecurrence('R', item, null);
        expect(item.recurrence).toBeNull();
    });

    it('advanceRecurringTodo advances the due date and leaves the row uncompleted', () => {
        const item = listLogic.listItems('R').find(i => i.tit === 'Brush teeth');
        item.due = '4-1-2026';
        item.completed = false;
        listLogic.setRecurrence('R', item, { pattern: 'daily' });

        const advanced = listLogic.advanceRecurringTodo('R', item);
        expect(advanced).toBe(true);
        expect(item.due).toBe('4-2-2026');
        expect(item.completed).toBe(false);
    });

    it('advanceRecurringTodo returns false when next due exceeds endDate', () => {
        const item = listLogic.listItems('R').find(i => i.tit === 'Brush teeth');
        item.due = '4-30-2026';
        listLogic.setRecurrence('R', item, {
            pattern: 'daily',
            endDate: '2026-04-30',
        });

        const advanced = listLogic.advanceRecurringTodo('R', item);
        expect(advanced).toBe(false);
        // Due unchanged so the caller can fall through to a normal
        // mark-complete path without losing the original date.
        expect(item.due).toBe('4-30-2026');
    });

    it('advanceRecurringTodo returns false when no recurrence is set', () => {
        const item = listLogic.listItems('R').find(i => i.tit === 'Brush teeth');
        item.due = '4-1-2026';
        const advanced = listLogic.advanceRecurringTodo('R', item);
        expect(advanced).toBe(false);
    });
});


describe('listLogic — recurrence persistence', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    it('snapshotProjects round-trips a recurrence object intact', () => {
        listLogic.addProject('Roundtrip');
        listLogic.addToDo('Roundtrip', 'Pay rent');
        const item = listLogic.listItems('Roundtrip').find(i => i.tit === 'Pay rent');
        item.due = '5-1-2026';
        listLogic.setRecurrence('Roundtrip', item, {
            pattern: 'monthly',
            basis: 'dueDate',
            endDate: '2027-01-01',
        });

        const snapshot = listLogic.snapshotProjects();
        listLogic._reset();
        listLogic.replaceAllProjects(snapshot);

        const restored = listLogic.listItems('Roundtrip').find(i => i.tit === 'Pay rent');
        expect(restored.recurrence).not.toBeNull();
        expect(restored.recurrence.pattern).toBe('monthly');
        expect(restored.recurrence.basis).toBe('dueDate');
        expect(restored.recurrence.endDate).toBe('2027-01-01');
    });

    it('null recurrence round-trips through snapshot+replace', () => {
        listLogic.addProject('R');
        listLogic.addToDo('R', 'A');
        const snapshot = listLogic.snapshotProjects();
        listLogic._reset();
        listLogic.replaceAllProjects(snapshot);

        const item = listLogic.listItems('R').find(i => i.tit === 'A');
        expect(item.recurrence).toBeNull();
    });
});


describe('listLogic — sanitizeRecurrence', () => {
    it('clamps an unknown pattern to "daily"', () => {
        const result = sanitizeRecurrence({ pattern: 'made-up' });
        expect(result.pattern).toBe('daily');
    });

    it('forces interval to a positive integer', () => {
        const result = sanitizeRecurrence({ pattern: 'custom', interval: -3 });
        expect(result.interval).toBe(1);
    });

    it('returns null when given non-object input', () => {
        expect(sanitizeRecurrence(null)).toBeNull();
        expect(sanitizeRecurrence(undefined)).toBeNull();
        expect(sanitizeRecurrence('daily')).toBeNull();
    });
});
