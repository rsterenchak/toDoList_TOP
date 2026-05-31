import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    mountClaudeSheet,
    openClaudeSheet,
    closeClaudeSheet,
    isClaudeSheetOpen,
} from '../src/claudeSheet.js';

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

    it('the Chat composer is an inert placeholder (disabled input + send)', () => {
        const input = document.getElementById('claudeComposerInput');
        const send = document.getElementById('claudeComposerSend');
        expect(input.disabled).toBe(true);
        expect(send.disabled).toBe(true);
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
