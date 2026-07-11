import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    hasShippedRunForEntry,
    refreshShippedMarkers,
    initInjectConfig,
} from '../src/inject.js';
// refreshDescStatusDots is exactly what the module-level TODO_RUN_STATUS_EVENT
// listener delegates to; calling it drives the same production dot logic.
import { refreshDescStatusDots } from '../src/toDoRow.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Feature: a small run-status dot overlaid on #descIndicator — green once the
// row's injected entry has shipped (its `<!-- id -->` marker sits on a `[x]`
// entry in the routed target's TODO.md), amber while injected-but-pending, and
// absent when the task carries no entry id. Shipped-truth is read from the
// shared TODO.md (the cross-device source of truth), not the device-local
// todoapp_claudeRuns store, so the dot agrees across devices. buildToDoRow is
// too heavily wired to instantiate here, so the DOM behaviour is driven through
// a light #toDoChild stand-in plus the marker cache the production code reads.

let realFetch;
// Stub the Worker read so refreshShippedMarkers can populate its per-repo cache.
function mockTodoMd(content) {
    globalThis.fetch = vi.fn(() => Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: content }),
    }));
}
function mockReadFailure() {
    globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
}

// A unique repo per refresh keeps the module-level marker cache (which unions
// across repos) from letting one test's fetch fall inside another's TTL window.
let repoSeq = 0;
function freshTarget() {
    repoSeq += 1;
    return { repo: 'owner/repo-' + repoSeq, file_path: 'TODO.md' };
}

// Mirror the subset of buildToDoRow's output the dot logic touches: a
// #toDoChild carrying an __item anchor, with a nested #descIndicator.
function makeRow(item) {
    const ml = document.getElementById('mainList') || (function () {
        const el = document.createElement('div');
        el.id = 'mainList';
        document.body.appendChild(el);
        return el;
    })();
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = item;
    const indicator = document.createElement('span');
    indicator.id = 'descIndicator';
    row.appendChild(indicator);
    ml.appendChild(row);
    return { row, indicator };
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    // Configure the Worker so postToWorker / readTodoMdFromWorker run.
    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();
    realFetch = globalThis.fetch;
});
afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('hasShippedRunForEntry — shipped-marker correlation from TODO.md', () => {
    it('returns false with an empty marker cache', () => {
        expect(hasShippedRunForEntry('never-cached-id')).toBe(false);
    });

    it('returns true for a CHECKED entry whose marker id was cached', async () => {
        const md = [
            '# TODO LIST',
            '',
            '- [x] Done thing',
            '  <!-- id: shipped-alpha -->',
            '',
        ].join('\n');
        mockTodoMd(md);
        await refreshShippedMarkers(freshTarget());
        expect(hasShippedRunForEntry('shipped-alpha')).toBe(true);
    });

    it('returns false for an UNCHECKED entry marker even after a refresh', async () => {
        const md = [
            '- [ ] Not done',
            '  <!-- id: pending-beta -->',
            '- [x] Done',
            '  <!-- id: shipped-gamma -->',
        ].join('\n');
        mockTodoMd(md);
        await refreshShippedMarkers(freshTarget());
        expect(hasShippedRunForEntry('pending-beta')).toBe(false);
        expect(hasShippedRunForEntry('shipped-gamma')).toBe(true);
    });

    it('associates a marker sitting several lines below the checkbox line', async () => {
        const md = [
            '- [x] Multi-line entry',
            '  - Type: bug',
            '  - Description: something',
            '  - File: a.js',
            '  <!-- id: shipped-delta -->',
        ].join('\n');
        mockTodoMd(md);
        await refreshShippedMarkers(freshTarget());
        expect(hasShippedRunForEntry('shipped-delta')).toBe(true);
    });

    it('returns false for a falsy id and never throws on a failed read', async () => {
        expect(hasShippedRunForEntry('')).toBe(false);
        expect(hasShippedRunForEntry(null)).toBe(false);
        mockReadFailure();
        await expect(refreshShippedMarkers(freshTarget())).resolves.toBeUndefined();
        expect(hasShippedRunForEntry('anything')).toBe(false);
    });

    it('is a no-op for a target with no repo/file_path', async () => {
        await expect(refreshShippedMarkers(null)).resolves.toBeUndefined();
        await expect(refreshShippedMarkers({ repo: 'x' })).resolves.toBeUndefined();
    });
});

describe('description-status dot — live refresh through the marker cache', () => {
    it('renders no dot when the task carries no entry id', () => {
        const { indicator } = makeRow({ entryId: null, injectedAt: null });
        refreshDescStatusDots();
        expect(indicator.querySelector('.dot')).toBeNull();
    });

    it('renders an amber pending dot when the entry id is present but not shipped', () => {
        const { indicator } = makeRow({ entryId: 'pending-dot-id', injectedAt: null });
        refreshDescStatusDots();
        const dot = indicator.querySelector('.dot');
        expect(dot).not.toBeNull();
        expect(dot.classList.contains('dot--pending')).toBe(true);
    });

    it('renders a green shipped dot once the entry marker is on a checked TODO.md entry', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: green-dot-id -->');
        await refreshShippedMarkers(freshTarget());
        const { indicator } = makeRow({ entryId: 'green-dot-id', injectedAt: 1700000000000 });
        refreshDescStatusDots();
        const dot = indicator.querySelector('.dot');
        expect(dot).not.toBeNull();
        expect(dot.classList.contains('dot--pending')).toBe(false);
    });

    it('flips a pending dot to shipped in place when the marker cache resolves', async () => {
        const { indicator } = makeRow({ entryId: 'flip-dot-id', injectedAt: 1700000000000 });
        refreshDescStatusDots();
        expect(indicator.querySelector('.dot').classList.contains('dot--pending')).toBe(true);

        // The routed TODO.md now shows the entry checked; refresh + re-sweep.
        mockTodoMd('- [x] shipped\n  <!-- id: flip-dot-id -->');
        await refreshShippedMarkers(freshTarget());
        refreshDescStatusDots();
        const dots = indicator.querySelectorAll('.dot');
        expect(dots.length).toBe(1); // reused in place, not duplicated
        expect(dots[0].classList.contains('dot--pending')).toBe(false);
    });
});

describe('wiring — dot is driven by the shared TODO.md, synced entry id, and events', () => {
    const toDoRow = read('toDoRow.js');
    const inject = read('inject.js');
    const listLogic = read('listLogic.js');
    const claudeSheet = read('claudeSheet.js');
    const css = read('style.css');

    it('buildToDoRow overlays the status dot right after inserting the indicator', () => {
        expect(toDoRow).toMatch(
            /insertBefore\(descIndicator,\s*toDoInput\);[\s\S]{0,400}applyDescStatusDot\(descIndicator,\s*item\)/
        );
    });

    it('refreshDescStatusDots sweeps every rendered indicator', () => {
        expect(toDoRow).toMatch(
            /export\s+function\s+refreshDescStatusDots\s*\([\s\S]{0,320}querySelectorAll\(\s*['"]#descIndicator['"]\)/
        );
    });

    it('a single document listener delegates to refreshDescStatusDots on the run-status event', () => {
        expect(toDoRow).toMatch(
            /document\.addEventListener\(\s*TODO_RUN_STATUS_EVENT\s*,\s*refreshDescStatusDots\s*\)/
        );
    });

    it('hasShippedRunForEntry reads the shipped-marker cache, not the local run store', () => {
        expect(inject).toMatch(
            /function\s+hasShippedRunForEntry[\s\S]{0,260}shippedMarkerCache\.forEach/
        );
        // It must no longer scan todoapp_claudeRuns for the dot's shipped state.
        const body = inject.slice(inject.indexOf('function hasShippedRunForEntry'));
        const fnEnd = body.indexOf('\n}');
        expect(body.slice(0, fnEnd)).not.toMatch(/CLAUDE_RUNS_KEY/);
    });

    it('refreshShippedMarkers reads TODO.md through the Worker and dispatches the event', () => {
        expect(inject).toMatch(
            /export\s+function\s+refreshShippedMarkers\s*\([\s\S]{0,600}readTodoMdFromWorker\(target\)[\s\S]{0,400}emitTodoRunStatusChange\(\)/
        );
    });

    it('the toDo row kicks a marker refresh for the routed project', () => {
        expect(toDoRow).toMatch(/refreshShippedMarkersForProject\(/);
    });

    it('listLogic syncs the entry id both ways (payload + hydrate)', () => {
        expect(listLogic).toMatch(/entry_id:\s*item\.entryId\s*\|\|\s*null/);
        expect(listLogic).toMatch(/entryId:\s*t\.entry_id\s*\|\|/);
    });

    it('inject.js emits the run-status event after a successful inject', () => {
        expect(inject).toMatch(
            /refreshInjectButton\(btn,\s*item\);[\s\S]{0,200}emitTodoRunStatusChange\(\)/
        );
    });

    it('claudeSheet.js emits the run-status event whenever run records persist', () => {
        expect(claudeSheet).toMatch(
            /function\s+saveRunRecords\s*\([\s\S]{0,500}emitTodoRunStatusChange\(\)/
        );
    });

    it('the dot is styled from theme tokens and anchored inside the indicator', () => {
        expect(css).toMatch(/#descIndicator\s*\{[\s\S]{0,160}position:\s*relative/);
        expect(css).toMatch(/#descIndicator\s+\.dot\s*\{[\s\S]{0,200}background:\s*var\(--type-feature\)/);
        expect(css).toMatch(/#descIndicator\s+\.dot--pending\s*\{[\s\S]{0,120}background:\s*var\(--text-warning\)/);
    });
});
