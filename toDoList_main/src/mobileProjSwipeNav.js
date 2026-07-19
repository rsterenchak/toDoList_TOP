import { navigateToProjectByIndex } from './projectBadges.js';

// Mobile swipe-on-title navigation gesture, extracted from main.js (a
// behaviour-preserving move). endSwipe is the touchend arm of the horizontal
// swipe on the mobile project title row: it reads the accumulated gesture and
// either commits to the prev/next project (past SWIPE_COMMIT_PX) or snaps the
// row back. Its three swipe-state fields (startX, active, horizontal) are also
// mutated by the touchstart/touchmove/touchcancel handlers that stay in
// main.js, so they live in a shared `swipeState` object passed in here rather
// than copied by value — endSwipe's active/horizontal resets must stay visible
// to those inline handlers. The commit threshold and the two main-local
// helpers it calls (clearSwipeTransform to snap back, activeProjectIndex to
// resolve position) arrive as factory deps; navigateToProjectByIndex is a
// stable module import resolved directly, so the returned body is identical to
// the inline original.
export function createMobileProjSwipeNav({
    swipeState,
    SWIPE_COMMIT_PX,
    clearSwipeTransform,
    activeProjectIndex,
}) {
    function endSwipe(event) {
        if (!swipeState.active) return;
        const wasHorizontal = swipeState.horizontal;
        swipeState.active = false;
        swipeState.horizontal = false;
        if (!wasHorizontal) {
            clearSwipeTransform();
            return;
        }
        const touch = (event.changedTouches && event.changedTouches[0]) || null;
        const dx = touch ? (touch.clientX - swipeState.startX) : 0;
        clearSwipeTransform();
        if (Math.abs(dx) < SWIPE_COMMIT_PX) return;
        const state = activeProjectIndex();
        if (state.idx < 0) return;
        if (dx < 0 && state.idx < state.projects.length - 1) {
            navigateToProjectByIndex(state.idx + 1);
        } else if (dx > 0 && state.idx > 0) {
            navigateToProjectByIndex(state.idx - 1);
        }
    }

    return { endSwipe };
}
