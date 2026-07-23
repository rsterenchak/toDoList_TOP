import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Source-inspection tests for the project switcher's "agent work waiting" count.
// The switcher rows are built in main.js, which is too large / closure-bound to
// instantiate in jsdom (per CLAUDE.md), so the wiring invariants are pinned by
// source regex here — the same strategy projectSwitcherRunSpinners uses. The
// pure counting logic (getWaitingAgentCounts) is exercised behaviourally in
// agentQueueStore.test.js against a controllable fake Supabase client.

describe('switcher agent count — store surface (agentQueueStore.js)', () => {
    const store = read('agentQueueStore.js');

    it('holds an all-projects cache SEPARATE from the selected-project _rows', () => {
        expect(store).toMatch(/let\s+_allRows\s*=\s*\[\]/);
        // _rows must NOT be re-scoped to all projects (getQueueRowForTodo depends
        // on it staying selected-project-scoped).
        expect(store).toMatch(/export\s+function\s+getAllQueueRows\s*\(/);
    });

    it('fetches every project in one round trip (no project_id filter)', () => {
        const start = store.indexOf('function fetchAllQueueRows');
        expect(start).toBeGreaterThan(-1);
        const block = store.slice(start, start + 500);
        expect(block).toMatch(/\.from\(\s*['"]agent_queue['"]\s*\)\.select\(\s*['"]\*['"]\s*\)/);
        // No .eq — the all-fetch is deliberately unscoped (RLS scopes to the user).
        expect(block).not.toMatch(/\.eq\(/);
        // Degrades to [] on error / stub client, never throws.
        expect(block).toMatch(/resolve\(\s*\[\]\s*\)/);
    });

    it('counts ASKING (needs_words) + unread DRAFTED, excludes non-blocking states', () => {
        const start = store.indexOf('function getWaitingAgentCounts');
        expect(start).toBeGreaterThan(-1);
        const block = store.slice(start, start + 1400);
        expect(block).toMatch(/state\s*===\s*['"]needs_words['"]/);
        expect(block).toMatch(/state\s*===\s*['"]drafted['"]/);
        // The drafted half gates on the todo's draftSeenAt (unread only).
        expect(block).toMatch(/!\s*todo\.draftSeenAt/);
        // Reads the in-memory model for the reverse id→name map and todos.
        expect(block).toMatch(/listLogic\.getProjectId/);
        expect(block).toMatch(/listLogic\.listItems/);
    });

    it('one realtime push refreshes BOTH caches (refreshQueueCaches)', () => {
        const start = store.indexOf('function refreshQueueCaches');
        expect(start).toBeGreaterThan(-1);
        const block = store.slice(start, start + 700);
        // All rows into _allRows, selected project derived by filter (one fetch).
        expect(block).toMatch(/_allRows\s*=\s*rows/);
        expect(block).toMatch(/rows\.filter\(/);
        // The subscription handler routes the push through it.
        expect(store).toMatch(/refreshQueueCaches\(\s*resolveSelectedProjectName\(\)\s*\)\.then\(\s*notifyQueueChange\s*\)/);
    });
});

describe('switcher agent count — render wiring (main.js)', () => {
    const main = read('main.js');

    it('imports the store surface it paints from', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bloadAllQueueRows\b[\s\S]*?\bgetWaitingAgentCounts\b[\s\S]*?\bonQueueChange\b[\s\S]*?\}\s*from\s*['"]\.\/agentQueueStore\.js['"]/
        );
    });

    it('walks #projChild rows and stamps an amber count keyed off the store', () => {
        const start = main.indexOf('function updateAllProjectAgentCounts');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1600);
        expect(block).toMatch(/getWaitingAgentCounts\(\)/);
        expect(block).toMatch(/querySelectorAll\(\s*['"]#projChild['"]\s*\)/);
        // Lazily attaches a .projAgentCount just before the incomplete-count pill.
        expect(block).toMatch(/['"]projAgentCount['"]/);
        expect(block).toMatch(/querySelector\(\s*['"]\.projBadge['"]\s*\)/);
        expect(block).toMatch(/insertBefore\(\s*badge\s*,\s*projBadge\s*\)/);
        // >0 → reveal (class + reserved column); else clear.
        expect(block).toMatch(/classList\.add\(\s*['"]hasAgentCount['"]\s*\)/);
        expect(block).toMatch(/classList\.remove\(\s*['"]hasAgentCount['"]\s*\)/);
    });

    it('primes the cache once and keeps the count live off realtime pushes', () => {
        // Initial paint from a one-shot all-projects load…
        expect(main).toMatch(/loadAllQueueRows\(\)\.then\(\s*updateAllProjectAgentCounts\s*\)/);
        // …and repaint on every agent_queue push.
        expect(main).toMatch(/onQueueChange\(\s*updateAllProjectAgentCounts\s*\)/);
        // Repaints on row rebuilds via the existing footer observer.
        expect(main).toMatch(/updateFooterCounts\(\);[\s\S]{0,400}updateAllProjectAgentCounts\(\)/);
    });
});

describe('switcher agent count — styling (style.css)', () => {
    const css = read('style.css');

    it('styles the amber count hidden by default, non-interactive, reusing #ffbd5e', () => {
        const base = css.match(/\.projAgentCount\s*\{[^}]*\}/);
        expect(base).not.toBeNull();
        expect(base[0]).toMatch(/display:\s*none/);
        expect(base[0]).toMatch(/#ffbd5e/);
        expect(base[0]).toMatch(/pointer-events:\s*none/);
        // Revealed only when the row carries the count.
        expect(css).toMatch(/#projChild\.hasAgentCount\s+\.projAgentCount\s*\{[^}]*display:\s*inline-block/);
    });

    it('reserves the count its own grid column across bolt / spinner combinations', () => {
        expect(css).toMatch(/#projChild\.hasAgentCount\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto\s+12px/);
        expect(css).toMatch(/#projChild\.hasInjectBolt\.hasAgentCount\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto\s+12px/);
        expect(css).toMatch(/#projChild\.hasRunSpinner\.hasAgentCount\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto\s+auto\s+12px/);
        expect(css).toMatch(/#projChild\.hasInjectBolt\.hasRunSpinner\.hasAgentCount\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto\s+auto\s+12px/);
    });
});
