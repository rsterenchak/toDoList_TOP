import { describe, it, expect, vi, beforeEach } from 'vitest';

// navigateToProjectByIndex is a stable module import in the extracted module;
// mock it so we can assert the commit path without pulling in real project
// state.
const navigateToProjectByIndex = vi.fn();
vi.mock('../src/projectBadges.js', () => ({
    navigateToProjectByIndex: (...args) => navigateToProjectByIndex(...args),
}));

import { createMobileProjSwipeNav } from '../src/mobileProjSwipeNav.js';

// Pins the behaviour-preserving extraction of endSwipe from main.js: the
// touchend arm of the mobile swipe-on-title project navigation. The three
// swipe-state fields are shared with the (still-in-main) touchstart/move/cancel
// handlers via the passed-in swipeState object, so endSwipe's resets must land
// on that object; committing/snapping keys off SWIPE_COMMIT_PX and the two
// injected helpers.
describe('createMobileProjSwipeNav — endSwipe', () => {
    const SWIPE_COMMIT_PX = 40;
    let swipeState;
    let clearSwipeTransform;
    let activeProjectIndex;
    let endSwipe;

    function makeEndTouch(dx) {
        return { changedTouches: [{ clientX: swipeState.startX + dx }] };
    }

    beforeEach(() => {
        navigateToProjectByIndex.mockClear();
        clearSwipeTransform = vi.fn();
        // Middle of a 3-project list by default so both directions are open.
        activeProjectIndex = vi.fn(() => ({ projects: ['a', 'b', 'c'], idx: 1 }));
        swipeState = { startX: 100, startY: 0, active: true, horizontal: true };
        ({ endSwipe } = createMobileProjSwipeNav({
            swipeState,
            SWIPE_COMMIT_PX,
            clearSwipeTransform,
            activeProjectIndex,
        }));
    });

    it('bails and touches nothing when the gesture was never active', () => {
        swipeState.active = false;
        endSwipe(makeEndTouch(-100));
        expect(clearSwipeTransform).not.toHaveBeenCalled();
        expect(navigateToProjectByIndex).not.toHaveBeenCalled();
    });

    it('resets active/horizontal on the shared swipeState after handling', () => {
        endSwipe(makeEndTouch(-100));
        expect(swipeState.active).toBe(false);
        expect(swipeState.horizontal).toBe(false);
    });

    it('snaps back without navigating when the gesture was not horizontal', () => {
        swipeState.horizontal = false;
        endSwipe(makeEndTouch(-100));
        expect(clearSwipeTransform).toHaveBeenCalledTimes(1);
        expect(navigateToProjectByIndex).not.toHaveBeenCalled();
    });

    it('snaps back without navigating below the commit threshold', () => {
        endSwipe(makeEndTouch(-(SWIPE_COMMIT_PX - 1)));
        expect(clearSwipeTransform).toHaveBeenCalledTimes(1);
        expect(navigateToProjectByIndex).not.toHaveBeenCalled();
    });

    it('commits to the next project on a left swipe past the threshold', () => {
        endSwipe(makeEndTouch(-(SWIPE_COMMIT_PX + 1)));
        expect(navigateToProjectByIndex).toHaveBeenCalledWith(2);
    });

    it('commits to the previous project on a right swipe past the threshold', () => {
        endSwipe(makeEndTouch(SWIPE_COMMIT_PX + 1));
        expect(navigateToProjectByIndex).toHaveBeenCalledWith(0);
    });

    it('does not navigate past the last project (left swipe at the end)', () => {
        activeProjectIndex.mockReturnValue({ projects: ['a', 'b', 'c'], idx: 2 });
        endSwipe(makeEndTouch(-(SWIPE_COMMIT_PX + 1)));
        expect(navigateToProjectByIndex).not.toHaveBeenCalled();
    });

    it('does not navigate before the first project (right swipe at the start)', () => {
        activeProjectIndex.mockReturnValue({ projects: ['a', 'b', 'c'], idx: 0 });
        endSwipe(makeEndTouch(SWIPE_COMMIT_PX + 1));
        expect(navigateToProjectByIndex).not.toHaveBeenCalled();
    });

    it('does not navigate when there is no active project (idx < 0)', () => {
        activeProjectIndex.mockReturnValue({ projects: [], idx: -1 });
        endSwipe(makeEndTouch(-(SWIPE_COMMIT_PX + 1)));
        expect(navigateToProjectByIndex).not.toHaveBeenCalled();
    });
});
