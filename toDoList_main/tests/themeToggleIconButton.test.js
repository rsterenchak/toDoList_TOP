import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the theme toggle's contract after replacing the pill switch with a
// 36×36 sun/moon icon button. The visible icon represents the *target*
// mode — moon when light is active (tap to go dark), sun when dark is
// active (tap to go light). Both glyphs ship inline so no icon library is
// required, and the swap is animated via CSS opacity + rotate so the
// transition matches the rest of the app's ~150ms easing.
describe('theme toggle — sun/moon icon button', () => {
    const main = read('main.js');
    const css = read('style.css');

    it('renders both moon and sun glyphs as inline SVG inside #themeToggle', () => {
        expect(main).toMatch(/themeIconMoon/);
        expect(main).toMatch(/themeIconSun/);
        expect(main).toMatch(/themeToggle\.innerHTML\s*=\s*MOON_SVG\s*\+\s*SUN_SVG/);
    });

    it('toggles aria-pressed instead of aria-checked so the button is not a switch', () => {
        const themeBlock = main.slice(main.indexOf("themeToggle.id   = 'themeToggle'"));
        expect(themeBlock).toMatch(/aria-pressed/);
        expect(themeBlock.slice(0, 2000)).not.toMatch(/setAttribute\(\s*'role'\s*,\s*'switch'\s*\)/);
    });

    it('appends the theme toggle after the companion toggle so it sits to the ghost\'s right', () => {
        const companionIdx = main.indexOf('nav.appendChild(companionToggle);');
        const themeIdx = main.indexOf('nav.appendChild(themeToggle);');
        expect(companionIdx).toBeGreaterThan(-1);
        expect(themeIdx).toBeGreaterThan(-1);
        expect(themeIdx).toBeGreaterThan(companionIdx);
    });

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

    it('styles #themeToggle as a 36×36 transparent-fill icon button with a border', () => {
        const rule = extractTopLevelRule('#themeToggle');
        expect(rule).toMatch(/width:\s*36px\s*;/);
        expect(rule).toMatch(/height:\s*36px\s*;/);
        expect(rule).toMatch(/background:\s*transparent\s*;/);
        expect(rule).toMatch(/border:\s*0?\.?5?p?x? ?[a-z]*\s*var\(--border-bright\)/);
    });

    it('cross-fades the two glyphs via opacity and rotate at ~150ms', () => {
        const iconRule = extractTopLevelRule('.themeIcon');
        expect(iconRule).toMatch(/opacity:\s*0\s*;/);
        expect(iconRule).toMatch(/transition:[^;]*opacity\s+0\.15s/);
        expect(iconRule).toMatch(/transition:[^;]*transform\s+0\.15s/);
    });
});
