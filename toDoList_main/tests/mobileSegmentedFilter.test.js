import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The mobile filter rework adds a three-segment status filter (All · Active ·
// Ideas) alongside the existing desktop cycle pill, gated by CSS so exactly one
// is visible per breakpoint — mirroring the dual Sort-trigger pattern. These
// tests pin that CSS gating (so the swap can't silently regress to showing both
// or neither) and the shared-visual-language tint on the active segment.
const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const css = readFileSync(resolve(srcDir, 'style.css'), 'utf8');

function baseRule(selector) {
    const ruleRe = new RegExp(
        selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
    );
    const match = css.match(ruleRe);
    return match ? match[1] : null;
}

function extractMobileRule(selector) {
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
    return match ? match[1] : null;
}

describe('mobile segmented filter — breakpoint gating', () => {
    it('hides the segmented control on desktop by default', () => {
        const rule = baseRule('.taskFilterSegmented');
        expect(rule).not.toBeNull();
        expect(rule).toMatch(/display:\s*none/);
    });

    it('reveals the segmented control and hides the cycle pill at the mobile breakpoint', () => {
        const seg = extractMobileRule('.taskFilterSegmented');
        expect(seg).not.toBeNull();
        expect(seg).toMatch(/display:\s*flex/);

        const pill = extractMobileRule('.taskCyclePill');
        expect(pill).not.toBeNull();
        expect(pill).toMatch(/display:\s*none/);
    });

    it('tints the active segment with the accent tint + accent text, not a solid purple block', () => {
        const sel = baseRule('.taskFilterSeg.selected');
        expect(sel).not.toBeNull();
        // The active segment was softened from its solid #6C5DF5 fill to the
        // accent tint + accent-purple text, matching #descEditorModalStatusControl
        // so filtering and status-setting share one segmented-control language.
        expect(sel.toLowerCase()).toMatch(/background:\s*var\(--accent-dim\)/);
        expect(sel.toLowerCase()).toMatch(/color:\s*var\(--accent-text\)/);
        expect(sel.toLowerCase()).not.toMatch(/#6c5df5/);
    });
});

describe('mobile Sort trigger — active-sort accent dot', () => {
    it('shows an accent dot on the icon-only trigger when a sort other than None is active', () => {
        // The two-line current-sort label was retired in favour of an icon-only
        // ⇅ glyph carrying a small accent dot — hidden by default, revealed when
        // the button's data-sort is an active sort.
        const dot = baseRule('.taskSortBtnMobileDot');
        expect(dot).not.toBeNull();
        expect(dot).toMatch(/display:\s*none/);
        expect(dot.toLowerCase()).toMatch(/background:\s*var\(--accent-text\)/);
        expect(css).toMatch(/#taskSortBtnMobile\[data-sort="due"\]\s+\.taskSortBtnMobileDot/);
        expect(css).toMatch(/#taskSortBtnMobile\[data-sort="status"\]\s+\.taskSortBtnMobileDot/);
    });
});
