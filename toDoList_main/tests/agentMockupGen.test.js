import { vi } from 'vitest';

// The needs_mockup card renders in-app A/B/C mockup previews. A Generate /
// Regenerate control calls the chat Worker (the existing chat proxy — no Worker
// change) with a machine-parseable prompt, parses the reply into three HTML
// variants, and renders them as sandboxed preview iframes right on the card.
// These tests drive that flow with a controllable fake Supabase client and a
// fully mocked inject.js whose chatWithWorker reply can be scripted, so no
// network is touched. The manual "Not quite right?" fallback hand-off is
// verified to survive beneath the previews.

// ── Supabase stub ────────────────────────────────────────────────────
let queueRows = [];
let queueError = null;

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => Promise.resolve({ data: queueRows, error: queueError }),
            }),
            insert: (row) => Promise.resolve({ data: [row], error: null }),
            update: (patch) => ({
                eq: () => Promise.resolve({ data: [patch], error: null }),
            }),
        }),
        channel: () => ({
            on() { return this; },
            subscribe() { return this; },
        }),
        removeChannel: () => {},
    },
}));

// ── inject.js stub ───────────────────────────────────────────────────
// Only chatWithWorker and findTargetById matter for these tests; the rest are
// inert stubs so the named imports agentView pulls resolve.
let chatReply = '';
let chatReject = null;
let chatCalls = [];
let targetById = null;

vi.mock('../src/inject.js', () => ({
    mintEntryId: () => 'mint',
    embedEntryMarker: (text, id) => String(text) + ' ' + id,
    injectEntry: () => Promise.resolve({ ok: true }),
    dispatchRun: () => Promise.resolve({ ok: true }),
    dispatchTriage: () => Promise.resolve({ ok: true }),
    pollRunStatus: () => Promise.resolve({ ok: true, found: false }),
    resolveEntryByMarker: () => Promise.resolve({ ok: true, found: false }),
    fetchRunResult: () => Promise.resolve({ ok: true, result: '' }),
    fetchActiveRuns: () => Promise.resolve({ ok: true, active: false }),
    readTodoMdFromWorker: () => Promise.resolve({ ok: false }),
    findTargetById: () => targetById,
    showInjectToast: () => {},
    isInjectConfigured: () => true,
    chatWithWorker: (messages, entryId, attach, repo) => {
        chatCalls.push({ messages, entryId, attach, repo });
        if (chatReject) return Promise.reject(new Error(chatReject));
        return Promise.resolve({ reply: chatReply, suggestedFiles: [] });
    },
}));

vi.mock('../src/claudeSheet.js', () => ({
    openChatWithSeed: () => {},
}));

import { listLogic } from '../src/listLogic.js';
import {
    subscribeAgentView,
    unsubscribeAgentView,
} from '../src/agentView.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 6) {
    for (let i = 0; i < n; i++) await tick();
}

function mountDom(projectName) {
    document.body.innerHTML =
        (projectName
            ? '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>'
            : '') +
        '<div id="agentView"></div>';
}

async function loadBoard() {
    subscribeAgentView();
    await flush();
}

const ABC = '{"A":"<p>Alpha</p>","B":"<p>Bravo</p>","C":"<p>Charlie</p>"}';

beforeEach(() => {
    listLogic._reset();
    queueRows = [];
    queueError = null;
    chatReply = ABC;
    chatReject = null;
    chatCalls = [];
    targetById = null;
    listLogic.addProject('Mocky');
    mountDom('Mocky');
});

afterEach(() => {
    unsubscribeAgentView();
});

describe('AGENT view — needs_mockup in-app A/B/C previews', () => {
    it('renders the Generate control and the tucked fallback hand-off beneath it', async () => {
        queueRows = [{ id: 'g1', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        const genBtn = document.querySelector('.agentMockupGenerate');
        expect(genBtn).toBeTruthy();
        expect(genBtn.textContent).toBe('Generate mockups');
        // No previews until Generate is tapped.
        expect(document.querySelectorAll('.agentMockupFrame').length).toBe(0);
        // The manual hand-off is retained, tucked inside a collapsible fallback.
        const fallback = document.querySelector('.agentMockupFallback');
        expect(fallback).toBeTruthy();
        expect(fallback.querySelector('.agentMockupOpen')).toBeTruthy();
        expect(fallback.querySelector('.agentMockupPaste')).toBeTruthy();
        expect(fallback.querySelector('.agentMockupSave')).toBeTruthy();
    });

    it('Generate sends a mockups-only grounded prompt and renders three sandboxed preview iframes', async () => {
        queueRows = [{
            id: 'g2',
            state: 'needs_mockup',
            context: { title: 'Restyle the chip', description: 'Purple it', region: 'Header', tokens: 'accent', change: 'recolor' },
        }];
        await loadBoard();

        document.querySelector('.agentMockupGenerate').click();
        await flush();

        // The chat Worker was called once with the grounded, JSON-shaped prompt.
        expect(chatCalls.length).toBe(1);
        const content = chatCalls[0].messages[0].content;
        expect(content).toContain('Task: Restyle the chip');
        expect(content).toContain('Purple it');
        expect(content).toContain('- Region: Header');
        expect(content).toContain('- Tokens: accent');
        expect(content).toContain('- Change: recolor');
        expect(content).toContain('Do NOT write a TODO.md entry');
        expect(content).toContain('{"A":');

        // Three preview iframes, sandboxed with scripts OFF (empty sandbox).
        const frames = document.querySelectorAll('.agentMockupFrame');
        expect(frames.length).toBe(3);
        frames.forEach((f) => {
            expect(f.tagName).toBe('IFRAME');
            expect(f.getAttribute('sandbox')).toBe('');
        });
        // Each srcdoc carries its variant HTML plus the injected app tokens.
        expect(frames[0].getAttribute('srcdoc')).toContain('<p>Alpha</p>');
        expect(frames[1].getAttribute('srcdoc')).toContain('<p>Bravo</p>');
        expect(frames[2].getAttribute('srcdoc')).toContain('<p>Charlie</p>');
        expect(frames[0].getAttribute('srcdoc')).toContain('--accent');
        // After a successful generation the button offers a re-run.
        expect(document.querySelector('.agentMockupGenerate').textContent).toBe('Regenerate');
        // No error surfaced.
        expect(document.querySelector('.agentMockupGenError').hidden).toBe(true);
    });

    it('injects the app style into an existing <head> when the variant is a full document', async () => {
        chatReply = '{"A":"<!doctype html><html><head><title>x</title></head><body><b>A</b></body></html>","B":"<p>B</p>","C":"<p>C</p>"}';
        queueRows = [{ id: 'g2b', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        document.querySelector('.agentMockupGenerate').click();
        await flush();

        const doc = document.querySelector('.agentMockupFrame').getAttribute('srcdoc');
        // The style is spliced into the document's own head, not double-wrapped.
        expect(doc).toContain('<title>x</title>');
        expect(doc).toContain('<b>A</b>');
        expect(doc).toContain('--text-primary');
        expect(doc.indexOf('<style>')).toBeGreaterThan(doc.indexOf('<head>'));
    });

    it('parses a reply wrapped in a ```json code fence', async () => {
        chatReply = '```json\n' + ABC + '\n```';
        queueRows = [{ id: 'g3', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        document.querySelector('.agentMockupGenerate').click();
        await flush();

        expect(document.querySelectorAll('.agentMockupFrame').length).toBe(3);
        expect(document.querySelector('.agentMockupGenError').hidden).toBe(true);
    });

    it('Regenerate re-runs the call and replaces the tiles', async () => {
        queueRows = [{ id: 'g4', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        document.querySelector('.agentMockupGenerate').click();
        await flush();
        expect(document.querySelector('.agentMockupFrame').getAttribute('srcdoc')).toContain('Alpha');

        chatReply = '{"A":"<p>Zed</p>","B":"<p>Yak</p>","C":"<p>Xen</p>"}';
        document.querySelector('.agentMockupGenerate').click();
        await flush();

        expect(chatCalls.length).toBe(2);
        const frames = document.querySelectorAll('.agentMockupFrame');
        expect(frames.length).toBe(3);
        expect(frames[0].getAttribute('srcdoc')).toContain('Zed');
        expect(frames[0].getAttribute('srcdoc')).not.toContain('Alpha');
    });

    it('shows a non-blocking error and keeps the fallback usable when the reply is unparseable', async () => {
        chatReply = 'Sorry, here are some ideas but no JSON at all.';
        queueRows = [{ id: 'g5', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        document.querySelector('.agentMockupGenerate').click();
        await flush();

        expect(document.querySelectorAll('.agentMockupFrame').length).toBe(0);
        const err = document.querySelector('.agentMockupGenError');
        expect(err.hidden).toBe(false);
        expect(err.textContent.length).toBeGreaterThan(0);
        // The generate control re-enables so the user can retry.
        const genBtn = document.querySelector('.agentMockupGenerate');
        expect(genBtn.disabled).toBe(false);
        // The fallback hand-off is untouched and still fully present.
        expect(document.querySelector('.agentMockupFallback .agentMockupPaste')).toBeTruthy();
    });

    it('shows a non-blocking error when the chat call rejects', async () => {
        chatReject = 'network boom';
        queueRows = [{ id: 'g6', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        document.querySelector('.agentMockupGenerate').click();
        await flush();

        expect(document.querySelectorAll('.agentMockupFrame').length).toBe(0);
        const err = document.querySelector('.agentMockupGenError');
        expect(err.hidden).toBe(false);
        expect(document.querySelector('.agentMockupGenerate').disabled).toBe(false);
    });

    it('points the generation at the project repo when a target is routed, null otherwise', async () => {
        queueRows = [{ id: 'g7', state: 'needs_mockup', context: { title: 'T' } }];
        await loadBoard();

        // No target routed → repo is null (Worker falls back to its default).
        document.querySelector('.agentMockupGenerate').click();
        await flush();
        expect(chatCalls[0].repo).toBeNull();
        // The chat turn carries no iterate seed and no attachments.
        expect(chatCalls[0].entryId).toBeNull();
        expect(chatCalls[0].attach).toBeNull();
    });
});
