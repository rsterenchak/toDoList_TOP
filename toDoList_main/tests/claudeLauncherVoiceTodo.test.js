import { vi } from 'vitest';
import {
    mountClaudeSheet,
    isClaudeSheetOpen,
} from '../src/claudeSheet.js';
import { listLogic } from '../src/listLogic.js';

// A minimal stand-in for the browser's SpeechRecognition, mirroring the fake
// used by the composer-mic tests. Each constructed instance registers itself
// so tests can drive its lifecycle callbacks the way the real engine would.
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
        if (this.onresult) {
            this.onresult({ results: [[{ transcript: text }]] });
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

// Pointer events unify touch + mouse in the impl. jsdom implements PointerEvent
// (verified locally), so we can drive the launcher's gesture handlers directly
// with the event shape they consume.
function firePointer(el, type, opts) {
    const defaults = {
        pointerId: 1,
        pointerType: 'touch',
        clientX: 5,
        clientY: 5,
        button: 0,
        bubbles: true,
        cancelable: true,
    };
    const ev = new PointerEvent(type, Object.assign({}, defaults, opts || {}));
    el.dispatchEvent(ev);
    return ev;
}

const PROJECT = 'Inbox';

describe('Claude launcher — long-press voice-to-todo', () => {
    let savedSR;
    let savedWebkit;

    beforeEach(() => {
        vi.useFakeTimers();
        document.body.innerHTML = '';
        localStorage.clear();
        FakeRecognition.instances = [];
        FakeRecognition.throwOnStart = false;
        savedSR = window.SpeechRecognition;
        savedWebkit = window.webkitSpeechRecognition;

        // Reset any projects a prior test created so listItems is deterministic.
        listLogic.listProjectsArray().forEach(function(name) {
            listLogic.removeProject(name);
        });
        listLogic.addProject(PROJECT);

        // The selected-project readout activeProjectNameForViewer() reads, plus
        // the #mainList the commit path re-renders into.
        const selected = document.createElement('div');
        selected.className = 'selectedProject';
        const projInput = document.createElement('input');
        projInput.id = 'projInput';
        projInput.value = PROJECT;
        selected.appendChild(projInput);
        document.body.appendChild(selected);
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        document.body.appendChild(mainList);
    });

    afterEach(() => {
        if (savedSR === undefined) delete window.SpeechRecognition;
        else window.SpeechRecognition = savedSR;
        if (savedWebkit === undefined) delete window.webkitSpeechRecognition;
        else window.webkitSpeechRecognition = savedWebkit;
        // Remount against a throwaway node to drop listeners between tests.
        mountClaudeSheet(document.createElement('div'));
        vi.useRealTimers();
    });

    function mountWithSpeech() {
        window.SpeechRecognition = FakeRecognition;
        delete window.webkitSpeechRecognition;
        mountClaudeSheet(document.body);
        return document.getElementById('claudeLauncher');
    }

    // Titles of real (committed) items in the selected project.
    function committedTitles() {
        return (listLogic.listItems(PROJECT) || [])
            .map(function(i) { return i.tit; })
            .filter(function(t) { return t !== ''; });
    }

    it('(a) a long-press starts a dedicated recognition session in the recording state', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        expect(FakeRecognition.instances.length).toBe(1);
        expect(lastRecognition().started).toBe(true);
        expect(lastRecognition().interimResults).toBe(true);
        expect(lastRecognition().continuous).toBe(false);
        expect(launcher.classList.contains('micButton--recording')).toBe(true);
        // The sheet must NOT open on a long-press.
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('(b) releasing commits the transcript as one todo in the selected project without opening the sheet', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        lastRecognition().emitResult('buy oat milk');
        firePointer(launcher, 'pointerup', { clientX: 5, clientY: 5 });
        expect(committedTitles()).toEqual(['buy oat milk']);
        expect(isClaudeSheetOpen()).toBe(false);
        expect(launcher.classList.contains('micButton--recording')).toBe(false);
        // The list was re-rendered so the new row is visible without a reload.
        expect(document.getElementById('mainList').childElementCount).toBeGreaterThan(0);
    });

    it('(c) the trailing click after a long-press is swallowed and never opens the sheet', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        lastRecognition().emitResult('call the dentist');
        firePointer(launcher, 'pointerup', { clientX: 5, clientY: 5 });
        // The click browsers synthesize after pointerup.
        launcher.click();
        expect(isClaudeSheetOpen()).toBe(false);
        expect(committedTitles()).toEqual(['call the dentist']);
    });

    it('(d) a short tap still opens the chat sheet (no long-press fired)', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(200); // released before the 500ms threshold
        firePointer(launcher, 'pointerup', { clientX: 5, clientY: 5 });
        expect(FakeRecognition.instances.length).toBe(0);
        launcher.click();
        expect(isClaudeSheetOpen()).toBe(true);
        expect(committedTitles()).toEqual([]);
    });

    it('(e) moving more than 10px before the threshold cancels the long-press', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        firePointer(launcher, 'pointermove', { clientX: 40, clientY: 5 });
        vi.advanceTimersByTime(500);
        expect(FakeRecognition.instances.length).toBe(0);
        expect(launcher.classList.contains('micButton--recording')).toBe(false);
    });

    it('(f) a natural recognition end commits the transcript exactly once', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        lastRecognition().emitResult('water the plants');
        // Engine ends on its own (speaker paused) before the user releases.
        lastRecognition().stop();
        expect(committedTitles()).toEqual(['water the plants']);
        expect(launcher.classList.contains('micButton--recording')).toBe(false);
        // Releasing afterward must not add a second todo.
        firePointer(launcher, 'pointerup', { clientX: 5, clientY: 5 });
        expect(committedTitles()).toEqual(['water the plants']);
    });

    it('(g) a mouse pointer press-and-hold mirrors the touch flow', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { pointerType: 'mouse', clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        expect(launcher.classList.contains('micButton--recording')).toBe(true);
        lastRecognition().emitResult('renew library books');
        firePointer(launcher, 'pointerup', { pointerType: 'mouse', clientX: 5, clientY: 5 });
        // The real click that follows pointerup must be swallowed.
        launcher.click();
        expect(committedTitles()).toEqual(['renew library books']);
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('(h) an empty transcript adds no todo', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        // no emitResult — nothing was heard
        firePointer(launcher, 'pointerup', { clientX: 5, clientY: 5 });
        expect(committedTitles()).toEqual([]);
    });

    it('(i) a mic permission denial moves the launcher to the denied state and adds nothing', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        lastRecognition().emitError('not-allowed');
        expect(launcher.classList.contains('micButton--denied')).toBe(true);
        expect(launcher.classList.contains('micButton--recording')).toBe(false);
        firePointer(launcher, 'pointerup', { clientX: 5, clientY: 5 });
        expect(committedTitles()).toEqual([]);
    });

    it('(j) a start() failure retries once then falls back to the denied state', () => {
        const launcher = mountWithSpeech();
        FakeRecognition.throwOnStart = true;
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        // Two instances constructed (initial + one retry), neither started.
        expect(FakeRecognition.instances.length).toBe(2);
        expect(launcher.classList.contains('micButton--denied')).toBe(true);
        firePointer(launcher, 'pointerup', { clientX: 5, clientY: 5 });
        expect(committedTitles()).toEqual([]);
    });

    it('(k) when speech recognition is unsupported the long-press no-ops into the denied state', () => {
        delete window.SpeechRecognition;
        delete window.webkitSpeechRecognition;
        mountClaudeSheet(document.body);
        const launcher = document.getElementById('claudeLauncher');
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        expect(FakeRecognition.instances.length).toBe(0);
        expect(launcher.classList.contains('micButton--denied')).toBe(true);
        firePointer(launcher, 'pointerup', { clientX: 5, clientY: 5 });
        expect(committedTitles()).toEqual([]);
    });

    it('(l) respects the isClaudeUnavailable gate: no recording, no todo, tooltip shown', () => {
        const launcher = mountWithSpeech();
        document.body.classList.add('claudeUnavailable');
        try {
            firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
            vi.advanceTimersByTime(500);
            expect(FakeRecognition.instances.length).toBe(0);
            expect(launcher.classList.contains('micButton--recording')).toBe(false);
            expect(document.querySelector('.claudeUnavailableTooltip')).toBeTruthy();
            firePointer(launcher, 'pointerup', { clientX: 5, clientY: 5 });
            expect(committedTitles()).toEqual([]);
        } finally {
            document.body.classList.remove('claudeUnavailable');
        }
    });

    it('(m) pointercancel during recording aborts without committing', () => {
        const launcher = mountWithSpeech();
        firePointer(launcher, 'pointerdown', { clientX: 5, clientY: 5 });
        vi.advanceTimersByTime(500);
        lastRecognition().emitResult('should not commit');
        firePointer(launcher, 'pointercancel', { clientX: 5, clientY: 5 });
        expect(committedTitles()).toEqual([]);
        expect(launcher.classList.contains('micButton--recording')).toBe(false);
    });
});
