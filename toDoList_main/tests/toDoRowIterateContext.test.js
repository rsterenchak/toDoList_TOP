import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { buildIterateContextBlock, buildReviewActions } from '../src/toDoRow.js';

// The ACCEPT-face "Copy context" control assembles a plain-text block for iterating
// on a shipped change in an outside conversation and copies it to the clipboard.
// buildIterateContextBlock is a pure assembler (repo + queue row passed in), so its
// content is asserted directly; the control's clipboard fallback and its
// desktop-pane-only mounting are exercised through buildReviewActions.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');
const toDoRow = read('toDoRow.js');

const MARKER = '<!-- id: 4b179cbf-3678-4c8b-90af-abc123def456 -->';
const ENTRY_DESC = [
    '- [ ] **[MEDIUM]** Add a widget',
    '  - Type: feature',
    '  - Description: does a thing',
    '  - File: `src/a.js`, `src/b.js`',
    '  ' + MARKER,
].join('\n');

function makeItem(overrides) {
    return Object.assign({
        id: 't1',
        tit: 'Add a widget',
        entryId: '4b179cbf-3678-4c8b-90af-abc123def456',
        desc: ENTRY_DESC,
    }, overrides || {});
}

describe('buildIterateContextBlock — content assembly', () => {
    it('includes every present field in order (repo, entry, PR, files, entry text, placeholder)', () => {
        const block = buildIterateContextBlock(
            makeItem(),
            { pr_number: 42, pr_url: 'https://github.com/o/r/pull/42' },
            'rsterenchak/toDoList_TOP'
        );
        expect(block).toContain('Iterating on a shipped change in rsterenchak/toDoList_TOP.');
        expect(block).toContain('ENTRY 4b179cbf-3678-4c8b-90af-abc123def456');
        expect(block).toContain('PR #42 — https://github.com/o/r/pull/42');
        expect(block).toContain('FILES src/a.js, src/b.js');
        expect(block).toContain('--- the entry as shipped ---');
        expect(block).toContain('--- what I want changed ---');
        // Ordering: the frame line precedes the entry which precedes the placeholder.
        expect(block.indexOf('Iterating on a shipped change'))
            .toBeLessThan(block.indexOf('--- the entry as shipped ---'));
        expect(block.indexOf('--- the entry as shipped ---'))
            .toBeLessThan(block.indexOf('--- what I want changed ---'));
    });

    it('copies the entry text VERBATIM including its trailing marker comment', () => {
        const block = buildIterateContextBlock(makeItem(), null, 'o/r');
        expect(block).toContain(ENTRY_DESC);
        expect(block).toContain(MARKER);
    });

    it('omits the PR line entirely when the row carries neither number nor url', () => {
        const block = buildIterateContextBlock(makeItem(), null, 'o/r');
        expect(block).not.toMatch(/\bPR /);
    });

    it('renders a PR line with just the number when only the number is present', () => {
        const block = buildIterateContextBlock(makeItem(), { pr_number: 7 }, 'o/r');
        expect(block).toContain('PR #7');
        expect(block).not.toContain('—');
    });

    it('omits the FILES line when the entry names no File: line', () => {
        const item = makeItem({ desc: '- [ ] Add a widget\n  - Type: feature\n  ' + MARKER });
        const block = buildIterateContextBlock(item, null, 'o/r');
        expect(block).not.toMatch(/\bFILES /);
        // The placeholder is the point of the block and is never omitted.
        expect(block).toContain('--- what I want changed ---');
    });

    it('always ends with a non-empty placeholder line prompting the desired change', () => {
        const block = buildIterateContextBlock(makeItem(), null, 'o/r');
        const after = block.slice(block.indexOf('--- what I want changed ---') + '--- what I want changed ---'.length);
        expect(after.trim().length).toBeGreaterThan(0);
    });
});

describe('Copy context control — mounting and clipboard', () => {
    let priorClipboard;
    let priorExec;

    beforeEach(() => {
        priorClipboard = navigator.clipboard;
        priorExec = document.execCommand;
    });

    afterEach(() => {
        Object.defineProperty(navigator, 'clipboard', { value: priorClipboard, configurable: true });
        document.execCommand = priorExec;
        const toast = document.getElementById('todoRowToast');
        if (toast && toast.parentNode) toast.parentNode.removeChild(toast);
    });

    it('mounts the ghost Copy context button on the desktop pane host (no modal callback)', () => {
        const actions = buildReviewActions(makeItem(), 'Proj');
        const btn = actions.querySelector('.descReviewBtn--copyctx');
        expect(btn).not.toBeNull();
        expect(btn.textContent).toMatch(/copy context/i);
    });

    it('does NOT mount Copy context on the mobile modal host (onOpenInViewer supplied)', () => {
        const actions = buildReviewActions(makeItem(), 'Proj', { onOpenInViewer: function () {} });
        expect(actions.querySelector('.descReviewBtn--copyctx')).toBeNull();
    });

    it('falls back to a temporary-element copy when the async clipboard write rejects', async () => {
        const writeText = vi.fn(() => Promise.reject(new Error('denied')));
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        const exec = vi.fn(() => true);
        document.execCommand = exec;

        const actions = buildReviewActions(makeItem(), 'Proj');
        document.body.appendChild(actions);
        const btn = actions.querySelector('.descReviewBtn--copyctx');
        btn.click();

        expect(writeText).toHaveBeenCalledTimes(1);
        // Let the rejected promise settle so the fallback runs.
        await Promise.resolve();
        await Promise.resolve();
        expect(exec).toHaveBeenCalledWith('copy');
        // Fails loudly with a toast rather than silently.
        expect(document.getElementById('todoRowToast')).not.toBeNull();

        document.body.removeChild(actions);
    });
});
