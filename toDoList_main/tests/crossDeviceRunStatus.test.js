import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Source-inspection tests for the cross-device "running" status feature: a
// server-driven Running pill in the TODO.md viewer and a spinner on the
// project-trigger pill, both fed by the Worker's repo-level `active_runs`
// probe. Strategy mirrors the surrounding viewer/inject suites (source regex),
// since the full project-select → poll path needs jsdom + a Worker stub.

describe('cross-device run status — fetchActiveRuns helper', () => {
    const inject = read('inject.js');

    it('exports fetchActiveRuns from inject.js', () => {
        expect(inject).toMatch(/export\s+async\s+function\s+fetchActiveRuns\s*\(/);
    });

    it('POSTs `{ active_runs: true, repo, filePath }` through postToWorker', () => {
        // Reuses the same Worker URL + Bearer secret path as dispatch/status —
        // the client never calls GitHub directly.
        expect(inject).toMatch(
            /postToWorker\s*\(\s*\{[\s\S]{0,200}active_runs:\s*true[\s\S]{0,200}repo:[\s\S]{0,200}filePath:/
        );
    });

    it('spreads the parsed response onto an `{ ok: true }` envelope like pollRunStatus', () => {
        const start = inject.indexOf('export async function fetchActiveRuns');
        const block = inject.slice(start, start + 600);
        expect(block).toMatch(/Object\.assign\(\s*\{\s*ok:\s*true\s*\}\s*,\s*res\s*\|\|\s*\{\}\s*\)/);
    });

    it('funnels failures through describeError (fire-and-forget — ok:false, never throws)', () => {
        expect(inject).toMatch(/fetchActiveRuns[\s\S]{0,600}catch[\s\S]{0,80}ok:\s*false[\s\S]{0,40}describeError/);
    });
});

describe('cross-device run status — project-trigger spinner (main.js)', () => {
    const main = read('main.js');
    const css = read('style.css');

    it('imports fetchActiveRuns, findTargetById and isInjectConfigured from inject.js', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bisInjectConfigured\b[\s\S]*?\bfindTargetById\b[\s\S]*?\bfetchActiveRuns\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('mounts a decorative, non-interactive spinner in the title row by the chevron', () => {
        expect(main).toMatch(/mobileProjRunSpinner\.id\s*=\s*['"]mobileProjRunSpinner['"]/);
        expect(main).toMatch(/mobileProjRunSpinner\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
        // Inserted between the ▾ chevron and the next-project carousel button.
        expect(main).toMatch(
            /mobileProjTitleRow\.appendChild\(mobileProjChevron\);[\s\S]{0,120}mobileProjTitleRow\.appendChild\(mobileProjRunSpinner\);/
        );
    });

    it('only resolves a repo when inject is configured AND the project routes to a target', () => {
        const start = main.indexOf('function resolveActiveProjectTarget');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 400);
        expect(block).toMatch(/!isInjectConfigured\(\)/);
        expect(block).toMatch(/listLogic\.getProjectTargetId\(\s*name\s*\)/);
        expect(block).toMatch(/findTargetById\(\s*targetId\s*\)/);
        expect(block).toMatch(/target\.repo/);
    });

    it('toggles the --active class only on a successful probe reporting active===true', () => {
        const start = main.indexOf('async function refreshProjRunSpinner');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 800);
        expect(block).toMatch(/fetchActiveRuns\(/);
        // No routed repo → clear the spinner, never poll.
        expect(block).toMatch(/if\s*\(\s*!target\s*\)[\s\S]{0,120}remove\(\s*['"]mobileProjRunSpinner--active['"]\s*\)/);
        // A stale (superseded) response is dropped via the request token.
        expect(block).toMatch(/token\s*!==\s*projRunSpinnerReqToken\s*\)\s*return/);
        expect(block).toMatch(/res\.active\s*===\s*true/);
        expect(block).toMatch(/classList\.toggle\(\s*['"]mobileProjRunSpinner--active['"]\s*,\s*active\s*\)/);
    });

    it('re-polls on a genuine active-project change via the single header writer', () => {
        const start = main.indexOf('function updateMobileProjHeader');
        const block = main.slice(start, start + 2600);
        expect(block).toMatch(/activeName\s*!==\s*projRunSpinnerLastProject/);
        expect(block).toMatch(/projRunSpinnerLastProject\s*=\s*activeName/);
        expect(block).toMatch(/refreshProjRunSpinner\(\)/);
    });

    it('polls on a light interval only while the tab is visible, and on visibility regain + load', () => {
        expect(main).toMatch(/PROJ_RUN_SPINNER_INTERVAL_MS\s*=\s*10000/);
        expect(main).toMatch(
            /setInterval\(\s*function\s*\(\)\s*\{[\s\S]{0,120}document\.visibilityState\s*===\s*['"]visible['"][\s\S]{0,80}refreshProjRunSpinner\(\)/
        );
        expect(main).toMatch(
            /addEventListener\(\s*['"]visibilitychange['"][\s\S]{0,160}document\.visibilityState\s*===\s*['"]visible['"][\s\S]{0,80}refreshProjRunSpinner\(\)/
        );
    });

    it('styles the spinner purple, hidden by default, non-interactive, on the shared spin keyframes', () => {
        const base = css.match(/\.mobileProjRunSpinner\s*\{[^}]*\}/);
        expect(base).not.toBeNull();
        expect(base[0]).toMatch(/display:\s*none/);
        expect(base[0]).toMatch(/#9D93EE/);
        expect(base[0]).toMatch(/pointer-events:\s*none/);
        const active = css.match(/\.mobileProjRunSpinner--active\s*\{[^}]*\}/);
        expect(active).not.toBeNull();
        expect(active[0]).toMatch(/animation:\s*spin\s/);
        expect(css).toMatch(/@keyframes\s+spin\s*\{[\s\S]{0,80}rotate\(360deg\)/);
    });
});

describe('cross-device run status — viewer server-driven Running pill', () => {
    const viewer = read('todoMdViewer.js');

    it('imports fetchActiveRuns from inject.js', () => {
        expect(viewer).toMatch(
            /import\s*\{[\s\S]*?\bfetchActiveRuns\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('mounts a server-driven Running pill when the probe reports active and no local record', () => {
        const start = viewer.indexOf('async function pollServerRunSignal');
        expect(start).toBeGreaterThan(-1);
        const block = viewer.slice(start, start + 800);
        // The local active-run record always wins — the probe stands down.
        expect(block).toMatch(/if\s*\(\s*readActiveRun\(\s*projectName\s*\)\s*\)\s*return/);
        // A lingering local terminal pill (runPill set, not server-driven) is left alone.
        expect(block).toMatch(/if\s*\(\s*runPill\s*&&\s*!serverDrivenPill\s*\)\s*return/);
        expect(block).toMatch(/fetchActiveRuns\(\s*target\s*\)/);
        expect(block).toMatch(/res\.active\s*===\s*true/);
        expect(block).toMatch(/if\s*\(\s*!runPill\s*\)\s*mountServerRunPill\(\)/);
    });

    it('tears the server pill down when the probe reports the repo no longer active', () => {
        const start = viewer.indexOf('async function pollServerRunSignal');
        const block = viewer.slice(start, start + 800);
        expect(block).toMatch(/else\s+if\s*\(\s*serverDrivenPill\s*\)\s*\{?\s*restoreRunButton\(\)/);
    });

    it('renders the server pill as a "Running…" spinner with no give-up/dismiss machinery', () => {
        const start = viewer.indexOf('function mountServerRunPill');
        const block = viewer.slice(start, start + 700);
        expect(block).toMatch(/serverDrivenPill\s*=\s*true/);
        expect(block).toMatch(/renderRunPill\(\s*\{\s*state:\s*['"]running['"]\s*,\s*label:\s*['"]Running…['"]\s*,\s*spinner:\s*true/);
    });

    it('clears the server flag whenever the local lifecycle takes over or restores', () => {
        // startRunPill (local takeover) and restoreRunButton both reset the flag.
        const sp = viewer.slice(viewer.indexOf('function startRunPill'), viewer.indexOf('function startRunPill') + 200);
        expect(sp).toMatch(/serverDrivenPill\s*=\s*false/);
        const rb = viewer.slice(viewer.indexOf('function restoreRunButton'), viewer.indexOf('function restoreRunButton') + 200);
        expect(rb).toMatch(/serverDrivenPill\s*=\s*false/);
    });

    it('starts the server probe on mount and clears its interval on teardown', () => {
        expect(viewer).toMatch(/startServerRunPoll\(\)/);
        expect(viewer).toMatch(/viewerServerRunPollInterval\s*=\s*setInterval\(\s*pollServerRunSignal\s*,\s*RUN_POLL_INTERVAL_MS\s*\)/);
        expect(viewer).toMatch(/function stopViewerServerRunPoll[\s\S]{0,160}clearInterval\(\s*viewerServerRunPollInterval\s*\)/);
        expect(viewer).toMatch(/function detachViewerResizeHandler[\s\S]{0,500}stopViewerServerRunPoll\(\)/);
    });

    it('re-probes after a local record clears so an in-flight cross-device run keeps the pill up', () => {
        const start = viewer.indexOf('viewerActiveRunChangeHandler = function');
        const block = viewer.slice(start, start + 1000);
        expect(block).toMatch(/restoreRunButton\(\)[\s\S]{0,320}pollServerRunSignal\(\)/);
    });
});
