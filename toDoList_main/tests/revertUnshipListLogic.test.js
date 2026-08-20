import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { listLogic } from '../src/listLogic.js';

// The data-model half of a hard rollback: the writers unshipEntry drives when a
// revert PR merges. `clearEntryShipped` is the inverse of `stampEntryShipped` and
// `removeToDoById` is the id-keyed removal a revert needs (it has only the id it
// resolved from a TODO.md marker, never a project).
//
// The Supabase mirror is source-pinned rather than exercised, because
// persistMutation is gated on a real session — and that boundary is exactly where
// a clear can silently no-op: `toTodoRowPayload` emits `shipped_at: null` for a
// cleared todo, and the update branch forwards that column ONLY when truthy, so
// without the explicit `clear_columns` channel the null is dropped, the server
// keeps the old timestamp, and the next hydrate re-stamps the todo. Local state
// would look right the whole time.

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(here, '../src/listLogic.js'), 'utf8');

function seedShippedTodo(project, title) {
    listLogic.addToDo(project, title);
    const items = listLogic.listItems(project);
    const item = items[items.length - 1];
    listLogic.stampEntryShipped(item.id);
    listLogic.markEntryReviewed(item.id);
    return item;
}

beforeEach(() => {
    localStorage.clear();
    listLogic._reset();
    listLogic.addProject('ProjA');
    listLogic.addProject('ProjB');
});

afterEach(() => {
    localStorage.clear();
    listLogic._reset();
});

describe('listLogic.clearEntryShipped', () => {
    it('clears the ship stamp and the acknowledgement a revert invalidates', () => {
        const item = seedShippedTodo('ProjA', 'Shipped thing');
        expect(item.shippedAt).toBeTruthy();
        expect(item.entryReviewedAt).toBeTruthy();

        const res = listLogic.clearEntryShipped(item.id);

        expect(res.ok).toBe(true);
        expect(item.shippedAt).toBeNull();
        expect(item.entryReviewedAt).toBeNull();
    });

    it('persists the clear, so it survives a reload rather than living in memory', () => {
        const item = seedShippedTodo('ProjA', 'Shipped thing');
        expect(JSON.parse(localStorage.getItem('allProjects')).ProjA.items
            .find((i) => i.id === item.id).shippedAt).toBeTruthy();

        listLogic.clearEntryShipped(item.id);

        // The local store is what a reload reads back, so the cleared value has
        // to be in there and not just on the live object.
        const stored = JSON.parse(localStorage.getItem('allProjects'))
            .ProjA.items.find((i) => i.id === item.id);
        expect(stored.shippedAt).toBeFalsy();
        expect(stored.entryReviewedAt).toBeFalsy();
    });

    it('is a no-op on an unstamped todo and reports a missing id honestly', () => {
        listLogic.addToDo('ProjA', 'Never shipped');
        const items = listLogic.listItems('ProjA');
        const fresh = items[items.length - 1];

        expect(listLogic.clearEntryShipped(fresh.id)).toEqual({ ok: true, alreadyClear: true });
        expect(listLogic.clearEntryShipped('no-such-id').ok).toBe(false);
        expect(listLogic.clearEntryShipped().ok).toBe(false);
    });

    it('re-stamps cleanly, so a re-accepted proposal ships again', () => {
        const item = seedShippedTodo('ProjA', 'Shipped thing');
        listLogic.clearEntryShipped(item.id);
        // stampEntryShipped is idempotent — it skips an already-stamped todo — so
        // a clear that left the stamp in place would block the re-ship.
        const res = listLogic.stampEntryShipped(item.id);
        expect(res).toEqual({ ok: true });
        expect(item.shippedAt).toBeTruthy();
    });

    it('sends the null through the explicit clear channel the sync layer honours', () => {
        // The regression guard: a plain payload would carry `shipped_at: null`
        // and be dropped by the forward-only-when-set rule.
        expect(SRC).toMatch(/payload\.clear_columns = \['shipped_at', 'entry_reviewed_at'\]/);
        expect(SRC).toMatch(/const CLEARABLE_TODO_COLUMNS = \[/);
        const updateBranch = SRC.slice(SRC.lastIndexOf('if (payload.shipped_at) row.shipped_at'));
        expect(updateBranch).toMatch(/payload\.clear_columns/);
        expect(updateBranch).toMatch(/CLEARABLE_TODO_COLUMNS\.indexOf\(col\) !== -1\) row\[col\] = null/);
    });
});

describe('listLogic.removeToDoById', () => {
    it('removes the todo from whichever project holds it', () => {
        listLogic.addToDo('ProjA', 'Keep me');
        listLogic.addToDo('ProjB', 'Drop me');
        const target = listLogic.listItems('ProjB').find((i) => i.tit === 'Drop me');

        const res = listLogic.removeToDoById(target.id);

        expect(res).toEqual({ ok: true, project: 'ProjB' });
        expect(listLogic.listItems('ProjB').some((i) => i.tit === 'Drop me')).toBe(false);
        expect(listLogic.listItems('ProjA').some((i) => i.tit === 'Keep me')).toBe(true);
    });

    it('reports an unknown or missing id rather than removing something else', () => {
        listLogic.addToDo('ProjA', 'Keep me');
        expect(listLogic.removeToDoById('no-such-id').ok).toBe(false);
        expect(listLogic.removeToDoById().ok).toBe(false);
        expect(listLogic.listItems('ProjA').some((i) => i.tit === 'Keep me')).toBe(true);
    });
});

describe('listLogic.setAgentRunState', () => {
    it('accepts the thread key, so the rollback note can ride the same patch', () => {
        // The queue-row patch a returned-to-proposals revert writes carries a
        // thread line; an allow-list that omitted `thread` would drop it silently.
        // Anchored on the 'todo_id', 'thread' pair rather than on the end of the
        // array, so a later key (the per-run model stamp) can join the list
        // without this pin reading as a regression.
        expect(SRC).toMatch(
            /const allowed = \[[^\]]*'todo_id', 'thread'[^\]]*\]/
        );
    });
});
