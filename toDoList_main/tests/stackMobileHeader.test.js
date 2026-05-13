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
// a "PROJECT N OF M" label, two-line project name flanked by prev/next
// chevrons (with a horizontal swipe-on-title gesture as an alternative
// navigation), and open/done counts on the stats line. Companion to the
// long-press project context menu and the three-way drawer close vocabulary
// that together complete the STACK foundation. Verified through source
// inspection because main.js is too large to instantiate end-to-end in
// jsdom (per CLAUDE.md guidance).
describe('STACK mobile project header', () => {
    const main = read('main.js');
    const css  = read('style.css');

    it('mounts the mobile project header inside the main column above the todo list', () => {
        expect(main).toMatch(/mobileProjHeader\.id\s*=\s*['"]mobileProjHeader['"]/);
        // The header is appended to main2 (the main column / #mainBar)
        // so it sits in the same scroll context as the todo list. The
        // former #mainTitle row was removed, so the header now sits
        // directly above #mainList.
        expect(main).toMatch(/main2\.appendChild\(mobileProjHeader\)/);
        const headerIdx = main.indexOf('main2.appendChild(mobileProjHeader)');
        const listIdx   = main.indexOf('main2.appendChild(mainList)');
        expect(headerIdx).toBeGreaterThan(-1);
        expect(listIdx).toBeGreaterThan(-1);
        // Header must precede mainList in the DOM so it renders above
        // the todo rows on mobile.
        expect(headerIdx).toBeLessThan(listIdx);
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

    it('flanks the project name with prev/next chevron buttons inside a title row', () => {
        // The chevrons replace the previous page-dot row; they double as
        // visual affordances for the swipe-on-title gesture.
        expect(main).toMatch(/mobileProjPrev\.id\s*=\s*['"]mobileProjPrev['"]/);
        expect(main).toMatch(/mobileProjNext\.id\s*=\s*['"]mobileProjNext['"]/);
        expect(main).toMatch(/mobileProjTitleRow\.appendChild\(mobileProjPrev\)/);
        expect(main).toMatch(/mobileProjTitleRow\.appendChild\(mobileProjName\)/);
        expect(main).toMatch(/mobileProjTitleRow\.appendChild\(mobileProjNext\)/);
    });

    it('routes a chevron click through the matching #projChild click', () => {
        // Reusing the existing projChild click handler keeps chevron taps
        // aligned with the full selection / accent / addAllToDo_DOM dance
        // that the sidebar already runs — no parallel selection path to
        // drift out of sync.
        const navStart = main.indexOf('function navigateToProjectByIndex(');
        expect(navStart).toBeGreaterThan(-1);
        const navSlice = main.slice(navStart, navStart + 800);
        expect(navSlice).toMatch(/sideMain\.querySelectorAll\(\s*['"]#projChild['"]\s*\)/);
        expect(navSlice).toMatch(/rows\[i\]\.click\(\s*\)/);
    });

    it('hard-stops chevron navigation at the ends (no wrap-around)', () => {
        // The Prev chevron is a no-op at the first project; Next is a
        // no-op at the last. The updateMobileProjHeader pass also drives
        // the buttons' disabled state off the same boundary check.
        const prevStart = main.indexOf("mobileProjPrev.addEventListener('click'");
        expect(prevStart).toBeGreaterThan(-1);
        const prevSlice = main.slice(prevStart, prevStart + 400);
        expect(prevSlice).toMatch(/activeIdx\s*>\s*0/);

        const nextStart = main.indexOf("mobileProjNext.addEventListener('click'");
        expect(nextStart).toBeGreaterThan(-1);
        const nextSlice = main.slice(nextStart, nextStart + 400);
        expect(nextSlice).toMatch(/activeIdx\s*<\s*projects\.length\s*-\s*1/);

        // disabled state mirrors the boundaries
        expect(main).toMatch(/mobileProjPrev\.disabled\s*=\s*atStart/);
        expect(main).toMatch(/mobileProjNext\.disabled\s*=\s*atEnd/);
    });

    it('wires a swipe gesture on the title row with horizontal-dominant threshold', () => {
        // The task calls for ~40px commit threshold via touchstart /
        // touchmove / touchend — same pattern as other touch handlers.
        expect(main).toMatch(/mobileProjTitleRow\.addEventListener\(\s*['"]touchstart['"]/);
        expect(main).toMatch(/mobileProjTitleRow\.addEventListener\(\s*['"]touchmove['"]/);
        expect(main).toMatch(/mobileProjTitleRow\.addEventListener\(\s*['"]touchend['"]/);
        expect(main).toMatch(/SWIPE_COMMIT_PX\s*=\s*40/);
    });

    it('fires navigator.vibrate(10) on each successful chevron/swipe commit', () => {
        // Matches the haptic pattern wireCheckbox already uses for the
        // celebratory micro-interaction.
        const navStart = main.indexOf('function navigateToProjectByIndex(');
        const navSlice = main.slice(navStart, navStart + 800);
        expect(navSlice).toMatch(/navigator\.vibrate\(\s*10\s*\)/);
    });

    it('chevrons have a ≥44×44 hit area at the mobile breakpoint', () => {
        // Acceptance criterion — CLAUDE.md mobile rule plus parity with
        // the previous page-dot hit target.
        const block = css.match(/\.mobileProjChev\s*\{[^}]*\}/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/width:\s*44px/);
        expect(block[0]).toMatch(/height:\s*44px/);
    });

    it('drops #mobileProjDots entirely (DOM node and CSS rules)', () => {
        // The chevrons + PROJECT N OF M label together replace the dot
        // row. Anything that still references the dropped node would
        // either no-op or produce dead chrome — guard against both.
        expect(main).not.toMatch(/mobileProjDots/);
        expect(css).not.toMatch(/mobileProjDots/);
        expect(css).not.toMatch(/\.mobileProjDot\b/);
    });

    it('exposes only the mobile header at the ≤700px breakpoint', () => {
        // The mobile header is in the DOM at all viewports so the JS path
        // is single-branch; CSS hides it at ≥701px to keep the desktop
        // chrome unchanged.
        const desktop = css.match(/@media \(min-width:\s*701px\)\s*\{[^@]*?#mobileProjHeader\s*\{\s*display:\s*none\s*;?\s*\}/);
        expect(desktop).toBeTruthy();
    });

    it('hides the floating EXPAND ALL wrapper on mobile so it can\'t paint over the first todo row', () => {
        // The desktop EXPAND ALL toggle floats over the top-right of
        // the project view. On mobile the drawer\'s "Expand all
        // descriptions" toggle reaches the same handler, so the
        // floating wrapper is hidden at narrow viewports.
        const mobile = css.slice(css.indexOf('@media (max-width: 700px)'));
        expect(mobile).toMatch(/#bulkDescActions\s*\{\s*display:\s*none/);
    });
});
