import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for the add-project button not auto-focusing the new
// project input on mobile. Bug: tapping the sidebar add-project button
// inserted a new project row whose input was never focused, so iOS Safari
// did not summon the soft keyboard and the user had to tap again. Fix
// calls .focus() on the newly-appended titleInput synchronously at the
// top level of the click handler, in the same user-gesture tick.
describe('add-project button focuses the new project input on click', () => {
    const js = read('main.js');

    // Isolate the click handler attached to #projButton that appends a new
    // project row, so the assertions below don't false-positive against
    // unrelated code in main.js. Uses a unique marker comment that precedes
    // only this handler.
    function extractAddProjectClickHandler() {
        const marker = '// Click Listener: That adds new project element';
        const markerIdx = js.indexOf(marker);
        expect(markerIdx).toBeGreaterThan(-1);
        const handlerStart = js.indexOf('addEventListener("click"', markerIdx);
        expect(handlerStart).toBeGreaterThan(-1);
        const bodyStart = js.indexOf('{', handlerStart);
        let depth = 0;
        for (let i = bodyStart; i < js.length; i++) {
            const c = js[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return js.slice(bodyStart, i + 1);
            }
        }
        throw new Error('unterminated projButton click handler');
    }

    const rawBody = extractAddProjectClickHandler();
    // Strip line and block comments so position-based assertions below don't
    // false-match against text inside explanatory comments in the handler.
    const body = rawBody
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');

    // Collects every offset of titleInput.focus() along with its brace-nesting
    // depth inside the click handler body. The outer click handler starts at
    // depth 1 (the first `{`), so top-level statements in the handler — the
    // ones that run synchronously in the user-gesture tick — are depth 1.
    // Anything nested deeper lives inside a callback or nested function.
    function focusCallsWithDepth() {
        const matches = [];
        const re = /titleInput\.focus\(\s*\)/g;
        let m;
        while ((m = re.exec(body)) !== null) {
            let depth = 0;
            for (let i = 0; i < m.index; i++) {
                if (body[i] === '{') depth++;
                else if (body[i] === '}') depth--;
            }
            matches.push({ index: m.index, depth });
        }
        return matches;
    }

    it('appends the new project input to the sidebar', () => {
        expect(body).toMatch(/projChild\.appendChild\(\s*titleInput\s*\)/);
    });

    it('calls titleInput.focus() at the top level of the click handler', () => {
        const calls = focusCallsWithDepth();
        const topLevel = calls.filter(function(c) { return c.depth === 1; });
        expect(topLevel.length).toBeGreaterThan(0);
    });

    it('focuses after the input is appended to the DOM', () => {
        const appendIdx = body.search(/projChild\.appendChild\(\s*titleInput\s*\)/);
        expect(appendIdx).toBeGreaterThan(-1);
        const calls = focusCallsWithDepth().filter(function(c) { return c.depth === 1; });
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0].index).toBeGreaterThan(appendIdx);
    });

    it('focuses synchronously — not wrapped in setTimeout, requestAnimationFrame, or a Promise', () => {
        // iOS Safari only honors .focus() when it runs in the same
        // user-gesture tick as the click. Anything that defers it breaks
        // that and silently drops the soft keyboard.
        const calls = focusCallsWithDepth().filter(function(c) { return c.depth === 1; });
        expect(calls.length).toBeGreaterThan(0);
        // A small window preceding the top-level focus call should not
        // contain deferring constructs.
        const focusIdx = calls[0].index;
        const window = body.slice(Math.max(0, focusIdx - 160), focusIdx);
        expect(window).not.toMatch(/setTimeout\s*\(/);
        expect(window).not.toMatch(/requestAnimationFrame\s*\(/);
        expect(window).not.toMatch(/\.then\s*\(/);
        expect(window).not.toMatch(/\bawait\b/);
    });
});
