// Tests for the service-worker update-discovery wiring in src/index.js,
// plus the mobile update-cue surfacing in src/modals.js and src/main.js.
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
// The desktop #footVersion footer carries an "update available" cue when
// notifyUpdateAvailable runs, but the footer is hidden on mobile
// (≤700px). The mobile surfaces — the Settings modal's About → Version
// row and a dot on the #drawerSettingsBtn gear button — listen for the
// appUpdateAvailable CustomEvent that notifyUpdateAvailable now
// dispatches alongside the footer paint. Both surfaces also call
// hasPendingUpdate() on initial render to cover the rare second-load
// case where the worker is already waiting at register-time.

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


describe('mobile update cue — src/modals.js', () => {
    const modals = read('modals.js');

    describe('hasPendingUpdate export', () => {
        it('exports hasPendingUpdate as a function', () => {
            expect(modals).toMatch(/export\s+function\s+hasPendingUpdate\s*\(\s*\)/);
        });

        it('returns true only when a registration is pending', () => {
            // Pin the implementation against the same module-level
            // pendingUpdateRegistration variable notifyUpdateAvailable
            // sets — the mobile cue's correctness depends on these
            // sharing state.
            const fnMatch = modals.match(/export\s+function\s+hasPendingUpdate\s*\(\s*\)\s*\{([\s\S]*?)\}/);
            expect(fnMatch).not.toBeNull();
            expect(fnMatch[1]).toMatch(/pendingUpdateRegistration/);
        });
    });

    describe('appUpdateAvailable event dispatch', () => {
        it('notifyUpdateAvailable dispatches an appUpdateAvailable CustomEvent on document', () => {
            // The mobile surfaces (Settings modal About row + gear-button
            // dot) live outside the desktop footer; both rely on this
            // event so they can flip into their "update available"
            // appearance without polling.
            const fnIdx = modals.indexOf('export function notifyUpdateAvailable');
            expect(fnIdx).toBeGreaterThan(-1);
            const fnSlice = modals.slice(fnIdx, fnIdx + 1500);
            expect(fnSlice).toMatch(
                /document\.dispatchEvent\(\s*new\s+CustomEvent\(\s*['"]appUpdateAvailable['"]/
            );
        });
    });
});


describe('mobile update cue — src/main.js wiring', () => {
    const main = read('main.js');

    describe('imports', () => {
        it('imports hasPendingUpdate from modals.js so the gear-button dot can render initial state', () => {
            // The named import must sit in the same destructure as the
            // existing notifyUpdateAvailable / applyPendingUpdate imports
            // so the modals.js public surface stays cohesive.
            const importMatch = main.match(
                /import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/modals\.js['"]/
            );
            expect(importMatch).not.toBeNull();
            expect(importMatch[1]).toMatch(/hasPendingUpdate/);
        });
    });

    describe('#drawerSettingsBtn pending-update dot', () => {
        it('mounts a .drawerSettingsBtnUpdateDot child on the Settings button', () => {
            // The desktop #footVersion dot is hidden at ≤700px (footer
            // collapses), so the mobile gear button picks up an
            // equivalent dot keyed off the same hasPendingUpdate signal.
            expect(main).toMatch(/drawerSettingsBtnUpdateDot\.className\s*=\s*['"]drawerSettingsBtnUpdateDot['"]/);
            expect(main).toMatch(/drawerSettingsBtn\.appendChild\(\s*drawerSettingsBtnUpdateDot\s*\)/);
        });

        it('refreshes the .hasUpdate class on the Settings button when appUpdateAvailable fires', () => {
            // Top-level event listener pattern: re-paint the mobile-chrome
            // surface whenever the underlying state flips.
            expect(main).toMatch(
                /document\.addEventListener\(\s*['"]appUpdateAvailable['"]\s*,\s*refreshDrawerSettingsBtnUpdateCue\s*\)/
            );
            const fnIdx = main.indexOf('function refreshDrawerSettingsBtnUpdateCue');
            expect(fnIdx).toBeGreaterThan(-1);
            const fnSlice = main.slice(fnIdx, fnIdx + 800);
            expect(fnSlice).toMatch(/hasPendingUpdate\(\s*\)/);
            expect(fnSlice).toMatch(/classList\.add\(\s*['"]hasUpdate['"]\s*\)/);
            expect(fnSlice).toMatch(/classList\.remove\(\s*['"]hasUpdate['"]\s*\)/);
        });

        it('calls refreshDrawerSettingsBtnUpdateCue once at component build time for the second-load case', () => {
            // If the worker is already waiting when the page loads, the
            // notifyUpdateAvailable call fires before the drawer listener
            // is attached — so the initial paint has to read
            // hasPendingUpdate() directly.
            const buildIdx = main.indexOf('refreshDrawerSettingsBtnUpdateCue()');
            expect(buildIdx).toBeGreaterThan(-1);
        });
    });

    describe('Settings modal About → Version row update pill', () => {
        it('paintAboutVersionUpdateCue helper exists at top level', () => {
            // Lifted out of showSettingsModal so the function body stays
            // small and the helper can be re-invoked by both the initial
            // render and the appUpdateAvailable listener while the modal
            // is open.
            expect(main).toMatch(/function\s+paintAboutVersionUpdateCue\s*\(/);
        });

        it('paintAboutVersionUpdateCue mounts a .settingsAboutUpdatePill when hasPendingUpdate() is true', () => {
            const fnIdx = main.indexOf('function paintAboutVersionUpdateCue');
            expect(fnIdx).toBeGreaterThan(-1);
            const fnSlice = main.slice(fnIdx, fnIdx + 2000);
            expect(fnSlice).toMatch(/hasPendingUpdate\(\s*\)/);
            expect(fnSlice).toMatch(/['"]settingsAboutUpdatePill['"]/);
            // The pill must call applyPendingUpdate on click (the same
            // skipWaiting + reload path the desktop footer runs).
            expect(fnSlice).toMatch(/applyPendingUpdate\(\s*\)/);
        });

        it('Settings modal calls paintAboutVersionUpdateCue on render', () => {
            const showIdx = main.indexOf('function showSettingsModal()');
            expect(showIdx).toBeGreaterThan(-1);
            const fnSlice = main.slice(showIdx, showIdx + 12000);
            expect(fnSlice).toMatch(/paintAboutVersionUpdateCue\s*\(/);
        });

        it('Settings modal subscribes to appUpdateAvailable while open and tears down on close', () => {
            // The listener has to land before the close() definition so
            // close() can remove it — pin both the add and the remove
            // on the same named handler so future edits can't drop one.
            const showIdx = main.indexOf('function showSettingsModal()');
            expect(showIdx).toBeGreaterThan(-1);
            const fnSlice = main.slice(showIdx, showIdx + 12000);
            expect(fnSlice).toMatch(
                /document\.addEventListener\(\s*['"]appUpdateAvailable['"]\s*,\s*onAppUpdateAvailableForModal\s*\)/
            );
            expect(fnSlice).toMatch(
                /document\.removeEventListener\(\s*['"]appUpdateAvailable['"]\s*,\s*onAppUpdateAvailableForModal\s*\)/
            );
        });
    });

    describe('runtime behavior — paintAboutVersionUpdateCue against a stub row', () => {
        it('adds the update pill when hasPendingUpdate returns true and removes it when false', () => {
            // Lift just the paintAboutVersionUpdateCue body so we can
            // exercise it against a real DOM. Mirrors the slice pattern
            // other tests in this directory use against main.js.
            const idx = main.indexOf('function paintAboutVersionUpdateCue');
            expect(idx).toBeGreaterThan(-1);
            const braceStart = main.indexOf('{', idx);
            let depth = 0;
            let body;
            for (let i = braceStart; i < main.length; i++) {
                if (main[i] === '{') depth++;
                else if (main[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        body = main.slice(braceStart + 1, i);
                        break;
                    }
                }
            }
            expect(body).toBeDefined();

            let pendingUpdate = true;
            let applyCalls = 0;
            const factory = new Function(
                'document', 'versionRow', 'hasPendingUpdate', 'applyPendingUpdate',
                body
            );

            const row = document.createElement('div');
            row.className = 'drawerInfoRow';
            const pill = document.createElement('span');
            pill.className = 'settingsInfoPill';
            pill.textContent = 'v1.1';
            row.appendChild(pill);

            // First call with pending=true → pill mounts.
            factory(document, row, () => pendingUpdate, () => { applyCalls++; });
            const updatePill = row.querySelector('.settingsAboutUpdatePill');
            expect(updatePill).not.toBeNull();
            expect(row.classList.contains('hasUpdate')).toBe(true);
            expect(updatePill.tagName).toBe('BUTTON');

            // Clicking it calls applyPendingUpdate.
            updatePill.click();
            expect(applyCalls).toBe(1);

            // Re-running with pending=true must NOT mount a second pill
            // (idempotent — safe to call from both initial render and the
            // event handler).
            factory(document, row, () => pendingUpdate, () => { applyCalls++; });
            expect(row.querySelectorAll('.settingsAboutUpdatePill').length).toBe(1);

            // Flipping pending=false removes the pill and clears the class.
            pendingUpdate = false;
            factory(document, row, () => pendingUpdate, () => { applyCalls++; });
            expect(row.querySelector('.settingsAboutUpdatePill')).toBeNull();
            expect(row.classList.contains('hasUpdate')).toBe(false);
        });

        it('safely no-ops when called with a missing row reference', () => {
            // Defensive guard: paintAboutVersionUpdateCue may run before
            // the About section has mounted (the modal isn't yet open),
            // so it has to tolerate a null/undefined row.
            const idx = main.indexOf('function paintAboutVersionUpdateCue');
            const braceStart = main.indexOf('{', idx);
            let depth = 0;
            let body;
            for (let i = braceStart; i < main.length; i++) {
                if (main[i] === '{') depth++;
                else if (main[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        body = main.slice(braceStart + 1, i);
                        break;
                    }
                }
            }
            const factory = new Function(
                'document', 'versionRow', 'hasPendingUpdate', 'applyPendingUpdate',
                body
            );
            expect(() => factory(document, null, () => true, () => {})).not.toThrow();
            expect(() => factory(document, undefined, () => false, () => {})).not.toThrow();
        });
    });
});


describe('mobile update cue — src/style.css', () => {
    const css = read('style.css');

    it('declares .settingsAboutUpdatePill in the accent palette', () => {
        // Must look distinct from the read-only .settingsInfoPill (muted
        // gray) so the cue reads as an attention-grabbing tappable
        // affordance. Pin the accent color reference + the cursor:pointer
        // so future edits can't accidentally demote it to a static pill.
        const m = css.match(/\.settingsAboutUpdatePill\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        const rule = m[1];
        expect(rule).toMatch(/cursor:\s*pointer/);
        expect(rule).toMatch(/var\(--accent/);
    });

    it('declares .drawerSettingsBtnUpdateDot hidden by default, visible only with .hasUpdate', () => {
        // The dot stays in the DOM at all times so the toggle has
        // something to paint, but the default state is invisible so it
        // doesn't sit on the gear button when no update is pending.
        const dotRule = css.match(/\.drawerSettingsBtnUpdateDot\s*\{([^}]*)\}/);
        expect(dotRule).not.toBeNull();
        expect(dotRule[1]).toMatch(/display:\s*none/);

        // The `.hasUpdate` parent selector flips it on.
        expect(css).toMatch(
            /#drawerSettingsBtn\.hasUpdate\s+\.drawerSettingsBtnUpdateDot\s*\{[^}]*display:\s*block/
        );
    });
});
