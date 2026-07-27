import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the chromeless desktop project block: at desktop widths (>=1024px) the
// project block (#mobileProjHeader) is bare text on the header background — the
// header's title — not a raised pill competing with the STREAM / STRUCTURE
// pills beside it. It keeps its button behavior: it still opens the dropdown,
// still shows a hover affordance (a name/chevron colour shift, not a background
// fill), and keeps a clearly visible keyboard focus outline. The mobile rule
// (same id) keeps its own chrome and must be untouched. Verified via source
// inspection because main.js is too large to instantiate in jsdom (per
// CLAUDE.md guidance) and jsdom does not compute layout.
describe('desktop project block — chromeless', () => {
    const css = read('style.css');

    // Slice the dedicated D1c desktop block so assertions can't accidentally
    // read the mobile compressed-header rules (which share selector names).
    function desktopPillBlock() {
        const start = css.indexOf('D1c — DESKTOP PROJECT PILL');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('PHONE ≤ 420px', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    // The desktop block carries two #mobileProjHeader rules — a one-line grid
    // placement and the full styling rule. Grab the styling one (the rule body
    // that declares display:inline-flex) explicitly.
    function headerStyleRule() {
        const block = desktopPillBlock();
        const m = block.match(/#mobileProjHeader\s*\{([^}]*display:\s*inline-flex[^}]*)\}/);
        expect(m).not.toBeNull();
        return m[1];
    }

    it('(a) the desktop project block has no background, border, or radius', () => {
        const header = headerStyleRule();
        expect(header).not.toMatch(/background:/);
        expect(header).not.toMatch(/\bborder:/);
        expect(header).not.toMatch(/border-radius:/);
    });

    it('(b) it keeps its padding and remains a pointer button', () => {
        const header = headerStyleRule();
        expect(header).toMatch(/padding:\s*4px 10px 4px 12px/);
        expect(header).toMatch(/cursor:\s*pointer/);
    });

    it('(c) hover shifts the name/chevron colour rather than painting a fill', () => {
        const block = desktopPillBlock();
        // No background/border hover on the header itself.
        expect(block).not.toMatch(/#mobileProjHeader:hover\s*\{[^}]*background/);
        expect(block).not.toMatch(/#mobileProjHeader:hover\s*\{[^}]*border/);
        // Hover affordance lives on the name and chevron instead.
        expect(block).toMatch(/#mobileProjHeader:hover\s+#mobileProjName\s*\{[^}]*color:/);
        expect(block).toMatch(/#mobileProjHeader:hover\s+\.mobileProjDropdownChev\s*\{[^}]*color:/);
    });

    it('(d) keyboard focus keeps a visible outline now that the border is gone', () => {
        const block = desktopPillBlock();
        const m = block.match(/#mobileProjHeader:focus-visible\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        expect(m[1]).toMatch(/outline:\s*[^;]*solid/);
    });

    it('(e) the mobile #mobileProjHeader rule keeps its own treatment untouched', () => {
        // The mobile rule lives before the D1c desktop block; it is not part of
        // the chromeless change and must not be swept up by it.
        const mobileStart = css.indexOf('PHONE ≤ 420px');
        // The mobile compressed-header rule at ~12056 sits above the D1c block.
        const d1cStart = css.indexOf('D1c — DESKTOP PROJECT PILL');
        const beforeDesktop = css.slice(0, d1cStart);
        expect(beforeDesktop).toMatch(/#mobileProjHeader\s*\{/);
        expect(mobileStart).toBeGreaterThan(d1cStart);
    });
});
