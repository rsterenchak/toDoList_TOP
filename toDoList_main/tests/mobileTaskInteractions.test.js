import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the wiring for the STACK mobile task-interactions slice that ships
// in this PR: undo toast for swipe-left delete (replaces the confirm
// modal on the swipe path), the ¶ description indicator on collapsed
// rows with non-empty descriptions, and the single-swipe-at-a-time
// reset across rows. Source inspection (rather than full jsdom
// instantiation) is used to match the existing stackBottomSheet /
// stackEmptyStateMascots patterns — main.js is too large to load
// end-to-end per CLAUDE.md.

describe('STACK mobile task interactions — undo toast for swipe-delete', () => {

    const toDoRow    = read('toDoRow.js');
    const undoToast  = read('undoToast.js');
    const listLogic  = read('listLogic.js');

    it('toDoRow.js imports the undoToast module', () => {
        expect(toDoRow).toMatch(/from\s+['"]\.\/undoToast\.js['"]/);
    });

    it('swipe.onLeft captures the original item index before removing', () => {
        // The index capture is what makes UNDO restore-to-original-slot
        // work — without it we'd push the item back at the end.
        expect(toDoRow).toMatch(/onLeft:\s*function\s*\(\)\s*\{[\s\S]*?indexOf\(item\)/);
    });

    it('swipe.onLeft routes through removeToDoByItem (not the closeButton confirm modal)', () => {
        // Confirm modal path is bypassed on the swipe; immediate delete
        // pairs with the UNDO toast as the recovery affordance.
        const swipeOnLeft = toDoRow.match(/onLeft:\s*function\s*\(\)\s*\{([\s\S]*?)^\s{8}\}/m);
        expect(swipeOnLeft).toBeTruthy();
        expect(swipeOnLeft[1]).toMatch(/listLogic\.removeToDoByItem/);
    });

    it('swipe.onLeft surfaces a 5s undo toast that restores the row at originalIndex', () => {
        expect(toDoRow).toMatch(/showUndoToast\(/);
        expect(toDoRow).toMatch(/listLogic\.insertToDoAt\([^)]*originalIndex/);
    });

    it('listLogic exports insertToDoAt for the swipe-delete undo path', () => {
        expect(listLogic).toMatch(/function insertToDoAt\(project,\s*item,\s*index\)/);
        // Must be in the export object so callers can reach it.
        expect(listLogic).toMatch(/insertToDoAt,\s*\n/);
    });

    it('undoToast singleton replaces any prior toast on a new show', () => {
        // Two rapid swipe-deletes must never stack two toasts; the second
        // show fires the first toast's onDismiss synchronously so the
        // caller can drop its captured item reference.
        expect(undoToast).toMatch(/destroyActive\(/);
        expect(undoToast).toMatch(/activeOnDismiss/);
    });

    it('undoToast auto-dismisses after 5000ms (5s persistence per spec)', () => {
        expect(undoToast).toMatch(/TOAST_DURATION_MS\s*=\s*5000/);
        expect(undoToast).toMatch(/setTimeout\([^,]+,\s*TOAST_DURATION_MS\s*\)/);
    });

    it('undoToast UNDO button supersedes the dismiss timer (no spurious onDismiss after undo)', () => {
        // After UNDO fires, activeOnDismiss is nulled so the pending 5s
        // dismiss callback can't double-fire after the user already
        // recovered the row.
        expect(undoToast).toMatch(/undoBtn\.addEventListener\(\s*['"]click['"][\s\S]*?activeOnDismiss\s*=\s*null/);
    });
});


describe('STACK mobile task interactions — ¶ description indicator', () => {

    const toDoRow = read('toDoRow.js');
    const css     = read('style.css');

    it('toDoRow.js mirrors item.desc onto data-has-desc on the row', () => {
        expect(toDoRow).toMatch(/function updateDescIndicator\(toDoChild,\s*item\)/);
        expect(toDoRow).toMatch(/setAttribute\(\s*['"]data-has-desc['"]\s*,\s*['"]true['"]\s*\)/);
        expect(toDoRow).toMatch(/removeAttribute\(\s*['"]data-has-desc['"]\s*\)/);
    });

    it('updateDescIndicator runs on initial row build', () => {
        expect(toDoRow).toMatch(/updateDescIndicator\(toDoChild,\s*item\)/);
    });

    it('updateDescIndicator runs after every descInput change (keyup / blur / Enter)', () => {
        // All three persistence paths must keep the indicator in sync —
        // otherwise typing into the description leaves the row's
        // collapsed view stale until the next render.
        const keyupBlock = toDoRow.match(
            /descInput\.addEventListener\(\s*['"]keyup['"][\s\S]{0,300}updateDescIndicator/
        );
        const blurBlock = toDoRow.match(
            /descInput\.addEventListener\(\s*['"]blur['"][\s\S]{0,300}updateDescIndicator/
        );
        const enterBlock = toDoRow.match(
            /descInput\.addEventListener\(\s*['"]keydown['"][\s\S]{0,500}updateDescIndicator/
        );
        expect(keyupBlock).toBeTruthy();
        expect(blurBlock).toBeTruthy();
        expect(enterBlock).toBeTruthy();
    });

    it('CSS surfaces the ¶ glyph only on the mobile breakpoint (≤700px)', () => {
        // Locate the @media (max-width: 700px) block and verify the
        // selector and the literal ¶ character live inside it.
        const media700Idx = css.indexOf('@media (max-width: 700px)');
        expect(media700Idx).toBeGreaterThan(-1);
        const mobileBlock = css.slice(media700Idx);
        expect(mobileBlock).toMatch(/#toDoChild\[data-has-desc="true"\]\s*#duePill::before/);
        expect(mobileBlock).toMatch(/content:\s*['"]¶['"]/);
    });
});


describe('STACK mobile task interactions — single-swipe-at-a-time', () => {

    const dragDrop = read('dragDrop.js');

    it('touchstart resets any other row that is currently mid-swipe or mid-snapback', () => {
        // Scans the document for .swiping / .swipe-releasing on other
        // rows and resets them before arming this row's gesture so only
        // one action pane is ever exposed.
        expect(dragDrop).toMatch(
            /querySelectorAll\(['"]\.swiping,\s*\.swipe-releasing['"]\)/
        );
        // Must skip resetting the row that just started the new gesture.
        expect(dragDrop).toMatch(/if\s*\(other\s*===\s*row\)\s*return;/);
    });

    it('reset path also clears any pending snap-back timer on the other row', () => {
        // Without clearing the timer, the snap-back fires later and
        // re-resets the row mid-swipe, glitching the visual state.
        expect(dragDrop).toMatch(
            /forEach\(function\(other\)\s*\{[\s\S]*?_swipeReleaseTimer[\s\S]*?clearTimeout/
        );
    });
});
