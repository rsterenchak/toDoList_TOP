import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The Code lens's per-file complexity chips (complexityHotspots.js). The chip is
// a dispatcher plus a pure reader: tapping it POSTs `dispatch_complexity_scan` to
// the Worker, then it polls the stored `complexity_scans` row through listLogic
// until `scanned_at` advances and settles into a hotspot-count badge (or a dimmed
// `clean`). These tests mock inject.js (dispatchComplexityScan / getCachedTargets)
// and listLogic (loadComplexityScans) and drive the poll on fake timers, so the
// dispatch payload, the tree-wide single-scan guard, the settle, and both failure
// paths are exercised end to end.

let dispatchResult = { ok: true };
let loadResult = { ok: true, rows: [] };

const dispatchComplexityScan = vi.fn(function () { return Promise.resolve(dispatchResult); });
const loadComplexityScans = vi.fn(function () { return Promise.resolve(loadResult); });

vi.mock('../src/inject.js', () => ({
    getCachedTargets: () => [{ repo: 'o/r', file_path: 'TODO.md', id: 't1' }],
    dispatchComplexityScan: (...a) => dispatchComplexityScan(...a),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        loadComplexityScans: (...a) => loadComplexityScans(...a),
    },
}));

import {
    buildComplexityChip,
    setComplexityScans,
    resetComplexityHotspots,
    openHotspotCount,
    isScannablePath,
} from '../src/complexityHotspots.js';

const POLL_MS = 10000;

// Microtask flush — the dispatch/read promises resolve without timers.
async function flush(n = 8) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

function hotspot(name) {
    return { name: name, start_line: 1, end_line: 9, time: 'O(n^2)', space: 'O(1)', rationale: 'r' };
}

function scanRow(path, extra) {
    return Object.assign({
        file_path: path,
        sha: 'sha-1',
        hotspots: [hotspot('a'), hotspot('b')],
        pushed: [],
        scanned_at: '2026-08-01T00:00:00.000Z',
    }, extra || {});
}

// Mount a chip the way structureView does — inside a row that opens the file in
// the code viewer when clicked.
function mountChip(path, name) {
    const row = document.createElement('div');
    row.className = 'structureFileRow';
    const chip = buildComplexityChip('o/r', path, name || path);
    if (chip) row.appendChild(chip);
    document.body.appendChild(row);
    return { row: row, chip: chip };
}

beforeEach(() => {
    vi.useFakeTimers();
    dispatchResult = { ok: true };
    loadResult = { ok: true, rows: [] };
    dispatchComplexityScan.mockClear();
    loadComplexityScans.mockClear();
    document.body.innerHTML = '';
    resetComplexityHotspots();
});

afterEach(() => {
    resetComplexityHotspots();
    vi.useRealTimers();
});

describe('which rows get a chip', () => {
    it('builds a chip for every extension the complexity pass can read', () => {
        ['a.js', 'a.mjs', 'a.cjs', 'a.jsx', 'a.ts', 'a.tsx'].forEach(function (name) {
            expect(isScannablePath('toDoList_main/src/' + name)).toBe(true);
            expect(buildComplexityChip('o/r', 'toDoList_main/src/' + name, name)).not.toBeNull();
        });
    });

    it('builds no chip for files the pass cannot read', () => {
        ['style.css', 'data.json', 'icon.svg', 'README.md', 'Zector.otf'].forEach(function (name) {
            expect(isScannablePath('toDoList_main/src/' + name)).toBe(false);
            expect(buildComplexityChip('o/r', 'toDoList_main/src/' + name, name)).toBeNull();
        });
    });

    it('builds no chip without a repo or a path', () => {
        expect(buildComplexityChip('', 'toDoList_main/src/a.js', 'a.js')).toBeNull();
        expect(buildComplexityChip('o/r', '', '')).toBeNull();
    });
});

describe('states derived from the stored rows', () => {
    it('offers a scan when the repo has no row for the file', () => {
        const { chip } = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        setComplexityScans('o/r', []);
        expect(chip.dataset.state).toBe('scan');
        expect(chip.disabled).toBe(false);
    });

    it('renders the open hotspot count as a badge', () => {
        const { chip } = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        setComplexityScans('o/r', [scanRow('toDoList_main/src/taskSort.js')]);
        expect(chip.dataset.state).toBe('count');
        expect(chip.querySelector('.complexityChipLabel').textContent).toBe('2');
    });

    it('subtracts pushed hotspots from the badge count', () => {
        const { chip } = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        setComplexityScans('o/r', [scanRow('toDoList_main/src/taskSort.js', { pushed: ['a'] })]);
        expect(chip.dataset.state).toBe('count');
        expect(chip.querySelector('.complexityChipLabel').textContent).toBe('1');
        expect(openHotspotCount({ hotspots: [hotspot('a'), hotspot('b')], pushed: ['a', 'b'] })).toBe(0);
    });

    it('reads clean when the scan found nothing — and when every hotspot is pushed', () => {
        const a = mountChip('toDoList_main/src/one.js', 'one.js');
        const b = mountChip('toDoList_main/src/two.js', 'two.js');
        setComplexityScans('o/r', [
            scanRow('toDoList_main/src/one.js', { hotspots: [] }),
            scanRow('toDoList_main/src/two.js', { pushed: ['a', 'b'] }),
        ]);
        expect(a.chip.dataset.state).toBe('clean');
        expect(b.chip.dataset.state).toBe('clean');
    });

    it('leaves badge and clean chips inert — Part 1 has no expansion', () => {
        const a = mountChip('toDoList_main/src/one.js', 'one.js');
        const b = mountChip('toDoList_main/src/two.js', 'two.js');
        setComplexityScans('o/r', [
            scanRow('toDoList_main/src/one.js'),
            scanRow('toDoList_main/src/two.js', { hotspots: [] }),
        ]);
        a.chip.click();
        b.chip.click();
        expect(a.chip.disabled).toBe(true);
        expect(b.chip.disabled).toBe(true);
        expect(dispatchComplexityScan).not.toHaveBeenCalled();
    });

    it('never reads another repo’s stored rows', () => {
        const { chip } = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        setComplexityScans('other/repo', [scanRow('toDoList_main/src/taskSort.js')]);
        expect(chip.dataset.state).toBe('scan');
    });
});

describe('dispatching a scan', () => {
    it('posts the repo-relative path with the resolved inject target and flips to scanning', async () => {
        const { chip } = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        setComplexityScans('o/r', []);
        chip.click();
        expect(chip.dataset.state).toBe('scanning');
        expect(chip.disabled).toBe(true);
        await flush();
        expect(dispatchComplexityScan).toHaveBeenCalledTimes(1);
        const [target, targetFile] = dispatchComplexityScan.mock.calls[0];
        expect(target).toEqual({ repo: 'o/r', file_path: 'TODO.md', id: 't1' });
        expect(targetFile).toBe('toDoList_main/src/taskSort.js');
    });

    it('disables every other file’s scan chip while one scan is in flight', async () => {
        const a = mountChip('toDoList_main/src/one.js', 'one.js');
        const b = mountChip('toDoList_main/src/two.js', 'two.js');
        setComplexityScans('o/r', []);
        expect(b.chip.disabled).toBe(false);
        a.chip.click();
        await flush();
        expect(b.chip.dataset.state).toBe('scan');
        expect(b.chip.disabled).toBe(true);
        // A stale handler must not open a second scan either.
        b.chip.dispatchEvent(new Event('click', { bubbles: true }));
        await flush();
        expect(dispatchComplexityScan).toHaveBeenCalledTimes(1);
    });

    it('does not open the file in the code viewer when the chip is tapped', () => {
        const { row, chip } = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        const openInViewer = vi.fn();
        row.addEventListener('click', openInViewer);
        setComplexityScans('o/r', []);
        chip.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(openInViewer).not.toHaveBeenCalled();
        expect(chip.dataset.state).toBe('scanning');
    });
});

describe('polling for the stored row', () => {
    it('settles into a badge once the row appears and releases the tree-wide guard', async () => {
        const a = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        const b = mountChip('toDoList_main/src/two.js', 'two.js');
        setComplexityScans('o/r', []);
        a.chip.click();
        await flush();
        expect(loadComplexityScans).not.toHaveBeenCalled();

        loadResult = { ok: true, rows: [scanRow('toDoList_main/src/taskSort.js')] };
        await vi.advanceTimersByTimeAsync(POLL_MS);

        expect(loadComplexityScans).toHaveBeenCalledWith('o/r');
        expect(a.chip.dataset.state).toBe('count');
        expect(a.chip.querySelector('.complexityChipLabel').textContent).toBe('2');
        expect(b.chip.dataset.state).toBe('scan');
        expect(b.chip.disabled).toBe(false);
    });

    it('keeps polling while the stored row has not advanced past its baseline', async () => {
        const stale = scanRow('toDoList_main/src/taskSort.js');
        const { chip } = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        // A file that already carries a row: only a NEWER scanned_at (or a
        // different sha) settles the re-scan, never the row it started from.
        // Part 1 offers no re-scan affordance on an already-scanned file (that is
        // Part 2's expanded header), so the badge's inert state is forced open
        // here to reach the baseline comparison the poll is built around.
        setComplexityScans('o/r', [stale]);
        loadResult = { ok: true, rows: [stale] };
        chip.dataset.state = 'scan';
        chip.disabled = false;
        chip.click();
        await flush();

        await vi.advanceTimersByTimeAsync(POLL_MS * 3);
        expect(chip.dataset.state).toBe('scanning');
        expect(loadComplexityScans).toHaveBeenCalledTimes(3);

        loadResult = {
            ok: true,
            rows: [scanRow('toDoList_main/src/taskSort.js', { scanned_at: '2026-08-02T00:00:00.000Z' })],
        };
        await vi.advanceTimersByTimeAsync(POLL_MS);
        expect(chip.dataset.state).toBe('count');
    });

    it('survives a failed read mid-scan rather than stranding the chip', async () => {
        const { chip } = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        setComplexityScans('o/r', []);
        chip.click();
        await flush();

        loadResult = { ok: false, error: 'Not signed in.' };
        await vi.advanceTimersByTimeAsync(POLL_MS);
        expect(chip.dataset.state).toBe('scanning');

        loadResult = { ok: true, rows: [scanRow('toDoList_main/src/taskSort.js')] };
        await vi.advanceTimersByTimeAsync(POLL_MS);
        expect(chip.dataset.state).toBe('count');
    });

    it('gives up after five minutes into an error state whose tap retries', async () => {
        const { chip } = mountChip('toDoList_main/src/taskSort.js', 'taskSort.js');
        setComplexityScans('o/r', []);
        chip.click();
        await flush();

        await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + POLL_MS);
        expect(chip.dataset.state).toBe('error');
        expect(chip.disabled).toBe(false);
        expect(dispatchComplexityScan).toHaveBeenCalledTimes(1);

        chip.click();
        await flush();
        expect(chip.dataset.state).toBe('scanning');
        expect(dispatchComplexityScan).toHaveBeenCalledTimes(2);
    });
});

describe('dispatch failure', () => {
    it('flips to error and frees the guard so another file can scan', async () => {
        const a = mountChip('toDoList_main/src/one.js', 'one.js');
        const b = mountChip('toDoList_main/src/two.js', 'two.js');
        setComplexityScans('o/r', []);
        dispatchResult = { ok: false, reason: 'worker 502' };
        a.chip.click();
        await flush();

        expect(a.chip.dataset.state).toBe('error');
        expect(a.chip.disabled).toBe(false);
        expect(b.chip.dataset.state).toBe('scan');
        expect(b.chip.disabled).toBe(false);
    });

    it('keeps the error across a tree repaint', async () => {
        const first = mountChip('toDoList_main/src/one.js', 'one.js');
        setComplexityScans('o/r', []);
        dispatchResult = { ok: false, reason: 'worker 502' };
        first.chip.click();
        await flush();
        expect(first.chip.dataset.state).toBe('error');

        // A repaint throws the tree away and builds fresh rows.
        document.body.innerHTML = '';
        const repainted = mountChip('toDoList_main/src/one.js', 'one.js');
        setComplexityScans('o/r', []);
        expect(repainted.chip.dataset.state).toBe('error');
    });
});
