import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Differential testing isolated the iOS standalone viewport-shrink bug to
// NON-scrollable shells: an app with a scrollable surface never shrinks,
// because WebKit reveals a focused input by scrolling instead of resizing the
// layout viewport. The probe first gave the DOCUMENT 1px of slack, but a
// scrollable root is the likely trigger for the launch viewport starting short
// and sliding the tab bar / FAB down. The slack now lives on a child scroller:
// the document is flat again and #outerContainer carries exactly 1px of travel
// via an ::after spacer in its final zero-height grid track.
//
// The probe cannot assert its own outcome; the installed-app launch and the
// Diagnostics reading after a keyboard cycle are the verdict. What the test
// locks is that the block is present, complete (slack + overscroll guard +
// unlocked shell overflow + flat root), and scoped to mobile — a partial probe
// (slack with the shell still clipping, or a root still scrollable) reads as
// installed while measuring something else.
//
// Verified by source inspection because jsdom does no stylesheet resolution and
// main.js is too large to instantiate (per CLAUDE.md guidance).
describe('viewport scroll probe — 1px of shell scrollability on mobile', () => {
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

    // Rule bodies whose selector list contains `sel` as a whole selector (so
    // `body::after` / `#outerContainer::after` are excluded).
    function ruleBodies(source, sel) {
        return [...source.matchAll(new RegExp(`(^|[\\s},])${sel}\\s*\\{([\\s\\S]*?)\\}`, 'g'))]
            .map(m => m[2]);
    }

    function mobileGridRows() {
        const shell = ruleBodies(mobileBlock(), '#outerContainer')
            .find(b => /grid-template-rows/.test(b));
        expect(shell).toBeTruthy();
        return shell.match(/grid-template-rows:\s*([^;]+);/)[1].trim().split(/\s+(?![^(]*\))/);
    }

    it('(a) the shell carries exactly 1px of slack in its final zero-height track', () => {
        const spacer = mobileBlock().match(/#outerContainer::after\s*\{([\s\S]*?)\}/);
        expect(spacer).toBeTruthy();
        expect(spacer[1]).toMatch(/content:\s*''/);
        expect(spacer[1]).toMatch(/display:\s*block/);
        expect(spacer[1]).toMatch(/height:\s*1px/);
        const rows = mobileGridRows();
        const row = Number(spacer[1].match(/grid-row:\s*(\d+)/)[1]);
        // The last explicit track, and a fixed zero — so no track resizes.
        expect(row).toBe(rows.length);
        expect(rows[row - 1]).toBe('0');
    });

    it('(b) the shell scrolls vertically, stays clipped horizontally, and does not rubber-band', () => {
        const shell = ruleBodies(mobileBlock(), '#outerContainer')
            .find(b => /height:\s*100dvh/.test(b));
        expect(shell).toBeTruthy();
        expect(shell).toMatch(/overflow-y:\s*auto/);
        expect(shell).toMatch(/overflow-x:\s*hidden/);
        expect(shell).toMatch(/overscroll-behavior-y:\s*none/);
        expect(shell).toMatch(/scrollbar-width:\s*none/);
        expect(mobileBlock()).toMatch(/#outerContainer::-webkit-scrollbar\s*\{\s*display:\s*none;?\s*\}/);
    });

    it('(c) the document itself is flat again — no root slack or root scroll rules', () => {
        const block = mobileBlock();
        expect(block).not.toMatch(/body::after\s*\{/);
        expect(ruleBodies(block, 'body').some(b => /overflow-y:\s*auto/.test(b))).toBe(false);
        expect(ruleBodies(block, 'body').some(b => /overflow-y:\s*hidden/.test(b))).toBe(true);
        expect(block).not.toMatch(/(html|body)::-webkit-scrollbar/);
        expect(ruleBodies(block, 'body').some(b => /min-height:\s*calc\(\s*100dvh\s*\+\s*1px/.test(b))).toBe(false);
    });

    it('(d) desktop keeps the flat, clipping shell and document', () => {
        const base = ruleBodies(css.slice(0, css.indexOf('@media')), 'body')
            .filter(b => /padding:\s*16px/.test(b))[0];
        expect(base).toBeTruthy();
        expect(base).toMatch(/overflow:\s*hidden/);
        const baseShell = ruleBodies(css.slice(0, css.indexOf('@media')), '#outerContainer')[0];
        expect(baseShell).toMatch(/overflow:\s*hidden/);
        expect(baseShell).not.toMatch(/overflow-y:\s*auto/);
    });

    it('(e) the block documents itself as a removable probe', () => {
        const block = mobileBlock();
        const idx = block.search(/#outerContainer::after\s*\{/);
        expect(idx).toBeGreaterThan(-1);
        const preamble = block.slice(0, idx);
        expect(preamble).toMatch(/probe/i);
        expect(preamble).toMatch(/keyboard/i);
        expect(preamble).toMatch(/scroll/i);
    });
});
