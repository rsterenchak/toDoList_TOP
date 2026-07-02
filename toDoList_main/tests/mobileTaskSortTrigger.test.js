import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The task sort was unreachable on mobile: the Sort dropdown (#taskSortBtn)
// lives only inside #bulkDescActions, the desktop overlay that is display:none
// at the mobile breakpoint. A compact Sort trigger (#taskSortBtnMobile) rides at
// the FAR RIGHT of the status-filter row (#taskFilterBar) as its own chip
// (mirroring the Claude chat launcher), shown ONLY where #bulkDescActions is
// hidden. On mobile it opens a bottom SHEET (#taskSortSheet) of sort chips
// rather than the desktop dropdown, but drives the same getTaskSort/setTaskSort/
// applyTaskSortChoice/syncTaskSortButton machinery so desktop and mobile share
// one sort state. The trigger is icon-only: a single ⇅ glyph that tints accent
// purple when a sort other than None is active, mounted directly on the
// filter bar (not fused into the segmented control, which is retired on mobile
// in favour of the cycle pill). These tests pin that wiring (source-pattern) and
// the CSS that keeps exactly one Sort trigger visible per breakpoint.
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

    it('mounts the mobile Sort trigger directly on the filter bar, not inside the segmented control', () => {
        // The trigger is re-hosted onto the bar itself so hiding the segmented
        // control on mobile doesn't also hide Sort. The retired fused divider is
        // no longer appended. The desktop overlay #bulkDescActions is untouched.
        expect(main).toMatch(/mobileSortHost\s*=\s*taskFilterBar/);
        expect(main).toMatch(/mobileSortHost\.appendChild\(mobileSortBtn\)/);
        expect(main).not.toMatch(/mobileSortHost\.appendChild\(mobileSortDivider\)/);
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

    it('renders the trigger icon-only: a ⇅ sort glyph, active state tinting the glyph (no corner dot)', () => {
        expect(main).toMatch(/taskSortBtnMobileGlyph/);
        // The corner dot read as a notification badge and was retired — the
        // glyph itself tints when a sort other than None is active.
        expect(main).not.toMatch(/taskSortBtnMobileDot/);
        // The two-line "Sort" word + current-sort label were retired in favour
        // of the icon-only glyph.
        expect(main).not.toMatch(/taskSortBtnMobileWord/);
        expect(main).not.toMatch(/taskSortBtnMobileLabel/);
    });
});

describe('mobile Sort trigger — CSS visibility', () => {
    const css = read('style.css');

    it('is hidden by default and reads as a bordered 36×36 chip (desktop owns the overlay Sort button)', () => {
        const ruleRe = /#taskSortBtnMobile\s*\{([^}]*)\}/;
        const match = css.match(ruleRe);
        expect(match).not.toBeNull();
        expect(match[1]).toMatch(/display:\s*none/);
        // Its own chip mirroring #claudeLauncher: a fixed 36×36 square with a
        // hairline border and 10px radius, position:relative to anchor the
        // active-sort dot. No two-line column, and no longer borderless.
        expect(match[1]).toMatch(/width:\s*36px/);
        expect(match[1]).toMatch(/height:\s*36px/);
        expect(match[1]).toMatch(/border-radius:\s*10px/);
        expect(match[1]).toMatch(/border:\s*0\.5px\s+solid/);
        expect(match[1]).toMatch(/position:\s*relative/);
        expect(match[1]).not.toMatch(/border:\s*none/);
        expect(match[1]).not.toMatch(/flex-direction:\s*column/);
    });

    it('keeps the retired fused divider hidden at base scope', () => {
        const ruleRe = /\.taskFilterBarDivider\s*\{([^}]*)\}/;
        const match = css.match(ruleRe);
        expect(match).not.toBeNull();
        // The divider is retired in the un-fused layout — it must stay hidden.
        expect(match[1]).toMatch(/display:\s*none/);
    });

    it('reveals the trigger, hides the divider, and pushes Sort to the far right at the mobile breakpoint', () => {
        const triggerRule = extractMobileRule(css, '#taskSortBtnMobile');
        expect(triggerRule).toMatch(/display:\s*inline-flex/);
        // The chip is pushed to the row's far edge in the un-fused layout.
        expect(triggerRule).toMatch(/margin-left:\s*auto/);
        // The retired divider stays hidden at the mobile breakpoint too.
        const dividerRule = extractMobileRule(css, '.taskFilterBarDivider');
        expect(dividerRule).toMatch(/display:\s*none/);
        // The desktop overlay stays hidden at this breakpoint — exactly one
        // Sort trigger is ever visible.
        const overlayRule = extractMobileRule(css, '#bulkDescActions');
        expect(overlayRule).toMatch(/display:\s*none/);
    });

    it('tints the ⇅ glyph accent purple when a sort other than None is active (no corner dot)', () => {
        // The retired corner dot is gone; the active cue is a tint on the glyph.
        expect(css).not.toMatch(/\.taskSortBtnMobileDot/);
        const dueRule = /#taskSortBtnMobile\[data-sort="due"\]\s+\.taskSortBtnMobileGlyph[\s\S]*?\{([^}]*)\}/;
        const match = css.match(dueRule);
        expect(match).not.toBeNull();
        expect(match[1].toLowerCase()).toMatch(/#9d93ee/);
        expect(css).toMatch(/#taskSortBtnMobile\[data-sort="status"\]\s+\.taskSortBtnMobileGlyph/);
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
