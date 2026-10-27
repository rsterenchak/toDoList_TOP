import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { showDescEditorModal } from '../src/modals.js';
import { setQueueRows, notifyQueueChange } from '../src/agentQueueStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// The mobile Agent tab stacked every phase block open, so the action rows
// overflowed the pane before any option was visible. Each mounted block now sits
// in a collapsible accordion section (modals.js syncAgentSections), opened by
// default only for the block that needs the user. The blocks are relocated, not
// rebuilt, so the tab badge count, the blocks' own controls, and section cleanup
// on unmount are pinned here.

function section(kind) {
    return document.querySelector('#descEditorModalAgentPane > [data-agent-section="' + kind + '"]');
}
function header(kind) { return section(kind).querySelector('.agentSectionHeader'); }
function body(kind) { return section(kind).querySelector('.agentSectionBody'); }

describe('mobile desc editor — Agent accordion sections (runtime)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => {
        const closeX = document.getElementById('descEditorModalClose');
        if (closeX) closeX.click();
        document.body.innerHTML = '';
        setQueueRows([], undefined);
    });

    it('wraps each mounted block in its own section, in order, with the badge count unchanged', () => {
        setQueueRows([{ id: 9, todo_id: 'blk', state: 'failed', entry_id: 'e9' }], 'Work');
        showDescEditorModal({ id: 'blk', tit: 'Broken task', desc: 'body', status: 'active' }, { projectName: 'Work' });

        const pane = document.getElementById('descEditorModalAgentPane');
        const kinds = Array.from(pane.children).map((el) => el.getAttribute('data-agent-section'));
        expect(kinds).toEqual(['stuck', 'dispatch']);
        expect(body('stuck').querySelector('#descEditorModalStuck')).not.toBeNull();
        expect(body('dispatch').querySelector('.descDispatchBlock')).not.toBeNull();
        expect(document.querySelector('#descEditorModalAgentTab .descEditorModalTabBadge').textContent).toBe('2');

        expect(section('stuck').querySelector('.agentSectionLabel').textContent).toBe('Stuck');
        expect(section('stuck').querySelector('.agentSectionStatus').textContent).toBe('Failed');
        expect(section('dispatch').querySelector('.agentSectionStatus').textContent).toBe('Retry');
    });

    it('opens only the section that needs the user, and the header toggles its body', () => {
        setQueueRows([{ id: 9, todo_id: 'blk', state: 'failed', entry_id: 'e9' }], 'Work');
        showDescEditorModal({ id: 'blk', tit: 'Broken task', desc: 'body', status: 'active' }, { projectName: 'Work' });

        expect(header('dispatch').getAttribute('aria-expanded')).toBe('true');
        expect(body('dispatch').hidden).toBe(false);
        expect(header('stuck').getAttribute('aria-expanded')).toBe('false');
        expect(body('stuck').hidden).toBe(true);
        expect(header('stuck').querySelector('.agentSectionChevron').textContent).toBe('▸');

        header('stuck').click();
        expect(header('stuck').getAttribute('aria-expanded')).toBe('true');
        expect(body('stuck').hidden).toBe(false);
        expect(header('stuck').querySelector('.agentSectionChevron').textContent).toBe('▾');

        header('dispatch').click();
        expect(body('dispatch').hidden).toBe(true);
    });

    it('keeps the user\'s expand/collapse choice across a repaint that adds no section', () => {
        setQueueRows([{ id: 9, todo_id: 'blk', state: 'failed', entry_id: 'e9' }], 'Work');
        showDescEditorModal({ id: 'blk', tit: 'Broken task', desc: 'body', status: 'active' }, { projectName: 'Work' });
        const retryBlock = body('dispatch').querySelector('.descDispatchBlock');
        header('stuck').click();
        header('dispatch').click();

        setQueueRows([{ id: 9, todo_id: 'blk', state: 'failed', entry_id: 'e9', failure_reason: 'boom' }], 'Work');
        notifyQueueChange();

        expect(body('stuck').hidden).toBe(false);
        expect(body('dispatch').hidden).toBe(true);
        // Same block node — moved once, never rebuilt by the section pass.
        expect(body('dispatch').querySelector('.descDispatchBlock')).toBe(retryBlock);
    });

    it('removes a section when its block unmounts, leaving no orphaned header', () => {
        setQueueRows([{ id: 9, todo_id: 'blk', state: 'failed', entry_id: 'e9' }], 'Work');
        showDescEditorModal({ id: 'blk', tit: 'Broken task', desc: 'body', status: 'active' }, { projectName: 'Work' });

        setQueueRows([{ id: 9, todo_id: 'blk', state: 'drafted', entry_id: 'e9' }], 'Work');
        notifyQueueChange();
        const pane = document.getElementById('descEditorModalAgentPane');
        expect(section('stuck')).toBeNull();
        expect(section('dispatch').querySelector('.agentSectionStatus').textContent).toBe('Ready');
        expect(pane.querySelectorAll('.agentSection').length).toBe(1);
        expect(document.querySelector('#descEditorModalAgentTab .descEditorModalTabBadge').textContent).toBe('1');

        setQueueRows([], 'Work');
        notifyQueueChange();
        expect(pane.querySelectorAll('.agentSection').length).toBe(0);
        expect(pane.children.length).toBe(0);
        expect(document.getElementById('descEditorModalTabs').hidden).toBe(true);
    });

    it('an asking task opens its Asking section with the answer field inside', () => {
        setQueueRows([{ id: 5, todo_id: 'ask', state: 'needs_words', question: 'Which page?' }], 'Work');
        showDescEditorModal({ id: 'ask', tit: 'Ask task', desc: 'body', status: 'active' }, { projectName: 'Work' });

        expect(header('asking').getAttribute('aria-expanded')).toBe('true');
        expect(section('asking').classList.contains('agentSection--needsUser')).toBe(true);
        expect(body('asking').querySelector('.askingBlock')).not.toBeNull();
    });
});

describe('mobile desc editor — Agent accordion sections (CSS)', () => {
    function rule(selector) {
        const idx = css.indexOf(selector + ' {');
        expect(idx).toBeGreaterThan(-1);
        return css.slice(idx, css.indexOf('}', idx));
    }

    it('headers keep the 36px tap floor with SpaceMono uppercase labels', () => {
        const h = rule('.agentSectionHeader');
        expect(h).toMatch(/min-height:\s*36px/);
        expect(h).toMatch(/SpaceMono/);
        expect(h).toMatch(/text-transform:\s*uppercase/);
    });

    it('a collapsed body is display: none and the status sits right-aligned', () => {
        expect(rule('.agentSectionBody[hidden]')).toMatch(/display:\s*none/);
        expect(rule('.agentSectionStatus')).toMatch(/margin-left:\s*auto/);
    });
});
