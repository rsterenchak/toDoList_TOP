// Tests for the per-run model picker on the drafted-entry ship flow — the layer
// above the Models panel's per-repo/global defaults, where one drafted entry
// ships once on a model chosen for that ship alone.
//
// The pure pieces are pinned directly because none of them is recoverable from
// the DOM after render, and each is a place a silent wrong answer would look
// perfectly fine on screen:
//   • resolveRunModel — override vs. resolved default vs. nothing set at all;
//   • shipCopyForModel — the one combination (third-party model, auto-merge off)
//     where "Ship it" and "this deploys to your live app" are both false;
//   • runModelTagText — which run rows wear an amber model tag;
//   • rateForModel via priceForUsageEvent — the two new third-party families,
//     which would otherwise fall through to the unknown-model fallback;
//   • buildPickerList — the list builder the panel and the popover now SHARE, so
//     the two can't drift on lane filtering or grouping.
// Alongside them: the wire contract for the per-run pick (sent only when set)
// and the two stamp paths a model has to survive — setAgentRunState's silent
// whitelist and the queue-sourced Runs row.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Captures the last agent_queue update payload so the setAgentRunState
// whitelist can be checked for what it actually forwards. Everything else on
// the client is the minimum listLogic/claudeSheet need at import time.
let lastQueueUpdate = null;

vi.mock('../src/supabaseClient.js', () => {
    function makeQuery(table) {
        const q = {
            select: function() { return q; },
            order: function() { return Promise.resolve({ data: [], error: null }); },
            insert: function() { return Promise.resolve({ data: null, error: null }); },
            update: function(payload) {
                if (table === 'agent_queue') lastQueueUpdate = payload;
                return q;
            },
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
            from: function(table) { return makeQuery(table); },
            channel: function() { return { on: function() { return this; }, subscribe: function() { return this; }, unsubscribe: function() { return this; } }; },
            removeChannel: function() {},
        },
    };
});

import {
    mountClaudeSheet,
    resolveRunModel,
    shipCopyForModel,
    runModelTagText,
    priceForUsageEvent,
    USAGE_RATES,
} from '../src/claudeSheet.js';
import { buildPickerList } from '../src/modelsPanel.js';
import { dispatchRun, initInjectConfig } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';
import { setQueueRows } from '../src/agentQueueStore.js';

const CATALOG = {
    models: [
        { id: 'claude-opus-4-8', provider: 'anthropic', lanes: ['run', 'triage'], quota: '5×/day' },
        { id: 'claude-sonnet-5', provider: 'anthropic', lanes: ['run', 'chat'], quota: '40×/day' },
        { id: 'kimi-k3', provider: 'moonshot', lanes: ['run'] },
        { id: 'grok-4-fast', provider: 'xai', lanes: ['run'] },
        { id: 'chat-only', provider: 'openai', lanes: ['chat'] },
    ],
    plan_lanes: ['run', 'triage', 'derive'],
};

function settings(runValue, source) {
    return { surfaces: { run: { value: runValue, source: source || 'repo' } } };
}


describe('resolveRunModel — which model a drafted card actually ships on', () => {
    it('falls through to the RUN surface default when nothing is picked', () => {
        const r = resolveRunModel('', settings('claude-opus-4-8'));
        expect(r.model).toBe('claude-opus-4-8');
        expect(r.overridden).toBe(false);
        expect(r.chipText).toBe('claude-opus-4-8');
        // The dim chip needs a tag naming WHERE the value came from, or an
        // inherited pick and a deliberate one look identical.
        expect(r.sourceTag).toBe('default');
    });

    it('a per-run pick outranks the repo default', () => {
        const r = resolveRunModel('kimi-k3', settings('claude-opus-4-8'));
        expect(r.model).toBe('kimi-k3');
        expect(r.overridden).toBe(true);
        expect(r.chipText).toBe('kimi-k3');
        expect(r.sourceTag).toBe('');
        // Inherit still names what it WOULD fall back to, so the picker's
        // Inherit row stays a real preview while an override is active.
        expect(r.inherited).toBe('claude-opus-4-8');
    });

    it('picking the model that was already the default still counts as a deliberate override', () => {
        // Keyed on the pick, not on whether the resolved value changed — the
        // bright chip means "I chose this for this run", which stays true even
        // when the choice matches what would have happened anyway.
        const r = resolveRunModel('claude-opus-4-8', settings('claude-opus-4-8'));
        expect(r.overridden).toBe(true);
        expect(r.sourceTag).toBe('');
    });

    it('reads as "default" rather than inventing an id when nothing resolves at all', () => {
        const r = resolveRunModel('', { surfaces: { run: { value: '', source: 'default' } } });
        expect(r.model).toBe('');
        expect(r.chipText).toBe('default');
        expect(r.inherited).toBe('');
    });

    it('survives settings that never loaded', () => {
        const r = resolveRunModel('', null);
        expect(r.model).toBe('');
        expect(r.chipText).toBe('default');
        expect(r.overridden).toBe(false);
    });

    it('names the workflow default on the chip once the catalog publishes one', () => {
        const defaults = { run: 'claude-opus-5' };
        const r = resolveRunModel('', { surfaces: { run: { value: '', source: 'default' } } }, defaults);
        expect(r.chipText).toBe('claude-opus-5');
        // Dim, tagged `default` — the chip names the model, the tag still names
        // the layer, and nothing about this reads as a per-run pick.
        expect(r.sourceTag).toBe('default');
        expect(r.overridden).toBe(false);
        // `model` is what the ship path and the confirm copy reason about. The
        // run INHERITS this id rather than selecting it, so naming it on the
        // chip must not turn an inheriting ship into an explicit override.
        expect(r.model).toBe('');
        expect(r.inherited).toBe('');
    });

    it('leaves a resolved repo default and a per-run pick alone', () => {
        const defaults = { run: 'claude-opus-5' };
        const inheritingRepoPick = resolveRunModel('', settings('claude-opus-4-8'), defaults);
        expect(inheritingRepoPick.chipText).toBe('claude-opus-4-8');
        const picked = resolveRunModel('kimi-k3', settings('claude-opus-4-8'), defaults);
        expect(picked.chipText).toBe('kimi-k3');
        expect(picked.sourceTag).toBe('');
    });
});


describe('shipCopyForModel — the confirm step tells the truth about what a pick does', () => {
    it('a third-party pick with auto-merge OFF opens a PR, and says so everywhere', () => {
        const copy = shipCopyForModel({ catalog: CATALOG, model: 'kimi-k3', autoMerge3p: false });
        expect(copy.opensPr).toBe(true);
        expect(copy.shipLabel).toBe('Ship → PR');
        expect(copy.warnText).toBe('This opens a PR — merge it yourself to deploy.');
        expect(copy.subline).toBe('api · waits for merge');
    });

    it('a third-party pick with auto-merge ON keeps the deploy copy verbatim', () => {
        const copy = shipCopyForModel({ catalog: CATALOG, model: 'grok-4-fast', autoMerge3p: true });
        expect(copy.thirdParty).toBe(true);
        expect(copy.opensPr).toBe(false);
        expect(copy.shipLabel).toBe('Ship it');
        expect(copy.warnText).toBe('This ships to main and deploys to your live app.');
        expect(copy.subline).toBe('');
    });

    it('an Anthropic pick keeps the existing copy exactly, auto-merge flag or not', () => {
        const off = shipCopyForModel({ catalog: CATALOG, model: 'claude-opus-4-8', autoMerge3p: false });
        expect(off.thirdParty).toBe(false);
        expect(off.shipLabel).toBe('Ship it');
        expect(off.warnText).toBe('This ships to main and deploys to your live app.');
        expect(off.subline).toBe('');
    });

    it('an inheriting card with no catalog yet keeps the plan-lane copy', () => {
        // Telling someone their ordinary Anthropic run merely opens a PR is the
        // more damaging of the two possible lies, so an unknown model does NOT
        // fall to the cautious side.
        const copy = shipCopyForModel({ catalog: null, model: '', autoMerge3p: false });
        expect(copy.opensPr).toBe(false);
        expect(copy.shipLabel).toBe('Ship it');
    });

    it('a model the catalog does not carry is not treated as third-party', () => {
        const copy = shipCopyForModel({ catalog: CATALOG, model: 'something-new', autoMerge3p: false });
        expect(copy.thirdParty).toBe(false);
        expect(copy.shipLabel).toBe('Ship it');
    });
});


describe('runModelTagText — which runs wear a model tag', () => {
    it('tags a third-party model with its bare id', () => {
        expect(runModelTagText('kimi-k3')).toBe('kimi-k3');
        expect(runModelTagText('grok-4-fast')).toBe('grok-4-fast');
    });

    it('adds nothing for Anthropic models or an unstamped record', () => {
        expect(runModelTagText('claude-opus-4-8')).toBe('');
        expect(runModelTagText('claude-sonnet-5')).toBe('');
        expect(runModelTagText('claude-haiku-4-5')).toBe('');
        expect(runModelTagText('')).toBe('');
        expect(runModelTagText(undefined)).toBe('');
        expect(runModelTagText(null)).toBe('');
    });
});


describe('USAGE_RATES — the third-party families a run can now be pinned to', () => {
    it('prices kimi and grok rather than dropping them into the unknown fallback', () => {
        // Each carries its provider's published rate, so the assertions are both
        // that they RESOLVE to their own family entry and that the entry is no
        // longer the opus placeholder they were seeded with.
        expect(USAGE_RATES.kimi).toBeTruthy();
        expect(USAGE_RATES.grok).toBeTruthy();
        expect(priceForUsageEvent({ model: 'kimi-k3', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.kimi.input, 6);
        expect(priceForUsageEvent({ model: 'grok-4-fast', output_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.grok.output, 6);
        expect(USAGE_RATES.kimi).toEqual(
            { input: 3, output: 15, cacheWrite: 3, cacheRead: 0.3 });
        expect(USAGE_RATES.grok).toEqual(
            { input: 2, output: 6, cacheWrite: 2, cacheRead: 0.3 });
    });

    it('prices neither family at a cache-write premium, unlike the Anthropic rows', () => {
        // Moonshot and xAI cache automatically with no write premium, so a
        // cache-writing token bills as plain input on both rows.
        expect(USAGE_RATES.kimi.cacheWrite).toBe(USAGE_RATES.kimi.input);
        expect(USAGE_RATES.grok.cacheWrite).toBe(USAGE_RATES.grok.input);
        expect(USAGE_RATES.opus.cacheWrite).toBeGreaterThan(USAGE_RATES.opus.input);
    });

    it('leaves opus the most expensive family, so the unknown-model fallback still errs high', () => {
        expect(USAGE_RATES.opus.input).toBeGreaterThan(USAGE_RATES.kimi.input);
        expect(USAGE_RATES.opus.input).toBeGreaterThan(USAGE_RATES.grok.input);
        expect(priceForUsageEvent({ model: 'some-unknown-model', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.opus.input, 6);
    });

    it('prices both DeepSeek tiers, with the pro branch ahead of the generic one', () => {
        // The generic `deepseek` substring also matches the pro id, so the pro
        // assertion is the ordering guard: swap the two branches in
        // rateForModel and Pro silently prices at Flash rates and this fails.
        expect(priceForUsageEvent({ model: 'deepseek-v4-flash', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.deepseek.input, 6);
        expect(priceForUsageEvent({ model: 'deepseek-v4-pro', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.deepseekPro.input, 6);
        // The legacy alias both v4-flash generations were served under, so
        // historical rows keep pricing at the flash rate.
        expect(priceForUsageEvent({ model: 'deepseek-chat', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.deepseek.input, 6);
    });

    it('prices both GPT tiers, with the luna branch ahead of the generic one', () => {
        // The generic `gpt` substring matches every gpt id including Luna's, so the
        // luna assertion is the ordering guard: swap the two branches in
        // rateForModel and Luna silently prices at Sol rates and this fails.
        expect(priceForUsageEvent({ model: 'openai/gpt-5.6-luna', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.gptLuna.input, 6);
        expect(priceForUsageEvent({ model: 'openai/gpt-5.6-sol', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.gpt.input, 6);
        // Sol's row doubles as the errs-high default for any future gpt id, so a
        // generation bump prices in the family rather than at the opus fallback.
        expect(priceForUsageEvent({ model: 'openai/gpt-6', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.gpt.input, 6);
    });

    it('prices the MiniMax, GLM, and Gemini rows rather than the opus fallback', () => {
        // All three reached the allowlist pricing at the opus fallback — a ~25x,
        // ~10x, and ~10x input over-report respectively. Each assertion is that
        // the id resolves to its OWN family, so a missing branch reads as the
        // fallback and fails here.
        expect(priceForUsageEvent({ model: 'minimax/minimax-m3', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.minimax.input, 6);
        expect(priceForUsageEvent({ model: 'zai/glm-5.2', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.glm.input, 6);
        expect(priceForUsageEvent({ model: 'google/gemini-3.7-flash', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.gemini.input, 6);
        expect(USAGE_RATES.minimax).toEqual(
            { input: 0.6, output: 2.4, cacheWrite: 0.6, cacheRead: 0.06 });
        expect(USAGE_RATES.glm).toEqual(
            { input: 1.4, output: 4.4, cacheWrite: 1.4, cacheRead: 0.14 });
        expect(USAGE_RATES.gemini).toEqual(
            { input: 1.5, output: 7.5, cacheWrite: 1.5, cacheRead: 0.15 });
        // Implicit caching on all three, so a cache-writing token bills as plain
        // input rather than carrying opus's write premium.
        expect(USAGE_RATES.minimax.cacheWrite).toBe(USAGE_RATES.minimax.input);
        expect(USAGE_RATES.glm.cacheWrite).toBe(USAGE_RATES.glm.input);
        expect(USAGE_RATES.gemini.cacheWrite).toBe(USAGE_RATES.gemini.input);
        // Opus stays the priciest family, so the unknown-model fallback still
        // errs high with the three new rows in the table.
        expect(USAGE_RATES.opus.input).toBeGreaterThan(USAGE_RATES.gemini.input);
    });

    it('still prices the Anthropic families by substring, so a generation bump needs no edit', () => {
        expect(priceForUsageEvent({ model: 'claude-sonnet-9', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.sonnet.input, 6);
    });

    it('prices every OpenCode Go id at zero, with its branch ahead of every family', () => {
        // THE ordering guard for the Go branch, and the reason it must sit first
        // in rateForModel: `go/kimi-k3` contains `kimi`, so let any family
        // branch run ahead of it and a subscription-covered turn bills at
        // $3/$15. Move the branch down and this pair fails.
        expect(priceForUsageEvent({ model: 'go/kimi-k3', input_tokens: 1e6, output_tokens: 1e6 }))
            .toBe(0);
        expect(priceForUsageEvent({ model: 'kimi-k3', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.kimi.input, 6);
        // Every lane zero, so no token type leaks a charge.
        expect(USAGE_RATES.opencodeGo)
            .toEqual({ input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
        expect(priceForUsageEvent({
            model: 'go/some-future-model',
            input_tokens: 1e6, output_tokens: 1e6,
            cache_read_input_tokens: 1e6, cache_creation_input_tokens: 1e6,
        })).toBe(0);
        // A PREFIX, not a substring: an id that merely contains `go/` elsewhere
        // is an ordinary API row and keeps its own price.
        expect(priceForUsageEvent({ model: 'algo/kimi-k3', input_tokens: 1e6 }))
            .toBeCloseTo(USAGE_RATES.kimi.input, 6);
    });
});


describe('buildPickerList — one list builder, two surfaces', () => {
    function labels(list) {
        return Array.from(list.querySelectorAll('.modelsPickerLabel'))
            .map(function(el) { return el.textContent; });
    }

    it('offers only the models allowlisted for the run lane, Inherit first', () => {
        const list = buildPickerList({ catalog: CATALOG, surface: 'run', current: '' });
        expect(labels(list)).toEqual([
            'Inherit', 'claude-opus-4-8', 'claude-sonnet-5', 'kimi-k3', 'grok-4-fast',
        ]);
        // 'chat-only' is allowlisted for chat, never for run.
        expect(labels(list)).not.toContain('chat-only');
    });

    it('splits the two billing lanes under their own headings', () => {
        const list = buildPickerList({ catalog: CATALOG, surface: 'run', current: '' });
        const headings = Array.from(list.querySelectorAll('.modelsPickerHeading'))
            .map(function(el) { return el.textContent; });
        expect(headings[0]).toBe('PLAN QUOTA');
        expect(headings[1]).toMatch(/API BILLED/);
        expect(list.querySelectorAll('.modelsPickerHeading--api').length).toBe(1);
    });

    it('checks Inherit when nothing is pinned, and the pinned row when something is', () => {
        const inheriting = buildPickerList({ catalog: CATALOG, surface: 'run', current: '' });
        expect(inheriting.querySelectorAll('.modelsPickerRow')[0].getAttribute('aria-pressed')).toBe('true');

        const pinned = buildPickerList({ catalog: CATALOG, surface: 'run', current: 'kimi-k3' });
        const rows = Array.from(pinned.querySelectorAll('.modelsPickerRow'));
        expect(rows[0].getAttribute('aria-pressed')).toBe('false');
        const kimi = rows.find(function(r) {
            return r.querySelector('.modelsPickerLabel').textContent === 'kimi-k3';
        });
        expect(kimi.getAttribute('aria-pressed')).toBe('true');
    });

    it('reports a pick by id and Inherit as null', () => {
        const picks = [];
        const list = buildPickerList({
            catalog: CATALOG,
            surface: 'run',
            current: 'kimi-k3',
            inheritHint: 'claude-opus-4-8',
            onPick: function(m) { picks.push(m); },
        });
        const rows = Array.from(list.querySelectorAll('.modelsPickerRow'));
        rows[0].click();
        rows.find(function(r) {
            return r.querySelector('.modelsPickerLabel').textContent === 'grok-4-fast';
        }).click();
        expect(picks).toEqual([null, 'grok-4-fast']);
    });

    it('names what Inherit would resolve to', () => {
        const list = buildPickerList({
            catalog: CATALOG, surface: 'run', current: 'kimi-k3', inheritHint: 'claude-opus-4-8',
        });
        expect(list.querySelector('.modelsPickerHint').textContent).toBe('claude-opus-4-8');
    });

    // The same catalog plus the Worker's OpenCode Go rows — a `go/` id whose
    // underlying model also appears un-prefixed, which is the pair the grouping
    // has to keep apart.
    const GO_CATALOG = {
        models: CATALOG.models.concat([
            { id: 'go/kimi-k3', provider: 'moonshot', lanes: ['run'] },
            { id: 'go/glm-5.2', provider: 'zai', lanes: ['run'] },
        ]),
        plan_lanes: CATALOG.plan_lanes,
    };

    it('groups the Go rows between plan quota and API billed, under a dim heading', () => {
        const list = buildPickerList({ catalog: GO_CATALOG, surface: 'run', current: '' });
        const headings = Array.from(list.querySelectorAll('.modelsPickerHeading'))
            .map(function(el) { return el.textContent; });
        expect(headings).toEqual([
            'PLAN QUOTA',
            'OPENCODE GO · subscription · $12/5hr · $30/wk · $60/mo caps',
            'API BILLED · leaves plan, pays per token',
        ]);
        // Neither plan nor per-token, so it wears its own dim class and not the
        // API heading's amber one.
        expect(list.querySelectorAll('.modelsPickerHeading--go').length).toBe(1);
        expect(list.querySelectorAll('.modelsPickerHeading--api').length).toBe(1);
        // Order on screen, with the Go rows sitting between the two lanes and
        // showing their names without the prefix the heading already carries.
        expect(labels(list)).toEqual([
            'Inherit', 'claude-opus-4-8', 'claude-sonnet-5',
            'kimi-k3', 'glm-5.2',
            'kimi-k3', 'grok-4-fast',
        ]);
    });

    it('picks and checks a Go row by its full prefixed id, never the stripped label', () => {
        // The label drops `go/` for reading; the VALUE must not, or the Worker
        // gets an id it does not serve and the pick routes to per-token billing.
        const picks = [];
        const list = buildPickerList({
            catalog: GO_CATALOG,
            surface: 'run',
            current: 'go/kimi-k3',
            onPick: function(m) { picks.push(m); },
        });
        const rows = Array.from(list.querySelectorAll('.modelsPickerRow'));
        const checked = rows.filter(function(r) { return r.getAttribute('aria-pressed') === 'true'; });
        // Exactly one ✓ — the un-prefixed API `kimi-k3` row must NOT also check.
        expect(checked).toHaveLength(1);
        expect(checked[0].querySelector('.modelsPickerLabel').textContent).toBe('kimi-k3');
        expect(rows.indexOf(checked[0])).toBe(3);

        rows[4].click();
        expect(picks).toEqual(['go/glm-5.2']);
    });
});


describe('dispatchRun — the per-run pick on the wire', () => {
    let fetchSpy;
    let realFetch;

    function lastBody() {
        const call = fetchSpy.mock.calls[fetchSpy.mock.calls.length - 1];
        return call ? JSON.parse(call[1].body) : null;
    }

    beforeEach(() => {
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret');
        initInjectConfig();
        realFetch = globalThis.fetch;
        fetchSpy = vi.fn(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true, model: 'kimi-k3', billing: 'api' }),
        }));
        globalThis.fetch = fetchSpy;
    });

    afterEach(() => {
        globalThis.fetch = realFetch;
        localStorage.clear();
        initInjectConfig();
    });

    it('sends the model when a per-run pick is set', async () => {
        await dispatchRun({ mode: 'entry', entryId: 'e1', correlationId: 'c1', model: 'kimi-k3' });
        expect(lastBody().model).toBe('kimi-k3');
    });

    it('OMITS the key entirely when the card inherits', async () => {
        // Omission is what "inherit" means to the Worker's precedence chain
        // (per-run → repo row → global row → workflow default); an empty string
        // would be a pick of nothing.
        await dispatchRun({ mode: 'entry', entryId: 'e1', correlationId: 'c1', model: '' });
        expect('model' in lastBody()).toBe(false);

        await dispatchRun({ mode: 'entry', entryId: 'e1', correlationId: 'c1' });
        expect('model' in lastBody()).toBe(false);
    });

    it('spreads the Worker echo back so a caller can stamp the resolved model', async () => {
        const res = await dispatchRun({ mode: 'entry', entryId: 'e1', correlationId: 'c1' });
        expect(res.ok).toBe(true);
        expect(res.model).toBe('kimi-k3');
        expect(res.billing).toBe('api');
    });
});


describe('setAgentRunState — the model survives the silent whitelist', () => {
    beforeEach(() => { lastQueueUpdate = null; });

    it('forwards a model key to the agent_queue update', async () => {
        // The whitelist drops unknown keys with NO error at the call site, so a
        // missing entry loses the stamp invisibly. That is exactly what this
        // pins.
        const res = await listLogic.setAgentRunState('row-1', {
            state: 'dispatched', model: 'kimi-k3',
        });
        expect(res.ok).toBe(true);
        expect(lastQueueUpdate).toEqual({ state: 'dispatched', model: 'kimi-k3' });
    });

    it('a model-only patch is a real update rather than "nothing to update"', async () => {
        const res = await listLogic.setAgentRunState('row-1', { model: 'grok-4-fast' });
        expect(res.ok).toBe(true);
        expect(lastQueueUpdate).toEqual({ model: 'grok-4-fast' });
    });
});


describe('Runs tab — an API-billed run is legible in the list', () => {
    function draftFor(title) {
        return '- [ ] **[MEDIUM]** ' + title + '\n  - Type: feature\n  <!-- id: x -->';
    }

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

    it('tags a queue row that ran on a third-party model', () => {
        setQueueRows([
            {
                id: 'row-1', project_id: 1, state: 'shipped', entry_id: 'e-3p',
                correlation_id: 'corr-1', model: 'kimi-k3',
                draft: draftFor('Third-party ship'), created_at: '2026-08-01T10:00:00Z',
            },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        const row = document.querySelector('.claudeRunRow');
        const tag = row.querySelector('.claudeRunModelTag');
        expect(tag).toBeTruthy();
        expect(tag.textContent).toBe('kimi-k3');
        // The tag sits between the title and the status pill.
        expect(tag.previousElementSibling.className).toBe('claudeRunTitle');
        expect(tag.nextElementSibling.classList.contains('claudeRunBadge')).toBe(true);
    });

    it('adds no tag for a plan-lane run or an unstamped row', () => {
        setQueueRows([
            {
                id: 'row-1', project_id: 1, state: 'shipped', entry_id: 'e-plan',
                correlation_id: 'corr-1', model: 'claude-opus-4-8',
                draft: draftFor('Plan ship'), created_at: '2026-08-01T10:00:00Z',
            },
            {
                id: 'row-2', project_id: 1, state: 'shipped', entry_id: 'e-none',
                correlation_id: 'corr-2',
                draft: draftFor('Unstamped ship'), created_at: '2026-08-01T09:00:00Z',
            },
        ], 'ProjA');
        mountClaudeSheet(document.body);

        expect(document.querySelectorAll('.claudeRunRow').length).toBe(2);
        expect(document.querySelectorAll('.claudeRunModelTag').length).toBe(0);
    });
});
