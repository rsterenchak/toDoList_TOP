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

// The mobile scroll-padding rule reserves room for the bottom tab
// bar so the last row stays reachable above it.
describe('mobile scroll-padding defers to the tab-bar reservation', () => {
    const css = read('style.css');

    it('the #mainList rule sets padding-bottom to the tab-bar reservation (height + home-indicator inset)', () => {
        const cleaned = stripCssComments(css);
        // Several #mainList { } rules exist (desktop + mobile blocks); scan
        // them all and assert one carries the tab-bar padding-bottom.
        const re = /#mainList\s*\{([^}]*)\}/g;
        const paddingBottomRe =
            /padding-bottom\s*:\s*calc\(\s*var\(\s*--mobile-tab-h\s*,\s*56px\s*\)\s*\+\s*var\(--mobile-bottom-inset[^)]*\)\s*\)/;
        let match;
        let found = false;
        // The tab bar now absorbs the home-indicator clearance into its
        // own height (the #footBar that used to reserve the safe-area
        // padding is hidden on mobile), so the scroll padding has to
        // cover both --mobile-tab-h AND that clearance to keep the last
        // row reachable above the bar. Both read it from the shared
        // --mobile-bottom-inset token rather than raw
        // env(safe-area-inset-bottom), so the padding can't drift from the
        // bar's real height in iOS standalone display-mode.
        while ((match = re.exec(cleaned)) !== null) {
            if (paddingBottomRe.test(match[1])) found = true;
        }
        expect(found).toBe(true);
    });
});
