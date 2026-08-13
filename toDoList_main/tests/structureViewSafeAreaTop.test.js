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

// #structureView is its own scroll container and, unlike the projects view, it
// hides #mobileProjHeader — so nothing above it reserves the iOS status bar /
// Dynamic Island inset. Without a mobile top-inset override the base flat
// `padding: 24px 24px 96px` left the REPOSITORY eyebrow painted under the
// device chrome in standalone PWA mode. The mobile rule floors the inset at
// 24px so a regular browser tab (which reports a 0 inset) still gets breathing
// room, and adds the view's existing 24px content offset on top.
describe('Structure view mobile safe-area top inset', () => {
    const css = read('style.css');

    function mobileBlock() {
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
        return stripCssComments(css.slice(media, mediaEnd));
    }

    it('the ≤1023px block floors the safe-area inset at 24px in #structureView padding-top', () => {
        const match = mobileBlock().match(/#structureView\s*\{([^}]*)\}/);
        expect(match, 'expected a mobile #structureView rule').not.toBeNull();
        expect(match[1]).toMatch(
            /padding-top:\s*calc\(\s*max\(\s*env\(safe-area-inset-top\s*,\s*0px\s*\)\s*,\s*24px\s*\)\s*\+\s*24px\s*\)/
        );
    });

    it('the mobile override wins over the base rule by coming later in the stylesheet', () => {
        const cleaned = stripCssComments(css);
        const base = cleaned.search(/#structureView\s*\{\s*grid-row/);
        const media = cleaned.indexOf('@media (max-width: 1023px)');
        expect(base).toBeGreaterThan(-1);
        expect(media).toBeGreaterThan(base);
    });

    it('leaves the base #structureView padding untouched for desktop', () => {
        const cleaned = stripCssComments(css);
        const match = cleaned.match(/#structureView\s*\{\s*grid-row[^}]*\}/);
        expect(match).not.toBeNull();
        expect(match[0]).toMatch(/padding:\s*24px\s+24px\s+96px/);
    });

    it('leaves the ≥1024px two-column grid padding untouched', () => {
        const cleaned = stripCssComments(css);
        const match = cleaned.match(
            /#mainBar\[data-view="structure"\]\s*#structureView\s*\{([^}]*display:\s*grid[^}]*)\}/
        );
        expect(match, 'expected the desktop grid rule').not.toBeNull();
        expect(match[1]).toMatch(/padding:\s*16px\s+20px\s+20px/);
    });
});
