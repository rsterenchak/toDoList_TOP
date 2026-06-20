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
    splitRenderableBlocks,
    renderAssistantContent,
} from '../src/claudeSheet.js';
import { initInjectConfig } from '../src/inject.js';
import { notifyUpdateAvailable } from '../src/modals.js';

// The chat workspace menu projects its repo list from the user's Inject targets
// (the `inject_targets` Supabase table, cached in inject.js) rather than the
// Worker allowlist. To drive that source in these runtime tests we mock the
// shared Supabase client so the `inject_targets` select returns a configurable
// set of rows. `supaState.injectTargets` is the knob; `setInjectTargets` seeds
// it from a list of repo strings. The mock mirrors the real stub's surface
// (auth/from/channel/removeChannel) so every non-targets path behaves exactly as
// it did with the unmocked stub. A file-level beforeEach resets the knob to an
// empty list so a block that doesn't seed targets gets the safe default-repo
// fallback, matching prior behavior.
const { supaState } = vi.hoisted(() => ({ supaState: { injectTargets: [] } }));

vi.mock('../src/supabaseClient.js', () => {
    function makeQuery(table) {
        const q = {
            select: function() { return q; },
            order: function() {
                if (table === 'inject_targets') {
                    return Promise.resolve({ data: supaState.injectTargets.slice(), error: null });
                }
                return Promise.resolve({ data: [], error: null });
            },
            insert: function() { return Promise.resolve({ data: null, error: null }); },
            update: function() { return q; },
            delete: function() { return q; },
            eq: function() { return Promise.resolve({ data: null, error: null }); },
        };
        return q;
    }
    return {
        supabase: {
            auth: {
                getSession: function() { return Promise.resolve({ data: { session: null }, error: null }); },
                onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
                signInWithOtp: function() { return Promise.resolve({ data: null, error: { message: 'Supabase not configured' } }); },
                signOut: function() { return Promise.resolve({ error: null }); },
            },
            from: function(table) { return makeQuery(table); },
            channel: function() { return { on: function() { return this; }, subscribe: function() { return this; }, unsubscribe: function() { return this; } }; },
            removeChannel: function() {},
        },
    };
});

// Seed the mocked inject_targets cache from a list of repo strings; the menu
// projects each row's `repo`, so the row shape only needs `repo` to matter.
function setInjectTargets(repos) {
    supaState.injectTargets = repos.map(function(repo, i) {
        return { id: 'tgt-' + i, nickname: repo, repo: repo, file_path: 'TODO.md' };
    });
}

// Reset the targets source before every test so blocks that don't seed it fall
// back to the default repo only (prior behavior). Blocks that need a multi-repo
// menu seed it in their own beforeEach, which runs after this one.
beforeEach(() => {
    supaState.injectTargets = [];
});

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

    it('nests the close `×` in its own row sitting above the tab list', () => {
        const closeRow = document.getElementById('claudeSheetCloseRow');
        const closeX = document.getElementById('claudeSheetClose');
        const tabs = document.getElementById('claudeSheetTabs');
        expect(closeRow).toBeTruthy();
        expect(closeRow.contains(closeX)).toBe(true);
        expect(tabs.contains(closeX)).toBe(false);
        // The row must precede the tab list in DOM order.
        expect(closeRow.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
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

    it('mounts the file-picker button as the leading composer control', () => {
        const attach = document.getElementById('claudeComposerAttach');
        const header = document.getElementById('claudeSheetTabs');
        const composer = document.getElementById('claudeComposer');
        const input = document.getElementById('claudeComposerInput');
        const send = document.getElementById('claudeComposerSend');
        expect(attach).toBeTruthy();
        expect(composer.contains(attach)).toBe(true);
        expect(header.contains(attach)).toBe(false);
        // Row order is [📎] [🎤] [input] [Send]: the attach wrapper leads the row
        // (precedes the input) and Send is last in document order.
        const attachWrap = attach.closest('.claudeAttach');
        expect(attachWrap.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
        expect(input.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('hides the file-picker button on the Runs tab and restores it on Chat', () => {
        const attach = document.getElementById('claudeComposerAttach');
        expect(attach.hidden).toBe(false);
        document.getElementById('claudeTabRuns').click();
        expect(attach.hidden).toBe(true);
        document.getElementById('claudeTabChat').click();
        expect(attach.hidden).toBe(false);
    });
});

describe('Claude sheet — module surface and styling', () => {
    const claude = read('claudeSheet.js');
    const css = read('style.css');
    const main = read('main.js');
    const modals = read('modals.js');
    // The desktop ghost-menu (incl. its Help item) was extracted into
    // settingsMenu.js; the gear trigger + mount stay in main.js.
    const settingsMenu = read('settingsMenu.js');

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

    it('retires the desktop docked panel — at ≥1024px the sheet and launcher are hidden for the persistent pane', () => {
        // D2 supersedes the old ~380px right-hand docked sheet: at desktop
        // widths the slide-up sheet and its bottom-right launcher have no
        // presence, because the chat content is relocated into the persistent
        // #desktopChatPane (see placeChatContent / the D2 CSS block).
        expect(css).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?#claudeSheet\s*\{\s*display:\s*none\s*;?\s*\}/
        );
        expect(css).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?#claudeLauncher\s*\{\s*display:\s*none\s*;?\s*\}/
        );
        // The shared sheet base still provides the column flex layout the
        // mobile bottom sheet relies on.
        const rule = extractTopLevelRule('#claudeSheet');
        expect(rule).toMatch(/display:\s*flex/);
        expect(rule).toMatch(/flex-direction:\s*column/);
    });

    it('becomes a ~86% bottom sheet under the 1023px breakpoint', () => {
        // The mobile form lives in a @media (max-width: 1023px) block and
        // anchors to the bottom at ~86% height. A `#claudeSheet { ... }` rule
        // body runs to the first `}`, so [^}]* stays inside one block.
        expect(css).toMatch(/@media\s*\(\s*max-width:\s*1023px\s*\)/);
        expect(css).toMatch(/#claudeSheet\s*\{[^}]*height:\s*86%/);
        expect(css).toMatch(/#claudeSheet\s*\{[^}]*bottom:\s*0/);
        // The grab handle only surfaces on mobile.
        expect(css).toMatch(/#claudeSheetHandle\s*\{[^}]*display:\s*block/);
        // The desktop close `×` is hidden on mobile (backdrop + swipe suffice).
        expect(css).toMatch(/#claudeSheetClose\s*\{[^}]*display:\s*none/);
    });

    it('styles the desktop close `×` in a right-aligned row above the tabs', () => {
        const row = extractTopLevelRule('.claudeSheetCloseRow');
        expect(row).toMatch(/display:\s*flex/);
        expect(row).toMatch(/justify-content:\s*flex-end/);
        // The `×` no longer overlays the corner — it sits as a flex child of
        // the close row, so it must not rely on absolute positioning.
        const close = extractTopLevelRule('#claudeSheetClose');
        expect(close).not.toMatch(/position:\s*absolute/);
    });

    it('aligns the composer controls (attach, mic, input, send) in one vertically-centered row', () => {
        const composer = extractTopLevelRule('.claudeComposer');
        expect(composer).toMatch(/display:\s*flex/);
        // The row centers every control on the cross axis. The old
        // `align-items: flex-end` (container) + `align-self: center`
        // (buttons only) mix left the textarea bottom-aligned while the
        // buttons centered — the misalignment this fixes.
        expect(composer).toMatch(/align-items:\s*center/);
        expect(composer).not.toMatch(/align-items:\s*flex-end/);
        // No per-control alignment override remains to fight the container's
        // centering — every control inherits the single, uniform alignment.
        expect(extractTopLevelRule('.claudeComposerAttach')).not.toMatch(/align-self/);
        expect(extractTopLevelRule('.claudeComposerSend')).not.toMatch(/align-self/);
        expect(extractTopLevelRule('.micButton')).not.toMatch(/align-self/);
    });

    it('gives the mic button the composer purple outer glow (box-shadow halo)', () => {
        // The mic button was missing the purple halo the rest of the composer's
        // purple-glow family carries (the input focus ring uses the same
        // rgba(108, 93, 245, …) accent). Assert the base .micButton rule now
        // paints an outer box-shadow glow in that purple.
        const mic = extractTopLevelRule('.micButton');
        expect(mic).toMatch(/box-shadow:[^;]*rgba\(\s*108\s*,\s*93\s*,\s*245\b/);
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
        expect(settingsMenu).toMatch(/buildSettingsMenuItem\(\s*['"]Help['"]\s*,/);
        const idx = settingsMenu.indexOf("'Help',");
        expect(idx).toBeGreaterThan(-1);
        expect(settingsMenu.slice(idx, idx + 400)).toMatch(/showHelpModal\s*\(\s*\)/);
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
    let resolveJson;

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
            } else if (body.resolve) {
                json = resolveJson;
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
        resolveJson = { found: false };
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

    // Find a draft card whose entry text contains the given snippet — needed
    // because the mock assistant reply always emits its own card too, so a
    // user-paste turn produces two cards on the surface.
    function cardContaining(snippet) {
        return [...document.querySelectorAll('.claudeDraftCard')].find(
            (c) => c.querySelector('.claudeDraftEntry').textContent.includes(snippet)
        );
    }

    it('renders an Inject card from a user-pasted fenced md entry', async () => {
        await sendMessage('here: ```md\n- [ ] **[LOW]** Pasted thing\n  - Type: feature\n``` thoughts?');
        const card = cardContaining('Pasted thing');
        expect(card).toBeTruthy();
        expect(card.querySelector('.claudeDraftInject').textContent).toBe('Inject & run');
        // The card renders below the user message bubble it came from.
        const userBubble = document.querySelector('.claudeMsg--user');
        expect(userBubble.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('ships a user-pasted entry through the same shipDraftedEntry path', async () => {
        await sendMessage('```md\n- [ ] **[LOW]** Pasted thing\n  - Type: feature\n```');
        const card = cardContaining('Pasted thing');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        const injectCall = fetchSpy.mock.calls.find((c) => {
            const b = JSON.parse(c[1].body);
            return !b.chat && !b.dispatch && !b.status && b.entry;
        });
        expect(injectCall).toBeTruthy();
        const injectBody = JSON.parse(injectCall[1].body);
        expect(injectBody.entry).toContain('Pasted thing');
        expect(injectBody.entry).toContain('<!-- id: ' + injectBody.id + ' -->');
    });

    it('renders only the first card when a user paste has multiple md blocks', async () => {
        await sendMessage('```md\n- [ ] **[LOW]** First block\n  - Type: feature\n```\nand\n```md\n- [ ] **[LOW]** Second block\n  - Type: bug\n```');
        expect(cardContaining('First block')).toBeTruthy();
        expect(cardContaining('Second block')).toBeFalsy();
    });

    it('still surfaces the assistant-emitted card when the user message has no md block', async () => {
        await sendMessage('plain question, no entry');
        // The user turn contributes no card; only the assistant reply's card shows.
        const cards = document.querySelectorAll('.claudeDraftCard');
        expect(cards.length).toBe(1);
        expect(cards[0].querySelector('.claudeDraftEntry').textContent).toContain('Add a sparkle');
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

    it('marks a non-terminal record with no correlation id as unconfirmed on mount (never asserts FAILED)', () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', title: 'No correlation id', status: 'RUNNING', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        // A record that can never be polled isn't proof of failure — it's
        // unconfirmed. The pill reads "Unknown", not "Failed".
        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Unknown');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).not.toBe('FAILED');
        expect(stored[0].unconfirmed).toBe(true);
    });

    it('marks a record dispatched past the give-up window as unconfirmed on mount (never asserts FAILED)', async () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Stale running', status: 'RUNNING', dispatchedAt: Date.now() - 21 * 60 * 1000 },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();
        // Aged out of the poll window with no resolution = couldn't confirm,
        // not confirmed failure. Leave the last-known status, flag unconfirmed.
        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Unknown');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).not.toBe('FAILED');
        expect(stored[0].unconfirmed).toBe(true);
    });

    it('defines a 20-minute give-up window and leaves the 5-second poll interval untouched', () => {
        const claude = read('claudeSheet.js');
        expect(claude).toMatch(/RUN_GIVE_UP_MS\s*=\s*20\s*\*\s*60\s*\*\s*1000/);
        expect(claude).not.toMatch(/RUN_GIVE_UP_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
        expect(claude).toMatch(/RUN_POLL_INTERVAL_MS\s*=\s*5000/);
    });

    it('keeps watching a record 19 minutes after dispatch — within the 20-minute give-up window', async () => {
        // Before the window was extended to 20 minutes a 19-minute-old record
        // would have aged out and rendered "Unknown". With the longer window it
        // is still in-flight, so the pill keeps its last-known RUNNING state.
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Long running', status: 'RUNNING', dispatchedAt: Date.now() - 19 * 60 * 1000 },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();
        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Running');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].unconfirmed).not.toBe(true);
    });

    it('marks the run unconfirmed when the poll reports completed with a non-failure conclusion', async () => {
        statusJson = { found: true, status: 'completed', conclusion: 'neutral' };
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();
        // 'neutral' is neither success nor a positive failure signal, so the
        // outcome can't be asserted either way — it's unconfirmed.
        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Unknown');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).not.toBe('FAILED');
        expect(stored[0].unconfirmed).toBe(true);
    });

    it('flips to FAILED for cancelled and timed_out conclusions (positive failure signals)', async () => {
        for (const conclusion of ['cancelled', 'timed_out']) {
            localStorage.clear();
            document.body.innerHTML = '';
            mountClaudeSheet(document.body);
            statusJson = { found: true, status: 'completed', conclusion };
            await sendMessage('draft me an entry');
            const card = document.querySelector('.claudeDraftCard');
            card.querySelector('.claudeDraftInject').click();
            card.querySelector('.claudeDraftShip').click();
            await flush();
            expect(document.querySelector('.claudeRunBadge').textContent).toBe('Failed');
        }
    });

    it('keeps polling a recent non-terminal record with a correlation id (not prematurely failed)', () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Fresh running', status: 'RUNNING', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        // Status response is unresolved ({ found: false }); the record stays
        // RUNNING rather than being marked FAILED while still within the window.
        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Running');
    });

    it('promotes a FAILED record to SHIPPED on mount when its marker resolves to a merged PR', async () => {
        // A record over-asserted as FAILED still carries its entry-id marker.
        // That marker turning up in a merged PR (resolve → found:true with a
        // merge_commit_sha) is positive proof the work shipped, so the
        // reconcile must retroactively correct the row to SHIPPED.
        resolveJson = { found: true, pr_number: 1, merge_commit_sha: 'abc' };
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'False failure', status: 'FAILED', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).toBe('SHIPPED');
        // The resolve check is attempted at most once per session, no busy-loop.
        expect(stored[0].resolveAttempted).toBe(true);
        const resolveCalls = fetchSpy.mock.calls.filter((c) => JSON.parse(c[1].body).resolve);
        expect(resolveCalls.length).toBe(1);
        expect(JSON.parse(resolveCalls[0][1].body).entry_id).toBe('e1');
    });

    it('leaves a FAILED record FAILED on mount when its marker does not resolve to a merged PR', async () => {
        // No merged PR carries the marker (resolve → found:false): there is no
        // positive proof of a ship, so the row must stay FAILED — never a false
        // promotion.
        resolveJson = { found: false };
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Real failure', status: 'FAILED', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Failed');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).toBe('FAILED');
        expect(stored[0].resolveAttempted).toBe(true);
    });
});

// An end-to-end integration test for the chat → inject flow — the single most
// load-bearing path in the assistant (author an entry in chat, then ship it to
// TODO.md and dispatch a run). The other author-flow tests assert each piece in
// isolation (the pill renders, the draft card surfaces, ship records a run);
// none walk the WHOLE path in one shot. So a structural change that detaches the
// state the inject path depends on — e.g. relocating the workspace pill to its
// own row, which previously broke this flow while every piecewise test still
// passed — slips through. This test exercises mount → chat → draft → inject →
// ship → run record continuously, with assertions on the structural wiring (the
// pill living in the tab row, the active workspace repo riding the chat turn) so
// that class of regression fails here.
describe('Claude sheet — chat → inject integration (end-to-end author path)', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    let realFetch;
    let fetchSpy;

    function makeFetch() {
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            }
            const body = JSON.parse(opts.body);
            let json = { ok: true };
            if (body.chat) {
                json = { reply: 'On it:\n```md\n- [ ] **[LOW]** Add a sparkle\n  - Type: feature\n```' };
            } else if (body.dispatch) {
                json = { dispatched: true, runUrl: 'https://github.com/x/y/actions/runs/1' };
            } else if (body.status) {
                json = { found: false };
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

    it('walks mount → chat → draft → inject → ship → run record without a broken link', async () => {
        // (1) Freshly mounted: the Chat tab is active and the composer is usable —
        // the entry point for the whole flow.
        const sheet = document.getElementById('claudeSheet');
        expect(sheet.getAttribute('data-tab')).toBe('chat');
        const input = document.getElementById('claudeComposerInput');
        const send = document.getElementById('claudeComposerSend');
        expect(input.disabled).toBe(false);
        expect(send.disabled).toBe(false);
        // The workspace pill lives in the tab row. A prior change moved it to its
        // own row and detached the inject wiring; pinning its location here makes
        // that structural drift visible.
        const pill = document.getElementById('claudeWorkspacePill');
        expect(pill).toBeTruthy();
        expect(document.getElementById('claudeSheetTabs').contains(pill)).toBe(true);

        // (2) Author a turn; the seeded reply carries a fenced ```md draft.
        input.value = 'draft me a sparkle feature';
        send.click();
        await flush();
        // The chat turn carried the active workspace repo — the wiring that
        // regressed when the pill moved rows.
        const chatCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).chat);
        expect(chatCall).toBeTruthy();
        expect(JSON.parse(chatCall[1].body).repo).toBe(DEFAULT_REPO);

        // (3) The drafted-entry card surfaces from that reply.
        const card = document.querySelector('.claudeDraftCard');
        expect(card).toBeTruthy();
        expect(card.querySelector('.claudeDraftEntry').textContent).toContain('Add a sparkle');

        // (4) Inject & run → Ship it drives the inject + entry-mode dispatch calls.
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        const injectCall = fetchSpy.mock.calls.find((c) => {
            const b = JSON.parse(c[1].body);
            return !b.chat && !b.dispatch && !b.status && b.entry;
        });
        expect(injectCall).toBeTruthy();
        const injectBody = JSON.parse(injectCall[1].body);
        expect(injectBody.entry).toContain('<!-- id: ' + injectBody.id + ' -->');

        const dispatchCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).dispatch);
        expect(dispatchCall).toBeTruthy();
        const dispatchBody = JSON.parse(dispatchCall[1].body);
        expect(dispatchBody.mode).toBe('entry');
        expect(dispatchBody.entry_id).toBe(injectBody.id);

        // (5) The flow lands on the Runs tab with a persisted QUEUED record whose
        // id matches the just-injected entry — proving the chain held end to end.
        expect(sheet.getAttribute('data-tab')).toBe('runs');
        const row = document.querySelector('.claudeRunRow');
        expect(row).toBeTruthy();
        expect(row.querySelector('.claudeRunBadge').textContent).toBe('Queued');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored.length).toBe(1);
        expect(stored[0].status).toBe('QUEUED');
        expect(stored[0].entryId).toBe(injectBody.id);
    });
});

// Shipping a drafted entry must land it in the ACTIVE workspace repo, not the
// Worker's default. The inject and dispatch requests both carry repo/filePath
// built from the workspace pill's current selection, so switching the pill to a
// non-default repo and then shipping sends that repo on both calls. A prior bug
// shipped every entry to the default repo regardless of the pill; this pins the
// fix so the wiring can't silently drop the target again.
describe('Claude sheet — ship targets the active workspace repo', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    const OTHER_REPO = 'rsterenchak/matchingGame-test';
    let realFetch;
    let fetchSpy;

    function makeFetch() {
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            }
            const body = JSON.parse(opts.body);
            let json = { ok: true };
            if (body.repos) {
                json = {
                    ok: true,
                    default: DEFAULT_REPO,
                    repos: [
                        { repo: DEFAULT_REPO, srcPrefix: 'toDoList_main/src/' },
                        { repo: OTHER_REPO, srcPrefix: 'src/' },
                    ],
                };
            } else if (body.chat) {
                json = { reply: 'On it:\n```md\n- [ ] **[LOW]** Add a sparkle\n  - Type: feature\n```' };
            } else if (body.dispatch) {
                json = { dispatched: true, runUrl: 'https://github.com/x/y/actions/runs/1' };
            } else if (body.status) {
                json = { found: false };
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
        });
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        // The workspace menu projects the Inject targets; seed the non-default
        // repo this block switches to.
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        realFetch = globalThis.fetch;
        fetchSpy = makeFetch();
        globalThis.fetch = fetchSpy;
        mountClaudeSheet(document.body);
        // The workspace list loads asynchronously on mount; let it resolve so
        // the pill menu lists the non-default repo this test switches to.
        await flush();
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function switchWorkspace(repo) {
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + repo + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmYes').click();
        await flush();
    }

    async function authorAndShip() {
        const input = document.getElementById('claudeComposerInput');
        input.value = 'draft me a sparkle feature';
        document.getElementById('claudeComposerSend').click();
        await flush();
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();
    }

    function findInjectBody() {
        const call = fetchSpy.mock.calls.find((c) => {
            const b = JSON.parse(c[1].body);
            return !b.chat && !b.dispatch && !b.status && !b.repos && b.entry;
        });
        return call ? JSON.parse(call[1].body) : null;
    }

    function findDispatchBody() {
        const call = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).dispatch);
        return call ? JSON.parse(call[1].body) : null;
    }

    function findStatusBody() {
        const call = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).status);
        return call ? JSON.parse(call[1].body) : null;
    }

    it('sends the switched repo on both inject and dispatch', async () => {
        await switchWorkspace(OTHER_REPO);
        await authorAndShip();

        const injectBody = findInjectBody();
        expect(injectBody).toBeTruthy();
        expect(injectBody.repo).toBe(OTHER_REPO);
        expect(injectBody.filePath).toBe('TODO.md');

        const dispatchBody = findDispatchBody();
        expect(dispatchBody).toBeTruthy();
        expect(dispatchBody.repo).toBe(OTHER_REPO);
        expect(dispatchBody.filePath).toBe('TODO.md');
    });

    it('sends the default repo on both calls when the pill is left at default', async () => {
        await authorAndShip();

        const injectBody = findInjectBody();
        expect(injectBody).toBeTruthy();
        expect(injectBody.repo).toBe(DEFAULT_REPO);
        expect(injectBody.filePath).toBe('TODO.md');

        const dispatchBody = findDispatchBody();
        expect(dispatchBody).toBeTruthy();
        expect(dispatchBody.repo).toBe(DEFAULT_REPO);
        expect(dispatchBody.filePath).toBe('TODO.md');
    });

    // The status poller must query the same repo the run was dispatched to.
    // Before this fix the poll always hit the Worker's default repo, so a run
    // shipped to a non-default workspace never surfaced and sat unconfirmed.
    it('polls run status against the switched repo', async () => {
        await switchWorkspace(OTHER_REPO);
        await authorAndShip();

        const statusBody = findStatusBody();
        expect(statusBody).toBeTruthy();
        expect(statusBody.repo).toBe(OTHER_REPO);
        expect(statusBody.filePath).toBe('TODO.md');
    });

    it('polls run status against the default repo when the pill is left at default', async () => {
        await authorAndShip();

        const statusBody = findStatusBody();
        expect(statusBody).toBeTruthy();
        expect(statusBody.repo).toBe(DEFAULT_REPO);
        expect(statusBody.filePath).toBe('TODO.md');
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

// Clear-completed: a low-emphasis affordance at the foot of the Runs list that
// removes terminal records (SHIPPED / FAILED / unconfirmed) after an inline
// confirm, while leaving in-flight (RUNNING / QUEUED) records untouched.
describe('Claude sheet — clear completed runs', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
    });

    function seed(records) {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify(records));
        mountClaudeSheet(document.body);
    }

    it('hides the clear button when no terminal records exist', () => {
        seed([
            { entryId: 'e1', correlationId: 'c1', title: 'Pending', status: 'QUEUED', dispatchedAt: Date.now() },
            { entryId: 'e2', correlationId: 'c2', title: 'Working', status: 'RUNNING', dispatchedAt: Date.now() },
        ]);
        expect(document.getElementById('claudeRunsClear')).toBe(null);
    });

    it('shows the clear button when at least one terminal record exists', () => {
        seed([
            { entryId: 'e1', correlationId: 'c1', title: 'Done', status: 'SHIPPED', dispatchedAt: Date.now() },
        ]);
        expect(document.getElementById('claudeRunsClear')).toBeTruthy();
    });

    it('confirms before clearing — first tap reveals the confirm, records untouched', () => {
        seed([
            { entryId: 'e1', correlationId: 'c1', title: 'Done', status: 'SHIPPED', dispatchedAt: Date.now() },
        ]);
        const btn = document.getElementById('claudeRunsClear');
        const confirm = document.querySelector('.claudeRunsClearConfirm');
        expect(confirm.hidden).toBe(true);
        btn.click();
        expect(btn.hidden).toBe(true);
        expect(confirm.hidden).toBe(false);
        // The confirm prompt names the count and reassures about in-flight runs.
        const warn = document.querySelector('.claudeRunsClearConfirmWarn').textContent;
        expect(warn).toContain('1');
        expect(warn).toContain('In-flight runs stay.');
        // Nothing removed yet — rows and storage are intact until confirmed.
        expect(document.querySelectorAll('.claudeRunRow').length).toBe(1);
        expect(JSON.parse(localStorage.getItem('todoapp_claudeRuns')).length).toBe(1);
    });

    it('cancel dismisses the confirm and keeps the records', () => {
        seed([
            { entryId: 'e1', correlationId: 'c1', title: 'Done', status: 'SHIPPED', dispatchedAt: Date.now() },
        ]);
        document.getElementById('claudeRunsClear').click();
        document.querySelector('.claudeRunsClearCancel').click();
        expect(document.querySelector('.claudeRunsClearConfirm').hidden).toBe(true);
        expect(document.getElementById('claudeRunsClear').hidden).toBe(false);
        expect(document.querySelectorAll('.claudeRunRow').length).toBe(1);
    });

    it('clears SHIPPED, FAILED, and unconfirmed records but preserves RUNNING and QUEUED', () => {
        seed([
            { entryId: 'e1', correlationId: 'c1', title: 'Shipped one', status: 'SHIPPED', dispatchedAt: Date.now() },
            { entryId: 'e2', correlationId: 'c2', title: 'Failed one', status: 'FAILED', dispatchedAt: Date.now() },
            { entryId: 'e3', correlationId: 'c3', title: 'Unknown one', status: 'RUNNING', unconfirmed: true, dispatchedAt: Date.now() },
            { entryId: 'e4', correlationId: 'c4', title: 'Running one', status: 'RUNNING', dispatchedAt: Date.now() },
            { entryId: 'e5', correlationId: 'c5', title: 'Queued one', status: 'QUEUED', dispatchedAt: Date.now() },
        ]);
        document.getElementById('claudeRunsClear').click();
        document.querySelector('.claudeRunsClearYes').click();

        const titles = Array.from(document.querySelectorAll('.claudeRunTitle'))
            .map(function(el) { return el.textContent; });
        expect(titles).toEqual(['Running one', 'Queued one']);
    });

    it('reflects the cleared state in localStorage after confirming', () => {
        seed([
            { entryId: 'e1', correlationId: 'c1', title: 'Shipped one', status: 'SHIPPED', dispatchedAt: Date.now() },
            { entryId: 'e2', correlationId: 'c2', title: 'Running one', status: 'RUNNING', dispatchedAt: Date.now() },
        ]);
        document.getElementById('claudeRunsClear').click();
        document.querySelector('.claudeRunsClearYes').click();

        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored.length).toBe(1);
        expect(stored[0].correlationId).toBe('c2');
        expect(stored[0].status).toBe('RUNNING');
    });

    it('removes the clear button once only in-flight records remain', () => {
        seed([
            { entryId: 'e1', correlationId: 'c1', title: 'Shipped one', status: 'SHIPPED', dispatchedAt: Date.now() },
            { entryId: 'e2', correlationId: 'c2', title: 'Running one', status: 'RUNNING', dispatchedAt: Date.now() },
        ]);
        document.getElementById('claudeRunsClear').click();
        document.querySelector('.claudeRunsClearYes').click();
        expect(document.getElementById('claudeRunsClear')).toBe(null);
    });
});

// File attachments: a composer paperclip opens a picker sourced from
// src-manifest.json; selecting files adds chips whose paths ride along as
// `attach_files` on every chat turn (per-conversation accumulation), with a
// thread intro row naming them and a "+ New" reset.
describe('Claude sheet — file attachments', () => {
    const MANIFEST = [
        'toDoList_main/src/claudeSheet.js',
        'toDoList_main/src/layoutInspect.js',
        'toDoList_main/src/inject.js',
    ];
    let realFetch;
    let fetchSpy;
    let chatBodies;

    function makeFetch() {
        chatBodies = [];
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(MANIFEST),
                });
            }
            const body = JSON.parse(opts.body);
            if (body.chat) chatBodies.push(body);
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ reply: 'ok' }),
            });
        });
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
        mountClaudeSheet(document.body);
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function openPicker() {
        document.getElementById('claudeComposerAttach').click();
        await flush();
    }

    function selectFile(path) {
        document.querySelector('.claudeAttachItem[data-path="' + path + '"]').click();
    }

    async function sendMessage(text) {
        const input = document.getElementById('claudeComposerInput');
        input.value = text;
        document.getElementById('claudeComposerSend').click();
        await flush();
    }

    it('opens the picker from the composer and lists files from the manifest', async () => {
        expect(document.getElementById('claudeAttachPanel').hidden).toBe(true);
        await openPicker();
        expect(document.getElementById('claudeAttachPanel').hidden).toBe(false);
        const items = Array.from(document.querySelectorAll('.claudeAttachItem'));
        expect(items.map((el) => el.dataset.path)).toEqual(MANIFEST);
    });

    it('anchors the open picker panel to the composer button, not the header', async () => {
        await openPicker();
        const panel = document.getElementById('claudeAttachPanel');
        const button = document.getElementById('claudeComposerAttach');
        const header = document.getElementById('claudeSheetTabs');
        const composer = document.getElementById('claudeComposer');
        // The panel shares the button's picker-dropdown wrapper, which now lives
        // in the composer row — never back in the header tab row it used to
        // anchor to.
        const container = button.closest('.claudeAttach');
        expect(container).toBeTruthy();
        expect(container.contains(panel)).toBe(true);
        expect(composer.contains(panel)).toBe(true);
        expect(header.contains(panel)).toBe(false);
    });

    it('closes the picker panel on a click outside it', async () => {
        await openPicker();
        const panel = document.getElementById('claudeAttachPanel');
        expect(panel.hidden).toBe(false);
        document.body.click();
        expect(panel.hidden).toBe(true);
    });

    it('keeps the picker panel open on clicks inside it (filter input, file row)', async () => {
        await openPicker();
        const panel = document.getElementById('claudeAttachPanel');
        // Typing in / clicking the filter input must not be read as "outside".
        document.getElementById('claudeAttachSearch').click();
        expect(panel.hidden).toBe(false);
        // Selecting a file rebuilds the list (detaching the clicked row), yet the
        // panel must stay open — only an outside click closes it.
        selectFile('toDoList_main/src/claudeSheet.js');
        expect(panel.hidden).toBe(false);
    });

    it('filters the file list by the search input', async () => {
        await openPicker();
        const search = document.getElementById('claudeAttachSearch');
        search.value = 'layout';
        search.dispatchEvent(new Event('input'));
        const items = Array.from(document.querySelectorAll('.claudeAttachItem'));
        expect(items.map((el) => el.dataset.path)).toEqual(['toDoList_main/src/layoutInspect.js']);
    });

    it('adds a chip showing the basename when a file is selected', async () => {
        await openPicker();
        selectFile('toDoList_main/src/claudeSheet.js');
        const chips = document.querySelectorAll('.claudeAttachChip');
        expect(chips.length).toBe(1);
        expect(chips[0].dataset.path).toBe('toDoList_main/src/claudeSheet.js');
        expect(chips[0].querySelector('.claudeAttachChipLabel').textContent).toBe('claudeSheet.js');
    });

    it('renders a single thread intro row naming the attached files', async () => {
        await openPicker();
        selectFile('toDoList_main/src/claudeSheet.js');
        selectFile('toDoList_main/src/layoutInspect.js');
        const intro = document.getElementById('claudeAttachIntro');
        expect(intro).toBeTruthy();
        expect(intro.textContent).toBe('📎 Attached: claudeSheet.js, layoutInspect.js');
        // The intro is the first node in the thread surface.
        const surface = document.getElementById('claudeChatSurface');
        expect(surface.firstChild).toBe(intro);
    });

    it("sends attach_files matching the current chip set on send", async () => {
        await openPicker();
        selectFile('toDoList_main/src/claudeSheet.js');
        selectFile('toDoList_main/src/inject.js');
        await sendMessage('walk me through the runs list');
        expect(chatBodies.length).toBe(1);
        expect(chatBodies[0].attach_files).toEqual([
            'toDoList_main/src/claudeSheet.js',
            'toDoList_main/src/inject.js',
        ]);
    });

    it('removing a chip drops the file from the next request body', async () => {
        await openPicker();
        selectFile('toDoList_main/src/claudeSheet.js');
        selectFile('toDoList_main/src/inject.js');
        // Remove the first chip via its ✕.
        const firstChip = document.querySelector('.claudeAttachChip[data-path="toDoList_main/src/claudeSheet.js"]');
        firstChip.querySelector('.claudeAttachChipRemove').click();
        await sendMessage('and now?');
        expect(chatBodies[0].attach_files).toEqual(['toDoList_main/src/inject.js']);
    });

    it('keeps attachments attached across turns in the same conversation', async () => {
        await openPicker();
        selectFile('toDoList_main/src/layoutInspect.js');
        await sendMessage('first');
        await sendMessage('second');
        expect(chatBodies.length).toBe(2);
        expect(chatBodies[0].attach_files).toEqual(['toDoList_main/src/layoutInspect.js']);
        expect(chatBodies[1].attach_files).toEqual(['toDoList_main/src/layoutInspect.js']);
    });

    it('omits attach_files entirely when nothing is attached', async () => {
        await sendMessage('no attachments here');
        expect(chatBodies[0].attach_files).toBeUndefined();
    });

    it('clears the attachment list when "+ New" is tapped', async () => {
        await openPicker();
        selectFile('toDoList_main/src/claudeSheet.js');
        expect(document.querySelectorAll('.claudeAttachChip').length).toBe(1);
        // "+ New" lives on the Runs tab.
        document.getElementById('claudeTabRuns').click();
        document.getElementById('claudeRunsNew').click();
        expect(document.querySelectorAll('.claudeAttachChip').length).toBe(0);
        expect(document.getElementById('claudeAttachIntro')).toBe(null);
        await sendMessage('fresh start');
        expect(chatBodies[0].attach_files).toBeUndefined();
    });
});

// "Lever 4": when the Worker's chat reply carries `suggested_files`, each
// becomes a "suggested" chip in the composer chip area (above the input bar),
// beside any manual-attach chips — not below the assistant message. Accepting
// routes the path through the separate `suggested_attach_files` channel (20KB
// cap); dismissing drops it silently.
describe('Claude sheet — worker file suggestions (Lever 4)', () => {
    let realFetch;
    let fetchSpy;
    let chatBodies;
    // What the next chat response should advertise as suggested_files.
    let nextSuggested;

    function makeFetch() {
        chatBodies = [];
        nextSuggested = [];
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve([]),
                });
            }
            const body = JSON.parse(opts.body);
            if (body.chat) chatBodies.push(body);
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ reply: 'ok', suggested_files: nextSuggested.slice() }),
            });
        });
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

    it('renders one suggested chip in the composer chip area, not below the message', async () => {
        nextSuggested = ['toDoList_main/src/claudeSheet.js'];
        await sendMessage('what does the runs tab do?');
        const container = document.getElementById('claudeAttachChips');
        const chips = container.querySelectorAll('.claudeAttachChip--suggested');
        expect(chips.length).toBe(1);
        expect(chips[0].dataset.path).toBe('toDoList_main/src/claudeSheet.js');
        expect(chips[0].querySelector('.claudeAttachChipLabel').textContent)
            .toBe('✦ claudeSheet.js');
        // No chip is rendered into the chat surface anymore.
        const surface = document.getElementById('claudeChatSurface');
        expect(surface.querySelector('.claudeSuggestionRow')).toBeFalsy();
        expect(surface.querySelector('.claudeAttachChip')).toBeFalsy();
    });

    it('accepting a suggested chip sends suggested_attach_files and integrates the chip', async () => {
        nextSuggested = ['toDoList_main/src/claudeSheet.js'];
        await sendMessage('first');
        nextSuggested = [];
        document.querySelector('.claudeAttachChip--suggested .claudeAttachChipLabel').click();
        // The accepted chip integrates: it loses the suggested variant.
        expect(document.querySelectorAll('.claudeAttachChip--suggested').length).toBe(0);
        const chip = document.querySelector('#claudeAttachChips .claudeAttachChip');
        expect(chip.dataset.path).toBe('toDoList_main/src/claudeSheet.js');
        await sendMessage('second');
        expect(chatBodies.length).toBe(2);
        expect(chatBodies[1].suggested_attach_files).toEqual(['toDoList_main/src/claudeSheet.js']);
    });

    it('dismissing a suggested chip removes it without adding to the suggestion channel', async () => {
        nextSuggested = ['toDoList_main/src/inject.js'];
        await sendMessage('first');
        nextSuggested = [];
        document.querySelector('.claudeAttachChip--suggested .claudeAttachChipRemove').click();
        expect(document.querySelectorAll('.claudeAttachChip--suggested').length).toBe(0);
        await sendMessage('second');
        expect(chatBodies[1].suggested_attach_files).toBeUndefined();
    });

    it('removing an accepted suggestion drops it from the suggestion channel only', async () => {
        nextSuggested = ['toDoList_main/src/claudeSheet.js'];
        await sendMessage('first');
        nextSuggested = [];
        document.querySelector('.claudeAttachChip--suggested .claudeAttachChipLabel').click();
        // The integrated chip carries a ✕ that removes from the suggestion channel.
        document.querySelector('#claudeAttachChips .claudeAttachChipRemove').click();
        expect(document.querySelectorAll('#claudeAttachChips .claudeAttachChip').length).toBe(0);
        await sendMessage('second');
        expect(chatBodies[1].suggested_attach_files).toBeUndefined();
        expect(chatBodies[1].attach_files).toBeUndefined();
    });

    it('"+ New" clears accepted suggestions so they do not persist across conversations', async () => {
        nextSuggested = ['toDoList_main/src/claudeSheet.js'];
        await sendMessage('first');
        document.querySelector('.claudeAttachChip--suggested .claudeAttachChipLabel').click();
        nextSuggested = [];
        document.getElementById('claudeTabRuns').click();
        document.getElementById('claudeRunsNew').click();
        await sendMessage('fresh');
        expect(chatBodies[chatBodies.length - 1].suggested_attach_files).toBeUndefined();
        expect(document.querySelectorAll('.claudeAttachChip').length).toBe(0);
    });

    it('renders no suggestion chips when the worker returns no suggested_files', async () => {
        nextSuggested = [];
        await sendMessage('plain turn');
        expect(document.querySelectorAll('.claudeAttachChip--suggested').length).toBe(0);
        expect(document.querySelectorAll('.claudeSuggestionRow').length).toBe(0);
    });
});

// The composer chip area is rendered by a single consolidated function that
// reads both the manual-attach and suggestion channels in one pass. These tests
// pin the consolidated behavior: chip ordering (manual first, then suggestion),
// the `data-source` tag each chip carries, and that each chip's ✕ routes to its
// own channel without disturbing the other.
describe('Claude sheet — consolidated composer chip area', () => {
    const MANIFEST = [
        'toDoList_main/src/claudeSheet.js',
        'toDoList_main/src/inject.js',
    ];
    let realFetch;
    let fetchSpy;
    let chatBodies;
    let nextSuggested;

    function makeFetch() {
        chatBodies = [];
        nextSuggested = [];
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () => Promise.resolve(MANIFEST),
                });
            }
            const body = JSON.parse(opts.body);
            if (body.chat) chatBodies.push(body);
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ reply: 'ok', suggested_files: nextSuggested.slice() }),
            });
        });
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
        mountClaudeSheet(document.body);
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function openPicker() {
        document.getElementById('claudeComposerAttach').click();
        await flush();
    }

    function selectFile(path) {
        document.querySelector('.claudeAttachItem[data-path="' + path + '"]').click();
    }

    async function sendMessage(text) {
        const input = document.getElementById('claudeComposerInput');
        input.value = text;
        document.getElementById('claudeComposerSend').click();
        await flush();
    }

    // Manually attach one file, then accept one worker suggestion, leaving the
    // chip area with exactly one manual chip and one accepted-suggestion chip.
    async function setupMixedChips() {
        nextSuggested = ['toDoList_main/src/inject.js'];
        await openPicker();
        selectFile('toDoList_main/src/claudeSheet.js');
        await sendMessage('first');
        nextSuggested = [];
        // Accept the pending suggestion: it integrates into a regular chip.
        document.querySelector('.claudeAttachChip--suggested .claudeAttachChipLabel').click();
    }

    it('renders manual chips before suggestion chips, each tagged with its source', async () => {
        await setupMixedChips();
        const chips = document.querySelectorAll('#claudeAttachChips .claudeAttachChip');
        expect(chips.length).toBe(2);
        // Manual chip first.
        expect(chips[0].dataset.source).toBe('manual');
        expect(chips[0].dataset.path).toBe('toDoList_main/src/claudeSheet.js');
        // Accepted-suggestion chip second.
        expect(chips[1].dataset.source).toBe('suggestion');
        expect(chips[1].dataset.path).toBe('toDoList_main/src/inject.js');
    });

    it('tapping ✕ on the manual chip removes from the manual channel only', async () => {
        await setupMixedChips();
        const manualChip = document.querySelector('.claudeAttachChip[data-source="manual"]');
        manualChip.querySelector('.claudeAttachChipRemove').click();
        // The suggestion chip survives.
        const remaining = document.querySelectorAll('#claudeAttachChips .claudeAttachChip');
        expect(remaining.length).toBe(1);
        expect(remaining[0].dataset.source).toBe('suggestion');
        await sendMessage('after manual remove');
        const last = chatBodies[chatBodies.length - 1];
        expect(last.attach_files).toBeUndefined();
        expect(last.suggested_attach_files).toEqual(['toDoList_main/src/inject.js']);
    });

    it('tapping ✕ on the suggestion chip removes from the suggestion channel only', async () => {
        await setupMixedChips();
        const suggestionChip = document.querySelector('.claudeAttachChip[data-source="suggestion"]');
        suggestionChip.querySelector('.claudeAttachChipRemove').click();
        // The manual chip survives.
        const remaining = document.querySelectorAll('#claudeAttachChips .claudeAttachChip');
        expect(remaining.length).toBe(1);
        expect(remaining[0].dataset.source).toBe('manual');
        await sendMessage('after suggestion remove');
        const last = chatBodies[chatBodies.length - 1];
        expect(last.attach_files).toEqual(['toDoList_main/src/claudeSheet.js']);
        expect(last.suggested_attach_files).toBeUndefined();
    });
});

// Picker mode follows the active workspace: the default repo (toDoList_TOP)
// keeps the manifest browse list; any other repo without a fetchable manifest
// swaps to a free-text path input. Repo selection itself lives at the chat
// level now (the workspace pill), so the picker no longer renders its own
// selector, and every send carries the active workspace's repo.
describe('Claude sheet — attach picker mode follows the workspace', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    const OTHER_REPO = 'rsterenchak/matchingGame-test';
    const MANIFEST = [
        'toDoList_main/src/claudeSheet.js',
        'toDoList_main/src/inject.js',
    ];
    let realFetch;
    let chatBodies;

    // Only the default repo publishes a manifest here; any other repo's manifest
    // 404s so the picker falls back to the free-text path input these tests
    // exercise. (Multi-repo manifest fetching has its own describe block below.)
    function makeFetch() {
        chatBodies = [];
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                if (url.indexOf('toDoList_TOP') !== -1) {
                    return Promise.resolve({
                        ok: true,
                        status: 200,
                        json: () => Promise.resolve(MANIFEST),
                    });
                }
                return Promise.resolve({
                    ok: false,
                    status: 404,
                    json: () => Promise.resolve(null),
                });
            }
            const body = JSON.parse(opts.body);
            if (body.repos) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
                    ok: true,
                    default: DEFAULT_REPO,
                    repos: [
                        { repo: DEFAULT_REPO, srcPrefix: 'toDoList_main/src/' },
                        { repo: OTHER_REPO, srcPrefix: 'src/' },
                    ],
                }) });
            }
            if (body.chat) chatBodies.push(body);
            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({ reply: 'ok' }),
            });
        });
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
        mountClaudeSheet(document.body);
        // The workspace list loads asynchronously from the Inject targets on
        // mount; let it resolve so the pill menu lists the non-default repo these
        // tests switch to.
        await flush();
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function openPicker() {
        document.getElementById('claudeComposerAttach').click();
        await flush();
    }

    // Switch the chat-level workspace through the pill → menu → confirm flow.
    async function switchWorkspace(repo) {
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + repo + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmYes').click();
        await flush();
    }

    function addPath(path) {
        const input = document.getElementById('claudeAttachPathInput');
        input.value = path;
        document.getElementById('claudeAttachPathAdd').click();
    }

    async function sendMessage(text) {
        const input = document.getElementById('claudeComposerInput');
        input.value = text;
        document.getElementById('claudeComposerSend').click();
        await flush();
    }

    it('no longer renders its own repo selector', async () => {
        await openPicker();
        expect(document.getElementById('claudeAttachRepo')).toBe(null);
    });

    it('shows the manifest-driven file list for the default workspace', async () => {
        await openPicker();
        expect(document.getElementById('claudeAttachSearch').hidden).toBe(false);
        expect(document.getElementById('claudeAttachPathRow').hidden).toBe(true);
        const items = Array.from(document.querySelectorAll('.claudeAttachItem'));
        expect(items.length).toBeGreaterThan(0);
        expect(items.map((el) => el.dataset.path)).toContain('toDoList_main/src/inject.js');
    });

    it('shows the free-text path input for a workspace with no manifest', async () => {
        await openPicker();
        await switchWorkspace(OTHER_REPO);
        expect(document.getElementById('claudeAttachPathRow').hidden).toBe(false);
        expect(document.getElementById('claudeAttachSearch').hidden).toBe(true);
        expect(document.getElementById('claudeAttachList').hidden).toBe(true);
    });

    it('attaches a free-text path as a chip carrying the active workspace repo', async () => {
        await switchWorkspace(OTHER_REPO);
        await openPicker();
        addPath('src/PlayPage.jsx');
        const chips = document.querySelectorAll('.claudeAttachChip');
        expect(chips.length).toBe(1);
        expect(chips[0].dataset.path).toBe('src/PlayPage.jsx');
        expect(chips[0].querySelector('.claudeAttachChipLabel').textContent)
            .toBe('matchingGame-test: src/PlayPage.jsx');
        // The free-text input clears after a successful add.
        expect(document.getElementById('claudeAttachPathInput').value).toBe('');
    });

    it('sends the active workspace repo on send, with attachments (non-default)', async () => {
        await switchWorkspace(OTHER_REPO);
        await openPicker();
        addPath('src/PlayPage.jsx');
        await sendMessage('walk me through PlayPage');
        expect(chatBodies.length).toBe(1);
        expect(chatBodies[0].repo).toBe(OTHER_REPO);
        expect(chatBodies[0].attach_files).toEqual(['src/PlayPage.jsx']);
    });

    it('sends the active workspace repo on send, with attachments (default)', async () => {
        await openPicker();
        document.querySelector('.claudeAttachItem[data-path="toDoList_main/src/inject.js"]').click();
        await sendMessage('explain inject');
        expect(chatBodies[0].repo).toBe(DEFAULT_REPO);
        expect(chatBodies[0].attach_files).toEqual(['toDoList_main/src/inject.js']);
    });

    it('sends the active workspace repo on send even with no attachments', async () => {
        await sendMessage('no attachments');
        expect(chatBodies[0].repo).toBe(DEFAULT_REPO);
        expect(chatBodies[0].attach_files).toBeUndefined();
        await switchWorkspace(OTHER_REPO);
        await sendMessage('still no attachments');
        expect(chatBodies[1].repo).toBe(OTHER_REPO);
        expect(chatBodies[1].attach_files).toBeUndefined();
    });

    it('keeps the workspace but clears chips on "+ New"', async () => {
        await switchWorkspace(OTHER_REPO);
        await openPicker();
        addPath('src/PlayPage.jsx');
        expect(document.querySelectorAll('.claudeAttachChip').length).toBe(1);
        // "+ New" lives on the Runs tab.
        document.getElementById('claudeTabRuns').click();
        document.getElementById('claudeRunsNew').click();
        expect(document.querySelectorAll('.claudeAttachChip').length).toBe(0);
        expect(document.getElementById('claudeAttachNotice').hidden).toBe(true);
        // The workspace is unchanged, so a fresh send still carries it.
        await sendMessage('fresh start');
        expect(chatBodies[0].attach_files).toBeUndefined();
        expect(chatBodies[0].repo).toBe(OTHER_REPO);
    });
});

// The chat-level workspace pill: a low-emphasis selector in the tab row that
// names the repo the conversation is anchored to. Tapping it lists all allowed
// repos; choosing a different one (behind a confirm) clears the chat and
// switches the active workspace.
describe('Claude sheet — chat-level workspace pill', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    const OTHER_REPO = 'rsterenchak/matchingGame-test';
    let realFetch;
    let chatBodies;

    function makeFetch() {
        chatBodies = [];
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            }
            const body = JSON.parse(opts.body);
            if (body.repos) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
                    ok: true,
                    default: DEFAULT_REPO,
                    repos: [
                        { repo: DEFAULT_REPO, srcPrefix: 'toDoList_main/src/' },
                        { repo: OTHER_REPO, srcPrefix: 'src/' },
                        { repo: 'rsterenchak/BookHavenBookstore_Sophia', srcPrefix: 'src/' },
                    ],
                }) });
            }
            if (body.chat) chatBodies.push(body);
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'ok' }) });
        });
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        setInjectTargets([DEFAULT_REPO, OTHER_REPO, 'rsterenchak/BookHavenBookstore_Sophia']);
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
        mountClaudeSheet(document.body);
        // The repo list is projected from the Inject targets asynchronously on
        // mount; let it resolve so the workspace menu reflects the full set.
        await flush();
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

    it('renders the pill naming the current (default) workspace', () => {
        const pill = document.getElementById('claudeWorkspacePill');
        expect(pill).toBeTruthy();
        expect(pill.textContent).toContain('toDoList_TOP');
    });

    it('opens a menu listing every allowed repo when tapped', () => {
        document.getElementById('claudeWorkspacePill').click();
        const menu = document.getElementById('claudeWorkspaceMenu');
        expect(menu.hidden).toBe(false);
        const repos = Array.from(document.querySelectorAll('.claudeWorkspaceItem')).map((el) => el.dataset.repo);
        expect(repos).toContain(DEFAULT_REPO);
        expect(repos).toContain(OTHER_REPO);
        // The active repo is checkmarked.
        const active = document.querySelector('.claudeWorkspaceItem[data-repo="' + DEFAULT_REPO + '"]');
        expect(active.getAttribute('aria-checked')).toBe('true');
    });

    it('lists BookHavenBookstore_Sophia and reframes the next send when selected', async () => {
        const BOOKHAVEN_REPO = 'rsterenchak/BookHavenBookstore_Sophia';
        document.getElementById('claudeWorkspacePill').click();
        const repos = Array.from(document.querySelectorAll('.claudeWorkspaceItem')).map((el) => el.dataset.repo);
        expect(repos).toContain(BOOKHAVEN_REPO);

        document.querySelector('.claudeWorkspaceItem[data-repo="' + BOOKHAVEN_REPO + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmYes').click();
        await flush();
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('BookHavenBookstore_Sophia');

        await sendMessage('hello in the BookHaven workspace');
        const lastBody = chatBodies[chatBodies.length - 1];
        expect(lastBody.repo).toBe(BOOKHAVEN_REPO);
    });

    it('selecting a different repo asks to confirm before switching', () => {
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + OTHER_REPO + '"]').click();
        const warn = document.querySelector('.claudeWorkspaceConfirmWarn');
        expect(warn).toBeTruthy();
        expect(warn.textContent).toMatch(/matchingGame-test/);
        expect(warn.textContent).toMatch(/clears the current chat/i);
        // Nothing switched yet — the pill still names the old workspace.
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('toDoList_TOP');
    });

    it('confirming clears the chat, updates the pill, and reframes the next send', async () => {
        await sendMessage('hello in the default workspace');
        expect(document.querySelectorAll('.claudeMsg--user').length).toBe(1);

        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + OTHER_REPO + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmYes').click();
        await flush();

        // Chat is wiped and the pill names the new workspace.
        expect(document.querySelectorAll('.claudeMsg--user').length).toBe(0);
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('matchingGame-test');
        // The menu closed after confirming.
        expect(document.getElementById('claudeWorkspaceMenu').hidden).toBe(true);

        await sendMessage('hello in the new workspace');
        const lastBody = chatBodies[chatBodies.length - 1];
        expect(lastBody.repo).toBe(OTHER_REPO);
    });

    it('cancelling the confirm leaves the workspace untouched', () => {
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + OTHER_REPO + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmCancel').click();
        expect(document.getElementById('claudeWorkspaceMenu').hidden).toBe(true);
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('toDoList_TOP');
    });

    it('choosing the already-active repo just closes the menu', () => {
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + DEFAULT_REPO + '"]').click();
        expect(document.getElementById('claudeWorkspaceMenu').hidden).toBe(true);
        expect(document.querySelector('.claudeWorkspaceConfirmWarn')).toBe(null);
    });
});

// The workspace repo list is projected from the user's Inject targets (the
// `inject_targets` Supabase table, cached in inject.js) rather than the Worker
// allowlist, so the chat menu never drifts from the targets managed in Inject
// settings. The list starts on a safe fallback (the default repo only) and is
// replaced once the cache loads; an empty cache leaves the fallback in place so
// the chat is always usable. These tests drive the cache via setInjectTargets
// and the `injectTargetsChanged` event.
describe('Claude sheet — workspace repos sourced from inject targets', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    const OTHER_REPO = 'rsterenchak/matchingGame-test';
    const BOOKHAVEN_REPO = 'rsterenchak/BookHavenBookstore_Sophia';
    let realFetch;

    function makeFetch() {
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'ok' }) });
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    function menuRepos() {
        return Array.from(document.querySelectorAll('.claudeWorkspaceItem')).map((el) => el.dataset.repo);
    }

    it('projects the menu from the inject targets once the cache loads', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        expect(menuRepos()).toEqual([DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
    });

    it('collapses duplicate repos (two targets on one repo) to a single menu item', async () => {
        // Two targets can share a repo (different file paths); the menu anchors
        // on the repo string, so it shows that repo once.
        setInjectTargets([DEFAULT_REPO, OTHER_REPO, OTHER_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        expect(menuRepos()).toEqual([DEFAULT_REPO, OTHER_REPO]);
    });

    it('falls back to the default repo and stays usable when the targets list is empty', async () => {
        setInjectTargets([]);
        mountClaudeSheet(document.body);
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        expect(menuRepos()).toEqual([DEFAULT_REPO]);
        // The chat is still usable on the fallback repo.
        expect(document.getElementById('claudeComposerInput').disabled).toBe(false);
        expect(document.getElementById('claudeComposerSend').disabled).toBe(false);
    });

    it('selecting a target repo sets it as the active workspace', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + BOOKHAVEN_REPO + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmYes').click();
        await flush();
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('BookHavenBookstore_Sophia');
    });

    // The list is re-projected from the targets on every sheet open — not just on
    // mount — so a target added or removed in Inject settings shows up the next
    // time the user opens the sheet, with no page reload. Opening/closing the
    // sheet is just a class toggle (no remount), so without this refresh the pill
    // menu would freeze on whatever the cache held at first mount.
    it('re-projects the workspace list on each sheet open', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        openClaudeSheet();
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        expect(menuRepos()).toEqual([DEFAULT_REPO, OTHER_REPO]);

        // A third target is added in Inject settings between sheet opens.
        setInjectTargets([DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
        // Close the open menu so the next pill click opens a fresh one.
        document.getElementById('claudeWorkspacePill').click();
        closeClaudeSheet();
        openClaudeSheet();
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        expect(menuRepos()).toEqual([DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
    });

    // A target add/edit/delete made while the sheet is OPEN dispatches an
    // `injectTargetsChanged` event; the sheet listens and re-projects the menu
    // mid-session without a sheet re-open.
    it('re-projects the workspace list on the injectTargetsChanged event', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        expect(menuRepos()).toEqual([DEFAULT_REPO, OTHER_REPO]);
        // Close the menu so the next pill click rebuilds it.
        document.getElementById('claudeWorkspacePill').click();

        // A new target is added; inject.js dispatches injectTargetsChanged.
        setInjectTargets([DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
        document.dispatchEvent(new CustomEvent('injectTargetsChanged'));
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        expect(menuRepos()).toEqual([DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
    });

    // The on-open refresh repaints the pill/menu only — it must not wipe
    // chatHistory, attachments, or the active workspace. Only an explicit pill
    // switch (with the confirm) clears the chat.
    it('preserves the active workspace and chat history when the on-open refresh resolves', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        openClaudeSheet();
        await flush();

        // Switch the workspace to OTHER_REPO explicitly (this would normally wipe
        // any prior chat — we then build new history on top).
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + OTHER_REPO + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmYes').click();
        await flush();
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('matchingGame-test');

        const input = document.getElementById('claudeComposerInput');
        input.value = 'hello';
        document.getElementById('claudeComposerSend').click();
        await flush();
        const bubblesBefore = document.querySelectorAll('.claudeMsg').length;
        expect(bubblesBefore).toBeGreaterThan(0);

        // Re-open with the targets still listing OTHER_REPO. The refresh must be
        // silent: same workspace, same chat history, same composer state.
        closeClaudeSheet();
        openClaudeSheet();
        await flush();
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('matchingGame-test');
        expect(document.querySelectorAll('.claudeMsg').length).toBe(bubblesBefore);
    });

    // If the user's active workspace target is deleted before the next sheet
    // open, the refresh falls back to the first remaining target so the user
    // isn't stranded on a repo the menu no longer lists. Chat history is
    // preserved — the fallback only repaints the pill.
    it('falls back to the first target when the active workspace target was deleted', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        openClaudeSheet();
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + OTHER_REPO + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmYes').click();
        await flush();
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('matchingGame-test');

        const input = document.getElementById('claudeComposerInput');
        input.value = 'hello';
        document.getElementById('claudeComposerSend').click();
        await flush();
        const bubblesBefore = document.querySelectorAll('.claudeMsg').length;
        expect(bubblesBefore).toBeGreaterThan(0);

        // The OTHER_REPO target is deleted in Inject settings.
        setInjectTargets([DEFAULT_REPO]);
        closeClaudeSheet();
        openClaudeSheet();
        await flush();
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('toDoList_TOP');
        expect(document.querySelectorAll('.claudeMsg').length).toBe(bubblesBefore);
    });

    // Empty targets after a refresh strand no one: the active repo falls back to
    // the default so the chat is always usable.
    it('falls back to the default repo when all targets are deleted', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + OTHER_REPO + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmYes').click();
        await flush();
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('matchingGame-test');

        // All targets are deleted; the change event fires.
        setInjectTargets([]);
        document.dispatchEvent(new CustomEvent('injectTargetsChanged'));
        await flush();
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('toDoList_TOP');
        document.getElementById('claudeWorkspacePill').click();
        expect(menuRepos()).toEqual([DEFAULT_REPO]);
    });
});

// Multi-repo manifest fetching: the picker derives each repo's manifest URL by
// convention (https://<owner>.github.io/<name>/src-manifest.json) and shows a
// real file list whenever one is fetchable — not just for the default repo.
// Repos without a published manifest gracefully fall back to free-text input,
// and fetched manifests are cached per repo for the session.
describe('Claude sheet — attach picker multi-repo manifest', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    const OTHER_REPO = 'rsterenchak/matchingGame-test';
    const TODO_MANIFEST = [
        'toDoList_main/src/claudeSheet.js',
        'toDoList_main/src/inject.js',
    ];
    const GAME_MANIFEST = [
        'src/PlayPage.jsx',
        'src/MainSection.jsx',
    ];
    let realFetch;
    let chatBodies;
    let manifestFetches;
    // Per-repo manifest payloads keyed by a substring of the repo's URL. A null
    // value makes that repo's manifest 404 so the free-text fallback engages.
    let manifestByRepo;

    function makeFetch() {
        chatBodies = [];
        manifestFetches = [];
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                manifestFetches.push(url);
                const key = url.indexOf('toDoList_TOP') !== -1 ? 'toDoList_TOP' : 'matchingGame-test';
                const files = manifestByRepo[key];
                if (!files) {
                    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(files) });
            }
            const body = JSON.parse(opts.body);
            if (body.repos) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
                    ok: true,
                    default: DEFAULT_REPO,
                    repos: [
                        { repo: DEFAULT_REPO, srcPrefix: 'toDoList_main/src/' },
                        { repo: OTHER_REPO, srcPrefix: 'src/' },
                    ],
                }) });
            }
            if (body.chat) chatBodies.push(body);
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'ok' }) });
        });
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        manifestByRepo = { toDoList_TOP: TODO_MANIFEST, 'matchingGame-test': GAME_MANIFEST };
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
        mountClaudeSheet(document.body);
        // The workspace list loads asynchronously from the Inject targets on
        // mount; let it resolve so the pill menu lists the non-default repo these
        // tests switch to.
        await flush();
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function openPicker() {
        document.getElementById('claudeComposerAttach').click();
        await flush();
    }

    // Switch the chat-level workspace through the pill → menu → confirm flow.
    // When the picker is open it re-syncs to the new workspace's manifest.
    async function switchWorkspace(repo) {
        document.getElementById('claudeWorkspacePill').click();
        document.querySelector('.claudeWorkspaceItem[data-repo="' + repo + '"]').click();
        document.querySelector('.claudeWorkspaceConfirmYes').click();
        await flush();
    }

    function listPaths() {
        return Array.from(document.querySelectorAll('.claudeAttachItem')).map((el) => el.dataset.path);
    }

    it('renders the manifest-driven list for the default repo', async () => {
        await openPicker();
        expect(document.getElementById('claudeAttachSearch').hidden).toBe(false);
        expect(document.getElementById('claudeAttachPathRow').hidden).toBe(true);
        expect(listPaths()).toEqual(TODO_MANIFEST);
    });

    it('renders the manifest-driven list for another repo with a fetchable manifest', async () => {
        await openPicker();
        await switchWorkspace(OTHER_REPO);
        expect(document.getElementById('claudeAttachSearch').hidden).toBe(false);
        expect(document.getElementById('claudeAttachPathRow').hidden).toBe(true);
        expect(listPaths()).toEqual(GAME_MANIFEST);
        // The manifest URL was derived by convention from the repo string.
        expect(manifestFetches.some((u) => u === 'https://rsterenchak.github.io/matchingGame-test/src-manifest.json')).toBe(true);
    });

    it('falls back to the free-text input when the manifest fetch 404s', async () => {
        manifestByRepo['matchingGame-test'] = null;
        await openPicker();
        await switchWorkspace(OTHER_REPO);
        expect(document.getElementById('claudeAttachPathRow').hidden).toBe(false);
        expect(document.getElementById('claudeAttachSearch').hidden).toBe(true);
        expect(document.getElementById('claudeAttachList').hidden).toBe(true);
    });

    it('swaps the list when switching repos without leaking the previous repo files', async () => {
        await openPicker();
        expect(listPaths()).toEqual(TODO_MANIFEST);
        await switchWorkspace(OTHER_REPO);
        expect(listPaths()).toEqual(GAME_MANIFEST);
        // Switching back shows the default repo's list again, not a mix.
        await switchWorkspace(DEFAULT_REPO);
        expect(listPaths()).toEqual(TODO_MANIFEST);
    });

    it('caches each repo manifest so re-selecting it does not re-fetch', async () => {
        await openPicker();
        await switchWorkspace(OTHER_REPO);
        await switchWorkspace(DEFAULT_REPO);
        await switchWorkspace(OTHER_REPO);
        const gameFetches = manifestFetches.filter((u) => u.indexOf('matchingGame-test') !== -1);
        const todoFetches = manifestFetches.filter((u) => u.indexOf('toDoList_TOP') !== -1);
        expect(gameFetches.length).toBe(1);
        expect(todoFetches.length).toBe(1);
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

    it('re-checks worker state when the Runs tab is reopened, hiding a stale nudge', () => {
        // Worker was waiting and the nudge rendered visible on the Runs tab.
        notifyUpdateAvailable({ waiting: { postMessage() {} }, installing: null });
        document.getElementById('claudeTabRuns').click();
        const nudge = document.getElementById('claudeUpdateNudge');
        expect(nudge.hidden).toBe(false);

        // The new build took control elsewhere: the registration is gone
        // (hasPendingUpdate() is now false) but no appUpdateApplied event
        // reached this document, so the nudge DOM is left showing — a stale
        // false positive that the event-driven paths never cleared.
        notifyUpdateAvailable(null);
        nudge.hidden = false;

        // Reopening the Runs tab must re-evaluate against the live worker state
        // and clear the stale banner rather than trusting the last render.
        document.getElementById('claudeTabChat').click();
        document.getElementById('claudeTabRuns').click();
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
        // …and carries attach_files when the conversation has attachments.
        expect(inject).toMatch(/attach_files/);
    });

    it('styles the attachment picker, chips, and thread intro row', () => {
        expect(css).toMatch(/\.claudeAttachPanel\s*\{/);
        expect(css).toMatch(/\.claudeAttachChip\s*\{/);
        expect(css).toMatch(/\.claudeAttachIntro\s*\{/);
        expect(css).toMatch(/\.claudeComposerAttach\s*\{/);
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
        expect(css).toMatch(/\.claudeRunBadge--unconfirmed\s*\{/);
    });

    it('lets the hidden attribute win over the nudge display so hiding hides', () => {
        // The base .claudeUpdateNudge rule sets display: flex, which would
        // otherwise override the HTML hidden attribute's UA display: none.
        // A [hidden] rule with display: none must restore the expected behavior
        // so renderUpdateNudge() setting nudge.hidden = true actually hides it.
        expect(css).toMatch(/\.claudeUpdateNudge\[hidden\]\s*\{[^}]*display:\s*none/);
    });
});

// Inline rendering of fenced ```html and ```svg blocks in assistant replies.
// Prose stays plain text; the fenced markup becomes live, sanitized DOM.
describe('Inline html/svg rendering in the chat surface', () => {
    it('splits a reply into ordered text / html / svg segments', () => {
        const reply = 'Before\n```html\n<div>hi</div>\n```\nmiddle\n```svg\n<svg></svg>\n```\nafter';
        const segs = splitRenderableBlocks(reply);
        expect(segs.map(s => s.type)).toEqual(['text', 'html', 'text', 'svg', 'text']);
        expect(segs[1].value).toContain('<div>hi</div>');
        expect(segs[3].value).toContain('<svg></svg>');
    });

    it('treats a fence-free reply as a single text segment (prior behavior)', () => {
        const segs = splitRenderableBlocks('just prose, no fences');
        expect(segs).toHaveLength(1);
        expect(segs[0]).toEqual({ type: 'text', value: 'just prose, no fences' });
    });

    it('leaves ```md draft blocks inside text — they are not rendered as markup', () => {
        const reply = 'Here:\n```md\n- [ ] **[LOW]** do a thing\n```';
        const segs = splitRenderableBlocks(reply);
        expect(segs).toHaveLength(1);
        expect(segs[0].type).toBe('text');
        expect(segs[0].value).toContain('```md');
    });

    it('renders a ```html block as actual inline HTML structure', () => {
        const bubble = document.createElement('div');
        renderAssistantContent(bubble, 'Mockup:\n```html\n<div class="card"><button>Save</button></div>\n```');
        expect(bubble.querySelector('.card')).toBeTruthy();
        expect(bubble.querySelector('button').textContent).toBe('Save');
        expect(bubble.textContent).toContain('Mockup:');
    });

    it('renders a ```svg block as an actual <svg> visual, not markup text', () => {
        const bubble = document.createElement('div');
        renderAssistantContent(bubble, '```svg\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n```');
        const svg = bubble.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg.querySelector('circle')).toBeTruthy();
    });

    it('strips <script> from a rendered html block', () => {
        const bubble = document.createElement('div');
        renderAssistantContent(bubble, '```html\n<p>ok</p><script>window.__x=1<\/script>\n```');
        expect(bubble.querySelector('script')).toBeNull();
        expect(bubble.querySelector('p').textContent).toBe('ok');
    });

    it('strips <script>, <foreignObject>, and external <image> from a rendered svg block', () => {
        const bubble = document.createElement('div');
        renderAssistantContent(
            bubble,
            '```svg\n<svg><script>alert(1)<\/script><foreignObject><body/></foreignObject>' +
            '<image href="https://evil.example/x.png"/><rect width="4" height="4"/></svg>\n```'
        );
        expect(bubble.querySelector('script')).toBeNull();
        expect(bubble.querySelector('foreignObject')).toBeNull();
        expect(bubble.querySelector('image')).toBeNull();
        expect(bubble.querySelector('rect')).toBeTruthy();
    });

    it('falls back to plain text content when the reply has no fenced blocks', () => {
        const bubble = document.createElement('div');
        renderAssistantContent(bubble, 'plain reply');
        expect(bubble.textContent).toBe('plain reply');
        expect(bubble.children).toHaveLength(0);
    });

    it('promotes an un-fenced <svg>…</svg> in a reply to an svg segment', () => {
        const reply = 'Here is an icon:\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\nDone';
        const segs = splitRenderableBlocks(reply);
        expect(segs.map(s => s.type)).toEqual(['text', 'svg', 'text']);
        expect(segs[1].value).toContain('<svg');
        expect(segs[1].value).toContain('</svg>');
    });

    it('renders an un-fenced <svg> as an actual <svg> visual, not markup text', () => {
        const bubble = document.createElement('div');
        renderAssistantContent(bubble, 'Icon: <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');
        const svg = bubble.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg.querySelector('circle')).toBeTruthy();
        expect(bubble.textContent).toContain('Icon:');
    });

    it('routes a promoted un-fenced <svg> through the SVG sanitizer', () => {
        const bubble = document.createElement('div');
        renderAssistantContent(
            bubble,
            '<svg><script>alert(1)<\/script><foreignObject><body/></foreignObject>' +
            '<image href="https://evil.example/x.png"/><rect width="4" height="4"/></svg>'
        );
        expect(bubble.querySelector('svg')).toBeTruthy();
        expect(bubble.querySelector('script')).toBeNull();
        expect(bubble.querySelector('foreignObject')).toBeNull();
        expect(bubble.querySelector('image')).toBeNull();
        expect(bubble.querySelector('rect')).toBeTruthy();
    });

    it('matches an uppercase ```SVG fence case-insensitively', () => {
        const bubble = document.createElement('div');
        renderAssistantContent(bubble, '```SVG\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n```');
        const svg = bubble.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg.querySelector('circle')).toBeTruthy();
    });

    it('matches a fence whose markup starts on the same line as the label', () => {
        const segs = splitRenderableBlocks('```svg<svg></svg>```');
        expect(segs.map(s => s.type)).toEqual(['svg']);
        expect(segs[0].value).toContain('<svg></svg>');
    });

    it('does not promote a bare <svg> that has no closing tag — stays text', () => {
        const segs = splitRenderableBlocks('Mentioning <svg> without a close tag.');
        expect(segs).toHaveLength(1);
        expect(segs[0].type).toBe('text');
        expect(segs[0].value).toContain('<svg>');
    });

    it('does not double-match an <svg> already inside a fenced ```svg block', () => {
        const segs = splitRenderableBlocks('```svg\n<svg></svg>\n```');
        expect(segs.map(s => s.type)).toEqual(['svg']);
    });

    it('does not promote an <svg> written literally inside a ```md draft block', () => {
        const reply = 'Draft:\n```md\n- [ ] Add an <svg viewBox="0 0 1 1"></svg> icon\n```';
        const segs = splitRenderableBlocks(reply);
        // The ```md fence is left as text (handled by the draft path), so the
        // bare-svg fallback must not reach inside it and promote the <svg>.
        expect(segs.some(s => s.type === 'svg')).toBe(false);
        expect(segs.map(s => s.value).join('')).toContain('<svg viewBox="0 0 1 1"></svg>');
    });
});
