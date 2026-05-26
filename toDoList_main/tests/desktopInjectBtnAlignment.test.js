import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the alignment contract for the desktop inline "Inject to TODO.md"
// button. The button is appended to #descSibling, which is a three-column
// grid (14px / 1fr / 14px). Without an explicit placement, the button drops
// into the 14px gutter column of a new row, which squeezes it against the
// left edge and skews the icon downward. The CSS forces a full-row span and
// hardens the icon's own sizing so its inline-flex layout produces a
// vertically centered icon flush with the label.

describe('desktop inject button — icon/label alignment hardening', () => {

    const css = read('style.css');

    function extractTopLevelRule(selector) {
        let depth = 0;
        for (let i = 0; i < css.length; i++) {
            const c = css[i];
            if (c === '{') { depth++; continue; }
            if (c === '}') { depth--; continue; }
            if (depth !== 0) continue;
            if (css.startsWith(selector, i) && /[\s{]/.test(css[i + selector.length] || '')) {
                const blockStart = css.indexOf('{', i);
                const blockEnd = css.indexOf('}', blockStart);
                return css.slice(blockStart + 1, blockEnd);
            }
        }
        throw new Error(`Top-level rule for "${selector}" not found`);
    }

    it('.injectBtn lays out icon and label as a centered inline-flex row', () => {
        const rule = extractTopLevelRule('.injectBtn');
        expect(rule).toMatch(/display:\s*inline-flex\s*;/);
        expect(rule).toMatch(/align-items:\s*center\s*;/);
        expect(rule).toMatch(/gap:\s*6px\s*;/);
    });

    it('.injectBtnIcon pins the SVG to a 12x12 box that never shrinks or baselines', () => {
        const rule = extractTopLevelRule('.injectBtnIcon');
        expect(rule).toMatch(/width:\s*12px\s*;/);
        expect(rule).toMatch(/height:\s*12px\s*;/);
        expect(rule).toMatch(/flex:\s*0\s+0\s+auto\s*;/);
        expect(rule).toMatch(/vertical-align:\s*middle\s*;/);
        expect(rule).toMatch(/display:\s*block\s*;/);
    });

    it('#descSibling .injectBtn spans the full grid row so it isn\'t squeezed into the 14px gutter column', () => {
        const rule = extractTopLevelRule('#descSibling .injectBtn');
        expect(rule).toMatch(/grid-column:\s*1\s*\/\s*-1\s*;/);
    });
});
