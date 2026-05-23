import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the touch-based swipe-up gesture that opens the
// mobile bottom utilities sheet (Pomodoro + music). Complements the
// existing pointer-event drag handler: touch path adds a wider hit zone
// along the bottom edge so the user doesn't have to first locate the
// small nub, translates the sheet with the finger so the gesture feels
// physical, and commits on a 40px distance / short upward velocity.
// While the sheet is expanded the reverse gesture (swipe-down anywhere
// on the drawer container) dismisses. Verified through source inspection
// because main.js is too large to instantiate end-to-end in jsdom (per
// CLAUDE.md).
describe('Mobile bottom sheet swipe-up gesture', () => {
    const main = read('main.js');
    const css  = read('style.css');

    it('mounts the bottom-edge swipe hit zone inside #bottomSheet', () => {
        expect(main).toMatch(/sheetSwipeZone\.className\s*=\s*['"]sheetSwipeZone['"]/);
        // Inserted before the nub so the visible handle stacks above the
        // invisible strip — taps on the nub still hit the button first.
        expect(main).toMatch(/bottomSheet\.insertBefore\(sheetSwipeZone,\s*sheetNub\)/);
        // Marked aria-hidden so screen readers don't surface the empty strip.
        expect(main).toMatch(/sheetSwipeZone\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
    });

    it('renders the swipe hit zone only on touch devices at the mobile breakpoint', () => {
        // Inside the mobile media block the strip is positioned along the
        // bottom edge with pointer-events disabled by default. The
        // `bottom` offset lifts the strip above the persistent
        // #mobileTabBar so the bottom-edge swipe-up gesture catches at
        // the tabs' top edge instead of being intercepted by the tabs
        // themselves. The tab bar now anchors to `bottom: 0` and absorbs
        // env(safe-area-inset-bottom) into its own height, so the swipe
        // zone has to clear both the tab-bar height AND the home-indicator
        // inset to land at the tab bar's top edge.
        const block = css.match(/\.sheetSwipeZone\s*\{[^}]*\}/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/position:\s*absolute/);
        expect(block[0]).toMatch(/bottom:\s*calc\(\s*var\(--mobile-tab-h[^)]*\)\s*\+\s*env\(safe-area-inset-bottom[^)]*\)\s*\)/);
        expect(block[0]).toMatch(/pointer-events:\s*none/);
        // Pointer-events flip to auto only when both the mobile width AND
        // a coarse pointer apply — desktop with a fine pointer leaves the
        // strip non-interactive.
        expect(css).toMatch(/@media \(max-width:\s*700px\)\s*and\s*\(pointer:\s*coarse\)\s*\{\s*\.sheetSwipeZone\s*\{\s*pointer-events:\s*auto/);
        // Hidden while EXPANDED so taps inside the open sheet aren't
        // intercepted by the strip behind it.
        expect(css).toMatch(/#bottomSheet\[data-state="EXPANDED"\]\s*\.sheetSwipeZone\s*\{\s*display:\s*none/);
    });

    it('gates the touch handler on a coarse-pointer matchMedia check', () => {
        // The desktop pointer-event drag handler still owns mouse / pen
        // gestures; gating on (pointer: coarse) keeps the two paths from
        // double-firing on the same input device.
        expect(main).toMatch(/function isCoarsePointer\(/);
        expect(main).toMatch(/matchMedia\(\s*['"]\(pointer:\s*coarse\)['"]\s*\)\.matches/);
    });

    it('attaches touch swipe handlers to the nub, peek strip, swipe zone, and drawer container', () => {
        expect(main).toMatch(/attachSheetTouchSwipe\(sheetNub,\s*['"]open['"]\)/);
        expect(main).toMatch(/attachSheetTouchSwipe\(sheetPeek,\s*['"]open['"]\)/);
        expect(main).toMatch(/attachSheetTouchSwipe\(sheetSwipeZone,\s*['"]open['"]\)/);
        // Close swipe binds to the whole drawer container, not just the
        // small drag handle, so the dismiss gesture stays available after
        // the user has interacted with controls inside the drawer.
        expect(main).toMatch(/attachSheetTouchSwipe\(sheetExpanded,\s*['"]close['"]\)/);
    });

    it('wires touchstart / touchmove / touchend on the swipe targets', () => {
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 8000);
        expect(slice).toMatch(/addEventListener\(\s*['"]touchstart['"]/);
        expect(slice).toMatch(/addEventListener\(\s*['"]touchmove['"]/);
        expect(slice).toMatch(/addEventListener\(\s*['"]touchend['"]/);
        expect(slice).toMatch(/addEventListener\(\s*['"]touchcancel['"]/);
    });

    it('commits on a 40px distance OR a short upward velocity', () => {
        // The two thresholds pin the spec: SHEET_SWIPE_COMMIT_PX is the
        // distance floor, SHEET_SWIPE_VELOCITY_PX is the velocity floor
        // (px / ms) so a quick flick under 40px still opens the menu.
        expect(main).toMatch(/SHEET_SWIPE_COMMIT_PX\s*=\s*40/);
        expect(main).toMatch(/SHEET_SWIPE_VELOCITY_PX\s*=\s*0?\.5/);
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        const slice = main.slice(fnIdx, fnIdx + 8000);
        // Open path: distance OR velocity commits to EXPANDED.
        expect(slice).toMatch(/\(-dy\)\s*>=\s*SHEET_SWIPE_COMMIT_PX[\s\S]{0,200}velocity\s*>=\s*SHEET_SWIPE_VELOCITY_PX[\s\S]{0,400}setSheetState\(\s*['"]EXPANDED['"]\s*\)/);
    });

    it('translates the sheet with the finger during the drag so the gesture feels physical', () => {
        // The live inline transform is what makes the sheet track the
        // finger 1:1 — the snap animation only kicks back in after
        // clearSheetDragTransform clears the inline style.
        expect(main).toMatch(/function setSheetDragTransform\(/);
        expect(main).toMatch(/sheetExpanded\.style\.transform\s*=\s*['"]translateY\(['"]\s*\+\s*translatePx\s*\+\s*['"]px\)['"]/);
        // While dragging the transition is suppressed so the translate
        // doesn't smooth toward the target — it tracks the finger.
        expect(main).toMatch(/sheetExpanded\.style\.transition\s*=\s*['"]none['"]/);
        expect(main).toMatch(/function clearSheetDragTransform\(/);
    });

    it('rejects horizontal-dominant or wrong-direction gestures before resolving', () => {
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        const slice = main.slice(fnIdx, fnIdx + 8000);
        // Horizontal-dominant: abandon the gesture without altering state.
        expect(slice).toMatch(/Math\.abs\(dx\)\s*>\s*Math\.abs\(dy\)[\s\S]{0,150}active\s*=\s*false/);
        // Wrong-direction guards: open path bails on dy >= 0, close on dy <= 0.
        expect(slice).toMatch(/mode === ['"]open['"]\s*&&\s*dy\s*>=\s*0/);
        expect(slice).toMatch(/mode === ['"]close['"]\s*&&\s*dy\s*<=\s*0/);
    });

    it('snaps back to the origin state when the commit threshold is missed', () => {
        // The user can change their mind mid-gesture — releasing before
        // 40px / velocity threshold reverts the sheet to whatever state
        // the gesture started in (IDLE or PEEK).
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        const slice = main.slice(fnIdx, fnIdx + 8000);
        // Open path: if not committed, restore the origin state.
        expect(slice).toMatch(/setSheetState\(originState\)/);
    });

    it('swipe-down on the drawer container dismisses to PEEK or IDLE based on utility activity', () => {
        // Mirrors the existing pointer-event 30% rule but uses the same
        // 40px / velocity contract as the open path, and routes through
        // utilityIsActive() to land on PEEK if a timer / music is running.
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        const slice = main.slice(fnIdx, fnIdx + 8000);
        expect(slice).toMatch(/const act\s*=\s*utilityIsActive\(\)/);
        expect(slice).toMatch(/setSheetState\(\s*act\.any\s*\?\s*['"]PEEK['"]\s*:\s*['"]IDLE['"]\s*\)/);
    });

    it('marks sheetPeek with suppressClick when the swipe-up resolves so the synthetic click does not double-fire', () => {
        // The peek strip has both a click listener (tap-to-expand) and
        // this touch swipe — when the swipe resolves we stamp the same
        // data-suppress-click flag the existing pointer handler uses so
        // the post-touch click is swallowed.
        const fnIdx = main.indexOf('function attachSheetTouchSwipe(');
        const slice = main.slice(fnIdx, fnIdx + 8000);
        expect(slice).toMatch(/targetEl === sheetPeek[\s\S]{0,200}sheetPeek\.dataset\.suppressClick\s*=\s*['"]1['"]/);
    });

    it('leaves desktop pointer-drag intact (touch input bails out of attachDragGesture)', () => {
        // The existing pointer handler runs for mouse / pen on desktop;
        // bailing on pointerType === 'touch' hands the touch path entirely
        // to the new touch handler so the two don't double-fire.
        const fnIdx = main.indexOf('function attachDragGesture(');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 2000);
        expect(slice).toMatch(/e\.pointerType\s*===\s*['"]touch['"]/);
    });
});
