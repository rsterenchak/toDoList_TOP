import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the mobile bottom-edge layout after the footBar removal.
// Before: a separate #footBar row reserved env(safe-area-inset-bottom)
// as padding, but the safe-area zone painted below the actual footer
// text — leaving a visible black band beneath the #mobileTabBar. The fix
// drops the #outerContainer footer grid track entirely and re-anchors
// #mobileTabBar to `bottom: 0` with the home-indicator inset absorbed
// into its own padding-bottom, so the bar's elevated bg paints flush to
// the screen edge. Each assertion below pins one piece of that contract.
describe('mobile bottom-edge layout (footBar removal + flush mobileTabBar)', () => {
    const css = read('style.css');
    const html = read('template.html');

    it('template.html opts into safe-area env() values with viewport-fit=cover', () => {
        const meta = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);
        expect(meta).not.toBeNull();
        expect(meta[0]).toMatch(/viewport-fit\s*=\s*cover/);
    });

    function extractRule(selector, mediaQuery) {
        // Grab the declaration block for `selector` scoped inside ANY
        // `@media ${mediaQuery}` block in the file. Some selectors —
        // notably #mobileTabBar — exist at top level too (display: none
        // baseline) plus inside a mobile media query (the activation
        // styles), so we walk every match and return the first one
        // whose enclosing context is the requested media query.
        const mediaOpener = `@media ${mediaQuery}`;
        // Find all top-level media starts so we can test enclosure.
        const mediaStarts = [];
        for (let i = 0; ; ) {
            const next = css.indexOf(mediaOpener, i);
            if (next < 0) break;
            const open = css.indexOf('{', next);
            // Walk to matching close brace.
            let depth = 1;
            let j = open + 1;
            while (j < css.length && depth > 0) {
                if (css[j] === '{') depth++;
                else if (css[j] === '}') depth--;
                j++;
            }
            mediaStarts.push({ start: open + 1, end: j - 1 });
            i = j;
        }
        expect(mediaStarts.length).toBeGreaterThan(0);

        // Find the first occurrence of `selector {` inside any media block.
        for (const { start, end } of mediaStarts) {
            const sub = css.slice(start, end);
            const re = new RegExp(
                '(^|[\\s},])' +
                selector.replace(/[#.]/g, m => '\\' + m) +
                '\\s*\\{'
            );
            const m = sub.match(re);
            if (!m) continue;
            const localOffset = m.index + m[0].length;
            const blockStart = start + localOffset - 1; // position of the `{`
            // Find matching `}` for this rule.
            let depth = 1;
            let k = blockStart + 1;
            while (k < css.length && depth > 0) {
                if (css[k] === '{') depth++;
                else if (css[k] === '}') depth--;
                k++;
            }
            return css.slice(blockStart + 1, k - 1);
        }
        throw new Error(`no rule for ${selector} inside ${mediaOpener}`);
    }

    it('mobile #footBar is hidden — no separate footer row at this breakpoint', () => {
        const rule = extractRule('#footBar', '(max-width: 1023px)');
        expect(rule).toMatch(/display:\s*none/);
    });

    it('mobile #outerContainer grid collapses the footer track to 0', () => {
        const rule = extractRule('#outerContainer', '(max-width: 1023px)');
        // Middle row still minmax(0, 1fr) so the todo list can't inflate
        // the track past its fair share.
        expect(rule).toMatch(/minmax\(\s*0\s*,\s*1fr\s*\)/);
        // Third track is now `0` — no calc(var(--foot-h) + safe-inset)
        // reservation since #footBar no longer paints here.
        expect(rule).not.toMatch(/calc\(\s*var\(--foot-h\)\s*\+\s*env\(safe-area-inset-bottom\)\s*\)/);
        // The grid-template-rows declaration should explicitly include
        // a zero footer track.
        expect(rule).toMatch(/grid-template-rows:[\s\S]*?\b0\b[\s\S]*?\b0\b/);
    });

    it('mobile #mobileTabBar anchors flush against the screen bottom', () => {
        const rule = extractRule('#mobileTabBar', '(max-width: 1023px)');
        // `bottom: 0` (allowing trailing whitespace / unit-less zero).
        expect(rule).toMatch(/bottom:\s*0\s*;/);
    });

    it('mobile #mobileTabBar absorbs the home-indicator safe-area inset into its own height + padding', () => {
        const rule = extractRule('#mobileTabBar', '(max-width: 1023px)');
        // Height grows by env(safe-area-inset-bottom) so the elevated bg
        // covers the home-indicator zone.
        expect(rule).toMatch(/height:\s*calc\(\s*var\(--mobile-tab-h[^)]*\)\s*\+\s*env\(safe-area-inset-bottom[^)]*\)\s*\)/);
        // padding-bottom reservation keeps the tab labels clear of the
        // iOS home pill.
        expect(rule).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom[^)]*\)/);
    });

    it('mobile #drawerFooter is hidden — version + project count live in the Settings modal instead', () => {
        const rule = extractRule('#drawerFooter', '(max-width: 1023px)');
        expect(rule).toMatch(/display:\s*none/);
    });

    // Follow-up fix from the prior footer-clipping bug: html/body height
    // 100% can resolve to 100svh while #outerContainer is 100dvh; body
    // overflow:hidden crops the outer grid's bottom when body is shorter.
    // Pinning body to min-height: 100dvh keeps it tall enough, and
    // matching body's bg to the elevated surface hides any residual gap.
    it('mobile body is pinned to at least the dynamic viewport height', () => {
        const rule = extractRule('body', '(max-width: 1023px)');
        expect(rule).toMatch(/min-height:\s*100dvh/);
    });

    it('mobile body background matches the elevated surface so any gap blends in', () => {
        const rule = extractRule('body', '(max-width: 1023px)');
        expect(rule).toMatch(/background:\s*var\(--bg-elevated\)/);
    });
});
