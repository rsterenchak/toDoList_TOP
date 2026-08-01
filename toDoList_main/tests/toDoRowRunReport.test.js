import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The ACCEPT face surfaces a shipped run's closing summary — the agent's verdict on
// what it did and what it noticed but did not fix. For a SHIPPED run that summary is
// not persisted on the queue row (only the no_change / failed reconcile stores it),
// so the face fetches it on demand through the SAME Worker `run_result` route the
// store uses (fetchRunResult), renders it as a distinct block beneath WHAT CHANGED,
// and folds it into the COPY CONTEXT block. Only fetchRunResult is stubbed; the rest
// of inject.js is the real module so toDoRow's other imports keep working.

// Stub ONLY fetchRunResult; spread the rest of the real inject.js so toDoRow's
// other imports (and any transitive consumer) keep working. The mock fn is hoisted
// so it exists before module evaluation binds it — a factory-local vi.fn does not
// intercept toDoRow's live binding, a hoisted one does.
const { fetchRunResult } = vi.hoisted(() => ({ fetchRunResult: vi.fn() }));
vi.mock('../src/inject.js', async (importOriginal) => {
    const actual = await importOriginal();
    return { ...actual, fetchRunResult };
});

import {
    buildIterateContextBlock,
    buildRunReportBlock,
    mountRunReportBlock,
    buildReviewActions,
    DESC_PANEL_CHILD_SELECTORS,
} from '../src/toDoRow.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

const MARKER = '<!-- id: 83e4595d-a343-471c-a7f5-39c678274460 -->';
const ENTRY_DESC = [
    '- [ ] **[MEDIUM]** Add a widget',
    '  - Type: feature',
    '  - Description: does a thing',
    '  - File: `src/a.js`',
    '  ' + MARKER,
].join('\n');

let seq = 0;
function makeItem(overrides) {
    seq += 1;
    return Object.assign({
        id: 't' + seq,
        tit: 'Add a widget',
        entryId: 'e' + seq,
        desc: ENTRY_DESC,
    }, overrides || {});
}

// Host with a mounted ACCEPT action row for `item` — mountRunReportBlock re-checks
// that this row is still present (same entry) before mounting the async summary.
function hostWithActions(item) {
    const host = document.createElement('div');
    const actions = buildReviewActions(item, 'Proj');
    host.appendChild(actions);
    return { host, actions };
}

describe('buildIterateContextBlock — run-report section', () => {
    it('includes the summary section, after the entry and before the placeholder, when present', () => {
        const block = buildIterateContextBlock(makeItem(), null, 'o/r', 'The run added X. Left Y alone.');
        expect(block).toContain('--- what the run reported ---');
        expect(block).toContain('The run added X. Left Y alone.');
        expect(block.indexOf('--- the entry as shipped ---'))
            .toBeLessThan(block.indexOf('--- what the run reported ---'));
        expect(block.indexOf('--- what the run reported ---'))
            .toBeLessThan(block.indexOf('--- what I want changed ---'));
    });

    it('omits the section entirely when the summary is empty or absent', () => {
        expect(buildIterateContextBlock(makeItem(), null, 'o/r', '')).not.toContain('--- what the run reported ---');
        expect(buildIterateContextBlock(makeItem(), null, 'o/r', '   ')).not.toContain('--- what the run reported ---');
        expect(buildIterateContextBlock(makeItem(), null, 'o/r')).not.toContain('--- what the run reported ---');
        // The placeholder is still always present.
        expect(buildIterateContextBlock(makeItem(), null, 'o/r')).toContain('--- what I want changed ---');
    });
});

describe('buildRunReportBlock — pure DOM assembly', () => {
    it('returns null when there is no summary', () => {
        expect(buildRunReportBlock('')).toBeNull();
        expect(buildRunReportBlock('   ')).toBeNull();
        expect(buildRunReportBlock(null)).toBeNull();
        expect(buildRunReportBlock(undefined)).toBeNull();
    });

    it('renders a labelled block carrying the summary text', () => {
        const block = buildRunReportBlock('It shipped the toggle and noted the drawer needs work.');
        expect(block).not.toBeNull();
        expect(block.classList.contains('descRunReportBlock')).toBe(true);
        expect(block.querySelector('.descRunReportHeading').textContent).toMatch(/what the run reported/i);
        expect(block.querySelector('.descRunReportBody').textContent)
            .toBe('It shipped the toggle and noted the drawer needs work.');
        // A summary with no `Follow-ups:` line falls back to the clamped-whole path:
        // one body, no split, and the toggle starts hidden (revealed only on overflow).
        expect(block.classList.contains('descRunReportBlock--split')).toBe(false);
        expect(block.querySelector('.descRunReportFollowups')).toBeNull();
        expect(block.querySelector('.descRunReportToggle').hidden).toBe(true);
    });
});

describe('buildRunReportBlock — three-part split', () => {
    const THREE_PART = [
        'Shipped the run summary card split so the verdict shows at a glance.',
        'Follow-ups: The legacy toggle helper is unused and could be removed.',
        '',
        'Ran in entry mode for target id cd54720d. Implemented the split, added tests, opened a PR, and auto-merged. The detail paragraph carries the bookkeeping nobody glances at first.',
    ].join('\n');

    it('renders verdict plus follow-ups collapsed and the detail behind Show more', () => {
        const block = buildRunReportBlock(THREE_PART);
        expect(block.classList.contains('descRunReportBlock--split')).toBe(true);

        const verdict = block.querySelector('.descRunReportBody');
        expect(verdict.textContent).toBe('Shipped the run summary card split so the verdict shows at a glance.');

        const follow = block.querySelector('.descRunReportFollowups');
        expect(follow.textContent).toBe('Follow-ups: The legacy toggle helper is unused and could be removed.');
        // Real content → normal emphasis, not the reduced-emphasis "none" treatment.
        expect(follow.classList.contains('is-none')).toBe(false);

        const detail = block.querySelector('.descRunReportDetail');
        expect(detail).not.toBeNull();
        expect(detail.textContent).toContain('Ran in entry mode for target id cd54720d.');
        // The detail paragraph is NOT part of the collapsed verdict/follow-ups content.
        expect(verdict.textContent).not.toContain('Ran in entry mode');
        expect(follow.textContent).not.toContain('Ran in entry mode');

        // The toggle is present and starts collapsed; clicking expands, clicking again collapses.
        const toggle = block.querySelector('.descRunReportToggle');
        expect(toggle.hidden).toBe(false);
        expect(toggle.textContent).toBe('Show more');
        expect(block.classList.contains('is-expanded')).toBe(false);
        toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(block.classList.contains('is-expanded')).toBe(true);
        expect(toggle.textContent).toBe('Show less');
        toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(block.classList.contains('is-expanded')).toBe(false);
        expect(toggle.textContent).toBe('Show more');
    });

    it('renders `Follow-ups: none.` at reduced emphasis', () => {
        const block = buildRunReportBlock([
            'Nothing needed doing beyond the one change.',
            'Follow-ups: none.',
            '',
            'The full detail paragraph goes here for the curious.',
        ].join('\n'));
        const follow = block.querySelector('.descRunReportFollowups');
        expect(follow.textContent).toBe('Follow-ups: none.');
        expect(follow.classList.contains('is-none')).toBe(true);
    });

    it('resolves the split on the Follow-ups label even when the verdict wraps across lines', () => {
        const block = buildRunReportBlock([
            'Shipped a fairly long verdict sentence that a narrow terminal',
            'wrapped across two physical lines before the label.',
            'Follow-ups: none.',
            '',
            'Detail paragraph.',
        ].join('\n'));
        expect(block.classList.contains('descRunReportBlock--split')).toBe(true);
        const verdict = block.querySelector('.descRunReportBody');
        expect(verdict.textContent).toContain('Shipped a fairly long verdict sentence');
        expect(verdict.textContent).toContain('before the label.');
        // The label line is not swept into the verdict body.
        expect(verdict.textContent).not.toContain('Follow-ups:');
        expect(block.querySelector('.descRunReportFollowups').textContent).toBe('Follow-ups: none.');
        expect(block.querySelector('.descRunReportDetail').textContent).toBe('Detail paragraph.');
    });

    it('shows no toggle when a three-part summary has an empty detail paragraph', () => {
        const block = buildRunReportBlock('Shipped it.\nFollow-ups: none.');
        expect(block.classList.contains('descRunReportBlock--split')).toBe(true);
        expect(block.querySelector('.descRunReportDetail')).toBeNull();
        expect(block.querySelector('.descRunReportToggle')).toBeNull();
    });
});

describe('buildIterateContextBlock — carries the full summary regardless of shape', () => {
    it('includes the entire three-part summary verbatim, detail paragraph and all', () => {
        const summary = [
            'Shipped the split card.',
            'Follow-ups: none.',
            '',
            'Ran in entry mode. Full detail here that COPY CONTEXT must still carry.',
        ].join('\n');
        const block = buildIterateContextBlock(makeItem(), null, 'o/r', summary);
        expect(block).toContain('--- what the run reported ---');
        expect(block).toContain(summary.trim());
        expect(block).toContain('Ran in entry mode. Full detail here that COPY CONTEXT must still carry.');
    });
});

describe('mountRunReportBlock — async fetch + mount', () => {
    beforeEach(() => {
        fetchRunResult.mockReset();
        fetchRunResult.mockResolvedValue({ ok: false });
    });

    it('mounts the block when a shipped run has a summary, leaving the decision controls intact', async () => {
        fetchRunResult.mockResolvedValueOnce({ ok: true, result: 'The run did the thing.' });
        const item = makeItem();
        const { host, actions } = hostWithActions(item);

        await mountRunReportBlock(host, item, { run_id: 4101 }, actions, null);

        const block = host.querySelector('.descRunReportBlock');
        expect(block).not.toBeNull();
        expect(block.textContent).toContain('The run did the thing.');
        // Sits between WHAT CHANGED and the action row (before the actions anchor).
        expect(block.nextElementSibling).toBe(actions);
        // The decision controls survive.
        expect(host.querySelector('.descReviewActions')).not.toBeNull();
    });

    it('renders nothing when the run has no summary', async () => {
        fetchRunResult.mockResolvedValueOnce({ ok: true, result: '   ' });
        const item = makeItem();
        const { host, actions } = hostWithActions(item);

        await mountRunReportBlock(host, item, { run_id: 4102 }, actions, null);

        expect(host.querySelector('.descRunReportBlock')).toBeNull();
        expect(host.querySelector('.descReviewActions')).not.toBeNull();
    });

    it('renders nothing and does not block the controls when the fetch fails', async () => {
        fetchRunResult.mockResolvedValueOnce({ ok: false, reason: 'network' });
        const item = makeItem();
        const { host, actions } = hostWithActions(item);

        await mountRunReportBlock(host, item, { run_id: 4103 }, actions, null);

        expect(host.querySelector('.descRunReportBlock')).toBeNull();
        expect(host.querySelector('.descReviewActions')).not.toBeNull();
    });

    it('renders nothing when the fetch rejects outright', async () => {
        fetchRunResult.mockRejectedValueOnce(new Error('boom'));
        const item = makeItem();
        const { host, actions } = hostWithActions(item);

        await mountRunReportBlock(host, item, { run_id: 4104 }, actions, null);

        expect(host.querySelector('.descRunReportBlock')).toBeNull();
    });

    it('does not fetch at all when the queue row carries no run id', async () => {
        const item = makeItem();
        const { host, actions } = hostWithActions(item);

        const block = await mountRunReportBlock(host, item, {}, actions, null);

        expect(block).toBeNull();
        expect(fetchRunResult).not.toHaveBeenCalled();
        expect(host.querySelector('.descRunReportBlock')).toBeNull();
    });

    it('drops a resolved summary if the ACCEPT face for that entry is gone (accepted mid-fetch)', async () => {
        fetchRunResult.mockResolvedValueOnce({ ok: true, result: 'Too late.' });
        const item = makeItem();
        const { host, actions } = hostWithActions(item);
        // Simulate the task being accepted (its action row removed) while the fetch
        // was in flight.
        actions.remove();

        await mountRunReportBlock(host, item, { run_id: 4105 }, actions, null);

        expect(host.querySelector('.descRunReportBlock')).toBeNull();
    });

    it('is idempotent — a second mount for the same entry keeps the existing block without re-fetching', async () => {
        fetchRunResult.mockResolvedValueOnce({ ok: true, result: 'Once only.' });
        const item = makeItem();
        const { host, actions } = hostWithActions(item);

        await mountRunReportBlock(host, item, { run_id: 4106 }, actions, null);
        expect(host.querySelectorAll('.descRunReportBlock').length).toBe(1);
        const callsAfterFirst = fetchRunResult.mock.calls.length;

        await mountRunReportBlock(host, item, { run_id: 4106 }, actions, null);
        expect(host.querySelectorAll('.descRunReportBlock').length).toBe(1);
        // Same entry already mounted → no second fetch.
        expect(fetchRunResult.mock.calls.length).toBe(callsAfterFirst);
    });

    it('fires options.onRender after a successful mount so the pane re-snapshots its height', async () => {
        fetchRunResult.mockResolvedValueOnce({ ok: true, result: 'Rendered.' });
        const item = makeItem();
        const { host, actions } = hostWithActions(item);
        const onRender = vi.fn();

        await mountRunReportBlock(host, item, { run_id: 4107 }, actions, { onRender });

        expect(onRender).toHaveBeenCalled();
    });
});

describe('run-report block — source-pinned wiring', () => {
    const toDoRow = read('toDoRow.js');
    const modals = read('modals.js');
    const css = read('style.css');

    it('is registered as a grid-placed desc-panel child', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descRunReportBlock');
        const idx = css.indexOf('#descSibling .descRunReportBlock {');
        expect(idx).toBeGreaterThan(-1);
        const body = css.slice(idx, css.indexOf('}', idx));
        expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    });

    it('reuses fetchRunResult from inject.js rather than adding a second fetch', () => {
        expect(toDoRow).toMatch(/import \{[^}]*fetchRunResult[^}]*\} from '\.\/inject\.js'/s);
        expect(toDoRow).toMatch(/fetchRunResult\(runKey,/);
    });

    it('mounts on both hosts — the desktop pane (syncReviewPanel) and the mobile modal', () => {
        expect(toDoRow).toMatch(/mountRunReportBlock\(panel, item, queueRow, reviewActions,/);
        expect(modals).toMatch(/mountRunReportBlock\(body, item, queueRow, actionsRow,/);
    });

    it('is NOT swept into the done-phase authoring hide', () => {
        const start = toDoRow.indexOf('DESC_AUTHORING_GROUP_SELECTORS = Object.freeze([');
        const group = toDoRow.slice(start, toDoRow.indexOf(']', start));
        expect(group).not.toMatch(/descRunReport/);
    });

    it('leaves the store no_change summary surfacing untouched (still stored on failure_reason)', () => {
        const store = read('agentQueueStore.js');
        // The no_change reconcile still writes the closing summary into failure_reason.
        expect(store).toMatch(/state:\s*'no_change'[\s\S]{0,120}failure_reason:\s*summary/);
    });
});
