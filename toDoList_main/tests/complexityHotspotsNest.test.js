import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// The hotspot nest that opens under a settled Code-lens file row
// (complexityHotspots.js, Part 2). Tapping the count badge — or the `clean` chip
// — expands a block inside the file's `.structureFileWrap`: a header carrying the
// scan's age and a `rescan` chip, then one row per hotspot, each of which opens an
// action row with the `O↓ tighten` / `O↑ relax` dials and a line-span jump chip.
// A dial push builds a `Type: feature` TODO.md entry and ships it through
// shipEntryForTodo, then retires the hotspot so the badge drops and the row dims.
//
// inject.js, shipEntry.js, codeViewer.js and listLogic are mocked so the whole
// push flow — the inject guard, the fail-closed in-flight probe, the ship, and the
// `pushed` write — is driven from the DOM, and the poll runs on fake timers.

let dispatchResult = { ok: true };
let loadResult = { ok: true, rows: [] };
let activeRunsResult = { ok: true, active: false };
let shipResult = { ok: true, entryId: 'e1' };
let markResult = { ok: true };
let injectConfigured = true;

const dispatchComplexityScan = vi.fn(function () { return Promise.resolve(dispatchResult); });
const loadComplexityScans = vi.fn(function () { return Promise.resolve(loadResult); });
const fetchActiveRuns = vi.fn(function () { return Promise.resolve(activeRunsResult); });
const shipEntryForTodo = vi.fn(function () { return Promise.resolve(shipResult); });
const markComplexityHotspotPushed = vi.fn(function () { return Promise.resolve(markResult); });
const renderCodeViewer = vi.fn(function () { return null; });

vi.mock('../src/inject.js', () => ({
    getCachedTargets: () => [{ repo: 'o/r', file_path: 'TODO.md', id: 't1' }],
    dispatchComplexityScan: (...a) => dispatchComplexityScan(...a),
    fetchActiveRuns: (...a) => fetchActiveRuns(...a),
    isInjectConfigured: () => injectConfigured,
}));

vi.mock('../src/shipEntry.js', () => ({
    shipEntryForTodo: (...a) => shipEntryForTodo(...a),
}));

vi.mock('../src/codeViewer.js', () => ({
    renderCodeViewer: (...a) => renderCodeViewer(...a),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        loadComplexityScans: (...a) => loadComplexityScans(...a),
        markComplexityHotspotPushed: (...a) => markComplexityHotspotPushed(...a),
    },
}));

import {
    buildComplexityChip,
    setComplexityScans,
    resetComplexityHotspots,
} from '../src/complexityHotspots.js';

const POLL_MS = 10000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const PUSHED_ADVANCE_MS = 2000;
const NOTE_MS = 6000;
const PATH = 'toDoList_main/src/taskSort.js';

// Microtask flush — the dispatch / ship / probe promises resolve without timers.
async function flush(n = 12) {
    for (let i = 0; i < n; i++) await Promise.resolve();
}

// An ISO timestamp `hours` before the (faked) clock, so the eyebrow's relative
// age is deterministic instead of drifting with the real date.
function hoursAgo(hours) {
    return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

function hotspot(name, extra) {
    return Object.assign({
        name: name,
        start_line: 120,
        end_line: 188,
        time: 'O(n^2)',
        space: 'O(1)',
        rationale: 'nested scan over every todo',
        tighten: { target: 'O(n)', how: 'index the inner lookup in a Map keyed by id' },
        relax: null,
    }, extra || {});
}

function scanRow(path, extra) {
    return Object.assign({
        file_path: path,
        sha: 'sha-1',
        hotspots: [hotspot('computeStreak'), hotspot('rankProjects', {
            time: 'O(n log n)',
            tighten: null,
            relax: { target: 'O(n^2)', how: 'drop the sort and compare pairwise for clarity' },
        })],
        pushed: [],
        scanned_at: hoursAgo(2),
    }, extra || {});
}

// Mount a chip exactly as structureView does: a `.structureFileWrap` holding a
// `.structureFileRow` that opens the file in the code viewer when clicked.
function mountRow(path) {
    const wrap = document.createElement('div');
    wrap.className = 'structureFileWrap';
    const row = document.createElement('div');
    row.className = 'structureFileRow';
    row.style.setProperty('--structure-depth', '2');
    const openInViewer = vi.fn();
    row.addEventListener('click', openInViewer);
    const chip = buildComplexityChip('o/r', path, path.split('/').pop());
    row.appendChild(chip);
    wrap.appendChild(row);
    document.body.appendChild(wrap);
    return { wrap: wrap, row: row, chip: chip, openInViewer: openInViewer };
}

function nestOf(mounted) {
    return mounted.wrap.querySelector('.complexityNest');
}

function hotspotRows(mounted) {
    return Array.from(mounted.wrap.querySelectorAll('.complexityHotspotRow'));
}

function dialChip(mounted, direction) {
    return mounted.wrap.querySelector('.complexityDialChip[data-dial="' + direction + '"]');
}

// The Structure view's desktop code-viewer host, which the jump chip resolves by
// selector. jsdom reports innerWidth 1024, so the desktop branch is the live one.
function mountCodeViewerHost() {
    const view = document.createElement('div');
    view.id = 'structureView';
    const host = document.createElement('div');
    host.className = 'structureCanvasHost';
    view.appendChild(host);
    document.body.appendChild(view);
    return host;
}

beforeEach(() => {
    vi.useFakeTimers();
    dispatchResult = { ok: true };
    loadResult = { ok: true, rows: [] };
    activeRunsResult = { ok: true, active: false };
    shipResult = { ok: true, entryId: 'e1' };
    markResult = { ok: true };
    injectConfigured = true;
    dispatchComplexityScan.mockClear();
    loadComplexityScans.mockClear();
    fetchActiveRuns.mockClear();
    shipEntryForTodo.mockClear();
    markComplexityHotspotPushed.mockClear();
    renderCodeViewer.mockClear();
    document.body.innerHTML = '';
    resetComplexityHotspots();
});

afterEach(() => {
    resetComplexityHotspots();
    vi.useRealTimers();
});

describe('opening and closing the nest', () => {
    it('expands inside the file wrap directly under the file row', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        expect(m.chip.getAttribute('aria-expanded')).toBe('false');

        m.chip.click();
        const nest = nestOf(m);
        expect(nest).not.toBeNull();
        expect(nest.parentNode).toBe(m.wrap);
        expect(m.row.nextSibling).toBe(nest);
        expect(m.chip.getAttribute('aria-expanded')).toBe('true');
    });

    it('collapses on a second tap', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        m.chip.click();
        expect(nestOf(m)).toBeNull();
        expect(m.chip.getAttribute('aria-expanded')).toBe('false');
    });

    it('opens from a clean chip too, as the header row alone', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH, { hotspots: [] })]);
        expect(m.chip.dataset.state).toBe('clean');
        m.chip.click();
        const nest = nestOf(m);
        expect(nest.querySelector('.complexityNestHeader')).not.toBeNull();
        expect(nest.querySelector('.complexityNestRescan')).not.toBeNull();
        expect(hotspotRows(m)).toHaveLength(0);
    });

    it('never lets a click inside the nest reach the file row’s open handler', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        const wrapClick = vi.fn();
        m.wrap.addEventListener('click', wrapClick);
        hotspotRows(m)[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
        nestOf(m).querySelector('.complexityNestRescan')
            .dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(m.openInViewer).not.toHaveBeenCalled();
        expect(wrapClick).not.toHaveBeenCalled();
    });
});

describe('nest contents', () => {
    it('leads with the scanned age eyebrow and a rescan chip', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        const nest = nestOf(m);
        expect(nest.querySelector('.complexityNestAge').textContent).toBe('scanned 2h ago');
        expect(nest.querySelector('.complexityNestRescan').textContent).toBe('rescan');
    });

    it('renders one row per hotspot with its name and time chip', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        const rows = hotspotRows(m);
        expect(rows).toHaveLength(2);
        expect(rows[0].querySelector('.complexityHotspotName').textContent).toBe('computeStreak');
        expect(rows[0].querySelector('.complexityHotspotTime').textContent).toBe('O(n^2)');
        expect(rows[1].querySelector('.complexityHotspotTime').textContent).toBe('O(n log n)');
    });

    it('dims an already-pushed hotspot, marks it, and leaves it inert', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH, { pushed: ['computeStreak'] })]);
        m.chip.click();
        const rows = hotspotRows(m);
        expect(rows[0].classList.contains('complexityHotspotRow--pushed')).toBe(true);
        expect(rows[0].querySelector('.complexityHotspotPushed').textContent).toBe('pushed');
        expect(rows[0].disabled).toBe(true);
        rows[0].click();
        expect(m.wrap.querySelector('.complexityActionRow')).toBeNull();
    });
});

describe('the action row', () => {
    it('opens under the tapped hotspot and marks it selected', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        hotspotRows(m)[0].click();
        const actions = m.wrap.querySelector('.complexityActionRow');
        expect(actions).not.toBeNull();
        const rows = hotspotRows(m);
        expect(rows[0].classList.contains('complexityHotspotRow--open')).toBe(true);
        expect(rows[0].nextSibling).toBe(actions);
        expect(rows[0].getAttribute('aria-expanded')).toBe('true');
    });

    it('keeps only one open at a time, and a second tap closes it', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        hotspotRows(m)[0].click();
        hotspotRows(m)[1].click();
        expect(m.wrap.querySelectorAll('.complexityActionRow')).toHaveLength(1);
        expect(hotspotRows(m)[0].classList.contains('complexityHotspotRow--open')).toBe(false);
        expect(hotspotRows(m)[1].classList.contains('complexityHotspotRow--open')).toBe(true);
        hotspotRows(m)[1].click();
        expect(m.wrap.querySelector('.complexityActionRow')).toBeNull();
    });

    it('offers only the dials the scan actually proposed', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();

        hotspotRows(m)[0].click(); // tighten only
        expect(dialChip(m, 'tighten').textContent).toBe('O↓ tighten');
        expect(dialChip(m, 'relax')).toBeNull();

        hotspotRows(m)[1].click(); // relax only
        expect(dialChip(m, 'tighten')).toBeNull();
        expect(dialChip(m, 'relax').textContent).toBe('O↑ relax');
    });

    it('opens the hotspot’s span in the code viewer from the jump chip', () => {
        mountCodeViewerHost();
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        hotspotRows(m)[0].click();
        const jump = m.wrap.querySelector('.complexityJumpChip');
        expect(jump.textContent).toBe('taskSort.js : 120–188');
        jump.click();
        expect(renderCodeViewer).toHaveBeenCalledTimes(1);
        const opts = renderCodeViewer.mock.calls[0][1];
        expect(opts.filePath).toBe(PATH);
        expect(opts.startLine).toBe(120);
        expect(opts.endLine).toBe(188);
        expect(opts.banner).toBe('Complexity hotspot: computeStreak');
        expect(opts.target).toEqual({ repo: 'o/r', file_path: 'TODO.md', id: 't1' });
    });

    it('renders no jump chip when there is nowhere to open into', () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        hotspotRows(m)[0].click();
        expect(m.wrap.querySelector('.complexityJumpChip')).toBeNull();
    });
});

describe('pushing a dial', () => {
    async function openDial(index) {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        hotspotRows(m)[index].click();
        return m;
    }

    it('ships a Type: feature entry built from the hotspot’s own data', async () => {
        const m = await openDial(0);
        dialChip(m, 'tighten').click();
        await flush();

        expect(fetchActiveRuns).toHaveBeenCalledTimes(1);
        expect(fetchActiveRuns.mock.calls[0][0]).toEqual({ repo: 'o/r', file_path: 'TODO.md', id: 't1' });
        expect(shipEntryForTodo).toHaveBeenCalledTimes(1);
        const opts = shipEntryForTodo.mock.calls[0][0];
        expect(opts.todoId).toBe(null);
        expect(opts.target).toEqual({ repo: 'o/r', file_path: 'TODO.md', id: 't1' });

        const entry = opts.entryText;
        expect(entry.split('\n')[0]).toBe(
            '- [ ] **[MEDIUM]** Tighten computeStreak in taskSort.js from O(n^2) to O(n)');
        expect(entry).toContain('  - Type: feature');
        expect(entry).toContain('  - File: `' + PATH + '`');
        expect(entry).toContain('  - Completed: YYYY-MM-DD (PR #<number>)');
        // The Description must stay a single sub-bullet line.
        const desc = entry.split('\n').filter(function (l) { return l.indexOf('  - Description: ') === 0; });
        expect(desc).toHaveLength(1);
        expect(desc[0]).toContain('Reduce the time complexity of `computeStreak` in `' + PATH + '` from O(n^2) to O(n).');
        expect(desc[0]).toContain('The scan located it around lines 120–188 — locate by name if the file has drifted.');
        expect(desc[0]).toContain('Current complexity: time O(n^2), space O(1).');
        expect(desc[0]).toContain('Rationale: nested scan over every todo');
        expect(desc[0]).toContain('Implementation: index the inner lookup in a Map keyed by id');
        expect(desc[0]).toContain('Preserve behaviour exactly: the same inputs must produce the same outputs,'
            + ' no signature or public API changes, no data-model changes, and no test files modified.');
        // No id marker — shipEntryForTodo mints the id and embeds the marker itself.
        expect(entry).not.toContain('<!-- id:');
    });

    it('titles and words a relax push from the relax direction', async () => {
        const m = await openDial(1);
        dialChip(m, 'relax').click();
        await flush();
        const entry = shipEntryForTodo.mock.calls[0][0].entryText;
        expect(entry.split('\n')[0]).toBe(
            '- [ ] **[MEDIUM]** Relax rankProjects in taskSort.js to O(n^2)');
        expect(entry).toContain('trading the tighter bound for a simpler implementation');
        expect(entry).toContain('Implementation: drop the sort and compare pairwise for clarity');
    });

    it('confirms, retires the hotspot, and drops the badge count', async () => {
        const m = await openDial(0);
        expect(m.chip.querySelector('.complexityChipLabel').textContent).toBe('2');
        dialChip(m, 'tighten').click();
        await flush();

        expect(m.wrap.querySelector('.complexityActionShipped').textContent)
            .toBe('Entry shipped — run dispatched');
        expect(markComplexityHotspotPushed).toHaveBeenCalledWith('o/r', PATH, 'computeStreak');
        expect(m.chip.querySelector('.complexityChipLabel').textContent).toBe('1');

        await vi.advanceTimersByTimeAsync(PUSHED_ADVANCE_MS);
        expect(m.wrap.querySelector('.complexityActionRow')).toBeNull();
        expect(hotspotRows(m)[0].classList.contains('complexityHotspotRow--pushed')).toBe(true);
    });

    it('blocks the push while a run is in flight on the repo', async () => {
        activeRunsResult = { ok: true, active: true };
        const m = await openDial(0);
        dialChip(m, 'tighten').click();
        await flush();

        expect(shipEntryForTodo).not.toHaveBeenCalled();
        expect(m.wrap.querySelector('.complexityActionNote').textContent)
            .toBe('A run is already in flight — try again once it lands.');
        expect(dialChip(m, 'tighten').disabled).toBe(false);
        expect(dialChip(m, 'tighten').textContent).toBe('O↓ tighten');
    });

    it('fails closed when the in-flight probe itself fails', async () => {
        activeRunsResult = { ok: false, reason: 'worker 502' };
        const m = await openDial(0);
        dialChip(m, 'tighten').click();
        await flush();

        expect(shipEntryForTodo).not.toHaveBeenCalled();
        expect(m.wrap.querySelector('.complexityActionNote').textContent)
            .toContain('the push was not attempted');
    });

    it('refuses to push at all when the injector isn’t configured', async () => {
        injectConfigured = false;
        const m = await openDial(0);
        const dial = dialChip(m, 'tighten');
        expect(dial.disabled).toBe(true);
        dial.click();
        await flush();
        expect(fetchActiveRuns).not.toHaveBeenCalled();
        expect(shipEntryForTodo).not.toHaveBeenCalled();
    });

    it('surfaces a ship failure inline and leaves the hotspot open', async () => {
        shipResult = { ok: false, error: 'Inject failed — 404' };
        const m = await openDial(0);
        dialChip(m, 'tighten').click();
        await flush();

        expect(m.wrap.querySelector('.complexityActionNote').textContent)
            .toBe('Couldn’t ship the entry — Inject failed — 404');
        expect(markComplexityHotspotPushed).not.toHaveBeenCalled();
        expect(m.chip.querySelector('.complexityChipLabel').textContent).toBe('2');
        expect(hotspotRows(m)[0].classList.contains('complexityHotspotRow--pushed')).toBe(false);
    });
});

describe('rescanning from the nest header', () => {
    it('re-dispatches for this file and re-renders the nest from the fresh row', async () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        nestOf(m).querySelector('.complexityNestRescan').click();
        await flush();

        expect(dispatchComplexityScan).toHaveBeenCalledTimes(1);
        expect(dispatchComplexityScan.mock.calls[0][1]).toBe(PATH);
        expect(m.chip.dataset.state).toBe('scanning');
        expect(nestOf(m).querySelector('.complexityNestRescan').disabled).toBe(true);

        loadResult = {
            ok: true,
            rows: [scanRow(PATH, {
                sha: 'sha-2',
                hotspots: [hotspot('computeStreak')],
                pushed: ['computeStreak'],
                scanned_at: hoursAgo(0),
            })],
        };
        await vi.advanceTimersByTimeAsync(POLL_MS);

        expect(m.chip.dataset.state).toBe('clean');
        expect(nestOf(m).querySelector('.complexityNestAge').textContent).toBe('scanned just now');
        const rows = hotspotRows(m);
        expect(rows).toHaveLength(1);
        expect(rows[0].classList.contains('complexityHotspotRow--pushed')).toBe(true);
    });

    it('resolves an expired rescan with an unchanged sha as no-change, not error', async () => {
        const row = scanRow(PATH);
        const m = mountRow(PATH);
        setComplexityScans('o/r', [row]);
        m.chip.click();
        loadResult = { ok: true, rows: [row] };
        nestOf(m).querySelector('.complexityNestRescan').click();
        await flush();

        await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS);

        expect(m.chip.dataset.state).toBe('count');
        expect(nestOf(m).querySelector('.complexityNestAge').textContent)
            .toBe('no change since last scan');
        expect(nestOf(m).querySelector('.complexityNestRescan').disabled).toBe(false);

        // The note is transient — the scanned age comes back on its own.
        await vi.advanceTimersByTimeAsync(NOTE_MS);
        expect(nestOf(m).querySelector('.complexityNestAge').textContent)
            .toBe('scanned 2h ago');
    });

    it('still fails loudly when the rescan never sees the row at all', async () => {
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        loadResult = { ok: false, error: 'Not signed in.' };
        nestOf(m).querySelector('.complexityNestRescan').click();
        await flush();

        await vi.advanceTimersByTimeAsync(POLL_TIMEOUT_MS + POLL_MS);
        expect(m.chip.dataset.state).toBe('error');
    });

    it('disables rescan while another file is being scanned', async () => {
        const other = mountRow('toDoList_main/src/other.js');
        const m = mountRow(PATH);
        setComplexityScans('o/r', [scanRow(PATH)]);
        m.chip.click();
        expect(nestOf(m).querySelector('.complexityNestRescan').disabled).toBe(false);

        other.chip.click(); // an unscanned file dispatches its first scan
        await flush();
        expect(nestOf(m).querySelector('.complexityNestRescan').disabled).toBe(true);
        expect(dispatchComplexityScan).toHaveBeenCalledTimes(1);
    });
});
