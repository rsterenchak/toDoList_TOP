import { describe, it, expect } from 'vitest';

import { extractEntryDescription, applyPhaseLayout } from '../src/toDoRow.js';
import { PHASE } from '../src/phase.js';

// The WHAT CHANGED card used to render `item.desc` verbatim, but that field holds
// the ENTIRE entry (headline, Type, Description, Implementation notes, Out of
// scope, File, Completed, marker) — so the card dumped the whole entry and the
// authoring textarea below repeated it. extractEntryDescription pulls ONLY the
// `- Description:` sub-bullet for the summary, and applyPhaseLayout now hides the
// authoring group in `accept` (as it already does in `done`).

// A realistic full entry blob, exactly the shape item.desc holds after an inject.
const FULL_ENTRY = [
    '- [ ] **[MEDIUM]** Trim the summary',
    '  - Type: bug',
    '  - Description: The card dumps the full entry text instead of a short summary.',
    '  - Implementation notes:',
    '    - Parse only the Description line.',
    '  - Out of scope: The decision actions.',
    '  - File: toDoList_main/src/toDoRow.js',
    '  <!-- id: abc-123 -->',
].join('\n');

describe('extractEntryDescription — summary is the Description line only', () => {
    it('returns only the Description text, not the surrounding entry', () => {
        const out = extractEntryDescription(FULL_ENTRY);
        expect(out).toBe('The card dumps the full entry text instead of a short summary.');
    });

    it('never leaks the other sub-bullets into the summary', () => {
        const out = extractEntryDescription(FULL_ENTRY);
        expect(out).not.toMatch(/Type:/);
        expect(out).not.toMatch(/Implementation notes/);
        expect(out).not.toMatch(/Out of scope/);
        expect(out).not.toMatch(/File:/);
        expect(out).not.toMatch(/<!-- id:/);
    });

    it('folds a wrapped multi-line Description into one paragraph', () => {
        const wrapped = [
            '  - Description: This description is long enough that it',
            '    wraps across several physical lines in the entry',
            '    before the next sub-bullet begins.',
            '  - File: a.js',
        ].join('\n');
        expect(extractEntryDescription(wrapped)).toBe(
            'This description is long enough that it wraps across several physical lines in the entry before the next sub-bullet begins.'
        );
    });

    it('tolerates leading whitespace and no bullet marker', () => {
        expect(extractEntryDescription('Description: bare line')).toBe('bare line');
        expect(extractEntryDescription('    Description:   spaced   value  ')).toBe('spaced value');
    });

    it('returns empty when the entry has no Description line (summary omitted)', () => {
        const noDesc = '- [ ] Title only\n  - Type: bug\n  - File: a.js';
        expect(extractEntryDescription(noDesc)).toBe('');
    });

    it('returns empty for null / undefined / empty input', () => {
        expect(extractEntryDescription(null)).toBe('');
        expect(extractEntryDescription(undefined)).toBe('');
        expect(extractEntryDescription('')).toBe('');
    });
});

describe('applyPhaseLayout — authoring group hidden in accept as well as done', () => {
    function makePanel() {
        const panel = document.createElement('div');
        panel.id = 'descSibling';
        ['descInput'].forEach((id) => {
            const t = document.createElement('textarea');
            t.id = id;
            panel.appendChild(t);
        });
        [
            'filePickTrigger', 'filePickPanel', 'generateBtn', 'generateFailure',
            'injectBtn', 'descModeStrip', 'descPasteBody', 'descGenerateBody',
            'descSiblingEntryLabel',
        ].forEach((cls) => {
            const el = document.createElement('div');
            el.className = cls;
            panel.appendChild(el);
        });
        return panel;
    }

    it('hides the entry textarea, mode strip, and Inject in the accept phase', () => {
        const panel = makePanel();
        applyPhaseLayout(panel, PHASE.ACCEPT);
        expect(panel.querySelector('#descInput').hidden).toBe(true);
        expect(panel.querySelector('.descModeStrip').hidden).toBe(true);
        expect(panel.querySelector('.injectBtn').hidden).toBe(true);
        expect(panel.querySelector('.descSiblingEntryLabel').hidden).toBe(true);
    });

    it('shows the authoring group again in a non-terminal phase', () => {
        const panel = makePanel();
        applyPhaseLayout(panel, PHASE.ACCEPT);
        applyPhaseLayout(panel, PHASE.DRAFT);
        expect(panel.querySelector('#descInput').hidden).toBe(false);
        expect(panel.querySelector('.injectBtn').hidden).toBe(false);
    });
});
