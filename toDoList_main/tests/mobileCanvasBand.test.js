import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// In a stuck standalone session (the iOS keyboard bug that shrinks the layout
// viewport ~59px for the rest of the session) the OS extends the root canvas
// colour into the strip below the shrunken viewport, and shades the tab bar's
// bottom ~30px with a gradient that hard-cuts at that boundary. Measurement of
// the shading showed it bottoming out within ~1 RGB point of --bg-base, while
// the mobile canvas painted --bg-elevated — a visible lightness step at the
// boundary.
//
// This deliberately REVERSES the earlier decision to match the canvas to the
// bar's surface: the canvas now paints --bg-base so the band continues the
// shading's landing colour and the bar reads as fading into its own shadow.
// Matching --bg-elevated re-creates the step. Nothing on the page side of the
// boundary may add a gradient, shadow, or pseudo-element to soften it.
//
// Verified by source inspection because jsdom does no stylesheet resolution and
// main.js is too large to instantiate (per CLAUDE.md guidance).
describe('mobile canvas band — body paints --bg-base so the stuck-session edge disappears', () => {
    const css = read('style.css');

    // Every `body { ... }` rule body in the stylesheet, in source order.
    function bodyRuleBodies() {
        return [...css.matchAll(/(^|[\s},])body\s*\{([\s\S]*?)\}/g)].map(m => m[2]);
    }

    // The mobile canvas declaration lives in the ≤1023px block and is the only
    // body rule pinned to the dynamic viewport.
    function mobileBodyRule() {
        const hit = bodyRuleBodies().filter(b => /min-height:\s*100dvh/.test(b));
        expect(hit.length).toBe(1);
        return hit[0];
    }

    it('(a) the mobile body canvas paints --bg-base, not the bar surface', () => {
        const rule = mobileBodyRule();
        expect(rule).toMatch(/background:\s*var\(--bg-base\)/);
        // The reverted value. Restoring it re-creates the lightness step the
        // OS shading's hard cut makes visible at the old viewport line.
        expect(rule).not.toMatch(/background:\s*var\(--bg-elevated\)/);
    });

    it('(b) the desktop body rule is untouched — it already painted --bg-base', () => {
        // Desktop keeps `padding: 16px` and its own --bg-base canvas, which is
        // never visible behind the inset #outerContainer card anyway.
        const desktop = bodyRuleBodies().filter(b => /padding:\s*16px/.test(b))[0];
        expect(desktop).toBeTruthy();
        expect(desktop).toMatch(/background:\s*var\(--bg-base\)/);
    });

    it('(c) #outerContainer still covers the mobile viewport with the elevated frame', () => {
        // The reason repainting the canvas is safe everywhere else: the shell is
        // 100dvh and paints --bg-elevated over the whole viewport, so the band
        // and momentary overscroll are the only reveals of the body token.
        const shells = [...css.matchAll(/(^|[\s},])#outerContainer\s*\{([\s\S]*?)\}/g)]
            .map(m => m[2]);
        expect(shells.some(b => /height:\s*100dvh/.test(b))).toBe(true);
        expect(shells.some(b => /background:\s*var\(--bg-elevated\)/.test(b))).toBe(true);
    });

    it('(d) nothing on the page side of the boundary softens the seam', () => {
        // No gradient, shadow, or pseudo-element was added under the tab bar to
        // fake the transition — the flat band IS the mitigation.
        const barBlocks = [...css.matchAll(/(^|[\s},])#mobileTabBar\s*\{([\s\S]*?)\}/g)]
            .map(m => m[2]);
        const laidOut = barBlocks.filter(b => /position:\s*fixed\s*;/.test(b))[0];
        expect(laidOut).toBeTruthy();
        expect(laidOut).not.toMatch(/box-shadow/);
        expect(laidOut).not.toMatch(/gradient/);
        expect(css).not.toMatch(/#mobileTabBar::after\s*\{/);
    });

    it('(e) the rationale comment documents the reversal', () => {
        // The comment governing the declaration used to justify matching the
        // bar's surface ("so any residual gap blends"). It must now state why
        // base is correct, so the next reader does not "fix" it back.
        const idx = css.search(/body\s*\{[^}]*min-height:\s*100dvh/);
        expect(idx).toBeGreaterThan(-1);
        const preamble = css.slice(Math.max(0, idx - 1600), idx);
        expect(preamble).toMatch(/--bg-base/);
        expect(preamble).toMatch(/revers/i);
        expect(preamble).not.toMatch(/so any residual gap blends/);
    });
});
