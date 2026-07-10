import { vi } from 'vitest';
import {
    mountClaudeSheet,
    isClaudeSheetOpen,
} from '../src/claudeSheet.js';
import { listLogic } from '../src/listLogic.js';

// A minimal stand-in for the browser's SpeechRecognition, mirroring the fake
// used by the composer-mic tests. Each constructed instance registers itself so
// tests can drive its lifecycle callbacks the way the real engine would.
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

// Dispatch a touch lifecycle event with the single-touch shape the handlers
// read (`event.touches[0].clientX/clientY`). jsdom has no TouchEvent, so a plain
// cancelable Event with a `touches` array is enough to exercise the wiring.
function fireTouch(el, type, x, y) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    ev.touches = (type === 'touchend' || type === 'touchcancel')
        ? []
        : [{ clientX: x, clientY: y }];
    el.dispatchEvent(ev);
    return ev;
}

function fireMouse(el, type, x, y) {
    el.dispatchEvent(new MouseEvent(type, {
        button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true,
    }));
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
        listLogic.listProjectsArray().forEach(function (name) {
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
            .map(function (i) { return i.tit; })
            .filter(function (t) { return t !== ''; });
    }

    it('(a) a long-press starts a dedicated recognition session in the recording state', () => {
        const launcher = mountWithSpeech();
        fireTouch(launcher, 'touchstart', 5, 5);
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
        fireTouch(launcher, 'touchstart', 5, 5);
        vi.advanceTimersByTime(500);
        lastRecognition().emitResult('buy oat milk');
        fireTouch(launcher, 'touchend');
        expect(committedTitles()).toEqual(['buy oat milk']);
        expect(isClaudeSheetOpen()).toBe(false);
        expect(launcher.classList.contains('micButton--recording')).toBe(false);
        // The list was re-rendered so the new row is visible without a reload.
        expect(document.getElementById('mainList').childElementCount).toBeGreaterThan(0);
    });

    it('(c) the trailing click after a long-press is swallowed and never opens the sheet', () => {
        const launcher = mountWithSpeech();
        fireTouch(launcher, 'touchstart', 5, 5);
        vi.advanceTimersByTime(500);
        lastRecognition().emitResult('call the dentist');
        fireTouch(launcher, 'touchend');
        // Emulated click the browser fires after touchend.
        launcher.click();
        expect(isClaudeSheetOpen()).toBe(false);
        expect(committedTitles()).toEqual(['call the dentist']);
    });

    it('(d) a short tap still opens the chat sheet (no long-press fired)', () => {
        const launcher = mountWithSpeech();
        fireTouch(launcher, 'touchstart', 5, 5);
        vi.advanceTimersByTime(200); // released before the 500ms threshold
        fireTouch(launcher, 'touchend');
        expect(FakeRecognition.instances.length).toBe(0);
        launcher.click();
        expect(isClaudeSheetOpen()).toBe(true);
        expect(committedTitles()).toEqual([]);
    });

    it('(e) moving more than 10px before the threshold cancels the long-press', () => {
        const launcher = mountWithSpeech();
        fireTouch(launcher, 'touchstart', 5, 5);
        fireTouch(launcher, 'touchmove', 40, 5);
        vi.advanceTimersByTime(500);
        expect(FakeRecognition.instances.length).toBe(0);
        expect(launcher.classList.contains('micButton--recording')).toBe(false);
    });

    it('(f) a natural recognition end commits the transcript exactly once', () => {
        const launcher = mountWithSpeech();
        fireTouch(launcher, 'touchstart', 5, 5);
        vi.advanceTimersByTime(500);
        lastRecognition().emitResult('water the plants');
        // Engine ends on its own (speaker paused) before the user releases.
        lastRecognition().stop();
        expect(committedTitles()).toEqual(['water the plants']);
        expect(launcher.classList.contains('micButton--recording')).toBe(false);
        // Releasing afterward must not add a second todo.
        fireTouch(launcher, 'touchend');
        expect(committedTitles()).toEqual(['water the plants']);
    });

    it('(g) desktop press-and-hold mirrors the touch flow', () => {
        const launcher = mountWithSpeech();
        fireMouse(launcher, 'mousedown', 5, 5);
        vi.advanceTimersByTime(500);
        expect(launcher.classList.contains('micButton--recording')).toBe(true);
        lastRecognition().emitResult('renew library books');
        fireMouse(launcher, 'mouseup', 5, 5);
        // The real click that follows mouseup must be swallowed.
        launcher.click();
        expect(committedTitles()).toEqual(['renew library books']);
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('(h) an empty transcript adds no todo', () => {
        const launcher = mountWithSpeech();
        fireTouch(launcher, 'touchstart', 5, 5);
        vi.advanceTimersByTime(500);
        // no emitResult — nothing was heard
        fireTouch(launcher, 'touchend');
        expect(committedTitles()).toEqual([]);
    });

    it('(i) a mic permission denial moves the launcher to the denied state and adds nothing', () => {
        const launcher = mountWithSpeech();
        fireTouch(launcher, 'touchstart', 5, 5);
        vi.advanceTimersByTime(500);
        lastRecognition().emitError('not-allowed');
        expect(launcher.classList.contains('micButton--denied')).toBe(true);
        expect(launcher.classList.contains('micButton--recording')).toBe(false);
        fireTouch(launcher, 'touchend');
        expect(committedTitles()).toEqual([]);
    });

    it('(j) a start() failure retries once then falls back to the denied state', () => {
        const launcher = mountWithSpeech();
        FakeRecognition.throwOnStart = true;
        fireTouch(launcher, 'touchstart', 5, 5);
        vi.advanceTimersByTime(500);
        // Two instances constructed (initial + one retry), neither started.
        expect(FakeRecognition.instances.length).toBe(2);
        expect(launcher.classList.contains('micButton--denied')).toBe(true);
        fireTouch(launcher, 'touchend');
        expect(committedTitles()).toEqual([]);
    });

    it('(k) when speech recognition is unsupported the long-press no-ops into the denied state', () => {
        delete window.SpeechRecognition;
        delete window.webkitSpeechRecognition;
        mountClaudeSheet(document.body);
        const launcher = document.getElementById('claudeLauncher');
        fireTouch(launcher, 'touchstart', 5, 5);
        vi.advanceTimersByTime(500);
        expect(FakeRecognition.instances.length).toBe(0);
        expect(launcher.classList.contains('micButton--denied')).toBe(true);
        fireTouch(launcher, 'touchend');
        expect(committedTitles()).toEqual([]);
    });

    it('(l) respects the isClaudeUnavailable gate: no recording, no todo, tooltip shown', () => {
        const launcher = mountWithSpeech();
        document.body.classList.add('claudeUnavailable');
        try {
            fireTouch(launcher, 'touchstart', 5, 5);
            vi.advanceTimersByTime(500);
            expect(FakeRecognition.instances.length).toBe(0);
            expect(launcher.classList.contains('micButton--recording')).toBe(false);
            expect(document.querySelector('.claudeUnavailableTooltip')).toBeTruthy();
            fireTouch(launcher, 'touchend');
            expect(committedTitles()).toEqual([]);
        } finally {
            document.body.classList.remove('claudeUnavailable');
        }
    });
});
