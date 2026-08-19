// Unlocking the PIN overlay is a wake seam, and it is the one wake seam the
// app used to miss entirely.
//
// The idle span that arms the lock (5 minutes by default) is long enough for
// the Supabase realtime socket to drop, but the overlay is an in-page DOM
// takeover — not a backgrounded tab — so an unlock fires no visibilitychange,
// no `online`, and often no window focus either. Every existing wake-recovery
// trigger in index.js hangs off one of those three, which left a freshly
// unlocked device showing whatever it had cached before it locked.
//
// Two halves are pinned here because either alone is a silent no-op:
//   • appLock.js announces the unlock on the document, so index.js has
//     something to hear;
//   • index.js hears it and runs the same re-hydrate + re-subscribe pair the
//     visibility and focus handlers run.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    isAppLocked,
    lockApp,
    markAppLockActivity,
    resetAppLockWatchForTests,
    setAppLockEnabled,
    setAppLockPin,
    unlockApp,
    writeAppLockTimeoutMinutes,
} from '../src/appLock.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function typePin(pin) {
    const inputs = [...document.querySelectorAll('.pinDigitInput')];
    for (let i = 0; i < pin.length; i++) {
        inputs[i].value = pin[i];
        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function armLock(pin, minutes) {
    setAppLockPin(pin);
    setAppLockEnabled(true);
    writeAppLockTimeoutMinutes(minutes);
    markAppLockActivity();
}

describe('appLock — unlock announces the wake', () => {
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

    it('dispatches appLockUnlocked on the document when the correct PIN unlocks', () => {
        const seen = [];
        const onUnlocked = () => { seen.push(isAppLocked()); };
        document.addEventListener('appLockUnlocked', onUnlocked);
        try {
            armLock('2468', 5);
            lockApp();
            expect(seen).toHaveLength(0);
            typePin('2468');
            expect(seen).toHaveLength(1);
            // Announced only after the overlay is gone, so a listener that
            // re-renders isn't painting underneath a still-mounted lock.
            expect(seen[0]).toBe(false);
        } finally {
            document.removeEventListener('appLockUnlocked', onUnlocked);
        }
    });

    it('announces once per unlock, not on every activity stamp', () => {
        let count = 0;
        const onUnlocked = () => { count++; };
        document.addEventListener('appLockUnlocked', onUnlocked);
        try {
            armLock('2468', 5);
            lockApp();
            typePin('2468');
            expect(count).toBe(1);
            markAppLockActivity();
            expect(count).toBe(1);
        } finally {
            document.removeEventListener('appLockUnlocked', onUnlocked);
        }
    });
});

describe('appLockUnlocked wake recovery — src/index.js', () => {
    const index = read('index.js');

    // Brace-walk a top-level `function NAME(...) { ... }` and return its body
    // source. Mirrors the lifting pattern in serviceWorkerUpdate.test.js.
    function liftFunctionBody(source, signature) {
        const idx = source.indexOf(signature);
        if (idx === -1) return null;
        const braceStart = source.indexOf('{', idx);
        let depth = 0;
        for (let i = braceStart; i < source.length; i++) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') {
                depth--;
                if (depth === 0) return source.slice(braceStart + 1, i);
            }
        }
        return null;
    }

    it('registers a document listener for appLockUnlocked', () => {
        expect(index).toMatch(
            /document\.addEventListener\(\s*['"]appLockUnlocked['"][\s\S]*?rehydrateUnlessEditing\(\s*\)[\s\S]*?wakeRecoverRealtime\(\s*\)/
        );
    });

    it('the handler re-hydrates and re-subscribes, keeping the mid-edit guard', () => {
        const guardBody = liftFunctionBody(index, 'function isEditableElementFocused(');
        const rehydrateBody = liftFunctionBody(index, 'function rehydrateUnlessEditing(');
        expect(guardBody).not.toBeNull();
        expect(rehydrateBody).not.toBeNull();

        const handlerMatch = index.match(
            /document\.addEventListener\(\s*['"]appLockUnlocked['"]\s*,\s*function\s*\(\s*\)\s*\{([\s\S]*?)\}\s*\)\s*;/
        );
        expect(handlerMatch).not.toBeNull();
        const handlerBody = handlerMatch[1];

        let activeTag = 'DIV';
        const fakeDocument = {
            get activeElement() {
                return { tagName: activeTag, matches: () => false };
            },
        };

        let hydrateCalls = 0;
        let resubscribeCalls = 0;
        const fakeListLogic = {
            hydrateFromSupabase: () => { hydrateCalls++; },
            resubscribeToRealtime: () => { resubscribeCalls++; },
        };

        const factory = new Function(
            'document', 'listLogic',
            'function isEditableElementFocused(){' + guardBody + '}\n' +
            'function rehydrateUnlessEditing(){' + rehydrateBody + '}\n' +
            'function wakeRecoverRealtime(){ try { listLogic.resubscribeToRealtime(); } catch (_) {} }\n' +
            'return function onUnlocked(){' + handlerBody + '};'
        );
        const onUnlocked = factory(fakeDocument, fakeListLogic);

        onUnlocked();
        expect(hydrateCalls).toBe(1);
        expect(resubscribeCalls).toBe(1);

        // An editable element focused still skips the pull; the re-subscribe
        // is not gated on editing, so live push resumes regardless.
        activeTag = 'TEXTAREA';
        onUnlocked();
        expect(hydrateCalls).toBe(1);
        expect(resubscribeCalls).toBe(2);
    });
});
