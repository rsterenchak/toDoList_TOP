import { describe, it, expect, beforeEach } from 'vitest';
import { buildToDoRow } from '../src/toDoRow.js';
import { listLogic } from '../src/listLogic.js';

// The blank placeholder row's `+` is a keyboardless commit: on the iPhone PWA a
// dictated title lands in #toDoInput after recognition ends, and iOS won't
// reopen the keyboard to press Enter. Once the input holds text the glyph arms
// (data-armed="true") and a tap dispatches the same Enter the mic's onFinal
// does, so the commit runs through the existing Enter handler.

let projectSeq = 0;

function buildPlaceholderRow() {
    const project = 'AddGlyphProj' + (++projectSeq);
    listLogic.addProject(project);
    listLogic.addToDo(project, '');
    const blank = listLogic.listItems(project).filter(function(i) { return !i.tit; }).pop();
    const row = buildToDoRow(blank, project);
    document.getElementById('mainList').appendChild(row);
    return { row: row, item: blank };
}

function typeInto(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('placeholder row `+` arms into a tap-to-add button', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '<div id="mainList"></div>';
    });

    it('is a native button labelled "Add task" on blank rows, unarmed while empty', () => {
        const { row } = buildPlaceholderRow();
        const glyph = row.querySelector('#addGlyph');
        expect(glyph.tagName).toBe('BUTTON');
        expect(glyph.getAttribute('type')).toBe('button');
        expect(glyph.getAttribute('aria-label')).toBe('Add task');
        expect(glyph.hasAttribute('data-armed')).toBe(false);
        expect(glyph.getAttribute('aria-hidden')).toBe('true');
    });

    it('arms after an input event with text and disarms once cleared', () => {
        const { row } = buildPlaceholderRow();
        const glyph = row.querySelector('#addGlyph');
        const input = row.querySelector('#toDoInput');
        typeInto(input, 'Buy milk');
        expect(glyph.getAttribute('data-armed')).toBe('true');
        expect(glyph.hasAttribute('aria-hidden')).toBe(false);
        typeInto(input, '   ');
        expect(glyph.hasAttribute('data-armed')).toBe(false);
        expect(glyph.getAttribute('aria-hidden')).toBe('true');
    });

    it('tapping it while armed dispatches Enter on #toDoInput and commits the row', () => {
        const { row, item } = buildPlaceholderRow();
        const glyph = row.querySelector('#addGlyph');
        const input = row.querySelector('#toDoInput');
        const keys = [];
        input.addEventListener('keydown', function(e) { keys.push(e.key); });
        let rowClicks = 0;
        row.addEventListener('click', function() { rowClicks++; });
        typeInto(input, 'Dictated todo');
        glyph.click();
        expect(keys).toEqual(['Enter']);
        expect(item.tit).toBe('Dictated todo');
        // The row commits — the blank-row cue is stripped and the click
        // never reached the row's own handler.
        expect(row.querySelector('#addGlyph')).toBeNull();
        expect(rowClicks).toBe(0);
    });

    it('tapping it while unarmed does nothing', () => {
        const { row, item } = buildPlaceholderRow();
        const glyph = row.querySelector('#addGlyph');
        const input = row.querySelector('#toDoInput');
        const keys = [];
        input.addEventListener('keydown', function(e) { keys.push(e.key); });
        glyph.click();
        expect(keys).toEqual([]);
        expect(item.tit).toBe('');
        expect(row.querySelector('#addGlyph')).toBe(glyph);
    });
});
