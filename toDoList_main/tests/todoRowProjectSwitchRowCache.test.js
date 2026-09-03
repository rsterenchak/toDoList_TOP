import { describe, it, expect, beforeEach } from 'vitest';

import { addAllToDo_DOM, addToDos_restore } from '../src/toDoRow.js';
import { listLogic } from '../src/listLogic.js';

// Switching projects used to rebuild every row from scratch: the render path
// called buildToDoRow (an ~850-line factory wiring dozens of listeners and
// sub-panels per row) once per item on EVERY switch, even when returning to a
// project whose rows were built earlier in the session — so the cost scaled
// with the project's todo count and repeated on every tap. Rows are now cached
// per project and re-appended, which preserves their listeners.
//
// These tests assert on ROW ELEMENT IDENTITY, because that is the only thing
// that distinguishes "reused" from "rebuilt": a rebuilt row renders identically,
// so a markup assertion would pass either way and the optimisation could ship
// as a silent no-op.

let list;
let seq = 0;

function mountList() {
    document.body.innerHTML = '';
    list = document.createElement('div');
    list.id = 'mainList';
    document.body.appendChild(list);
}

function clearList() {
    while (list.firstChild) list.removeChild(list.firstChild);
}

// A fresh project name per test keeps the module-level listLogic singleton and
// the row cache from leaking state across cases.
function makeProject(titles) {
    const name = 'cacheProj' + (++seq);
    listLogic.addProject(name);
    titles.forEach(function(t) { listLogic.addToDo(name, t); });
    return name;
}

// Render `name` the way the app does on a project switch: clear #mainList, then
// re-render. Returns the rendered rows keyed by their data-model item.
function renderProject(name) {
    clearList();
    addAllToDo_DOM(listLogic.listItems(name), name);
    const byItem = new Map();
    list.querySelectorAll('#toDoChild').forEach(function(row) {
        byItem.set(row.__item, row);
    });
    return byItem;
}

beforeEach(() => {
    mountList();
});

describe('project-switch row cache', () => {
    it('re-appends the same row elements when a project is re-rendered unchanged', () => {
        const name = makeProject(['alpha', 'beta', 'gamma']);
        const first = renderProject(name);
        const committed = listLogic.listItems(name).filter(function(i) { return i.tit; });
        expect(committed.length).toBe(3);

        const second = renderProject(name);
        committed.forEach(function(item) {
            expect(second.get(item)).toBe(first.get(item));
        });
    });

    it('keeps listeners alive across the switch (the node itself is reused)', () => {
        const name = makeProject(['alpha']);
        const first = renderProject(name);
        const item = listLogic.listItems(name).find(function(i) { return i.tit === 'alpha'; });

        let fired = 0;
        first.get(item).addEventListener('cacheprobe', function() { fired++; });

        const second = renderProject(name);
        second.get(item).dispatchEvent(new Event('cacheprobe'));
        expect(fired).toBe(1);
    });

    it('rebuilds only the row whose item changed, reusing its siblings', () => {
        const name = makeProject(['alpha', 'beta', 'gamma']);
        const first = renderProject(name);
        const items = listLogic.listItems(name);
        const edited = items.find(function(i) { return i.tit === 'beta'; });
        edited.tit = 'beta edited';

        const second = renderProject(name);
        expect(second.get(edited)).not.toBe(first.get(edited));
        items.filter(function(i) { return i !== edited && i.tit; }).forEach(function(item) {
            expect(second.get(item)).toBe(first.get(item));
        });
    });

    it('rebuilds a row when its item is completed', () => {
        const name = makeProject(['alpha', 'beta']);
        const first = renderProject(name);
        const done = listLogic.listItems(name).find(function(i) { return i.tit === 'alpha'; });
        done.completed = true;

        const second = renderProject(name);
        expect(second.get(done)).not.toBe(first.get(done));
    });

    it('always rebuilds the blank placeholder so uncommitted typing is discarded', () => {
        const name = makeProject(['alpha']);
        listLogic.addToDo(name, '');
        const first = renderProject(name);
        const blank = listLogic.listItems(name).find(function(i) { return i.tit === ''; });
        expect(first.get(blank)).toBeTruthy();

        const second = renderProject(name);
        expect(second.get(blank)).not.toBe(first.get(blank));
    });

    it('rebuilds every row when the project hideDates preference is toggled', () => {
        const name = makeProject(['alpha', 'beta']);
        const first = renderProject(name);
        listLogic.setProjectHideDates(name, !listLogic.getProjectHideDates(name));

        const second = renderProject(name);
        listLogic.listItems(name).filter(function(i) { return i.tit; }).forEach(function(item) {
            expect(second.get(item)).not.toBe(first.get(item));
        });
    });

    it('drops the cached row of a deleted item and reuses the survivors', () => {
        const name = makeProject(['alpha', 'beta']);
        const first = renderProject(name);
        const items = listLogic.listItems(name);
        const doomed = items.find(function(i) { return i.tit === 'alpha'; });
        const kept = items.find(function(i) { return i.tit === 'beta'; });
        listLogic.removeToDoByItem(name, doomed);

        const second = renderProject(name);
        expect(second.has(doomed)).toBe(false);
        expect(second.get(kept)).toBe(first.get(kept));
    });

    it('never hands one project a row built for another', () => {
        const a = makeProject(['alpha']);
        const b = makeProject(['alpha']);
        const rowsA = renderProject(a);
        const rowsB = renderProject(b);
        const nodesA = Array.from(rowsA.values());
        Array.from(rowsB.values()).forEach(function(row) {
            expect(nodesA).not.toContain(row);
        });
    });

    it('clears the transient todo-active marker on a reused row', () => {
        const name = makeProject(['alpha']);
        const first = renderProject(name);
        const item = listLogic.listItems(name).find(function(i) { return i.tit === 'alpha'; });
        first.get(item).classList.add('todo-active');

        const second = renderProject(name);
        expect(second.get(item)).toBe(first.get(item));
        expect(second.get(item).classList.contains('todo-active')).toBe(false);
    });

    it('reuses rows on the addToDos_restore render path too', () => {
        const name = makeProject(['alpha', 'beta']);
        clearList();
        addToDos_restore(listLogic.listItems(name), name);
        const first = new Map();
        list.querySelectorAll('#toDoChild').forEach(function(r) { first.set(r.__item, r); });

        clearList();
        addToDos_restore(listLogic.listItems(name), name);
        const second = new Map();
        list.querySelectorAll('#toDoChild').forEach(function(r) { second.set(r.__item, r); });

        expect(second.size).toBe(first.size);
        first.forEach(function(row, item) {
            if (!item.tit) return; // blank placeholder is never cached
            expect(second.get(item)).toBe(row);
        });
    });

    it('evicts the least recently rendered project once the cache cap is passed', () => {
        const name = makeProject(['alpha']);
        const first = renderProject(name);
        const item = listLogic.listItems(name).find(function(i) { return i.tit === 'alpha'; });

        // The cap is 8 projects; rendering 8 others pushes this one out.
        for (let i = 0; i < 8; i++) {
            renderProject(makeProject(['filler']));
        }

        const second = renderProject(name);
        expect(second.get(item)).not.toBe(first.get(item));
    });
});
