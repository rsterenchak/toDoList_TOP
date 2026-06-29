import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The task sort was unreachable on mobile: the Sort dropdown (#taskSortBtn)
// lives only inside #bulkDescActions, the desktop overlay that is display:none
// at the mobile breakpoint. A compact Sort trigger (#taskSortBtnMobile) rides at
// the right end of the status-filter row (#taskFilterBar), separated from the
// filter tabs by a vertical divider, shown ONLY where #bulkDescActions is
// hidden. On mobile it opens a bottom SHEET (#taskSortSheet) of sort chips
// rather than the desktop dropdown, but drives the same getTaskSort/setTaskSort/
// applyTaskSortChoice/syncTaskSortButton machinery so desktop and mobile share
// one sort state. The trigger is two-line: "⇅ Sort" over the current-sort label
// (green when active, dimmed "None" otherwise). These tests pin that wiring
// (source-pattern) and the CSS that keeps exactly one Sort trigger visible per
// breakpoint.
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

    it('appends the divider and the mobile Sort trigger to the status-filter row', () => {
        // The trigger rides in #taskFilterBar so it sits opposite the filter
        // tabs; a vertical divider precedes it. The desktop overlay
        // #bulkDescActions is left untouched.
        expect(main).toMatch(/taskFilterBarDivider/);
        expect(main).toMatch(/taskFilterBar\.appendChild\(mobileSortDivider\)/);
        expect(main).toMatch(/taskFilterBar\.appendChild\(mobileSortBtn\)/);
    });

    it('drives the shared sort machinery rather than a parallel implementation', () => {
        // syncTaskSortButton updates the desktop text label and BOTH triggers'
        // data-sort; the mobile trigger carries an aria-label (kept current here)
        // plus a painted current-sort label.
        expect(main).toMatch(/taskSortBtnLabel\.textContent\s*=/);
        expect(main).toMatch(/mobileSortBtn\.setAttribute\(\s*['"]data-sort['"]/);
        expect(main).toMatch(/mobileSortBtn\.setAttribute\(\s*['"]aria-label['"]/);
        // The mobile trigger persists the choice through the global pref setter
        // (via applyTaskSortChoice → setTaskSort).
        expect(main).toMatch(/setTaskSort\(/);
    });

    it('opens a bottom sheet on mobile, not the desktop dropdown', () => {
        // The mobile trigger is wired to toggleTaskSortSheet; the desktop button
        // keeps the dropdown menu.
        expect(main).toMatch(/mobileSortBtn\.addEventListener\(\s*['"]click['"]\s*,\s*toggleTaskSortSheet\)/);
        expect(main).toMatch(/taskSortBtn\.addEventListener\(\s*['"]click['"]\s*,\s*toggleTaskSortMenu\)/);
    });

    it('builds the sort bottom sheet with three chips from the shared options', () => {
        expect(main).toMatch(/id\s*=\s*['"]taskSortSheet['"]/);
        expect(main).toMatch(/taskSortSheetChip/);
        // Chips are generated from the same TASK_SORT_OPTIONS the dropdown uses.
        expect(main).toMatch(/TASK_SORT_OPTIONS\.forEach/);
    });

    it('closes the sheet three ways — close button, backdrop tap, Escape', () => {
        expect(main).toMatch(/closeX\.addEventListener\(\s*['"]click['"]\s*,\s*hideTaskSortSheet\)/);
        expect(main).toMatch(/if \(event\.target === backdrop\) hideTaskSortSheet\(\)/);
        expect(main).toMatch(/event\.key === ['"]Escape['"]/);
    });

    it('renders the trigger two-line: a sort glyph + "Sort" over the current-sort label', () => {
        expect(main).toMatch(/taskSortBtnMobileGlyph/);
        expect(main).toMatch(/taskSortBtnMobileWord/);
        expect(main).toMatch(/taskSortBtnMobileLabel/);
        // The active-sort dot is retired in favour of the painted label.
        expect(main).not.toMatch(/taskSortBtnMobileDot/);
    });
});

describe('mobile Sort trigger — CSS visibility', () => {
    const css = read('style.css');

    it('is hidden by default and stacks its two lines (desktop owns the overlay Sort button)', () => {
        const ruleRe = /#taskSortBtnMobile\s*\{([^}]*)\}/;
        const match = css.match(ruleRe);
        expect(match).not.toBeNull();
        expect(match[1]).toMatch(/display:\s*none/);
        expect(match[1]).toMatch(/flex-direction:\s*column/);
    });

    it('separates the trigger from the filter tabs with a right-pushed divider', () => {
        const ruleRe = /\.taskFilterBarDivider\s*\{([^}]*)\}/;
        const match = css.match(ruleRe);
        expect(match).not.toBeNull();
        // Hidden on desktop, pushed to the right end of the row on mobile.
        expect(match[1]).toMatch(/display:\s*none/);
        expect(match[1]).toMatch(/margin-left:\s*auto/);
    });

    it('reveals the trigger and the divider at the mobile breakpoint where #bulkDescActions is hidden', () => {
        const triggerRule = extractMobileRule(css, '#taskSortBtnMobile');
        expect(triggerRule).toMatch(/display:\s*inline-flex/);
        const dividerRule = extractMobileRule(css, '.taskFilterBarDivider');
        expect(dividerRule).toMatch(/display:\s*block/);
        // The desktop overlay stays hidden at this breakpoint — exactly one
        // Sort trigger is ever visible.
        const overlayRule = extractMobileRule(css, '#bulkDescActions');
        expect(overlayRule).toMatch(/display:\s*none/);
    });

    it('greens the current-sort label when a sort other than None is active', () => {
        expect(css).toMatch(/#taskSortBtnMobile\[data-sort="due"\]\s+\.taskSortBtnMobileLabel/);
        expect(css).toMatch(/#taskSortBtnMobile\[data-sort="status"\]\s+\.taskSortBtnMobileLabel/);
    });
});

describe('mobile Sort bottom sheet — CSS', () => {
    const css = read('style.css');

    it('defines the slide-up sheet shell', () => {
        expect(css).toMatch(/#taskSortSheetBackdrop\s*\{/);
        expect(css).toMatch(/#taskSortSheet\s*\{/);
    });

    it('purple-fills the active sort chip', () => {
        const ruleRe = /\.taskSortSheetChip\.selected\s*\{([^}]*)\}/;
        const match = css.match(ruleRe);
        expect(match).not.toBeNull();
        expect(match[1].toLowerCase()).toMatch(/#6c5df5/);
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
        // The mobile trigger's glyph (.taskSortBtnMobileGlyph) carries its own
        // non-zero font-size at base scope, so the parent button's font-size:0
        // collapse never hides it.
        const ruleRe = /\.taskSortBtnMobileGlyph\s*\{([^}]*)\}/;
        const match = css.match(ruleRe);
        expect(match).not.toBeNull();
        const fontMatch = match[1].match(/font-size:\s*([^;]+);/);
        expect(fontMatch).not.toBeNull();
        expect(fontMatch[1].trim()).not.toBe('0');
        expect(parseFloat(fontMatch[1])).toBeGreaterThan(0);
    });
});
