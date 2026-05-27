import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { listLogic } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression guard for the Today-dashboard checkbox completion bug.
//
// `handleTodayCheckboxToggle` used to mutate `item.completed` directly
// and lean on the follow-up `listLogic.sortCompletedToBottom(project)`
// to flush the change to localStorage. That sort short-circuits when
// the partition order is already canonical — e.g. checking the last
// open task in its project from the Today view leaves the array
// position-for-position the same. The mutation then survived only in
// memory and the row came back unchecked on refresh, the same failure
// mode the swipe-right completion path already had to fix.
//
// The fix routes the toggle through `listLogic.setToDoCompleted`, whose
// localStorage write is unconditional and whose Supabase mirror
// matches the title-edit path. The tests below pin both the source
// shape and the runtime behavior so the regression can't return
// silently.

describe('Today dashboard checkbox toggle — routes through listLogic.setToDoCompleted', () => {
    const main = read('main.js');

    function handleTodayCheckboxToggleBody() {
        const start = main.indexOf('function handleTodayCheckboxToggle(');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = -1;
        for (let i = main.indexOf('{', start); i < main.length; i++) {
            const c = main[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        expect(end).toBeGreaterThan(start);
        return main.slice(start, end);
    }

    it('calls listLogic.setToDoCompleted(project, item, checkbox.checked) in the standard completion path', () => {
        const body = handleTodayCheckboxToggleBody();
        expect(body).toMatch(
            /listLogic\.setToDoCompleted\(\s*project\s*,\s*item\s*,\s*checkbox\.checked\s*\)/
        );
    });

    it('does NOT mutate item.completed directly any more', () => {
        // The direct assignment is the exact pattern the bug hung off
        // of — it survives in memory but the follow-up sort-based
        // persist can no-op, leaving localStorage stale. Pin the line
        // out of the handler so it can't sneak back.
        const body = handleTodayCheckboxToggleBody();
        expect(body).not.toMatch(/item\.completed\s*=\s*checkbox\.checked/);
    });

    it('still partitions completed items to the bottom after the toggle persists', () => {
        // setToDoCompleted only writes the completed flag; the visual
        // partition is still the sortCompletedToBottom call's job, so
        // the row slides to its new slot on the same tick as before.
        const body = handleTodayCheckboxToggleBody();
        expect(body).toMatch(/listLogic\.sortCompletedToBottom\(\s*project\s*\)/);
    });
});


describe('Today dashboard checkbox toggle — persists when sortCompletedToBottom is a no-op', () => {
    // Reproduces the exact Today-view failure mode: toggling the last
    // open task to completed leaves the partition order unchanged, so
    // the follow-up sortCompletedToBottom early-exits without writing.
    // The completion must persist on its own via setToDoCompleted.

    it('serializes the new completed value to localStorage even with a no-op sort', () => {
        listLogic._reset();
        listLogic.addProject('Work');
        listLogic.addToDo('Work', 'A');
        listLogic.addToDo('Work', 'B');
        const itemB = listLogic.listItems('Work').find(i => i.tit === 'B');

        // The handler's two persistence-relevant calls, in order. With
        // only 'A' and 'B' open and no completed items, flipping B to
        // completed leaves the array unchanged (no completed entries
        // ahead of any open ones), so sortCompletedToBottom does not
        // need to reshuffle — the regression is that this also means it
        // skipped writing.
        listLogic.setToDoCompleted('Work', itemB, true);
        listLogic.sortCompletedToBottom('Work');

        const raw = localStorage.getItem('allProjects');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw);
        const persistedB = parsed.Work.items.find(i => i.tit === 'B');
        expect(persistedB).toBeDefined();
        expect(persistedB.completed).toBe(true);
    });
});
