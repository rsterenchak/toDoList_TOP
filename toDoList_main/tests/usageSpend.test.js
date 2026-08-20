import { vi } from 'vitest';
import {
    mountClaudeSheet,
    openSpendPanel,
    renderSpendReadout,
    priceForUsageEvent,
    sumUsageCost,
    USAGE_RATES,
    dailyUsageSeries,
    computeDeepShare,
    computeCacheHitRate,
    renderSpendChart,
    providerSpendBreakdown,
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

    it('prices claude-opus-5 identically to claude-opus-4-8 at the opus rate', () => {
        // The deep_think path bumped from claude-opus-4-8 to claude-opus-5. Both
        // must price at the opus family rate — by rule (the substring match), not
        // by falling through the unknown-model fallback. Pinned so a future switch
        // to exact-string keying can't silently drop opus-5 onto the fallback.
        const tokens = {
            input_tokens: 1e6,
            output_tokens: 1e6,
            cache_read_input_tokens: 1e6,
            cache_creation_input_tokens: 1e6,
        };
        const opus48 = priceForUsageEvent(Object.assign({ model: 'claude-opus-4-8' }, tokens));
        const opus5 = priceForUsageEvent(Object.assign({ model: 'claude-opus-5' }, tokens));
        const r = USAGE_RATES.opus;
        const expected = r.input + r.output + r.cacheRead + r.cacheWrite;
        expect(opus5).toBeCloseTo(expected, 6);
        expect(opus5).toBeCloseTo(opus48, 6);
    });

    it('attributes an opus-5 deep_think turn to deep share via the column, not the model name', () => {
        // computeDeepShare must split on the deep_think column, so an opus-5 deep
        // turn is fully attributed exactly as an opus-4-8 one is.
        const rows = [
            { model: 'claude-opus-5', deep_think: true, input_tokens: 1e6 },  // $15
            { model: 'claude-sonnet-4-5', input_tokens: 1e6 },                // $3
        ];
        expect(computeDeepShare(rows)).toBeCloseTo(15 / 18, 6);
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

    it('shows a loading spinner immediately on open, before the read resolves', () => {
        openSpendPanel(document.createElement('button'));
        const readout = document.getElementById('usageSpendReadout');
        // Before flush() the read is still in flight: spinner + label, no $0.00.
        expect(readout.querySelector('.usageSpendSpinner')).not.toBeNull();
        expect(readout.querySelector('.usageSpendLoadingLabel').textContent).toBe('Loading usage…');
        expect(readout.querySelector('.usageSpendAmount')).toBeNull();
    });

    it('replaces the spinner with an inline error on an empty read (no $0.00 flash)', async () => {
        globalThis.__usageRows = [];
        openSpendPanel(document.createElement('button'));
        await flush();
        const readout = document.getElementById('usageSpendReadout');
        // An empty read no longer silently settles on $0.00 — it surfaces an error.
        expect(readout.querySelector('.usageSpendAmount')).toBeNull();
        expect(readout.querySelector('.usageSpendSpinner')).toBeNull();
        expect(readout.querySelector('.usageSpendError')).not.toBeNull();
    });

    it('replaces the spinner with an inline error when the read fails', async () => {
        globalThis.__hasSession = false; // loadMonthlyUsage returns { ok: false }
        openSpendPanel(document.createElement('button'));
        await flush();
        const readout = document.getElementById('usageSpendReadout');
        expect(readout.querySelector('.usageSpendSpinner')).toBeNull();
        expect(readout.querySelector('.usageSpendError')).not.toBeNull();
        globalThis.__hasSession = true;
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

describe('API spend — daily chart + ratios', () => {
    // Build a created_at ISO string for a given LOCAL calendar day, so grouping
    // (which reads local getFullYear/getMonth/getDate) is deterministic regardless
    // of the machine's timezone.
    function localISO(y, m, d, h) {
        return new Date(y, m, d, h == null ? 12 : h, 0, 0).toISOString();
    }

    it('groups rows by local date across the whole calendar month', () => {
        const now = new Date(2026, 7, 5, 15, 0, 0); // Aug 5 2026, local
        const rows = [
            { model: 'claude-sonnet-4-5', input_tokens: 1e6, created_at: localISO(2026, 7, 2) },
            { model: 'claude-sonnet-4-5', input_tokens: 1e6, created_at: localISO(2026, 7, 2) },
            { model: 'claude-sonnet-4-5', input_tokens: 1e6, created_at: localISO(2026, 7, 4) },
        ];
        const series = dailyUsageSeries(rows, now);
        expect(series.length).toBe(31); // full August axis, not just up to the 5th
        expect(series[0].date).toBe('2026-08-01');
        expect(series[30].date).toBe('2026-08-31');
        expect(series[1].cost).toBeCloseTo(USAGE_RATES.sonnet.input * 2, 6); // day 2, two rows
        expect(series[3].cost).toBeCloseTo(USAGE_RATES.sonnet.input, 6);     // day 4, one row
    });

    it('renders every day as a slot, including days later in the month than today', () => {
        const now = new Date(2026, 1, 3, 9, 0, 0); // Feb 3 2026 — 28 days, not a leap year
        const rows = [{ model: 'claude-sonnet-4-5', input_tokens: 1e6, created_at: localISO(2026, 1, 1) }];
        const series = dailyUsageSeries(rows, now);
        expect(series.length).toBe(28);            // full February, fixed axis
        expect(series[0].cost).toBeGreaterThan(0); // day 1 has usage
        expect(series[1].cost).toBe(0);            // day 2 empty slot
        expect(series[26].cost).toBe(0);           // day 27, future, still a slot
        expect(series[27].date).toBe('2026-02-28');
    });

    it('the summed series equals the month total (bars sum to the figure)', () => {
        const now = new Date(2026, 7, 10, 12, 0, 0);
        const rows = [
            { model: 'claude-opus-4-8', input_tokens: 5e5, output_tokens: 2e5, created_at: localISO(2026, 7, 3) },
            { model: 'claude-sonnet-4-5', input_tokens: 1e6, created_at: localISO(2026, 7, 7) },
        ];
        const series = dailyUsageSeries(rows, now);
        const barSum = series.reduce(function(acc, s) { return acc + s.cost; }, 0);
        expect(barSum).toBeCloseTo(sumUsageCost(rows), 6);
    });

    it('deep share is a share of COST, not of turn count', () => {
        const rows = [
            { model: 'claude-opus-4-8', deep_think: true, input_tokens: 1e6 }, // $15
            { model: 'claude-sonnet-4-5', input_tokens: 1e6 },                 // $3
            { model: 'claude-sonnet-4-5', input_tokens: 1e6 },                 // $3
        ];
        const deep = computeDeepShare(rows);
        // Cost share = 15/21 ≈ 0.714; a turn-count share would be 1/3 ≈ 0.333.
        expect(deep).toBeCloseTo(15 / 21, 6);
        expect(deep).toBeGreaterThan(0.5);
        expect(computeDeepShare([])).toBeNull();
        expect(computeDeepShare(null)).toBeNull();
    });

    it('cache hit rate is cache_read ÷ (input + cache_read) tokens', () => {
        const rows = [
            { model: 'claude-sonnet-4-5', input_tokens: 200000, cache_read_input_tokens: 800000 },
            { model: 'claude-sonnet-4-5', input_tokens: 0, cache_read_tokens: 0 },
        ];
        expect(computeCacheHitRate(rows)).toBeCloseTo(800000 / 1000000, 6);
        expect(computeCacheHitRate([])).toBeNull();
    });

    it('renders the full-month chart with a single day of spend (no history guard)', () => {
        const c = document.createElement('div');
        const now = new Date(2026, 7, 8, 12, 0, 0); // August, 31 days
        const rows = [{ model: 'claude-sonnet-4-5', input_tokens: 1e6, created_at: localISO(2026, 7, 2) }];
        renderSpendChart(c, rows, now);
        // The old "not enough history" guard is gone: one day renders a real chart.
        expect(c.querySelector('.usageSpendChartNote')).toBeNull();
        expect(c.querySelector('.usageSpendChartSvg')).not.toBeNull();
        expect(c.querySelectorAll('.usageSpendChartBar').length).toBe(1); // the one non-zero day
        // A full-month axis has a hit area per day regardless of data density.
        expect(c.querySelectorAll('.usageSpendChartHit').length).toBe(31);
    });

    it('renders one bar per usage day plus the two ratios and the peak caption', () => {
        const c = document.createElement('div');
        const now = new Date(2026, 7, 6, 12, 0, 0);
        const rows = [
            { model: 'claude-opus-4-8', deep_think: true, input_tokens: 1e6, cache_read_input_tokens: 500000, created_at: localISO(2026, 7, 2) },
            { model: 'claude-sonnet-4-5', input_tokens: 1e6, cache_read_input_tokens: 500000, created_at: localISO(2026, 7, 5) },
        ];
        renderSpendChart(c, rows, now);
        expect(c.querySelector('.usageSpendChartSvg')).not.toBeNull();
        // Two usage days → two bars; the empty days between draw no rect.
        expect(c.querySelectorAll('.usageSpendChartBar').length).toBe(2);
        expect(c.querySelectorAll('.usageSpendRatio').length).toBe(2);
        // The inline max-value label is gone; a single peak caption replaces it.
        expect(c.querySelector('.usageSpendChartMaxLabel')).toBeNull();
        const caption = c.querySelector('.usageSpendChartCaption');
        expect(caption).not.toBeNull();
        expect(caption.textContent).toMatch(/^Peak \$/);
        expect(caption.textContent).toContain('Aug 2'); // opus turn on the 2nd is the peak
    });

    it('bars rise from a shared baseline, scaled to the month peak', () => {
        const c = document.createElement('div');
        const now = new Date(2026, 7, 6, 12, 0, 0);
        const rows = [
            { model: 'claude-opus-4-8', input_tokens: 1e6, created_at: localISO(2026, 7, 2) }, // tall
            { model: 'claude-sonnet-4-5', input_tokens: 1e5, created_at: localISO(2026, 7, 5) }, // short
        ];
        renderSpendChart(c, rows, now);
        const bars = Array.from(c.querySelectorAll('.usageSpendChartBar'));
        expect(bars.length).toBe(2);
        const bottoms = bars.map(function(b) {
            return parseFloat(b.getAttribute('y')) + parseFloat(b.getAttribute('height'));
        });
        expect(bottoms[0]).toBeCloseTo(bottoms[1], 3); // both anchored to the same baseline
        const heights = bars.map(function(b) { return parseFloat(b.getAttribute('height')); });
        expect(heights[0]).toBeGreaterThan(heights[1]); // taller day is taller bar
    });

    it('a zero-usage month renders the axis but no peak caption', () => {
        const c = document.createElement('div');
        const now = new Date(2026, 7, 10, 12, 0, 0);
        renderSpendChart(c, [], now);
        expect(c.querySelector('.usageSpendChartSvg')).not.toBeNull();
        expect(c.querySelectorAll('.usageSpendChartBar').length).toBe(0);
        expect(c.querySelector('.usageSpendChartCaption')).toBeNull(); // no "Peak $0.00"
    });

    it('draws a faint gridline every seven days from the 1st', () => {
        const c = document.createElement('div');
        const now = new Date(2026, 7, 20, 12, 0, 0); // August, 31 days
        const rows = [{ model: 'claude-sonnet-4-5', input_tokens: 1e6, created_at: localISO(2026, 7, 3) }];
        renderSpendChart(c, rows, now);
        // Days 1, 8, 15, 22, 29 → five weekly gridlines across a 31-day month.
        expect(c.querySelectorAll('.usageSpendChartWeek').length).toBe(5);
    });
});

describe('API spend — provider split', () => {
    function costOf(rows) {
        return rows.reduce(function(acc, r) { return acc + priceForUsageEvent(r); }, 0);
    }

    it('buckets each family substring to its provider', () => {
        const rows = [
            { model: 'claude-opus-5', input_tokens: 1e6 },
            { model: 'claude-sonnet-4-5-20260101', input_tokens: 1e6 },
            { model: 'claude-haiku-4-5', input_tokens: 1e6 },
            { model: 'kimi-k2-0905', input_tokens: 1e6 },
            { model: 'grok-4-fast', input_tokens: 1e6 },
        ];
        const buckets = providerSpendBreakdown(rows);
        const by = {};
        buckets.forEach(function(b) { by[b.key] = b.cost; });
        // The three Anthropic families collapse into one bucket.
        expect(by.anthropic).toBeCloseTo(
            USAGE_RATES.opus.input + USAGE_RATES.sonnet.input + USAGE_RATES.haiku.input, 6);
        expect(by.kimi).toBeCloseTo(USAGE_RATES.kimi.input, 6);
        expect(by.grok).toBeCloseTo(USAGE_RATES.grok.input, 6);
        expect(by.other).toBe(0);
    });

    it('reads a bare claude id as Anthropic, not as other', () => {
        const buckets = providerSpendBreakdown([{ model: 'claude-3-legacy', input_tokens: 1e6 }]);
        const by = {};
        buckets.forEach(function(b) { by[b.key] = b.cost; });
        expect(by.anthropic).toBeGreaterThan(0);
        expect(by.other).toBe(0);
    });

    it('falls back to other for an unrecognised model, at its fallback price', () => {
        const row = { model: 'some-future-model-v9', input_tokens: 1e6 };
        const buckets = providerSpendBreakdown([row]);
        const other = buckets.filter(function(b) { return b.key === 'other'; })[0];
        // Unknown models price at the opus fallback; that spend must surface, not vanish.
        expect(other.cost).toBeCloseTo(priceForUsageEvent(row), 6);
        expect(other.cost).toBeCloseTo(USAGE_RATES.opus.input, 6);
    });

    it('sums each bucket with priceForUsageEvent so the split equals the month total', () => {
        const rows = [
            { model: 'claude-sonnet-4-5', input_tokens: 1e6, output_tokens: 2e5, cache_read_input_tokens: 5e5 },
            { model: 'claude-sonnet-4-5', input_tokens: 3e5 },
            { model: 'kimi-k2', input_tokens: 1e6, output_tokens: 1e5, cache_creation_input_tokens: 4e5 },
            { model: 'grok-4', output_tokens: 7e5 },
            { model: 'mystery-1', input_tokens: 2e5 },
            null,
        ];
        const buckets = providerSpendBreakdown(rows);
        const split = buckets.reduce(function(acc, b) { return acc + b.cost; }, 0);
        expect(split).toBeCloseTo(sumUsageCost(rows), 6);
        const anthropic = buckets.filter(function(b) { return b.key === 'anthropic'; })[0];
        expect(anthropic.cost).toBeCloseTo(costOf([rows[0], rows[1]]), 6);
    });

    it('returns every bucket in a fixed order, zero-cost ones included', () => {
        const order = ['anthropic', 'kimi', 'grok', 'other'];
        expect(providerSpendBreakdown([]).map(function(b) { return b.key; })).toEqual(order);
        expect(providerSpendBreakdown(null).map(function(b) { return b.key; })).toEqual(order);
        // A kimi-only month still returns all four, so the order never depends on data.
        const oneProvider = providerSpendBreakdown([{ model: 'kimi-k2', input_tokens: 1e6 }]);
        expect(oneProvider.map(function(b) { return b.key; })).toEqual(order);
        expect(oneProvider.every(function(b) { return typeof b.cost === 'number'; })).toBe(true);
        expect(providerSpendBreakdown([]).every(function(b) { return b.cost === 0; })).toBe(true);
    });
});

describe('API spend — provider split render', () => {
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
    });

    it('renders the split between the readout and the chart, one segment per nonzero bucket', async () => {
        globalThis.__usageRows = [
            { model: 'claude-sonnet-4-5', input_tokens: 1e6 },  // $3.00 anthropic
            { model: 'kimi-k2', input_tokens: 1e6 },            // $3.00 kimi
        ];
        openSpendPanel(document.createElement('button'));
        await flush();
        const body = document.getElementById('usageSpendBody');
        const providers = document.getElementById('usageSpendProviders');
        expect(providers).not.toBeNull();
        // Position: readout, then the split, then the chart.
        const kids = Array.from(body.children).map(function(el) { return el.id; });
        expect(kids).toEqual(['usageSpendReadout', 'usageSpendProviders', 'usageSpendChart']);
        // Two nonzero buckets → two segments and two legend items; grok/other stay away.
        const segs = providers.querySelectorAll('.usageSpendProviderSeg');
        expect(segs.length).toBe(2);
        expect(segs[0].classList.contains('usageSpendProviderSeg--anthropic')).toBe(true);
        expect(segs[1].classList.contains('usageSpendProviderSeg--kimi')).toBe(true);
        // Equal spend → equal widths.
        expect(parseFloat(segs[0].style.width)).toBeCloseTo(50, 2);
        expect(parseFloat(segs[1].style.width)).toBeCloseTo(50, 2);
        const legend = providers.querySelectorAll('.usageSpendProviderLegendItem');
        expect(legend.length).toBe(2);
        expect(legend[0].querySelector('.usageSpendProviderLegendText').textContent)
            .toBe('Anthropic $3.00');
        expect(legend[1].querySelector('.usageSpendProviderDot')
            .classList.contains('usageSpendProviderDot--kimi')).toBe(true);
    });

    it('renders no provider block at all for a month with zero cost', async () => {
        // Rows exist (so the read succeeds) but carry no billable tokens.
        globalThis.__usageRows = [{ model: 'claude-sonnet-4-5' }];
        openSpendPanel(document.createElement('button'));
        await flush();
        const providers = document.getElementById('usageSpendProviders');
        expect(providers.children.length).toBe(0);
        expect(providers.querySelector('.usageSpendProviderBar')).toBeNull();
    });

    it('leaves the split intact when a budget edit re-renders the readout', async () => {
        globalThis.__usageRows = [{ model: 'grok-4', input_tokens: 1e6 }];
        openSpendPanel(document.createElement('button'));
        await flush();
        const providers = document.getElementById('usageSpendProviders');
        expect(providers.querySelectorAll('.usageSpendProviderSeg').length).toBe(1);
        const input = document.getElementById('usageSpendBudgetInput');
        input.value = '25';
        input.dispatchEvent(new Event('change'));
        // The budget edit re-renders the readout only — the split must survive it.
        expect(providers.querySelectorAll('.usageSpendProviderSeg').length).toBe(1);
        expect(providers.querySelector('.usageSpendProviderLegendText').textContent)
            .toBe('Grok $' + USAGE_RATES.grok.input.toFixed(2));
    });

    it('states the coverage caveat plainly in the readout note', () => {
        const c = document.createElement('div');
        renderSpendReadout(c, 4.19, 0);
        const note = c.querySelector('.usageSpendNote').textContent;
        expect(note).toContain('chat, scans, and the ghost');
        expect(note).toContain('Max plan');
        expect(note).toContain('third-party runs');
    });
});
