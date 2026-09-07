import { vi } from 'vitest';

// Regression: tapping Generate when the triage sweep dispatches NOTHING must say
// so. `fireTriageSweep` resolves to null — not `{ ok: false }` — on three paths:
// the wiring's in-flight guard swallowing the call, a missed project id, and the
// store having no dispatcher registered at all. onGenerateClick only toasted on
// `tr.ok === false`, so all three flagged the row, launched no run, and left the
// button showing Generating… with nothing behind it.

let insertedRows = [];

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: [], error: null }),
            }),
            insert: (row) => { insertedRows.push(row); return Promise.resolve({ data: [row], error: null }); },
            update: (patch) => ({ eq: () => Promise.resolve({ data: [patch], error: null }) }),
            delete: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; }, unsubscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';
import { makeGenerateButton } from '../src/toDoRow.js';
import { setTriageDispatcher } from '../src/agentQueueStore.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await tick();
}
function toastText() {
    const toast = document.getElementById('todoRowToast');
    return toast ? toast.textContent : '';
}
// A routed project with one committed task, plus the Generate button bound to it.
function mountGenerate(projectName) {
    listLogic.addProject(projectName);
    listLogic.setProjectTargetId(projectName, 'tgt-1');
    const res = listLogic.addToDo(projectName, 'Ship the thing');
    const item = res.array.find((it) => it && it.tit === 'Ship the thing');
    const btn = makeGenerateButton(item, { projectName: projectName });
    document.body.appendChild(btn);
    return btn;
}

beforeEach(() => {
    listLogic._reset();
    insertedRows = [];
    document.body.innerHTML = '';
    setTriageDispatcher(null);
});

afterEach(() => {
    setTriageDispatcher(null);
    document.body.innerHTML = '';
});

describe('Generate — a sweep that never dispatched is surfaced', () => {
    it('toasts when the sweep resolves null (guard swallowed it / no dispatcher registered)', async () => {
        const btn = mountGenerate('Alpha');

        btn.click();
        await flush();

        // The flag itself succeeded — the row exists — but no run was dispatched.
        expect(insertedRows.some((r) => r && r.state === 'triaging')).toBe(true);
        expect(toastText()).toMatch(/no triage run started/i);
        expect(toastText()).toMatch(/Retry triage/i);
    });

    it('toasts the same copy when the sweep dispatch reports a failure', async () => {
        setTriageDispatcher(() => Promise.resolve({ ok: false, reason: 'Server error 500' }));
        const btn = mountGenerate('Bravo');

        btn.click();
        await flush();

        expect(toastText()).toMatch(/no triage run started/i);
    });

    it('stays silent when the sweep dispatches successfully', async () => {
        setTriageDispatcher(() => Promise.resolve({ ok: true, dispatched: true }));
        const btn = mountGenerate('Charlie');

        btn.click();
        await flush();

        expect(document.getElementById('todoRowToast')).toBeNull();
    });
});
