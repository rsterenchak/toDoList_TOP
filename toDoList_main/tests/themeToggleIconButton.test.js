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
    const theme = read('theme.js');
    const css = read('style.css');
    // The desktop ghost-menu Theme item was extracted into settingsMenu.js;
    // the nav-level negative assertion (no standalone themeToggle) stays on main.
    const settingsMenu = read('settingsMenu.js');

    it('renders both moon and sun glyphs as inline SVG inside #themeToggle', () => {
        expect(theme).toMatch(/themeIconMoon/);
        expect(theme).toMatch(/themeIconSun/);
        expect(theme).toMatch(/themeToggle\.innerHTML\s*=\s*MOON_SVG\s*\+\s*SUN_SVG/);
    });

    it('toggles aria-pressed instead of aria-checked so the button is not a switch', () => {
        const themeBlock = theme.slice(theme.indexOf("themeToggle.id   = 'themeToggle'"));
        expect(themeBlock).toMatch(/aria-pressed/);
        expect(themeBlock.slice(0, 2000)).not.toMatch(/setAttribute\(\s*'role'\s*,\s*'switch'\s*\)/);
    });

    it('exposes the theme switch as a Theme item inside the settings dropdown', () => {
        // The standalone theme button has been replaced by an item inside the
        // new settings dropdown, which goes through the same switchTheme
        // (applyTheme + THEME_KEY persistence) flow theme.js's button uses.
        expect(settingsMenu).toMatch(/buildSettingsMenuItem\(\s*'Theme'/);
        expect(settingsMenu).toMatch(/switchTheme\s*\(/);
        // No longer appended directly to the nav as a standalone button.
        expect(main).not.toMatch(/nav\.appendChild\s*\(\s*themeToggle\s*\)/);
    });

    it('flips to light from a dark theme and back to the last dark theme from light', () => {
        const themeBlock = theme.slice(theme.indexOf("themeToggle.addEventListener('click'"));
        expect(themeBlock.slice(0, 400)).toMatch(/getCurrentTheme\(\)\s*===\s*'light'\s*\?\s*getLastDarkTheme\(\)\s*:\s*'light'/);
        expect(themeBlock.slice(0, 400)).toMatch(/switchTheme\s*\(\s*next\s*\)/);
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
