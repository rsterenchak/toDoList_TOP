import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile layout corrective fixes that collapse the dead
// band beneath `PROJECT N OF M`, ensure the page-dot row paints, and
// strip the duplicate open/done counts from the mobile footer. The
// desktop chrome retired the old #mainTitle bar — the project view's
// main panel now stacks the mobile project header (mobile-only) over
// the scrollable #mainList, with the EXPAND ALL toggle anchored as an
// overlay on the add-task row. Companion to stackMobileHeader.test.js
// which pins the header's content; this file pins the layout overrides
// that make it render correctly.
describe('STACK mobile layout collapse', () => {
    const css = read('style.css');

    function extractMobileRule(selector) {
        // Grab the declaration block for `selector` scoped inside the
        // first `@media (max-width: 1023px)` block in the file. Same naive
        // parsing helper as mobileFooterSafeArea.test.js.
        const media = css.indexOf('@media (max-width: 1023px)');
        expect(media).toBeGreaterThan(-1);
        const mediaEnd = (function () {
            // Walk braces to find the closing brace of the media block.
            let depth = 0;
            for (let i = css.indexOf('{', media); i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) return i;
                }
            }
            return css.length;
        })();
        const haystack = css.slice(media, mediaEnd);
        // Strip CSS block comments so a /* ... #mainBar ... */ aside in
        // the source can't be mistaken for the selector itself.
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        // Match the selector when it actually opens a rule — i.e.
        // followed (after whitespace) by `{`. This also keeps us from
        // matching `#mainTitle` inside a comma-joined selector list.
        const ruleRe = new RegExp(
            selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
        );
        const match = stripped.match(ruleRe);
        expect(match).not.toBeNull();
        return match[1];
    }

    it('#mainBar grid uses a three-track layout at the mobile breakpoint', () => {
        // Desktop's grid is `auto 1fr` (status filter pill row above the
        // list). Mobile extends to three tracks (mobile header / filter
        // pills / list) so the mobile project header gets its own row
        // above the pill row, which sits above the list. #mainList is
        // pinned to the final 1fr track explicitly so source-order
        // placement can't shift it into the wrong row.
        const rule = extractMobileRule('#mainBar');
        expect(rule).toMatch(/grid-template-rows:\s*auto\s+auto\s+1fr/);
    });

    it('#bulkDescActions is hidden at the mobile breakpoint', () => {
        // The overlay button is desktop-only chrome; the drawer's
        // "Expand all descriptions" toggle invokes bulkDescToggleBtn.click()
        // directly, which continues to work on a display:none button.
        const rule = extractMobileRule('#bulkDescActions');
        expect(rule).toMatch(/display:\s*none/);
    });

    it('#footCounts is hidden at the mobile breakpoint so the footer is just the version label', () => {
        // The mobile project header already renders open/done counts
        // under the project name; duplicating them in the footer is
        // the bug the screenshot showed.
        const rule = extractMobileRule('#footCounts');
        expect(rule).toMatch(/display:\s*none/);
    });

    it('#mobileProjStats still defines a 44px-tall stats row so dots remain visible', () => {
        // Sanity check that the stats container — the parent of the
        // open/done counts and the page-dot row — keeps its min-height,
        // since the page-dot regression in the screenshot was traced
        // partly to the container collapsing.
        const rule = extractMobileRule('#mobileProjStats');
        expect(rule).toMatch(/min-height:\s*44px/);
    });

    it('the mobile overrides come AFTER the desktop rules so source order wins', () => {
        // No `!important` is used; the fix relies on the mobile rules
        // sitting later in the file than the desktop rules so they win
        // the cascade at equal specificity (1 ID each).
        const desktopMainBar  = css.indexOf('#mainBar {');
        const desktopBulkDesc = css.indexOf('#bulkDescActions {');
        const desktopFootCounts = css.indexOf('#footCounts {');
        const mobileBlock = css.indexOf('@media (max-width: 1023px)');
        expect(desktopMainBar).toBeGreaterThan(-1);
        expect(desktopBulkDesc).toBeGreaterThan(-1);
        expect(desktopFootCounts).toBeGreaterThan(-1);
        expect(mobileBlock).toBeGreaterThan(desktopMainBar);
        expect(mobileBlock).toBeGreaterThan(desktopBulkDesc);
        expect(mobileBlock).toBeGreaterThan(desktopFootCounts);
    });
});
