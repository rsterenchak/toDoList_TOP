import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The task sort was unreachable on mobile: the Sort dropdown (#taskSortBtn)
// lives only inside #bulkDescActions, the desktop overlay that is display:none
// at the mobile breakpoint. This adds a compact Sort trigger (#taskSortBtnMobile)
// at the right end of the status-filter row (#taskFilterBar), shown ONLY where
// #bulkDescActions is hidden, driving the same getTaskSort/setTaskSort/
// applyTaskSortChoice/syncTaskSortButton machinery so desktop and mobile share
// one sort state. These tests pin that wiring (source-pattern) and the CSS that
// keeps exactly one Sort trigger visible per breakpoint.
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function extractMobileRule(css, selector) {
    // Grab the declaration block for `selector` inside the first
    // `@media (max-width: 1023px)` block — same naive parse as the other
    // mobile-layout tests in this suite.
    const media = css.indexOf('@media (max-width: 1023px)');
    expect(media).toBeGreaterThan(-1);
    let mediaEnd = css.length;
    let depth = 0;
    for (let i = css.indexOf('{', media); i < css.length; i++) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') {
            depth--;
            if (depth === 0) { mediaEnd = i; break; }
        }
    }
    const haystack = css.slice(media, mediaEnd).replace(/\/\*[\s\S]*?\*\//g, '');
    const ruleRe = new RegExp(
        selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
    );
    const match = haystack.match(ruleRe);
    expect(match).not.toBeNull();
    return match[1];
}

describe('mobile Sort trigger — main.js wiring', () => {
    const main = read('main.js');

    it('builds the mobile Sort trigger #taskSortBtnMobile', () => {
        expect(main).toMatch(/id\s*=\s*['"]taskSortBtnMobile['"]/);
    });

    it('appends the mobile Sort trigger to the status-filter row, not #bulkDescActions', () => {
        // The trigger rides in #taskFilterBar so it sits opposite the status
        // pills; the desktop overlay #bulkDescActions is left untouched.
        expect(main).toMatch(/taskFilterBar\.appendChild\(mobileSortBtn\)/);
    });

    it('drives the shared sort machinery rather than a parallel implementation', () => {
        // syncTaskSortButton updates the desktop text label and BOTH triggers'
        // data-sort; the icon-only mobile trigger carries an aria-label (kept
        // current here) in lieu of a visible text label.
        expect(main).toMatch(/taskSortBtnLabel\.textContent\s*=/);
        expect(main).toMatch(/mobileSortBtn\.setAttribute\(\s*['"]data-sort['"]/);
        expect(main).toMatch(/mobileSortBtn\.setAttribute\(\s*['"]aria-label['"]/);
        // Both triggers open the same menu via one handler.
        expect(main).toMatch(/mobileSortBtn\.addEventListener\(\s*['"]click['"]\s*,\s*toggleTaskSortMenu\)/);
        // The menu still persists the choice through the global pref setter.
        expect(main).toMatch(/setTaskSort\(/);
    });

    it('renders the mobile trigger icon-only with a sort glyph and an active-sort dot', () => {
        // No text label element on the mobile trigger any more — it carries a
        // glyph span plus a dot span instead.
        expect(main).toMatch(/taskSortBtnMobileGlyph/);
        expect(main).toMatch(/taskSortBtnMobileDot/);
        expect(main).not.toMatch(/mobileSortBtnLabel/);
    });

    it('exempts the mobile trigger from the outside-click dismissal', () => {
        expect(main).toMatch(/mobileSortBtn\.contains\(event\.target\)/);
    });
});

describe('mobile Sort trigger — CSS visibility', () => {
    const css = read('style.css');

    it('is hidden by default (desktop owns the overlay Sort button)', () => {
        const ruleRe = /#taskSortBtnMobile\s*\{([^}]*)\}/;
        const match = css.match(ruleRe);
        expect(match).not.toBeNull();
        expect(match[1]).toMatch(/display:\s*none/);
        // Pushed to the right end of the filter row, opposite the status pills.
        expect(match[1]).toMatch(/margin-left:\s*auto/);
    });

    it('is shown at the mobile breakpoint where #bulkDescActions is hidden', () => {
        const mobileRule = extractMobileRule(css, '#taskSortBtnMobile');
        expect(mobileRule).toMatch(/display:\s*inline-flex/);
        // The desktop overlay stays hidden at this breakpoint — exactly one
        // Sort trigger is ever visible.
        const overlayRule = extractMobileRule(css, '#bulkDescActions');
        expect(overlayRule).toMatch(/display:\s*none/);
    });

    it('accent-tints the mobile trigger when a sort other than None is active', () => {
        expect(css).toMatch(/#taskSortBtnMobile\[data-sort="due"\]/);
        expect(css).toMatch(/#taskSortBtnMobile\[data-sort="status"\]/);
    });
});

describe('mobile Sort trigger — icon glyph survives the ≤420px collapse', () => {
    const css = read('style.css');

    function extractNarrowRule(selector) {
        // Grab the declaration block for `selector` inside the
        // `@media (max-width: 420px)` block — same naive parse as the
        // mobile-layout tests above, retargeted at the narrow-phone breakpoint.
        const media = css.indexOf('@media (max-width: 420px)');
        expect(media).toBeGreaterThan(-1);
        let mediaEnd = css.length;
        let depth = 0;
        for (let i = css.indexOf('{', media); i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') {
                depth--;
                if (depth === 0) { mediaEnd = i; break; }
            }
        }
        const haystack = css.slice(media, mediaEnd).replace(/\/\*[\s\S]*?\*\//g, '');
        const ruleRe = new RegExp(
            selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
        );
        const match = haystack.match(ruleRe);
        return match ? match[1] : null;
    }

    it('still collapses generic .bulkDescBtn labels to chevron-only here', () => {
        // The narrow-phone chevron-only collapse the glyph must survive. Pinned
        // so the override below stays meaningful — if the collapse rule ever
        // goes away, the glyph's own font-size is moot.
        const rule = extractNarrowRule('.bulkDescBtn');
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/font-size:\s*0/);
    });

    it('keeps the sort glyph visible despite the .bulkDescBtn font-size:0 collapse', () => {
        // The icon-only mobile trigger has no text label; its glyph
        // (.taskSortBtnMobileGlyph) carries its own non-zero font-size at base
        // scope, so the parent button's font-size:0 collapse never hides it.
        const ruleRe = /\.taskSortBtnMobileGlyph\s*\{([^}]*)\}/;
        const match = css.match(ruleRe);
        expect(match).not.toBeNull();
        const fontMatch = match[1].match(/font-size:\s*([^;]+);/);
        expect(fontMatch).not.toBeNull();
        expect(fontMatch[1].trim()).not.toBe('0');
        expect(parseFloat(fontMatch[1])).toBeGreaterThan(0);
    });
});
