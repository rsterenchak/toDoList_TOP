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

    it('wireToDoRowClick drives the read-mode expand through the row helper', () => {
        // The two-stage flow opens the description through the row's
        // stashed __openDesc helper — no explicit chevron sub-control is
        // involved, but the click handler still owns the
        // open-without-focusing-input dance.
        expect(toDoRow).toMatch(/function wireToDoRowClick\(toDoChild,\s*toDoInput\)/);
        expect(toDoRow).toMatch(/wireToDoRowClick\(toDoChild,\s*toDoInput\)/);
    });

    it('the mobile branch is gated on the ≤700px breakpoint', () => {
        // Desktop must keep its existing one-click-to-edit behavior. The
        // tap-to-view branch only fires when window.innerWidth ≤ 700.
        expect(toDoRow).toMatch(/window\.innerWidth\s*<=\s*700/);
    });

    it('first tap calls the row\'s __openDesc helper and marks the row data-mobile-read', () => {
        // Routes through the stashed open helper rather than reaching into
        // descSibling directly so insertion / close coupling with the rest
        // of the panel-management code stays in one place.
        expect(toDoRow).toMatch(/toDoChild\.__openDesc\(\)/);
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
        // expanded row so only one descSibling is open.
        expect(toDoRow).toMatch(
            /querySelectorAll\(\s*['"]#toDoChild\[data-mobile-read="true"\]['"]\s*\)/
        );
    });
});


describe('description chevron removal — no #descToggle anywhere', () => {

    const toDoRow = read('toDoRow.js');
    const css = read('style.css');
    const main = read('main.js');

    it('buildToDoRow does not create a #descToggle element', () => {
        // The dropdown chevron is gone — the description panel now opens
        // on focus and closes on blur, so the explicit toggle button is
        // redundant chrome.
        expect(toDoRow).not.toMatch(/descToggle\.id\s*=\s*["']descToggle["']/);
    });

    it('style.css carries no #descToggle rules', () => {
        expect(css).not.toMatch(/#descToggle\b/);
    });

    it('main.js no longer reaches for #descToggle anywhere', () => {
        expect(main).not.toMatch(/#descToggle\b/);
        expect(main).not.toMatch(/descToggle\.click\(/);
    });

    it('row exposes __openDesc / __closeDesc / __toggleDesc / __isDescOpen helpers', () => {
        // Other modules (mobile chip, bulk expand, outside-click collapse,
        // keyboard shortcut) drive the description through these helpers
        // instead of poking at a now-deleted chevron.
        expect(toDoRow).toMatch(/toDoChild\.__openDesc\s*=/);
        expect(toDoRow).toMatch(/toDoChild\.__closeDesc\s*=/);
        expect(toDoRow).toMatch(/toDoChild\.__toggleDesc\s*=/);
        expect(toDoRow).toMatch(/toDoChild\.__isDescOpen\s*=/);
    });

    it('focusin on the row opens the description; focusout closes it', () => {
        // wireDescriptionFocusOpen owns the focus-driven open/close.
        expect(toDoRow).toMatch(/function wireDescriptionFocusOpen\(/);
        expect(toDoRow).toMatch(/toDoChild\.addEventListener\(\s*['"]focusin['"]/);
        expect(toDoRow).toMatch(/toDoChild\.addEventListener\(\s*['"]focusout['"]/);
        // descSibling also gets a focusout so tabbing OUT of the
        // description input closes the panel (focusout from descInput
        // bubbles to descSibling, not toDoChild).
        expect(toDoRow).toMatch(/descSibling\.addEventListener\(\s*['"]focusout['"]/);
    });

    it('bulk expand / collapse routes through the row helpers', () => {
        expect(main).toMatch(/row\.__openDesc\(\)/);
        expect(main).toMatch(/row\.__closeDesc\(\)/);
    });
});


describe('STACK mobile tap-to-view — second tap focuses for edit', () => {

    const toDoRow = read('toDoRow.js');

    it('second tap (description already open) falls through to the focus-input path', () => {
        // The mobile branch is `isMobile && !descOpen` — once descOpen
        // becomes true, the branch is skipped and execution reaches the
        // committed-row activation block that focuses toDoInput.
        expect(toDoRow).toMatch(/isMobile\s*&&\s*!descOpen\b/);
        // The focus path below the branch must remain intact.
        const focusBlock = toDoRow.match(
            /toDoInput\.focus\(\);[\s\S]{0,200}setSelectionRange\(end,\s*end\)/
        );
        expect(focusBlock).toBeTruthy();
    });

    it('description close clears data-mobile-read so re-tap re-enters read mode cleanly', () => {
        // Without this cleanup, manually closing the description (or the
        // outside-tap collapse) would leave data-mobile-read stale and
        // the next tap would skip the open-and-stay step. The cleanup
        // now lives directly in __closeDesc.
        expect(toDoRow).toMatch(
            /function close\(\)[\s\S]{0,500}removeAttribute\(\s*['"]data-mobile-read['"]\s*\)/
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

    it('outside-collapse calls __closeDesc to close descSibling', () => {
        // Routing through the row's helper keeps the data-desc-open
        // attribute and the DOM in lockstep with manual toggles; the
        // helper also clears data-mobile-read in one place.
        const collapseBlock = main.match(
            /querySelectorAll\(\s*['"]#toDoChild\[data-mobile-read="true"\]['"][\s\S]{0,400}__closeDesc\(\)/
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


describe('STACK mobile tap-to-view — active row title is unclamped and washed', () => {

    const css = read('style.css');

    function mobileBlock() {
        const idx = css.indexOf('@media (max-width: 700px)');
        expect(idx).toBeGreaterThan(-1);
        return css.slice(idx);
    }

    it('active mobile-read row applies a subtle wash background so it reads as the active card', () => {
        // Without the wash, the only visual cue that a row is active is
        // the left-edge accent — long titles still get lost in the row's
        // default chrome. The wash distinguishes the active row from its
        // collapsed siblings.
        expect(mobileBlock()).toMatch(
            /#toDoChild\[data-mobile-read="true"\]\s*\{[\s\S]{0,200}background:\s*var\(--bg-hover\)/
        );
    });

    it('active mobile-read row paints a 2px accent left-edge', () => {
        // The left-edge ties the row to the descSibling below it so the
        // two surfaces read as one extended active card.
        expect(mobileBlock()).toMatch(
            /#toDoChild\[data-mobile-read="true"\]\s*\{[\s\S]{0,200}box-shadow:\s*inset\s+2px\s+0\s+0\s+var\(--accent\)/
        );
    });

    it('toDoInput inside an active mobile-read row drops the single-line clamp so long titles wrap', () => {
        // The four properties together — white-space: normal,
        // overflow: visible, text-overflow: clip, line-height: 1.4 —
        // are what unclamp the title from the default single-line
        // input rendering used by the ≤420px ellipsis rule. All four
        // must be present and selector specificity must beat the
        // ≤420px `#toDoInput` rule (two IDs vs one).
        const block = mobileBlock();
        const ruleMatch = block.match(
            /#toDoChild\[data-mobile-read="true"\]\s+#toDoInput\s*\{([\s\S]{0,300}?)\}/
        );
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        expect(body).toMatch(/white-space:\s*normal/);
        expect(body).toMatch(/overflow:\s*visible/);
        expect(body).toMatch(/text-overflow:\s*clip/);
        expect(body).toMatch(/line-height:\s*1\.4/);
    });

    it('collapsed rows still get the ≤420px single-line ellipsis treatment', () => {
        // Acceptance criterion: "A 60-character title in a collapsed row
        // truncates with an ellipsis as today." Don't drop the existing
        // narrow-phone ellipsis rule when introducing the unclamp.
        const idx = css.indexOf('@media (max-width: 420px)');
        expect(idx).toBeGreaterThan(-1);
        const phoneBlock = css.slice(idx);
        expect(phoneBlock).toMatch(
            /#toDoInput\s*\{[\s\S]{0,200}text-overflow:\s*ellipsis[\s\S]{0,200}white-space:\s*nowrap/
        );
    });

    it('active mobile-read row grows with its wrapped title content instead of clipping', () => {
        // Regression pin: the base #toDoChild rule sets height: var(--item-h)
        // and overflow: clip, so when the title-display span unclamps to
        // white-space: normal the wrapped lines overflow the row's fixed
        // box and get visually cut off (top and bottom lines truncated,
        // middle line readable). The fix promotes the row to a flexible
        // height with a 54px floor so short titles still anchor to the
        // standard row height while long titles can expand.
        const block = mobileBlock();
        const ruleMatch = block.match(
            /#toDoChild\[data-mobile-read="true"\]:not\(\[data-original-blank="true"\]\)\s*\{([\s\S]{0,400}?)\}/
        );
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        expect(body).toMatch(/height:\s*auto/);
        expect(body).toMatch(/min-height:\s*var\(--item-h\)/);
    });
});
