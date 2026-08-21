// Tests for the composer's send modes naming the models they run on — the
// client half of deep-think becoming a real registry surface (`deep`) rather
// than a server-side pin.
//
// Two halves, for the same reason the Models panel's tests split that way:
//   • describeSendModes, the one pure decision behind BOTH the mode menu's items
//     and the send button's sub-caption. A menu reading `Deep · claude-opus-5`
//     over a button captioned with something else is worse than no caption, so
//     the two are one function and it is pinned directly — including the
//     default-source naming and the before-the-cache-resolves fallback, neither
//     of which is recoverable from the DOM after the fact.
//   • The composer itself: plain `Fast` / `Deep` until the shared per-repo model
//     settings cache lands, then both modes named, and the caption tracking
//     whichever mode is active.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import { mountClaudeSheet, describeSendModes } from '../src/claudeSheet.js';
import { initInjectConfig } from '../src/inject.js';

describe('describeSendModes — what Fast and Deep will actually run', () => {
    const DEFAULTS = { chat: 'claude-sonnet-5', deep: 'claude-opus-5' };

    it('names each mode by the value its surface resolved to', () => {
        const m = describeSendModes('fast', 'claude-haiku-4-5', 'claude-opus-4-8', DEFAULTS);
        expect(m.fastLabel).toBe('Fast · claude-haiku-4-5');
        expect(m.deepLabel).toBe('Deep · claude-opus-4-8');
    });

    it('captions the ACTIVE mode, so the button and the menu agree', () => {
        const fast = describeSendModes('fast', 'claude-haiku-4-5', 'claude-opus-4-8', DEFAULTS);
        expect(fast.captionModel).toBe('claude-haiku-4-5');
        const deep = describeSendModes('deep', 'claude-haiku-4-5', 'claude-opus-4-8', DEFAULTS);
        expect(deep.captionModel).toBe('claude-opus-4-8');
        // Same inputs, only the mode differs — the labels are unchanged.
        expect(deep.fastLabel).toBe(fast.fastLabel);
        expect(deep.deepLabel).toBe(fast.deepLabel);
    });

    it('falls through to the catalog defaults for an unconfigured surface', () => {
        const m = describeSendModes('deep', '', '', DEFAULTS);
        expect(m.fastLabel).toBe('Fast · claude-sonnet-5');
        expect(m.deepLabel).toBe('Deep · claude-opus-5');
        expect(m.captionModel).toBe('claude-opus-5');
        // Mixed: one surface pinned, the other falling through.
        const mixed = describeSendModes('fast', 'gpt-5-codex', '', DEFAULTS);
        expect(mixed.fastLabel).toBe('Fast · gpt-5-codex');
        expect(mixed.deepLabel).toBe('Deep · claude-opus-5');
    });

    it('degrades to plain Fast / Deep with nothing resolved and no caption to show', () => {
        // The cache hasn't landed (or the read failed): a mode is better than a
        // guess, and the caption goes empty rather than inventing a model.
        const cold = describeSendModes('deep', '', '', null);
        expect(cold.fastLabel).toBe('Fast');
        expect(cold.deepLabel).toBe('Deep');
        expect(cold.captionModel).toBe('');
        // A defaults map missing just one surface degrades only that half.
        const half = describeSendModes('deep', '', '', { chat: 'claude-sonnet-5' });
        expect(half.fastLabel).toBe('Fast · claude-sonnet-5');
        expect(half.deepLabel).toBe('Deep');
        expect(half.captionModel).toBe('');
    });

    it('ignores whitespace-only values the same way it ignores absent ones', () => {
        const m = describeSendModes('fast', '   ', '  ', DEFAULTS);
        expect(m.fastLabel).toBe('Fast · claude-sonnet-5');
        expect(m.deepLabel).toBe('Deep · claude-opus-5');
    });
});

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function modeName(mode) {
    return document
        .querySelector('.claudeModeOption[data-mode="' + mode + '"] .claudeModeName')
        .textContent;
}

function sendButton() {
    return document.getElementById('claudeComposerSend');
}

// FIRST in the file, deliberately: the per-repo settings cache is module-level
// and populated by the first successful read, so an unconfigured Worker is the
// only way to observe the cold face again once the block below has run.
describe('composer send mode — before any model settings resolve', () => {
    beforeEach(() => {
        localStorage.clear();
        initInjectConfig(); // no Worker URL: the read can't even be attempted
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
    });

    it('paints plain Fast / Deep and shows no model caption at all', async () => {
        await flush();
        expect(sendButton().querySelector('.claudeSendModeLabel').textContent).toBe('Fast');
        const model = sendButton().querySelector('.claudeSendModelLabel');
        expect(model).toBeTruthy();
        expect(model.hidden).toBe(true);
        expect(model.textContent).toBe('');
        expect(sendButton().title).toBe('');
        expect(modeName('fast')).toBe('Fast');
        expect(modeName('deep')).toBe('Deep');
    });
});

describe('composer send mode — naming the models on screen', () => {
    let realFetch;

    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        realFetch = globalThis.fetch;
        globalThis.fetch = vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            let json = { ok: true };
            if (body.models) {
                json = {
                    models: [
                        { id: 'claude-sonnet-5', provider: 'anthropic', lanes: ['chat'] },
                        { id: 'claude-opus-5', provider: 'anthropic', lanes: ['chat'] },
                    ],
                    defaults: { chat: 'claude-sonnet-5', deep: 'claude-opus-5' },
                };
            } else if (body.models_get) {
                json = { surfaces: { deep: { value: 'claude-opus-4-8', source: 'repo' } } };
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
        });
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    it('names both modes once the read lands — resolved for deep, default for chat', async () => {
        await flush();
        // `deep` is pinned on this repo; `chat` is unset, so it names the
        // catalog default the Worker publishes for that surface.
        expect(modeName('deep')).toBe('Deep · claude-opus-4-8');
        expect(modeName('fast')).toBe('Fast · claude-sonnet-5');
    });

    it('captions the send button with the ACTIVE mode’s model, and follows a switch', async () => {
        await flush();
        const model = () => sendButton().querySelector('.claudeSendModelLabel');
        expect(model().hidden).toBe(false);
        expect(model().textContent).toBe('claude-sonnet-5');
        expect(sendButton().title).toContain('claude-sonnet-5');

        // Switching the persisted default repoints the caption without touching
        // the mode word, the accent, or the ★.
        document.getElementById('claudeComposerSendCaret').click();
        document.querySelector('.claudeModeOption[data-mode="deep"]').click();
        expect(model().textContent).toBe('claude-opus-4-8');
        expect(sendButton().querySelector('.claudeSendModeLabel').textContent).toBe('Deep');
        expect(sendButton().classList.contains('claudeComposerSendDeep')).toBe(true);
        expect(sendButton().getAttribute('aria-label')).toBe('Send deep');
        expect(localStorage.getItem('todoapp_chatMode')).toBe('deep');
    });

    it('reads the settings through the shared per-repo cache, not a second fetch', async () => {
        await flush();
        const gets = globalThis.fetch.mock.calls
            .filter((c) => JSON.parse(c[1].body).models_get);
        expect(gets.length).toBeLessThanOrEqual(1);
    });
});
