// App lock (PIN) — persistence, the boxed digit inputs, the lock overlay,
// and the idle watch that mounts it.
//
// The invariants worth pinning, because each one is silently violable:
//   • the PIN is never stored in plaintext — a localStorage read must not
//     hand the digits back;
//   • the overlay honours NONE of the three modal-close affordances (no
//     close button, backdrop click, Escape) — an app lock you can Escape out
//     of is not a lock, and the app's own modal convention would otherwise
//     be the obvious thing to copy;
//   • the lock arms only when it is enabled AND a PIN exists — an enabled
//     flag with no stored PIN would mount an overlay nothing can dismiss;
//   • an idle span that already elapsed while the app was closed still
//     locks on boot, since a setTimeout alone cannot span a reload.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
    APP_LOCK_ACTIVITY_KEY,
    APP_LOCK_ENABLED_KEY,
    APP_LOCK_PIN_KEY,
    APP_LOCK_TIMEOUT_KEY,
    APP_LOCK_DEFAULT_TIMEOUT_MINUTES,
    PIN_LENGTH,
    clearAppLock,
    createPinDigitInputs,
    enforceAppLockIdle,
    hasAppLockPin,
    isAppLockArmed,
    isAppLockEnabled,
    isAppLocked,
    isValidPin,
    lockApp,
    markAppLockActivity,
    readAppLockTimeoutMinutes,
    rearmAppLockTimer,
    resetAppLockWatchForTests,
    setAppLockEnabled,
    setAppLockPin,
    startAppLockWatch,
    unlockApp,
    verifyAppLockPin,
    writeAppLockTimeoutMinutes,
} from '../src/appLock.js';

// Drive a boxed digit input the way a keyboard would: set the character,
// then fire the input event the builder listens for.
function typeDigit(input, char) {
    input.value = char;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

function typePin(pin, root) {
    const inputs = [...(root || document).querySelectorAll('.pinDigitInput')];
    for (let i = 0; i < pin.length; i++) typeDigit(inputs[i], pin[i]);
    return inputs;
}

function armLock(pin, minutes) {
    setAppLockPin(pin);
    setAppLockEnabled(true);
    writeAppLockTimeoutMinutes(minutes);
    markAppLockActivity();
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    document.body.className = '';
    resetAppLockWatchForTests();
});

afterEach(() => {
    vi.useRealTimers();
    if (isAppLocked()) unlockApp();
    resetAppLockWatchForTests();
    document.body.innerHTML = '';
    document.body.className = '';
});

describe('appLock — PIN persistence', () => {
    it('stores a salted digest, never the digits themselves', () => {
        expect(setAppLockPin('4821')).toBe(true);
        const raw = localStorage.getItem(APP_LOCK_PIN_KEY);
        expect(raw).toBeTruthy();
        expect(raw).not.toContain('4821');
        // `<salt>:<digest>` — both halves non-empty and hex.
        const [salt, digest] = raw.split(':');
        expect(salt).toMatch(/^[0-9a-f]+$/);
        expect(digest).toMatch(/^[0-9a-f]{32}$/);
    });

    it('salts per write, so the same PIN stored twice yields different values', () => {
        setAppLockPin('1234');
        const first = localStorage.getItem(APP_LOCK_PIN_KEY);
        setAppLockPin('1234');
        expect(localStorage.getItem(APP_LOCK_PIN_KEY)).not.toBe(first);
        // Both still verify — the salt travels with the digest.
        expect(verifyAppLockPin('1234')).toBe(true);
    });

    it('verifies the right PIN and rejects wrong / malformed ones', () => {
        setAppLockPin('0007');
        expect(verifyAppLockPin('0007')).toBe(true);
        expect(verifyAppLockPin('0070')).toBe(false);
        expect(verifyAppLockPin('007')).toBe(false);
        expect(verifyAppLockPin('')).toBe(false);
        expect(verifyAppLockPin(null)).toBe(false);
    });

    it('refuses to store anything that is not four digits', () => {
        expect(setAppLockPin('12a4')).toBe(false);
        expect(setAppLockPin('123')).toBe(false);
        expect(setAppLockPin('12345')).toBe(false);
        expect(localStorage.getItem(APP_LOCK_PIN_KEY)).toBeNull();
        expect(isValidPin('1234')).toBe(true);
        expect(isValidPin('12 4')).toBe(false);
    });

    it('verifies against nothing stored without throwing', () => {
        expect(hasAppLockPin()).toBe(false);
        expect(verifyAppLockPin('1234')).toBe(false);
    });

    it('persists everything under the todoapp_ prefix', () => {
        [APP_LOCK_ENABLED_KEY, APP_LOCK_PIN_KEY, APP_LOCK_TIMEOUT_KEY, APP_LOCK_ACTIVITY_KEY]
            .forEach((key) => expect(key.startsWith('todoapp_')).toBe(true));
    });
});

describe('appLock — enabled flag, timeout, and armed state', () => {
    it('arms only when enabled AND a PIN is stored', () => {
        expect(isAppLockArmed()).toBe(false);
        setAppLockEnabled(true);
        // Enabled with no PIN must NOT arm — the overlay would be undismissable.
        expect(isAppLockArmed()).toBe(false);
        setAppLockPin('1111');
        expect(isAppLockArmed()).toBe(true);
        setAppLockEnabled(false);
        expect(isAppLockArmed()).toBe(false);
    });

    it('defaults the idle timeout and rejects unknown stored values', () => {
        expect(readAppLockTimeoutMinutes()).toBe(APP_LOCK_DEFAULT_TIMEOUT_MINUTES);
        writeAppLockTimeoutMinutes(15);
        expect(readAppLockTimeoutMinutes()).toBe(15);
        // 0 is the "Never" option and is a legitimate stored value.
        writeAppLockTimeoutMinutes(0);
        expect(readAppLockTimeoutMinutes()).toBe(0);
        localStorage.setItem(APP_LOCK_TIMEOUT_KEY, '7');
        expect(readAppLockTimeoutMinutes()).toBe(APP_LOCK_DEFAULT_TIMEOUT_MINUTES);
        localStorage.setItem(APP_LOCK_TIMEOUT_KEY, 'soon');
        expect(readAppLockTimeoutMinutes()).toBe(APP_LOCK_DEFAULT_TIMEOUT_MINUTES);
    });

    it('clearAppLock forgets the PIN as well as the flag', () => {
        armLock('9999', 5);
        clearAppLock();
        expect(localStorage.getItem(APP_LOCK_PIN_KEY)).toBeNull();
        expect(localStorage.getItem(APP_LOCK_ENABLED_KEY)).toBeNull();
        expect(localStorage.getItem(APP_LOCK_TIMEOUT_KEY)).toBeNull();
        expect(isAppLockEnabled()).toBe(false);
        expect(hasAppLockPin()).toBe(false);
    });
});

describe('appLock — boxed digit inputs', () => {
    it('renders PIN_LENGTH numeric boxes and advances focus as digits land', () => {
        const digits = createPinDigitInputs({});
        document.body.appendChild(digits.row);
        expect(digits.inputs).toHaveLength(PIN_LENGTH);
        digits.inputs.forEach((input) => {
            expect(input.getAttribute('inputmode')).toBe('numeric');
            expect(input.maxLength).toBe(1);
        });
        digits.focusFirst();
        typeDigit(digits.inputs[0], '3');
        expect(document.activeElement).toBe(digits.inputs[1]);
        typeDigit(digits.inputs[1], '9');
        expect(document.activeElement).toBe(digits.inputs[2]);
        expect(digits.value()).toBe('39');
    });

    it('strips non-numeric characters rather than accepting them', () => {
        const digits = createPinDigitInputs({});
        document.body.appendChild(digits.row);
        typeDigit(digits.inputs[0], 'x');
        expect(digits.inputs[0].value).toBe('');
        expect(digits.value()).toBe('');
    });

    it('walks back to the previous box on Backspace in an empty one', () => {
        const digits = createPinDigitInputs({});
        document.body.appendChild(digits.row);
        typeDigit(digits.inputs[0], '1');
        typeDigit(digits.inputs[1], '2');
        digits.inputs[2].focus();
        digits.inputs[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
        expect(document.activeElement).toBe(digits.inputs[1]);
        expect(digits.value()).toBe('1');
    });

    it('fires onComplete once every box is filled', () => {
        const onComplete = vi.fn();
        const digits = createPinDigitInputs({ onComplete });
        document.body.appendChild(digits.row);
        typePin('4321', digits.row);
        expect(onComplete).toHaveBeenCalledTimes(1);
        expect(onComplete).toHaveBeenCalledWith('4321');
    });

    it('spreads a pasted 4-digit string across the boxes', () => {
        const onComplete = vi.fn();
        const digits = createPinDigitInputs({ onComplete });
        document.body.appendChild(digits.row);
        const paste = new Event('paste', { bubbles: true, cancelable: true });
        paste.clipboardData = { getData: () => '13-57' };
        digits.inputs[0].dispatchEvent(paste);
        expect(digits.value()).toBe('1357');
        expect(onComplete).toHaveBeenCalledWith('1357');
    });
});

describe('appLock — lock overlay', () => {
    it('refuses to mount without a stored PIN', () => {
        setAppLockEnabled(true);
        expect(lockApp()).toBe(false);
        expect(isAppLocked()).toBe(false);
    });

    it('mounts a full-screen overlay and marks the body', () => {
        armLock('2468', 5);
        expect(lockApp()).toBe(true);
        const overlay = document.getElementById('appLockOverlay');
        expect(overlay).toBeTruthy();
        expect(overlay.getAttribute('aria-modal')).toBe('true');
        expect(document.body.classList.contains('appLocked')).toBe(true);
        // Idempotent — a second lock while already locked is a no-op.
        lockApp();
        expect(document.querySelectorAll('#appLockOverlay')).toHaveLength(1);
    });

    it('offers none of the three modal-close affordances', () => {
        armLock('2468', 5);
        lockApp();
        const overlay = document.getElementById('appLockOverlay');
        // No close control of any kind inside the overlay.
        expect(overlay.querySelector('button')).toBeNull();
        // Backdrop click does not dismiss.
        overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(isAppLocked()).toBe(true);
        // Escape does not dismiss, and is swallowed so it can't reach the
        // modals/menus stacked underneath.
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        document.dispatchEvent(escape);
        expect(isAppLocked()).toBe(true);
        expect(escape.defaultPrevented).toBe(true);
    });

    it('unlocks on the correct PIN', () => {
        armLock('2468', 5);
        lockApp();
        typePin('2468');
        expect(isAppLocked()).toBe(false);
        expect(document.body.classList.contains('appLocked')).toBe(false);
    });

    it('reports and clears on a wrong PIN, staying locked', () => {
        armLock('2468', 5);
        lockApp();
        typePin('1357');
        expect(isAppLocked()).toBe(true);
        expect(document.getElementById('appLockError').textContent).toBe('Incorrect PIN');
        expect([...document.querySelectorAll('.pinDigitInput')].every((i) => i.value === '')).toBe(true);
        // A correct retry still works after the failure.
        typePin('2468');
        expect(isAppLocked()).toBe(false);
    });

    it('pulls focus back when it escapes the overlay', () => {
        armLock('2468', 5);
        const outside = document.createElement('button');
        document.body.appendChild(outside);
        lockApp();
        outside.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
        expect(document.activeElement.classList.contains('pinDigitInput')).toBe(true);
    });
});

describe('appLock — idle watch', () => {
    it('locks on boot when the configured span already elapsed', () => {
        vi.useFakeTimers();
        armLock('5150', 5);
        localStorage.setItem(APP_LOCK_ACTIVITY_KEY, String(Date.now() - 6 * 60000));
        startAppLockWatch();
        expect(isAppLocked()).toBe(true);
    });

    it('does not lock on boot inside the configured span', () => {
        vi.useFakeTimers();
        armLock('5150', 5);
        localStorage.setItem(APP_LOCK_ACTIVITY_KEY, String(Date.now() - 60000));
        startAppLockWatch();
        expect(isAppLocked()).toBe(false);
    });

    it('locks once the idle timer runs out, and activity pushes it back', () => {
        vi.useFakeTimers();
        armLock('5150', 1);
        startAppLockWatch();

        vi.advanceTimersByTime(50000);
        expect(isAppLocked()).toBe(false);
        // A keystroke re-arms the timer from now.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        vi.advanceTimersByTime(50000);
        expect(isAppLocked()).toBe(false);
        vi.advanceTimersByTime(11000);
        expect(isAppLocked()).toBe(true);
    });

    it('never schedules a timer on the Never option', () => {
        vi.useFakeTimers();
        armLock('5150', 0);
        startAppLockWatch();
        vi.advanceTimersByTime(60 * 60000);
        expect(isAppLocked()).toBe(false);
        // Nor does the boot check lock, however long the app sat idle.
        localStorage.setItem(APP_LOCK_ACTIVITY_KEY, String(Date.now() - 24 * 60 * 60000));
        expect(enforceAppLockIdle()).toBe(false);
    });

    it('leaves a disarmed lock alone entirely', () => {
        vi.useFakeTimers();
        setAppLockPin('5150');
        setAppLockEnabled(false);
        writeAppLockTimeoutMinutes(1);
        markAppLockActivity();
        startAppLockWatch();
        vi.advanceTimersByTime(5 * 60000);
        expect(isAppLocked()).toBe(false);
    });

    it('does not count keystrokes into the overlay as app activity', () => {
        vi.useFakeTimers();
        armLock('5150', 1);
        startAppLockWatch();
        lockApp();
        const stamp = localStorage.getItem(APP_LOCK_ACTIVITY_KEY);
        vi.advanceTimersByTime(1000);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '5', bubbles: true }));
        expect(localStorage.getItem(APP_LOCK_ACTIVITY_KEY)).toBe(stamp);
    });

    it('re-arms the timer after an unlock', () => {
        vi.useFakeTimers();
        armLock('5150', 1);
        startAppLockWatch();
        vi.advanceTimersByTime(61000);
        expect(isAppLocked()).toBe(true);
        typePin('5150');
        expect(isAppLocked()).toBe(false);
        vi.advanceTimersByTime(61000);
        expect(isAppLocked()).toBe(true);
    });

    it('rearmAppLockTimer schedules nothing while already locked', () => {
        vi.useFakeTimers();
        armLock('5150', 1);
        lockApp();
        const before = vi.getTimerCount();
        rearmAppLockTimer();
        expect(vi.getTimerCount()).toBe(before);
    });

    it('startAppLockWatch installs its listeners once', () => {
        vi.useFakeTimers();
        armLock('5150', 1);
        const addSpy = vi.spyOn(document, 'addEventListener');
        startAppLockWatch();
        const afterFirst = addSpy.mock.calls.filter((c) => c[0] === 'pointerdown').length;
        startAppLockWatch();
        expect(afterFirst).toBe(1);
        expect(addSpy.mock.calls.filter((c) => c[0] === 'pointerdown')).toHaveLength(1);
        addSpy.mockRestore();
    });
});
