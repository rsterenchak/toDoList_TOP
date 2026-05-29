import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the mobile-only bottom sheet that hosts the
// COMPLETED list (and the TODO.md viewer card's Rendered / Raw tabs)
// when the user taps #completedHeader on the ≤700px breakpoint. The
// inline accordion expansion is broken on touch — the sheet replaces
// it on mobile and keeps the existing inline behavior on desktop.
// Verified via source inspection because main.js is too large to
// instantiate end-to-end in jsdom (per CLAUDE.md).
describe('Mobile COMPLETED bottom sheet', () => {
    const main = read('main.js');
    const css  = read('style.css');

    it('exposes a mobile viewport helper gated on a 700px width threshold', () => {
        expect(main).toMatch(/function isMobileViewport\s*\(/);
        expect(main).toMatch(/window\.innerWidth\s*<=\s*700/);
    });

    it('intercepts the #completedHeader click on mobile and opens the sheet instead of the inline toggle', () => {
        // The capture-phase listener that bridges descToggle and
        // completedHeader is the natural intercept point — on mobile
        // it must stopImmediatePropagation so the inline accordion
        // toggle never runs, then call the sheet opener.
        const idx = main.indexOf('isMobileViewport()');
        expect(idx).toBeGreaterThan(-1);
        // Walk every occurrence and ensure one of them sits in a window
        // that also calls stopImmediatePropagation + openCompletedMobileSheet.
        let pos = idx;
        let found = false;
        while (pos !== -1) {
            const slice = main.slice(Math.max(0, pos - 800), Math.min(main.length, pos + 800));
            if (slice.indexOf('#completedHeader') !== -1
                    && slice.indexOf('stopImmediatePropagation') !== -1
                    && slice.indexOf('openCompletedMobileSheet') !== -1) {
                found = true;
                break;
            }
            pos = main.indexOf('isMobileViewport()', pos + 1);
        }
        expect(found).toBe(true);
    });

    it('builds the sheet as a dialog with role + aria-modal + an aria label tying to its title', () => {
        const fnIdx = main.indexOf('function openCompletedMobileSheet(');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 6000);
        expect(slice).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]dialog['"]\s*\)/);
        expect(slice).toMatch(/setAttribute\(\s*['"]aria-modal['"]\s*,\s*['"]true['"]\s*\)/);
        expect(slice).toMatch(/setAttribute\(\s*['"]aria-labelledby['"]\s*,\s*['"]completedMobileSheetTitle['"]\s*\)/);
    });

    it('moves the existing completed rows + viewer card into the sheet body (DOM move, not clone)', () => {
        // Cloning would duplicate event listeners; moving keeps them
        // attached so checkbox toggles inside the sheet still mutate
        // the same data model.
        const collectIdx = main.indexOf('function collectCompletedNodesForSheet(');
        expect(collectIdx).toBeGreaterThan(-1);
        const slice = main.slice(collectIdx, collectIdx + 2000);
        expect(slice).toMatch(/querySelectorAll\(\s*['"]#toDoChild\.completed['"]\s*\)/);
        expect(slice).toMatch(/querySelector\(\s*['"]#todoMdViewerCard['"]\s*\)/);
        // The move is the appendChild on the sheet body. cloneNode would
        // be wrong here — pin its absence so a future refactor doesn't
        // silently switch to a clone path.
        expect(slice).toMatch(/sheetBody\.appendChild\(/);
        expect(slice).not.toMatch(/cloneNode/);
    });

    it('returns the moved nodes to #mainList on close so the inline rendering owns them again', () => {
        const fnIdx = main.indexOf('function closeCompletedMobileSheet(');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 3000);
        expect(slice).toMatch(/getElementById\(\s*['"]mainList['"]\s*\)/);
        expect(slice).toMatch(/mainListDiv\.appendChild\(\s*entry\.node\s*\)/);
        // Re-run the completed-section helper so the divider header
        // reattaches and the inline view normalizes.
        expect(slice).toMatch(/updateCompletedSection\(\s*mainListDiv\s*\)/);
    });

    it('wires the four-affordance close vocabulary: X button, backdrop tap, Escape, and touch swipe-down', () => {
        const fnIdx = main.indexOf('function openCompletedMobileSheet(');
        const slice = main.slice(fnIdx, fnIdx + 6000);
        // X button → click → close
        expect(slice).toMatch(/closeX\.addEventListener\(\s*['"]click['"]\s*,\s*closeCompletedMobileSheet\s*\)/);
        // Backdrop tap → close (filter so clicks INSIDE the sheet don't dismiss).
        expect(slice).toMatch(/backdrop\.addEventListener\(\s*['"]click['"][\s\S]{0,200}event\.target\s*===\s*backdrop[\s\S]{0,200}closeCompletedMobileSheet/);
        // Escape → close, attached in capture phase so it wins over
        // other Escape consumers mounted underneath the backdrop.
        expect(slice).toMatch(/event\.key\s*!==\s*['"]Escape['"]/);
        expect(slice).toMatch(/addEventListener\(\s*['"]keydown['"]\s*,\s*onKeydown\s*,\s*true\s*\)/);
        // Touch swipe-down attached to both the drag handle and the
        // header — per the touch-input spec, the dismiss gesture must
        // be reachable from a generous hit area.
        expect(slice).toMatch(/attachCompletedSheetSwipeDown\(\s*handle\s*,/);
        expect(slice).toMatch(/attachCompletedSheetSwipeDown\(\s*headerEl\s*,/);
    });

    it('wires touchstart / touchmove / touchend for the swipe-down dismiss', () => {
        // CLAUDE.md: HTML5 drag events don't fire reliably on touch, so
        // the swipe-to-dismiss must be driven by raw touch events.
        const fnIdx = main.indexOf('function attachCompletedSheetSwipeDown(');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 4000);
        expect(slice).toMatch(/addEventListener\(\s*['"]touchstart['"]/);
        expect(slice).toMatch(/addEventListener\(\s*['"]touchmove['"]/);
        expect(slice).toMatch(/addEventListener\(\s*['"]touchend['"]/);
        expect(slice).toMatch(/addEventListener\(\s*['"]touchcancel['"]/);
    });

    it('re-collects rows on every mainListRendered so re-renders while the sheet is open stay live', () => {
        // A swipe-complete or checkbox toggle inside the sheet calls
        // reorderToDoDOM which queries #mainList — a row that was moved
        // into the sheet wouldn't be found and a duplicate would be
        // built in mainList. Listening for mainListRendered and
        // re-collecting closes that gap: orphans get discarded and the
        // sheet body reflects the live mainList content.
        const idx = main.indexOf("addEventListener('mainListRendered'");
        expect(idx).toBeGreaterThan(-1);
        // Walk every mainListRendered listener and find one that calls
        // refreshCompletedMobileSheetContent.
        let pos = idx;
        let found = false;
        while (pos !== -1) {
            const slice = main.slice(pos, Math.min(main.length, pos + 600));
            if (slice.indexOf('refreshCompletedMobileSheetContent') !== -1) {
                found = true;
                break;
            }
            pos = main.indexOf("addEventListener('mainListRendered'", pos + 1);
        }
        expect(found).toBe(true);
    });

    it('dismisses the sheet on a resize past the mobile breakpoint so desktop falls back to inline', () => {
        // The inline accordion works on desktop — auto-closing the
        // sheet on resize past 700px keeps the affordance consistent
        // with the active viewport rather than stranding a touch-only
        // surface on a mouse layout.
        expect(main).toMatch(/addEventListener\(\s*['"]resize['"][\s\S]{0,400}!isMobileViewport\(\s*\)[\s\S]{0,200}closeCompletedMobileSheet/);
    });

    it('styles the sheet as a bottom-anchored slide-up overlay with safe-area padding', () => {
        const backdropBlock = css.match(/#completedMobileSheetBackdrop\s*\{[^}]*\}/);
        expect(backdropBlock).toBeTruthy();
        expect(backdropBlock[0]).toMatch(/position:\s*fixed/);
        expect(backdropBlock[0]).toMatch(/inset:\s*0/);
        // Anchored at the bottom edge so the slide-up animation reads
        // as a sheet rising into view rather than a centered modal.
        expect(backdropBlock[0]).toMatch(/align-items:\s*flex-end/);

        const sheetBlock = css.match(/#completedMobileSheet\s*\{[^}]*\}/);
        expect(sheetBlock).toBeTruthy();
        // Hidden by default via a translateY(100%); the .is-open class
        // on the backdrop drops the transform to 0 and the CSS
        // transition runs the slide-up.
        expect(sheetBlock[0]).toMatch(/transform:\s*translateY\(100%\)/);
        expect(sheetBlock[0]).toMatch(/transition:\s*transform\s+0?\.\d+s/);
        // Safe-area inset so the sheet body clears the home indicator
        // on notched iPhones.
        expect(sheetBlock[0]).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom/);

        expect(css).toMatch(/#completedMobileSheetBackdrop\.is-open\s+#completedMobileSheet\s*\{[\s\S]*?transform:\s*translateY\(0\)/);
    });
});
