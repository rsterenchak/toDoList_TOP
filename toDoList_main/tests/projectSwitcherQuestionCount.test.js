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
// The pure counting logic (getWaitingQuestionCounts, fed by an all-projects
// agent_queue cache) is exercised BEHAVIOURALLY here against a controllable fake
// Supabase client — the stub client the store test uses resolves everything to
// [] and never exercises the real all-projects path. The switcher rows are built
// in main.js, which is too large / closure-bound to instantiate in jsdom (per
// CLAUDE.md), so its wiring invariants — chiefly that a throwing count source can
// never abort the render — are pinned by source regex, matching the strategy
// projectSwitcherRunSpinners uses.

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

describe('store surface — source (agentQueueStore.js)', () => {
    const store = read('agentQueueStore.js');

    it('holds an all-projects cache SEPARATE from the selected-project _rows', () => {
        expect(store).toMatch(/let\s+_allRows\s*=\s*\[\]/);
        expect(store).toMatch(/export\s+function\s+getAllQueueRows\s*\(/);
    });

    it('fetches every project in one round trip (no project_id filter, degrades to [])', () => {
        const start = store.indexOf('function fetchAllQueueRows');
        expect(start).toBeGreaterThan(-1);
        const block = store.slice(start, start + 500);
        expect(block).toMatch(/\.from\(\s*['"]agent_queue['"]\s*\)\.select\(\s*['"]\*['"]\s*\)/);
        // No .eq — the all-fetch is deliberately unscoped (RLS scopes to the user).
        expect(block).not.toMatch(/\.eq\(/);
        // Degrades to [] on error / stub client, never throws.
        expect(block).toMatch(/resolve\(\s*\[\]\s*\)/);
    });

    it('counts ONLY needs_words — never reads todo data (no drafts, no listItems)', () => {
        const start = store.indexOf('function getWaitingQuestionCounts');
        expect(start).toBeGreaterThan(-1);
        const block = store.slice(start, start + 1600);
        expect(block).toMatch(/state\s*!==\s*['"]needs_words['"]/);
        // Deliberately NOT counting drafts / reading todos, which broke an
        // earlier attempt.
        expect(block).not.toMatch(/drafted/);
        expect(block).not.toMatch(/listItems/);
        expect(block).not.toMatch(/draftSeenAt/);
        // Resolves name → id through the in-memory model.
        expect(block).toMatch(/listLogic\.getProjectId/);
    });

    it('one realtime push refreshes BOTH caches off the single existing channel', () => {
        const start = store.indexOf('function startAgentQueueSubscription');
        expect(start).toBeGreaterThan(-1);
        const block = store.slice(start, start + 1400);
        // The push loads the selected-project cache AND the all-projects cache.
        expect(block).toMatch(/loadQueueRows\(\s*resolveSelectedProjectName\(\)\s*\)/);
        expect(block).toMatch(/loadAllQueueRows\(\)/);
        expect(block).toMatch(/notifyQueueChange/);
    });
});

describe('switcher wiring — source (main.js)', () => {
    const main = read('main.js');

    it('imports the all-projects count surface from the store', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bstartAgentQueueSubscription\b[\s\S]*?\bloadAllQueueRows\b[\s\S]*?\bgetWaitingQuestionCounts\b[\s\S]*?\bonQueueChange\b[\s\S]*?\}\s*from\s*['"]\.\/agentQueueStore\.js['"]/
        );
    });

    it('resolves all counts BEFORE the row loop inside a try/catch fallback', () => {
        const start = main.indexOf('function updateAllProjectQuestionCounts');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1600);
        // Counts computed once, guarded, before any per-row work.
        expect(block).toMatch(/try\s*\{[\s\S]*?getWaitingQuestionCounts\(\)[\s\S]*?\}\s*catch\s*\([\s\S]*?\)\s*\{[\s\S]*?counts\s*=\s*\{\}/);
        // The per-row body only reads the map with a default of zero…
        expect(block).toMatch(/counts\[name\]\s*\|\|\s*0/);
        // …the count source is invoked exactly once (before the loop), never
        // per-row…
        expect(block.match(/getWaitingQuestionCounts\(/g) || []).toHaveLength(1);
        // …and never reaches for todo data.
        expect(block).not.toMatch(/listItems/);
        expect(block).not.toMatch(/draftSeenAt/);
    });

    it('toggles the reserved badge class + element per row', () => {
        const start = main.indexOf('function updateAllProjectQuestionCounts');
        const block = main.slice(start, start + 1600);
        expect(block).toMatch(/['"]projQuestionCount['"]/);
        expect(block).toMatch(/classList\.add\(\s*['"]hasQuestionCount['"]\s*\)/);
        expect(block).toMatch(/classList\.remove\(\s*['"]hasQuestionCount['"]\s*\)/);
    });

    it('primes the cache and keeps the counts live off the realtime channel', () => {
        expect(main).toMatch(/startAgentQueueSubscription\(\)/);
        expect(main).toMatch(/loadAllQueueRows\(\)\.then\(\s*updateAllProjectQuestionCounts\s*\)/);
        expect(main).toMatch(/onQueueChange\(\s*updateAllProjectQuestionCounts\s*\)/);
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

    it('reveals the pill and reserves its grid column via .hasQuestionCount', () => {
        expect(css).toMatch(/#projChild\.hasQuestionCount\s+\.projQuestionCount\s*\{[^}]*display:\s*inline-block/);
        expect(css).toMatch(/#projChild\.hasQuestionCount\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto\s+12px/);
        // Composes with the ⚡ bolt and the run spinner columns.
        expect(css).toMatch(/#projChild\.hasInjectBolt\.hasRunSpinner\.hasQuestionCount\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto\s+auto\s+12px/);
    });
});
