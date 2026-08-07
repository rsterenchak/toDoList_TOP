import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

const cssRaw = readFileSync(resolve(srcDir, 'style.css'), 'utf8');
// Strip block comments before any scanning — the prose around these rules
// names both `--mobile-tab-h` and `env(safe-area-inset-bottom)`, so a
// declaration sweep over the raw text would match explanatory comments
// rather than real declarations.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

// Grab the declaration block for `selector` scoped inside ANY
// `@media ${mediaQuery}` block. Several of these selectors also exist at
// top level (a display:none baseline, or the desktop base rule), so we walk
// every media block and return the first match found inside one.
function extractRule(selector, mediaQuery) {
    const mediaOpener = `@media ${mediaQuery}`;
    const mediaBlocks = [];
    for (let i = 0; ; ) {
        const next = css.indexOf(mediaOpener, i);
        if (next < 0) break;
        const open = css.indexOf('{', next);
        let depth = 1;
        let j = open + 1;
        while (j < css.length && depth > 0) {
            if (css[j] === '{') depth++;
            else if (css[j] === '}') depth--;
            j++;
        }
        mediaBlocks.push({ start: open + 1, end: j - 1 });
        i = j;
    }
    expect(mediaBlocks.length).toBeGreaterThan(0);

    for (const { start, end } of mediaBlocks) {
        const sub = css.slice(start, end);
        const re = new RegExp(
            '(^|[\\s},])' + selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{'
        );
        const m = sub.match(re);
        if (!m) continue;
        const blockStart = start + m.index + m[0].length - 1;
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

// Regression cover for the iOS standalone bottom-gap bug.
//
// iOS reports env(safe-area-inset-bottom) as ~34px when the app is launched
// from an "Add to Home Screen" icon (display-mode: standalone) but as 0 in
// Safari, whose bottom toolbar already covers that band. The mobile bottom
// chrome reserved the RAW inset, so the same build rendered a 56px bar in
// Safari and a 90px bar in standalone — the tabs sat 34px off the screen
// edge above a dead band, and the FAB (pinned at a hardcoded 56px) sank
// into the taller bar.
//
// The fix routes every tab-bar-relative offset through one capped token,
// --mobile-bottom-inset. These assertions pin both halves of that contract:
// the cap itself, and the fact that NO tab-bar-relative offset reintroduces
// the raw inset behind the token's back.
describe('mobile bottom chrome — standalone safe-area inset', () => {
    it(':root defines --mobile-bottom-inset as a capped safe-area inset', () => {
        const rootBlock = css.slice(css.indexOf(':root'), css.indexOf('--mobile-bottom-inset') + 200);
        const decl = rootBlock.match(/--mobile-bottom-inset:\s*([^;]+);/);
        expect(decl).not.toBeNull();
        // min(env(safe-area-inset-bottom, 0px), <cap>) — the min() is what
        // keeps standalone's 34px from becoming dead space under the tabs.
        expect(decl[1]).toMatch(/min\(\s*env\(safe-area-inset-bottom[^)]*\)\s*,\s*\d+px\s*\)/);
    });

    it('the cap is small enough to read as flush, and Safari still resolves it to 0', () => {
        const decl = css.match(/--mobile-bottom-inset:\s*([^;]+);/);
        const cap = Number(decl[1].match(/,\s*(\d+)px\s*\)/)[1]);
        // A reserve larger than this is the very dead band the bug reported.
        expect(cap).toBeLessThanOrEqual(16);
        // The env() fallback must be 0 so non-iOS / Safari-with-toolbar
        // (inset 0) resolves min(0, cap) to 0 and renders exactly as before.
        expect(decl[1]).toMatch(/env\(safe-area-inset-bottom,\s*0px\)/);
    });

    it('no tab-bar-relative offset reserves the raw safe-area inset', () => {
        // Sweep every declaration that positions or sizes against the tab
        // bar. Any one of them still using env(safe-area-inset-bottom)
        // directly would drift from the bar in standalone — exactly the
        // class of regression this bug was.
        const offenders = css
            .split(';')
            .map(d => d.trim())
            .filter(d => d.includes('--mobile-tab-h') && d.includes('env(safe-area-inset-bottom'));
        expect(offenders).toEqual([]);
    });

    it('#mobileTabBar sizes its height and bottom padding from the shared token', () => {
        const rule = extractRule('#mobileTabBar', '(max-width: 1023px)');
        expect(rule).toMatch(
            /height:\s*calc\(\s*var\(--mobile-tab-h[^)]*\)\s*\+\s*var\(--mobile-bottom-inset[^)]*\)\s*\)/
        );
        expect(rule).toMatch(/padding-bottom:\s*var\(--mobile-bottom-inset[^)]*\)/);
        // Still flush against the screen edge — the bar's own bg keeps
        // painting over the home-indicator zone.
        expect(rule).toMatch(/bottom:\s*0\s*;/);
    });

    it('the assistant FAB clears the tab bar\'s full height in both display modes', () => {
        // The launcher's base rule is effectively mobile-only (display:none
        // above 1023px), so the offset lives there rather than in a second
        // media-scoped rule.
        const base = css.slice(css.indexOf('\n#claudeLauncher {'));
        const rule = base.slice(0, base.indexOf('}'));
        expect(rule).toMatch(
            /bottom:\s*calc\(\s*var\(--mobile-tab-h[^)]*\)\s*\+\s*var\(--mobile-bottom-inset[^)]*\)\s*\)/
        );
    });

    it('the TODO.md viewer scroll clearance tracks the FAB it was measured off', () => {
        // The 124px is derived from the launcher's Safari `bottom` offset, so
        // it has to carry the same clearance term or the gap between the
        // viewer card's header controls and the FAB shrinks in standalone.
        const rule = extractRule(
            'body:has\\(#mainList #todoMdViewerCard\\) #mainList',
            '(max-width: 1023px)'
        );
        expect(rule).toMatch(/padding-bottom:\s*calc\(\s*124px\s*\+\s*var\(--mobile-bottom-inset[^)]*\)\s*\)/);
    });

    it('the undo toast tracks the same token so it never lands on the tabs', () => {
        const rule = extractRule('#undoToast', '(max-width: 1023px)');
        expect(rule).toMatch(/bottom:\s*calc\(\s*64px\s*\+\s*var\(--mobile-bottom-inset[^)]*\)\s*\)/);
    });

    it('the mobile app shell is sized with 100dvh, not 100vh', () => {
        const shell = extractRule('#outerContainer', '(max-width: 1023px)');
        expect(shell).toMatch(/height:\s*100dvh/);
        expect(shell).not.toMatch(/100vh/);
        const body = extractRule('body', '(max-width: 1023px)');
        expect(body).toMatch(/min-height:\s*100dvh/);
        expect(body).not.toMatch(/100vh/);
    });
});
