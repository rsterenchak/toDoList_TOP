import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { getTaskSort, setTaskSort, TASK_SORT_KEY } from '../src/prefs.js';
import { buildTaskFilterBar, applyTaskFilter } from '../src/taskFilter.js';
import { setPhaseFilter } from '../src/prefs.js';
import { sortItemsByStatusForRender } from '../src/listLogic.js';

// The Sort dropdown replaces the former "Sort by due" checkbox and "Expand All"
// button. Its choice is a GLOBAL pref (todoapp_taskSort) and a pure render
// concern. These tests pin the pref round-trip, the mutex (single key), the
// compose-with-filter contract, and the removal of the retired Expand All
// button from the controls band.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// applyTaskFilter picks its predicate by viewport width; the status-filter
// composition test below exercises the MOBILE status control, so pin a mobile
// width (jsdom defaults to 1024 = desktop, where the phase pills govern instead).
const realInnerWidth = window.innerWidth;
function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

beforeEach(() => {
    document.body.innerHTML = '';
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    setWidth(800);
});

afterEach(() => {
    vi.restoreAllMocks();
    setWidth(realInnerWidth);
});


describe('prefs — getTaskSort / setTaskSort', () => {
    it('defaults to none when nothing is stored', () => {
        expect(getTaskSort()).toBe('none');
    });

    it('round-trips status and due', () => {
        setTaskSort('status');
        expect(getTaskSort()).toBe('status');
        setTaskSort('due');
        expect(getTaskSort()).toBe('due');
    });

    it('coerces an out-of-vocabulary value to none', () => {
        setTaskSort('garbage');
        expect(getTaskSort()).toBe('none');
        // A hand-edited junk value in storage also reads back as none.
        localStorage.setItem(TASK_SORT_KEY, 'sideways');
        expect(getTaskSort()).toBe('none');
    });

    it('is a mutex — selecting due after status leaves only due, no second key', () => {
        setTaskSort('status');
        setTaskSort('due');
        expect(getTaskSort()).toBe('due');
        // Exactly one sort key exists and it holds the latest choice.
        expect(localStorage.getItem(TASK_SORT_KEY)).toBe('due');
        const sortKeys = Object.keys(localStorage).filter(k => /sort/i.test(k));
        expect(sortKeys).toEqual([TASK_SORT_KEY]);
    });
});


describe('Sort composes with the status filter', () => {
    function makeMainList() {
        const ml = document.createElement('div');
        ml.id = 'mainList';
        document.body.appendChild(ml);
        return ml;
    }
    function makeRow(tit, status) {
        const row = document.createElement('div');
        row.id = 'toDoChild';
        row.__item = { tit: tit, status: status };
        row.setAttribute('data-value', 'Work');
        return row;
    }

    it('Status sort + IN PROGRESS filter keeps in_progress rows, hides active and ideas', () => {
        // Simulate the render path: status-sort the model, render rows in that
        // order, then apply the IN PROGRESS filter (as the handler does). With no
        // phase resolver registered here, IN PROGRESS matches manual status
        // in_progress only, so the two in-progress rows survive in sorted order.
        const items = [
            { tit: 'A', status: 'in_progress' },
            { tit: 'B', status: 'in_progress' },
            { tit: 'C', status: 'idea' },
            { tit: 'D', status: 'active' },
        ];
        const ordered = sortItemsByStatusForRender(items);

        const ml = makeMainList();
        // The bar must be in the DOM so applyTaskFilter can update its counts.
        document.body.appendChild(buildTaskFilterBar());
        ordered.forEach(it => ml.appendChild(makeRow(it.tit, it.status)));

        setPhaseFilter('inprogress');
        applyTaskFilter();

        const rows = Array.from(ml.querySelectorAll('#toDoChild'));
        const visible = rows.filter(r => !r.classList.contains('taskFilterHidden'));
        // Both in_progress rows survive, in the status-sorted order.
        expect(visible.map(r => r.__item.tit)).toEqual(['A', 'B']);

        // The idea and plain-active rows are hidden by the filter's class.
        expect(rows.find(r => r.__item.tit === 'C').classList.contains('taskFilterHidden')).toBe(true);
        expect(rows.find(r => r.__item.tit === 'D').classList.contains('taskFilterHidden')).toBe(true);
    });
});


describe('controls band — Expand All retired, Sort dropdown wired', () => {
    const main = read('main.js');

    it('no longer creates the Expand All band button (#bulkDescToggle)', () => {
        expect(main).not.toMatch(/id\s*=\s*['"]bulkDescToggle['"]/);
        expect(main).not.toContain("bulkDescLabel.textContent = 'Expand All'");
        // The old per-project "Sort by due" checkbox is gone too.
        expect(main).not.toMatch(/id\s*=\s*['"]sortByDueCheckbox['"]/);
    });

    it('builds the Sort dropdown trigger and menu', () => {
        expect(main).toMatch(/id\s*=\s*['"]taskSortBtn['"]/);
        // The menu markup (show/hideTaskSortMenu et al.) was extracted into
        // taskSort.js — a behaviour-preserving move — while the trigger and the
        // setTaskSort pref write stay in main.js.
        const taskSortModule = read('taskSort.js');
        expect(taskSortModule).toMatch(/id\s*=\s*['"]taskSortMenu['"]/);
        expect(main).toMatch(/createTaskSort\(/);
        // The dropdown persists the choice via the global pref.
        expect(main).toMatch(/setTaskSort\(/);
    });

    it('keeps the bulk-description action reachable via the shared toggle', () => {
        // The expand/collapse behaviour survives the button removal through the
        // module-scoped toggleBulkDescriptions() that Ctrl+Enter and the mobile
        // drawer toggle both call.
        expect(main).toMatch(/function toggleBulkDescriptions\(/);
        expect(main).toMatch(/function isBulkDescExpanded\(/);
    });
});


describe('taskSort.js — extracted sort-surface controller', () => {
    const main = read('main.js');
    const taskSortModule = read('taskSort.js');

    it('exports the createTaskSort factory holding the five sort functions', () => {
        expect(taskSortModule).toMatch(/export function createTaskSort\(/);
        ['syncTaskSortButton', 'hideTaskSortMenu', 'showTaskSortMenu',
         'hideTaskSortSheet', 'showTaskSortSheet'].forEach(function(name) {
            expect(taskSortModule).toMatch(new RegExp('function ' + name + '\\('));
        });
    });

    it('main.js no longer defines the moved functions inline', () => {
        // A future re-inline would reintroduce the giant sort block into main.js;
        // these guards keep the single owner in taskSort.js.
        ['syncTaskSortButton', 'hideTaskSortMenu', 'showTaskSortMenu',
         'hideTaskSortSheet', 'showTaskSortSheet'].forEach(function(name) {
            expect(main).not.toMatch(new RegExp('function ' + name + '\\('));
        });
    });

    it('main.js imports and instantiates the factory, wiring the callbacks back in', () => {
        expect(main).toMatch(/import \{ createTaskSort \} from '\.\/taskSort\.js'/);
        expect(main).toMatch(/applyTaskSortChoice,/);
        expect(main).toMatch(/onTaskSortOutsideClick,/);
    });
});
