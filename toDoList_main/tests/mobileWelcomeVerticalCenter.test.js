import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins vertical centering of the NO PROJECTS welcome block on mobile. The
// base `#emptyState` rule already sets `justify-content: center` and the
// `.emptyStatePresent` override stretches the block via `flex: 1 1 auto`,
// but without a min-height floor the block can collapse to its natural
// content height on iOS Safari — leaving the mascot, "Welcome." label,
// and "+ New project" pill pinned to the upper third of the viewport
// with a large gap below. The mobile rule pins min-height: 100% so the
// flex container has a definite area for `justify-content: center` to
// resolve against.
describe('Mobile welcome empty-state vertical centering', () => {
    const css = read('style.css');

    function extractMobileRule(selector) {
        const media = css.indexOf('@media (max-width: 1023px)');
        expect(media).toBeGreaterThan(-1);
        let depth = 0;
        let mediaEnd = css.length;
        for (let i = css.indexOf('{', media); i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') {
                depth--;
                if (depth === 0) { mediaEnd = i; break; }
            }
        }
        const haystack = css.slice(media, mediaEnd);
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const ruleRe = new RegExp(
            selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
        );
        const match = stripped.match(ruleRe);
        expect(match, 'expected a mobile rule for ' + selector).not.toBeNull();
        return match[1];
    }

    it('#mainList.emptyStatePresent #emptyState.emptyStateNoProjects pins min-height: 100% on mobile so the welcome block fills the available area', () => {
        const rule = extractMobileRule(
            '#mainList.emptyStatePresent #emptyState.emptyStateNoProjects'
        );
        expect(rule).toMatch(/min-height:\s*100%/);
    });

    it('the base #emptyState rule sets justify-content: center (the centering primitive the mobile min-height resolves against)', () => {
        // Inspect the base rule (outside any @media block) so the test
        // catches an accidental removal of the underlying centering.
        const noMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
        const ruleRe  = /#emptyState\s*\{([^}]*)\}/;
        const match   = noMedia.match(ruleRe);
        expect(match, 'expected a base rule for #emptyState').not.toBeNull();
        expect(match[1]).toMatch(/justify-content:\s*center/);
    });

    it('#mainList.emptyStatePresent #emptyState still stretches via flex: 1 1 auto (works alongside the mobile min-height floor)', () => {
        const noMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
        const ruleRe  = /#mainList\.emptyStatePresent\s+#emptyState\s*\{([^}]*)\}/;
        const match   = noMedia.match(ruleRe);
        expect(match, 'expected a base rule for #mainList.emptyStatePresent #emptyState').not.toBeNull();
        expect(match[1]).toMatch(/flex:\s*1\s+1\s+auto/);
    });

    it('does NOT apply the min-height: 100% floor on desktop — the base centering chain already works without it', () => {
        // Strip the mobile @media block; the no-projects rule should not
        // surface min-height: 100% outside the mobile breakpoint, so
        // desktop continues to rely on flex-grow alone.
        const mediaStart = css.indexOf('@media (max-width: 1023px)');
        expect(mediaStart).toBeGreaterThan(-1);
        let depth = 0;
        let mediaEnd = css.length;
        for (let i = css.indexOf('{', mediaStart); i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') {
                depth--;
                if (depth === 0) { mediaEnd = i; break; }
            }
        }
        const desktop = css.slice(0, mediaStart) + css.slice(mediaEnd + 1);
        // Look for the exact selector + min-height pairing outside mobile.
        const escaped = '#mainList.emptyStatePresent #emptyState.emptyStateNoProjects'
            .replace(/[#.]/g, m => '\\' + m);
        const ruleRe = new RegExp(escaped + '\\s*\\{([^}]*)\\}');
        const match = desktop.match(ruleRe);
        if (match) {
            expect(match[1]).not.toMatch(/min-height:\s*100%/);
        }
        // If the selector doesn't appear outside mobile at all, that's
        // also fine — the mobile-scoped rule is the only one we ship.
    });
});
