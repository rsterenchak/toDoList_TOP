import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the STACK mobile project header — the screen-level
// header that replaces the desktop breadcrumb at the ≤700px breakpoint with
// a "PROJECT N OF M" label, two-line project name, open/done counts, and
// tappable page dots. Companion to the long-press project context menu and
// the three-way drawer close vocabulary that together complete the STACK
// foundation. Verified through source inspection because main.js is too
// large to instantiate end-to-end in jsdom (per CLAUDE.md guidance).
describe('STACK mobile project header', () => {
    const main = read('main.js');
    const css  = read('style.css');

    it('mounts the mobile project header inside the main column', () => {
        expect(main).toMatch(/mobileProjHeader\.id\s*=\s*['"]mobileProjHeader['"]/);
        // The header is appended to main2 (the main column / #mainBar) so
        // it sits in the same scroll context as the todo list, above the
        // existing #mainTitle row.
        expect(main).toMatch(/main2\.appendChild\(mobileProjHeader\)/);
        const headerIdx = main.indexOf('main2.appendChild(mobileProjHeader)');
        const titleIdx  = main.indexOf('main2.appendChild(mainTitle)');
        expect(headerIdx).toBeGreaterThan(-1);
        expect(titleIdx).toBeGreaterThan(-1);
        // Header must precede mainTitle in the DOM so it renders above
        // the bulk-description chrome on mobile.
        expect(headerIdx).toBeLessThan(titleIdx);
    });

    it('renders a PROJECT N OF M label and the project name', () => {
        expect(main).toMatch(/mobileProjLabel\.textContent\s*=\s*['"]PROJECT\s*['"]\s*\+\s*\(activeIdx\s*\+\s*1\)\s*\+\s*['"]\s*OF\s*['"]\s*\+\s*total/);
        expect(main).toMatch(/mobileProjName\.textContent\s*=\s*activeName/);
    });

    it('renders open/done counts on the stats line', () => {
        expect(main).toMatch(/mobileProjOpen\.textContent\s*=\s*open\s*\+\s*['"]\s*open['"]/);
        expect(main).toMatch(/mobileProjDone\.textContent\s*=\s*done\s*\+\s*['"]\s*done['"]/);
    });

    it('rebuilds the header off the same observer path as the footer', () => {
        // updateFooterCounts already runs on every #mainList childList /
        // class change and #sideMa class / value change — extending it to
        // also call updateMobileProjHeader keeps the new chrome reactive
        // without needing a second observer.
        const fnIdx = main.indexOf('function updateFooterCounts(');
        expect(fnIdx).toBeGreaterThan(-1);
        const closeIdx = main.indexOf('updateMobileProjHeader', fnIdx);
        expect(closeIdx).toBeGreaterThan(fnIdx);
    });

    it('renders one page dot per project with active selection', () => {
        expect(main).toMatch(/projects\.forEach\(function\(name,\s*idx\)/);
        expect(main).toMatch(/dot\.className\s*=\s*['"]mobileProjDot['"]/);
        expect(main).toMatch(/dot\.setAttribute\(\s*['"]aria-selected['"]\s*,\s*idx\s*===\s*activeIdx/);
        expect(main).toMatch(/if\s*\(\s*idx\s*===\s*activeIdx\s*\)\s*dot\.classList\.add\(\s*['"]active['"]/);
    });

    it('routes a page-dot click through the matching #projChild click', () => {
        // Reusing the existing projChild click handler keeps the page-dot
        // tap aligned with the full selection / accent / addAllToDo_DOM
        // dance that the sidebar already runs — no parallel selection
        // path to drift out of sync.
        const handlerStart = main.indexOf("dot.addEventListener('click'");
        expect(handlerStart).toBeGreaterThan(-1);
        const handlerSlice = main.slice(handlerStart, handlerStart + 600);
        expect(handlerSlice).toMatch(/sideMain\.querySelectorAll\(\s*['"]#projChild['"]\s*\)/);
        expect(handlerSlice).toMatch(/rows\[i\]\.click\(\s*\)/);
    });

    it('no-ops when the active project dot is tapped (no edit-unlock)', () => {
        // projChild click on an already-selected row unlocks rename mode —
        // tapping the dot for the current project should do nothing.
        const handlerStart = main.indexOf("dot.addEventListener('click'");
        const handlerSlice = main.slice(handlerStart, handlerStart + 600);
        expect(handlerSlice).toMatch(/idx\s*===\s*activeIdx/);
    });

    it('page dots have a ≥44×44 hit area at the mobile breakpoint', () => {
        // Acceptance criterion in TODO.md. Visible dot is smaller (10×10)
        // but the button itself fills the touch target via padding.
        const block = css.match(/\.mobileProjDot\s*\{[^}]*\}/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/width:\s*44px/);
        expect(block[0]).toMatch(/height:\s*44px/);
    });

    it('exposes only the mobile header at the ≤700px breakpoint', () => {
        // The mobile header is in the DOM at all viewports so the JS path
        // is single-branch; CSS hides it at ≥701px to keep the desktop
        // chrome unchanged.
        const desktop = css.match(/@media \(min-width:\s*701px\)\s*\{[^@]*?#mobileProjHeader\s*\{\s*display:\s*none\s*;?\s*\}/);
        expect(desktop).toBeTruthy();
    });

    it('hides the desktop breadcrumb on mobile so the header is the single source of project name', () => {
        // The mobile header replaces the desktop breadcrumb as the place
        // the active project name appears textually below 700px.
        const mobile = css.slice(css.indexOf('@media (max-width: 700px)'));
        expect(mobile).toMatch(/#mainCrumb\s*\{\s*display:\s*none/);
    });
});
