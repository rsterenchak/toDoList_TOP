import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the headless-chevron contract: the per-row `#descToggle` caret is dead
// chrome at EVERY width now — on desktop the copy-title button takes its slot,
// and on touch tapping the row itself opens the description (wireToDoRowClick).
// So the hide rule lives in DEFAULT scope (not the mobile @media block) with
// `!important`, and the chevron renders no `::after` glyph. The element stays
// in the DOM as the open mechanism, so the still-load-bearing
// `descToggle.click()` routing and the inline-style placeholder guard are
// pinned below. Source-inspection only, mirroring mobileCheckboxHidden.
describe('per-row #descToggle chevron is a headless, unpainted toggle', () => {
    const css = read('style.css');

    // Brace depth at a source index: 0 means the rule sits in default scope,
    // ≥1 means it is nested inside an @media (or other) block.
    function braceDepthAt(index) {
        let depth = 0;
        for (let i = 0; i < index; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
        }
        return depth;
    }

    function descToggleBlock() {
        const idx = css.indexOf('#descToggle {');
        expect(idx).toBeGreaterThan(-1);
        const open = css.indexOf('{', idx);
        const close = css.indexOf('}', open);
        return { idx, body: css.slice(open + 1, close) };
    }

    it('#descToggle is hidden in default scope (all widths, not just mobile)', () => {
        const { idx, body } = descToggleBlock();
        // The hide rule must be top-level, not gated behind the ≤1023px block —
        // the chevron is redundant on desktop and mobile alike.
        expect(braceDepthAt(idx)).toBe(0);
        expect(body).toMatch(/display:\s*none/);
    });

    it('the default hide rule uses !important to defeat the inline style.display = "flex" writes in toDoRow.js', () => {
        // toDoRow.js sets `descToggle.style.display = "flex"` on row creation
        // (when the row has a title) and on first-commit reveal. Inline styles
        // outrank stylesheet rules at any specificity, so the hide has to carry
        // `!important` — otherwise the chevron paints anyway on every committed
        // row.
        const { body } = descToggleBlock();
        expect(body).toMatch(/display:\s*none\s*!important/);
    });

    it('#descToggle renders no ::after ▾ caret (the chevron is headless)', () => {
        // The glyph and its open-state rotation are gone — the toggle is a
        // mechanism now, not painted UI, so it must carry no ::after content.
        expect(css).not.toMatch(/#descToggle::after\s*\{[^}]*content:\s*['"]▾['"]/);
    });

    it('row-click handler still routes through descToggle.click() so tapping a row opens the description on mobile', () => {
        // Hiding the chevron only works because the row itself is still
        // the touch target for opening the description. If wireToDoRowClick
        // ever stops dispatching descToggle.click() on first tap, mobile
        // users lose the only path into the description panel.
        const toDoRow = read('toDoRow.js');
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = toDoRow.slice(fnIdx, fnIdx + 4000);
        expect(fn).toMatch(/isMobile/);
        expect(fn).toMatch(/descToggle\.click\(\)/);
    });

    it('placeholder-detection guard in main.js still reads inline style.display so the !important rule does not break it', () => {
        // main.js skips blank placeholder rows during bulk descToggle
        // dispatch by reading `descToggle.style.display === 'none'` —
        // an inline-style check, not computed style. The default-scope
        // !important rule never sets inline style, so this guard keeps
        // working even though the CSS-hidden chevron is display:none
        // (its inline style is still "flex" for committed rows).
        const main = read('main.js');
        expect(main).toMatch(/descToggle\.style\.display\s*===\s*['"]none['"]/);
    });
});
