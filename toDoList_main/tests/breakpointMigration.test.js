import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the responsive breakpoint after the 700px → 1024px migration.
// The mobile/desktop split now happens at 1024px with `< 1024` semantics:
// a viewport narrower than 1024px is mobile, 1024px and wider is desktop.
// The `< 1024` (rather than `<= 1024`) choice keeps jsdom's default 1024px
// viewport in desktop mode, so the rest of the suite's desktop-mode setup
// stays valid. These tests lock the exact boundary and guard against drift
// back toward the old 700px constant.
describe('responsive breakpoint — 1024px migration', () => {

    const main = read('main.js');

    // Extract the isMobile() body expression and evaluate it against a
    // synthetic window so we test the real source, not a copy of it.
    const match = main.match(/function isMobile\(\)\s*\{\s*return\s+([^;]+);\s*\}/);

    function isMobileAt(width) {
        // eslint-disable-next-line no-new-func
        return Function('window', `return ${match[1]};`)({ innerWidth: width });
    }

    it('isMobile() reports mobile at 1023px and desktop at 1024px (exact boundary)', () => {
        expect(match).not.toBeNull();
        expect(isMobileAt(1023)).toBe(true);
        expect(isMobileAt(1024)).toBe(false);
    });

    it('isMobile() also reports mobile well below and desktop well above the boundary', () => {
        expect(isMobileAt(500)).toBe(true);
        expect(isMobileAt(1200)).toBe(false);
    });

    it('the isMobile() definition in main.js pins the literal 1024 threshold', () => {
        // Catches any future drift away from the migrated breakpoint value.
        expect(main).toMatch(/function isMobile\(\)\s*\{\s*return\s+window\.innerWidth\s*<\s*1024\s*;\s*\}/);
    });
});
