import { describe, it, expect } from 'vitest';
import { listLogic } from '../src/listLogic.js';

// Regression guard for the checkbox completion persistence bug.
//
// A completion toggle used to mutate `item.completed` directly and lean
// on the follow-up `listLogic.sortCompletedToBottom(project)` to flush
// the change to localStorage. That sort short-circuits when the
// partition order is already canonical — e.g. checking the last open
// task in its project leaves the array position-for-position the same.
// The mutation then survived only in memory and the row came back
// unchecked on refresh, the same failure mode the swipe-right
// completion path already had to fix.
//
// The fix routes the toggle through `listLogic.setToDoCompleted`, whose
// localStorage write is unconditional. The test below pins the runtime
// behavior so the regression can't return silently.

describe('checkbox toggle — persists when sortCompletedToBottom is a no-op', () => {
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
