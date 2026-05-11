import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile tap-to-view / tap-to-edit task-row interaction:
// the first tap on a collapsed committed row at the ≤700px breakpoint
// expands the existing descSibling panel WITHOUT focusing the title input
// (no soft keyboard). A second tap on the title or description text
// summons the keyboard. A tap outside the row+descSibling unit collapses
// the row back to row-only. Source inspection mirrors the existing
// mobileTaskInteractions.test.js pattern — buildToDoRow is too heavily
// wired to instantiate end-to-end here, but the wiring contract is what
// the regression risk lives in.

describe('STACK mobile tap-to-view — first tap expands without focusing', () => {

    const toDoRow = read('toDoRow.js');

    it('wireToDoRowClick receives descToggle so it can drive the read-mode expand', () => {
        // The two-stage flow needs a reference to the row's own descToggle
        // — without it, the click handler can't programmatically open the
        // description without focusing the input.
        expect(toDoRow).toMatch(/function wireToDoRowClick\(toDoChild,\s*toDoInput,\s*descToggle\)/);
        expect(toDoRow).toMatch(/wireToDoRowClick\(toDoChild,\s*toDoInput,\s*descToggle\)/);
    });

    it('the mobile branch is gated on the ≤700px breakpoint', () => {
        // Desktop must keep its existing one-click-to-edit behavior. The
        // tap-to-view branch only fires when window.innerWidth ≤ 700.
        expect(toDoRow).toMatch(/window\.innerWidth\s*<=\s*700/);
    });

    it('first tap programmatically clicks descToggle and marks the row data-mobile-read', () => {
        // Reuses descToggle.click() rather than reaching into descSibling
        // directly, so the existing wireDescToggle logic handles DOM
        // insertion / open class flip in lockstep.
        expect(toDoRow).toMatch(/descToggle\.click\(\)/);
        expect(toDoRow).toMatch(/setAttribute\(\s*['"]data-mobile-read['"]\s*,\s*['"]true['"]\s*\)/);
    });

    it('first-tap branch does not call toDoInput.focus() before returning', () => {
        // Extract the wireToDoRowClick body and locate the early-return
        // mobile branch. Walk from the start of the function until the
        // first `return;` and assert no `.focus()` call appears in that
        // slice (above the early return).
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        expect(fnIdx).toBeGreaterThan(-1);
        const tail = toDoRow.slice(fnIdx);
        const mobileBranchIdx = tail.indexOf('isMobile && !descOpen');
        expect(mobileBranchIdx).toBeGreaterThan(-1);
        // From the mobile branch start, find the next `return;` and check
        // that the slice up to it does not call toDoInput.focus.
        const branchSlice = tail.slice(mobileBranchIdx);
        const returnIdx = branchSlice.indexOf('return;');
        expect(returnIdx).toBeGreaterThan(-1);
        const beforeReturn = branchSlice.slice(0, returnIdx);
        expect(beforeReturn).not.toMatch(/toDoInput\.focus\(/);
    });

    it('first tap on a new row collapses any other rows that are already in mobile-read', () => {
        // Single-row-at-a-time: tapping a new row resets the prior auto-
        // expanded row's descToggle so only one descSibling is open.
        expect(toDoRow).toMatch(
            /querySelectorAll\(\s*['"]#toDoChild\[data-mobile-read="true"\]['"]\s*\)/
        );
    });
});


describe('STACK mobile tap-to-view — second tap focuses for edit', () => {

    const toDoRow = read('toDoRow.js');

    it('second tap (descToggle already open) falls through to the focus-input path', () => {
        // The mobile branch is `isMobile && !descOpen` — once descOpen
        // becomes true, the branch is skipped and execution reaches the
        // committed-row activation block that focuses toDoInput.
        expect(toDoRow).toMatch(
            /isMobile\s*&&\s*!descOpen\s*&&\s*descToggle/
        );
        // The focus path below the branch must remain intact.
        const focusBlock = toDoRow.match(
            /toDoInput\.focus\(\);[\s\S]{0,200}setSelectionRange\(end,\s*end\)/
        );
        expect(focusBlock).toBeTruthy();
    });

    it('descToggle close listener clears data-mobile-read so re-tap re-enters read mode cleanly', () => {
        // Without this cleanup, manually closing the description (or the
        // outside-tap collapse) would leave data-mobile-read stale and
        // the next tap would skip the open-and-stay step.
        expect(toDoRow).toMatch(
            /descToggle\.addEventListener\(\s*['"]click['"][\s\S]{0,300}removeAttribute\(\s*['"]data-mobile-read['"]\s*\)/
        );
    });
});


describe('STACK mobile tap-to-view — outside tap collapses read mode', () => {

    const main = read('main.js');

    it('document click handler iterates rows with data-mobile-read', () => {
        expect(main).toMatch(
            /querySelectorAll\(\s*['"]#toDoChild\[data-mobile-read="true"\]['"]\s*\)/
        );
    });

    it('outside-collapse fires descToggle.click() to close descSibling', () => {
        // Routing through descToggle keeps the open-class and DOM in
        // lockstep with manual toggles; it also lets the descToggle
        // cleanup listener clear data-mobile-read in one place.
        const collapseBlock = main.match(
            /querySelectorAll\(\s*['"]#toDoChild\[data-mobile-read="true"\]['"][\s\S]{0,400}dt\.click\(\)/
        );
        expect(collapseBlock).toBeTruthy();
    });

    it('collapse skips when the click landed inside #descSibling (mid-edit)', () => {
        // Tapping the description input itself must not collapse the row
        // out from under the user — only a tap outside both the row and
        // its description triggers collapse.
        expect(main).toMatch(/insideDesc\s*=\s*e\.target\.closest\(\s*['"]#descSibling['"]\s*\)/);
        expect(main).toMatch(/!insideRow\s*&&\s*!insideDesc/);
    });
});


describe('STACK mobile tap-to-view — visual merge with descSibling', () => {

    const css = read('style.css');

    it('mobile media query carries a data-mobile-read selector for the visual cue', () => {
        // The shared accent left-edge is what makes the row + descSibling
        // read as one card. Lives inside the ≤700px block so desktop is
        // untouched.
        const media700Idx = css.indexOf('@media (max-width: 700px)');
        expect(media700Idx).toBeGreaterThan(-1);
        const mobileBlock = css.slice(media700Idx);
        expect(mobileBlock).toMatch(/#toDoChild\[data-mobile-read="true"\]/);
    });

    it('descSibling under a mobile-read row pulls up to merge with the parent row', () => {
        const media700Idx = css.indexOf('@media (max-width: 700px)');
        const mobileBlock = css.slice(media700Idx);
        // Negative top margin overlaps the row's bottom edge so the two
        // surfaces read as continuous rather than stacked-with-a-gap.
        expect(mobileBlock).toMatch(
            /#toDoChild\[data-mobile-read="true"\]\s*\+\s*#descSibling[\s\S]{0,120}margin-top:\s*-\d+px/
        );
    });
});
