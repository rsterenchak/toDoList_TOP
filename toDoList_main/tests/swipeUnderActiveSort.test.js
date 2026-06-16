import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setupRowDrag } from '../src/dragDrop.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

// Regression coverage for: "swipe-to-complete and swipe-to-delete dying when a
// task sort is active." On mobile the per-row checkbox and delete button are
// display:none, so swipe is the only touch path for those actions — and the
// touchstart gate used to bail on the SAME isDraggable() predicate that goes
// false whenever a sort is applied, stranding both gestures. The fix splits
// swipe-eligibility (content-only, sort-agnostic) from drag-eligibility (gated
// on the sort), so swipe arms and commits under a sort while manual reorder
// stays disabled.

// Minimal touch-event helper. jsdom has no TouchEvent constructor, so we
// dispatch a plain Event and attach a `touches` array the handlers read.
function fireTouch(el, type, points) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    ev.touches = points;
    el.dispatchEvent(ev);
}

function makeRow() {
    const container = document.createElement('div');
    container.id = 'mainList';
    const row = document.createElement('div');
    row.id = 'toDoChild';
    container.appendChild(row);
    document.body.appendChild(container);
    // jsdom returns width 0 for getBoundingClientRect; the swipe commit
    // threshold is row-width-relative, so give the row a concrete width.
    row.getBoundingClientRect = () => ({
        width: 200, height: 40, top: 0, left: 0, right: 200, bottom: 40, x: 0, y: 0,
    });
    return { container, row };
}

// Drive a full horizontal swipe gesture: down at startX, move to endX, lift.
function swipeGesture(row, startX, endX) {
    fireTouch(row, 'touchstart', [{ clientX: startX, clientY: 100 }]);
    fireTouch(row, 'touchmove',  [{ clientX: endX,   clientY: 100 }]);
    fireTouch(row, 'touchend',   []);
}

describe('Swipe survives an active task sort', () => {
    let row, onRight, onLeft, onReorder;

    beforeEach(() => {
        document.body.innerHTML = '';
        ({ row } = makeRow());
        onRight = vi.fn();
        onLeft = vi.fn();
        onReorder = vi.fn();
        // Coarse pointer is required for the swipe path to engage.
        window.matchMedia = (q) => ({
            matches: /coarse/.test(q),
            media: q,
            addListener() {}, removeListener() {},
            addEventListener() {}, removeEventListener() {},
        });
    });

    function wire({ draggable, swipeable }) {
        setupRowDrag(row, {
            container: document.getElementById('mainList'),
            itemSelector: '#toDoChild',
            isDraggable: () => draggable,
            isSwipeable: () => swipeable,
            onReorder,
            swipe: { onRight, onLeft },
        });
    }

    it('arms and commits swipe-to-delete (left) while a sort is active', () => {
        // Sort active → not draggable, but the committed row is swipeable.
        wire({ draggable: false, swipeable: true });
        swipeGesture(row, 300, 130); // dx = -170, past the 100px threshold
        expect(onLeft).toHaveBeenCalledTimes(1);
        expect(onRight).not.toHaveBeenCalled();
    });

    it('arms and commits swipe-to-complete (right) while a sort is active', () => {
        wire({ draggable: false, swipeable: true });
        swipeGesture(row, 60, 240); // dx = +180, past the 100px threshold
        expect(onRight).toHaveBeenCalledTimes(1);
        expect(onLeft).not.toHaveBeenCalled();
    });

    it('keeps manual drag-to-reorder disabled while a sort is active', () => {
        wire({ draggable: false, swipeable: true });
        // A vertical-dominant gesture must not promote to a reorder when the
        // sort has disabled dragging — the arm timer is never scheduled.
        fireTouch(row, 'touchstart', [{ clientX: 100, clientY: 100 }]);
        fireTouch(row, 'touchmove',  [{ clientX: 100, clientY: 300 }]);
        fireTouch(row, 'touchend',   []);
        expect(onReorder).not.toHaveBeenCalled();
    });

    it('still commits swipe when no sort is active (draggable + swipeable)', () => {
        wire({ draggable: true, swipeable: true });
        swipeGesture(row, 300, 130);
        expect(onLeft).toHaveBeenCalledTimes(1);
    });

    it('leaves blank placeholder rows (not swipeable) inert', () => {
        // Blank placeholder: neither draggable nor swipeable.
        wire({ draggable: false, swipeable: false });
        swipeGesture(row, 300, 130);
        expect(onLeft).not.toHaveBeenCalled();
        expect(onRight).not.toHaveBeenCalled();
    });

    it('falls back to the drag gate for callers that omit isSwipeable', () => {
        // Project rows pass no isSwipeable; swipe-eligibility then tracks
        // isDraggable, preserving their prior behavior.
        setupRowDrag(row, {
            container: document.getElementById('mainList'),
            itemSelector: '#toDoChild',
            isDraggable: () => false,
            onReorder,
            swipe: { onRight, onLeft },
        });
        swipeGesture(row, 300, 130);
        expect(onLeft).not.toHaveBeenCalled();
    });
});

describe('Swipe-vs-drag eligibility wiring (source contract)', () => {
    it('toDoRow passes a content-only isSwipeable that ignores the sort', () => {
        const toDoRow = read('toDoRow.js');
        const idx = toDoRow.indexOf('isSwipeable: function() {');
        expect(idx).toBeGreaterThan(-1);
        const body = toDoRow.slice(idx, toDoRow.indexOf('},', idx));
        // The swipe predicate must not gate on the task sort.
        expect(body).not.toMatch(/getTaskSort/);
        expect(body).toMatch(/toDoInput\.value/);
    });

    it('dragDrop no longer bails the whole touch handler on isDraggable alone', () => {
        const dragDrop = read('dragDrop.js');
        // The old unconditional gate is gone…
        expect(dragDrop).not.toMatch(/touchstart[\s\S]{0,200}if\s*\(\s*!cfg\.isDraggable\(\)\s*\)\s*return;/);
        // …replaced by separate canDrag / canSwipe eligibility, with the arm
        // timer scheduled only when the row is actually draggable.
        expect(dragDrop).toMatch(/canSwipe/);
        expect(dragDrop).toMatch(/armTimer:\s*canDrag\s*\?/);
    });
});
