import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Differential testing isolated the iOS standalone viewport-shrink bug to
// NON-scrollable shells: an app whose document can scroll never shrinks,
// because WebKit reveals a focused input by scrolling the page instead of
// resizing the layout viewport. This probe gives the mobile root the minimum
// slack that could flip WebKit onto that path — one pixel — without changing
// the shell: #outerContainer keeps `height: 100dvh; overflow: hidden` exactly
// as before, and the 1px lives outside it.
//
// The probe cannot assert its own outcome; the installed-app Diagnostics
// reading after a keyboard cycle is the verdict, and a negative reading means
// a follow-up removes this block. What the test locks is that the block is
// present, complete (slack + overscroll guard + unlocked root overflow), and
// scoped to mobile — a partial probe (slack with the root still clamped, or an
// unlocked root with no slack) reads as installed while measuring nothing.
//
// Verified by source inspection because jsdom does no stylesheet resolution and
// main.js is too large to instantiate (per CLAUDE.md guidance).
describe('viewport scroll probe — 1px of root scrollability on mobile', () => {
    const css = read('style.css');

    // Body text of the `@media (max-width: 1023px)` block that carries the
    // mobile canvas rule, extracted by brace matching (nested rules make a
    // regex unreliable).
    function mobileBlock() {
        const opens = [...css.matchAll(/@media \(max-width: 1023px\)\s*\{/g)];
        expect(opens.length).toBeGreaterThan(0);
        for (const open of opens) {
            const start = open.index + open[0].length;
            let depth = 1;
            let i = start;
            while (i < css.length && depth > 0) {
                if (css[i] === '{') depth += 1;
                else if (css[i] === '}') depth -= 1;
                i += 1;
            }
            const body = css.slice(start, i - 1);
            if (/min-height:\s*100dvh/.test(body)) return body;
        }
        throw new Error('mobile ≤1023px block carrying the canvas rule not found');
    }

    // Rule bodies whose selector list contains `body` as a whole element
    // selector (so `body::after` and `body:has(...)` are excluded).
    function bodyRuleBodies(source) {
        return [...source.matchAll(/(^|[\s},])body\s*\{([\s\S]*?)\}/g)].map(m => m[2]);
    }

    it('(a) the mobile block extends the document exactly 1px past the viewport', () => {
        const block = mobileBlock();
        const spacer = block.match(/body::after\s*\{([\s\S]*?)\}/);
        const calcSlack = bodyRuleBodies(block)
            .some(b => /min-height:\s*calc\(\s*100dvh\s*\+\s*1px\s*\)/.test(b));
        // Either shape satisfies the probe; the shipped one is the spacer, so
        // the canvas rule above keeps its own `min-height: 100dvh`.
        expect(Boolean(spacer) || calcSlack).toBe(true);
        if (spacer) {
            expect(spacer[1]).toMatch(/content:\s*''/);
            expect(spacer[1]).toMatch(/display:\s*block/);
            // Exactly one pixel — the probe is about nominal scrollability,
            // not about giving the page somewhere to go.
            expect(spacer[1]).toMatch(/height:\s*1px/);
        }
    });

    it('(b) the mobile block unlocks vertical overflow on the root scroller', () => {
        const block = mobileBlock();
        // html's overflow stays `visible`, so body's value is what propagates
        // to the viewport. Without this the 1px of slack is simply clipped and
        // the document is still unscrollable.
        expect(bodyRuleBodies(block).some(b => /overflow-y:\s*auto/.test(b))).toBe(true);
    });

    it('(c) the newly-scrollable root carries the overscroll guard', () => {
        const block = mobileBlock();
        const guarded = [...block.matchAll(/(^|[\s},])(html|body|html,\s*\n?\s*body)\s*\{([\s\S]*?)\}/g)]
            .some(m => /overscroll-behavior-y:\s*none/.test(m[3]));
        expect(guarded).toBe(true);
    });

    it('(d) the app shell is untouched — still 100dvh and still clipping', () => {
        // The probe must not change the shell; if it did, a negative device
        // verdict could not be undone by deleting one block.
        const shells = [...css.matchAll(/(^|[\s},])#outerContainer\s*\{([\s\S]*?)\}/g)]
            .map(m => m[2]);
        expect(shells.some(b => /height:\s*100dvh/.test(b))).toBe(true);
        expect(shells.some(b => /overflow:\s*hidden/.test(b))).toBe(true);
        // No mobile override reopens the shell's own overflow.
        expect(bodyRuleBodies(mobileBlock())).toBeTruthy();
        const mobileShell = [...mobileBlock().matchAll(/(^|[\s},])#outerContainer\s*\{([\s\S]*?)\}/g)]
            .map(m => m[2]);
        expect(mobileShell.some(b => /overflow/.test(b))).toBe(false);
    });

    it('(e) desktop keeps the flat, unscrollable document', () => {
        // The base `body { overflow: hidden }` outside any media query is what
        // desktop still resolves to; the probe only ever overrides the y axis
        // inside the ≤1023px block.
        const base = bodyRuleBodies(css.slice(0, css.indexOf('@media')))
            .filter(b => /padding:\s*16px/.test(b))[0];
        expect(base).toBeTruthy();
        expect(base).toMatch(/overflow:\s*hidden/);
        expect(base).not.toMatch(/overflow-y:\s*auto/);
    });

    it('(f) the block documents itself as a removable probe', () => {
        // A future reader must be able to tell this is an experiment awaiting a
        // device verdict, not a load-bearing layout rule.
        const block = mobileBlock();
        const idx = block.search(/body::after\s*\{|min-height:\s*calc\(\s*100dvh\s*\+\s*1px/);
        expect(idx).toBeGreaterThan(-1);
        const preamble = block.slice(0, idx);
        expect(preamble).toMatch(/probe/i);
        expect(preamble).toMatch(/keyboard/i);
        expect(preamble).toMatch(/scroll/i);
    });
});
