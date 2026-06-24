import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: the shared confirmation modal (#confirmModalBackdrop, built by
// showConfirmModal) is opened from inside the TODO.md viewer's mobile sheet —
// e.g. deleting a todo entry. The sheet shells stack at z-index 4000/4100, so a
// confirm modal that sat at the old 100 rendered BEHIND the sheet and was
// unreachable on mobile. These assertions are relational (not bare numbers) so
// they fail the moment the confirm modal ever drops below a sheet again,
// however those sheets renumber themselves.
describe('confirm modal stacking — style.css', () => {
    const css = read('style.css');

    // Slice every rule body for an exact selector; the last z-index wins.
    function ruleBodies(selector) {
        const bodies = [];
        let idx = 0;
        while (true) {
            idx = css.indexOf(selector, idx);
            if (idx === -1) break;
            const next = css[idx + selector.length];
            // Ensure exact selector match (not a prefix of a longer id/class).
            if (next && /[\w-]/.test(next)) { idx += selector.length; continue; }
            const open = css.indexOf('{', idx);
            const close = css.indexOf('}', open);
            if (open === -1 || close === -1) break;
            bodies.push(css.slice(open + 1, close));
            idx = close + 1;
        }
        return bodies;
    }

    function zIndexOf(selector) {
        let z = null;
        for (const body of ruleBodies(selector)) {
            const zm = /z-index:\s*(\d+)/.exec(body);
            if (zm) z = parseInt(zm[1], 10);
        }
        return z;
    }

    it('#confirmModalBackdrop stacks above the TODO.md viewer mobile sheet', () => {
        const sheetZ = zIndexOf('#todoMdViewerMobileSheetBackdrop');
        const modalZ = zIndexOf('#confirmModalBackdrop');
        expect(sheetZ).toBeGreaterThan(0);
        expect(modalZ).toBeGreaterThan(sheetZ);
    });

    it('#confirmModalBackdrop stacks above the viewer overflow mobile sheet', () => {
        const overflowZ = zIndexOf('#todoMdViewerOverflowMobileSheetBackdrop');
        const modalZ = zIndexOf('#confirmModalBackdrop');
        expect(overflowZ).toBeGreaterThan(0);
        expect(modalZ).toBeGreaterThan(overflowZ);
    });

    it('#confirmModalBackdrop stacks above the completed mobile sheet', () => {
        const completedZ = zIndexOf('#completedMobileSheetBackdrop');
        const modalZ = zIndexOf('#confirmModalBackdrop');
        expect(completedZ).toBeGreaterThan(0);
        expect(modalZ).toBeGreaterThan(completedZ);
    });
});
