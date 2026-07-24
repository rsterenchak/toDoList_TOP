import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The project switcher shows a per-project amber count of the triage questions
// (agent_queue rows in `needs_words`) waiting in each project, so a question
// parked in an off-screen project reaches the user without switching to it.
//
// This file exercises the pure counting surface (getWaitingQuestionCounts, fed
// by the all-projects agent_queue cache) BEHAVIOURALLY against a controllable
// fake Supabase client. The paint itself — the DOM writer in main.js and its
// re-entrancy / idempotency invariants — is covered as a mounted-DOM regression
// in projectSwitcherQuestionCountPaint.test.js. A first attempt at this feature
// shipped green because its switcher tests only grepped main.js for strings and
// never mounted a DOM, so the paint's self-triggering-observer hang went
// undetected; the DOM regression there is the guard against a repeat.

let allRows = [];
vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            // The all-projects fetch is an unfiltered `.select('*')` (no `.eq`);
            // return a Promise that resolves to the current fake rows.
            select: () => Promise.resolve({ data: allRows, error: null }),
        }),
        channel: () => ({
            on() { return this; },
            subscribe() { return this; },
        }),
        removeChannel: () => {},
    },
}));

import { listLogic } from '../src/listLogic.js';
import {
    loadAllQueueRows,
    getAllQueueRows,
    getWaitingQuestionCounts,
} from '../src/agentQueueStore.js';

beforeEach(async () => {
    listLogic._reset();
    // Reset the module-level all-projects cache to empty between tests.
    allRows = [];
    await loadAllQueueRows();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('getWaitingQuestionCounts — behaviour', () => {
    it('counts ONLY needs_words rows, keyed by project name', async () => {
        listLogic.addProject('Alpha');
        listLogic.addProject('Beta');
        listLogic.addProject('Gamma');
        const alphaId = listLogic.getProjectId('Alpha');
        const betaId = listLogic.getProjectId('Beta');
        allRows = [
            { id: 'q1', project_id: alphaId, state: 'needs_words' },
            { id: 'q2', project_id: alphaId, state: 'needs_words' },
            { id: 'q3', project_id: alphaId, state: 'triaging' },   // not blocked → ignored
            { id: 'q4', project_id: betaId, state: 'drafted' },     // draft → out of scope, ignored
        ];
        await loadAllQueueRows();
        // Alpha has two questions; Beta's only row is a draft; Gamma has none →
        // only non-zero projects appear.
        expect(getWaitingQuestionCounts()).toEqual({ Alpha: 2 });
    });

    it('drops a row whose project_id resolves to no known project (unresolvable → zero)', async () => {
        listLogic.addProject('Alpha');
        const alphaId = listLogic.getProjectId('Alpha');
        allRows = [
            { id: 'q1', project_id: alphaId, state: 'needs_words' },
            { id: 'q2', project_id: 'ghost-project-id', state: 'needs_words' },
        ];
        await loadAllQueueRows();
        const counts = getWaitingQuestionCounts();
        expect(counts).toEqual({ Alpha: 1 });
        // The unresolvable id contributes nothing rather than raising.
        expect(counts['ghost-project-id']).toBeUndefined();
    });

    it('degrades to an empty map when the cache is empty', () => {
        // Nothing loaded (beforeEach cleared _allRows) → no counts, no throw.
        expect(getAllQueueRows()).toEqual([]);
        expect(getWaitingQuestionCounts()).toEqual({});
    });

    it('never throws, and returns {}, when the count source blows up', async () => {
        listLogic.addProject('Alpha');
        allRows = [{ id: 'q1', project_id: 'x', state: 'needs_words' }];
        await loadAllQueueRows();
        // Force the id→name resolution to throw mid-count — the switcher's render
        // depends on this being swallowed so a broken source can't abort the list.
        vi.spyOn(listLogic, 'getProjectId').mockImplementation(() => {
            throw new Error('boom');
        });
        expect(() => getWaitingQuestionCounts()).not.toThrow();
        expect(getWaitingQuestionCounts()).toEqual({});
    });

    it('loadAllQueueRows caches every project\'s rows in one fetch (no per-project filter)', async () => {
        listLogic.addProject('Alpha');
        listLogic.addProject('Beta');
        const alphaId = listLogic.getProjectId('Alpha');
        const betaId = listLogic.getProjectId('Beta');
        allRows = [
            { id: 'q1', project_id: alphaId, state: 'needs_words' },
            { id: 'q2', project_id: betaId, state: 'needs_words' },
        ];
        const rows = await loadAllQueueRows();
        // Both projects' rows are present in the single all-projects cache.
        expect(rows).toHaveLength(2);
        expect(getWaitingQuestionCounts()).toEqual({ Alpha: 1, Beta: 1 });
    });
});

// Precise anti-regression guard for the exact mistake that reverted the first
// attempt: the switcher paint was wired to a `childList`/`subtree`
// MutationObserver on the sidebar, so the paint's own badge-span insertion
// re-triggered it forever and hung the tab. The behavioural break (idempotency
// stops the loop) is pinned in the mounted-DOM test; this only asserts the
// hazardous wiring is not present and that the paint is instead driven from the
// row-rebuild and realtime paths.
describe('switcher paint wiring — no self-triggering observer (main.js)', () => {
    const main = read('main.js');

    it('never constructs a MutationObserver over the question-count paint', () => {
        expect(main).not.toMatch(/new\s+MutationObserver\(\s*updateAllProjectQuestionCounts\s*\)/);
        expect(main).not.toMatch(/questionCountObserver/);
    });

    it('drives the paint from the realtime channel and the restore rebuild', () => {
        expect(main).toMatch(/onQueueChange\(\s*updateAllProjectQuestionCounts\s*\)/);
        expect(main).toMatch(/loadAllQueueRows\(\)\.then\(\s*updateAllProjectQuestionCounts\s*\)/);
        // Called explicitly (not observer-driven) at least from create/rename and
        // the restore rebuild, plus the two wiring lines above.
        expect((main.match(/updateAllProjectQuestionCounts\(\)/g) || []).length)
            .toBeGreaterThanOrEqual(2);
    });
});

describe('switcher count — styling (style.css)', () => {
    const css = read('style.css');

    it('styles the amber count pill hidden + non-interactive by default', () => {
        const base = css.match(/\.projQuestionCount\s*\{[^}]*\}/);
        expect(base).not.toBeNull();
        expect(base[0]).toMatch(/display:\s*none/);
        expect(base[0]).toMatch(/#ffbd5e/);
        expect(base[0]).toMatch(/pointer-events:\s*none/);
    });

    it('reveals the pill only under the .hasQuestionCount modifier', () => {
        expect(css).toMatch(/#projChild\.hasQuestionCount\s+\.projQuestionCount\s*\{[^}]*display:\s*inline-block/);
    });
});
