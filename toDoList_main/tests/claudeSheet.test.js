import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';
import {
    mountClaudeSheet,
    openClaudeSheet,
    closeClaudeSheet,
    isClaudeSheetOpen,
    extractDraftedEntry,
    extractInspectDirective,
} from '../src/claudeSheet.js';
import { initInjectConfig } from '../src/inject.js';
import { notifyUpdateAvailable } from '../src/modals.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The Claude assistant SHELL: a `⋯` launcher (replacing the old help `?` FAB)
// that opens a bottom sheet on mobile and a docked right-hand panel on wider
// viewports, with a CHAT | RUNS toggle, an inert Chat composer, and a Runs
// empty state with a "+ New" affordance. No chat / inject / run logic yet.
describe('Claude sheet shell + launcher', () => {
    let handles;

    beforeEach(() => {
        document.body.innerHTML = '';
        handles = mountClaudeSheet(document.body);
    });

    it('mounts the launcher, sheet, and backdrop into the parent', () => {
        const launcher = document.getElementById('claudeLauncher');
        const sheet = document.getElementById('claudeSheet');
        const backdrop = document.getElementById('claudeSheetBackdrop');
        expect(launcher).toBeTruthy();
        expect(sheet).toBeTruthy();
        expect(backdrop).toBeTruthy();
        expect(handles.launcher).toBe(launcher);
    });

    it('gives the launcher a `⋯` glyph and dialog aria metadata', () => {
        const launcher = document.getElementById('claudeLauncher');
        expect(launcher.textContent).toBe('⋯');
        expect(launcher.getAttribute('aria-haspopup')).toBe('dialog');
        expect(launcher.getAttribute('aria-label')).toBe('Open Claude assistant');
        expect(launcher.getAttribute('aria-expanded')).toBe('false');
    });

    it('starts closed and the launcher click toggles it open then closed', () => {
        const launcher = document.getElementById('claudeLauncher');
        expect(isClaudeSheetOpen()).toBe(false);
        launcher.click();
        expect(isClaudeSheetOpen()).toBe(true);
        launcher.click();
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('open/close drive the sheet class, aria-hidden, backdrop, and launcher state', () => {
        const sheet = document.getElementById('claudeSheet');
        const backdrop = document.getElementById('claudeSheetBackdrop');
        const launcher = document.getElementById('claudeLauncher');

        openClaudeSheet();
        expect(sheet.classList.contains('open')).toBe(true);
        expect(sheet.getAttribute('aria-hidden')).toBe('false');
        expect(backdrop.classList.contains('open')).toBe(true);
        expect(launcher.getAttribute('aria-expanded')).toBe('true');

        closeClaudeSheet();
        expect(sheet.classList.contains('open')).toBe(false);
        expect(sheet.getAttribute('aria-hidden')).toBe('true');
        expect(backdrop.classList.contains('open')).toBe(false);
        expect(launcher.getAttribute('aria-expanded')).toBe('false');
    });

    it('closes on backdrop click', () => {
        openClaudeSheet();
        document.getElementById('claudeSheetBackdrop').click();
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('closes on the grab handle click', () => {
        openClaudeSheet();
        document.getElementById('claudeSheetHandle').click();
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('renders a desktop close `×` that dismisses the panel', () => {
        const closeX = document.getElementById('claudeSheetClose');
        expect(closeX).toBeTruthy();
        expect(closeX.textContent).toBe('×');
        expect(closeX.getAttribute('aria-label')).toBe('Close Claude panel');
        openClaudeSheet();
        closeX.click();
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('closes on Escape when open and ignores Escape when already closed', () => {
        openClaudeSheet();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(isClaudeSheetOpen()).toBe(false);
        // No throw / no-op when already closed.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(isClaudeSheetOpen()).toBe(false);
    });

    it('renders a CHAT | RUNS segmented toggle defaulting to CHAT', () => {
        const chatTab = document.getElementById('claudeTabChat');
        const runsTab = document.getElementById('claudeTabRuns');
        expect(chatTab.textContent).toBe('CHAT');
        expect(runsTab.textContent).toBe('RUNS');
        expect(chatTab.getAttribute('aria-selected')).toBe('true');
        expect(runsTab.getAttribute('aria-selected')).toBe('false');
        expect(document.getElementById('claudeChatView').hidden).toBe(false);
        expect(document.getElementById('claudeRunsView').hidden).toBe(true);
    });

    it('switches views when the RUNS tab is selected', () => {
        document.getElementById('claudeTabRuns').click();
        expect(document.getElementById('claudeSheet').getAttribute('data-tab')).toBe('runs');
        expect(document.getElementById('claudeTabRuns').getAttribute('aria-selected')).toBe('true');
        expect(document.getElementById('claudeChatView').hidden).toBe(true);
        expect(document.getElementById('claudeRunsView').hidden).toBe(false);
    });

    it('shows the Runs empty state and a "+ New" affordance', () => {
        const empty = document.getElementById('claudeRunsEmpty');
        const newBtn = document.getElementById('claudeRunsNew');
        expect(empty.textContent).toBe('No runs yet — tap + New to start');
        expect(newBtn.textContent).toBe('+ New');
    });

    it('the Chat composer is functional (enabled input + send)', () => {
        const input = document.getElementById('claudeComposerInput');
        const send = document.getElementById('claudeComposerSend');
        expect(input.disabled).toBe(false);
        expect(send.disabled).toBe(false);
    });
});

describe('Claude sheet — module surface and styling', () => {
    const claude = read('claudeSheet.js');
    const css = read('style.css');
    const main = read('main.js');
    const modals = read('modals.js');

    function extractTopLevelRule(selector) {
        let depth = 0;
        for (let i = 0; i < css.length; i++) {
            const c = css[i];
            if (c === '{') { depth++; continue; }
            if (c === '}') { depth--; continue; }
            if (depth !== 0) continue;
            if (css.startsWith(selector, i) && /[\s{]/.test(css[i + selector.length] || '')) {
                const blockStart = css.indexOf('{', i);
                const blockEnd = css.indexOf('}', blockStart);
                return css.slice(blockStart + 1, blockEnd);
            }
        }
        throw new Error(`Top-level rule for "${selector}" not found`);
    }

    it('exports the mount / open / close API', () => {
        expect(claude).toMatch(/export\s+function\s+mountClaudeSheet\s*\(/);
        expect(claude).toMatch(/export\s+function\s+openClaudeSheet\s*\(/);
        expect(claude).toMatch(/export\s+function\s+closeClaudeSheet\s*\(/);
    });

    it('rides touch events for the mobile swipe-down dismiss', () => {
        expect(claude).toMatch(/addEventListener\(\s*['"]touchstart['"]/);
        expect(claude).toMatch(/addEventListener\(\s*['"]touchmove['"]/);
        expect(claude).toMatch(/addEventListener\(\s*['"]touchend['"]/);
    });

    it('docks as a ~380px full-height right-hand panel on wide viewports', () => {
        const rule = extractTopLevelRule('#claudeSheet');
        expect(rule).toMatch(/position:\s*fixed/);
        expect(rule).toMatch(/right:\s*0/);
        expect(rule).toMatch(/width:\s*380px/);
        expect(rule).toMatch(/height:\s*100%/);
    });

    it('becomes a ~86% bottom sheet under the 700px breakpoint', () => {
        // The mobile form lives in a @media (max-width: 700px) block and
        // anchors to the bottom at ~86% height. A `#claudeSheet { ... }` rule
        // body runs to the first `}`, so [^}]* stays inside one block.
        expect(css).toMatch(/@media\s*\(\s*max-width:\s*700px\s*\)/);
        expect(css).toMatch(/#claudeSheet\s*\{[^}]*height:\s*86%/);
        expect(css).toMatch(/#claudeSheet\s*\{[^}]*bottom:\s*0/);
        // The grab handle only surfaces on mobile.
        expect(css).toMatch(/#claudeSheetHandle\s*\{[^}]*display:\s*block/);
        // The desktop close `×` is hidden on mobile (backdrop + swipe suffice).
        expect(css).toMatch(/#claudeSheetClose\s*\{[^}]*display:\s*none/);
    });

    it('styles the desktop close `×` as a positioned header affordance', () => {
        const rule = extractTopLevelRule('#claudeSheetClose');
        expect(rule).toMatch(/position:\s*absolute/);
        expect(rule).toMatch(/right:\s*\d+px/);
    });

    it('pins the launcher to the bottom-right and hides it under other modals', () => {
        const rule = extractTopLevelRule('#claudeLauncher');
        expect(rule).toMatch(/position:\s*fixed/);
        expect(rule).toMatch(/right:\s*\d+px/);
        expect(rule).toMatch(/bottom:\s*\d+px/);
        expect(css).toMatch(/body:has\(#settingsMenu\)\s+#claudeLauncher/);
        expect(css).toMatch(/body:has\(#helpModalBackdrop\)\s+#claudeLauncher/);
    });

    it('is mounted from main.js where the help FAB used to live, and the FAB is gone', () => {
        expect(main).toMatch(/import\s*\{\s*mountClaudeSheet\s*\}\s*from\s*['"]\.\/claudeSheet\.js['"]/);
        expect(main).toMatch(/mountClaudeSheet\(\s*base\s*\)/);
        expect(main).not.toMatch(/createHelpFab/);
    });

    it('keeps help reachable via the ghost-menu Help item (never orphaned)', () => {
        expect(main).toMatch(/buildSettingsMenuItem\(\s*['"]Help['"]\s*,/);
        const idx = main.indexOf("'Help',");
        expect(idx).toBeGreaterThan(-1);
        expect(main.slice(idx, idx + 400)).toMatch(/showHelpModal\s*\(\s*\)/);
        // showHelpModal still exists in modals.js for that menu item + `?` key.
        expect(modals).toMatch(/export\s+function\s+showHelpModal\s*\(/);
    });
});

// The author flow: a functional Chat tab that talks to the Worker, detects a
// fenced ```md drafted entry, and — behind an inline confirm — injects it and
// dispatches an entry-mode run tracked in the Runs tab.
const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick();
}

describe('Claude sheet — drafted entry detection', () => {
    it('extracts the inner text of a fenced ```md block', () => {
        const reply = 'Here you go:\n```md\n- [ ] **[LOW]** Do a thing\n  - Type: feature\n```\nLet me know.';
        const entry = extractDraftedEntry(reply);
        expect(entry).toContain('- [ ] **[LOW]** Do a thing');
        expect(entry).toContain('Type: feature');
        expect(entry).not.toContain('```');
    });

    it('returns null when the reply has no fenced md block', () => {
        expect(extractDraftedEntry('Just a plain reply, no entry.')).toBe(null);
        expect(extractDraftedEntry('```js\nconst x = 1;\n```')).toBe(null);
        expect(extractDraftedEntry('')).toBe(null);
    });
});

describe('Claude sheet — author flow (chat, draft card, inject & run)', () => {
    let realFetch;
    let fetchSpy;
    let statusJson;

    function makeFetch() {
        return vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            let json = { ok: true };
            if (body.chat) {
                json = { reply: 'Sure:\n```md\n- [ ] **[LOW]** Add a sparkle\n  - Type: feature\n```' };
            } else if (body.dispatch) {
                json = { dispatched: true, runUrl: 'https://github.com/x/y/actions/runs/1' };
            } else if (body.status) {
                json = statusJson;
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve(json),
            });
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        statusJson = { found: false };
        realFetch = globalThis.fetch;
        fetchSpy = makeFetch();
        globalThis.fetch = fetchSpy;
        mountClaudeSheet(document.body);
    });

    afterEach(() => {
        // Remounting against an empty store stops any interval pollers a test
        // left running, keeping them from leaking into later tests.
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function sendMessage(text) {
        const input = document.getElementById('claudeComposerInput');
        input.value = text;
        document.getElementById('claudeComposerSend').click();
        await flush();
    }

    it('enables the composer (no longer an inert placeholder)', () => {
        expect(document.getElementById('claudeComposerInput').disabled).toBe(false);
        expect(document.getElementById('claudeComposerSend').disabled).toBe(false);
    });

    it('renders user + assistant bubbles and POSTs { chat: true, messages }', async () => {
        await sendMessage('Add a sparkle feature');
        const chatCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).chat);
        expect(chatCall).toBeTruthy();
        const sent = JSON.parse(chatCall[1].body);
        expect(sent.chat).toBe(true);
        expect(Array.isArray(sent.messages)).toBe(true);
        expect(sent.messages[0]).toEqual({ role: 'user', content: 'Add a sparkle feature' });

        const bubbles = document.querySelectorAll('.claudeMsg');
        expect(bubbles.length).toBeGreaterThanOrEqual(2);
        expect(document.querySelector('.claudeMsg--user').textContent).toBe('Add a sparkle feature');
        expect(document.querySelector('.claudeMsg--assistant').textContent).toContain('Sure');
    });

    it('surfaces a drafted-entry card when the reply contains a fenced md block', async () => {
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        expect(card).toBeTruthy();
        expect(card.querySelector('.claudeDraftEntry').textContent).toContain('Add a sparkle');
        expect(card.querySelector('.claudeDraftInject').textContent).toBe('Inject & run');
    });

    it('Inject & run reveals an inline confirm; Cancel reverts it', async () => {
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        const injectBtn = card.querySelector('.claudeDraftInject');
        injectBtn.click();
        const confirm = card.querySelector('.claudeDraftConfirm');
        expect(confirm.hidden).toBe(false);
        expect(card.querySelector('.claudeDraftConfirmWarn').textContent)
            .toBe('This ships to main and deploys to your live app.');
        expect(card.querySelector('.claudeDraftShip').textContent).toBe('Ship it');
        card.querySelector('.claudeDraftCancel').click();
        expect(confirm.hidden).toBe(true);
        expect(injectBtn.hidden).toBe(false);
    });

    it('Ship it injects with an id marker, dispatches an entry run, and records it as QUEUED', async () => {
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        // Inject call carries the marker-embedded entry and matching id.
        const injectCall = fetchSpy.mock.calls.find((c) => {
            const b = JSON.parse(c[1].body);
            return !b.chat && !b.dispatch && !b.status && b.entry;
        });
        expect(injectCall).toBeTruthy();
        const injectBody = JSON.parse(injectCall[1].body);
        expect(injectBody.entry).toContain('<!-- id: ' + injectBody.id + ' -->');

        // Dispatch is entry-mode, targeting the injected id with a separate
        // correlation id.
        const dispatchCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).dispatch);
        expect(dispatchCall).toBeTruthy();
        const dispatchBody = JSON.parse(dispatchCall[1].body);
        expect(dispatchBody.mode).toBe('entry');
        expect(dispatchBody.entry_id).toBe(injectBody.id);
        expect(dispatchBody.correlation_id).toBeTruthy();
        expect(dispatchBody.correlation_id).not.toBe(injectBody.id);

        // A QUEUED run record appears in the Runs tab and is persisted.
        const sheet = document.getElementById('claudeSheet');
        expect(sheet.getAttribute('data-tab')).toBe('runs');
        const row = document.querySelector('.claudeRunRow');
        expect(row).toBeTruthy();
        expect(row.querySelector('.claudeRunBadge').textContent).toBe('Queued');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored.length).toBe(1);
        expect(stored[0].status).toBe('QUEUED');
        expect(stored[0].entryId).toBe(injectBody.id);
        expect(stored[0].correlationId).toBe(dispatchBody.correlation_id);
    });

    it('flips the run record to SHIPPED when the status poll reports success', async () => {
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).toBe('SHIPPED');
    });

    it('flips the run record to FAILED when the status poll reports a non-success conclusion', async () => {
        statusJson = { found: true, status: 'completed', conclusion: 'failure' };
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Failed');
    });

    it('re-renders persisted run records on a fresh mount (survive reload)', () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Persisted task', status: 'SHIPPED', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        const rows = document.querySelectorAll('.claudeRunRow');
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.claudeRunTitle').textContent).toBe('Persisted task');
        expect(rows[0].querySelector('.claudeRunBadge').textContent).toBe('Shipped');
    });
});

// The iterate door: tapping a SHIPPED run record opens the Chat tab and fires
// turn 1 carrying the run's entry id so the Worker seeds the conversation from
// that merged change. Follow-up drafts flow through the same author-flow card.
describe('Claude sheet — iterate from a shipped run', () => {
    let realFetch;
    let fetchSpy;
    let chatBodies;

    function makeFetch() {
        chatBodies = [];
        return vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            let json = { ok: true };
            let httpStatus = 200;
            let httpOk = true;
            if (body.chat) {
                chatBodies.push(body);
                json = { reply: 'Here is the diff context. What should change?\n```md\n- [ ] **[LOW]** Tweak the sparkle\n  - Type: feature\n```' };
            }
            return Promise.resolve({
                ok: httpOk,
                status: httpStatus,
                json: () => Promise.resolve(json),
            });
        });
    }

    function seedShippedRun() {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'entry-42', correlationId: 'corr-1', title: 'Add a sparkle', status: 'SHIPPED', dispatchedAt: Date.now() },
        ]));
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        realFetch = globalThis.fetch;
        fetchSpy = makeFetch();
        globalThis.fetch = fetchSpy;
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    it('marks a shipped run row as an iterable button', () => {
        seedShippedRun();
        mountClaudeSheet(document.body);
        const row = document.querySelector('.claudeRunRow');
        expect(row.classList.contains('claudeRunRow--iterable')).toBe(true);
        expect(row.getAttribute('role')).toBe('button');
        expect(row.getAttribute('tabindex')).toBe('0');
    });

    it('does not make a queued run row iterable', () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Pending', status: 'QUEUED', dispatchedAt: Date.now() },
        ]));
        mountClaudeSheet(document.body);
        const row = document.querySelector('.claudeRunRow');
        expect(row.classList.contains('claudeRunRow--iterable')).toBe(false);
        expect(row.getAttribute('role')).toBe(null);
    });

    it('tapping a shipped run opens Chat and sends turn 1 with the entry id', async () => {
        seedShippedRun();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRow').click();
        await flush();

        // Lands on the Chat tab.
        expect(document.getElementById('claudeSheet').getAttribute('data-tab')).toBe('chat');
        // Turn 1 carried the entry id alongside the chat contract.
        expect(chatBodies.length).toBe(1);
        expect(chatBodies[0].chat).toBe(true);
        expect(chatBodies[0].entry_id).toBe('entry-42');
        // The seeded reply renders as an assistant bubble.
        expect(document.querySelector('.claudeMsg--assistant').textContent).toContain('diff context');
    });

    it('sends a non-empty messages array on the iterate seed turn', async () => {
        seedShippedRun();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRow').click();
        await flush();

        // The Worker rejects an empty messages array (HTTP 400), so turn 1
        // must carry a synthesized opening user message alongside entry_id.
        expect(Array.isArray(chatBodies[0].messages)).toBe(true);
        expect(chatBodies[0].messages.length).toBeGreaterThan(0);
        expect(chatBodies[0].messages[0].role).toBe('user');
        expect(chatBodies[0].messages[0].content.trim()).not.toBe('');
        // The opening user turn is visible in the thread.
        expect(document.querySelector('.claudeMsg--user')).toBeTruthy();
    });

    it('omits the entry id on the next (manual) turn', async () => {
        seedShippedRun();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRow').click();
        await flush();

        const input = document.getElementById('claudeComposerInput');
        input.value = 'make it bigger';
        document.getElementById('claudeComposerSend').click();
        await flush();

        expect(chatBodies.length).toBe(2);
        expect(chatBodies[1].entry_id).toBeUndefined();
    });

    it('surfaces the follow-up drafted-entry card from the seeded reply', async () => {
        seedShippedRun();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRow').click();
        await flush();

        const card = document.querySelector('.claudeDraftCard');
        expect(card).toBeTruthy();
        expect(card.querySelector('.claudeDraftEntry').textContent).toContain('Tweak the sparkle');
    });

    it('shows a gentle "nothing to iterate on" note when the seed 404s', async () => {
        // Worker has no merged PR carrying this entry's marker → 404.
        globalThis.fetch = vi.fn(() => Promise.resolve({
            ok: false,
            status: 404,
            json: () => Promise.resolve({}),
        }));
        seedShippedRun();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRow').click();
        await flush();

        const assistant = document.querySelector('.claudeMsg--assistant');
        expect(assistant.classList.contains('claudeMsg--note')).toBe(true);
        expect(assistant.textContent).toContain('Nothing to iterate on yet');
        expect(document.querySelector('.claudeMsg--error')).toBe(null);
    });
});

// The layout inspector: when an assistant reply carries an `INSPECT: <selector>`
// directive, the chat strips it from the visible prose and offers a one-tap
// "Attach layout" button that serializes the live element and sends it back.
describe('Claude sheet — INSPECT directive detection', () => {
    it('captures the selector from an INSPECT directive line', () => {
        expect(extractInspectDirective('Let me look.\nINSPECT: #claudeSheet .claudeMsg'))
            .toBe('#claudeSheet .claudeMsg');
    });

    it('trims whitespace around the captured selector', () => {
        expect(extractInspectDirective('INSPECT:    .foo   ')).toBe('.foo');
    });

    it('returns null when no directive line is present', () => {
        expect(extractInspectDirective('Just prose, no directive.')).toBe(null);
        expect(extractInspectDirective('')).toBe(null);
    });
});

describe('Claude sheet — layout inspector attach flow', () => {
    let realFetch;
    let fetchSpy;
    let chatBodies;
    let replyText;

    function makeFetch() {
        chatBodies = [];
        return vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            let json = { ok: true };
            if (body.chat) {
                chatBodies.push(body);
                json = { reply: replyText };
            }
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve(json),
            });
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        replyText = 'Where is the message?\nINSPECT: #target';
        realFetch = globalThis.fetch;
        fetchSpy = makeFetch();
        globalThis.fetch = fetchSpy;
        mountClaudeSheet(document.body);
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function sendMessage(text) {
        const input = document.getElementById('claudeComposerInput');
        input.value = text;
        document.getElementById('claudeComposerSend').click();
        await flush();
    }

    it('strips the INSPECT line from the visible reply and renders an Attach layout button', async () => {
        await sendMessage('why is it misaligned?');
        const assistant = document.querySelector('.claudeMsg--assistant');
        expect(assistant.textContent).toContain('Where is the message?');
        expect(assistant.textContent).not.toContain('INSPECT:');
        const btn = document.querySelector('.claudeInspectBtn');
        expect(btn).toBeTruthy();
        expect(btn.textContent).toContain('#target');
    });

    it('shows a retry notice without sending a turn when the element is not on screen', async () => {
        await sendMessage('why is it misaligned?');
        const before = chatBodies.length;
        document.querySelector('.claudeInspectBtn').click();
        await flush();
        const notice = document.querySelector('.claudeInspectNotice');
        expect(notice.hidden).toBe(false);
        expect(notice.textContent).toContain("Couldn't find that element on screen");
        // No additional chat turn was sent, and the button stays tappable.
        expect(chatBodies.length).toBe(before);
        expect(document.querySelector('.claudeInspectBtn').disabled).toBeFalsy();
    });

    it('sends the serialized layout as the next user turn when the element is found', async () => {
        const target = document.createElement('div');
        target.id = 'target';
        document.body.appendChild(target);

        await sendMessage('why is it misaligned?');
        const before = chatBodies.length;
        // Clean follow-up reply so the new turn doesn't re-trigger the inspector.
        replyText = 'Thanks, I can see it now.';
        document.querySelector('.claudeInspectBtn').click();
        await flush();

        expect(chatBodies.length).toBe(before + 1);
        const sent = chatBodies[chatBodies.length - 1];
        const lastUser = sent.messages[sent.messages.length - 1];
        expect(lastUser.role).toBe('user');
        expect(lastUser.content).toContain('Live layout for `#target`');
        expect(lastUser.content).toContain('```json');
        expect(lastUser.content).toContain('"found": true');
        // The composed turn is visible in the thread.
        const userBubbles = document.querySelectorAll('.claudeMsg--user');
        expect(userBubbles[userBubbles.length - 1].textContent).toContain('Live layout for');
    });
});

// The freshness gate: after a fix ships, the installed PWA may still serve the
// old cached bundle. A SHIPPED transition forces an immediate SW update check;
// once a newer build is waiting, the Runs tab shows a reload nudge and the
// layout inspector refuses to measure the stale DOM.
describe('Claude sheet — freshness gate (SW update after ship)', () => {
    let realFetch;
    let fetchSpy;
    let statusJson;
    let chatBodies;
    let replyText;

    function makeFetch() {
        chatBodies = [];
        return vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            let json = { ok: true };
            if (body.chat) {
                chatBodies.push(body);
                json = { reply: replyText };
            } else if (body.dispatch) {
                json = { dispatched: true, runUrl: 'https://github.com/x/y/actions/runs/1' };
            } else if (body.status) {
                json = statusJson;
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        statusJson = { found: false };
        replyText = 'Where is it?\nINSPECT: #target';
        realFetch = globalThis.fetch;
        fetchSpy = makeFetch();
        globalThis.fetch = fetchSpy;
        mountClaudeSheet(document.body);
    });

    afterEach(() => {
        // Clear any pending-update registration this test set so the flag
        // doesn't leak into the next mount via hasPendingUpdate().
        notifyUpdateAvailable(null);
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function sendMessage(text) {
        const input = document.getElementById('claudeComposerInput');
        input.value = text;
        document.getElementById('claudeComposerSend').click();
        await flush();
    }

    it('dispatches requestSwUpdateCheck exactly once when a run reaches SHIPPED', async () => {
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        replyText = 'Sure:\n```md\n- [ ] **[LOW]** Add a sparkle\n  - Type: feature\n```';
        let fired = 0;
        const onCheck = () => { fired++; };
        document.addEventListener('requestSwUpdateCheck', onCheck);

        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();
        document.removeEventListener('requestSwUpdateCheck', onCheck);

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        expect(fired).toBe(1);
    });

    it('does not dispatch requestSwUpdateCheck for a non-shipped (failed) run', async () => {
        statusJson = { found: true, status: 'completed', conclusion: 'failure' };
        replyText = 'Sure:\n```md\n- [ ] **[LOW]** Add a sparkle\n  - Type: feature\n```';
        let fired = 0;
        const onCheck = () => { fired++; };
        document.addEventListener('requestSwUpdateCheck', onCheck);

        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();
        document.removeEventListener('requestSwUpdateCheck', onCheck);

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Failed');
        expect(fired).toBe(0);
    });

    it('shows the Runs reload nudge when appUpdateAvailable fires (hidden before)', () => {
        document.getElementById('claudeTabRuns').click();
        const nudge = document.getElementById('claudeUpdateNudge');
        expect(nudge.hidden).toBe(true);

        // notifyUpdateAvailable both registers the waiting worker and fires the
        // appUpdateAvailable event, matching the real dispatch path the nudge
        // now gates on (hasPendingUpdate()).
        notifyUpdateAvailable({ waiting: { postMessage() {} }, installing: null });
        expect(nudge.hidden).toBe(false);
        expect(nudge.querySelector('.claudeUpdateNudgeText').textContent)
            .toContain('A newer build is ready');
    });

    it('keeps the nudge hidden when the flag is set but no worker is waiting', () => {
        document.getElementById('claudeTabRuns').click();
        const nudge = document.getElementById('claudeUpdateNudge');
        // Bare event with no pending registration: updatePending flips true but
        // hasPendingUpdate() is false, so the defensive gate keeps it hidden
        // rather than surfacing a Reload button that would no-op.
        document.dispatchEvent(new CustomEvent('appUpdateAvailable'));
        expect(nudge.hidden).toBe(true);
    });

    it('clears the nudge when appUpdateApplied fires (new build took control)', () => {
        notifyUpdateAvailable({ waiting: { postMessage() {} }, installing: null });
        const nudge = document.getElementById('claudeUpdateNudge');
        expect(nudge.hidden).toBe(false);

        // index.js dispatches this on the SW controllerchange once the new
        // build is controlling — the cue is obsolete and must disappear.
        document.dispatchEvent(new CustomEvent('appUpdateApplied'));
        expect(nudge.hidden).toBe(true);
    });

    it('clears the nudge when Reload finds nothing left to apply', () => {
        // A worker was waiting (nudge shown) but has since activated, so the
        // registration is gone: applyPendingUpdate() returns false. The button
        // must clear the flag and hide the nudge instead of silently no-opping.
        notifyUpdateAvailable({ waiting: { postMessage() {} }, installing: null });
        const nudge = document.getElementById('claudeUpdateNudge');
        expect(nudge.hidden).toBe(false);

        notifyUpdateAvailable(null); // worker activated — nothing left to apply
        document.getElementById('claudeUpdateReload').click();
        expect(nudge.hidden).toBe(true);
    });

    it('the reload nudge button drives applyPendingUpdate (posts SKIP_WAITING)', () => {
        const posted = [];
        const fakeReg = { waiting: { postMessage: (m) => posted.push(m) }, installing: null };
        // notifyUpdateAvailable sets the pending registration AND fires the
        // appUpdateAvailable event the sheet listens for.
        notifyUpdateAvailable(fakeReg);

        const nudge = document.getElementById('claudeUpdateNudge');
        expect(nudge.hidden).toBe(false);
        document.getElementById('claudeUpdateReload').click();
        expect(posted.some((m) => m && m.type === 'SKIP_WAITING')).toBe(true);
    });

    it('seeds the nudge from hasPendingUpdate() on a fresh mount', () => {
        const fakeReg = { waiting: { postMessage() {} }, installing: null };
        notifyUpdateAvailable(fakeReg); // pending registration now set in modals
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        // Even though the event fired before this mount, the new mount reads
        // hasPendingUpdate() and surfaces the nudge.
        expect(document.getElementById('claudeUpdateNudge').hidden).toBe(false);
    });

    it('blocks the layout inspector while an update is pending and offers reload', async () => {
        // Element is on screen, so a non-gated capture WOULD succeed — proving
        // the pending flag is what blocks it.
        const target = document.createElement('div');
        target.id = 'target';
        document.body.appendChild(target);

        await sendMessage('why is it misaligned?');
        const before = chatBodies.length;
        document.dispatchEvent(new CustomEvent('appUpdateAvailable'));

        document.querySelector('.claudeInspectBtn').click();
        await flush();

        const notice = document.querySelector('.claudeInspectNotice');
        expect(notice.hidden).toBe(false);
        expect(notice.textContent).toContain("older build");
        expect(document.querySelector('.claudeInspectReload').hidden).toBe(false);
        // No layout turn was sent.
        expect(chatBodies.length).toBe(before);

        document.body.removeChild(target);
    });

    it('captures and sends normally when no update is pending', async () => {
        const target = document.createElement('div');
        target.id = 'target';
        document.body.appendChild(target);

        await sendMessage('why is it misaligned?');
        const before = chatBodies.length;
        replyText = 'Thanks, I can see it now.';
        document.querySelector('.claudeInspectBtn').click();
        await flush();

        expect(chatBodies.length).toBe(before + 1);
        const sent = chatBodies[chatBodies.length - 1];
        expect(sent.messages[sent.messages.length - 1].content).toContain('Live layout for');

        document.body.removeChild(target);
    });
});

describe('Claude sheet — freshness-gate module surface', () => {
    const claude = read('claudeSheet.js');
    const index = read('index.js');

    it('index.js exposes requestUpdateCheck and listens for requestSwUpdateCheck', () => {
        expect(index).toMatch(/export\s+function\s+requestUpdateCheck\s*\(/);
        expect(index).toMatch(/requestUpdateCheck[\s\S]*?\.update\(\s*\)/);
        expect(index).toMatch(
            /document\.addEventListener\(\s*['"]requestSwUpdateCheck['"]\s*,\s*requestUpdateCheck\s*\)/
        );
    });

    it('claudeSheet.js dispatches requestSwUpdateCheck on the SHIPPED transition', () => {
        expect(claude).toMatch(
            /dispatchEvent\(\s*new\s+CustomEvent\(\s*['"]requestSwUpdateCheck['"]/
        );
    });

    it('claudeSheet.js imports the SW-update helpers from modals.js', () => {
        const importMatch = claude.match(
            /import\s*\{([\s\S]*?)\}\s*from\s*['"]\.\/modals\.js['"]/
        );
        expect(importMatch).not.toBeNull();
        expect(importMatch[1]).toMatch(/applyPendingUpdate/);
        expect(importMatch[1]).toMatch(/hasPendingUpdate/);
    });

    it('listens for appUpdateAvailable to flip the update-pending flag', () => {
        expect(claude).toMatch(
            /document\.addEventListener\(\s*['"]appUpdateAvailable['"]/
        );
    });

    it('listens for appUpdateApplied to clear the update-pending flag', () => {
        expect(claude).toMatch(
            /document\.addEventListener\(\s*['"]appUpdateApplied['"]/
        );
    });

    it('index.js dispatches appUpdateApplied on the SW controllerchange', () => {
        expect(index).toMatch(
            /dispatchEvent\(\s*new\s+CustomEvent\(\s*['"]appUpdateApplied['"]/
        );
        expect(index).toMatch(/addEventListener\(\s*['"]controllerchange['"]/);
    });
});

describe('Claude sheet — author-flow module surface and styling', () => {
    const here2 = dirname(fileURLToPath(import.meta.url));
    const srcDir2 = resolve(here2, '../src');
    const claude = readFileSync(resolve(srcDir2, 'claudeSheet.js'), 'utf8');
    const inject = readFileSync(resolve(srcDir2, 'inject.js'), 'utf8');
    const css = readFileSync(resolve(srcDir2, 'style.css'), 'utf8');

    it('inject.js exports the shared helpers and chat/inject Worker calls', () => {
        expect(inject).toMatch(/export\s+async\s+function\s+chatWithWorker\s*\(/);
        expect(inject).toMatch(/export\s+async\s+function\s+injectEntry\s*\(/);
        expect(inject).toMatch(/export\s+function\s+mintEntryId\s*\(/);
        expect(inject).toMatch(/export\s+function\s+embedEntryMarker\s*\(/);
        // chatWithWorker POSTs the { chat: true, messages } contract.
        expect(inject).toMatch(/chat:\s*true,\s*messages/);
    });

    it('claudeSheet.js imports the author-flow helpers from inject.js', () => {
        expect(claude).toMatch(/from\s*['"]\.\/inject\.js['"]/);
        expect(claude).toMatch(/chatWithWorker/);
        expect(claude).toMatch(/injectEntry/);
        expect(claude).toMatch(/dispatchRun/);
        expect(claude).toMatch(/pollRunStatus/);
    });

    it('persists run records under the todoapp_ prefixed key', () => {
        expect(claude).toMatch(/todoapp_claudeRuns/);
    });

    it('styles the drafted-entry card, message bubbles, and run badges', () => {
        expect(css).toMatch(/\.claudeDraftCard\s*\{/);
        expect(css).toMatch(/\.claudeMsg--user\s*\{/);
        expect(css).toMatch(/\.claudeMsg--assistant\s*\{/);
        expect(css).toMatch(/\.claudeRunBadge--shipped\s*\{/);
    });
});
