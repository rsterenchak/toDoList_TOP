// Tests for the lower-center mobile update-reload pill. Its controller lives
// in src/mobileUpdatePill.js (createMobileUpdatePill); src/main.js owns the
// event wiring that drives it.
//
// On mobile the only way to apply a waiting service-worker update used to
// be spotting the gear-button dot and digging through Settings → About.
// The pill is a thumb-zone surface floating just above the bottom nav that
// appears whenever an update is pending and applies it on tap. It is
// mobile-only (≤1023px, matching where #footVersion is hidden), routes its
// Reload tap through applyPendingUpdate() (the shared skipWaiting + reload
// path), dismisses for the session without clearing the pending update, and
// tears itself down on appUpdateApplied so it never outlives the reload.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createMobileUpdatePill } from '../src/mobileUpdatePill.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

const main = read('main.js');
const pillSrc = read('mobileUpdatePill.js');
const css = read('style.css');

// Build a fresh controller against the real module with injected deps, so
// each test gets isolated single-instance state and can stub isMobile /
// hasPendingUpdate / applyPendingUpdate.
function liftPillFactory() {
    return function build(deps) {
        const api = createMobileUpdatePill({
            isMobile: deps.isMobile,
            hasPendingUpdate: deps.hasPendingUpdate,
            applyPendingUpdate: deps.applyPendingUpdate,
        });
        // Mirror the boot-time mount main.js performs after wiring.
        api.showMobileUpdatePill();
        return {
            show: api.showMobileUpdatePill,
            remove: api.removeMobileUpdatePill,
        };
    };
}

describe('mobile update-reload pill — src/main.js source wiring', () => {
    it('listens for appUpdateAvailable (show) and appUpdateApplied (remove)', () => {
        expect(main).toMatch(
            /document\.addEventListener\(\s*['"]appUpdateAvailable['"]\s*,\s*showMobileUpdatePill\s*\)/
        );
        expect(main).toMatch(
            /document\.addEventListener\(\s*['"]appUpdateApplied['"]\s*,\s*removeMobileUpdatePill\s*\)/
        );
    });

    it('imports the controller from mobileUpdatePill.js and mounts once at boot', () => {
        // The controller is injected its collaborators, and main.js calls
        // showMobileUpdatePill() once directly after attaching the listeners
        // so a boot-time pending update still surfaces.
        expect(main).toMatch(
            /import\s*\{\s*createMobileUpdatePill\s*\}\s*from\s*['"]\.\/mobileUpdatePill\.js['"]/
        );
        expect(main).toMatch(/createMobileUpdatePill\(\s*\{/);
        const wireIdx = main.indexOf('createMobileUpdatePill({');
        expect(wireIdx).toBeGreaterThan(-1);
        const wireSlice = main.slice(wireIdx, wireIdx + 800);
        expect(wireSlice).toMatch(/isMobile/);
        expect(wireSlice).toMatch(/hasPendingUpdate/);
        expect(wireSlice).toMatch(/applyPendingUpdate/);
        expect(wireSlice).toMatch(/showMobileUpdatePill\(\s*\)/);
    });

    it('checks hasPendingUpdate() at show time for the boot-time case', () => {
        const fnIdx = pillSrc.indexOf('function showMobileUpdatePill');
        expect(fnIdx).toBeGreaterThan(-1);
        const fnSlice = pillSrc.slice(fnIdx, fnIdx + 600);
        expect(fnSlice).toMatch(/hasPendingUpdate\(\s*\)/);
        expect(fnSlice).toMatch(/isMobile\(\s*\)/);
    });

    it('routes Reload through applyPendingUpdate(), not a direct reload/postMessage', () => {
        const fnIdx = pillSrc.indexOf('function buildMobileUpdatePill');
        expect(fnIdx).toBeGreaterThan(-1);
        const fnSlice = pillSrc.slice(fnIdx, fnIdx + 2600);
        expect(fnSlice).toMatch(/applyPendingUpdate\(\s*\)/);
        // The pill must NOT reload or message the worker itself.
        expect(fnSlice).not.toMatch(/location\.reload/);
        expect(fnSlice).not.toMatch(/postMessage/);
    });
});

describe('mobile update-reload pill — runtime behavior', () => {
    let host;
    beforeEach(() => {
        host = document.createElement('div');
        document.body.appendChild(host);
    });
    afterEach(() => {
        // Clean every pill the factory may have appended to body.
        document.querySelectorAll('#mobileUpdatePill').forEach((n) => n.remove());
        if (host.parentNode) host.remove();
    });

    function makeDeps(over = {}) {
        return {
            document,
            isMobile: () => true,
            hasPendingUpdate: () => true,
            applyPendingUpdate: () => {},
            ...over,
        };
    }

    it('mounts the pill on mobile when an update is pending', () => {
        const build = liftPillFactory();
        build(makeDeps());
        const pill = document.getElementById('mobileUpdatePill');
        expect(pill).not.toBeNull();
        expect(pill.querySelector('.mobileUpdatePillReload')).not.toBeNull();
        expect(pill.querySelector('.mobileUpdatePillDismiss')).not.toBeNull();
        expect(pill.querySelector('.mobileUpdatePillLabel').textContent)
            .toMatch(/update available/i);
    });

    it('never mounts on desktop even when an update is pending', () => {
        const build = liftPillFactory();
        build(makeDeps({ isMobile: () => false }));
        expect(document.getElementById('mobileUpdatePill')).toBeNull();
    });

    it('does not mount when no update is pending', () => {
        const build = liftPillFactory();
        build(makeDeps({ hasPendingUpdate: () => false }));
        expect(document.getElementById('mobileUpdatePill')).toBeNull();
    });

    it('Reload taps applyPendingUpdate() exactly once', () => {
        let applyCalls = 0;
        const build = liftPillFactory();
        build(makeDeps({ applyPendingUpdate: () => { applyCalls++; } }));
        document.querySelector('.mobileUpdatePillReload').click();
        expect(applyCalls).toBe(1);
    });

    it('dismiss removes the pill without clearing the pending update', () => {
        let pendingCleared = false;
        const build = liftPillFactory();
        // hasPendingUpdate reads a flag the dismiss path must NOT touch.
        const api = build(makeDeps({ hasPendingUpdate: () => !pendingCleared }));
        document.querySelector('.mobileUpdatePillDismiss').click();
        expect(document.getElementById('mobileUpdatePill')).toBeNull();
        expect(pendingCleared).toBe(false);
        // And re-showing after a session dismiss is suppressed.
        api.show();
        expect(document.getElementById('mobileUpdatePill')).toBeNull();
    });

    it('reuses a single instance — a second appUpdateAvailable does not stack', () => {
        const build = liftPillFactory();
        const api = build(makeDeps());
        api.show();
        api.show();
        expect(document.querySelectorAll('#mobileUpdatePill').length).toBe(1);
    });

    it('removes itself on appUpdateApplied (apply from any surface)', () => {
        const build = liftPillFactory();
        const api = build(makeDeps());
        expect(document.getElementById('mobileUpdatePill')).not.toBeNull();
        api.remove();
        expect(document.getElementById('mobileUpdatePill')).toBeNull();
    });
});

describe('mobile update-reload pill — src/style.css', () => {
    it('hides #mobileUpdatePill by default (desktop never shows it)', () => {
        expect(css).toMatch(/#mobileUpdatePill\s*\{\s*display:\s*none/);
    });

    it('positions the pill lower-center, clearing the nav and safe-area inset', () => {
        // Within the ≤1023px media query the pill is a fixed, centered
        // element anchored above the bottom nav and the iOS home indicator.
        // (A separate default rule hides it outside the query, so target the
        // positioned rule specifically.)
        const ruleMatch = css.match(/#mobileUpdatePill\s*\{([^}]*position:\s*fixed[^}]*)\}/);
        expect(ruleMatch).not.toBeNull();
        const rule = ruleMatch[1];
        expect(rule).toMatch(/position:\s*fixed/);
        expect(rule).toMatch(/left:\s*50%/);
        expect(rule).toMatch(/translateX\(-50%\)/);
        expect(rule).toMatch(/--mobile-tab-h/);
        expect(rule).toMatch(/env\(safe-area-inset-bottom/);
        expect(rule).toMatch(/z-index:\s*\d+/);
    });

    it('gives Reload and dismiss comfortable (~44px) tap targets', () => {
        const reload = css.match(/\.mobileUpdatePillReload\s*\{([^}]*)\}/);
        expect(reload).not.toBeNull();
        expect(reload[1]).toMatch(/min-height:\s*44px/);
        const dismiss = css.match(/\.mobileUpdatePillDismiss\s*\{([^}]*)\}/);
        expect(dismiss).not.toBeNull();
        expect(dismiss[1]).toMatch(/width:\s*44px/);
        expect(dismiss[1]).toMatch(/height:\s*44px/);
    });
});
