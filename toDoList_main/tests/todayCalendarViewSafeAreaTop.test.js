import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function stripCssComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Walks every `@media (max-width: 1023px)` block in the stylesheet and returns
// every nested rule body matching `selector` (across all such blocks). The
// mobile padding-top formula and the later padding-bottom override on these
// views live in two distinct @media (max-width: 1023px) blocks, so we have to
// inspect them all rather than the first one.
function extractAllMobileRules(css, selector) {
    const cleaned = stripCssComments(css);
    const re = /@media\s*\(\s*max-width:\s*1023px\s*\)\s*\{/g;
    const results = [];
    let match;
    const selectorRe = new RegExp(
        '(?:^|[},\\s])' +
            selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            '\\s*\\{([^}]*)\\}'
    );
    while ((match = re.exec(cleaned)) !== null) {
        const bodyStart = match.index + match[0].length;
        let depth = 1;
        let i = bodyStart;
        for (; i < cleaned.length && depth > 0; i++) {
            if (cleaned[i] === '{') depth++;
            else if (cleaned[i] === '}') depth--;
        }
        const block = cleaned.slice(bodyStart, i - 1);
        // Multiple nested rules can target the selector inside one block.
        let local = block;
        let m;
        while ((m = local.match(selectorRe)) !== null) {
            results.push(m[1]);
            local = local.slice(m.index + m[0].length);
        }
    }
    return results;
}

// On notched iOS devices the Today view's date header ("Tuesday, May 19") and
// the Calendar view's prev-month chevron / "Month YYYY" label collided with
// the status bar / Dynamic Island because their mobile top padding was a flat
// 16-24px rather than reserving env(safe-area-inset-top). Both views now
// follow the same `calc(max(env(safe-area-inset-top, 0px), 24px) + Npx)`
// pattern already used by #emptyState.emptyStateNoProjects and #mobileProjHeader
// elsewhere in the mobile @media block. Today's content offset stays at +24px;
// Calendar's was bumped to +64px so the prev/next/month-label row clears the
// absolute-positioned #sidebarToggle on a dedicated row beneath it.
describe('Today + Calendar mobile top padding reserves safe-area-inset-top', () => {
    const css = read('style.css');
    const safeAreaPaddingTopRe =
        /calc\(\s*max\(\s*env\(\s*safe-area-inset-top\s*,\s*0px\s*\)\s*,\s*24px\s*\)\s*\+\s*24px\s*\)/;
    // Calendar's offset is intentionally larger than Today's so the
    // calendar header row sits beneath the hamburger button.
    const safeAreaCalendarPaddingTopRe =
        /calc\(\s*max\(\s*env\(\s*safe-area-inset-top\s*,\s*0px\s*\)\s*,\s*24px\s*\)\s*\+\s*(\d+)px\s*\)/;

    it('#inboxView reserves the safe-area inset (with a 24px floor) as padding-top inside @media (max-width: 1023px)', () => {
        const rules = extractAllMobileRules(css, '#inboxView');
        expect(rules.length).toBeGreaterThan(0);
        const hasPaddingTop = rules.some(rule =>
            new RegExp(
                'padding-top\\s*:\\s*' + safeAreaPaddingTopRe.source
            ).test(rule)
        );
        expect(hasPaddingTop).toBe(true);
    });

    it('#calendarView reserves the safe-area inset (with a 24px floor) as padding-top inside @media (max-width: 1023px), with enough offset to clear the hamburger', () => {
        const rules = extractAllMobileRules(css, '#calendarView');
        expect(rules.length).toBeGreaterThan(0);
        let matchedOffset = null;
        rules.forEach(rule => {
            // Accept either an explicit `padding-top:` declaration or a
            // padding shorthand whose first value is the safe-area calc().
            const explicit = rule.match(
                new RegExp(
                    'padding-top\\s*:\\s*' + safeAreaCalendarPaddingTopRe.source
                )
            );
            if (explicit) {
                matchedOffset = parseInt(explicit[1], 10);
                return;
            }
            const shorthand = rule.match(
                new RegExp(
                    'padding\\s*:\\s*' + safeAreaCalendarPaddingTopRe.source
                )
            );
            if (shorthand) {
                matchedOffset = parseInt(shorthand[1], 10);
            }
        });
        expect(matchedOffset).not.toBeNull();
        // 24px floor + 8px hamburger top offset + 44px hamburger height = 52px;
        // require at least 60px so the calendar header sits beneath the
        // hamburger on its own row instead of overlapping the next-month arrow.
        expect(matchedOffset).toBeGreaterThanOrEqual(60);
    });
});

// The bottom-padding fix on #calendarView: previously its mobile padding
// shorthand re-asserted 16px on the bottom even though a later rule set
// `padding-bottom: var(--mobile-tab-h, 56px)`. Collapsing the primary mobile
// shorthand to a 3-value form whose bottom is 0 leaves the later override as
// the sole source of bottom padding, so the day-detail panel sits flush
// against the tab bar instead of stranded above it.
describe('#calendarView mobile padding-bottom defers to the tab-bar reservation', () => {
    const css = read('style.css');

    it('the primary #calendarView mobile rule does not set a non-zero padding-bottom that would compete with the tab-bar reservation', () => {
        const rules = extractAllMobileRules(css, '#calendarView');
        expect(rules.length).toBeGreaterThan(0);

        // The "primary" mobile rule is the one carrying the padding-top safe-
        // area formula (or any explicit padding declaration). Find the rule
        // that sets `padding:` or `padding-top:`; assert that it either
        // (a) doesn't set padding-bottom at all (longhand only), or
        // (b) uses a padding shorthand whose bottom value is `0`.
        const primary = rules.find(rule =>
            /padding(?:-top)?\s*:/.test(rule)
        );
        expect(primary).toBeDefined();

        if (/padding-bottom\s*:/.test(primary)) {
            const bottomMatch = primary.match(/padding-bottom\s*:\s*([^;]+);/);
            expect(bottomMatch).not.toBeNull();
            const value = bottomMatch[1].trim();
            // Either explicitly 0 or the tab-bar reservation itself.
            const ok =
                /^0(?:px)?$/.test(value) ||
                /var\(--mobile-tab-h/.test(value);
            expect(ok).toBe(true);
        }

        const shorthandMatch = primary.match(/(?:^|;)\s*padding\s*:\s*([^;]+);/);
        if (shorthandMatch) {
            // Split on top-level whitespace (parenthesis-aware) so a calc()
            // first value is treated as one token.
            const value = shorthandMatch[1].trim();
            const parts = [];
            let current = '';
            let depth = 0;
            for (const ch of value) {
                if (ch === '(') depth++;
                else if (ch === ')') depth--;
                if (depth === 0 && /\s/.test(ch)) {
                    if (current.length) { parts.push(current); current = ''; }
                } else {
                    current += ch;
                }
            }
            if (current.length) parts.push(current);

            // Bottom is parts[2] in a 3-value shorthand and parts[2] in a
            // 4-value shorthand; a 2-value shorthand defaults bottom to
            // parts[0]. Reject any shorthand whose effective bottom is a
            // non-zero hard length (which would compete with the later
            // `padding-bottom: var(--mobile-tab-h)` rule).
            let bottom;
            if (parts.length === 1) bottom = parts[0];
            else if (parts.length === 2) bottom = parts[0];
            else bottom = parts[2];

            const isZero = /^0(?:px)?$/.test(bottom);
            const isTabBar = /var\(--mobile-tab-h/.test(bottom);
            expect(isZero || isTabBar).toBe(true);
        }
    });

    it('the shared #mainList,#inboxView,#calendarView rule sets padding-bottom to the tab-bar reservation (height + home-indicator inset)', () => {
        const cleaned = stripCssComments(css);
        // Find the combined rule body for all three selectors.
        const combinedRe =
            /#mainList\s*,\s*#inboxView\s*,\s*#calendarView\s*\{([^}]*)\}/;
        const match = cleaned.match(combinedRe);
        expect(match).not.toBeNull();
        // The tab bar now absorbs env(safe-area-inset-bottom) into its
        // own height (the #footBar that used to reserve the safe-area
        // padding is hidden on mobile), so the scroll padding has to
        // cover both --mobile-tab-h AND the inset to keep the last row
        // reachable above the bar.
        expect(match[1]).toMatch(
            /padding-bottom\s*:\s*calc\(\s*var\(\s*--mobile-tab-h\s*,\s*56px\s*\)\s*\+\s*env\(safe-area-inset-bottom[^)]*\)\s*\)/
        );
    });
});
