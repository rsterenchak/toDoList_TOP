import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';

import {
    applyAuthoringMode,
    mountAuthoringModeStrip,
    syncGenerateBody,
    applyPhaseLayout,
    DESC_PANEL_CHILD_SELECTORS,
} from '../src/toDoRow.js';
import { recognizedEntryFields } from '../src/entryParse.js';
import { PHASE } from '../src/phase.js';

// The desktop description panel's WRITE / PASTE / GENERATE authoring mode strip.
// The strip + its two mode bodies mount into #descSibling; the mode is transient
// view state reset to WRITE on every open. Where the behaviour is exercised by a
// pure helper we assert it directly; the heavily-wired mount path is source-pinned
// (buildToDoRow is too wired to instantiate — see the row-layer test caveat).

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

// Build a panel with the entry-region controls the strip switches between, then
// mount the strip + mode bodies the way wireDescToggle does on open.
function makePanel(item) {
    const descSibling = document.createElement('div');
    descSibling.id = 'descSibling';

    const label = document.createElement('span');
    label.className = 'descSiblingEntryLabel';
    descSibling.appendChild(label);

    const trigger = document.createElement('button');
    trigger.className = 'filePickTrigger';
    descSibling.appendChild(trigger);

    const descInput = document.createElement('textarea');
    descInput.id = 'descInput';
    descSibling.appendChild(descInput);

    const panel = document.createElement('div');
    panel.className = 'filePickPanel';
    descSibling.appendChild(panel);

    const generateBtn = document.createElement('button');
    generateBtn.className = 'generateBtn';
    descSibling.appendChild(generateBtn);

    mountAuthoringModeStrip(descSibling, descInput, item, '', null, generateBtn);
    return { descSibling, descInput, trigger, panel, generateBtn };
}

describe('authoring mode strip — mount + defaults', () => {
    beforeEach(() => { document.body.innerHTML = ''; });

    it('defaults to WRITE on every open', () => {
        const { descSibling } = makePanel({ id: 't1' });
        expect(descSibling.dataset.authorMode).toBe('write');
    });

    it('mounts exactly one strip and one of each mode body, even mounted twice', () => {
        const item = { id: 't1' };
        const { descSibling, descInput, generateBtn } = makePanel(item);
        // Re-open: #descSibling children survive close, so a second mount must not
        // stack duplicates.
        mountAuthoringModeStrip(descSibling, descInput, item, '', null, generateBtn);
        expect(descSibling.querySelectorAll('.descModeStrip')).toHaveLength(1);
        expect(descSibling.querySelectorAll('.descPasteBody')).toHaveLength(1);
        expect(descSibling.querySelectorAll('.descGenerateBody')).toHaveLength(1);
    });

    it('leads the entry region — the strip sits after THE ENTRY label, before the textarea', () => {
        const { descSibling } = makePanel({ id: 't1' });
        const order = [...descSibling.children].map((el) => el.className || el.id);
        const stripIdx = order.findIndex((c) => c.includes('descModeStrip'));
        const labelIdx = order.findIndex((c) => c.includes('descSiblingEntryLabel'));
        const inputIdx = order.indexOf('descInput');
        expect(stripIdx).toBeGreaterThan(labelIdx);
        expect(stripIdx).toBeLessThan(inputIdx);
    });
});

describe('authoring mode strip — mode switching visibility', () => {
    it('WRITE shows the textarea + picker trigger + Generate, hides both mode bodies', () => {
        const { descSibling, descInput, trigger, generateBtn } = makePanel({ id: 't1' });
        applyAuthoringMode(descSibling, 'write');
        expect(descInput.hidden).toBe(false);
        expect(trigger.hidden).toBe(false);
        expect(generateBtn.hidden).toBe(false);
        expect(descSibling.querySelector('.descPasteBody').hidden).toBe(true);
        expect(descSibling.querySelector('.descGenerateBody').hidden).toBe(true);
        // The active segment reads WRITE.
        expect(descSibling.querySelector('.descModeStripSeg.is-active').getAttribute('data-mode')).toBe('write');
    });

    it('PASTE shows the paste body only; textarea, picker, Generate hidden', () => {
        const { descSibling, descInput, trigger, generateBtn } = makePanel({ id: 't1' });
        applyAuthoringMode(descSibling, 'paste');
        expect(descInput.hidden).toBe(true);
        expect(trigger.hidden).toBe(true);
        expect(generateBtn.hidden).toBe(true);
        expect(descSibling.querySelector('.descPasteBody').hidden).toBe(false);
        expect(descSibling.querySelector('.descGenerateBody').hidden).toBe(true);
    });

    it('GENERATE shows the generate body only; textarea, picker, Generate hidden', () => {
        const { descSibling, descInput, trigger, generateBtn } = makePanel({ id: 't1' });
        applyAuthoringMode(descSibling, 'generate');
        expect(descInput.hidden).toBe(true);
        expect(trigger.hidden).toBe(true);
        expect(generateBtn.hidden).toBe(true);
        expect(descSibling.querySelector('.descPasteBody').hidden).toBe(true);
        expect(descSibling.querySelector('.descGenerateBody').hidden).toBe(false);
    });

    it('switching modes never discards the entry text', () => {
        const { descSibling, descInput } = makePanel({ id: 't1' });
        descInput.value = 'a draft I am still writing';
        applyAuthoringMode(descSibling, 'paste');
        applyAuthoringMode(descSibling, 'generate');
        applyAuthoringMode(descSibling, 'write');
        expect(descInput.value).toBe('a draft I am still writing');
    });

    it('an unknown mode falls back to WRITE', () => {
        const { descSibling, descInput } = makePanel({ id: 't1' });
        applyAuthoringMode(descSibling, 'nonsense');
        expect(descSibling.dataset.authorMode).toBe('write');
        expect(descInput.hidden).toBe(false);
    });

    it('is a no-op guard on a null panel', () => {
        expect(() => applyAuthoringMode(null, 'paste')).not.toThrow();
    });
});

describe('authoring mode strip — done phase hides strip and both bodies', () => {
    it('applyPhaseLayout hides the strip + paste + generate bodies in `done`', () => {
        const { descSibling } = makePanel({ id: 't1' });
        applyPhaseLayout(descSibling, PHASE.DONE);
        expect(descSibling.querySelector('.descModeStrip').hidden).toBe(true);
        expect(descSibling.querySelector('.descPasteBody').hidden).toBe(true);
        expect(descSibling.querySelector('.descGenerateBody').hidden).toBe(true);
    });

    it('a non-terminal phase un-hides the strip; the mode controller then re-hides inactive bodies', () => {
        const { descSibling } = makePanel({ id: 't1' });
        applyPhaseLayout(descSibling, PHASE.DONE);
        // Leaving `done`: the phase gate un-hides the whole group, then the mode
        // controller re-hides the two inactive-mode bodies (WRITE active).
        applyPhaseLayout(descSibling, PHASE.ACCEPT);
        applyAuthoringMode(descSibling, descSibling.dataset.authorMode || 'write');
        expect(descSibling.querySelector('.descModeStrip').hidden).toBe(false);
        expect(descSibling.querySelector('#descInput').hidden).toBe(false);
        expect(descSibling.querySelector('.descPasteBody').hidden).toBe(true);
        expect(descSibling.querySelector('.descGenerateBody').hidden).toBe(true);
    });
});

describe('authoring mode strip — PASTE writes into the OPEN task, never a new one', () => {
    beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); });

    it('parses a pasted entry into the open item\'s description and returns to WRITE', () => {
        const item = { id: 't1', desc: '' };
        const { descSibling, descInput } = makePanel(item);
        applyAuthoringMode(descSibling, 'paste');

        const pasted = '- [ ] **[HIGH]** Fix the thing\n  - Type: feature\n  - Description: do it\n  - File: a.js';
        descSibling.querySelector('.descPasteInput').value = pasted;
        descSibling.querySelector('.descPasteParse').dispatchEvent(new MouseEvent('click', { bubbles: true }));

        // The parse wrote the verbatim entry into THIS item (the open task), and
        // mirrored it into the live textarea.
        expect(item.desc).toBe(pasted);
        expect(descInput.value).toBe(pasted);
        // It reported the recognised fields and returned the strip to WRITE.
        const report = descSibling.querySelector('.descPasteReport');
        expect(report.hidden).toBe(false);
        expect(report.textContent).toMatch(/Recognised:/);
        expect(descSibling.dataset.authorMode).toBe('write');
    });

    it('guards the empty paste — reports rather than writing an empty entry', () => {
        const item = { id: 't1', desc: 'existing' };
        const { descSibling } = makePanel(item);
        applyAuthoringMode(descSibling, 'paste');
        descSibling.querySelector('.descPasteInput').value = '   \n  ';
        descSibling.querySelector('.descPasteParse').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(item.desc).toBe('existing');
        // Stays in PASTE so the user can correct the paste.
        expect(descSibling.dataset.authorMode).toBe('paste');
    });
});

describe('authoring mode strip — GENERATE reflects the linked queue-row state', () => {
    it('renders the idle explanation + a dispatch action when no run is live', () => {
        const item = { id: 'no-such-row' };
        const { descSibling } = makePanel(item);
        applyAuthoringMode(descSibling, 'generate');
        syncGenerateBody(descSibling, item, '');
        const action = descSibling.querySelector('.descGenerateAction');
        expect(action.getAttribute('data-action')).toBe('dispatch');
        expect(action.textContent).toBe('Generate');
        expect(descSibling.querySelector('.descGenerateState').textContent).toMatch(/draft an entry/i);
    });

    it('the dispatch action reuses the panel\'s existing Generate trigger (no second trigger)', () => {
        const item = { id: 'no-such-row' };
        const { descSibling, generateBtn } = makePanel(item);
        let clicks = 0;
        generateBtn.addEventListener('click', () => { clicks += 1; });
        applyAuthoringMode(descSibling, 'generate');
        syncGenerateBody(descSibling, item, '');
        descSibling.querySelector('.descGenerateAction').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(clicks).toBe(1);
    });
});

describe('recognizedEntryFields — field-presence report (reuses parsePastedEntry)', () => {
    it('reports the labelled fields a pasted entry carries', () => {
        const raw = '- [ ] **[MEDIUM]** Title\n  - Type: feature\n  - Description: x\n  - File: y.js\n  <!-- id: abc -->';
        expect(recognizedEntryFields(raw)).toEqual(['title', 'priority', 'type', 'description', 'file', 'marker id']);
    });
    it('reports an empty list for blank input', () => {
        expect(recognizedEntryFields('')).toEqual([]);
    });
    it('falls back to a bare title when there is no checkbox headline', () => {
        expect(recognizedEntryFields('just a rough note')).toEqual(['title']);
    });
});

describe('authoring mode strip — source contracts', () => {
    const toDoRow = read('toDoRow.js');
    const css = read('style.css');

    it('registers the strip + both bodies in the panel-child grid contract', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descModeStrip');
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descPasteBody');
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descGenerateBody');
    });

    it('puts the strip + bodies in the authoring group hidden in `done`', () => {
        const start = toDoRow.indexOf('DESC_AUTHORING_GROUP_SELECTORS = Object.freeze([');
        const group = toDoRow.slice(start, toDoRow.indexOf('])', start));
        expect(group).toMatch(/descModeStrip/);
        expect(group).toMatch(/descPasteBody/);
        expect(group).toMatch(/descGenerateBody/);
    });

    it('PASTE reuses the shared parser and never creates a task via commitEntryToActiveProject', () => {
        expect(toDoRow).toMatch(/parsePastedEntry\(raw\)/);
        // It must not CALL or IMPORT the compose-row's task-creating commit.
        expect(toDoRow).not.toMatch(/commitEntryToActiveProject\(/);
        expect(toDoRow).not.toMatch(/import[^;]*commitEntryToActiveProject/);
    });

    it('builds the strip from the shared module rather than a second implementation', () => {
        expect(toDoRow).toMatch(/from '\.\/authoringModeStrip\.js'/);
    });

    it('re-asserts [hidden] display:none for the strip + bodies (author display outranks UA)', () => {
        expect(css).toMatch(/#descSibling \.descModeStrip\[hidden\]/);
        expect(css).toMatch(/#descSibling \.descPasteBody\[hidden\]/);
        expect(css).toMatch(/#descSibling \.descGenerateBody\[hidden\]/);
    });

    it('mounts the strip on open AND re-applies the mode on the live sweep', () => {
        // One mount call in wireDescToggle, plus applyAuthoringMode at the mount
        // path and the live-refresh sweep.
        expect((toDoRow.match(/mountAuthoringModeStrip\(/g) || []).length).toBeGreaterThanOrEqual(2);
        expect((toDoRow.match(/applyAuthoringMode\(/g) || []).length).toBeGreaterThanOrEqual(4);
    });
});
