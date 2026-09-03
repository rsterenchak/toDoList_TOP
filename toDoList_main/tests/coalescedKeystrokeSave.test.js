import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { listLogic } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression for: typing a todo title or description ran a FULL-app
// JSON.stringify per keystroke. saveToStorage serializes every project's
// items — not just the one being typed into — so the cost of a single
// keypress scaled with total app state and showed up as input lag on
// accounts with several populated projects. The keystroke handlers now
// route through listLogic.saveToStorageSoon, which coalesces a burst of
// keypresses into one trailing write.
describe('coalesced keystroke persistence — listLogic.saveToStorageSoon', () => {

    let setItemSpy;

    beforeEach(() => {
        listLogic._reset();
        vi.useFakeTimers();
        setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    });

    afterEach(() => {
        setItemSpy.mockRestore();
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        listLogic._reset();
    });

    function projectWrites() {
        return setItemSpy.mock.calls.filter(function(call) {
            return call[0] === 'allProjects';
        }).length;
    }

    it('exposes saveToStorageSoon and flushPendingSave alongside saveToStorage', () => {
        expect(typeof listLogic.saveToStorageSoon).toBe('function');
        expect(typeof listLogic.flushPendingSave).toBe('function');
        expect(typeof listLogic.saveToStorage).toBe('function');
    });

    it('collapses a burst of keystroke saves into a single localStorage write', () => {
        // Ten keypresses in one typing burst — the pre-fix path ran ten
        // whole-app stringify + setItem round-trips.
        for (let i = 0; i < 10; i++) listLogic.saveToStorageSoon();
        expect(projectWrites()).toBe(0);   // nothing written yet — still coalescing

        vi.advanceTimersByTime(500);
        expect(projectWrites()).toBe(1);
    });

    it('does eventually persist the coalesced edit', () => {
        listLogic.addProject('Groceries');
        setItemSpy.mockClear();

        listLogic.addToDo('Groceries', 'Milk');
        const items = listLogic.listItems('Groceries');
        const target = items.find(function(i) { return i.tit === 'Milk'; });
        setItemSpy.mockClear();

        // Simulate the keyup handler: mutate the model synchronously, defer
        // only the write.
        target.tit = 'Milk and eggs';
        listLogic.saveToStorageSoon();
        vi.advanceTimersByTime(500);

        const parsed = JSON.parse(localStorage.getItem('allProjects'));
        const titles = parsed.Groceries.items.map(function(i) { return i.tit; });
        expect(titles).toContain('Milk and eggs');
    });

    it('leaves the in-memory model readable immediately — only the write is deferred', () => {
        listLogic.addProject('Groceries');
        listLogic.addToDo('Groceries', 'Milk');
        const target = listLogic.listItems('Groceries').find(function(i) { return i.tit === 'Milk'; });

        target.tit = 'Milk and eggs';
        listLogic.saveToStorageSoon();

        // No timer advance — the model must already reflect the edit, which is
        // what every in-app reader (render paths, inject, filters) relies on.
        const titles = listLogic.listItems('Groceries').map(function(i) { return i.tit; });
        expect(titles).toContain('Milk and eggs');
    });

    it('a synchronous saveToStorage supersedes the pending write instead of doubling it', () => {
        // Every save serializes the whole allProjects object, so the direct
        // write already covers whatever the pending one held. If the timer
        // were left armed it would fire a redundant second full stringify.
        listLogic.saveToStorageSoon();
        setItemSpy.mockClear();

        listLogic.saveToStorage();
        expect(projectWrites()).toBe(1);

        vi.advanceTimersByTime(500);
        expect(projectWrites()).toBe(1);
    });

    it('flushPendingSave writes a pending edit out immediately', () => {
        listLogic.saveToStorageSoon();
        setItemSpy.mockClear();

        listLogic.flushPendingSave();
        expect(projectWrites()).toBe(1);

        // And the flushed timer is disarmed, so it can't write a second time.
        vi.advanceTimersByTime(500);
        expect(projectWrites()).toBe(1);
    });

    it('flushPendingSave is a no-op when nothing is pending', () => {
        setItemSpy.mockClear();
        listLogic.flushPendingSave();
        expect(projectWrites()).toBe(0);
    });

    it('a later burst schedules a fresh write rather than being swallowed', () => {
        // Bounded staleness: the window is not extended by later keypresses,
        // so a continuous typist keeps getting writes instead of starving.
        listLogic.saveToStorageSoon();
        vi.advanceTimersByTime(500);
        expect(projectWrites()).toBe(1);

        listLogic.saveToStorageSoon();
        vi.advanceTimersByTime(500);
        expect(projectWrites()).toBe(2);
    });
});


describe('coalesced keystroke persistence — source wiring', () => {
    const toDoRow = read('toDoRow.js');
    const listLogicSrc = read('listLogic.js');

    function extractRange(src, startNeedle, endNeedle) {
        const startIdx = src.indexOf(startNeedle);
        expect(startIdx).toBeGreaterThan(-1);
        const endIdx = src.indexOf(endNeedle, startIdx + startNeedle.length);
        expect(endIdx).toBeGreaterThan(-1);
        return src.slice(startIdx, endIdx);
    }

    it('the title keyup handler persists through saveToStorageSoon, not saveToStorage', () => {
        const keyup = extractRange(toDoRow, '// toDoInput keyup', '// snap-back');
        expect(keyup).toMatch(/listLogic\.saveToStorageSoon\s*\(\s*\)/);
        expect(keyup).not.toMatch(/listLogic\.saveToStorage\s*\(/);
    });

    it('the description keyup handler persists through saveToStorageSoon, not saveToStorage', () => {
        const keyup = extractRange(toDoRow, '// descInput keyup', '// descInput blur');
        expect(keyup).toMatch(/listLogic\.saveToStorageSoon\s*\(\s*\)/);
        expect(keyup).not.toMatch(/listLogic\.saveToStorage\s*\(/);
    });

    it('the description blur handler still writes synchronously so an exit path never coalesces', () => {
        // blur is the persistence boundary every exit route (Escape, Ctrl+Enter,
        // click-away, project switch) funnels through — it must not defer.
        const blur = extractRange(toDoRow, '// descInput blur', '// Escape on the description');
        expect(blur).toMatch(/listLogic\.saveToStorage\s*\(\s*\)/);
        expect(blur).not.toMatch(/saveToStorageSoon/);
    });

    it('the title Enter-commit handler still writes synchronously', () => {
        const enter = extractRange(toDoRow, 'toDoInput keydown — Enter to commit title', '// toDoInput keyup');
        expect(enter).toMatch(/listLogic\.saveToStorage\s*\(\s*\)/);
        expect(enter).not.toMatch(/saveToStorageSoon/);
    });

    it('saveToStorage cancels the coalesced timer so the two paths can not double-write', () => {
        const startIdx = listLogicSrc.indexOf('function saveToStorage(_opts)');
        expect(startIdx).toBeGreaterThan(-1);
        const body = listLogicSrc.slice(startIdx, listLogicSrc.indexOf('}', listLogicSrc.indexOf('CustomEvent unsupported')));
        const cancelIdx = body.indexOf('cancelCoalescedSave()');
        const writeIdx = body.indexOf('localStorage.setItem');
        expect(cancelIdx).toBeGreaterThan(-1);
        expect(writeIdx).toBeGreaterThan(-1);
        expect(cancelIdx).toBeLessThan(writeIdx);
    });

    it('a pending write is flushed before the page can go away', () => {
        // Without this, a title typed and then immediately backgrounded or
        // closed is lost inside the coalescing window — the exact data-loss
        // risk deferring the write introduces.
        expect(listLogicSrc).toMatch(/addEventListener\(\s*['"]pagehide['"]\s*,\s*flushPendingSave\s*\)/);
        expect(listLogicSrc).toMatch(/addEventListener\(\s*['"]visibilitychange['"]/);
        const visIdx = listLogicSrc.indexOf("'visibilitychange'");
        const block = listLogicSrc.slice(visIdx, visIdx + 300);
        expect(block).toMatch(/visibilityState\s*===\s*['"]hidden['"]/);
        expect(block).toMatch(/flushPendingSave\s*\(\s*\)/);
    });

    it('_reset drops a pending write so a cleared store can not be re-seeded by a stale timer', () => {
        const startIdx = listLogicSrc.indexOf('function _reset()');
        expect(startIdx).toBeGreaterThan(-1);
        const body = listLogicSrc.slice(startIdx, startIdx + 600);
        const cancelIdx = body.indexOf('cancelCoalescedSave()');
        const clearIdx = body.indexOf('localStorage.clear()');
        expect(cancelIdx).toBeGreaterThan(-1);
        expect(clearIdx).toBeGreaterThan(-1);
        expect(cancelIdx).toBeLessThan(clearIdx);
    });
});
