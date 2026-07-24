import { describe, it, expect } from 'vitest';

// Regression: the description panel's manifest file picker duplicated on every
// reopen. `#descSibling` is a persistent per-row node — wireDescToggle's close
// branch removes it from #mainList but never clears its children — while
// mountDescFilePicker calls createFilePicker, which builds a FRESH trigger +
// panel on every call. Without a cleanup step each reopen left the previous
// pair in place, stacking a second (then third) picker beside it.
//
// mountDescFilePicker is the exact unit wireDescToggle invokes on each open, so
// calling it repeatedly against one persistent descSibling (with descInput as a
// child, matching the open branch's mount order) faithfully reproduces open →
// close → reopen. The fix removes any existing .filePickTrigger / .filePickPanel
// before mounting the new pair, so the count stays at exactly one across cycles.

import { mountDescFilePicker } from '../src/toDoRow.js';

// A persistent panel + textarea, matching the nodes wireDescToggle keeps per row.
function makePanel() {
    const descSibling = document.createElement('div');
    descSibling.id = 'descSibling';
    const descInput = document.createElement('textarea');
    descInput.id = 'descInput';
    // wireDescToggle appends descInput before calling mountDescFilePicker, and the
    // picker inserts its trigger before descInput — so descInput must already be a
    // child of the panel for the insertBefore to resolve.
    descSibling.appendChild(descInput);
    return { descSibling, descInput };
}

describe('description panel file picker — idempotent across reopens', () => {
    it('mounts exactly one trigger and one panel no matter how many times a row is reopened', () => {
        const { descSibling, descInput } = makePanel();
        // A project with no linked repo keeps the picker hidden but still mounts
        // its trigger + panel nodes — the duplication is a DOM-count defect
        // independent of whether the picker is visible.
        const item = { id: 't1', desc: 'body' };

        for (let cycle = 1; cycle <= 3; cycle++) {
            // Each cycle re-appends descInput (wireDescToggle moves it back into
            // the panel) then remounts the picker — exactly one reopen.
            descSibling.appendChild(descInput);
            mountDescFilePicker(descSibling, descInput, item, '__no_such_project__', null);

            expect(descSibling.querySelectorAll('.filePickTrigger')).toHaveLength(1);
            expect(descSibling.querySelectorAll('.filePickPanel')).toHaveLength(1);
        }
    });

    it('reopens the picker collapsed with an empty filter rather than in its prior state', () => {
        const { descSibling, descInput } = makePanel();
        const item = { id: 't2', desc: '' };

        mountDescFilePicker(descSibling, descInput, item, '__no_such_project__', null);
        // Leave the first picker "open" by un-hiding its panel and typing a filter.
        const firstPanel = descSibling.querySelector('.filePickPanel');
        firstPanel.hidden = false;
        const firstSearch = firstPanel.querySelector('.filePickSearch');
        firstSearch.value = 'stale query';

        // Reopen: the old pair is discarded and a fresh one mounts.
        descSibling.appendChild(descInput);
        mountDescFilePicker(descSibling, descInput, item, '__no_such_project__', null);

        const panel = descSibling.querySelector('.filePickPanel');
        expect(panel).not.toBe(firstPanel);
        expect(panel.hidden).toBe(true);
        expect(panel.querySelector('.filePickSearch').value).toBe('');
    });
});
