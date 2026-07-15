import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression for the mobile bottom drawer swipe-down dismiss gesture: the
// close listener has to live on the drawer container (sheetExpanded) so a
// swipe-down anywhere on the panel dismisses. Previously the close handler
// was bound only to the small drag handle, so the dismiss gesture stopped
// firing the moment the user touched inner content. The close path also
// needs to yield to native scrolling when the touch begins inside a
// scrollable region that's already scrolled — otherwise scroll-up-through-
// content would be hijacked into a dismiss commit.
// The sheet's DOM/logic now lives in mobileUtilitySheet.js (extracted from
// main.js's component()), so these source assertions read that module.
describe('Mobile bottom drawer swipe-down close gesture (container-bound)', () => {
    const main = read('mobileUtilitySheet.js');

    it('attaches the close-direction handler to the drawer container, not just the drag handle', () => {
        // Container-bound binding so swipe-down anywhere on the drawer
        // dismisses — covers the case where the user has already touched
        // inner content and the gesture would otherwise be unreachable.
        expect(main).toMatch(/attachSheetTouchSwipe\(sheetExpanded,\s*['"]close['"]\)/);
        // The old binding to the bare drag handle is gone so we don't
        // run two parallel state machines on the same gesture.
        expect(main).not.toMatch(/attachSheetTouchSwipe\(sheetDragHandle,\s*['"]close['"]\)/);
    });

    it('captures the scrollable ancestor of the touch target at touchstart', () => {
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 8000);
        // findScrollableAncestor walks up from event.target so we know
        // whether the user is touching inside an inner scrollable child.
        expect(slice).toMatch(/function findScrollableAncestor\(/);
        // The lookup is gated to 'close' mode so the open-direction path
        // (nub / peek / swipe zone) keeps its original behavior.
        expect(slice).toMatch(/scrollableAtStart\s*=\s*\(\s*mode\s*===\s*['"]close['"]\s*\)[\s\S]{0,200}findScrollableAncestor\(\s*event\.target\s*\)/);
        // Captured at touchstart so the decision is anchored to where the
        // gesture began rather than where the finger is when it resolves.
        expect(slice).toMatch(/scrollableTopAtStart\s*=\s*scrollableAtStart\s*\?\s*scrollableAtStart\.scrollTop\s*:\s*0/);
    });

    it('yields to native scroll when the touch began inside an already-scrolled child', () => {
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        const slice = main.slice(fnIdx, fnIdx + 8000);
        // Before the gesture resolves (and before preventDefault fires)
        // bail out when the touch started inside a scrollable element
        // whose scrollTop is non-zero — that's the user scrolling up
        // through content, not dismissing.
        expect(slice).toMatch(/mode === ['"]close['"]\s*&&\s*scrollableAtStart\s*&&\s*scrollableTopAtStart\s*>\s*0[\s\S]{0,200}active\s*=\s*false/);
    });

    it('still only resolves past the 8px intent threshold so button taps are unaffected', () => {
        // The intent threshold guard means stationary taps (no touchmove,
        // or sub-8px wiggle) never preventDefault — so inner buttons /
        // toggles inside the drawer keep their click semantics intact.
        expect(main).toMatch(/SHEET_SWIPE_INTENT_PX\s*=\s*8/);
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        const slice = main.slice(fnIdx, fnIdx + 8000);
        expect(slice).toMatch(/Math\.abs\(dy\)\s*<\s*SHEET_SWIPE_INTENT_PX[\s\S]{0,150}return/);
    });

    it('keeps the close commit thresholds and PEEK/IDLE routing intact', () => {
        // The fix is scoped to where the listener binds and to the
        // scrollable-yield guard — the commit contract (40px or velocity
        // ≥ 0.5 px/ms) and post-dismiss routing through utilityIsActive()
        // is unchanged so the gesture still feels identical when it does
        // commit.
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        const slice = main.slice(fnIdx, fnIdx + 8000);
        expect(slice).toMatch(/dy\s*>=\s*SHEET_SWIPE_COMMIT_PX[\s\S]{0,200}velocity\s*>=\s*SHEET_SWIPE_VELOCITY_PX/);
        expect(slice).toMatch(/const act\s*=\s*utilityIsActive\(\)/);
        expect(slice).toMatch(/setSheetState\(\s*act\.any\s*\?\s*['"]PEEK['"]\s*:\s*['"]IDLE['"]\s*\)/);
    });
});
