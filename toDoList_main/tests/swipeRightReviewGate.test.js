import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Swipe-right on a committed row completes it. A row still awaiting REVIEW
// (its shipped entry is unacknowledged — `derivePhase(item) === PHASE.ACCEPT`,
// the amber `⌁ REVIEW` badge) must NOT complete that way: the task would drop
// into the completed section before anyone had read what the agent shipped for
// it. The swipe routes to the shared review-badge entry point instead, opening
// the project's TODO.md viewer anchored to the entry.
//
// Driven behaviorally rather than by source inspection: `attachToDoDrag` is
// exported and the swipe config it hands `setupRowDrag` is the exact object the
// touch layer calls, so stubbing `setupRowDrag` captures the real handler and
// invoking it exercises the real gate.

const captured = { cfg: null };

vi.mock('../src/dragDrop.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        setupRowDrag: (row, cfg) => { captured.cfg = cfg; },
    };
});

const { attachToDoDrag } = await import('../src/toDoRow.js');
const { setReviewBadgeTapHandler } = await import('../src/todoStatus.js');
const { derivePhase, PHASE } = await import('../src/phase.js');

// Build a minimal committed row and wire the swipe handlers onto it, returning
// everything an assertion needs. `item` is spread onto a shipped-task shape so a
// caller only has to name the fields that decide the phase.
function wireRow(item) {
    document.body.innerHTML = '<div id="mainList"></div>';
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.dataset.value = 'Inbox';
    row.__item = item;
    document.getElementById('mainList').appendChild(row);

    const input = document.createElement('input');
    input.id = 'toDoInput';
    input.value = item.tit;

    const checkToDo = document.createElement('input');
    checkToDo.type = 'checkbox';
    const closeButtonToDo = document.createElement('button');

    const changes = [];
    checkToDo.addEventListener('change', () => { changes.push(checkToDo.checked); });

    attachToDoDrag(row, input, 'Inbox', { checkToDo, closeButtonToDo, item });
    return { row, checkToDo, changes };
}

describe('swipe-to-complete is gated on the REVIEW phase', () => {
    let taps;
    let flashes;
    const onFlash = () => { flashes.push(true); };

    beforeEach(() => {
        captured.cfg = null;
        taps = [];
        flashes = [];
        setReviewBadgeTapHandler((entryId, projectName) => {
            taps.push({ entryId, projectName });
        });
        document.addEventListener('todoSwipeRightComplete', onFlash);
    });

    afterEach(() => {
        document.removeEventListener('todoSwipeRightComplete', onFlash);
        setReviewBadgeTapHandler(null);
    });

    it('a shipped-but-unacknowledged item really is in PHASE.ACCEPT', () => {
        // Pins the fixture's premise so the gate tests below can never pass
        // vacuously against an item that resolves to some other phase.
        const item = { id: 'task-1', entryId: 'entry-1', tit: 'Ship it', shippedAt: '2026-08-27T00:00:00Z' };
        expect(derivePhase(item)).toBe(PHASE.ACCEPT);
    });

    it('does not check off a row awaiting REVIEW, and fires no completion flash', () => {
        const item = { id: 'task-1', entryId: 'entry-1', tit: 'Ship it', shippedAt: '2026-08-27T00:00:00Z' };
        const { checkToDo, changes } = wireRow(item);

        captured.cfg.swipe.onRight();

        expect(checkToDo.checked).toBe(false);
        expect(changes).toEqual([]);
        expect(flashes).toEqual([]);
    });

    it('routes the swipe to the review-badge handler with the entry id and live project name', () => {
        const item = { id: 'task-1', entryId: 'entry-1', tit: 'Ship it', shippedAt: '2026-08-27T00:00:00Z' };
        const { row } = wireRow(item);
        // The row's data-value is the live project name — the closed-over one
        // can be stale after a project switch.
        row.dataset.value = 'Renamed';

        captured.cfg.swipe.onRight();

        expect(taps).toEqual([{ entryId: 'entry-1', projectName: 'Renamed' }]);
    });

    it('completes normally once the entry has been acknowledged (PHASE.DONE)', () => {
        const item = {
            id: 'task-2',
            entryId: 'entry-2',
            tit: 'Ship it',
            shippedAt: '2026-08-27T00:00:00Z',
            entryReviewedAt: '2026-08-27T01:00:00Z',
        };
        expect(derivePhase(item)).toBe(PHASE.DONE);
        const { checkToDo, changes } = wireRow(item);

        captured.cfg.swipe.onRight();

        expect(checkToDo.checked).toBe(true);
        expect(changes).toEqual([true]);
        expect(flashes.length).toBe(1);
        expect(taps).toEqual([]);
    });

    it('completes normally on an ordinary row with no pipeline entry at all', () => {
        const item = { id: 'task-3', tit: 'Plain todo' };
        expect(derivePhase(item)).toBe(PHASE.NONE);
        const { checkToDo, changes } = wireRow(item);

        captured.cfg.swipe.onRight();

        expect(checkToDo.checked).toBe(true);
        expect(changes).toEqual([true]);
        expect(flashes.length).toBe(1);
        expect(taps).toEqual([]);
    });

    it('leaves swipe-to-delete armed and ungated on a row awaiting REVIEW', () => {
        // Out of scope for the gate: only the completion path is blocked.
        const item = { id: 'task-4', entryId: 'entry-4', tit: 'Ship it', shippedAt: '2026-08-27T00:00:00Z' };
        wireRow(item);
        expect(typeof captured.cfg.swipe.onLeft).toBe('function');
        expect(captured.cfg.isSwipeable()).toBe(true);
    });
});
