import { vi } from 'vitest';
import {
    mountClaudeSheet,
    openClaudeSheet,
    closeClaudeSheet,
} from '../src/claudeSheet.js';
import { initInjectConfig } from '../src/inject.js';

// A minimal stand-in for the browser's SpeechRecognition. Each constructed
// instance records itself so tests can drive its lifecycle callbacks
// (`onresult`, `onerror`, `onend`) the way the real API would fire them.
class FakeRecognition {
    constructor() {
        this.continuous = undefined;
        this.interimResults = undefined;
        this.lang = undefined;
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        this.started = false;
        FakeRecognition.instances.push(this);
    }
    start() {
        if (FakeRecognition.throwOnStart) throw new Error('start blocked');
        this.started = true;
    }
    stop() {
        this.started = false;
        if (this.onend) this.onend();
    }
    // Test helpers — emulate the events the real engine dispatches.
    emitResult(text, isFinal) {
        if (this.onresult) {
            this.onresult({ results: [[{ transcript: text }]], isFinal: !!isFinal });
        }
    }
    emitError(code) {
        if (this.onerror) this.onerror({ error: code });
    }
}
FakeRecognition.instances = [];
FakeRecognition.throwOnStart = false;

function lastRecognition() {
    return FakeRecognition.instances[FakeRecognition.instances.length - 1];
}

describe('Claude sheet — voice dictation (mic button)', () => {
    let savedSR;
    let savedWebkit;

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        FakeRecognition.instances = [];
        FakeRecognition.throwOnStart = false;
        savedSR = window.SpeechRecognition;
        savedWebkit = window.webkitSpeechRecognition;
    });

    afterEach(() => {
        if (savedSR === undefined) delete window.SpeechRecognition;
        else window.SpeechRecognition = savedSR;
        if (savedWebkit === undefined) delete window.webkitSpeechRecognition;
        else window.webkitSpeechRecognition = savedWebkit;
        // Remount against a throwaway node to drop listeners between tests.
        mountClaudeSheet(document.createElement('div'));
    });

    function mountWithSpeech() {
        window.SpeechRecognition = FakeRecognition;
        delete window.webkitSpeechRecognition;
        mountClaudeSheet(document.body);
    }

    it('(a) renders the mic button when SpeechRecognition is available', () => {
        mountWithSpeech();
        const mic = document.getElementById('claudeComposerMic');
        expect(mic).toBeTruthy();
        expect(mic.getAttribute('aria-label')).toBe('Voice input');
        expect(mic.classList.contains('micButton')).toBe(true);
    });

    it('(a2) also detects the webkit-prefixed constructor (Safari/iOS)', () => {
        delete window.SpeechRecognition;
        window.webkitSpeechRecognition = FakeRecognition;
        mountClaudeSheet(document.body);
        expect(document.getElementById('claudeComposerMic')).toBeTruthy();
    });

    it('(b) does NOT render the mic button when speech recognition is unavailable', () => {
        delete window.SpeechRecognition;
        delete window.webkitSpeechRecognition;
        mountClaudeSheet(document.body);
        expect(document.getElementById('claudeComposerMic')).toBeNull();
    });

    it('(c) tapping the button enters the recording state', () => {
        mountWithSpeech();
        const mic = document.getElementById('claudeComposerMic');
        mic.click();
        expect(mic.classList.contains('micButton--recording')).toBe(true);
        const rec = lastRecognition();
        expect(rec.started).toBe(true);
        // Configured for natural dictation.
        expect(rec.interimResults).toBe(true);
        expect(rec.continuous).toBe(false);
    });

    it('(d) tapping again exits the recording state', () => {
        mountWithSpeech();
        const mic = document.getElementById('claudeComposerMic');
        mic.click();
        expect(mic.classList.contains('micButton--recording')).toBe(true);
        mic.click();
        expect(mic.classList.contains('micButton--recording')).toBe(false);
    });

    it('(e) transcribed text populates the chat input field', () => {
        mountWithSpeech();
        const mic = document.getElementById('claudeComposerMic');
        const input = document.getElementById('claudeComposerInput');
        mic.click();
        lastRecognition().emitResult('add a sparkle feature', true);
        expect(input.value).toBe('add a sparkle feature');
    });

    it('(e2) transcription appends onto text the user already typed', () => {
        mountWithSpeech();
        const mic = document.getElementById('claudeComposerMic');
        const input = document.getElementById('claudeComposerInput');
        input.value = 'Hello';
        mic.click();
        lastRecognition().emitResult('there world', true);
        expect(input.value).toBe('Hello there world');
    });

    it('(f) permission denial transitions the button to the denied state', () => {
        mountWithSpeech();
        const mic = document.getElementById('claudeComposerMic');
        mic.click();
        lastRecognition().emitError('not-allowed');
        expect(mic.classList.contains('micButton--denied')).toBe(true);
        expect(mic.classList.contains('micButton--recording')).toBe(false);
        expect(mic.getAttribute('title')).toMatch(/permission/i);
    });

    it('(f2) a start() failure retries once then falls back to denied', () => {
        mountWithSpeech();
        const mic = document.getElementById('claudeComposerMic');
        FakeRecognition.throwOnStart = true;
        mic.click();
        // Two instances constructed (initial + one retry), neither started.
        expect(FakeRecognition.instances.length).toBe(2);
        expect(mic.classList.contains('micButton--denied')).toBe(true);
        expect(mic.classList.contains('micButton--recording')).toBe(false);
    });

    it('(g) closing the chat sheet stops any active recording', () => {
        mountWithSpeech();
        const mic = document.getElementById('claudeComposerMic');
        openClaudeSheet();
        mic.click();
        const rec = lastRecognition();
        expect(rec.started).toBe(true);
        closeClaudeSheet();
        expect(rec.started).toBe(false);
        expect(mic.classList.contains('micButton--recording')).toBe(false);
    });

    it('(h) the send button sends transcribed text with no special routing', async () => {
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        const realFetch = globalThis.fetch;
        const fetchSpy = vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            const json = body.chat ? { reply: 'ok' } : { ok: true };
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
        });
        globalThis.fetch = fetchSpy;
        try {
            mountWithSpeech();
            const mic = document.getElementById('claudeComposerMic');
            const input = document.getElementById('claudeComposerInput');
            mic.click();
            lastRecognition().emitResult('dictated message', true);
            document.getElementById('claudeComposerSend').click();
            await new Promise((r) => setTimeout(r, 0));
            await new Promise((r) => setTimeout(r, 0));
            const chatCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).chat);
            expect(chatCall).toBeTruthy();
            const sent = JSON.parse(chatCall[1].body);
            expect(sent.messages[0]).toEqual({ role: 'user', content: 'dictated message' });
        } finally {
            globalThis.fetch = realFetch;
        }
    });
});
