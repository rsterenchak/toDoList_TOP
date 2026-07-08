import { vi } from 'vitest';

// The Agent view's Shipped cards carry a Revert control (mockup Option A — it
// shares the card footer with the merged-PR label). Tapping it rolls the shipped
// change back through the Worker `revert` route via revertEntry, guarded against
// double-revert: a merged rollback hides the control for the rest of the session,
// and a revert PR that didn't auto-merge switches the control to opening that PR
// rather than POSTing a duplicate revert. These tests drive that flow with a
// controllable fake Supabase client plus fully mocked inject.js and modals.js so
// no network or real modal is touched.

// ── Supabase stub ────────────────────────────────────────────────────
let queueRows = [];
let queueError = null;

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: queueRows, error: queueError }),
            }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            update: (patch) => ({
                eq: () => Promise.resolve({ data: [patch], error: null }),
            }),
            delete: () => ({
                eq: () => Promise.resolve({ data: [], error: null }),
            }),
        }),
        channel: () => ({
            on() { return this; },
            subscribe() { return this; },
        }),
        removeChannel: () => {},
    },
}));

// ── inject.js stub ───────────────────────────────────────────────────
// Only the members agentView imports need to exist. revertEntry is the one under
// test; the rest are inert stubs so the module import graph resolves.
let revertResult = { ok: true, merged: true };
let revertCalls = [];
let toasts = [];

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'mint',
    embedEntryMarker: (t, id) => String(t) + '\n  <!-- id: ' + id + ' -->',
    injectEntry: () => Promise.resolve({ ok: true }),
    dispatchRun: () => Promise.resolve({ ok: true }),
    dispatchTriage: () => Promise.resolve({ ok: true }),
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    fetchActiveRuns: () => Promise.resolve({ ok: true, active: false }),
    readTodoMdFromWorker: () => Promise.resolve({ ok: false }),
    findTargetById: () => null,
    showInjectToast: (msg) => { toasts.push(msg); },
    isInjectConfigured: () => true,
    chatWithWorker: () => Promise.resolve({ ok: true, reply: '' }),
    revertEntry: (entryId, target) => {
        revertCalls.push({ entryId, target });
        return Promise.resolve(revertResult);
    },
}));

// ── modals.js stub ───────────────────────────────────────────────────
// Capture the confirm modal so a test can accept it synchronously, and observe
// that the Revert control asks for confirmation before acting.
let confirmCalls = [];
let autoConfirm = true;

vi.mock('../src/modals.js', () => ({
    showConfirmModal: (opts) => {
        confirmCalls.push(opts);
        if (autoConfirm && typeof opts.onConfirm === 'function') opts.onConfirm();
    },
}));

vi.mock('../src/claudeSheet.js', () => ({
    openChatWithSeed: () => {},
}));

import { listLogic } from '../src/listLogic.js';
import {
    subscribeAgentView,
    unsubscribeAgentView,
} from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) {
    for (let i = 0; i < n; i++) await tick();
}

function mountDom(projectName) {
    document.body.innerHTML =
        (projectName
            ? '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>'
            : '') +
        '<div id="agentView"></div>';
}

async function loadBoard() {
    subscribeAgentView();
    await flush();
}

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueError = null;
    revertResult = { ok: true, merged: true };
    revertCalls = [];
    toasts = [];
    confirmCalls = [];
    autoConfirm = true;
    document.body.innerHTML = '';
    listLogic.addProject('Shiply');
    mountDom('Shiply');
});

afterEach(() => {
    unsubscribeAgentView();
});

describe('AGENT view — Shipped card Revert control', () => {
    it('renders a Revert button in the Shipped card footer alongside the PR label', async () => {
        queueRows = [{ id: 's1', state: 'shipped', title: 'Shipped feature', pr_number: 42, pr_url: 'https://gh/pr/42', entry_id: 'ent-render' }];
        await loadBoard();
        const footer = document.querySelector('.agentShippedRow');
        expect(footer).toBeTruthy();
        // Both the PR link and the Revert control live in the one footer row.
        expect(footer.querySelector('.agentShippedLink').textContent).toBe('PR #42');
        const btn = footer.querySelector('.claudeRunRevertBtn');
        expect(btn).toBeTruthy();
        expect(btn.getAttribute('aria-label')).toBe('Revert this change');
    });

    it('does not render a Revert button when the row has no entry_id (nothing to revert against)', async () => {
        queueRows = [{ id: 's1', state: 'shipped', title: 'No id', pr_number: 7 }];
        await loadBoard();
        expect(document.querySelector('.agentShippedRow')).toBeTruthy();
        expect(document.querySelector('.claudeRunRevertBtn')).toBeFalsy();
    });

    it('confirms before reverting, then calls revertEntry with the row entry_id', async () => {
        queueRows = [{ id: 's1', state: 'shipped', title: 'Shipped feature', pr_number: 42, entry_id: 'ent-confirm' }];
        await loadBoard();
        document.querySelector('.claudeRunRevertBtn').click();
        await flush();
        // A confirm step fired first.
        expect(confirmCalls.length).toBe(1);
        expect(confirmCalls[0].confirmLabel).toBe('Revert');
        // Then the Worker revert was invoked against the row's entry.
        expect(revertCalls.length).toBe(1);
        expect(revertCalls[0].entryId).toBe('ent-confirm');
    });

    it('does not call revertEntry when the confirm is cancelled', async () => {
        autoConfirm = false;
        queueRows = [{ id: 's1', state: 'shipped', title: 'Shipped feature', entry_id: 'ent-cancel' }];
        await loadBoard();
        document.querySelector('.claudeRunRevertBtn').click();
        await flush();
        expect(confirmCalls.length).toBe(1);
        expect(revertCalls.length).toBe(0);
    });

    it('hides the Revert control after a merged rollback (double-revert guard)', async () => {
        revertResult = { ok: true, merged: true };
        queueRows = [{ id: 's1', state: 'shipped', title: 'Shipped feature', entry_id: 'ent-hide' }];
        await loadBoard();
        document.querySelector('.claudeRunRevertBtn').click();
        await flush();
        expect(revertCalls.length).toBe(1);
        expect(toasts.some((t) => /Reverted/.test(t))).toBe(true);
        // The refresh repaints the board; the reverted entry's control is now gone.
        expect(document.querySelector('.claudeRunRevertBtn')).toBeFalsy();
    });

    it('keeps the control but switches to "open revert PR" when the revert PR did not auto-merge', async () => {
        revertResult = { ok: true, merged: false, revert_pr_url: 'https://gh/pr/99', reason: 'conflict' };
        queueRows = [{ id: 's1', state: 'shipped', title: 'Shipped feature', entry_id: 'ent-pending' }];
        await loadBoard();
        document.querySelector('.claudeRunRevertBtn').click();
        await flush();
        expect(revertCalls.length).toBe(1);
        // The control persists (not a merged revert) and now opens the existing PR.
        const btn = document.querySelector('.claudeRunRevertBtn');
        expect(btn).toBeTruthy();
        expect(btn.getAttribute('aria-label')).toBe('Open the revert pull request');

        // A second tap opens the pending PR rather than POSTing a duplicate revert.
        const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
        btn.click();
        await flush();
        expect(openSpy).toHaveBeenCalledWith('https://gh/pr/99', '_blank', 'noopener');
        expect(revertCalls.length).toBe(1); // no second revert POST
        openSpy.mockRestore();
    });

    it('re-enables the control and surfaces the error when the revert fails', async () => {
        revertResult = { ok: false, reason: 'boom' };
        queueRows = [{ id: 's1', state: 'shipped', title: 'Shipped feature', entry_id: 'ent-fail' }];
        await loadBoard();
        const btn = document.querySelector('.claudeRunRevertBtn');
        btn.click();
        await flush();
        expect(revertCalls.length).toBe(1);
        expect(toasts.some((t) => /Revert failed: boom/.test(t))).toBe(true);
        // Still present and usable for a retry.
        expect(btn.disabled).toBe(false);
    });
});
