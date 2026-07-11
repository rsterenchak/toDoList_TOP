import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    mountMicButton,
    startDictation,
    stopDictation,
    isDictating,
    getSpeechRecognitionCtor,
} from '../src/voiceInput.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Minimal stand-in for the browser's SpeechRecognition, mirroring the fake used
// in claudeSheetMic.test.js so tests can drive lifecycle callbacks.
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
    emitResult(text) {
        if (this.onresult) this.onresult({ results: [[{ transcript: text }]] });
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

describe('voiceInput — shared mic + dictation module', () => {
    let savedSR;
    let savedWebkit;

    beforeEach(() => {
        document.body.innerHTML = '';
        FakeRecognition.instances = [];
        FakeRecognition.throwOnStart = false;
        savedSR = window.SpeechRecognition;
        savedWebkit = window.webkitSpeechRecognition;
        window.SpeechRecognition = FakeRecognition;
        delete window.webkitSpeechRecognition;
    });

    afterEach(() => {
        stopDictation();
        if (savedSR === undefined) delete window.SpeechRecognition;
        else window.SpeechRecognition = savedSR;
        if (savedWebkit === undefined) delete window.webkitSpeechRecognition;
        else window.webkitSpeechRecognition = savedWebkit;
    });

    function makeInput(initial) {
        const input = document.createElement('input');
        if (initial) input.value = initial;
        document.body.appendChild(input);
        return input;
    }

    it('detects the platform SpeechRecognition constructor', () => {
        expect(getSpeechRecognitionCtor()).toBe(FakeRecognition);
        delete window.SpeechRecognition;
        window.webkitSpeechRecognition = FakeRecognition;
        expect(getSpeechRecognitionCtor()).toBe(FakeRecognition);
    });

    it('mountMicButton returns a button when speech recognition is available', () => {
        const btn = mountMicButton(makeInput(), { id: 'x', className: 'micButton addTaskMic' });
        expect(btn).toBeTruthy();
        expect(btn.id).toBe('x');
        expect(btn.classList.contains('micButton')).toBe(true);
        expect(btn.classList.contains('addTaskMic')).toBe(true);
        expect(btn.getAttribute('aria-label')).toBe('Voice input');
    });

    it('mountMicButton returns null when speech recognition is unavailable', () => {
        delete window.SpeechRecognition;
        delete window.webkitSpeechRecognition;
        expect(mountMicButton(makeInput())).toBeNull();
    });

    it('tapping the button starts a session and streams transcript into the target', () => {
        const input = makeInput();
        const btn = mountMicButton(input);
        btn.click();
        expect(isDictating()).toBe(true);
        expect(btn.classList.contains('micButton--recording')).toBe(true);
        const rec = lastRecognition();
        expect(rec.interimResults).toBe(true);
        expect(rec.continuous).toBe(false);
        rec.emitResult('buy milk');
        expect(input.value).toBe('buy milk');
    });

    it('transcription appends onto text already present in the target', () => {
        const input = makeInput('Hello');
        const btn = mountMicButton(input);
        btn.click();
        lastRecognition().emitResult('there world');
        expect(input.value).toBe('Hello there world');
    });

    it('tapping the active button again stops the session', () => {
        const input = makeInput();
        const btn = mountMicButton(input);
        btn.click();
        expect(isDictating()).toBe(true);
        btn.click();
        expect(isDictating()).toBe(false);
        expect(btn.classList.contains('micButton--recording')).toBe(false);
    });

    it('only one session is ever live — starting a second stops the first', () => {
        const a = makeInput();
        const b = makeInput();
        startDictation(a, null, {});
        const first = lastRecognition();
        expect(first.started).toBe(true);
        startDictation(b, null, {});
        expect(first.started).toBe(false);
        expect(lastRecognition()).not.toBe(first);
        expect(lastRecognition().started).toBe(true);
    });

    it('a start() failure retries once, then falls back to the denied state', () => {
        const input = makeInput();
        const btn = mountMicButton(input);
        FakeRecognition.throwOnStart = true;
        btn.click();
        expect(FakeRecognition.instances.length).toBe(2);
        expect(btn.classList.contains('micButton--denied')).toBe(true);
        expect(btn.classList.contains('micButton--recording')).toBe(false);
        expect(isDictating()).toBe(false);
    });

    it('permission denial moves the button to the denied state with a tooltip', () => {
        const input = makeInput();
        const btn = mountMicButton(input);
        btn.click();
        lastRecognition().emitError('not-allowed');
        expect(btn.classList.contains('micButton--denied')).toBe(true);
        expect(btn.getAttribute('title')).toMatch(/permission/i);
    });

    it('focusTarget focuses the target field when dictation starts', () => {
        const input = makeInput();
        const btn = mountMicButton(input, { focusTarget: true });
        btn.click();
        expect(document.activeElement).toBe(input);
    });

    describe('listening overlay (opt-in)', () => {
        it('is shown while dictating and carries a ~7-bar equalizer', () => {
            const btn = mountMicButton(makeInput(), { overlay: true });
            btn.click();
            const overlay = document.querySelector('.voiceOverlay');
            expect(overlay).toBeTruthy();
            expect(overlay.getAttribute('role')).toBe('dialog');
            expect(overlay.querySelector('.voiceListenLabel').textContent).toBe('Listening');
            expect(overlay.querySelectorAll('.voiceBar').length).toBe(7);
        });

        it('streams the interim transcript into the overlay', () => {
            const btn = mountMicButton(makeInput(), { overlay: true });
            btn.click();
            lastRecognition().emitResult('call the dentist');
            expect(document.querySelector('.voiceInterim').textContent).toBe('call the dentist');
        });

        it('is NOT shown when the surface does not opt in', () => {
            const btn = mountMicButton(makeInput());
            btn.click();
            expect(document.querySelector('.voiceOverlay')).toBeNull();
        });

        it('tapping the overlay stops the session and removes it, keeping the transcript', () => {
            const input = makeInput();
            const btn = mountMicButton(input, { overlay: true });
            btn.click();
            lastRecognition().emitResult('water the plants');
            document.querySelector('.voiceOverlay').click();
            expect(isDictating()).toBe(false);
            expect(document.querySelector('.voiceOverlay')).toBeNull();
            expect(input.value).toBe('water the plants');
        });

        it('Escape stops the session and removes the overlay', () => {
            const btn = mountMicButton(makeInput(), { overlay: true });
            btn.click();
            expect(document.querySelector('.voiceOverlay')).toBeTruthy();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(isDictating()).toBe(false);
            expect(document.querySelector('.voiceOverlay')).toBeNull();
        });

        it('closing removes the Escape listener so a later Escape is inert', () => {
            const btn = mountMicButton(makeInput(), { overlay: true });
            btn.click();
            stopDictation();
            // No overlay and no throw when Escape fires after close.
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(document.querySelector('.voiceOverlay')).toBeNull();
        });
    });
});

// Source-level checks: buildToDoRow is too heavily wired to instantiate
// end-to-end in jsdom (see toDoRow.test.js / mobileInlineExpandCreate.test.js
// for the same caveat), so the placeholder-row wiring is pinned at the source.
describe('toDoRow wires the shared voice mic onto the blank placeholder', () => {
    const toDoRow = read('toDoRow.js');

    it('imports mountMicButton from voiceInput.js', () => {
        expect(toDoRow).toMatch(/import\s*\{\s*mountMicButton\s*\}\s*from\s*'\.\/voiceInput\.js'/);
    });

    it('mounts the mic only for blank placeholder rows (!item.tit), targeting #toDoInput', () => {
        expect(toDoRow).toMatch(/const\s+micBtn\s*=\s*!item\.tit/);
        expect(toDoRow).toMatch(/mountMicButton\(\s*toDoInput\s*,/);
    });

    it('opts into the listening overlay and appends the mic into the row', () => {
        expect(toDoRow).toMatch(/overlay:\s*true/);
        expect(toDoRow).toMatch(/if\s*\(micBtn\)\s*toDoChild\.appendChild\(micBtn\)/);
    });
});
