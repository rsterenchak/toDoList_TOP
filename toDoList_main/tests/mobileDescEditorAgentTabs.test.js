import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { showDescEditorModal } from '../src/modals.js';
import { setQueueRows } from '../src/agentQueueStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Regression: on phones #descEditorModal outgrew the visible screen whenever it
// hosted agent blocks — its 86vh / 92vh caps ignored mobile browser chrome, and
// the stacked blocks plus the textarea floor overflowed one shared body. The
// modal now caps itself against the dynamic viewport and splits the body into a
// "Notes" pane (THE ENTRY) and an "Agent" pane (the phase blocks), each its own
// scroll region, behind a tab bar that only shows while agent blocks exist.

function rule(selector) {
    const idx = css.indexOf(selector + ' {');
    expect(idx).toBeGreaterThan(-1);
    return css.slice(idx, css.indexOf('}', idx));
}

describe('mobile desc editor — dynamic-viewport height cap (CSS)', () => {
    it('sizes the dialog with min(560px, 100dvh - 36px) instead of a vh max-height', () => {
        const dialog = rule('#descEditorModal');
        expect(dialog).toMatch(/height:\s*min\(560px,\s*calc\(100dvh - 36px\)\)/);
        expect(dialog).not.toMatch(/max-height:\s*86vh/);
    });

    it('drops the phone-width 92vh override that ignored browser chrome', () => {
        expect(css).not.toMatch(/#descEditorModal\s*\{\s*max-height:\s*92vh/);
    });

    it('each pane is its own scroll region (flex: 1; min-height: 0; overflow-y: auto)', () => {
        const pane = rule('.descEditorModalPane');
        expect(pane).toMatch(/flex:\s*1\s*;/);
        expect(pane).toMatch(/min-height:\s*0/);
        expect(pane).toMatch(/overflow-y:\s*auto/);
    });

    it('agent buttons keep a 36px tap floor and their rows wrap', () => {
        expect(rule('#descEditorModalAgentPane button')).toMatch(/min-height:\s*36px/);
        expect(css).toMatch(/#descEditorModalAgentPane \.descDispatchActions,[\s\S]{0,400}flex-wrap:\s*wrap/);
    });
});

describe('mobile desc editor — Notes / Agent panes (runtime)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => {
        const closeX = document.getElementById('descEditorModalClose');
        if (closeX) closeX.click();
        document.body.innerHTML = '';
        setQueueRows([], undefined);
    });

    it('with no agent block the tabs and Agent pane hide and Notes holds the entry', () => {
        showDescEditorModal({ id: 'plain', tit: 'A task', desc: 'hello', status: 'active' }, { projectName: 'Work' });
        const notes = document.getElementById('descEditorModalNotesPane');
        expect(document.getElementById('descEditorModalTabs').hidden).toBe(true);
        expect(document.getElementById('descEditorModalAgentPane').hidden).toBe(true);
        expect(notes.hidden).toBe(false);
        expect(notes.contains(document.getElementById('descEditorModalTextarea'))).toBe(true);
    });

    it('a stuck task leads with the Agent tab, badges its block count, and switches panes on tap', () => {
        setQueueRows([{ id: 9, todo_id: 'blk', state: 'failed', entry_id: 'e9' }], 'Work');
        showDescEditorModal({ id: 'blk', tit: 'Broken task', desc: 'body', status: 'active' }, { projectName: 'Work' });

        const tabs = document.getElementById('descEditorModalTabs');
        const notesTab = document.getElementById('descEditorModalNotesTab');
        const agentTab = document.getElementById('descEditorModalAgentTab');
        const notes = document.getElementById('descEditorModalNotesPane');
        const agent = document.getElementById('descEditorModalAgentPane');

        expect(tabs.hidden).toBe(false);
        // STUCK card + its Retry block live in the Agent pane, not the Notes pane.
        expect(agent.querySelector('#descEditorModalStuck')).not.toBeNull();
        expect(agent.querySelector('.descDispatchBlock')).not.toBeNull();
        expect(notes.querySelector('#descEditorModalStuck')).toBeNull();
        expect(agentTab.querySelector('.descEditorModalTabBadge').textContent).toBe('2');
        expect(agentTab.getAttribute('aria-selected')).toBe('true');
        expect(agent.hidden).toBe(false);
        expect(notes.hidden).toBe(true);

        notesTab.click();
        expect(notesTab.getAttribute('aria-selected')).toBe('true');
        expect(notes.hidden).toBe(false);
        expect(agent.hidden).toBe(true);

        agentTab.click();
        expect(agent.hidden).toBe(false);
        expect(notes.hidden).toBe(true);
    });

    it('the actions container stays a dialog sibling outside the scrolling body', () => {
        setQueueRows([{ id: 9, todo_id: 'blk', state: 'failed', entry_id: 'e9' }], 'Work');
        showDescEditorModal({ id: 'blk', tit: 'Broken task', desc: 'body', status: 'active' }, { projectName: 'Work' });
        const body = document.getElementById('descEditorModalBody');
        const actions = document.getElementById('descEditorModalActions');
        expect(body.contains(actions)).toBe(false);
        expect(actions.parentElement.id).toBe('descEditorModal');
    });
});
