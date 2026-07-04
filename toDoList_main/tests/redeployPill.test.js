import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchPagesStatus, requestPagesRebuild, initInjectConfig } from '../src/inject.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The health-aware "Redeploy" pill (todoMdViewer.js header) reflects the target
// repo's newest GitHub Pages publish and, when tapped, re-triggers it. The two
// Worker calls that back it (fetchPagesStatus / requestPagesRebuild) live in
// inject.js and are exercised directly here through the shared fetch transport;
// the pill's wiring + CSS states are asserted by source inspection, matching the
// viewer's established test strategy.

describe('inject.js — pages-health Worker calls', () => {
    let fetchSpy;
    let realFetch;

    function lastBodyMatching(key) {
        const call = fetchSpy.mock.calls.find((c) => {
            try { return JSON.parse(c[1].body)[key]; } catch (e) { return false; }
        });
        return call ? JSON.parse(call[1].body) : null;
    }

    beforeEach(() => {
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret');
        initInjectConfig();

        realFetch = globalThis.fetch;
        fetchSpy = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ status: 'completed', conclusion: 'success' }),
        }));
        globalThis.fetch = fetchSpy;
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        localStorage.clear();
        initInjectConfig();
    });

    const target = { repo: 'owner/repo', file_path: 'TODO.md' };

    it('fetchPagesStatus POSTs { pages_status, repo, filePath } and spreads the response', async () => {
        const res = await fetchPagesStatus(target);
        const body = lastBodyMatching('pages_status');
        expect(body).toBeTruthy();
        expect(body.pages_status).toBe(true);
        expect(body.repo).toBe('owner/repo');
        expect(body.filePath).toBe('TODO.md');
        expect(res.ok).toBe(true);
        expect(res.status).toBe('completed');
        expect(res.conclusion).toBe('success');
    });

    it('requestPagesRebuild POSTs { pages_rebuild, repo, filePath }', async () => {
        const res = await requestPagesRebuild(target);
        const body = lastBodyMatching('pages_rebuild');
        expect(body).toBeTruthy();
        expect(body.pages_rebuild).toBe(true);
        expect(body.repo).toBe('owner/repo');
        expect(body.filePath).toBe('TODO.md');
        expect(res.ok).toBe(true);
    });

    it('funnels a transport failure through describeError as { ok: false, reason }', async () => {
        fetchSpy.mockImplementation(() => Promise.resolve({ ok: false, status: 500 }));
        const status = await fetchPagesStatus(target);
        expect(status.ok).toBe(false);
        expect(status.reason).toBe('Server error 500');
        const rebuild = await requestPagesRebuild(target);
        expect(rebuild.ok).toBe(false);
        expect(rebuild.reason).toBe('Server error 500');
    });
});

describe('redeploy pill — todoMdViewer.js wiring', () => {
    const main = read('todoMdViewer.js');

    it('imports fetchPagesStatus and requestPagesRebuild from inject.js', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bfetchPagesStatus\b[\s\S]*?\brequestPagesRebuild\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('creates a dedicated todoMdViewerDeployPill element in the header', () => {
        expect(main).toMatch(/deployPill\.className\s*=\s*['"]todoMdViewerDeployPill/);
        expect(main).toMatch(/meta\.appendChild\(\s*deployPill\s*\)/);
    });

    it('renders three states — idle / failure / deploying — with a Redeploy/Deploying label', () => {
        expect(main).toMatch(/todoMdViewerDeployPill--['"]\s*\+\s*state/);
        expect(main).toMatch(/state\s*===\s*['"]deploying['"]\s*\?\s*['"]Deploying['"]\s*:\s*['"]Redeploy['"]/);
    });

    it('maps a completed success to idle, a failure conclusion to red, and an in-flight publish to deploying', () => {
        const start = main.indexOf('function applyPagesStatus');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 700);
        expect(block).toMatch(/status\s*&&\s*res\.status\s*!==\s*['"]completed['"][\s\S]{0,80}renderDeployPill\(\s*['"]deploying['"]/);
        expect(block).toMatch(/conclusion\s*===\s*['"]failure['"][\s\S]{0,80}renderDeployPill\(\s*['"]failure['"]/);
        expect(block).toMatch(/renderDeployPill\(\s*['"]idle['"]\s*\)/);
    });

    it('refreshes pages health after each runSync (so the mount fetch settles the pill too)', () => {
        const start = main.indexOf('async function runSync');
        const block = main.slice(start, start + 1600);
        expect(block).toMatch(/refreshPagesStatus\s*\(\s*\)/);
    });

    it('taps to rebuild: optimistic Deploying, then polls until the publish completes', () => {
        const start = main.indexOf('async function requestPagesRedeploy');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1000);
        expect(block).toMatch(/renderDeployPill\(\s*['"]deploying['"]\s*\)/);
        expect(block).toMatch(/requestPagesRebuild\s*\(\s*target\s*\)/);
        // The poll is seeded with the run id current at tap time so it can ignore
        // the pre-redeploy run until the new publish registers.
        expect(block).toMatch(/startPagesPoll\s*\(\s*lastPagesRunId\s*\)/);
    });

    it('stops the tap from bubbling to the mobile sheet-open handler before redeploying', () => {
        // On the collapsed mobile launcher, tapping Redeploy re-renders the pill
        // (detaching the inner glyph the tap landed on), so the card's
        // openViewerMobileSheet exclusion (event.target.closest('button')) misses
        // and the sheet opens too. Stopping propagation at the source guarantees
        // the tap never reaches the card handler regardless of the re-render.
        const start = main.indexOf("deployPill.addEventListener('click'");
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 200);
        expect(block).toMatch(/event\.stopPropagation\s*\(\s*\)/);
        expect(block).toMatch(/requestPagesRedeploy\s*\(\s*\)/);
        // stopPropagation must run before the redeploy kicks off its re-render.
        expect(block.indexOf('stopPropagation')).toBeLessThan(block.indexOf('requestPagesRedeploy('));
    });

    it('tracks the current deploy run id from every pages_status probe that carries one', () => {
        // applyPagesStatus records res.runId into the module-scoped baseline so a
        // later redeploy has a previous-run id to compare against.
        expect(main).toMatch(/let\s+lastPagesRunId\s*=\s*null/);
        const start = main.indexOf('function applyPagesStatus');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 400);
        expect(block).toMatch(/if\s*\(\s*res\.runId\s*\)\s*lastPagesRunId\s*=\s*res\.runId/);
    });

    it('holds Deploying while the poll still sees the pre-redeploy (baseline) run', () => {
        const start = main.indexOf('function startPagesPoll');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1200);
        // The poll takes a baseline run id.
        expect(block).toMatch(/function\s+startPagesPoll\s*\(\s*baselineRunId\s*\)/);
        // When the probe still reports the baseline run, keep Deploying + keep
        // polling instead of settling on its stale `completed` status. This guard
        // must sit BEFORE the completed-check so the stale run can't settle first.
        const guard = block.indexOf('baselineRunId && res.found && res.runId === baselineRunId');
        const completed = block.indexOf("res.status === 'completed'");
        expect(guard).toBeGreaterThan(-1);
        expect(completed).toBeGreaterThan(-1);
        expect(guard).toBeLessThan(completed);
        const guardBlock = block.slice(guard, completed);
        expect(guardBlock).toMatch(/renderDeployPill\(\s*['"]deploying['"]\s*\)/);
        expect(guardBlock).toMatch(/return/);
    });

    it('clears the pages poll interval on teardown so it cannot leak', () => {
        expect(main).toMatch(/function\s+stopViewerPagesPoll\s*\(/);
        // detachViewerResizeHandler tears the card down; it must stop the poll.
        const start = main.indexOf('function detachViewerResizeHandler');
        const block = main.slice(start, start + 500);
        expect(block).toMatch(/stopViewerPagesPoll\s*\(\s*\)/);
    });

    it('runs an ambient 30s pages-health poll for the card lifetime so a failed deploy surfaces without a manual Sync', () => {
        // A dedicated module-scoped interval + a slow 30s cadence, distinct from
        // the 5s redeploy poll.
        expect(main).toMatch(/let\s+viewerPagesHealthInterval\s*=\s*null/);
        expect(main).toMatch(/PAGES_HEALTH_INTERVAL_MS\s*=\s*30000/);
        // startPagesHealthPoll drives the interval off refreshPagesStatus.
        const start = main.indexOf('function startPagesHealthPoll');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 300);
        expect(block).toMatch(/viewerPagesHealthInterval\s*=\s*setInterval\(\s*refreshPagesStatus\s*,\s*PAGES_HEALTH_INTERVAL_MS\s*\)/);
        // It is started at mount, right after the initial runSync().
        expect(main).toMatch(/runSync\s*\(\s*\)\s*;[\s\S]{0,400}startPagesHealthPoll\s*\(\s*\)/);
    });

    it('tears the pages-health poll down with the card so it cannot leak', () => {
        expect(main).toMatch(/function\s+stopPagesHealthPoll\s*\(/);
        const stop = main.indexOf('function stopPagesHealthPoll');
        const stopBlock = main.slice(stop, stop + 200);
        expect(stopBlock).toMatch(/clearInterval\s*\(\s*viewerPagesHealthInterval\s*\)/);
        expect(stopBlock).toMatch(/viewerPagesHealthInterval\s*=\s*null/);
        // detachViewerResizeHandler tears the card down; it must stop this poll too.
        const start = main.indexOf('function detachViewerResizeHandler');
        const block = main.slice(start, start + 500);
        expect(block).toMatch(/stopPagesHealthPoll\s*\(\s*\)/);
    });

    it('preserves the existing header controls unchanged', () => {
        // The Run-backlog button + its --idle toggle, the run-status pill + its
        // lifecycle, and the Sync chip + runSync handler must all keep working.
        expect(main).toMatch(/runBacklogBtn\.classList\.toggle\(\s*['"]todoMdViewerRunBtn--idle['"]/);
        expect(main).toMatch(/runBacklogBtn\.addEventListener\(\s*['"]click['"]\s*,\s*runBacklog\s*\)/);
        expect(main).toMatch(/syncBtn\.addEventListener\(\s*['"]click['"]\s*,\s*runSync\s*\)/);
        expect(main).toMatch(/todoMdViewerRunPill--['"]\s*\+\s*opts\.state/);
    });

    it('disables the deploy pill while a backlog run is active, re-enabling when terminal', () => {
        const start = main.indexOf('function syncDeployPillEnabled');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 900);
        // "A run is active" = a pill is up and not yet terminal.
        expect(block).toMatch(/runActive\s*=\s*!!runPill\s*&&\s*!isTerminalRunPill\(\)/);
        // Disabled while deploying OR while a run is active.
        expect(block).toMatch(/deployPill\.disabled\s*=\s*\(state\s*===\s*['"]deploying['"]\)\s*\|\|\s*runActive/);
        // Run-block styling + messaging when blocked by a run (and not deploying).
        expect(block).toMatch(/todoMdViewerDeployPill--runblocked/);
        expect(block).toMatch(/Redeploy is unavailable while a backlog run is running/);
    });

    it('re-syncs the deploy pill from the run-pill lifecycle chokepoints', () => {
        // renderRunPill (every run-state render) and restoreRunButton (teardown)
        // both call the helper with no argument so the button disables on start
        // and re-enables the instant the run goes terminal / is torn down.
        const renderStart = main.indexOf('function renderRunPill');
        const renderBlock = main.slice(renderStart, main.indexOf('function restoreRunButton'));
        expect(renderBlock).toMatch(/syncDeployPillEnabled\s*\(\s*\)/);
        const restoreStart = main.indexOf('function restoreRunButton');
        const restoreBlock = main.slice(restoreStart, restoreStart + 600);
        expect(restoreBlock).toMatch(/syncDeployPillEnabled\s*\(\s*\)/);
    });
});

describe('redeploy pill — style.css state tokens', () => {
    const css = read('style.css');

    it('bases the pill on Void tokens for the idle/neutral state', () => {
        expect(css).toMatch(/\.todoMdViewerDeployPill\s*\{[\s\S]*?color:\s*var\(--text-secondary\)/);
        expect(css).toMatch(/\.todoMdViewerDeployPill\s*\{[\s\S]*?border:\s*1px solid var\(--border-bright\)/);
    });

    it('goes loud danger red on a failed publish', () => {
        expect(css).toMatch(/\.todoMdViewerDeployPill--failure\s*\{[\s\S]*?color:\s*var\(--text-danger\)/);
        expect(css).toMatch(/\.todoMdViewerDeployPill--failure\s*\{[\s\S]*?border-color:\s*var\(--text-danger\)/);
    });

    it('uses the amber warning token for the deploying spinner', () => {
        expect(css).toMatch(/\.todoMdViewerDeployPill--deploying\s*\{[\s\S]*?color:\s*var\(--text-warning\)/);
        expect(css).toMatch(/\.todoMdViewerDeployPillSpinner\s*\{[\s\S]*?border:\s*2px solid var\(--text-warning\)/);
        expect(css).toMatch(/\.todoMdViewerDeployPillSpinner\s*\{[\s\S]*?animation:\s*todoMdViewerRunSpin/);
    });

    it('dims the run-blocked pill with a not-allowed cursor that beats the deploying progress cursor', () => {
        expect(css).toMatch(/\.todoMdViewerDeployPill--runblocked\s*\{[\s\S]*?opacity:\s*0\.45/);
        expect(css).toMatch(/\.todoMdViewerDeployPill--runblocked\s*\{[\s\S]*?cursor:\s*not-allowed/);
        // The generic [disabled] progress-cursor rule is gone; the deploying
        // class owns the progress cursor, so it can't override run-blocked.
        expect(css).not.toMatch(/\.todoMdViewerDeployPill\[disabled\]/);
        expect(css).toMatch(/\.todoMdViewerDeployPill--deploying\s*\{[\s\S]*?cursor:\s*progress/);
    });

    it('never hardcodes hex colors in the deploy pill rules', () => {
        const ruleStart = css.indexOf('.todoMdViewerDeployPill {');
        const ruleEnd = css.indexOf('.todoMdViewerDeployPillSpinner {');
        expect(ruleStart).toBeGreaterThan(-1);
        expect(ruleEnd).toBeGreaterThan(ruleStart);
        const block = css.slice(ruleStart, css.indexOf('}', ruleEnd) + 1);
        expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    });
});
