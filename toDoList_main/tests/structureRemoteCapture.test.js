import { describe, it, expect, beforeEach, vi } from 'vitest';

// structureRemoteCapture imports buildUiTree from structureView, which in turn
// pulls in the chat/manifest/project surfaces — mock those to their thinnest
// shape so importing the module under test doesn't drag real network/DOM wiring.
vi.mock('../src/claudeSheet.js', () => ({
    loadManifest: vi.fn(() => Promise.resolve({ ok: false, files: [] })),
    getRunningAppRepo: vi.fn(() => 'rsterenchak/toDoList_TOP'),
    setChatWorkspaceRepo: vi.fn(),
    insertReference: vi.fn(),
}));
vi.mock('../src/seedTasksModal.js', () => ({ resolveProjectRepo: vi.fn(() => null) }));
vi.mock('../src/inject.js', () => ({ chatWithWorker: vi.fn(() => Promise.resolve({ reply: '' })) }));

import { pagesUrlFor, captureRemote } from '../src/structureRemoteCapture.js';
import { resetCanvasState, renderStructureCanvas } from '../src/structureCanvas.js';

const GUEST = 'rsterenchak/matchingGame-test';

function bucketKey(repo, bucket) {
    return 'todoapp_structureSnapshot_' + encodeURIComponent(repo) + '_' + bucket;
}
function treeKey(repo) {
    return 'todoapp_structureTree_' + encodeURIComponent(repo);
}

function stubRect(el, w, h) {
    el.getBoundingClientRect = function () {
        return { left: 0, top: 0, width: w, height: h, right: w, bottom: h };
    };
}

// A detached, same-origin-style document standing in for a guest repo's deployed
// page loaded into an iframe. Regions are discoverable by id + landmark role.
function guestDoc() {
    const doc = document.implementation.createHTMLDocument('guest');
    doc.body.innerHTML =
        '<header id="topBar"></header>' +
        '<main id="stage"><div id="panel"></div></main>';
    stubRect(doc.body.querySelector('#topBar'), 300, 50);
    stubRect(doc.body.querySelector('#stage'), 300, 400);
    stubRect(doc.body.querySelector('#panel'), 280, 300);
    return doc;
}

// A loader that hands back the same fake doc for every pass, recording the sizes
// it was asked for so the two-pass sizing can be asserted.
function fakeLoader(sizes) {
    return function (url, w, h) {
        sizes.push({ url, w, h });
        return Promise.resolve({ doc: guestDoc(), remove: vi.fn() });
    };
}

beforeEach(() => {
    resetCanvasState();
    try { localStorage.clear(); } catch (e) { /* ignore */ }
});

describe('structureRemoteCapture — pagesUrlFor', () => {
    it('derives the deployed Pages URL from an owner/name repo', () => {
        expect(pagesUrlFor(GUEST)).toBe('https://rsterenchak.github.io/matchingGame-test/');
        expect(pagesUrlFor('rsterenchak/toDoList_TOP')).toBe('https://rsterenchak.github.io/toDoList_TOP/');
    });

    it('rejects malformed input with null', () => {
        expect(pagesUrlFor(null)).toBe(null);
        expect(pagesUrlFor('')).toBe(null);
        expect(pagesUrlFor('noslash')).toBe(null);
        expect(pagesUrlFor('too/many/parts')).toBe(null);
        expect(pagesUrlFor('/name')).toBe(null);
        expect(pagesUrlFor('owner/')).toBe(null);
        expect(pagesUrlFor(42)).toBe(null);
    });
});

describe('structureRemoteCapture — captureRemote', () => {
    it('loads mobile then desktop and writes both buckets + the tree for the repo', async () => {
        const sizes = [];
        const res = await captureRemote(GUEST, { loadDoc: fakeLoader(sizes) });
        expect(res.ok).toBe(true);
        expect(res.passes).toBe(2);

        // Two passes, sized to the two breakpoints against the deployed origin.
        expect(sizes.map((s) => s.w)).toEqual([390, 1280]);
        expect(sizes.every((s) => s.url === 'https://rsterenchak.github.io/matchingGame-test/')).toBe(true);

        // Both buckets persisted under the guest repo's keys, with the walked handles.
        const mobile = JSON.parse(localStorage.getItem(bucketKey(GUEST, 'mobile')));
        const desktop = JSON.parse(localStorage.getItem(bucketKey(GUEST, 'desktop')));
        expect(Object.keys(mobile.handles)).toEqual(expect.arrayContaining(['#topBar', '#stage', '#panel']));
        expect(desktop.handles['#panel'].rect.width).toBe(280);
        expect(mobile.viewport).toEqual({ w: 390, h: 844 });
        expect(desktop.viewport).toEqual({ w: 1280, h: 800 });

        // The handle tree the guest canvas renders from is stored too, with nesting.
        const tree = JSON.parse(localStorage.getItem(treeKey(GUEST)));
        const stage = tree.find((n) => n.selector === '#stage');
        expect(stage).toBeTruthy();
        expect(stage.children.map((c) => c.selector)).toContain('#panel');
    });

    it('writes the capture to the named repo, not the self repo', async () => {
        await captureRemote(GUEST, { loadDoc: fakeLoader([]) });
        expect(localStorage.getItem(bucketKey('rsterenchak/toDoList_TOP', 'mobile'))).toBe(null);
        expect(localStorage.getItem(bucketKey(GUEST, 'mobile'))).toBeTruthy();
    });

    it('leaves any prior capture untouched when the deployed page is unreachable', async () => {
        // Seed a prior capture, then fail — the buckets must be byte-for-byte intact.
        const priorMobile = '{"capturedAt":"2026-01-01T00:00:00.000Z","viewport":{"w":390,"h":844},"handles":{"#old":{"rect":{"x":0,"y":0,"width":10,"height":10},"visible":true}}}';
        const priorTree = '[{"type":"region","label":"Old","selector":"#old","visible":true,"children":[]}]';
        localStorage.setItem(bucketKey(GUEST, 'mobile'), priorMobile);
        localStorage.setItem(treeKey(GUEST), priorTree);

        const failing = vi.fn(() => Promise.reject(new Error('load-error')));
        const res = await captureRemote(GUEST, { loadDoc: failing });
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('unreachable');

        // First pass failed before any write; the seeded capture is untouched.
        expect(localStorage.getItem(bucketKey(GUEST, 'mobile'))).toBe(priorMobile);
        expect(localStorage.getItem(treeKey(GUEST))).toBe(priorTree);
    });

    it('lifts the guest-canvas mount guard: the block canvas mounts once captured', async () => {
        // A repo unique to this test — the canvas store is module-scoped, so a repo
        // captured by an earlier test would already have its mount guard open.
        const FRESH = 'rsterenchak/mount-guard-test';
        const host = document.createElement('div');
        document.body.appendChild(host);
        // Before any capture a guest repo renders nothing (mount guard closed).
        expect(renderStructureCanvas(host, { repo: FRESH, onSelect: vi.fn() })).toBe(null);

        await captureRemote(FRESH, { loadDoc: fakeLoader([]) });

        const pane = renderStructureCanvas(host, { repo: FRESH, onSelect: vi.fn() });
        expect(pane).toBeTruthy();
        expect(host.querySelector('.structureCanvasPane')).toBeTruthy();
    });

    it('rejects a malformed repo without attempting a load', async () => {
        const loadDoc = vi.fn();
        const res = await captureRemote('not-a-repo', { loadDoc });
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('bad-repo');
        expect(loadDoc).not.toHaveBeenCalled();
    });
});
