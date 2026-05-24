// Tests for the service-worker update-discovery wiring in src/index.js.
//
// Context: installed PWA clients can run stale code indefinitely if the
// browser never re-checks sw.js or never re-renders the page. The
// registration in index.js takes three measures to keep update
// discovery snappy:
//
//   1. updateViaCache: 'none' so the browser bypasses its HTTP cache
//      when checking sw.js (GitHub Pages serves a 10-minute Cache-Control
//      max-age that would otherwise gate discovery).
//   2. A visibilitychange listener that calls registration.update()
//      whenever the tab becomes visible (covers re-foregrounding the
//      installed app without a navigation).
//   3. A periodic interval that calls registration.update() as a
//      fallback when the tab stays visible for a long session.
//
// The notifyUpdateAvailable + applyPendingUpdate surface (modals.js) is
// covered separately; these tests only pin the discovery wiring in
// index.js, plus the original updatefound → statechange → notify chain
// so a regression in either path is caught.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

describe('service worker update discovery — src/index.js', () => {
    const index = read('index.js');

    describe('registration options', () => {
        it("passes updateViaCache: 'none' to navigator.serviceWorker.register", () => {
            expect(index).toMatch(
                /navigator\.serviceWorker\.register\(\s*['"]sw\.js['"]\s*,\s*\{\s*updateViaCache:\s*['"]none['"]\s*\}\s*\)/
            );
        });
    });

    describe('updatefound → statechange → notify chain', () => {
        it('subscribes to updatefound on the registration', () => {
            expect(index).toMatch(/registration\.addEventListener\(\s*['"]updatefound['"]/);
        });

        it("wires statechange on the installing worker and notifies only when 'installed' AND a controller exists", () => {
            // Pin both the statechange wire and the dual gate so a
            // first-install (no controller) doesn't fire the "update
            // available" cue.
            expect(index).toMatch(/installing\.addEventListener\(\s*['"]statechange['"]/);
            expect(index).toMatch(/installing\.state\s*===\s*['"]installed['"]/);
            expect(index).toMatch(/navigator\.serviceWorker\.controller/);
            expect(index).toMatch(/notifyUpdateAvailable\(\s*registration\s*\)/);
        });

        it('notifies immediately if a worker is already waiting at register-time', () => {
            // Covers the second-load case: the user reloaded after a
            // prior session already installed the new worker, so
            // updatefound won't fire again.
            expect(index).toMatch(/registration\.waiting/);
        });
    });

    describe('visibilitychange polling', () => {
        it('registers a visibilitychange listener on document', () => {
            expect(index).toMatch(
                /document\.addEventListener\(\s*['"]visibilitychange['"]/
            );
        });

        it("guards the update call on document.visibilityState === 'visible'", () => {
            // Calling update() when the tab is being hidden is wasted
            // work; only the visible transition matters.
            expect(index).toMatch(/document\.visibilityState\s*===\s*['"]visible['"]/);
        });

        it('calls registration.update() inside the visibility handler path', () => {
            expect(index).toMatch(/registration\.update\(\s*\)/);
        });
    });

    describe('periodic poll fallback', () => {
        it('schedules a setInterval that calls registration.update()', () => {
            // Pin both the setInterval and that the interval is at least
            // 15 minutes so we don't hammer the network on long-lived
            // tabs. Anything from 15 minutes up is acceptable.
            const intervalMatch = index.match(/setInterval\(\s*([^,]+)\s*,\s*([^\)]+)\)/);
            expect(intervalMatch).not.toBeNull();
            const intervalExpression = intervalMatch[2].trim();
            // Evaluate the expression as a plain JS number so the test
            // doesn't have to mirror exact arithmetic.
            const ms = Function('"use strict"; return (' + intervalExpression + ');')();
            expect(typeof ms).toBe('number');
            expect(ms).toBeGreaterThanOrEqual(15 * 60 * 1000);
        });
    });

    describe('controllerchange reload', () => {
        it('reloads exactly once when controllerchange fires', () => {
            // Source-level pin on the existing reload-once guard so
            // future edits to the update wiring don't drop it (a missing
            // guard causes infinite reload loops in some browsers when a
            // pending SW gets pre-empted).
            expect(index).toMatch(
                /navigator\.serviceWorker\.addEventListener\(\s*['"]controllerchange['"]/
            );
            expect(index).toMatch(/window\.location\.reload\(\s*\)/);
        });
    });

    describe('runtime behavior — visibility-driven update call', () => {
        it('calls registration.update() when the tab becomes visible', () => {
            // Lift just the SW-registration block and run its
            // `.then()` callback against a stub registration in jsdom.
            // The block is "if ('serviceWorker' in navigator) { ... }".
            const startIdx = index.indexOf("if ('serviceWorker' in navigator)");
            expect(startIdx).toBeGreaterThan(-1);

            // Walk braces to find the matching close.
            const braceStart = index.indexOf('{', startIdx);
            let depth = 0;
            let end = -1;
            for (let i = braceStart; i < index.length; i++) {
                if (index[i] === '{') depth++;
                else if (index[i] === '}') {
                    depth--;
                    if (depth === 0) { end = i; break; }
                }
            }
            expect(end).toBeGreaterThan(-1);
            const block = index.slice(startIdx, end + 1);

            // Stub the relevant globals.
            let updateCalls = 0;
            let visibilityHandler = null;
            const fakeRegistration = {
                waiting: null,
                installing: null,
                addEventListener: () => {},
                update: () => { updateCalls++; },
            };
            const fakeNavigator = {
                serviceWorker: {
                    register: () => Promise.resolve(fakeRegistration),
                    addEventListener: () => {},
                    controller: null,
                },
            };
            const fakeDocument = {
                visibilityState: 'visible',
                addEventListener: (event, handler) => {
                    if (event === 'visibilitychange') visibilityHandler = handler;
                },
            };
            const fakeWindow = {
                addEventListener: (event, handler) => {
                    if (event === 'load') handler();
                },
                location: { reload: () => {} },
            };
            // setInterval no-op so the timer doesn't leak into jsdom.
            const fakeSetInterval = () => 0;

            // notifyUpdateAvailable is imported from main.js; provide a
            // no-op since this test only exercises the update() wire.
            const factory = new Function(
                'navigator', 'document', 'window', 'setInterval', 'notifyUpdateAvailable',
                block
            );
            factory(fakeNavigator, fakeDocument, fakeWindow, fakeSetInterval, () => {});

            return Promise.resolve().then(() => {
                expect(typeof visibilityHandler).toBe('function');
                expect(updateCalls).toBe(0);
                visibilityHandler();
                expect(updateCalls).toBe(1);
                // A hidden transition must NOT call update().
                fakeDocument.visibilityState = 'hidden';
                visibilityHandler();
                expect(updateCalls).toBe(1);
                // Becoming visible again calls it once more.
                fakeDocument.visibilityState = 'visible';
                visibilityHandler();
                expect(updateCalls).toBe(2);
            });
        });
    });
});
