import { describe, it, expect, vi, beforeEach } from 'vitest';

// Tap-to-enlarge: tapping a scaled mockup preview (the pane's three-across grid
// tiles or the mobile modal's tabbed preview) opens the variant in a full-viewport
// overlay, rendered larger than any tile with its own Use action. These tests pin
// the enlarge affordance the two scaled hosts share, and openMockupOverlay itself —
// re-render (not upscale), the shared Use path, the three-way close, focus
// restoration + trap, and clean mount/teardown.
//
// mockupFlow imports inject.js; stub it so the named imports resolve without a
// network and chatWithWorker calls can be inspected. modals.js is imported for real
// (wireModalDismiss) — it drives the overlay's close contract.
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

import {
    renderMockupPreviews,
    renderMockupTabs,
    openMockupOverlay,
} from '../src/mockupFlow.js';
import { listLogic } from '../src/listLogic.js';

const VARIANTS = { A: '<p>Alpha</p>', B: '<p>Bravo</p>', C: '<p>Charlie</p>' };
const flush = () => new Promise((r) => setTimeout(r, 0));
const overlay = () => document.getElementById('mockupOverlayBackdrop');
const press = (key, opts = {}) =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts }));

beforeEach(() => {
    chatCalls = [];
    chatReply = '';
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('scaled grid tiles — enlarge affordance', () => {
    it('adds a tap-to-enlarge button over every scaled tile', () => {
        const c = document.createElement('div');
        renderMockupPreviews(c, VARIANTS, null, { scaled: true });
        const buttons = c.querySelectorAll('.agentMockupEnlarge');
        expect(buttons).toHaveLength(3);
        // Layered inside the clipping scaler, on top of the iframe.
        buttons.forEach((b) => {
            expect(b.parentElement.classList.contains('agentMockupFrameScaler')).toBe(true);
            expect(b.getAttribute('aria-label')).toMatch(/^Enlarge Option [ABC] preview$/);
        });
    });

    it('does NOT add the enlarge affordance to the board (unscaled) tiles', () => {
        const c = document.createElement('div');
        renderMockupPreviews(c, VARIANTS, null); // board default: no scaling
        expect(c.querySelectorAll('.agentMockupEnlarge')).toHaveLength(0);
    });

    it('tapping a tile opens the overlay for THAT variant', () => {
        document.body.appendChild(document.createElement('div'));
        const c = document.body.firstChild;
        renderMockupPreviews(c, VARIANTS, null, { scaled: true });
        c.querySelectorAll('.agentMockupEnlarge')[1].click(); // Option B

        const ov = overlay();
        expect(ov).not.toBeNull();
        expect(ov.querySelector('.mockupOverlayLabel').textContent).toBe('Option B');
        // A single fresh preview frame rendered from the variant HTML.
        const frame = ov.querySelector('.agentMockupFrame');
        expect(frame.srcdoc).toContain('Bravo');
    });
});

describe('tabbed preview — enlarge affordance', () => {
    it('adds one enlarge button that opens the CURRENTLY-selected variant', () => {
        document.body.appendChild(document.createElement('div'));
        const c = document.body.firstChild;
        renderMockupTabs(c, VARIANTS, null);
        expect(c.querySelectorAll('.agentMockupEnlarge')).toHaveLength(1);

        // Select option C, then enlarge — the overlay must show C, not the default A.
        c.querySelectorAll('.agentMockupTab')[2].click();
        c.querySelector('.agentMockupEnlarge').click();
        expect(overlay().querySelector('.mockupOverlayLabel').textContent).toBe('Option C');
        expect(overlay().querySelector('.agentMockupFrame').srcdoc).toContain('Charlie');
    });
});

describe('openMockupOverlay — rendering & Use', () => {
    it('re-renders the variant in a fresh iframe rather than reusing a tile frame', () => {
        openMockupOverlay('A', '<p>Alpha</p>', null);
        const frames = overlay().querySelectorAll('.agentMockupFrame');
        expect(frames).toHaveLength(1);
        expect(frames[0].getAttribute('sandbox')).toBe(''); // sandbox not relaxed
        expect(frames[0].srcdoc).toContain('Alpha');
    });

    it('omits the Use control for a view-only (no-row) overlay', () => {
        openMockupOverlay('A', '<p>Alpha</p>', null);
        expect(overlay().querySelector('.agentMockupUse')).toBeNull();
    });

    it('Use produces the entry for the overlay variant and closes the overlay', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        const row = { id: 'r-ov', context: { title: 'Recolor the chip' } };
        openMockupOverlay('B', '<p>Bravo</p>', row);

        const useBtn = overlay().querySelector('.agentMockupUse');
        expect(useBtn).not.toBeNull();
        chatReply = '- [ ] **[LOW]** Recolor the chip\n  - Type: feature';
        useBtn.click();
        expect(useBtn.textContent).toBe('Creating entry…');
        await flush();

        // Prompt carried variant B; the reply was saved and the row flipped drafted.
        expect(chatCalls[0].messages[0].content).toContain('Chosen mockup (variant B)');
        expect(chatCalls[0].messages[0].content).toContain('<p>Bravo</p>');
        expect(spy).toHaveBeenCalledWith('r-ov', { draft: chatReply, state: 'drafted' });
        // Overlay closed on success.
        expect(overlay()).toBeNull();
    });

    it('a failed Use keeps the overlay open, surfaces the error, and re-enables the button', async () => {
        vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: false, error: 'save boom' });
        const row = { id: 'r-ov-fail', context: { title: 'T' } };
        openMockupOverlay('A', '<p>Alpha</p>', row);

        chatReply = '- [ ] **[LOW]** T\n  - Type: feature';
        overlay().querySelector('.agentMockupUse').click();
        await flush();

        expect(overlay()).not.toBeNull(); // still open
        const err = overlay().querySelector('.agentMockupUseError');
        expect(err.hidden).toBe(false);
        expect(err.textContent).toContain('save boom');
        const useBtn = overlay().querySelector('.agentMockupUse');
        expect(useBtn.disabled).toBe(false);
        expect(useBtn.textContent).toBe('use this');
    });
});

describe('openMockupOverlay — close contract & lifecycle', () => {
    it('closes on the close button', () => {
        openMockupOverlay('A', '<p>Alpha</p>', null);
        overlay().querySelector('.mockupOverlayClose').click();
        expect(overlay()).toBeNull();
    });

    it('closes on Escape', () => {
        openMockupOverlay('A', '<p>Alpha</p>', null);
        press('Escape');
        expect(overlay()).toBeNull();
    });

    it('closes on a backdrop click but not on a click inside the dialog', () => {
        openMockupOverlay('A', '<p>Alpha</p>', null);
        // Click inside the dialog does not close.
        overlay().querySelector('.mockupOverlay').click();
        expect(overlay()).not.toBeNull();
        // Click the backdrop itself closes.
        overlay().click();
        expect(overlay()).toBeNull();
    });

    it('restores focus to the opener on close', () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);
        opener.focus();
        expect(document.activeElement).toBe(opener);

        openMockupOverlay('A', '<p>Alpha</p>', null);
        expect(document.activeElement).not.toBe(opener); // focus moved into overlay
        press('Escape');
        expect(document.activeElement).toBe(opener);
    });

    it('opening twice leaves exactly one overlay in the DOM', () => {
        openMockupOverlay('A', '<p>Alpha</p>', null);
        openMockupOverlay('B', '<p>Bravo</p>', null);
        expect(document.querySelectorAll('#mockupOverlayBackdrop')).toHaveLength(1);
        // The single overlay is the second one.
        expect(overlay().querySelector('.mockupOverlayLabel').textContent).toBe('Option B');
    });

    it('is a no-op for an empty variant', () => {
        openMockupOverlay('A', '', null);
        expect(overlay()).toBeNull();
    });
});
