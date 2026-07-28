import { describe, it, expect, vi, beforeEach } from 'vitest';

// The A/B/C mockup renderer is shared by three hosts. Two use tiles (the Agent
// board's stacked full-width frames and the desktop detail pane's three-across
// scaled tiles); the mobile description-editor modal uses a TABBED layout instead —
// an OPTION A/B/C radiogroup above a SINGLE scaled preview, since three frames
// across at phone width are unreadable and stacking them would overflow the modal.
// These tests pin renderMockupTabs and the buildMockupSecondary({ tabbed: true })
// wiring that routes the modal to it, sharing generation / parsing / the Use path
// with the tile hosts rather than reimplementing them.
//
// mockupFlow imports inject.js; stub it so the named imports resolve without a
// network and chatWithWorker calls can be inspected.
let chatCalls = [];
let chatReply = '';

vi.mock('../src/inject.js', () => ({
    findTargetById: () => null,
    chatWithWorker: (messages, entryId, attach, repo) => {
        chatCalls.push({ messages, entryId, attach, repo });
        return Promise.resolve({ reply: chatReply });
    },
    showInjectToast: () => {},
}));

import { renderMockupTabs, buildMockupSecondary } from '../src/mockupFlow.js';
import { listLogic } from '../src/listLogic.js';

const VARIANTS = { A: '<p>Alpha</p>', B: '<p>Bravo</p>', C: '<p>Charlie</p>' };

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
    chatCalls = [];
    chatReply = '';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('renderMockupTabs — tabbed single-preview layout', () => {
    it('renders an OPTION A/B/C radiogroup above exactly ONE preview iframe', () => {
        const c = document.createElement('div');
        renderMockupTabs(c, VARIANTS, null);
        const tabs = c.querySelectorAll('.agentMockupTab');
        expect(tabs).toHaveLength(3);
        expect(Array.from(tabs).map((t) => t.textContent)).toEqual(['Option A', 'Option B', 'Option C']);
        // A single scaled preview — NOT three frames.
        expect(c.querySelectorAll('.agentMockupFrame')).toHaveLength(1);
        expect(c.querySelectorAll('.agentMockupFrameScaler')).toHaveLength(1);
    });

    it('exposes the tab strip as a radiogroup with radio tabs (arrow-key selectable)', () => {
        const c = document.createElement('div');
        renderMockupTabs(c, VARIANTS, null);
        const group = c.querySelector('.agentMockupTabs');
        expect(group.getAttribute('role')).toBe('radiogroup');
        c.querySelectorAll('.agentMockupTab').forEach((t) => {
            expect(t.getAttribute('role')).toBe('radio');
        });
    });

    it('selects the first option by default (roving tabindex + aria-checked)', () => {
        const c = document.createElement('div');
        renderMockupTabs(c, VARIANTS, null);
        const [a, b, cc] = c.querySelectorAll('.agentMockupTab');
        expect(a.getAttribute('aria-checked')).toBe('true');
        expect(a.tabIndex).toBe(0);
        expect(a.classList.contains('is-selected')).toBe(true);
        [b, cc].forEach((t) => {
            expect(t.getAttribute('aria-checked')).toBe('false');
            expect(t.tabIndex).toBe(-1);
        });
        // The single preview shows variant A's HTML.
        expect(c.querySelector('.agentMockupFrame').srcdoc).toContain('Alpha');
    });

    it('clicking a tab re-points the single preview and moves the selection', () => {
        const c = document.createElement('div');
        renderMockupTabs(c, VARIANTS, null);
        const [a, b] = c.querySelectorAll('.agentMockupTab');
        b.click();
        expect(b.getAttribute('aria-checked')).toBe('true');
        expect(a.getAttribute('aria-checked')).toBe('false');
        // Still one frame, now showing variant B.
        expect(c.querySelectorAll('.agentMockupFrame')).toHaveLength(1);
        expect(c.querySelector('.agentMockupFrame').srcdoc).toContain('Bravo');
    });

    it('ArrowRight/ArrowLeft move the selection along the strip and wrap around', () => {
        const c = document.createElement('div');
        renderMockupTabs(c, VARIANTS, null);
        const [a, b, cc] = c.querySelectorAll('.agentMockupTab');
        const arrow = (tab, key) =>
            tab.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

        // A is selected by default; each arrow is driven from the currently-
        // selected tab, matching a roving-tabindex radiogroup.
        arrow(a, 'ArrowRight');
        expect(b.getAttribute('aria-checked')).toBe('true');
        arrow(b, 'ArrowRight');
        expect(cc.getAttribute('aria-checked')).toBe('true');
        // ArrowRight from the last wraps back to the first.
        arrow(cc, 'ArrowRight');
        expect(a.getAttribute('aria-checked')).toBe('true');
        // ArrowLeft from the first wraps to the last.
        arrow(a, 'ArrowLeft');
        expect(cc.getAttribute('aria-checked')).toBe('true');
    });

    it('renders only the tabs for variants that exist', () => {
        const c = document.createElement('div');
        renderMockupTabs(c, { A: '<p>A</p>', C: '<p>C</p>' }, null);
        expect(Array.from(c.querySelectorAll('.agentMockupTab')).map((t) => t.textContent))
            .toEqual(['Option A', 'Option C']);
    });

    it('omits the "use this" control for a view-only (no-row) render', () => {
        const c = document.createElement('div');
        renderMockupTabs(c, VARIANTS, null);
        expect(c.querySelector('.agentMockupUse')).toBeNull();
    });

    it('fires onRender after mount, and even for an empty variant set', () => {
        const c1 = document.createElement('div');
        const seen = [];
        renderMockupTabs(c1, VARIANTS, null, { onRender: (el) => seen.push(el) });
        expect(seen).toEqual([c1]);

        const c2 = document.createElement('div');
        let calls = 0;
        renderMockupTabs(c2, {}, null, { onRender: () => { calls += 1; } });
        expect(calls).toBe(1);
        expect(c2.querySelectorAll('.agentMockupTab')).toHaveLength(0);
    });

    it('is safe when ResizeObserver is unavailable (no throw, still renders)', () => {
        const c = document.createElement('div');
        const had = 'ResizeObserver' in globalThis;
        const saved = globalThis.ResizeObserver;
        // eslint-disable-next-line no-undef
        delete globalThis.ResizeObserver;
        try {
            expect(() => renderMockupTabs(c, VARIANTS, null)).not.toThrow();
            expect(c.querySelectorAll('.agentMockupFrame')).toHaveLength(1);
        } finally {
            if (had) globalThis.ResizeObserver = saved;
        }
    });

    it('"use this" turns the CURRENTLY-selected variant into the entry and flips the row to drafted', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        const row = { id: 'r-tab', context: { title: 'Recolor the chip' } };
        const c = document.createElement('div');
        renderMockupTabs(c, VARIANTS, row);

        // Pick option B, then use it.
        c.querySelectorAll('.agentMockupTab')[1].click();
        const useBtn = c.querySelector('.agentMockupUse');
        expect(useBtn).not.toBeNull();
        useBtn.click();
        // Synchronous pending state.
        expect(useBtn.disabled).toBe(true);
        expect(useBtn.textContent).toBe('Creating entry…');

        chatReply = '- [ ] **[LOW]** Recolor the chip\n  - Type: feature';
        await flush();

        // The entry prompt carried variant B specifically.
        expect(chatCalls).toHaveLength(1);
        const content = chatCalls[0].messages[0].content;
        expect(content).toContain('Chosen mockup (variant B)');
        expect(content).toContain('<p>Bravo</p>');
        // The reply was written to the row as its draft.
        expect(spy).toHaveBeenCalledWith('r-tab', { draft: chatReply, state: 'drafted' });
    });

    it('surfaces a non-blocking error and re-enables "use this" on a failed save', async () => {
        vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: false, error: 'save boom' });
        const row = { id: 'r-fail', context: { title: 'T' } };
        const c = document.createElement('div');
        renderMockupTabs(c, VARIANTS, row);

        chatReply = '- [ ] **[LOW]** T\n  - Type: feature';
        c.querySelector('.agentMockupUse').click();
        await flush();

        const err = c.querySelector('.agentMockupUseError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toContain('save boom');
        const useBtn = c.querySelector('.agentMockupUse');
        expect(useBtn.disabled).toBe(false);
        expect(useBtn.textContent).toBe('use this');
    });
});

describe('buildMockupSecondary({ tabbed: true }) — routes the modal host to the tabbed renderer', () => {
    it('adds the tabbed class and NOT the three-across grid class', () => {
        const wrap = buildMockupSecondary({ id: 'r-modal', context: {} }, { tabbed: true });
        expect(wrap.classList.contains('agentMockup')).toBe(true);
        expect(wrap.classList.contains('agentMockup--tabbed')).toBe(true);
        expect(wrap.classList.contains('agentMockup--grid')).toBe(false);
    });

    it('still carries the shared Generate control and the fallback hand-off', () => {
        const wrap = buildMockupSecondary({ id: 'r-modal-2', context: {} }, { tabbed: true });
        expect(wrap.querySelector('.agentMockupGenerate')).not.toBeNull();
        expect(wrap.querySelector('.agentMockupFallback')).not.toBeNull();
    });
});
