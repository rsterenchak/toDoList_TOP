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

// On notched iOS devices the Inbox view's content collided with the
// status bar / Dynamic Island because its mobile top padding was a flat
// 16-24px rather than reserving env(safe-area-inset-top). The view now
// follows the same `calc(max(env(safe-area-inset-top, 0px), 24px) + Npx)`
// pattern already used by #emptyState.emptyStateNoProjects and
// #mobileProjHeader elsewhere in the mobile @media block.
describe('Inbox mobile top padding reserves safe-area-inset-top', () => {
    const css = read('style.css');
    const safeAreaPaddingTopRe =
        /calc\(\s*max\(\s*env\(\s*safe-area-inset-top\s*,\s*0px\s*\)\s*,\s*24px\s*\)\s*\+\s*24px\s*\)/;

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
});

// The shared mobile scroll-padding rule reserves room for the bottom tab
// bar so the last row stays reachable above it.
describe('shared mobile scroll-padding defers to the tab-bar reservation', () => {
    const css = read('style.css');

    it('the shared #mainList, #inboxView rule sets padding-bottom to the tab-bar reservation (height + home-indicator inset)', () => {
        const cleaned = stripCssComments(css);
        // Find the combined rule body for both selectors.
        const combinedRe =
            /#mainList\s*,\s*#inboxView\s*\{([^}]*)\}/;
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
