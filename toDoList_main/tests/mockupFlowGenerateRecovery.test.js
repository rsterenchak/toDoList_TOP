import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression: Generate mockups could hang on "Generating…" forever in the desktop
// detail pane. The block that started a generation gets detached when its host
// (the detail pane, the mobile modal, assignment coverage) rebuilds mid-flight,
// and the old fallback only called paint() — which rebuilds the Agent board, not
// those hosts — so the fresh block stayed pending. These tests drive the flow
// through buildMockupSecondary with a scripted chatWithWorker and prove every
// still-mounted block for the row settles, a failure survives the node that saw
// it, and the Generate call is bounded by a timeout.

let chatCalls = [];
let pendingChat = null;

vi.mock('../src/inject.js', () => ({
    findTargetById: () => null,
    showInjectToast: () => {},
    chatWithWorker: (...args) => {
        chatCalls.push(args);
        return new Promise((resolve, reject) => { pendingChat = { resolve, reject }; });
    },
}));

import { buildMockupSecondary, configureMockupFlow } from '../src/mockupFlow.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) {
    for (let i = 0; i < n; i++) await tick();
}

const ABC = '===VARIANT A===\n<p>Alpha</p>\n===VARIANT B===\n<p>Bravo</p>\n===VARIANT C===\n<p>Charlie</p>';

const paintSpy = vi.fn();
configureMockupFlow({ paint: paintSpy });

// Mount a block in a host container, the way the detail pane does.
function mount(host, rowId) {
    host.innerHTML = '';
    const block = buildMockupSecondary({ id: rowId, state: 'needs_mockup', context: { title: 'T' } }, { grid: true });
    host.appendChild(block);
    return block;
}

beforeEach(() => {
    document.body.innerHTML = '<div id="pane"></div>';
    chatCalls = [];
    pendingChat = null;
    paintSpy.mockClear();
});

describe('mockupFlow — Generate recovers when its host rebuilds mid-flight', () => {
    it('bounds the Generate chat call with a 120s timeout', async () => {
        const pane = document.getElementById('pane');
        mount(pane, 'rt-timeout');
        pane.querySelector('.agentMockupGenerate').click();
        await flush();
        expect(chatCalls).toHaveLength(1);
        expect(chatCalls[0][7]).toEqual({ timeoutMs: 120000 });
        pendingChat.resolve({ reply: ABC });
        await flush();
    });

    it('renders previews into a fresh pane block when the original was detached', async () => {
        const pane = document.getElementById('pane');
        mount(pane, 'rt-ok');
        pane.querySelector('.agentMockupGenerate').click();
        await flush();

        // The detail pane rebuilds mid-flight: the original block is detached and
        // the fresh one mounts in the pending state.
        mount(pane, 'rt-ok');
        const fresh = pane.querySelector('.agentMockupGenerate');
        expect(fresh.textContent).toBe('Generating…');

        pendingChat.resolve({ reply: ABC });
        await flush();

        expect(fresh.textContent).toBe('Regenerate');
        expect(fresh.disabled).toBe(false);
        expect(fresh.classList.contains('is-pending')).toBe(false);
        expect(pane.querySelectorAll('.agentMockupFrame')).toHaveLength(3);
        // The board still repaints to stay in sync.
        expect(paintSpy).toHaveBeenCalled();
    });

    it('surfaces a failure on a fresh pane block when the original was detached', async () => {
        const pane = document.getElementById('pane');
        mount(pane, 'rt-fail');
        pane.querySelector('.agentMockupGenerate').click();
        await flush();

        mount(pane, 'rt-fail');
        const fresh = pane.querySelector('.agentMockupGenerate');

        const err = new Error('Timed out after 120s');
        err.reason = 'Timed out after 120s';
        pendingChat.reject(err);
        await flush();

        expect(fresh.textContent).toBe('Generate mockups');
        expect(fresh.disabled).toBe(false);
        const genError = pane.querySelector('.agentMockupGenError');
        expect(genError.hidden).toBe(false);
        expect(genError.textContent).toContain('Timed out after 120s');
        expect(paintSpy).toHaveBeenCalled();
    });

    it('shows the stored error on a block built after the failure, with the button idle', async () => {
        const pane = document.getElementById('pane');
        mount(pane, 'rt-stored');
        pane.querySelector('.agentMockupGenerate').click();
        await flush();
        pendingChat.reject(Object.assign(new Error('boom'), { reason: 'boom' }));
        await flush();

        // Close and reopen the task: a brand-new block for the same row.
        mount(pane, 'rt-stored');
        const btn = pane.querySelector('.agentMockupGenerate');
        expect(btn.disabled).toBe(false);
        expect(btn.textContent).toBe('Generate mockups');
        const genError = pane.querySelector('.agentMockupGenError');
        expect(genError.hidden).toBe(false);
        expect(genError.textContent).toContain('boom');

        // A new click clears the stored error; success keeps it cleared.
        btn.click();
        expect(genError.hidden).toBe(true);
        await flush();
        pendingChat.resolve({ reply: ABC });
        await flush();
        mount(pane, 'rt-stored');
        expect(pane.querySelector('.agentMockupGenError').hidden).toBe(true);
        expect(pane.querySelector('.agentMockupGenerate').textContent).toBe('Regenerate');
    });

    it('updates every still-mounted block for the row, not just the originating one', async () => {
        document.body.innerHTML = '<div id="pane"></div><div id="modal"></div>';
        const pane = document.getElementById('pane');
        const modal = document.getElementById('modal');
        mount(pane, 'rt-multi');
        pane.querySelector('.agentMockupGenerate').click();
        await flush();
        mount(modal, 'rt-multi');

        pendingChat.resolve({ reply: ABC });
        await flush();

        expect(pane.querySelector('.agentMockupGenerate').textContent).toBe('Regenerate');
        expect(modal.querySelector('.agentMockupGenerate').textContent).toBe('Regenerate');
        expect(modal.querySelectorAll('.agentMockupFrame')).toHaveLength(3);
    });
});
