import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import { initInjectConfig, refreshShippedMarkers } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

// Regression: the Runs tab sorts every record newest-first by `dispatchedAt`, and
// for a marker-derived shipped record that field is `parseIsoMs(item.shippedAt)`.
// `shippedAt` used to be stamped ONLY by the agent-queue settle path, so an entry
// shipped via the TODO.md viewer's "Run backlog" button or an entry's own "Run
// this entry" pill — neither of which creates an `agent_queue` row — never got a
// timestamp, resolved to 0, and pinned itself to the bottom of the Runs list no
// matter how recently it shipped. Observing the entry's marker on a `[x]` TODO.md
// entry is the only signal those ships produce, so the marker refresh now stamps
// on first observation. These tests pin that: the stamp fires from the marker
// refresh alone (no queue row anywhere), it is idempotent across refreshes, an
// unchecked entry is never stamped, and an unresolvable marker is retried rather
// than swallowed.

// A unique repo per refresh keeps the module-level per-repo marker cache from
// letting one test's read fall inside another's 60s TTL.
let repoSeq = 0;
function freshTarget() {
    repoSeq += 1;
    return { repo: 'me/StampRepo-' + repoSeq, file_path: 'TODO.md' };
}

function mockTodoMd(content) {
    globalThis.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: content }),
    }));
}

// Add a todo to `project` carrying `entryId` and return it.
function seedTodoWithEntry(project, title, entryId) {
    listLogic.addToDo(project, title);
    const items = listLogic.listItems(project);
    const item = items[items.length - 1];
    item.entryId = entryId;
    return item;
}

let realFetch;

beforeEach(() => {
    localStorage.clear();
    listLogic._reset();
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();
    realFetch = globalThis.fetch;
    listLogic.addProject('ProjA');
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    listLogic._reset();
});

describe('shippedAt stamped from the TODO.md shipped-marker set', () => {
    it('stamps a todo whose entry is observed shipped with no agent_queue row involved', async () => {
        const item = seedTodoWithEntry('ProjA', 'Shipped via Run backlog', 'e-stamp-1');
        expect(item.shippedAt).toBeFalsy();

        mockTodoMd([
            '# TODO LIST',
            '- [x] Shipped via Run backlog',
            '  - Type: bug',
            '  <!-- id: e-stamp-1 -->',
        ].join('\n'));
        await refreshShippedMarkers(freshTarget(), true);

        expect(typeof item.shippedAt).toBe('string');
        expect(Number.isFinite(Date.parse(item.shippedAt))).toBe(true);
    });

    it('leaves an UNCHECKED entry unstamped — presence is not a ship', async () => {
        const item = seedTodoWithEntry('ProjA', 'Injected but still running', 'e-stamp-pending');

        mockTodoMd([
            '- [ ] Injected but still running',
            '  <!-- id: e-stamp-pending -->',
        ].join('\n'));
        await refreshShippedMarkers(freshTarget(), true);

        expect(item.shippedAt).toBeFalsy();
    });

    it('is idempotent — a later refresh never overwrites the first ship time', async () => {
        const item = seedTodoWithEntry('ProjA', 'Shipped once', 'e-stamp-2');
        const md = [
            '- [x] Shipped once',
            '  <!-- id: e-stamp-2 -->',
        ].join('\n');

        mockTodoMd(md);
        await refreshShippedMarkers(freshTarget(), true);
        const first = item.shippedAt;
        expect(first).toBeTruthy();

        mockTodoMd(md);
        await refreshShippedMarkers(freshTarget(), true);
        expect(item.shippedAt).toBe(first);
    });

    it('preserves an existing shippedAt rather than restamping it to now', async () => {
        const item = seedTodoWithEntry('ProjA', 'Shipped long ago', 'e-stamp-3');
        item.shippedAt = '2026-07-01T10:00:00.000Z';

        mockTodoMd([
            '- [x] Shipped long ago',
            '  <!-- id: e-stamp-3 -->',
        ].join('\n'));
        await refreshShippedMarkers(freshTarget(), true);

        expect(item.shippedAt).toBe('2026-07-01T10:00:00.000Z');
    });

    it('retries a marker that resolved to no todo yet — the stamp is a repairable invariant', async () => {
        // First read lands before the todo exists (the hydration-ordering case):
        // nothing to stamp, and the id must NOT be recorded as done.
        const md = [
            '- [x] Todo arrives later',
            '  <!-- id: e-stamp-late -->',
        ].join('\n');
        mockTodoMd(md);
        await refreshShippedMarkers(freshTarget(), true);

        // The todo shows up, and the next refresh repairs the missing stamp.
        const item = seedTodoWithEntry('ProjA', 'Todo arrives later', 'e-stamp-late');
        expect(item.shippedAt).toBeFalsy();
        mockTodoMd(md);
        await refreshShippedMarkers(freshTarget(), true);

        expect(item.shippedAt).toBeTruthy();
    });

    it('never throws when a shipped marker belongs to no todo at all', async () => {
        mockTodoMd([
            '- [x] Another project\'s entry',
            '  <!-- id: e-stamp-orphan -->',
        ].join('\n'));
        await expect(refreshShippedMarkers(freshTarget(), true)).resolves.toBeUndefined();
    });

    it('does not stamp when the TODO.md read fails', async () => {
        const item = seedTodoWithEntry('ProjA', 'Read fails', 'e-stamp-4');
        globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
        await refreshShippedMarkers(freshTarget(), true);
        expect(item.shippedAt).toBeFalsy();
    });
});

describe('listLogic.stampEntryShippedByEntryId', () => {
    it('resolves the marker id to its todo and stamps it', () => {
        const item = seedTodoWithEntry('ProjA', 'By entry id', 'e-direct-1');
        const res = listLogic.stampEntryShippedByEntryId('e-direct-1');
        expect(res.ok).toBe(true);
        expect(item.shippedAt).toBeTruthy();
    });

    it('reports alreadyStamped without changing the stored time', () => {
        const item = seedTodoWithEntry('ProjA', 'Already stamped', 'e-direct-2');
        item.shippedAt = '2026-06-15T08:30:00.000Z';
        const res = listLogic.stampEntryShippedByEntryId('e-direct-2');
        expect(res).toEqual({ ok: true, alreadyStamped: true });
        expect(item.shippedAt).toBe('2026-06-15T08:30:00.000Z');
    });

    it('reports not-found for a missing or unresolvable entry id', () => {
        expect(listLogic.stampEntryShippedByEntryId('').ok).toBe(false);
        expect(listLogic.stampEntryShippedByEntryId(null).ok).toBe(false);
        expect(listLogic.stampEntryShippedByEntryId('no-such-entry').ok).toBe(false);
    });
});
