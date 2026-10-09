import { vi } from 'vitest';
import { mountClaudeSheet } from '../src/claudeSheet.js';
import { setQueueRows } from '../src/agentQueueStore.js';

// claudeSheet → inject → supabaseClient, and agentQueueStore → supabaseClient.
// Stub the shared client so importing these modules never reaches the network;
// this mirrors the minimal surface the other claudeSheet tests rely on. The queue
// rows the Runs tab reads are seeded directly through setQueueRows (an in-memory
// cache write), so no query result needs to be mocked here.
vi.mock('../src/supabaseClient.js', () => {
    function makeQuery() {
        const q = {
            select: function() { return q; },
            order: function() { return Promise.resolve({ data: [], error: null }); },
            insert: function() { return Promise.resolve({ data: null, error: null }); },
            update: function() { return q; },
            delete: function() { return q; },
            eq: function() { return Promise.resolve({ data: null, error: null }); },
        };
        return q;
    }
    return {
        supabase: {
            auth: {
                getSession: function() { return Promise.resolve({ data: { session: null }, error: null }); },
                onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
                signInWithOtp: function() { return Promise.resolve({ data: null, error: { message: 'x' } }); },
                signOut: function() { return Promise.resolve({ error: null }); },
            },
            from: function() { return makeQuery(); },
            channel: function() { return { on: function() { return this; }, subscribe: function() { return this; }, unsubscribe: function() { return this; } }; },
            removeChannel: function() {},
        },
    };
});

function draftFor(title) {
    return '- [ ] **[MEDIUM]** ' + title + '\n  - Type: feature\n  <!-- id: x -->';
}

function twoShotVerify() {
    return {
        uploaded_at: '2026-10-09T12:00:00Z',
        ok: true,
        summary: 'Both viewports render the board.',
        lines: ['1300x900, 390x844 → /'],
        run_id: 42,
        shots: [
            { file: 'a.png', url: 'https://cdn.example/verify/a.png', viewport: '1300x900', route: '/', steps: 'click "Fight"', stepsOk: true, verdict: 'fits after Fight' },
            { file: 'b.png', url: 'https://cdn.example/verify/b.png', viewport: '390x844', route: '/', steps: '', stepsOk: true, scrollHeight: 900, innerHeight: 844, overflowY: 'hidden' },
        ],
    };
}

describe('Runs tab — verification screenshots chip + panel', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        setQueueRows([], null);
    });

    afterEach(() => {
        localStorage.clear();
        setQueueRows([], null);
        mountClaudeSheet(document.createElement('div'));
    });

    it('renders a chip on a shipped row and opens the panel without iterating', () => {
        // The iterate path switches tabs and fires a seed turn over fetch; stub
        // fetch so a stray iterate would be observable rather than networked.
        globalThis.fetch = vi.fn(function() { return new Promise(function() {}); });
        setQueueRows([
            { id: 'r1', state: 'shipped', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('Verified run'), pr_url: 'https://github.com/o/r/pull/7', run_url: 'https://github.com/o/r/actions/runs/42', created_at: '2026-10-09T10:00:00Z', verify: twoShotVerify() },
        ], 'ProjA');
        mountClaudeSheet(document.body);
        document.getElementById('claudeTabRuns').click();
        const sheet = document.getElementById('claudeSheet');
        expect(sheet.getAttribute('data-tab')).toBe('runs');

        const row = document.querySelector('.claudeRunRow');
        expect(row.classList.contains('claudeRunRow--hasVerify')).toBe(true);
        const chip = row.querySelector('.claudeRunVerifyChip');
        expect(chip).toBeTruthy();
        expect(chip.textContent).toBe('2');
        expect(chip.getAttribute('aria-label')).toBe('Show 2 verification screenshots');
        expect(chip.getAttribute('aria-expanded')).toBe('false');
        // Sits between the model tag slot and the status badge.
        expect(chip.nextElementSibling.classList.contains('claudeRunBadge')).toBe(true);
        const panel = row.querySelector('.claudeRunVerifyPanel');
        expect(panel.hidden).toBe(true);
        expect(row.querySelectorAll('.claudeRunVerifyShot').length).toBe(0);

        chip.click();

        expect(panel.hidden).toBe(false);
        expect(chip.getAttribute('aria-expanded')).toBe('true');
        expect(chip.classList.contains('claudeRunVerifyChip--open')).toBe(true);
        const shots = panel.querySelectorAll('.claudeRunVerifyShot');
        expect(shots.length).toBe(2);
        expect(shots[0].getAttribute('href')).toBe('https://cdn.example/verify/a.png');
        expect(shots[1].getAttribute('href')).toBe('https://cdn.example/verify/b.png');
        const flags = Array.from(panel.querySelectorAll('.claudeRunVerifyFlag')).map(function(el) { return el.textContent; });
        expect(flags).toEqual(['fits after Fight', 'clipped']);
        const labels = Array.from(panel.querySelectorAll('.claudeRunVerifyMetaLabel')).map(function(el) { return el.textContent; });
        expect(labels).toEqual(['1300x900 · click "Fight"', '390x844']);
        expect(panel.querySelector('.claudeRunVerifyText').textContent).toBe('✓ Both viewports render the board.');
        const linkEls = Array.from(panel.querySelectorAll('.claudeRunVerifyActions a'));
        expect(linkEls.map(function(a) { return a.textContent; })).toEqual(['All screenshots ↗', 'Open PR ↗']);
        expect(linkEls[0].getAttribute('href')).toBe('https://github.com/o/r/actions/runs/42');

        // Clicking a thumbnail or the run link opens it, never the row's iterate action.
        shots[0].querySelector('img').click();
        linkEls[0].click();
        panel.click();

        expect(fetch).not.toHaveBeenCalled();
        expect(sheet.getAttribute('data-tab')).toBe('runs');

        // Toggles closed again.
        chip.click();
        expect(panel.hidden).toBe(true);
        expect(chip.getAttribute('aria-expanded')).toBe('false');
    });

    it('omits the All screenshots link when the row has neither run_url nor run_id', () => {
        setQueueRows([
            { id: 'r1', state: 'shipped', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('No run link'), pr_url: 'https://github.com/o/r/pull/8', created_at: '2026-10-09T10:00:00Z', verify: twoShotVerify() },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        document.querySelector('.claudeRunVerifyChip').click();
        const links = Array.from(document.querySelectorAll('.claudeRunVerifyActions a')).map(function(a) { return a.textContent; });
        expect(links).toEqual(['Open PR ↗']);
    });

    it('flags a failed step and omits the summary prefix when ok is null', () => {
        const verify = twoShotVerify();
        verify.ok = null;
        verify.shots = [{ file: 'c.png', url: 'https://cdn.example/verify/c.png', viewport: '820x600', route: '/', steps: '', stepsOk: false }];
        setQueueRows([
            { id: 'r1', state: 'shipped', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('Step failure'), created_at: '2026-10-09T10:00:00Z', verify: verify },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        document.querySelector('.claudeRunVerifyChip').click();
        const flag = document.querySelector('.claudeRunVerifyFlag');
        expect(flag.textContent).toBe('step failed');
        expect(flag.classList.contains('claudeRunVerifyFlag--danger')).toBe(true);
        expect(document.querySelector('.claudeRunVerifyText').textContent).toBe('Both viewports render the board.');
    });

    it('renders no chip on a row without verify, or with an empty shot list', () => {
        setQueueRows([
            { id: 'r1', state: 'shipped', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('Plain run'), created_at: '2026-10-09T10:00:00Z' },
            { id: 'r2', state: 'shipped', entry_id: 'e2', correlation_id: 'c2', draft: draftFor('Empty verify'), created_at: '2026-10-09T09:00:00Z', verify: { ok: null, shots: [] } },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        expect(document.querySelectorAll('.claudeRunRow').length).toBe(2);
        expect(document.querySelector('.claudeRunVerifyChip')).toBeNull();
        expect(document.querySelector('.claudeRunVerifyPanel')).toBeNull();
        expect(document.querySelector('.claudeRunRow--hasVerify')).toBeNull();
    });

    it('on a NOCHANGE row, shows both the summary accordion and the chip, and the chip toggles only its panel', () => {
        setQueueRows([
            { id: 'r1', state: 'no_change', entry_id: 'e1', correlation_id: 'c1', draft: draftFor('Nothing shipped'), failure_reason: 'Already satisfied.', created_at: '2026-10-09T10:00:00Z', verify: twoShotVerify() },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        const row = document.querySelector('.claudeRunRow--nochange');
        const chip = row.querySelector('.claudeRunVerifyChip');
        const resultPanel = row.querySelector('.claudeRunResultPanel');
        const verifyPanel = row.querySelector('.claudeRunVerifyPanel');
        expect(chip).toBeTruthy();
        expect(resultPanel.hidden).toBe(true);

        chip.click();
        expect(verifyPanel.hidden).toBe(false);
        expect(resultPanel.hidden).toBe(true);
        expect(row.getAttribute('aria-expanded')).toBe('false');

        // A tap inside the verify panel doesn't toggle the summary accordion.
        verifyPanel.click();
        expect(resultPanel.hidden).toBe(true);

        // The row header still toggles the summary, leaving the verify panel alone.
        row.click();
        expect(resultPanel.hidden).toBe(false);
        expect(verifyPanel.hidden).toBe(false);
        expect(document.querySelector('.claudeRunResultText').textContent).toBe('Already satisfied.');

        chip.click();
        expect(verifyPanel.hidden).toBe(true);
        expect(resultPanel.hidden).toBe(false);
    });
});
