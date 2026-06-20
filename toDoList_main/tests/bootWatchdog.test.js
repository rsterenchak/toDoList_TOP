// Tests for the inline boot watchdog in src/template.html and its
// boot-signal contract in src/index.js.
//
// Context: the app ships from an empty <body> and is entirely JS-injected,
// with style.css bundled through style-loader. When a stale or mismatched
// service-worker cache serves an app bundle that fails to evaluate, nothing
// renders and no in-app recovery cue can run — the recovery code itself
// never executes. The watchdog therefore lives inline in template.html (so a
// dead bundle can't take it down) and carries its own styles (style.css
// isn't present on a failed boot). It detects a failed boot and silently
// self-heals by busting the cache and reloading; only if that doesn't take
// does it surface a visible "Reload" prompt.
//
// These are source-pattern assertions, mirroring serviceWorkerUpdate.test.js:
// the watchdog runs against built HTML + Cache Storage + SW unregistration,
// none of which jsdom exercises, so the contract is pinned at the source
// level instead.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Brace-walk a top-level `function NAME(...) { ... }` and return its body.
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

describe('boot-signal contract — src/index.js', () => {
    const index = read('index.js');

    it('sets window.__appBooted = true so the inline watchdog stands down', () => {
        expect(index).toMatch(/window\.__appBooted\s*=\s*true/);
    });

    it('clears the recovery counter on a successful boot', () => {
        expect(index).toMatch(
            /sessionStorage\.removeItem\(\s*['"]todoapp_bootRecoveryAttempt['"]\s*\)/
        );
    });

    it('signals boot from the signed-in branch (inside bootApp)', () => {
        const body = liftFunctionBody(index, 'function bootApp(');
        expect(body).not.toBeNull();
        expect(body).toMatch(/markAppBooted\(\s*\)/);
    });

    it('signals boot from the auth-modal branch (after showAuthModal)', () => {
        // At least one showAuthModal() call site is immediately followed by
        // the boot signal, so the watchdog also stands down when the front
        // door renders instead of the signed-in shell.
        expect(index).toMatch(/showAuthModal\(\s*\)\s*;[\s\S]{0,120}?markAppBooted\(\s*\)/);
    });

    it('markAppBooted also nudges the inline watchdog to clear its overlay', () => {
        const body = liftFunctionBody(index, 'function markAppBooted(');
        expect(body).not.toBeNull();
        expect(body).toMatch(/__clearBootWatchdog/);
        expect(body).toMatch(/window\.__appBooted\s*=\s*true/);
        expect(body).toMatch(/removeItem\(\s*['"]todoapp_bootRecoveryAttempt['"]\s*\)/);
    });
});

describe('inline boot watchdog — src/template.html', () => {
    const html = read('template.html');

    it('embeds an inline <script> (no src) so it survives a dead bundle', () => {
        expect(html).toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    });

    it('wraps the watchdog in try/catch so it can never break a healthy boot', () => {
        expect(html).toMatch(/try\s*\{/);
        expect(html).toMatch(/catch\s*\(/);
    });

    it('treats the boot as successful when __appBooted is set or #outerContainer exists', () => {
        expect(html).toMatch(/__appBooted/);
        expect(html).toMatch(/outerContainer/);
    });

    it('arms a one-shot timer (~10s) rather than an interval', () => {
        // The boot-failure check is armed with a setTimeout (one-shot), not a
        // setInterval, so it can never thrash a recovering page.
        expect(html).toMatch(/setTimeout\(\s*escalate\s*,/);
        expect(html).not.toMatch(/setInterval\(/);
        // The arming delay is long enough never to false-fire on a slow cold
        // boot (the flag is set at shell render, not after data load).
        const m = html.match(/TIMEOUT_MS\s*=\s*([0-9_]+)/);
        expect(m).not.toBeNull();
        const ms = Number(m[1].replace(/_/g, ''));
        expect(ms).toBeGreaterThanOrEqual(8000);
        expect(ms).toBeLessThanOrEqual(20000);
    });

    it('escalates by an attempt counter persisted in sessionStorage', () => {
        expect(html).toMatch(/todoapp_bootRecoveryAttempt/);
        expect(html).toMatch(/sessionStorage/);
    });

    it('attempt 0 calls registration.update() then reloads', () => {
        expect(html).toMatch(/\.update\(/);
        expect(html).toMatch(/location\.reload\(/);
    });

    it('deeper bust deletes Cache Storage and unregisters service workers', () => {
        expect(html).toMatch(/caches\.keys\(/);
        expect(html).toMatch(/caches\.delete\(/);
        expect(html).toMatch(/getRegistrations\(/);
        expect(html).toMatch(/\.unregister\(/);
    });

    it('exposes a window.__clearBootWatchdog hook for the app to call on boot', () => {
        expect(html).toMatch(/window\.__clearBootWatchdog\s*=/);
    });

    it('renders the Stage 2 recovery prompt with a Reload affordance', () => {
        expect(html).toMatch(/Reload/);
        expect(html).toMatch(/refresh to finish/i);
        expect(html).toMatch(/close and reopen/i);
    });

    it('hardcodes the Void palette inline (style.css is absent on a failed boot)', () => {
        expect(html).toMatch(/#0e0f14/i);
        expect(html).toMatch(/#8b7bff/i);
        expect(html).toMatch(/#e6e7ee/i);
    });

    it('uses a very high z-index so the overlay sits above any partial chrome', () => {
        expect(html).toMatch(/z-index:\s*2147483647/);
    });
});
