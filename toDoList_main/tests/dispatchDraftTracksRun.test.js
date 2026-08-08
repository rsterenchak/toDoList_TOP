import { vi, describe, it, expect, beforeEach } from 'vitest';

// Regression coverage for the Runs-tab gap: runs dispatched through the shared
// `dispatchDraft` core — the Agent board's Dispatch/Retry and the todo description
// panel's Dispatch/Retry block — registered no run record, so they never showed a
// QUEUED/RUNNING pill in the chat sheet's Runs tab while in flight. The two other
// dispatch surfaces (todoMdViewer's "Run backlog" / "Run this entry", and chat's
// "Inject & run") already tracked theirs. dispatchDraft must now call
// trackDispatchedRun after the dispatched state is persisted, carrying the ship
// result's correlation + entry ids, the row's title, the resolved repo, and the
// selected project — and must stay best-effort, so a Runs-tab failure never turns
// a dispatch that actually shipped into an error.

let shipCalls = [];
let shipResult = { ok: true, entryId: 'ent-new', correlationId: 'corr-9', runId: 222 };
let runStateCalls = [];
let trackCalls = [];
let trackImpl = null;

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: (opts) => {
        shipCalls.push(opts);
        return Promise.resolve(shipResult);
    },
}));

vi.mock('../src/inject.js', () => ({
    findTargetById: (id) => (id === 'tid-1' ? { id: 'tid-1', repo: 'acme/widgets' } : null),
    mintEntryId: () => 'ent-mint',
    embedEntryMarker: (t, id) => String(t == null ? '' : t).replace(/\s+$/, '') + '\n  <!-- id: ' + id + ' -->',
}));

let projectTargetId = 'tid-1';

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectTargetId: () => projectTargetId,
        addEntryTodo: () => 'created-id-1',
        listItems: () => [],
        setAgentRunState: (id, patch) => {
            runStateCalls.push({ id, patch });
            return Promise.resolve({ ok: true });
        },
    },
}));

// The Runs-tab writer is pulled in through a dynamic import (claudeSheet statically
// imports this module, so a static import back would cycle); mocking the module
// stands in for the real sheet without loading it.
vi.mock('../src/claudeSheet.js', () => ({
    trackDispatchedRun: (opts) => {
        trackCalls.push(opts);
        if (trackImpl) return trackImpl(opts);
        return null;
    },
}));

import { dispatchDraft } from '../src/dispatchDraft.js';

// getSelectedProjectName reads a `.selectedProject` row's #projInput value.
function selectProject(name) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + name + '"></div>';
}

const ENTRY_TEXT =
    '- [ ] **[MEDIUM]** Add a widget\n  - Type: feature\n' +
    '  - Description: Renders a widget.\n  - File: `src/widget.js`';

beforeEach(() => {
    shipCalls = [];
    runStateCalls = [];
    trackCalls = [];
    trackImpl = null;
    projectTargetId = 'tid-1';
    shipResult = { ok: true, entryId: 'ent-new', correlationId: 'corr-9', runId: 222 };
    document.body.innerHTML = '';
});

describe('dispatchDraft registers a run record so the Runs tab shows the dispatch', () => {
    it('tracks a run for a row that already has a todo, titled from the entry headline', async () => {
        selectProject('Inbox');
        const row = { id: 'q1', todo_id: 't-existing', entry_id: 'ent-keep' };

        const res = await dispatchDraft(row, ENTRY_TEXT, row.entry_id);
        expect(res).toEqual({ ok: true });

        expect(trackCalls).toHaveLength(1);
        expect(trackCalls[0]).toMatchObject({
            correlationId: 'corr-9',
            entryId: 'ent-new',
            // No context on this row, so the title comes from the entry's own
            // `- [ ] **[MEDIUM]** …` headline, priority marker stripped.
            title: 'Add a widget',
            repo: 'acme/widgets',
            project: 'Inbox',
        });
        expect(typeof trackCalls[0].dispatchedAt).toBe('number');
    });

    it('titles the record from the row context when the row carries one', async () => {
        selectProject('Inbox');
        const row = {
            id: 'q9',
            todo_id: null,
            entry_id: null,
            context: { title: 'Add a widget from a proposal', description: 'A shiny new widget.' },
        };

        await dispatchDraft(row, ENTRY_TEXT, row.entry_id);

        expect(trackCalls).toHaveLength(1);
        expect(trackCalls[0].title).toBe('Add a widget from a proposal');
    });

    it('tracks after the dispatched state is persisted, not before', async () => {
        selectProject('Inbox');
        const row = { id: 'q1', todo_id: 't-existing', entry_id: 'ent-keep' };

        await dispatchDraft(row, ENTRY_TEXT, row.entry_id);

        // The row must already be `dispatched` when the pill appears, so a repaint
        // driven by the record can never read a stale drafted/stuck row.
        expect(runStateCalls).toHaveLength(1);
        expect(runStateCalls[0].patch.state).toBe('dispatched');
        expect(trackCalls).toHaveLength(1);
    });

    it('passes a null repo when the project has no linked target', async () => {
        selectProject('Inbox');
        projectTargetId = null;
        const row = { id: 'q1', todo_id: 't-existing', entry_id: 'ent-keep' };

        await dispatchDraft(row, ENTRY_TEXT, row.entry_id);

        expect(trackCalls[0].repo).toBe(null);
    });

    it('does not track a run when the ship fails', async () => {
        selectProject('Inbox');
        shipResult = { ok: false, error: 'inject failed' };
        const row = { id: 'q1', todo_id: 't-existing', entry_id: 'ent-keep' };

        const res = await dispatchDraft(row, ENTRY_TEXT, row.entry_id);
        expect(res).toEqual({ ok: false, error: 'inject failed' });
        expect(trackCalls).toHaveLength(0);
    });

    it('still reports success when Runs-tab tracking throws', async () => {
        selectProject('Inbox');
        trackImpl = () => { throw new Error('runs tab exploded'); };
        const row = { id: 'q1', todo_id: 't-existing', entry_id: 'ent-keep' };

        const res = await dispatchDraft(row, ENTRY_TEXT, row.entry_id);

        // Best-effort: the run really did ship, so the caller must not see an error.
        expect(res).toEqual({ ok: true });
        expect(trackCalls).toHaveLength(1);
    });

    it('runs the dispatched tail after tracking, so the board still repaints', async () => {
        selectProject('Inbox');
        const tailCalls = [];
        const row = { id: 'q1', todo_id: 't-existing', entry_id: 'ent-keep' };

        await dispatchDraft(row, ENTRY_TEXT, row.entry_id, {
            onDispatched: (rowId, entryId, correlationId) => {
                tailCalls.push({ rowId, entryId, correlationId });
            },
        });

        expect(trackCalls).toHaveLength(1);
        expect(tailCalls).toEqual([{ rowId: 'q1', entryId: 'ent-new', correlationId: 'corr-9' }]);
    });
});
