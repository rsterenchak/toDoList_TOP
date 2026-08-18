import { vi, describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// A merged revert PR rolls back the CODE and nothing else, so before unshipEntry
// the entry stayed `- [x]` with its Completed stamp, its todo stayed
// `shipped_at`-stamped, and its `agent_queue` row stayed `shipped` — which derive
// reads as coverage, so a reverted aspect was never re-proposed and a bad accept
// had no way back. These tests pin the inverse-of-accept step: what it does for a
// derive-born proposal, what it does for a hand-injected entry, that it moves
// NOTHING unless the revert actually merged, and that all three Revert surfaces
// call the one shared function rather than growing their own copies.

let rewriteCalls = [];
let readResult = { ok: true, content: '', sha: 'sha-1' };
let writeCalls = [];
let removedTodos = [];
let clearedTodos = [];
let runStateCalls = [];
let queueRow = null;

vi.mock('../src/inject.js', () => ({
    findTargetById: () => null,
    mintEntryId: () => 'minted',
    embedEntryMarker: (text) => text,
    rewriteTodoMd: (target, op, id) => {
        rewriteCalls.push({ target, op, id });
        return Promise.resolve({ ok: true });
    },
    readTodoMdFromWorker: () => Promise.resolve(readResult),
    writeTodoMdToWorker: (target, content, sha) => {
        writeCalls.push({ target, content, sha });
        return Promise.resolve({ ok: true, sha: 'sha-2' });
    },
}));

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: () => Promise.resolve({ ok: true }),
}));

vi.mock('../src/agentQueueStore.js', () => ({
    kickDispatchReconciler: () => {},
    getQueueRowForEntry: () => queueRow,
}));

vi.mock('../src/runState.js', () => ({
    activeProjectNameForViewer: () => '',
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectTargetId: () => null,
        getEntryReviewInfo: (entryId) => (
            entryId === 'ent-hand'
                ? { found: true, todoId: 'todo-hand', reviewed: false }
                : { found: false }
        ),
        removeToDoById: (id) => { removedTodos.push(id); return { ok: true }; },
        clearEntryShipped: (id) => { clearedTodos.push(id); return { ok: true }; },
        setAgentRunState: (id, patch) => {
            runStateCalls.push({ id, patch });
            return Promise.resolve({ ok: true });
        },
    },
}));

import { unshipEntry, revertConfirmMessage, revertToastMessage } from '../src/dispatchDraft.js';
import { reopenTaskLine, reopenEntryInMarkdown } from '../src/entryParse.js';

const TARGET = { repo: 'owner/repo', file_path: 'TODO.md' };

const SHIPPED_MD = [
    '# TODO List',
    '',
    '- [x] **[MEDIUM]** Reopen me — Completed: 2026-08-18 (PR #12)',
    '  - Type: feature',
    '  - Description: something',
    '  <!-- id: ent-hand -->',
    '',
    '- [ ] **[HIGH]** Untouched',
    '  <!-- id: ent-other -->',
    '',
].join('\n');

beforeEach(() => {
    rewriteCalls = [];
    writeCalls = [];
    removedTodos = [];
    clearedTodos = [];
    runStateCalls = [];
    queueRow = null;
    readResult = { ok: true, content: SHIPPED_MD, sha: 'sha-1' };
});

describe('unshipEntry — derive-born proposal', () => {
    const deriveRow = () => ({
        id: 'q-derive',
        aspect: 'A1',
        draft: '- [ ] **[MEDIUM]** Derived work\n  - Type: feature',
        state: 'shipped',
        todo_id: 'todo-derive',
        entry_id: 'ent-derive',
        correlation_id: 'corr-9',
        run_id: 77,
        pr_number: 42,
        thread: [{ role: 'system', text: 'earlier' }],
    });

    it('removes the entry from TODO.md by its marker id', async () => {
        queueRow = deriveRow();
        const res = await unshipEntry('ent-derive', { target: TARGET });

        expect(res.returnedToProposals).toBe(true);
        expect(rewriteCalls).toEqual([{ target: TARGET, op: 'delete_entry', id: 'ent-derive' }]);
        // Reopen surgery is the OTHER branch — nothing is written back here.
        expect(writeCalls).toHaveLength(0);
    });

    it('removes the materialized todo', async () => {
        queueRow = deriveRow();
        await unshipEntry('ent-derive', { target: TARGET });
        expect(removedTodos).toEqual(['todo-derive']);
        expect(clearedTodos).toHaveLength(0);
    });

    it('returns the queue row to proposed with the run linkage cleared but entry_id intact', async () => {
        queueRow = deriveRow();
        await unshipEntry('ent-derive', { target: TARGET, mergedPrNumber: 42 });

        expect(runStateCalls).toHaveLength(1);
        expect(runStateCalls[0].id).toBe('q-derive');
        const patch = runStateCalls[0].patch;
        expect(patch.state).toBe('proposed');
        expect(patch.todo_id).toBeNull();
        expect(patch.correlation_id).toBeNull();
        expect(patch.run_id).toBeNull();
        // entry_id is deliberately NOT cleared: re-accepting must re-ship against
        // the same marker rather than become a stranger to its own history.
        expect(patch).not.toHaveProperty('entry_id');
    });

    it('appends the rollback note to the row thread without dropping earlier turns', async () => {
        queueRow = deriveRow();
        await unshipEntry('ent-derive', { target: TARGET, mergedPrNumber: 42 });

        const thread = runStateCalls[0].patch.thread;
        expect(thread).toHaveLength(2);
        expect(thread[0]).toMatchObject({ text: 'earlier' });
        expect(thread[1].text).toBe('Reverted (PR #42) — returned to proposals.');
    });
});

describe('unshipEntry — hand-injected entry', () => {
    it('reopens the entry in place, keeping the marker and dropping the Completed suffix', async () => {
        const res = await unshipEntry('ent-hand', { target: TARGET });

        expect(res.returnedToProposals).toBe(false);
        expect(res.todoMdUpdated).toBe(true);
        expect(writeCalls).toHaveLength(1);
        // The read's sha rides along as the optimistic-concurrency token.
        expect(writeCalls[0].sha).toBe('sha-1');
        const written = writeCalls[0].content;
        expect(written).toContain('- [ ] **[MEDIUM]** Reopen me\n');
        expect(written).toContain('<!-- id: ent-hand -->');
        expect(written).not.toContain('Completed: 2026-08-18');
        // Every other entry is byte-for-byte untouched.
        expect(written).toContain('- [ ] **[HIGH]** Untouched');
        expect(written).toContain('  - Description: something');
        // Reopening is an in-place edit, never a delete.
        expect(rewriteCalls).toHaveLength(0);
    });

    it('clears the todo ship stamp', async () => {
        await unshipEntry('ent-hand', { target: TARGET });
        expect(clearedTodos).toEqual(['todo-hand']);
        expect(removedTodos).toHaveLength(0);
    });

    it('drops an existing queue row back to drafted rather than proposed', async () => {
        queueRow = {
            id: 'q-hand', state: 'shipped', todo_id: 'todo-hand', entry_id: 'ent-hand',
        };
        await unshipEntry('ent-hand', { target: TARGET });
        expect(runStateCalls).toEqual([{ id: 'q-hand', patch: { state: 'drafted' } }]);
    });

    it('takes the reopen branch for a derive row that has no draft to return', async () => {
        queueRow = {
            id: 'q-empty', aspect: 'A2', draft: '   ', state: 'shipped', entry_id: 'ent-hand',
        };
        const res = await unshipEntry('ent-hand', { target: TARGET });
        expect(res.returnedToProposals).toBe(false);
        expect(rewriteCalls).toHaveLength(0);
        expect(writeCalls).toHaveLength(1);
    });

    it('reports the TODO.md edit as not made when the file could not be read', async () => {
        readResult = { ok: false, reason: 'offline' };
        const res = await unshipEntry('ent-hand', { target: TARGET });
        expect(res.todoMdUpdated).toBe(false);
        expect(writeCalls).toHaveLength(0);
        // The code is already reverted, so the rest of the bookkeeping still moves.
        expect(clearedTodos).toEqual(['todo-hand']);
        expect(revertToastMessage(res)).toMatch(/TODO\.md unchanged/);
    });

    it('writes nothing at all without an entry id', async () => {
        const res = await unshipEntry('', { target: TARGET });
        expect(res.ok).toBe(false);
        expect(rewriteCalls).toHaveLength(0);
        expect(writeCalls).toHaveLength(0);
        expect(runStateCalls).toHaveLength(0);
        expect(removedTodos).toHaveLength(0);
        expect(clearedTodos).toHaveLength(0);
    });
});

describe('revert confirm + toast copy', () => {
    it('says the proposal returns to the list for a derive-born row', () => {
        queueRow = { id: 'q1', aspect: 'A1', draft: '- [ ] x', entry_id: 'ent-derive' };
        expect(revertConfirmMessage('ent-derive')).toMatch(/return it to proposals\?/);
        expect(revertConfirmMessage('ent-derive')).toMatch(/the entry leaves TODO\.md/);
    });

    it('says the entry reopens for a hand-injected entry', () => {
        queueRow = null;
        expect(revertConfirmMessage('ent-hand')).toMatch(/reopen its entry\?/);
        expect(revertConfirmMessage('ent-hand')).toMatch(/returns to TODO\.md unchecked/);
    });

    it('picks its toast from the branch actually taken', () => {
        expect(revertToastMessage({ ok: true, returnedToProposals: true, todoMdUpdated: true }))
            .toBe('Reverted — proposal returned to the list');
        expect(revertToastMessage({ ok: true, returnedToProposals: false, todoMdUpdated: true }))
            .toBe('Reverted — entry reopened');
    });
});

describe('entryParse reopen surgery', () => {
    it('flips the checkbox and strips the Completed note, keeping indent and priority', () => {
        expect(reopenTaskLine('- [x] **[HIGH]** Do it — Completed: 2026-08-18 (PR #7)'))
            .toBe('- [ ] **[HIGH]** Do it');
        expect(reopenTaskLine('  - [X] Nested — Completed: 2026-01-01'))
            .toBe('  - [ ] Nested');
    });

    it('returns null for a line that is not a checked task line', () => {
        expect(reopenTaskLine('- [ ] Already open')).toBeNull();
        expect(reopenTaskLine('  - Type: feature')).toBeNull();
        expect(reopenTaskLine('')).toBeNull();
    });

    it('reopens only the entry whose block carries the marker', () => {
        const md = [
            '- [x] First — Completed: 2026-08-01',
            '  <!-- id: aaa -->',
            '',
            '- [x] Second — Completed: 2026-08-02',
            '  <!-- id: bbb -->',
        ].join('\n');
        const res = reopenEntryInMarkdown(md, 'bbb');
        expect(res.changed).toBe(true);
        expect(res.content).toContain('- [x] First — Completed: 2026-08-01');
        expect(res.content).toContain('- [ ] Second\n');
        expect(res.content).toContain('<!-- id: bbb -->');
    });

    it('reports no change for an absent marker, an empty id, or an already-open entry', () => {
        expect(reopenEntryInMarkdown(SHIPPED_MD, 'nope')).toEqual({ changed: false, content: SHIPPED_MD });
        expect(reopenEntryInMarkdown(SHIPPED_MD, '')).toEqual({ changed: false, content: SHIPPED_MD });
        expect(reopenEntryInMarkdown(SHIPPED_MD, 'ent-other')).toEqual({ changed: false, content: SHIPPED_MD });
    });
});

// ── Cross-surface wiring ──
// The three live Revert surfaces are far too heavily wired to instantiate
// end-to-end in jsdom, so their routing through the ONE shared step is
// source-pinned (the same style the review-pane and Runs-tab wiring use).
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

describe('every Revert surface routes through the shared post-merge step', () => {
    const surfaces = [
        ['claudeSheet.js', 'async function performRevertRun('],
        ['toDoRow.js', 'function performReviewRevert('],
        ['todoMdViewer.js', 'async function performRevert('],
    ];

    surfaces.forEach(([file, marker]) => {
        it(file + ' calls unshipEntry inside its merged:true branch', () => {
            const src = read(file);
            expect(src).toMatch(/import \{[^}]*unshipEntry[^}]*\} from '\.\/dispatchDraft\.js'/s);
            const start = src.indexOf(marker);
            expect(start).toBeGreaterThan(-1);
            const body = src.slice(start, start + 2600);
            const mergedTrue = body.indexOf('merged === true');
            const mergedFalse = body.indexOf('merged === false');
            expect(mergedTrue).toBeGreaterThan(-1);
            const call = body.indexOf('unshipEntry(');
            expect(call).toBeGreaterThan(mergedTrue);
            // …and BEFORE the merged:false branch, so an unmerged revert PR moves
            // no bookkeeping at all.
            expect(mergedFalse).toBeGreaterThan(call);
        });

        it(file + ' shows the shared confirm and toast copy, not its own', () => {
            const src = read(file);
            expect(src).toMatch(/revertConfirmMessage\(/);
            expect(src).toMatch(/revertToastMessage\(/);
            expect(src).not.toMatch(/Reverted — new build shipping/);
        });
    });
});
