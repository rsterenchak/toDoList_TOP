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
    abort() {
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

        it('shows the tap-to-add hint only when a surface opts into auto-commit', () => {
            // Auto-commit surface (onFinal): the hint tells the user a tap adds
            // the todo.
            const a = mountMicButton(makeInput(), { overlay: true, onFinal() {} });
            a.click();
            const withCommit = document.querySelector('.voiceOverlay .voiceHint');
            expect(withCommit).toBeTruthy();
            expect(withCommit.textContent.toLowerCase()).toMatch(/tap to add/);
            stopDictation();
            // Review-only surface (no onFinal, e.g. the Claude composer): no
            // auto-commit, so no add hint.
            const b = mountMicButton(makeInput(), { overlay: true });
            b.click();
            const withoutCommit = document.querySelector('.voiceOverlay .voiceHint');
            expect(withoutCommit).toBeNull();
        });
    });

    // Regression: the add-task mic auto-commits when the user taps the overlay
    // (or re-taps the mic) so the transcript isn't stranded (iOS can't reopen the
    // keyboard to press Enter after the async end). Cancelling (Escape /
    // surface-close) must never auto-commit, an empty transcript must never fire,
    // and review-only surfaces (no onFinal, e.g. the Claude composer) keep their
    // text for manual send.
    describe('onFinal auto-commit on tap (opt-in)', () => {
        it('opts into continuous listening when a surface passes onFinal', () => {
            startDictation(makeInput(), null, { onFinal() {} });
            expect(lastRecognition().continuous).toBe(true);
        });

        it('does not listen continuously without onFinal (review-only surface)', () => {
            startDictation(makeInput(), null, {});
            expect(lastRecognition().continuous).toBe(false);
        });

        it('fires onFinal with the final transcript when the overlay is tapped', () => {
            const input = makeInput();
            const calls = [];
            startDictation(input, null, { overlay: true, onFinal(t) { calls.push(t); } });
            lastRecognition().emitResult('buy milk');
            document.querySelector('.voiceOverlay').click();
            expect(calls).toEqual(['buy milk']);
            expect(isDictating()).toBe(false);
            expect(document.querySelector('.voiceOverlay')).toBeNull();
        });

        it('fires onFinal when the active mic is re-tapped', () => {
            const input = makeInput();
            const calls = [];
            const btn = mountMicButton(input, { onFinal(t) { calls.push(t); } });
            btn.click();
            lastRecognition().emitResult('water plants');
            btn.click(); // re-tap the active mic commits
            expect(calls).toEqual(['water plants']);
        });

        it('never fires onFinal on a blank transcript', () => {
            const calls = [];
            startDictation(makeInput(), null, { onFinal(t) { calls.push(t); } });
            lastRecognition().onend(); // ended with nothing said
            expect(calls).toEqual([]);
        });

        it('does NOT fire onFinal when cancelled via stopDictation', () => {
            const input = makeInput();
            const calls = [];
            startDictation(input, null, { onFinal(t) { calls.push(t); } });
            lastRecognition().emitResult('cancel me');
            stopDictation(); // backdrop tap / Escape / surface cleanup all route here
            expect(calls).toEqual([]);
        });

        it('does NOT fire onFinal when cancelled via Escape', () => {
            const calls = [];
            startDictation(makeInput(), null, { overlay: true, onFinal(t) { calls.push(t); } });
            lastRecognition().emitResult('cancel me');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            expect(calls).toEqual([]);
        });

        it('review-only surfaces (no onFinal) leave the transcript untouched on natural end', () => {
            const input = makeInput();
            startDictation(input, null, {});
            const rec = lastRecognition();
            rec.emitResult('leave me for review');
            rec.onend();
            expect(input.value).toBe('leave me for review');
        });

        it('a fresh session does not inherit a prior session\'s suppress-final state', () => {
            // Cancel the first session (sets the suppress flag)…
            startDictation(makeInput(), null, { onFinal() {} });
            lastRecognition().emitResult('first');
            stopDictation();
            // …then a new session must still commit on an overlay tap.
            const calls = [];
            startDictation(makeInput(), null, { overlay: true, onFinal(t) { calls.push(t); } });
            lastRecognition().emitResult('second');
            document.querySelector('.voiceOverlay').click();
            expect(calls).toEqual(['second']);
        });
    });

    // Regression: iOS Safari ends even continuous sessions on a speech pause
    // (often via a no-speech error), and delivers the old instance's onend late —
    // sometimes after a new session has started. A platform-initiated end must
    // keep the text without committing, and a stale instance's events must never
    // touch the live session.
    describe('platform-initiated end and stale instances', () => {
        // onend arrives asynchronously, as on iOS, rather than inside stop().
        class AsyncEndRecognition extends FakeRecognition {
            stop() { this.started = false; }
            abort() { this.started = false; }
            fireEnd() { if (this.onend) this.onend(); }
        }

        beforeEach(() => {
            window.SpeechRecognition = AsyncEndRecognition;
        });

        it('a late onend from a committed session leaves the next session intact', () => {
            const input = makeInput();
            const calls = [];
            const btn = mountMicButton(input, { overlay: true, onFinal(t) { calls.push(t); } });
            btn.click();
            const a = lastRecognition();
            a.emitResult('buy milk');
            document.querySelector('.voiceOverlay').click();
            expect(calls).toEqual(['buy milk']);

            btn.click();
            const b = lastRecognition();
            expect(b).not.toBe(a);
            a.fireEnd();

            expect(isDictating()).toBe(true);
            expect(document.querySelector('.voiceOverlay')).toBeTruthy();
            expect(btn.classList.contains('micButton--recording')).toBe(true);
            expect(calls).toEqual(['buy milk']);

            // B still commits through its own handle.
            b.emitResult('call mom');
            document.querySelector('.voiceOverlay').click();
            expect(calls).toEqual(['buy milk', 'call mom']);
        });

        it('a late onresult from a stale instance does not overwrite the field', () => {
            const input = makeInput();
            startDictation(input, null, { overlay: true, onFinal() {} });
            const a = lastRecognition();
            a.emitResult('first');
            document.querySelector('.voiceOverlay').click();
            input.value = '';
            startDictation(input, null, { overlay: true, onFinal() {} });
            a.emitResult('first and stale');
            expect(input.value).toBe('');
            lastRecognition().emitResult('second');
            expect(input.value).toBe('second');
        });

        it('no-speech then onend mid-session keeps the text but does not commit', () => {
            const input = makeInput();
            const calls = [];
            const btn = mountMicButton(input, { overlay: true, onFinal(t) { calls.push(t); } });
            btn.click();
            const rec = lastRecognition();
            rec.emitResult('pick up the');
            rec.emitError('no-speech');
            rec.fireEnd();
            expect(calls).toEqual([]);
            expect(input.value).toBe('pick up the');
            expect(document.querySelector('.voiceOverlay')).toBeNull();
            expect(isDictating()).toBe(false);
            expect(btn.classList.contains('micButton--recording')).toBe(false);
        });

        it('a bare platform onend mid-session keeps the text but does not commit', () => {
            const input = makeInput();
            const calls = [];
            startDictation(input, null, { overlay: true, onFinal(t) { calls.push(t); } });
            const rec = lastRecognition();
            rec.emitResult('half a thought');
            rec.fireEnd();
            expect(calls).toEqual([]);
            expect(input.value).toBe('half a thought');
            expect(document.querySelector('.voiceOverlay')).toBeNull();
            expect(isDictating()).toBe(false);
        });
    });

    // Regression: the mobile quick-capture panel dictates a whole paragraph
    // review-only, so it needs continuous listening WITHOUT the auto-commit
    // hook. Deriving `continuous` from onFinal alone left that surface running
    // a non-continuous session behind the overlay, whose only automatic exit is
    // an onend iOS standalone doesn't reliably fire — the app looked hung with
    // no way out.
    describe('continuous opt-in without onFinal (review-only paragraph dictation)', () => {
        it('listens continuously and arms the runaway watchdog', () => {
            vi.useFakeTimers();
            try {
                const input = makeInput();
                const btn = mountMicButton(input, { overlay: true, continuous: true });
                btn.click();
                const rec = lastRecognition();
                expect(rec.continuous).toBe(true);
                rec.emitResult('two thoughts in one paragraph');
                expect(isDictating()).toBe(true);
                // The watchdog is the safety net that makes the overlay never
                // the only way out of a continuous session.
                vi.advanceTimersByTime(60000);
                expect(isDictating()).toBe(false);
                expect(document.querySelector('.voiceOverlay')).toBeNull();
                expect(input.value).toBe('two thoughts in one paragraph');
            } finally {
                vi.useRealTimers();
            }
        });

        it('keeps the tap-to-add hint and the commit callback gated on onFinal', () => {
            const input = makeInput();
            const btn = mountMicButton(input, { overlay: true, continuous: true });
            btn.click();
            // Continuous, but review-only: the "add" framing would be wrong copy.
            expect(document.querySelector('.voiceOverlay .voiceHint')).toBeNull();
            lastRecognition().emitResult('leave me for review');
            document.querySelector('.voiceOverlay').click();
            // Nothing committed — the transcript stays in the field to edit.
            expect(input.value).toBe('leave me for review');
            expect(isDictating()).toBe(false);
        });

        it('a tap dismisses an overlay left behind after its session ended', () => {
            const btn = mountMicButton(makeInput(), { overlay: true, continuous: true });
            btn.click();
            const overlay = document.querySelector('.voiceOverlay');
            stopDictation();
            // Orphaned: in the DOM, but no session state behind it — the shape
            // iOS standalone produces when onend never arrives.
            document.body.appendChild(overlay);
            expect(document.querySelector('.voiceOverlay')).toBe(overlay);
            overlay.click();
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

    it('passes an onFinal that commits through the input\'s Enter path', () => {
        // The add-task mic auto-commits on an overlay tap / mic re-tap by
        // dispatching a synthetic Enter keydown on #toDoInput, reusing the
        // existing commit handler rather than calling listLogic.addToDo.
        expect(toDoRow).toMatch(/onFinal/);
        expect(toDoRow).toMatch(/new KeyboardEvent\(\s*['"]keydown['"]/);
        expect(toDoRow).not.toMatch(/onFinal[\s\S]{0,120}listLogic\.addToDo/);
    });
});

// The Claude composer mic stays review-only: no onFinal, so a natural end leaves
// its text for the user to send manually.
describe('claudeSheet composer mic does not auto-commit', () => {
    const claudeSheet = read('claudeSheet.js');
    it('mounts the composer mic without an onFinal callback', () => {
        expect(claudeSheet).toMatch(/mountMicButton\(/);
        expect(claudeSheet).not.toMatch(/onFinal/);
    });
});
