import { vi } from 'vitest';
import {
    mountClaudeSheet,
    openSpendPanel,
    renderSpendReadout,
    priceForUsageEvent,
    sumUsageCost,
    USAGE_RATES,
} from '../src/claudeSheet.js';
import { listLogic } from '../src/listLogic.js';
import { getUsageBudget, setUsageBudget } from '../src/prefs.js';

// claudeSheet → inject → supabaseClient, and agentQueueStore/listLogic →
// supabaseClient. Stub the shared client so importing these modules never
// reaches the network. The usage query chain (from → select → eq → gte) records
// its gte argument into a global so loadMonthlyUsage's local-month boundary can
// be asserted, and resolves the seeded rows.
vi.mock('../src/supabaseClient.js', () => {
    function makeQuery() {
        const q = {
            select: function() { return q; },
            order: function() { return Promise.resolve({ data: [], error: null }); },
            insert: function() { return Promise.resolve({ data: null, error: null }); },
            update: function() { return q; },
            delete: function() { return q; },
            eq: function() { return q; },
            gte: function(col, value) {
                globalThis.__usageGte = { col: col, value: value };
                return Promise.resolve({
                    data: globalThis.__usageRows || [],
                    error: globalThis.__usageError || null,
                });
            },
        };
        return q;
    }
    return {
        supabase: {
            auth: {
                getSession: function() {
                    return Promise.resolve({
                        data: globalThis.__hasSession === false
                            ? { session: null }
                            : { session: { user: { id: 'u1' } } },
                        error: null,
                    });
                },
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

function flush() {
    // Let the openSpendPanel read-on-open promise chain settle.
    return new Promise(function(resolve) { setTimeout(resolve, 0); });
}

describe('API spend — pricing', () => {
    it('applies four distinct rates for a single event', () => {
        // 1M of each token type against the sonnet family should equal the sum of
        // its four rates (in dollars), proving each lane multiplies by its OWN rate.
        const row = {
            model: 'claude-sonnet-4-5-20260101',
            input_tokens: 1e6,
            output_tokens: 1e6,
            cache_read_input_tokens: 1e6,
            cache_creation_input_tokens: 1e6,
        };
        const r = USAGE_RATES.sonnet;
        const expected = r.input + r.output + r.cacheRead + r.cacheWrite;
        expect(priceForUsageEvent(row)).toBeCloseTo(expected, 6);
    });

    it('scales each lane by its token count, not a blend', () => {
        const row = {
            model: 'claude-opus-4-8',
            input_tokens: 2e6,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
        };
        expect(priceForUsageEvent(row)).toBeCloseTo(USAGE_RATES.opus.input * 2, 6);
    });

    it('falls back to the highest known rate for an unknown model', () => {
        const unknown = {
            model: 'some-future-model-v9',
            input_tokens: 1e6,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
        };
        // Opus is the most expensive known family; the unknown model must price
        // at that (over-report), not at zero.
        expect(priceForUsageEvent(unknown)).toBeCloseTo(USAGE_RATES.opus.input, 6);
        expect(USAGE_RATES.opus.input).toBeGreaterThan(USAGE_RATES.sonnet.input);
        expect(USAGE_RATES.opus.input).toBeGreaterThan(USAGE_RATES.haiku.input);
    });

    it('tolerates missing token columns as zero and sums a set', () => {
        const rows = [
            { model: 'claude-sonnet-4-5', input_tokens: 1e6 },
            { model: 'claude-haiku-4-5', output_tokens: 1e6 },
            null,
        ];
        const expected = USAGE_RATES.sonnet.input + USAGE_RATES.haiku.output;
        expect(sumUsageCost(rows)).toBeCloseTo(expected, 6);
        expect(sumUsageCost(null)).toBe(0);
    });
});

describe('API spend — local-month boundary', () => {
    it('localMonthStartISO encodes local midnight on the first of the month', () => {
        const now = new Date(2026, 6, 15, 9, 30, 0); // Jul 15 2026, local
        const iso = listLogic.localMonthStartISO(now);
        // Same instant as local Jul 1 2026 00:00.
        expect(iso).toBe(new Date(2026, 6, 1, 0, 0, 0, 0).toISOString());
    });

    it('loadMonthlyUsage filters created_at >= the local-month boundary', async () => {
        globalThis.__hasSession = true;
        globalThis.__usageRows = [{ model: 'claude-sonnet-4-5', input_tokens: 1e6 }];
        globalThis.__usageError = null;
        const res = await listLogic.loadMonthlyUsage();
        expect(res.ok).toBe(true);
        expect(res.rows.length).toBe(1);
        expect(globalThis.__usageGte.col).toBe('created_at');
        expect(globalThis.__usageGte.value).toBe(listLogic.localMonthStartISO());
    });

    it('loadMonthlyUsage reports not-signed-in without a session', async () => {
        globalThis.__hasSession = false;
        const res = await listLogic.loadMonthlyUsage();
        expect(res.ok).toBe(false);
        globalThis.__hasSession = true;
    });
});

describe('API spend — readout render', () => {
    it('shows the figure with no bar when the budget is zero or unset', () => {
        const c = document.createElement('div');
        renderSpendReadout(c, 4.19, 0);
        expect(c.querySelector('.usageSpendAmount').textContent).toBe('$4.19');
        expect(c.querySelector('.usageSpendBar')).toBeNull();
        expect(c.querySelector('.usageSpendPct')).toBeNull();
        // The honesty line is always present.
        expect(c.querySelector('.usageSpendNote')).not.toBeNull();
    });

    it('renders a bar and percentage when a positive budget is set', () => {
        const c = document.createElement('div');
        renderSpendReadout(c, 5, 20);
        expect(c.querySelector('.usageSpendBar')).not.toBeNull();
        // jsdom reserializes the CSS length, dropping the trailing .0.
        expect(parseFloat(c.querySelector('.usageSpendBarFill').style.width)).toBeCloseTo(25, 3);
        expect(c.querySelector('.usageSpendPct').textContent).toContain('25%');
    });

    it('caps the fill at 100% and flags an over-budget state', () => {
        const c = document.createElement('div');
        renderSpendReadout(c, 40, 20);
        expect(c.querySelector('.usageSpendBar').classList.contains('usageSpendBar--over')).toBe(true);
        expect(parseFloat(c.querySelector('.usageSpendBarFill').style.width)).toBeCloseTo(100, 3);
    });
});

describe('API spend — panel + entry points', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        globalThis.__hasSession = true;
        globalThis.__usageRows = [];
        globalThis.__usageError = null;
    });

    afterEach(() => {
        const b = document.getElementById('usageSpendBackdrop');
        if (b && b.parentNode) b.parentNode.removeChild(b);
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
    });

    it('renders the mobile spend control inside the chat view only', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        mountClaudeSheet(host);
        const control = document.getElementById('claudeSpendControl');
        expect(control).not.toBeNull();
        // It lives inside the chat view (not the tab strip), so it's gated with it.
        expect(document.getElementById('claudeChatView').contains(control)).toBe(true);
        // Switch to RUNS: the chat view (and thus the control) is hidden.
        document.getElementById('claudeTabRuns').click();
        expect(document.getElementById('claudeChatView').hidden).toBe(true);
    });

    it('opens from the mobile control and dismisses three ways', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        mountClaudeSheet(host);

        // Open via the mobile control.
        document.getElementById('claudeSpendControl').click();
        await flush();
        expect(document.getElementById('usageSpendBackdrop')).not.toBeNull();

        // Dismiss via the close button.
        document.getElementById('usageSpendClose').click();
        expect(document.getElementById('usageSpendBackdrop')).toBeNull();

        // Open again, dismiss via Escape.
        document.getElementById('claudeSpendControl').click();
        await flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.getElementById('usageSpendBackdrop')).toBeNull();

        // Open again, dismiss via backdrop click.
        document.getElementById('claudeSpendControl').click();
        await flush();
        const backdrop = document.getElementById('usageSpendBackdrop');
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('usageSpendBackdrop')).toBeNull();
    });

    it('opens directly (the desktop nav entry point) and shows $0.00 with an empty read', async () => {
        openSpendPanel(document.createElement('button'));
        await flush();
        const backdrop = document.getElementById('usageSpendBackdrop');
        expect(backdrop).not.toBeNull();
        expect(backdrop.querySelector('.usageSpendAmount').textContent).toBe('$0.00');
    });

    it('sums the month rows into the figure once the read resolves', async () => {
        globalThis.__usageRows = [
            { model: 'claude-sonnet-4-5', input_tokens: 1e6 }, // = $3.00 input
        ];
        setUsageBudget(0); // no bar, so the amount is unambiguous
        openSpendPanel(document.createElement('button'));
        await flush();
        const amount = document.getElementById('usageSpendBackdrop').querySelector('.usageSpendAmount');
        expect(amount.textContent).toBe('$' + USAGE_RATES.sonnet.input.toFixed(2));
    });

    it('persists a budget edit through prefs', () => {
        openSpendPanel(document.createElement('button'));
        const input = document.getElementById('usageSpendBudgetInput');
        input.value = '50';
        input.dispatchEvent(new Event('change'));
        expect(getUsageBudget()).toBe(50);
    });
});
