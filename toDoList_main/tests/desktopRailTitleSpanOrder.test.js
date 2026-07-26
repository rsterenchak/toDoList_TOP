import { describe, it, expect, beforeEach } from 'vitest';
import { buildToDoRow } from '../src/toDoRow.js';

// Regression guard for the desktop queue-rail title swap: the read-mode
// title span (#toDoTitleDisplay) and the edit-mode input (#toDoInput) must
// occupy the SAME position in the row so switching between them changes only
// which element is visible, never the row's left-to-right order.
//
// The bug: the span was appended at construction (before the input) and the
// checkbox / phase badge / status glyph were then inserted before the input,
// stranding the span ahead of the checkbox while the input stayed after the
// badge. On desktop, read mode rendered "title -> checkbox -> badge" and edit
// mode rendered "checkbox -> badge -> title", so focusing/blurring a row
// visibly reordered its contents.
//
// This is a DOM-order assertion (not a layout one), so it works in jsdom even
// though the media-query-driven visibility swap does not.

function buildRow(item) {
    // buildToDoRow wires drag handling against #mainList; give it a container
    // so setupRowDrag can resolve one.
    document.body.innerHTML = '<div id="mainList"></div>';
    return buildToDoRow(item, 'SpanOrderProj');
}

function childIndex(row, el) {
    return Array.prototype.indexOf.call(row.children, el);
}

describe('desktop queue rail — title span shares the input position', () => {

    beforeEach(() => {
        document.body.innerHTML = '<div id="mainList"></div>';
    });

    it('committed row: the span sits immediately before the input', () => {
        const row = buildRow({ tit: 'A sufficiently long task title', status: 'active' });
        const span = row.querySelector('#toDoTitleDisplay');
        const input = row.querySelector('#toDoInput');
        expect(span).toBeTruthy();
        expect(input).toBeTruthy();
        // Adjacent siblings, span first.
        expect(span.nextElementSibling).toBe(input);
        // The span's index is exactly one before the input's.
        expect(childIndex(row, span)).toBe(childIndex(row, input) - 1);
    });

    it('committed row: checkbox, phase badge, and status glyph all precede the span', () => {
        // A review-status row surfaces a phase badge (.todoStatusLabel); the
        // status glyph (#descIndicator) and checkbox (#checkToDo) are always
        // present. All three are leading controls and must come before the
        // title slot so the read span lands after them, matching edit mode.
        const row = buildRow({ tit: 'Ships when reviewed', status: 'review' });
        const span = row.querySelector('#toDoTitleDisplay');
        const checkbox = row.querySelector('#checkToDo');
        const glyph = row.querySelector('#descIndicator');
        const badge = row.querySelector('.todoStatusLabel');
        const spanIdx = childIndex(row, span);
        expect(checkbox).toBeTruthy();
        expect(glyph).toBeTruthy();
        expect(badge).toBeTruthy();
        expect(childIndex(row, checkbox)).toBeLessThan(spanIdx);
        expect(childIndex(row, badge)).toBeLessThan(spanIdx);
        expect(childIndex(row, glyph)).toBeLessThan(spanIdx);
    });

    it('blank placeholder row: the span still sits immediately before the input', () => {
        // Blank rows carry no phase badge, but the span must still be adjacent
        // to the input so a freshly committed row does not reorder.
        const row = buildRow({ tit: '' });
        const span = row.querySelector('#toDoTitleDisplay');
        const input = row.querySelector('#toDoInput');
        expect(span.nextElementSibling).toBe(input);
        expect(childIndex(row, span)).toBe(childIndex(row, input) - 1);
    });
});
