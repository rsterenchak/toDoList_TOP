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
} from '../src/claudeSheet.js';
import { initInjectConfig } from '../src/inject.js';

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
