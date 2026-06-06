import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: a long todo description on desktop expanded its row to the
// full content height and bled over the rows beneath it. The fix caps
// the inline description editor with a max-height plus overflow-y so the
// notes scroll internally instead of pushing into neighbouring rows.

describe('desktop descInput — max-height cap with internal scroll', () => {

    const css = read('style.css');

    it('the desktop @media block caps #descInput with a max-height around 180–220px', () => {
        // Match every `@media (min-width: 1024px) { ... }` block and look
        // for the one that scopes a #descInput rule with max-height.
        const blockRe = /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{([\s\S]*?)\n\}/g;
        let match;
        let capped = false;
        let capPx = null;
        while ((match = blockRe.exec(css)) !== null) {
            const body = match[1];
            const descRuleMatch = body.match(/#descInput\s*\{([^}]*)\}/);
            if (!descRuleMatch) continue;
            const rule = descRuleMatch[1];
            const maxHeightMatch = rule.match(/max-height:\s*(\d+)px/);
            if (maxHeightMatch) {
                capped = true;
                capPx = parseInt(maxHeightMatch[1], 10);
                break;
            }
        }
        expect(capped).toBe(true);
        expect(capPx).toBeGreaterThanOrEqual(180);
        expect(capPx).toBeLessThanOrEqual(220);
    });

    it('the desktop #descInput rule sets overflow-y: auto so capped content scrolls', () => {
        const blockRe = /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{([\s\S]*?)\n\}/g;
        let match;
        let scrolls = false;
        while ((match = blockRe.exec(css)) !== null) {
            const body = match[1];
            const descRuleMatch = body.match(/#descInput\s*\{([^}]*)\}/);
            if (!descRuleMatch) continue;
            if (/overflow-y:\s*auto/.test(descRuleMatch[1])) {
                scrolls = true;
                break;
            }
        }
        expect(scrolls).toBe(true);
    });

    it('the cap does not appear inside a mobile media block', () => {
        // Sanity: the spec scopes this to desktop only — the mobile
        // (max-width: 1023px) and ≤420px phone blocks must NOT contain a
        // #descInput max-height rule, otherwise the mobile read-mode panel
        // would inherit the cap and start hiding content too.
        const mobileBlockRe = /@media\s*\(\s*max-width:\s*(?:1023|420|480)px\s*\)\s*\{([\s\S]*?)\n\}/g;
        let match;
        while ((match = mobileBlockRe.exec(css)) !== null) {
            const body = match[1];
            const descRuleMatch = body.match(/#descInput\s*\{([^}]*)\}/);
            if (!descRuleMatch) continue;
            expect(descRuleMatch[1]).not.toMatch(/max-height:/);
        }
    });
});
