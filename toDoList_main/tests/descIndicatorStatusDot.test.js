import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

import {
    hasShippedRunForEntry,
    resolveEntryRunState,
    markEntryPresentLocally,
    forgetEntryMarkerLocally,
    refreshShippedMarkers,
    initInjectConfig,
} from '../src/inject.js';
// refreshDescStatusDots is exactly what the module-level TODO_RUN_STATUS_EVENT
// listener delegates to; calling it drives the same production dot logic.
import { refreshDescStatusDots } from '../src/toDoRow.js';
import { buildStatusLabel, applyTodoStatusClass } from '../src/todoStatus.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Feature: a run-status glyph occupying the leading #descIndicator slot — a
// green filled check once the row's injected entry has shipped (its `<!-- id -->`
// marker sits on a `[x]` entry in the routed target's TODO.md), an amber dashed
// ring while injected-but-pending, and nothing when the task carries no entry
// id. Shipped-truth is read from the shared TODO.md (the cross-device source of
// truth), not the device-local todoapp_claudeRuns store, so the glyph agrees
// across devices. buildToDoRow is too heavily wired to instantiate here, so the
// DOM behaviour is driven through a light #toDoChild stand-in plus the marker
// cache the production code reads.

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

describe('resolveEntryRunState — three-way shipped / pending / none', () => {
    it('returns "none" for a falsy id and for an id absent from every cache', () => {
        expect(resolveEntryRunState('')).toBe('none');
        expect(resolveEntryRunState(null)).toBe('none');
        expect(resolveEntryRunState('never-seen-anywhere')).toBe('none');
    });

    it('returns "pending" for a present-but-unchecked marker and "shipped" for a checked one', async () => {
        const md = [
            '- [ ] Not done',
            '  <!-- id: state-pending -->',
            '- [x] Done',
            '  <!-- id: state-shipped -->',
        ].join('\n');
        mockTodoMd(md);
        await refreshShippedMarkers(freshTarget());
        expect(resolveEntryRunState('state-pending')).toBe('pending');
        expect(resolveEntryRunState('state-shipped')).toBe('shipped');
        // An id that was never in this (or any) TODO.md read resolves to none.
        expect(resolveEntryRunState('state-absent')).toBe('none');
    });

    it('drops back to "none" when a previously-present marker is deleted from TODO.md', async () => {
        // Regression: the amber ring used to be sticky — an id present but not
        // shipped rendered pending forever, even after the entry was deleted.
        const target = freshTarget();
        mockTodoMd('- [ ] Queued\n  <!-- id: to-delete -->');
        await refreshShippedMarkers(target);
        expect(resolveEntryRunState('to-delete')).toBe('pending');

        // The entry is deleted from TODO.md; a forced re-read of the same repo
        // (as the viewer's delete path does) replaces the set without the id.
        mockTodoMd('# TODO LIST\n');
        await refreshShippedMarkers(target, true);
        expect(resolveEntryRunState('to-delete')).toBe('none');
    });
});

describe('optimistic marker helpers — instant amber on inject, instant clear on delete', () => {
    it('markEntryPresentLocally makes an id resolve as pending before any read', () => {
        expect(resolveEntryRunState('optimistic-id')).toBe('none');
        markEntryPresentLocally('owner/opt-repo', 'optimistic-id');
        expect(resolveEntryRunState('optimistic-id')).toBe('pending');
    });

    it('forgetEntryMarkerLocally clears an id from every cached repo', async () => {
        mockTodoMd('- [ ] Queued\n  <!-- id: forget-id -->');
        await refreshShippedMarkers(freshTarget());
        expect(resolveEntryRunState('forget-id')).toBe('pending');
        forgetEntryMarkerLocally('forget-id');
        expect(resolveEntryRunState('forget-id')).toBe('none');
    });

    it('the row glyph clears in place when its entry marker is forgotten', async () => {
        mockTodoMd('- [ ] Queued\n  <!-- id: glyph-clear-id -->');
        await refreshShippedMarkers(freshTarget());
        const { indicator } = makeRow({ entryId: 'glyph-clear-id', injectedAt: null });
        refreshDescStatusDots();
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(true);

        forgetEntryMarkerLocally('glyph-clear-id');
        refreshDescStatusDots();
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(false);
        expect(indicator.classList.contains('runStatusGlyph--shipped')).toBe(false);
        expect(indicator.innerHTML).toBe('');
    });
});

describe('run-status glyph — live refresh through the marker cache', () => {
    it('renders no glyph when the task carries no entry id', () => {
        const { indicator } = makeRow({ entryId: null, injectedAt: null });
        refreshDescStatusDots();
        expect(indicator.classList.contains('runStatusGlyph--shipped')).toBe(false);
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(false);
        expect(indicator.innerHTML).toBe('');
    });

    it('shows no glyph for a task with only a local injectedAt and no entry id', () => {
        // injectedAt is local-only and no longer a signal — the gate is the
        // synced entry id, so an injectedAt without an id paints nothing.
        const { indicator } = makeRow({ entryId: null, injectedAt: 1700000000000 });
        refreshDescStatusDots();
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(false);
        expect(indicator.innerHTML).toBe('');
    });

    it('renders an amber pending glyph when the entry marker is present but unchecked', async () => {
        // Pending now requires the marker to actually be present (unchecked) in
        // the routed TODO.md — an id absent from every read shows no glyph.
        mockTodoMd('- [ ] not done\n  <!-- id: pending-glyph-id -->');
        await refreshShippedMarkers(freshTarget());
        const { indicator } = makeRow({ entryId: 'pending-glyph-id', injectedAt: null });
        refreshDescStatusDots();
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(true);
        expect(indicator.classList.contains('runStatusGlyph--shipped')).toBe(false);
        expect(indicator.querySelector('svg')).not.toBeNull();
    });

    it('renders a green shipped glyph once the entry marker is checked AND acknowledged (done phase)', async () => {
        // The green check now marks the 'done' phase only — checked in TODO.md
        // AND acknowledged (entryReviewedAt set). A checked-but-unacknowledged
        // entry is the 'accept' phase, whose single mark is the REVIEW badge, so
        // its glyph is suppressed (covered by the suppression test below).
        mockTodoMd('- [x] shipped\n  <!-- id: green-glyph-id -->');
        await refreshShippedMarkers(freshTarget());
        const { indicator } = makeRow({
            entryId: 'green-glyph-id', injectedAt: 1700000000000,
            entryReviewedAt: '2026-07-22T00:00:00.000Z',
        });
        refreshDescStatusDots();
        expect(indicator.classList.contains('runStatusGlyph--shipped')).toBe(true);
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(false);
        expect(indicator.querySelector('svg')).not.toBeNull();
    });

    it('suppresses the glyph for a checked-but-unacknowledged entry (accept phase)', async () => {
        // Regression guard for the consolidation: an unreviewed shipped row used
        // to paint the green check AND the amber REVIEW badge, marking one fact
        // twice. The REVIEW badge is now the row's single pipeline mark, so the
        // glyph slot stays empty until the entry is acknowledged.
        mockTodoMd('- [x] shipped\n  <!-- id: accept-glyph-id -->');
        await refreshShippedMarkers(freshTarget());
        const { indicator } = makeRow({ entryId: 'accept-glyph-id', injectedAt: 1700000000000 });
        refreshDescStatusDots();
        expect(indicator.classList.contains('runStatusGlyph--shipped')).toBe(false);
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(false);
        expect(indicator.innerHTML).toBe('');
    });

    it('flips a pending glyph to shipped in place when the marker cache resolves', async () => {
        // The routed TODO.md first shows the entry present-but-unchecked. The
        // item is already acknowledged, so once the marker is checked it lands in
        // the 'done' phase and paints the green check (an unacknowledged entry
        // would land in 'accept' and suppress the glyph instead).
        mockTodoMd('- [ ] not done yet\n  <!-- id: flip-glyph-id -->');
        await refreshShippedMarkers(freshTarget());
        const { indicator } = makeRow({
            entryId: 'flip-glyph-id', injectedAt: 1700000000000,
            entryReviewedAt: '2026-07-22T00:00:00.000Z',
        });
        refreshDescStatusDots();
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(true);

        // The routed TODO.md now shows the entry checked; refresh + re-sweep.
        mockTodoMd('- [x] shipped\n  <!-- id: flip-glyph-id -->');
        await refreshShippedMarkers(freshTarget());
        refreshDescStatusDots();
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(false);
        expect(indicator.classList.contains('runStatusGlyph--shipped')).toBe(true);
        expect(indicator.querySelectorAll('svg').length).toBe(1); // reused, not duplicated
    });
});

describe('derived REVIEW badge — lights on shipped-but-unacknowledged, live via the sweep', () => {
    // A committed row also carries a `.todoStatusLabel`; the sweep refreshes it
    // alongside the glyph. Build one with both the indicator and the badge.
    function makeCommittedRow(item) {
        const ml = document.getElementById('mainList') || (function () {
            const el = document.createElement('div');
            el.id = 'mainList';
            document.body.appendChild(el);
            return el;
        })();
        const row = document.createElement('div');
        row.id = 'toDoChild';
        row.__item = item;
        row.setAttribute('data-value', 'Inbox');
        const indicator = document.createElement('span');
        indicator.id = 'descIndicator';
        row.appendChild(indicator);
        applyTodoStatusClass(row, item.status);
        row.appendChild(buildStatusLabel(item, false));
        ml.appendChild(row);
        return { row, indicator, label: row.querySelector('.todoStatusLabel') };
    }

    it('flips the badge to REVIEW once the entry marker is checked and unacknowledged', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: review-ship-id -->');
        await refreshShippedMarkers(freshTarget());
        const { label } = makeCommittedRow({
            status: 'active', tit: 'Ship me', entryId: 'review-ship-id',
        });
        // Built as the manual status; the sweep derives review from the cache.
        expect(label.getAttribute('data-status')).toBe('active');

        refreshDescStatusDots();
        expect(label.getAttribute('data-status')).toBe('review');
        expect(label.textContent).toBe('⌁ REVIEW');
    });

    it('does NOT show REVIEW once the entry has been acknowledged (entryReviewedAt set)', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: review-ack-id -->');
        await refreshShippedMarkers(freshTarget());
        const { label } = makeCommittedRow({
            status: 'idea', tit: 'Acked', entryId: 'review-ack-id',
            entryReviewedAt: '2026-07-22T00:00:00.000Z',
        });

        refreshDescStatusDots();
        expect(label.getAttribute('data-status')).toBe('idea');
        expect(label.textContent).toBe('○ IDEA');
    });

    it('does NOT show REVIEW while the entry is only pending (unchecked marker)', async () => {
        mockTodoMd('- [ ] not done\n  <!-- id: review-pending-id -->');
        await refreshShippedMarkers(freshTarget());
        const { indicator, label } = makeCommittedRow({
            status: 'active', tit: 'Pending', entryId: 'review-pending-id',
        });

        refreshDescStatusDots();
        // Glyph is amber pending, but the badge stays on the manual status.
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(true);
        expect(label.getAttribute('data-status')).toBe('active');
    });

    it('an accept row states its pipeline position exactly once — REVIEW badge, no glyph', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: single-mark-accept-id -->');
        await refreshShippedMarkers(freshTarget());
        const { indicator, label } = makeCommittedRow({
            status: 'active', tit: 'Awaiting review', entryId: 'single-mark-accept-id',
        });

        refreshDescStatusDots();
        // The badge carries REVIEW…
        expect(label.getAttribute('data-status')).toBe('review');
        // …and the glyph is suppressed, so the shipped fact is marked once.
        expect(indicator.classList.contains('runStatusGlyph--shipped')).toBe(false);
        expect(indicator.classList.contains('runStatusGlyph--pending')).toBe(false);
        expect(indicator.innerHTML).toBe('');
    });

    it('acknowledging an accept row restores both the manual status badge and the green check (done)', async () => {
        mockTodoMd('- [x] shipped\n  <!-- id: ack-restore-id -->');
        await refreshShippedMarkers(freshTarget());
        const item = { status: 'in_progress', tit: 'Ship then ack', entryId: 'ack-restore-id' };
        const { indicator, label } = makeCommittedRow(item);

        refreshDescStatusDots();
        expect(label.getAttribute('data-status')).toBe('review');
        expect(indicator.innerHTML).toBe('');

        // Acknowledge (as the viewer's Acknowledge pill does) and re-sweep.
        item.entryReviewedAt = '2026-07-22T00:00:00.000Z';
        refreshDescStatusDots();
        expect(label.getAttribute('data-status')).toBe('in_progress');
        expect(indicator.classList.contains('runStatusGlyph--shipped')).toBe(true);
        expect(indicator.querySelector('svg')).not.toBeNull();
    });
});

describe('wiring — dot is driven by the shared TODO.md, synced entry id, and events', () => {
    const toDoRow = read('toDoRow.js');
    const inject = read('inject.js');
    const listLogic = read('listLogic.js');
    const claudeSheet = read('claudeSheet.js');
    const todoMdViewer = read('todoMdViewer.js');
    const css = read('style.css');

    it('derivePhase (phase.js) resolves the run state via resolveEntryRunState, and applyRunStatusGlyph consumes the derived phase', () => {
        const phase = read('phase.js');
        // The three-way run state now resolves once, inside derivePhase.
        expect(phase).toMatch(
            /function\s+derivePhase[\s\S]{0,300}resolveEntryRunState\(item\.entryId\)/
        );
        // The glyph function no longer re-resolves the entry id — it maps the
        // already-derived phase to a glyph state.
        expect(toDoRow).toMatch(
            /function\s+applyRunStatusGlyph\s*\(\s*descIndicator\s*,\s*phase\s*\)/
        );
        expect(toDoRow).not.toMatch(/function\s+applyRunStatusGlyph[\s\S]{0,200}resolveEntryRunState/);
    });

    it('injectDescription optimistically marks present and force-refreshes markers', () => {
        expect(inject).toMatch(
            /markEntryPresentLocally\(target\.repo,\s*item\.entryId\)[\s\S]{0,120}refreshShippedMarkers\(target,\s*true\)/
        );
    });

    it('the viewer delete path forgets the marker and force-refreshes on success', () => {
        expect(todoMdViewer).toMatch(
            /performRewrite\(\s*['"]delete_entry['"][\s\S]{0,400}forgetEntryMarkerLocally\(entryId\)[\s\S]{0,120}refreshShippedMarkers\(target,\s*true\)/
        );
    });

    it('parseTodoMdMarkers records both present and shipped marker sets', () => {
        expect(inject).toMatch(
            /function\s+parseTodoMdMarkers[\s\S]{0,400}present\.add\(current\.id\)[\s\S]{0,120}if\s*\(current\.checked\)\s*shipped\.add\(current\.id\)/
        );
    });

    it('buildToDoRow renders the status glyph from the derived phase right after inserting the indicator', () => {
        expect(toDoRow).toMatch(
            /insertBefore\(descIndicator,\s*toDoInput\);[\s\S]{0,600}applyRunStatusGlyph\(descIndicator,\s*phase\)/
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

    it('refreshShippedMarkersForProject passes a force flag through to refreshShippedMarkers', () => {
        expect(inject).toMatch(
            /export\s+function\s+refreshShippedMarkersForProject\s*\(\s*projectName\s*,\s*force\s*\)[\s\S]{0,600}refreshShippedMarkers\(target,\s*force\)/
        );
    });

    it('setRunRecordStatus force-refreshes the routed project markers when a run reaches SHIPPED', () => {
        // Regression: without force, the 60s marker TTL kept the row glyph amber
        // for up to a minute after a run actually shipped.
        expect(claudeSheet).toMatch(
            /status\s*===\s*['"]SHIPPED['"][\s\S]{0,900}refreshShippedMarkersForProject\(\s*changedProject\s*,\s*true\s*\)/
        );
    });

    it('listLogic syncs the entry id both ways (payload + hydrate)', () => {
        expect(listLogic).toMatch(/entry_id:\s*item\.entryId\s*\|\|\s*null/);
        expect(listLogic).toMatch(/entryId:\s*t\.entry_id\s*\|\|/);
    });

    it('listLogic realtime carries entry_id only when present, never clobbering a local id', () => {
        expect(listLogic).toMatch(/if\s*\(evt\.new\.entry_id\)\s*mapped\.entryId\s*=\s*evt\.new\.entry_id/);
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

    it('the glyph states are colored from theme tokens in the leading slot', () => {
        expect(css).toMatch(/#descIndicator\.runStatusGlyph--shipped\s*\{[\s\S]{0,80}color:\s*var\(--type-feature\)/);
        expect(css).toMatch(/#descIndicator\.runStatusGlyph--pending\s*\{[\s\S]{0,80}color:\s*var\(--text-warning\)/);
    });
});
