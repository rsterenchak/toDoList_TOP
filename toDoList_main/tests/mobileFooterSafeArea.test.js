import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the mobile footer safe-area fix so it cannot silently regress.
// The bug was: on iOS Safari the footer row ("TASK MANAGEMENT V1.1 …") was
// clipped at the bottom of the viewport, with only the top of the text
// visible. The fix relies on three cooperating pieces — the meta viewport
// opts into safe-area insets, the mobile footer reserves the home-indicator
// padding, and the outer-container grid uses minmax(0, 1fr) on the middle
// row so a tall todo list cannot inflate that track and push the footer row
// below the viewport. Each assertion below covers one of those pieces.
describe('mobile footer safe-area layout', () => {
    const css = read('style.css');
    const html = read('template.html');

    it('template.html opts into safe-area env() values with viewport-fit=cover', () => {
        const meta = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
        expect(meta).not.toBeNull();
        expect(meta[0]).toMatch(/viewport-fit\s*=\s*cover/);
    });

    function extractRule(selector, mediaQuery) {
        // Grab the declaration block for `selector` scoped inside the first
        // `@media (max-width: 700px)` block in the file. Deliberately naive
        // parsing — our CSS is hand-written with predictable indentation.
        const media = css.indexOf(`@media ${mediaQuery}`);
        expect(media).toBeGreaterThan(-1);
        // Find the selector after the media opener.
        const selIndex = css.indexOf(selector + ' {', media);
        expect(selIndex).toBeGreaterThan(-1);
        const blockStart = css.indexOf('{', selIndex);
        const blockEnd = css.indexOf('}', blockStart);
        return css.slice(blockStart + 1, blockEnd);
    }

    it('mobile #footBar reserves env(safe-area-inset-bottom) as padding-bottom', () => {
        const rule = extractRule('#footBar', '(max-width: 700px)');
        expect(rule).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\)/);
    });

    it('mobile #outerContainer grid uses minmax(0, 1fr) on the middle row', () => {
        const rule = extractRule('#outerContainer', '(max-width: 700px)');
        expect(rule).toMatch(/minmax\(\s*0\s*,\s*1fr\s*\)/);
        // And the footer track still grows by the bottom safe-area inset.
        expect(rule).toMatch(/calc\(\s*var\(--foot-h\)\s*\+\s*env\(safe-area-inset-bottom\)\s*\)/);
    });

    // Follow-up fix: the footer was still clipping on iOS Safari because
    // `html, body { height: 100% }` can resolve to 100svh while
    // `#outerContainer` is `height: 100dvh`. When the dynamic viewport
    // reports a larger value than body, `body { overflow: hidden }` crops
    // the outer grid's bottom and the footer row with it. Pinning body to
    // `min-height: 100dvh` keeps it tall enough to hold the full outer
    // container, and matching body's bg to the footer color hides any
    // residual gap below the grid instead of revealing `--bg-base`.
    it('mobile body is pinned to at least the dynamic viewport height', () => {
        const rule = extractRule('body', '(max-width: 700px)');
        expect(rule).toMatch(/min-height:\s*100dvh/);
    });

    it('mobile body background matches the footer surface so any gap blends in', () => {
        const rule = extractRule('body', '(max-width: 700px)');
        expect(rule).toMatch(/background:\s*var\(--bg-elevated\)/);
    });
});
