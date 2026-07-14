import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';
import {
    mountClaudeSheet,
    openClaudeSheet,
    closeClaudeSheet,
    isClaudeSheetOpen,
    syncClaudeSheetForProject,
    extractDraftedEntry,
    extractInspectDirective,
    splitRenderableBlocks,
    renderAssistantContent,
    insertReference,
    openChatWithSeed,
    setChatWorkspaceRepo,
    getActiveChatRepo,
    getAttachRepos,
    getRunningAppRepo,
    loadManifest,
    manifestUrlForRepo,
} from '../src/claudeSheet.js';
import { initInjectConfig } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';
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

    it('gives the launcher a `✦` glyph and dialog aria metadata', () => {
        const launcher = document.getElementById('claudeLauncher');
        expect(launcher.textContent).toBe('✦');
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

describe('Claude sheet — scroll-to-bottom button', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
    });

    // Drive the jsdom surface's scroll geometry: scrollHeight/clientHeight aren't
    // laid out in jsdom, so define them, and back scrollTop with a real variable
    // so both the listener (reads) and the button (writes) see consistent values.
    function mockSurfaceGeometry(surface, { scrollHeight, clientHeight }) {
        let top = 0;
        Object.defineProperty(surface, 'scrollHeight', { value: scrollHeight, configurable: true });
        Object.defineProperty(surface, 'clientHeight', { value: clientHeight, configurable: true });
        Object.defineProperty(surface, 'scrollTop', {
            get() { return top; },
            set(v) { top = v; },
            configurable: true,
        });
    }

    it('mounts a hidden "↓" pill inside the composer with aria metadata', () => {
        const btn = document.getElementById('claudeScrollDown');
        const composer = document.getElementById('claudeComposer');
        expect(btn).toBeTruthy();
        expect(composer.contains(btn)).toBe(true);
        expect(btn.type).toBe('button');
        expect(btn.textContent).toBe('↓');
        expect(btn.getAttribute('aria-label')).toBe('Scroll to latest message');
        // Starts hidden — a fresh chat is pinned to the bottom.
        expect(btn.hidden).toBe(true);
    });

    it('shows the pill when scrolled up beyond the threshold and hides it near the bottom', () => {
        const surface = document.getElementById('claudeChatSurface');
        const btn = document.getElementById('claudeScrollDown');
        mockSurfaceGeometry(surface, { scrollHeight: 1000, clientHeight: 300 });

        // Scrolled to the top: distance 700 > 40 → visible.
        surface.scrollTop = 0;
        surface.dispatchEvent(new Event('scroll'));
        expect(btn.hidden).toBe(false);

        // Pinned to the bottom: distance 0 ≤ 40 → hidden.
        surface.scrollTop = 700;
        surface.dispatchEvent(new Event('scroll'));
        expect(btn.hidden).toBe(true);

        // Within the 40px threshold still counts as bottom → hidden.
        surface.scrollTop = 670;
        surface.dispatchEvent(new Event('scroll'));
        expect(btn.hidden).toBe(true);

        // Just past the threshold → visible again.
        surface.scrollTop = 650;
        surface.dispatchEvent(new Event('scroll'));
        expect(btn.hidden).toBe(false);
    });

    it('jumps the chat to the latest message when tapped', () => {
        const surface = document.getElementById('claudeChatSurface');
        const btn = document.getElementById('claudeScrollDown');
        mockSurfaceGeometry(surface, { scrollHeight: 1234, clientHeight: 300 });
        surface.scrollTop = 0;
        btn.click();
        expect(surface.scrollTop).toBe(1234);
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

    it('floats the scroll-to-bottom pill above the composer in the purple accent palette', () => {
        // The composer must be the positioning context so the absolutely-placed
        // pill anchors to it without shifting the input row.
        expect(extractTopLevelRule('.claudeComposer')).toMatch(/position:\s*relative/);
        const pill = extractTopLevelRule('.claudeScrollDown');
        expect(pill).toMatch(/position:\s*absolute/);
        // Centered horizontally and anchored just above the composer's top edge.
        expect(pill).toMatch(/left:\s*50%/);
        expect(pill).toMatch(/bottom:\s*100%/);
        expect(pill).toMatch(/translateX\(-50%\)/);
        // Purple accent palette: #2a2560 fill, #6C5DF5 border, #9D93EE arrow.
        expect(pill).toMatch(/background:\s*#2a2560/i);
        expect(pill).toMatch(/border:[^;]*#6C5DF5/i);
        expect(pill).toMatch(/color:\s*#9D93EE/i);
        // The base rule sets a flex display, so the [hidden] state needs an
        // explicit display: none override to actually hide the pill.
        expect(extractTopLevelRule('.claudeScrollDown[hidden]')).toMatch(/display:\s*none/);
    });

    it('renders the mic as a round icon button with a resting surface and hairline border', () => {
        // The neutral composer buttons carry a faint resting fill plus a hairline
        // border so they read as buttons rather than bare glyphs. Assert the base
        // .micButton rule is round, filled, bordered, and carries no static outer
        // glow (the purple halo lives on a separate :hover/:active rule).
        const mic = extractTopLevelRule('.micButton');
        expect(mic).toMatch(/border:\s*0\.5px solid var\(--border-mid\)/);
        expect(mic).toMatch(/background:\s*var\(--bg-elevated\)/);
        expect(mic).toMatch(/border-radius:\s*50%/);
        expect(mic).not.toMatch(/box-shadow:/);
    });

    it('styles the split send as a labeled pill + caret (accent-filled, Deep accent-filled)', () => {
        // Main button: a pill (left-rounded) filled with the same lighter accent
        // purple the dropdown picker (caret) uses, with a hairline border; the
        // caret mirrors it as the right half.
        const main = extractTopLevelRule('.claudeComposerSend');
        expect(main).toMatch(/border-radius:\s*18px 0 0 18px/);
        expect(main).toMatch(/background:\s*#6C5DF5/i);
        expect(main).toMatch(/border:\s*0\.5px solid var\(--border-mid\)/);
        const caret = extractTopLevelRule('.claudeComposerSendCaret');
        expect(caret).toMatch(/border-radius:\s*0 18px 18px 0/);
        // The caret button (which opens the mode menu) fills with the accent
        // purple; its glyph stays white (#fff) for white-on-purple contrast.
        expect(caret).toMatch(/background:\s*#6C5DF5/i);
        // The main button's label is white for contrast against the purple fill,
        // matching the dropdown picker it now shares a background with.
        expect(main).toMatch(/color:\s*#fff/i);
        expect(caret).toMatch(/color:\s*#fff/i);
        // Deep default: the main button fills with the solid purple accent.
        const deep = extractTopLevelRule('.claudeComposerSendDeep');
        expect(deep).toMatch(/background:\s*#6C5DF5/i);
        // The mode menu anchors above the split control, carries the neutral
        // elevated surface, and hides when [hidden].
        const menu = extractTopLevelRule('.claudeModeMenu');
        expect(menu).toMatch(/position:\s*absolute/);
        expect(menu).toMatch(/background:\s*var\(--bg-elevated\)/);
        expect(css).toMatch(/\.claudeModeMenu\[hidden\]\s*\{\s*display:\s*none/);
        // Attach: round icon button with the same resting surface and border.
        const attach = extractTopLevelRule('.claudeComposerAttach');
        expect(attach).toMatch(/border-radius:\s*50%/);
        expect(attach).toMatch(/background:\s*var\(--bg-elevated\)/);
        expect(attach).toMatch(/border:\s*0\.5px solid var\(--border-mid\)/);
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

// The chat workspace pill was retired as a control: the repo a conversation is
// framed around is now driven solely by the per-project auto-swap. These tests
// switch the active workspace the way the app now does — by pointing a throwaway
// project at the inject target whose repo matches and syncing to it.
// `seededRepos` mirrors the order passed to setInjectTargets in the block (the
// mock assigns target ids 'tgt-<index>' in that order).
let __wsProjCounter = 0;
async function switchWorkspaceTo(repo, seededRepos) {
    const id = 'tgt-' + seededRepos.indexOf(repo);
    const name = '__wsproj-' + (__wsProjCounter++);
    listLogic.addProject(name);
    listLogic.setProjectTargetId(name, id);
    syncClaudeSheetForProject(name);
    await flush();
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
    let readJson;
    let resultJson;

    function makeFetch() {
        // Track ids of entries injected this test so the `read` route can reflect
        // them as checked-off on main — the success path now confirms a ship by
        // reading the entry's checkbox off main, not by PR-search.
        const injectedIds = [];
        return vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            let json = { ok: true };
            if (body.chat) {
                json = { reply: 'Sure:\n```md\n- [ ] **[LOW]** Add a sparkle\n  - Type: feature\n```' };
            } else if (body.dispatch) {
                json = { dispatched: true, runUrl: 'https://github.com/x/y/actions/runs/1' };
            } else if (body.status) {
                json = statusJson;
            } else if (body.run_result) {
                json = resultJson;
            } else if (body.resolve) {
                json = resolveJson;
            } else if (body.read) {
                if (readJson !== null) {
                    json = readJson;
                } else {
                    // Default: every entry injected this test is marked complete
                    // on main, so a green run for it confirms as SHIPPED.
                    const content = injectedIds
                        .map((id) => '- [x] **[LOW]** Shipped\n  - Type: feature\n  <!-- id: ' + id + ' -->')
                        .join('\n\n');
                    json = { content: content, sha: 'sha1' };
                }
            } else if (body.entry) {
                injectedIds.push(body.id);
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
        readJson = null;
        resultJson = { result: 'The entry’s premise was already handled by later code, so nothing changed.' };
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

    // Pick a send-mode default via the caret menu, then send with the main button.
    function selectMode(mode) {
        document.getElementById('claudeComposerSendCaret').click();
        const opt = document.querySelector('.claudeModeOption[data-mode="' + mode + '"]');
        opt.click();
    }
    async function sendDeepMessage(text) {
        selectMode('deep');
        const input = document.getElementById('claudeComposerInput');
        input.value = text;
        document.getElementById('claudeComposerSend').click();
        await flush();
    }

    it('renders a split send button: a mode-labeled main button + a caret', () => {
        const send = document.getElementById('claudeComposerSend');
        const caret = document.getElementById('claudeComposerSendCaret');
        const composer = document.getElementById('claudeComposer');
        expect(send).toBeTruthy();
        expect(caret).toBeTruthy();
        // The main button carries a label span naming the active default; the
        // default starts Fast (no persisted choice in a fresh mount).
        const label = send.querySelector('.claudeSendModeLabel');
        expect(label).toBeTruthy();
        expect(label.textContent).toBe('Fast');
        expect(send.getAttribute('aria-label')).toBe('Send');
        // The caret opens a popup menu and sits in the same split control as the
        // main button, last in the composer row.
        expect(caret.getAttribute('aria-haspopup')).toBe('menu');
        expect(caret.getAttribute('aria-expanded')).toBe('false');
        expect(send.closest('.claudeSendSplit')).toBe(caret.closest('.claudeSendSplit'));
        expect(composer.contains(caret)).toBe(true);
        expect(send.compareDocumentPosition(caret) & Node.DOCUMENT_POSITION_FOLLOWING)
            .toBeTruthy();
    });

    it('the caret opens a Fast/Deep menu with a ★ on the active default', () => {
        const caret = document.getElementById('claudeComposerSendCaret');
        const menu = document.getElementById('claudeComposerModeMenu');
        expect(menu.hidden).toBe(true);
        caret.click();
        expect(menu.hidden).toBe(false);
        expect(caret.getAttribute('aria-expanded')).toBe('true');
        const fast = menu.querySelector('.claudeModeOption[data-mode="fast"]');
        const deep = menu.querySelector('.claudeModeOption[data-mode="deep"]');
        expect(fast.querySelector('.claudeModeName').textContent).toBe('Fast');
        expect(deep.querySelector('.claudeModeName').textContent).toBe('Deep');
        // Fast is the default, so its star is filled and Deep's is empty.
        expect(fast.querySelector('.claudeModeStar').textContent).toBe('★');
        expect(deep.querySelector('.claudeModeStar').textContent).toBe('');
        expect(fast.getAttribute('aria-checked')).toBe('true');
        expect(deep.getAttribute('aria-checked')).toBe('false');
    });

    it('selecting a mode persists it (todoapp_chatMode), repaints the label + ★, and closes the menu', () => {
        const send = document.getElementById('claudeComposerSend');
        const menu = document.getElementById('claudeComposerModeMenu');
        selectMode('deep');
        // Persisted under the documented key, survives reloads.
        expect(localStorage.getItem('todoapp_chatMode')).toBe('deep');
        // Main button now reads Deep, carries the accent class + deep aria-label.
        expect(send.querySelector('.claudeSendModeLabel').textContent).toBe('Deep');
        expect(send.classList.contains('claudeComposerSendDeep')).toBe(true);
        expect(send.getAttribute('aria-label')).toBe('Send deep');
        // The ★ moved to Deep; the menu closed on selection.
        expect(menu.hidden).toBe(true);
        document.getElementById('claudeComposerSendCaret').click();
        expect(menu.querySelector('.claudeModeOption[data-mode="deep"] .claudeModeStar').textContent).toBe('★');
        expect(menu.querySelector('.claudeModeOption[data-mode="fast"] .claudeModeStar').textContent).toBe('');
        // Switching back to Fast persists + repaints too.
        selectMode('fast');
        expect(localStorage.getItem('todoapp_chatMode')).toBe('fast');
        expect(send.querySelector('.claudeSendModeLabel').textContent).toBe('Fast');
        expect(send.classList.contains('claudeComposerSendDeep')).toBe(false);
    });

    it('closes the mode menu on outside-click and on Escape', () => {
        const caret = document.getElementById('claudeComposerSendCaret');
        const menu = document.getElementById('claudeComposerModeMenu');
        // Outside-click closes.
        caret.click();
        expect(menu.hidden).toBe(false);
        document.body.click();
        expect(menu.hidden).toBe(true);
        // Escape closes.
        caret.click();
        expect(menu.hidden).toBe(false);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(menu.hidden).toBe(true);
    });

    it('the persisted default hydrates on mount (Deep restored after reload)', () => {
        // Simulate a reload: a stored Deep default, then a fresh mount.
        localStorage.setItem('todoapp_chatMode', 'deep');
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        const send = document.getElementById('claudeComposerSend');
        expect(send.querySelector('.claudeSendModeLabel').textContent).toBe('Deep');
        expect(send.classList.contains('claudeComposerSendDeep')).toBe(true);
    });

    it('the main send POSTs deep_think per the default: true when Deep, omitted when Fast', async () => {
        await sendDeepMessage('think hard about this');
        const deepCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).chat);
        expect(JSON.parse(deepCall[1].body).deep_think).toBe(true);

        fetchSpy.mockClear();
        selectMode('fast');
        await sendMessage('quick one');
        const fastCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).chat);
        expect('deep_think' in JSON.parse(fastCall[1].body)).toBe(false);
    });

    it('Enter sends using the starred default (Deep → deep_think: true)', async () => {
        selectMode('deep');
        const input = document.getElementById('claudeComposerInput');
        input.value = 'via enter key';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await flush();
        const chatCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).chat);
        expect(JSON.parse(chatCall[1].body).deep_think).toBe(true);
    });

    it('a Deep default send shows a "Thinking deeply…" pending placeholder', () => {
        selectMode('deep');
        const input = document.getElementById('claudeComposerInput');
        input.value = 'deep dive';
        document.getElementById('claudeComposerSend').click();
        // Synchronously after the click, the pending bubble is on the surface
        // (the awaited Worker call hasn't resolved yet).
        const pending = document.querySelector('.claudeMsg--pending');
        expect(pending).toBeTruthy();
        expect(pending.textContent).toBe('Thinking deeply…');
    });

    it('disables and re-enables the main send + caret together while in flight', async () => {
        const send = document.getElementById('claudeComposerSend');
        const caret = document.getElementById('claudeComposerSendCaret');
        const input = document.getElementById('claudeComposerInput');
        input.value = 'in flight';
        document.getElementById('claudeComposerSend').click();
        // Mid-flight: the main send and its caret are disabled.
        expect(send.disabled).toBe(true);
        expect(caret.disabled).toBe(true);
        await flush();
        // Resolved: both re-enable together.
        expect(send.disabled).toBe(false);
        expect(caret.disabled).toBe(false);
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
        // A green run ships once its entry reads back checked-off on main (the
        // default `read` mock marks every injected entry complete).
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).toBe('SHIPPED');
    });

    // A run shipped from a chat session that was handed off from a needs_words
    // Agent-board card (via openChatWithSeed with a row id) must settle that row
    // to `shipped` at the terminal outcome — otherwise the card stays parked at
    // "Needs words" forever even after the work merges. The row link rides the
    // persisted run record, and the terminal setRunRecordStatus fires the settle.
    it('settles the originating Agent-board row to shipped when a hand-off run ships', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        openChatWithSeed('Discuss this task', 'row-abc');
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        // The run record carries the hand-off row id.
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].agentRowId).toBe('row-abc');
        // The row was settled through listLogic (the only agent_queue mutation path).
        const call = spy.mock.calls.find((c) => c[0] === 'row-abc');
        expect(call).toBeTruthy();
        expect(call[1].state).toBe('shipped');
        expect(call[1].entry_id).toBeTruthy();
        expect(call[1].correlation_id).toBeTruthy();
        spy.mockRestore();
    });

    it('settles the originating Agent-board row to failed when a hand-off run fails', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        statusJson = { found: true, status: 'completed', conclusion: 'failure' };
        openChatWithSeed('Discuss this task', 'row-xyz');
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Failed');
        const call = spy.mock.calls.find((c) => c[0] === 'row-xyz');
        expect(call).toBeTruthy();
        expect(call[1].state).toBe('failed');
        spy.mockRestore();
    });

    it('does not settle any row for a ship with no hand-off', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        expect(spy).not.toHaveBeenCalled();
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].agentRowId).toBe(null);
        spy.mockRestore();
    });

    it('a fresh unlinked seed clears a prior hand-off link so a later ship is not misattributed', async () => {
        const spy = vi.spyOn(listLogic, 'setAgentRunState').mockResolvedValue({ ok: true });
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        // Hand off row-abc, then seed a fresh unlinked conversation (no row id):
        // the link must drop so the subsequent ship settles nothing.
        openChatWithSeed('Discuss this task', 'row-abc');
        openChatWithSeed('A different, unlinked question');
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        expect(spy.mock.calls.find((c) => c[0] === 'row-abc')).toBeFalsy();
        spy.mockRestore();
    });

    // The chat ship path drives the SAME per-project active-run state the
    // viewer's header pill reads, so a run shipped from chat shows the pill on
    // the viewer for that project (and a second run on it is refused).
    function selectProject(name) {
        const proj = document.createElement('div');
        proj.className = 'selectedProject';
        proj.innerHTML = '<input id="projInput" value="' + name + '">';
        document.body.appendChild(proj);
    }

    it('writes the per-project active-run entry on ship (under the open project key)', async () => {
        selectProject('Alpha');
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        const key = 'todoapp_activeRun:' + encodeURIComponent('Alpha');
        const active = JSON.parse(localStorage.getItem(key));
        expect(active).toBeTruthy();
        expect(active.project).toBe('Alpha');
        expect(active.correlationId).toBeTruthy();
        expect(active.target.repo).toBeTruthy();
        // The run record also carries its project so the poller can free the guard.
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].project).toBe('Alpha');
    });

    it('clears the project active-run entry when the run reaches a terminal outcome', async () => {
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        selectProject('Beta');
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        const key = 'todoapp_activeRun:' + encodeURIComponent('Beta');
        expect(localStorage.getItem(key)).toBeNull();
    });

    it('refuses a second ship while the same project already has a fresh active run', async () => {
        selectProject('Gamma');
        localStorage.setItem(
            'todoapp_activeRun:' + encodeURIComponent('Gamma'),
            JSON.stringify({ correlationId: 'pre', project: 'Gamma', dispatchedAt: Date.now() })
        );
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        // The guard refused before injecting — no inject call fired.
        const injectCall = fetchSpy.mock.calls.find((c) => {
            const b = JSON.parse(c[1].body);
            return !b.chat && !b.dispatch && !b.status && b.entry;
        });
        expect(injectCall).toBeFalsy();
    });

    it('refuses a ship while the same project has a redeploy in progress', async () => {
        selectProject('Delta');
        // A manual redeploy owns this project's slot — a chat ship must not
        // dispatch a run on top of it (mutual exclusion with the viewer's Redeploy).
        localStorage.setItem(
            'todoapp_activeRedeploy:' + encodeURIComponent('Delta'),
            JSON.stringify({ startedAt: Date.now() })
        );
        await sendMessage('draft me an entry');
        const card = document.querySelector('.claudeDraftCard');
        card.querySelector('.claudeDraftInject').click();
        card.querySelector('.claudeDraftShip').click();
        await flush();

        // The guard refused before injecting — no inject call fired.
        const injectCall = fetchSpy.mock.calls.find((c) => {
            const b = JSON.parse(c[1].body);
            return !b.chat && !b.dispatch && !b.status && b.entry;
        });
        expect(injectCall).toBeFalsy();
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

    it('rehydrates run records from localStorage when switching to the Runs tab (not just on mount)', () => {
        // Mount happened against an empty store (beforeEach), so the Runs list
        // starts empty. Simulate another tab/window (or a prior session) writing
        // a record to the shared key after this sheet mounted.
        expect(document.querySelectorAll('.claudeRunRow').length).toBe(0);
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e-cross', correlationId: 'c-cross', title: 'Cross-tab task', status: 'SHIPPED', dispatchedAt: Date.now() },
        ]));
        // Switching to Runs must reload from localStorage and re-render, so the
        // record appears without a full page reload.
        document.getElementById('claudeTabRuns').click();
        const rows = document.querySelectorAll('.claudeRunRow');
        expect(rows.length).toBe(1);
        expect(rows[0].querySelector('.claudeRunTitle').textContent).toBe('Cross-tab task');
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

    // ── "No change" verdict on a green-but-no-op run ──
    // A graceful no-op run (entry reported ineligible, exits clean) returns
    // success but merges nothing, so it must NOT be stamped SHIPPED. The success
    // path confirms the ship by reading the entry's checkbox directly off main
    // via the index-free `read` route (no PR-search lag): an entry left present
    // and unchecked is the positive signature of a no-op, so the row reads
    // "No change" and links out to the Actions log instead of becoming iterable.

    it('commits "No change" when the entry reads back present and unchecked on main', async () => {
        // The routine left the entry unchecked (skipped it), so a single read off
        // main settles the verdict immediately — no grace window, no Shipped flash.
        statusJson = { found: true, status: 'completed', conclusion: 'success', runUrl: 'https://github.com/x/y/actions/runs/9', runId: 9 };
        readJson = { content: '# TODO\n\n- [ ] **[HIGH]** No-op run\n  - Type: bug\n  <!-- id: e1 -->', sha: 's' };
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'No-op run', status: 'RUNNING', repo: 'rsterenchak/toDoList_TOP', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('No change');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).toBe('NOCHANGE');
        // The Actions log URL is persisted so the verdict panel can link to it.
        expect(stored[0].runUrl).toBe('https://github.com/x/y/actions/runs/9');
        // The run id is persisted so the verdict panel can fetch the summary.
        expect(stored[0].runId).toBe(9);
    });

    it('ships a green run when the entry reads back checked-off on main', async () => {
        // A checked `- [x]` entry is positive proof the change merged → SHIPPED.
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        readJson = { content: '# TODO\n\n- [x] **[HIGH]** Shipped run\n  - Type: bug\n  <!-- id: e1 -->', sha: 's' };
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Shipped run', status: 'RUNNING', repo: 'rsterenchak/toDoList_TOP', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).toBe('SHIPPED');
    });

    it('fails safe to SHIPPED when the entry marker is absent from main', async () => {
        // Marker gone (completed-then-cleared, or squashed away) is an ambiguity,
        // and every ambiguity fails safe to SHIPPED so a real ship is never
        // misread as "No change".
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        readJson = { content: '# TODO\n\n- [x] **[LOW]** Some other entry\n  - Type: feature\n  <!-- id: other -->', sha: 's' };
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Cleared entry', status: 'RUNNING', repo: 'rsterenchak/toDoList_TOP', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).toBe('SHIPPED');
    });

    it('does not commit a verdict on a transient read failure — keeps polling', async () => {
        // A read failure (ok:false) is not a definitive answer; the row must stay
        // non-terminal and re-read on the next poll rather than guess a verdict.
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        readJson = {}; // no content string → readTodoMdFromWorker returns ok:false
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Blip', status: 'RUNNING', repo: 'rsterenchak/toDoList_TOP', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();

        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).not.toBe('NOCHANGE');
        expect(stored[0].status).not.toBe('SHIPPED');
        expect(stored[0].readMisses).toBe(1);
    });

    it('fails safe to SHIPPED once read failures pass the retry threshold', async () => {
        // Read keeps failing; rather than hang the row on Running forever, fail
        // safe toward SHIPPED once the misses pass the retry threshold.
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        readJson = {}; // persistent read failure
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Unreadable', status: 'RUNNING', repo: 'rsterenchak/toDoList_TOP', dispatchedAt: Date.now(), readMisses: 2 },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).toBe('SHIPPED');
    });

    it('keeps the legacy success → SHIPPED path for records with no entryId', async () => {
        // A record that predates entry-id verification can't be read back, so the
        // historical behavior (success → SHIPPED) is preserved — no regression.
        statusJson = { found: true, status: 'completed', conclusion: 'success' };
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { correlationId: 'c1', title: 'Legacy run', status: 'RUNNING', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();

        expect(document.querySelector('.claudeRunBadge').textContent).toBe('Shipped');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].status).toBe('SHIPPED');
    });

    it('renders a "No change" row as a non-iterable expand/collapse accordion', () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'No-op', status: 'NOCHANGE', runUrl: 'https://github.com/x/y/actions/runs/9', runId: 9, dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        const row = document.querySelector('.claudeRunRow');
        expect(row.querySelector('.claudeRunBadge').textContent).toBe('No change');
        // Not iterable; instead a collapsible accordion with an expand chevron.
        expect(row.classList.contains('claudeRunRow--iterable')).toBe(false);
        expect(row.classList.contains('claudeRunRow--nochange')).toBe(true);
        expect(row.getAttribute('role')).toBe('button');
        expect(row.getAttribute('aria-expanded')).toBe('false');
        expect(row.querySelector('.claudeRunChevron')).toBeTruthy();
        // Collapsed by default — the panel exists but is hidden, and tapping the
        // header no longer opens the log directly.
        const panel = row.querySelector('.claudeRunResultPanel');
        expect(panel).toBeTruthy();
        expect(panel.hidden).toBe(true);

        const opened = [];
        const realOpen = window.open;
        window.open = (url) => { opened.push(url); return null; };
        row.click();
        window.open = realOpen;
        expect(opened).toEqual([]); // tap toggles, never opens a window
        expect(panel.hidden).toBe(false);
        expect(row.getAttribute('aria-expanded')).toBe('true');
    });

    it('lazily fetches and caches the run summary on first expand', async () => {
        resultJson = { result: 'Premise superseded; nothing to do.' };
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'No-op', status: 'NOCHANGE', runUrl: 'https://github.com/x/y/actions/runs/9', runId: 42, repo: 'rsterenchak/toDoList_TOP', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        const row = document.querySelector('.claudeRunRow');
        // No fetch happens until the row is expanded.
        expect(fetchSpy.mock.calls.some((c) => JSON.parse(c[1].body).run_result)).toBe(false);

        row.click();
        await flush();

        const resultCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).run_result);
        expect(resultCall).toBeTruthy();
        // Keyed on the persisted run id, scoped to the run's repo.
        const resultBody = JSON.parse(resultCall[1].body);
        expect(resultBody.run_id).toBe(42);
        expect(resultBody.repo).toBe('rsterenchak/toDoList_TOP');
        // The summary renders and is cached on the record.
        expect(row.querySelector('.claudeRunResultText').textContent).toBe('Premise superseded; nothing to do.');
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].result).toBe('Premise superseded; nothing to do.');

        // Collapse then re-expand: the cached summary renders with no second fetch.
        const callsAfterFirst = fetchSpy.mock.calls.filter((c) => JSON.parse(c[1].body).run_result).length;
        row.click(); // collapse
        row.click(); // re-expand
        await flush();
        const callsAfterReexpand = fetchSpy.mock.calls.filter((c) => JSON.parse(c[1].body).run_result).length;
        expect(callsAfterReexpand).toBe(callsAfterFirst);
        expect(row.querySelector('.claudeRunResultText').textContent).toBe('Premise superseded; nothing to do.');
    });

    it('falls back to the default repo target when older records carry no run id', async () => {
        resultJson = { result: '' }; // empty summary → fallback copy
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c-old', title: 'Legacy no-op', status: 'NOCHANGE', runUrl: 'https://x', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        const row = document.querySelector('.claudeRunRow');
        row.click();
        await flush();

        // No run id on the record → the correlation id rides in its place.
        const resultBody = JSON.parse(fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).run_result)[1].body);
        expect(resultBody.run_id).toBe('c-old');
        // Empty result → the one-line fallback, with the log link still present.
        const text = row.querySelector('.claudeRunResultText');
        expect(text.classList.contains('claudeRunResultText--empty')).toBe(true);
        expect(row.querySelector('.claudeRunResultLogLink')).toBeTruthy();
    });

    it('"Follow up" seeds a plain author turn carrying the entry block and summary, with no entry_id', async () => {
        resultJson = { result: 'It was already fixed upstream.' };
        readJson = { content: '# TODO\n\n- [ ] **[MEDIUM]** Fix the thing\n  - Type: bug\n  - Description: do the fix\n  <!-- id: e1 -->', sha: 's' };
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'Fix the thing', status: 'NOCHANGE', runUrl: 'https://x', runId: 7, repo: 'rsterenchak/toDoList_TOP', result: 'It was already fixed upstream.', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        const row = document.querySelector('.claudeRunRow');
        row.click(); // expand (result already cached → no fetch)
        await flush();

        const followBtn = row.querySelector('.claudeRunFollowUpBtn');
        expect(followBtn).toBeTruthy();
        followBtn.click();
        await flush();

        // The Follow-up chat turn is a plain author turn: a chat call fired, it
        // carries the entry block + summary, and it must NOT send entry_id (a
        // NOCHANGE run has no merged PR to iterate on).
        const chatCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).chat);
        expect(chatCall).toBeTruthy();
        const chatBody = JSON.parse(chatCall[1].body);
        expect(chatBody.entry_id).toBeUndefined();
        const lastUserTurn = chatBody.messages[chatBody.messages.length - 1].content;
        expect(lastUserTurn).toContain('made no change');
        expect(lastUserTurn).toContain('Fix the thing'); // entry block
        expect(lastUserTurn).toContain('It was already fixed upstream.'); // summary
        // The chat tab is now active.
        expect(document.getElementById('claudeChatSurface')).toBeTruthy();
    });

    it('treats "No change" as a terminal, clearable status', () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'e1', correlationId: 'c1', title: 'No-op', status: 'NOCHANGE', runUrl: 'https://x', dispatchedAt: Date.now() },
        ]));
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        // Clear-completed surfaces for the terminal No-change row, and clearing
        // removes it.
        expect(document.getElementById('claudeRunsClear')).toBeTruthy();
        document.getElementById('claudeRunsClear').click();
        document.querySelector('.claudeRunsClearYes').click();
        expect(document.querySelector('.claudeRunRow')).toBeFalsy();
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
        await switchWorkspaceTo(repo, [DEFAULT_REPO, OTHER_REPO]);
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

    it('keeps the entry id on follow-up turns of an active iterate session', async () => {
        seedShippedRun();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRow').click();
        await flush();

        const input = document.getElementById('claudeComposerInput');
        input.value = 'make it bigger';
        document.getElementById('claudeComposerSend').click();
        await flush();

        // The seed turn established the iterate session, so the follow-up
        // re-sends the entry id — the Worker re-serves the cached diff seed.
        expect(chatBodies.length).toBe(2);
        expect(chatBodies[1].entry_id).toBe('entry-42');
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

    it('does not establish an iterate session when the seed 404s, so follow-ups omit the entry id', async () => {
        // The seed (first chat call) 404s; later chat calls succeed. A 404
        // seed must clear the iterate id so the follow-up never re-sends it.
        const bodies = [];
        let chatCalls = 0;
        globalThis.fetch = vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            if (body.chat) {
                bodies.push(body);
                chatCalls += 1;
                if (chatCalls === 1) {
                    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
                }
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'ok' }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
        });
        seedShippedRun();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRow').click();
        await flush();

        const input = document.getElementById('claudeComposerInput');
        input.value = 'follow up';
        document.getElementById('claudeComposerSend').click();
        await flush();

        expect(bodies.length).toBe(2);
        expect(bodies[0].entry_id).toBe('entry-42'); // seed carried it…
        expect(bodies[1].entry_id).toBeUndefined();   // …but the 404 cleared the session.
    });

    it('"+ New Chat" clears the active iterate session so the next turn omits the entry id', async () => {
        seedShippedRun();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRow').click();
        await flush();
        expect(chatBodies[0].entry_id).toBe('entry-42');

        document.getElementById('claudeClearChat').click();

        const input = document.getElementById('claudeComposerInput');
        input.value = 'fresh question';
        document.getElementById('claudeComposerSend').click();
        await flush();

        expect(chatBodies.length).toBe(2);
        expect(chatBodies[1].entry_id).toBeUndefined();
    });
});

// The iterate entry id is per-repo state: switching the chat workspace resumes
// the new repo's iterate session (or none), and switching back restores the
// original repo's session — an id is never dragged across repos.
describe('Claude sheet — iterate entry is per-repo across workspace swaps', () => {
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
            if (body.chat) {
                chatBodies.push(body);
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'ok' }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    async function sendTurn(text) {
        const input = document.getElementById('claudeComposerInput');
        input.value = text;
        document.getElementById('claudeComposerSend').click();
        await flush();
    }

    it('a workspace swap drops the prior repo\'s iterate id, and swapping back restores it', async () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'entry-42', correlationId: 'corr-1', title: 'Add a sparkle', status: 'SHIPPED', dispatchedAt: Date.now() },
        ]));
        mountClaudeSheet(document.body);
        await flush();

        // Establish an iterate session on the default repo.
        document.querySelector('.claudeRunRow').click();
        await flush();
        await sendTurn('first follow-up');
        expect(chatBodies[chatBodies.length - 1].entry_id).toBe('entry-42');

        // Swap to the other repo: no iterate session there → no entry_id.
        await switchWorkspaceTo(OTHER_REPO, [DEFAULT_REPO, OTHER_REPO]);
        await sendTurn('on the other repo');
        expect(chatBodies[chatBodies.length - 1].entry_id).toBeUndefined();

        // Swap back: the default repo's iterate session resumes.
        await switchWorkspaceTo(DEFAULT_REPO, [DEFAULT_REPO, OTHER_REPO]);
        await sendTurn('back on the default repo');
        expect(chatBodies[chatBodies.length - 1].entry_id).toBe('entry-42');
    });
});

// Revert control on SHIPPED rows: a per-run rollback affordance that ships a
// revert through the Worker's full-auto `revert` route, coexisting with the
// whole-row iterate behavior without ever firing it.
describe('Claude sheet — revert a shipped run', () => {
    let realFetch;
    let fetchSpy;
    let revertResponse;
    let chatCalls;

    function makeFetch() {
        chatCalls = 0;
        return vi.fn((url, opts) => {
            const body = JSON.parse(opts.body);
            let json = { ok: true };
            if (body.chat) { chatCalls++; json = { reply: 'iterate seed' }; }
            else if (body.revert) { json = revertResponse; }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(json) });
        });
    }

    function seedShipped(extra) {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            Object.assign({ entryId: 'entry-9', correlationId: 'corr-9', title: 'Add a sparkle', status: 'SHIPPED', dispatchedAt: Date.now() }, extra || {}),
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
        revertResponse = { merged: true };
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    it('renders a Revert control only on shipped rows with an entry id', () => {
        seedShipped();
        mountClaudeSheet(document.body);
        expect(document.querySelector('.claudeRunRevertBtn')).toBeTruthy();
    });

    it('does not render Revert on a queued, no-change, id-less, or already-reverted row', () => {
        localStorage.setItem('todoapp_claudeRuns', JSON.stringify([
            { entryId: 'q1', correlationId: 'c1', title: 'Pending', status: 'QUEUED', dispatchedAt: Date.now() },
            { entryId: 'n1', correlationId: 'c2', title: 'No-op', status: 'NOCHANGE', runUrl: 'https://x', dispatchedAt: Date.now() },
            { correlationId: 'c3', title: 'Legacy shipped', status: 'SHIPPED', dispatchedAt: Date.now() },
            { entryId: 'r1', correlationId: 'c4', title: 'Already reverted', status: 'SHIPPED', reverted: true, dispatchedAt: Date.now() },
        ]));
        mountClaudeSheet(document.body);
        expect(document.querySelector('.claudeRunRevertBtn')).toBeFalsy();
    });

    it('clicking Revert opens a confirm and does not trigger the row iterate action', () => {
        seedShipped();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRevertBtn').click();
        // The confirmation modal opened (revert path) …
        expect(document.getElementById('confirmModalBackdrop')).toBeTruthy();
        // … and the click never bubbled to the row's iterate handler (no chat turn).
        expect(chatCalls).toBe(0);
    });

    it('confirming a revert POSTs the revert contract and marks the record reverted', async () => {
        seedShipped({ repo: 'rsterenchak/toDoList_TOP' });
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRevertBtn').click();
        document.getElementById('confirmModalConfirm').click();
        await flush();

        const revertCall = fetchSpy.mock.calls.find((c) => JSON.parse(c[1].body).revert);
        expect(revertCall).toBeTruthy();
        const revertBody = JSON.parse(revertCall[1].body);
        expect(revertBody.revert).toBe(true);
        expect(revertBody.entry_id).toBe('entry-9');
        expect(revertBody.repo).toBe('rsterenchak/toDoList_TOP');

        // merged:true → record marked reverted and persisted; the control no
        // longer shows so it can't be re-submitted (double-revert guard).
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].reverted).toBe(true);
        expect(document.querySelector('.claudeRunRevertBtn')).toBeFalsy();
    });

    it('on merged:false persists the revert PR url and switches to opening it', async () => {
        revertResponse = { merged: false, reason: 'merge conflict', revert_pr_url: 'https://github.com/x/y/pull/7' };
        seedShipped();
        mountClaudeSheet(document.body);
        document.querySelector('.claudeRunRevertBtn').click();
        document.getElementById('confirmModalConfirm').click();
        await flush();

        const stored = JSON.parse(localStorage.getItem('todoapp_claudeRuns'));
        expect(stored[0].revertPrUrl).toBe('https://github.com/x/y/pull/7');
        expect(stored[0].reverted).toBeUndefined();

        // The control is still present and now opens the existing PR rather than
        // POSTing a second revert (never create a duplicate revert PR).
        const revertCallsBefore = fetchSpy.mock.calls.filter((c) => JSON.parse(c[1].body).revert).length;
        const opened = [];
        const realOpen = window.open;
        window.open = (u) => { opened.push(u); return null; };
        document.querySelector('.claudeRunRevertBtn').click();
        window.open = realOpen;
        expect(opened).toEqual(['https://github.com/x/y/pull/7']);
        const revertCallsAfter = fetchSpy.mock.calls.filter((c) => JSON.parse(c[1].body).revert).length;
        expect(revertCallsAfter).toBe(revertCallsBefore);
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

    // Switch the chat-level workspace via the per-project auto-swap.
    async function switchWorkspace(repo) {
        await switchWorkspaceTo(repo, [DEFAULT_REPO, OTHER_REPO]);
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
        // The auto-swap collapses the picker, so open it after the switch to read
        // the mode it settles into for the new workspace.
        await switchWorkspace(OTHER_REPO);
        await openPicker();
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

// The chat-level workspace pill is retired as an interactive control: repo
// framing is now governed entirely by the per-project auto-swap, so the pill
// carries no click listener and opens no menu. The node persists, hidden, as the
// live read-out of the active workspace repo (renderWorkspacePill keeps it
// current), and the active repo still rides every chat turn as `body.repo`.
describe('Claude sheet — chat-level workspace pill (retired control)', () => {
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

    it('keeps the hidden pill node as the read-out of the current (default) workspace', () => {
        const pill = document.getElementById('claudeWorkspacePill');
        expect(pill).toBeTruthy();
        expect(pill.textContent).toContain('toDoList_TOP');
        // The pill is retired as a control: hidden and out of the tab order.
        expect(pill.hidden).toBe(true);
        expect(pill.tabIndex).toBe(-1);
    });

    it('opens no menu and carries no click handler — the pill is inert', () => {
        document.getElementById('claudeWorkspacePill').click();
        // No dropdown is ever built or attached to a hidden node.
        expect(document.getElementById('claudeWorkspaceMenu')).toBe(null);
        expect(document.querySelector('.claudeWorkspaceItem')).toBe(null);
        // The active workspace is unchanged by tapping the inert pill.
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('toDoList_TOP');
    });

    it('frames the chat turn around the active (default) workspace repo', async () => {
        await sendMessage('hello in the default workspace');
        const lastBody = chatBodies[chatBodies.length - 1];
        expect(lastBody.repo).toBe(DEFAULT_REPO);
    });

    it('reframes the next send when the workspace auto-swaps to another repo', async () => {
        const BOOKHAVEN_REPO = 'rsterenchak/BookHavenBookstore_Sophia';
        await switchWorkspaceTo(BOOKHAVEN_REPO, [DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('BookHavenBookstore_Sophia');

        await sendMessage('hello in the BookHaven workspace');
        const lastBody = chatBodies[chatBodies.length - 1];
        expect(lastBody.repo).toBe(BOOKHAVEN_REPO);
    });
});

// The workspace repo projection excludes disabled inject targets: a target
// toggled off in Inject settings (`enabled === false`) must not be selectable in
// the chat workspace pill (or, by extension, the Structure repo picker), because
// the Worker's allowlist drops disabled repos and a chat framed on one would 400
// at inject/dispatch. A legacy row with no `enabled` column still shows (the
// filter is `enabled !== false`, not `enabled === true`), and if every target is
// disabled the default-repo fallback keeps the chat usable.
describe('Claude sheet — disabled inject targets excluded from workspace repos', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    const ENABLED_REPO = 'rsterenchak/matchingGame-test';
    const DISABLED_REPO = 'rsterenchak/BookHavenBookstore_Sophia';
    let realFetch;

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        realFetch = globalThis.fetch;
        // Manifest fetches 404 so no async workspace override races the projection.
        globalThis.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) }));
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    it('drops an enabled:false target while keeping enabled and legacy (undefined) rows', async () => {
        supaState.injectTargets = [
            { id: 'tgt-0', nickname: DEFAULT_REPO, repo: DEFAULT_REPO, file_path: 'TODO.md', enabled: true },
            { id: 'tgt-1', nickname: ENABLED_REPO, repo: ENABLED_REPO, file_path: 'TODO.md' },
            { id: 'tgt-2', nickname: DISABLED_REPO, repo: DISABLED_REPO, file_path: 'TODO.md', enabled: false },
        ];
        mountClaudeSheet(document.body);
        await flush();
        const repos = getAttachRepos();
        expect(repos).toContain(DEFAULT_REPO);
        expect(repos).toContain(ENABLED_REPO);
        expect(repos).not.toContain(DISABLED_REPO);
    });

    it('falls back to the default repo when every target is disabled', async () => {
        supaState.injectTargets = [
            { id: 'tgt-0', nickname: ENABLED_REPO, repo: ENABLED_REPO, file_path: 'TODO.md', enabled: false },
            { id: 'tgt-1', nickname: DISABLED_REPO, repo: DISABLED_REPO, file_path: 'TODO.md', enabled: false },
        ];
        mountClaudeSheet(document.body);
        await flush();
        expect(getAttachRepos()).toEqual([DEFAULT_REPO]);
    });

    // Project-derived workspace swap (autoSwapWorkspaceForProject) must also
    // honor `enabled`: a project routed to a target that was later disabled must
    // NOT frame the chat on that disabled repo, since inject/dispatch would 400.
    it('does not swap the workspace onto a project routed to a disabled target', async () => {
        supaState.injectTargets = [
            { id: 'tgt-0', nickname: DEFAULT_REPO, repo: DEFAULT_REPO, file_path: 'TODO.md', enabled: true },
            { id: 'tgt-1', nickname: DISABLED_REPO, repo: DISABLED_REPO, file_path: 'TODO.md', enabled: false },
        ];
        mountClaudeSheet(document.body);
        await flush();
        expect(getActiveChatRepo()).toBe(DEFAULT_REPO);

        const proj = '__disabled-routed-proj';
        listLogic.addProject(proj);
        listLogic.setProjectTargetId(proj, 'tgt-1');
        syncClaudeSheetForProject(proj);
        await flush();
        // Disabled target does not resolve → workspace stays on its enabled repo.
        expect(getActiveChatRepo()).toBe(DEFAULT_REPO);
    });

    it('still swaps the workspace onto a project routed to an enabled target', async () => {
        supaState.injectTargets = [
            { id: 'tgt-0', nickname: DEFAULT_REPO, repo: DEFAULT_REPO, file_path: 'TODO.md', enabled: true },
            { id: 'tgt-1', nickname: ENABLED_REPO, repo: ENABLED_REPO, file_path: 'TODO.md', enabled: true },
        ];
        mountClaudeSheet(document.body);
        await flush();
        expect(getActiveChatRepo()).toBe(DEFAULT_REPO);

        const proj = '__enabled-routed-proj';
        listLogic.addProject(proj);
        listLogic.setProjectTargetId(proj, 'tgt-1');
        syncClaudeSheetForProject(proj);
        await flush();
        expect(getActiveChatRepo()).toBe(ENABLED_REPO);
    });
});

// The "Clear chat" control in the tab row: a text-only button, right of the
// CHAT / RUNS selector, that wipes the current conversation — the in-memory
// messages, their persisted copy, and the rendered bubbles — while leaving the
// attached file chips and the active workspace untouched.
describe('Claude sheet — Clear chat control', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    const CHAT_KEY = 'todoapp_claudeChat';
    let realFetch;
    let chatBodies;

    function makeFetch() {
        chatBodies = [];
        return vi.fn((url, opts) => {
            // Manifest 404s so the picker uses the free-text path input these
            // tests attach through.
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            }
            const body = JSON.parse(opts.body);
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
        setInjectTargets([DEFAULT_REPO]);
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
        mountClaudeSheet(document.body);
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

    it('renders a text-only New Chat button in the tab row, right of the tabs', () => {
        const btn = document.getElementById('claudeClearChat');
        expect(btn).toBeTruthy();
        expect(btn.textContent).toBe('+ New Chat');
        // Lives in the tab row alongside the CHAT / RUNS selector.
        expect(document.getElementById('claudeSheetTabs').contains(btn)).toBe(true);
        // It trails the tab group in DOM order (right of the selector).
        const group = document.querySelector('.claudeTabGroup');
        expect(group.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('wipes the rendered bubbles, the in-memory thread, and its persisted copy', async () => {
        await sendMessage('first message');
        expect(document.querySelectorAll('.claudeMsg').length).toBeGreaterThan(0);
        // The thread was persisted under the active repo.
        expect(JSON.parse(localStorage.getItem(CHAT_KEY))[DEFAULT_REPO].length).toBeGreaterThan(0);

        document.getElementById('claudeClearChat').click();
        await flush();

        // The conversation bubbles are gone; only the persistent capabilities
        // intro note remains on the now-empty thread.
        expect(document.querySelectorAll('.claudeMsg--user, .claudeMsg--assistant').length).toBe(0);
        expect(document.getElementById('claudeChatIntro')).toBeTruthy();
        const stored = JSON.parse(localStorage.getItem(CHAT_KEY) || '{}');
        expect(stored[DEFAULT_REPO]).toBeUndefined();
    });

    it('leaves the attached file chips intact', async () => {
        // Attach a file via the free-text picker.
        document.getElementById('claudeComposerAttach').click();
        await flush();
        const pathInput = document.getElementById('claudeAttachPathInput');
        pathInput.value = 'toDoList_main/src/inject.js';
        document.getElementById('claudeAttachPathAdd').click();
        expect(document.querySelectorAll('.claudeAttachChip').length).toBe(1);

        await sendMessage('a message with an attachment');
        document.getElementById('claudeClearChat').click();
        await flush();

        // Messages gone (only the intro note remains), but the chip survives.
        expect(document.querySelectorAll('.claudeMsg--user, .claudeMsg--assistant').length).toBe(0);
        expect(document.querySelectorAll('.claudeAttachChip').length).toBe(1);
    });

    it('keeps the active workspace so the next send still carries its repo', async () => {
        await sendMessage('first');
        document.getElementById('claudeClearChat').click();
        await flush();
        await sendMessage('after clearing');
        const lastBody = chatBodies[chatBodies.length - 1];
        expect(lastBody.repo).toBe(DEFAULT_REPO);
    });

    it('hides the Clear chat button on the Runs tab', () => {
        const btn = document.getElementById('claudeClearChat');
        expect(btn.hidden).toBe(false);
        document.getElementById('claudeTabRuns').click();
        expect(btn.hidden).toBe(true);
        document.getElementById('claudeTabChat').click();
        expect(btn.hidden).toBe(false);
    });
});

// The capabilities intro note: a persistent, muted note pinned to the top of an
// empty chat thread that names what the Sonnet chat can do in scope. It shows on
// any empty (per-repo) thread, is dropped when the first real turn is sent, and
// re-renders after a New Chat reset.
describe('Claude sheet — empty-thread capabilities intro note', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    let realFetch;

    function makeFetch() {
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'ok' }) });
        });
    }

    beforeEach(async () => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        setInjectTargets([DEFAULT_REPO]);
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
        mountClaudeSheet(document.body);
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

    it('renders the intro note at the top of an empty thread on mount', () => {
        const intro = document.getElementById('claudeChatIntro');
        expect(intro).toBeTruthy();
        // It reuses the muted note treatment and names the four in-scope actions.
        expect(intro.classList.contains('claudeMsg--note')).toBe(true);
        expect(intro.textContent).toContain('drafts TODO entries');
        expect(intro.textContent).toContain('file attachments');
        expect(intro.textContent).toContain('another repo');
        expect(intro.textContent).toContain('iterates on shipped runs');
        // It's the first (and only) bubble on the empty surface.
        const surface = document.getElementById('claudeChatSurface');
        expect(surface.firstElementChild).toBe(intro);
        expect(surface.querySelectorAll('.claudeMsg--user, .claudeMsg--assistant').length).toBe(0);
    });

    it('is never persisted into the stored thread', () => {
        const stored = JSON.parse(localStorage.getItem('todoapp_claudeChat') || '{}');
        expect(stored[DEFAULT_REPO]).toBeUndefined();
    });

    it('drops the intro note once the first message is sent', async () => {
        expect(document.getElementById('claudeChatIntro')).toBeTruthy();
        await sendMessage('add a sparkle');
        expect(document.getElementById('claudeChatIntro')).toBe(null);
        expect(document.querySelector('.claudeMsg--user').textContent).toBe('add a sparkle');
    });

    it('re-renders the intro note after a New Chat reset', async () => {
        await sendMessage('first message');
        expect(document.getElementById('claudeChatIntro')).toBe(null);

        document.getElementById('claudeClearChat').click();
        await flush();

        const intro = document.getElementById('claudeChatIntro');
        expect(intro).toBeTruthy();
        expect(intro.classList.contains('claudeMsg--note')).toBe(true);
    });
});

// The workspace repo list is projected from the user's Inject targets (the
// `inject_targets` Supabase table, cached in inject.js) rather than the Worker
// allowlist, so the active workspace never drifts onto a repo the targets no
// longer carry. The list starts on a safe fallback (the default repo only) and
// is replaced once the cache loads; an empty cache leaves the fallback in place
// so the chat is always usable. These tests drive the cache via setInjectTargets
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

    it('falls back to the default repo and stays usable when the targets list is empty', async () => {
        setInjectTargets([]);
        mountClaudeSheet(document.body);
        await flush();
        // The active workspace falls back to the default repo, and the chat is
        // still usable on it.
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('toDoList_TOP');
        expect(document.getElementById('claudeComposerInput').disabled).toBe(false);
        expect(document.getElementById('claudeComposerSend').disabled).toBe(false);
    });

    it('auto-swaps the active workspace to a target repo', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        await switchWorkspaceTo(BOOKHAVEN_REPO, [DEFAULT_REPO, OTHER_REPO, BOOKHAVEN_REPO]);
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('BookHavenBookstore_Sophia');
    });

    // The on-open refresh re-projects the targets and repaints the read-out only —
    // it must not wipe chatHistory, attachments, or the active workspace.
    it('preserves the active workspace and chat history when the on-open refresh resolves', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        openClaudeSheet();
        await flush();

        await switchWorkspaceTo(OTHER_REPO, [DEFAULT_REPO, OTHER_REPO]);
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
    // isn't stranded on a repo the targets list no longer carries. Chat history
    // is preserved — the fallback only repaints the read-out.
    it('falls back to the first target when the active workspace target was deleted', async () => {
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
        mountClaudeSheet(document.body);
        await flush();
        openClaudeSheet();
        await flush();
        await switchWorkspaceTo(OTHER_REPO, [DEFAULT_REPO, OTHER_REPO]);
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
        await switchWorkspaceTo(OTHER_REPO, [DEFAULT_REPO, OTHER_REPO]);
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('matchingGame-test');

        // All targets are deleted; the change event fires.
        setInjectTargets([]);
        document.dispatchEvent(new CustomEvent('injectTargetsChanged'));
        await flush();
        expect(document.getElementById('claudeWorkspacePill').textContent).toContain('toDoList_TOP');
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

    // Switch the chat-level workspace via the per-project auto-swap. When the
    // picker is open it re-syncs to the new workspace's manifest.
    async function switchWorkspace(repo) {
        await switchWorkspaceTo(repo, [DEFAULT_REPO, OTHER_REPO]);
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
        // The auto-swap collapses the picker, so open it after the switch.
        await switchWorkspace(OTHER_REPO);
        await openPicker();
        expect(document.getElementById('claudeAttachSearch').hidden).toBe(false);
        expect(document.getElementById('claudeAttachPathRow').hidden).toBe(true);
        expect(listPaths()).toEqual(GAME_MANIFEST);
        // The manifest URL was derived by convention from the repo string.
        expect(manifestFetches.some((u) => u === 'https://rsterenchak.github.io/matchingGame-test/src-manifest.json')).toBe(true);
    });

    it('falls back to the free-text input when the manifest fetch 404s', async () => {
        manifestByRepo['matchingGame-test'] = null;
        await switchWorkspace(OTHER_REPO);
        await openPicker();
        expect(document.getElementById('claudeAttachPathRow').hidden).toBe(false);
        expect(document.getElementById('claudeAttachSearch').hidden).toBe(true);
        expect(document.getElementById('claudeAttachList').hidden).toBe(true);
    });

    it('swaps the list when switching repos without leaking the previous repo files', async () => {
        // Each workspace switch collapses the picker; re-open it to read the list
        // the picker settles into for the now-active workspace.
        await openPicker();
        expect(listPaths()).toEqual(TODO_MANIFEST);
        await switchWorkspace(OTHER_REPO);
        await openPicker();
        expect(listPaths()).toEqual(GAME_MANIFEST);
        // Switching back shows the default repo's list again, not a mix.
        await switchWorkspace(DEFAULT_REPO);
        await openPicker();
        expect(listPaths()).toEqual(TODO_MANIFEST);
    });

    it('caches each repo manifest so re-selecting it does not re-fetch', async () => {
        await openPicker();
        await switchWorkspace(OTHER_REPO);
        await openPicker();
        await switchWorkspace(DEFAULT_REPO);
        await openPicker();
        await switchWorkspace(OTHER_REPO);
        await openPicker();
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
    let resolveJson;
    let chatBodies;
    let replyText;

    function makeFetch() {
        chatBodies = [];
        const injectedIds = [];
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
            } else if (body.resolve) {
                json = resolveJson;
            } else if (body.read) {
                // Reflect every entry injected this test as checked-off on main so
                // a green run for it confirms as SHIPPED via the read route.
                const content = injectedIds
                    .map((id) => '- [x] **[LOW]** Shipped\n  - Type: feature\n  <!-- id: ' + id + ' -->')
                    .join('\n\n');
                json = { content: content, sha: 'sha1' };
            } else if (body.entry) {
                injectedIds.push(body.id);
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
        // A green run ships only once its marker resolves to a merged PR.
        resolveJson = { found: true, pr_number: 7, merge_commit_sha: 'abc' };
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
        // revertEntry POSTs the { revert: true, entry_id } rollback contract.
        expect(inject).toMatch(/export\s+async\s+function\s+revertEntry\s*\(/);
        expect(inject).toMatch(/revert:\s*true/);
    });

    it('styles the per-row Revert control on shipped runs', () => {
        expect(css).toMatch(/\.claudeRunRevertBtn\s*\{/);
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

// Per-repo chat persistence: the in-app chat thread is mirrored to localStorage
// under `todoapp_claudeChat` as a { [repo]: [{role, content}] } map, written
// after each turn and hydrated (and replayed onto the surface) on mount, so the
// conversation survives a reload / PWA relaunch.
describe('Claude sheet — chat history persisted per repo', () => {
    const CHAT_KEY = 'todoapp_claudeChat';
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    let realFetch;

    function makeFetch() {
        return vi.fn((url, opts) => {
            if (typeof url === 'string' && url.indexOf('src-manifest.json') !== -1) {
                return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
            }
            const body = JSON.parse(opts.body);
            if (body.repos) {
                return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({
                    ok: true, default: DEFAULT_REPO, repos: [{ repo: DEFAULT_REPO, srcPrefix: 'toDoList_main/src/' }],
                }) });
            }
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'assistant reply' }) });
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        setInjectTargets([DEFAULT_REPO]);
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    function readMap() {
        return JSON.parse(localStorage.getItem(CHAT_KEY) || '{}');
    }

    it('persists the user and assistant turns to the active repo\'s thread after a send', async () => {
        mountClaudeSheet(document.body);
        await flush();

        const input = document.getElementById('claudeComposerInput');
        input.value = 'remember me';
        document.getElementById('claudeComposerSend').click();
        await flush();

        const thread = readMap()[DEFAULT_REPO];
        expect(Array.isArray(thread)).toBe(true);
        expect(thread).toEqual([
            { role: 'user', content: 'remember me' },
            { role: 'assistant', content: 'assistant reply' },
        ]);
    });

    it('hydrates and replays the active repo\'s saved thread on mount', async () => {
        localStorage.setItem(CHAT_KEY, JSON.stringify({
            [DEFAULT_REPO]: [
                { role: 'user', content: 'earlier question' },
                { role: 'assistant', content: 'earlier answer' },
            ],
        }));

        mountClaudeSheet(document.body);
        await flush();

        const surface = document.getElementById('claudeChatSurface');
        expect(surface.textContent).toContain('earlier question');
        expect(surface.textContent).toContain('earlier answer');
        expect(surface.querySelectorAll('.claudeMsg--user').length).toBe(1);
        expect(surface.querySelectorAll('.claudeMsg--assistant').length).toBe(1);
    });

    it('starts empty when the active repo has no saved thread', async () => {
        localStorage.setItem(CHAT_KEY, JSON.stringify({ 'someone/Else': [{ role: 'user', content: 'not mine' }] }));

        mountClaudeSheet(document.body);
        await flush();

        const surface = document.getElementById('claudeChatSurface');
        expect(surface.textContent).not.toContain('not mine');
        // No conversation bubbles, but an empty thread carries the intro note.
        expect(surface.querySelectorAll('.claudeMsg--user, .claudeMsg--assistant').length).toBe(0);
        expect(surface.querySelector('#claudeChatIntro')).toBeTruthy();
    });
});

// Image attachments: a dedicated composer image button stages picked images as
// thumbnail tiles above the composer, attaches them to the next user turn as a
// per-message `images` field, and is session-scoped — base64 is stripped before
// chat history is persisted, so a reload replays those turns text-only.
describe('Claude sheet — image attachments (composer)', () => {
    const CHAT_KEY = 'todoapp_claudeChat';
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
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
                    ok: true, default: DEFAULT_REPO, repos: [{ repo: DEFAULT_REPO, srcPrefix: 'toDoList_main/src/' }],
                }) });
            }
            if (body.chat) chatBodies.push(body);
            return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ reply: 'assistant reply' }) });
        });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        setInjectTargets([DEFAULT_REPO]);
        realFetch = globalThis.fetch;
        globalThis.fetch = makeFetch();
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
        globalThis.fetch = realFetch;
    });

    function imageFile(name, type, bytes) {
        return new File([new Uint8Array(bytes || [1, 2, 3, 4])], name, { type });
    }

    function pickImages(files) {
        const input = document.getElementById('claudeImageInput');
        // jsdom's input.files is read-only, so define it directly; handleImagePick
        // treats the value as an array-like, so a plain array is enough.
        Object.defineProperty(input, 'files', { value: files, configurable: true });
        input.dispatchEvent(new Event('change'));
    }

    function lastChatMessages() {
        return chatBodies[chatBodies.length - 1].messages;
    }

    it('adds a dedicated image button + hidden multi-file input, after the attach button', async () => {
        mountClaudeSheet(document.body);
        await flush();
        const btn = document.getElementById('claudeComposerImage');
        const input = document.getElementById('claudeImageInput');
        const attach = document.getElementById('claudeComposerAttach');
        expect(btn).toBeTruthy();
        expect(btn.getAttribute('aria-label')).toBe('Attach images');
        expect(input).toBeTruthy();
        expect(input.type).toBe('file');
        expect(input.multiple).toBe(true);
        expect(input.getAttribute('accept')).toContain('image/png');
        expect(input.hidden).toBe(true);
        // It's a separate control from the 📎 repo-file picker, sitting after it.
        expect(btn.id).not.toBe(attach.id);
        expect(attach.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders the image glyph as a currentColor SVG so it tracks the void theme like the mic', async () => {
        mountClaudeSheet(document.body);
        await flush();
        const btn = document.getElementById('claudeComposerImage');
        // Emoji glyphs render in their own fixed colors and ignore the button's
        // `color`/hover styling; an inline SVG stroked with currentColor picks up
        // the void-theme text color at rest and the purple accent on hover, the
        // same treatment the mic button (MIC_SVG) uses.
        const svg = btn.querySelector('svg');
        expect(svg).toBeTruthy();
        expect(svg.getAttribute('stroke')).toBe('currentColor');
        expect(svg.getAttribute('fill')).toBe('none');
        // No leftover emoji glyph in the button's text.
        expect(btn.textContent).not.toContain('🖼');
    });

    it('stages a picked image as a thumbnail tile with a remove control', async () => {
        mountClaudeSheet(document.body);
        await flush();
        pickImages([imageFile('shot.png', 'image/png')]);
        await flush();
        const tiles = document.querySelectorAll('#claudeImageRail .claudeImageTile');
        expect(tiles.length).toBe(1);
        const thumb = tiles[0].querySelector('.claudeImageTileThumb');
        expect(thumb.src.startsWith('data:image/png;base64,')).toBe(true);
        expect(tiles[0].querySelector('.claudeImageTileRemove')).toBeTruthy();
    });

    it('removes a staged image from the rail', async () => {
        mountClaudeSheet(document.body);
        await flush();
        pickImages([imageFile('a.png', 'image/png'), imageFile('b.png', 'image/png')]);
        await flush();
        expect(document.querySelectorAll('#claudeImageRail .claudeImageTile').length).toBe(2);
        document.querySelector('#claudeImageRail .claudeImageTileRemove').click();
        expect(document.querySelectorAll('#claudeImageRail .claudeImageTile').length).toBe(1);
    });

    it('caps staged images at four per turn', async () => {
        mountClaudeSheet(document.body);
        await flush();
        pickImages([
            imageFile('1.png', 'image/png'), imageFile('2.png', 'image/png'),
            imageFile('3.png', 'image/png'), imageFile('4.png', 'image/png'),
            imageFile('5.png', 'image/png'),
        ]);
        await flush();
        expect(document.querySelectorAll('#claudeImageRail .claudeImageTile').length).toBe(4);
    });

    it('ignores files whose type is not an allowed image format', async () => {
        mountClaudeSheet(document.body);
        await flush();
        pickImages([imageFile('doc.pdf', 'application/pdf'), imageFile('vec.svg', 'image/svg+xml')]);
        await flush();
        expect(document.querySelectorAll('#claudeImageRail .claudeImageTile').length).toBe(0);
    });

    it('attaches pending images to the outgoing user turn and clears the rail on send', async () => {
        mountClaudeSheet(document.body);
        await flush();
        pickImages([imageFile('shot.png', 'image/png')]);
        await flush();
        const input = document.getElementById('claudeComposerInput');
        input.value = 'see this';
        document.getElementById('claudeComposerSend').click();
        await flush();

        const messages = lastChatMessages();
        const userTurn = messages[messages.length - 1];
        expect(userTurn.role).toBe('user');
        expect(userTurn.content).toBe('see this');
        expect(userTurn.images).toEqual([{ media_type: 'image/png', data: 'AQIDBA==' }]);
        // The rail clears and the sent bubble carries the thumbnail.
        expect(document.querySelectorAll('#claudeImageRail .claudeImageTile').length).toBe(0);
        const sent = document.querySelector('.claudeMsg--user .claudeMsgImageThumb');
        expect(sent).toBeTruthy();
        expect(sent.src.startsWith('data:image/png;base64,')).toBe(true);
    });

    it('lets an image-only turn (empty text) send', async () => {
        mountClaudeSheet(document.body);
        await flush();
        pickImages([imageFile('shot.png', 'image/png')]);
        await flush();
        // Empty composer, but a pending image makes the send go through.
        document.getElementById('claudeComposerSend').click();
        await flush();

        const messages = lastChatMessages();
        const userTurn = messages[messages.length - 1];
        expect(userTurn.role).toBe('user');
        expect(userTurn.content).toBe('');
        expect(userTurn.images.length).toBe(1);
    });

    it('does not send when there is neither text nor a pending image', async () => {
        mountClaudeSheet(document.body);
        await flush();
        document.getElementById('claudeComposerSend').click();
        await flush();
        expect(chatBodies.length).toBe(0);
    });

    it('strips image data from persisted history and replays prior image turns text-only', async () => {
        mountClaudeSheet(document.body);
        await flush();
        pickImages([imageFile('shot.png', 'image/png')]);
        await flush();
        const input = document.getElementById('claudeComposerInput');
        input.value = 'has an image';
        document.getElementById('claudeComposerSend').click();
        await flush();

        // localStorage must never carry base64: the user turn keeps its text but
        // no `images` field.
        const thread = JSON.parse(localStorage.getItem(CHAT_KEY) || '{}')[DEFAULT_REPO];
        const savedUser = thread.find((t) => t.role === 'user');
        expect(savedUser.content).toBe('has an image');
        expect('images' in savedUser).toBe(false);
        expect(localStorage.getItem(CHAT_KEY)).not.toContain('AQIDBA==');

        // A reload hydrates from that stripped history, so the replay is
        // text-only. Clear the body first so the remount is the only sheet.
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        await flush();
        const surface = document.getElementById('claudeChatSurface');
        expect(surface.textContent).toContain('has an image');
        expect(surface.querySelector('.claudeMsgImageThumb')).toBeNull();
    });

    it('hides the image button and rail on the Runs tab, then restores them on Chat', async () => {
        mountClaudeSheet(document.body);
        await flush();
        const btn = document.getElementById('claudeComposerImage');
        const rail = document.getElementById('claudeImageRail');
        expect(btn.hidden).toBe(false);
        expect(rail.hidden).toBe(false);
        document.getElementById('claudeTabRuns').click();
        expect(btn.hidden).toBe(true);
        expect(rail.hidden).toBe(true);
        document.getElementById('claudeTabChat').click();
        expect(btn.hidden).toBe(false);
        expect(rail.hidden).toBe(false);
    });

    // Dispatch a synthetic paste on the composer. jsdom's ClipboardEvent doesn't
    // carry a populated clipboardData, so we attach a minimal one whose items
    // mimic the browser DataTransferItem shape (kind/type/getAsFile).
    function pasteItems(input, items) {
        const event = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'clipboardData', {
            value: { items: items },
            configurable: true,
        });
        input.dispatchEvent(event);
        return event;
    }

    function imageItem(file) {
        return { kind: 'file', type: file.type, getAsFile: () => file };
    }

    it('stages a pasted image as a thumbnail and preventDefaults the paste', async () => {
        mountClaudeSheet(document.body);
        await flush();
        const input = document.getElementById('claudeComposerInput');
        const event = pasteItems(input, [imageItem(imageFile('shot.png', 'image/png'))]);
        await flush();
        const tiles = document.querySelectorAll('#claudeImageRail .claudeImageTile');
        expect(tiles.length).toBe(1);
        expect(tiles[0].querySelector('.claudeImageTileThumb').src.startsWith('data:image/png;base64,')).toBe(true);
        // Raw bitmap must not also fall through into the textarea.
        expect(event.defaultPrevented).toBe(true);
    });

    it('leaves a text-only paste untouched (no tile, not preventDefaulted)', async () => {
        mountClaudeSheet(document.body);
        await flush();
        const input = document.getElementById('claudeComposerInput');
        const event = pasteItems(input, [{ kind: 'string', type: 'text/plain', getAsFile: () => null }]);
        await flush();
        expect(document.querySelectorAll('#claudeImageRail .claudeImageTile').length).toBe(0);
        expect(event.defaultPrevented).toBe(false);
    });

    it('routes a pasted image through the shared caps (non-image items ignored)', async () => {
        mountClaudeSheet(document.body);
        await flush();
        const input = document.getElementById('claudeComposerInput');
        pasteItems(input, [
            { kind: 'string', type: 'text/plain', getAsFile: () => null },
            imageItem(imageFile('vec.svg', 'image/svg+xml')),
            imageItem(imageFile('shot.png', 'image/png')),
        ]);
        await flush();
        // The text item is skipped by the paste listener; the svg is an image but
        // outside IMAGE_ALLOWED_TYPES, so handleImagePick's shared filter drops it.
        // Only the png stages.
        expect(document.querySelectorAll('#claudeImageRail .claudeImageTile').length).toBe(1);
    });
});

// The Structure view's UI lens hands regions to the chat via two exports:
// insertReference (drop a backticked selector + label into the composer) and
// setChatWorkspaceRepo (reframe the conversation on a repo, the workspace-pill
// switch). getRunningAppRepo names the repo the lens can walk live.
describe('Claude sheet — Structure view seams (insertReference / setChatWorkspaceRepo)', () => {
    const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';
    const OTHER_REPO = 'rsterenchak/matchingGame-test';

    beforeEach(() => {
        document.body.innerHTML = '';
        localStorage.clear();
        localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example.com');
        localStorage.setItem('todoapp_injectSharedSecret', 'secret-token');
        initInjectConfig();
        setInjectTargets([DEFAULT_REPO, OTHER_REPO]);
    });

    afterEach(() => {
        localStorage.clear();
        mountClaudeSheet(document.createElement('div'));
    });

    it('getRunningAppRepo names the app\'s own repo', () => {
        expect(getRunningAppRepo()).toBe(DEFAULT_REPO);
    });

    it('insertReference appends a backticked selector + label and lands on the Chat tab', async () => {
        mountClaudeSheet(document.body);
        await flush();
        // Move to the Runs tab so we can prove insertReference switches back.
        document.getElementById('claudeTabRuns').click();
        expect(document.getElementById('claudeSheet').getAttribute('data-tab')).toBe('runs');

        insertReference('Task List', '#taskList');
        expect(document.getElementById('claudeSheet').getAttribute('data-tab')).toBe('chat');
        const input = document.getElementById('claudeComposerInput');
        expect(input.value).toBe('`#taskList` (Task List)');
    });

    it('insertReference preserves existing composer text with a separating space', async () => {
        mountClaudeSheet(document.body);
        await flush();
        const input = document.getElementById('claudeComposerInput');
        input.value = 'Move';
        insertReference('Sidebar', '.sidebar');
        expect(input.value).toBe('Move `.sidebar` (Sidebar)');
    });

    it('insertReference ignores a blank selector', async () => {
        mountClaudeSheet(document.body);
        await flush();
        const input = document.getElementById('claudeComposerInput');
        input.value = 'untouched';
        insertReference('Nothing', '   ');
        expect(input.value).toBe('untouched');
    });

    it('setChatWorkspaceRepo reframes the conversation on the selected repo', async () => {
        mountClaudeSheet(document.body);
        openClaudeSheet();
        await flush();
        expect(getActiveChatRepo()).toBe(DEFAULT_REPO);
        expect(getAttachRepos()).toContain(OTHER_REPO);

        setChatWorkspaceRepo(OTHER_REPO);
        expect(getActiveChatRepo()).toBe(OTHER_REPO);
    });

    it('setChatWorkspaceRepo ignores an unknown repo or the active one', async () => {
        mountClaudeSheet(document.body);
        openClaudeSheet();
        await flush();
        setChatWorkspaceRepo('not/allowed');
        expect(getActiveChatRepo()).toBe(DEFAULT_REPO);
        setChatWorkspaceRepo(DEFAULT_REPO);
        expect(getActiveChatRepo()).toBe(DEFAULT_REPO);
    });
});

// loadManifest must surface the newer `lens` and `types` manifest fields so the
// Structure tab's adaptive Types lens can engage for C# repos (which publish a
// manifest with `"lens":"types"` and a populated `types` array). Each test uses
// a unique repo name to dodge the module-level srcManifestCache.
describe('loadManifest lens/types passthrough', () => {
    let realFetch;
    beforeEach(() => { realFetch = globalThis.fetch; });
    afterEach(() => { globalThis.fetch = realFetch; });

    function mockManifest(repo, data) {
        globalThis.fetch = vi.fn((url) => {
            if (url === manifestUrlForRepo(repo)) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve(data) });
            }
            return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
        });
    }

    it('surfaces lens and types from a types-lens (C#) manifest', async () => {
        const repo = 'rsterenchak/csharp-types-repo';
        const types = [{ kind: 'class', name: 'Foo', members: [] }];
        mockManifest(repo, { files: ['Foo.cs'], lens: 'types', types: types });
        const result = await loadManifest(repo);
        expect(result.ok).toBe(true);
        expect(result.lens).toBe('types');
        expect(result.types).toEqual(types);
    });

    it('surfaces lens and tables from a sql-lens manifest', async () => {
        const repo = 'rsterenchak/sql-schema-repo';
        const tables = [{
            name: 'projects', kind: 'table', file: 'schema.sql', line: 1,
            columns: [{ name: 'id', kind: 'column', signature: 'id integer PRIMARY KEY', line: 2 }],
        }];
        mockManifest(repo, { files: ['schema.sql'], lens: 'sql', tables: tables });
        const result = await loadManifest(repo);
        expect(result.ok).toBe(true);
        expect(result.lens).toBe('sql');
        expect(result.tables).toEqual(tables);
    });

    it('leaves lens/types/tables undefined for an older lens-less (web) manifest', async () => {
        const repo = 'rsterenchak/web-no-lens-repo';
        mockManifest(repo, { files: ['index.js'], hasDom: true });
        const result = await loadManifest(repo);
        expect(result.ok).toBe(true);
        expect(result.lens).toBeUndefined();
        expect(result.types).toBeUndefined();
        expect(result.tables).toBeUndefined();
        // Existing consumers are unaffected.
        expect(result.files).toEqual(['index.js']);
        expect(result.hasDom).toBe(true);
    });

    it('ignores malformed lens/types/tables (wrong types) rather than passing them through', async () => {
        const repo = 'rsterenchak/malformed-lens-repo';
        mockManifest(repo, { files: ['a.js'], lens: 123, types: 'nope', tables: 'nope' });
        const result = await loadManifest(repo);
        expect(result.lens).toBeUndefined();
        expect(result.types).toBeUndefined();
        expect(result.tables).toBeUndefined();
    });
});
