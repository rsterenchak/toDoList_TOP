import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mountClaudeSheet } from '../src/claudeSheet.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the D2 contract: at desktop widths (>=1024px) the Claude chat is a
// persistent right-hand pane (#desktopChatPane), not the slide-up sheet. The
// main task pane and the chat pane sit side by side inside #mainSplit. At
// mobile widths (<1024px) the chat is the slide-up sheet exactly as before.
// The SAME content node (#claudeSheetBody) is relocated between the two
// containers rather than duplicated, so handlers and state survive the move.

// ── Behavior: the content node moves between containers across the breakpoint.
describe('D2 — desktop chat pane (content relocation)', () => {
    function setWidth(w) {
        Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
        window.dispatchEvent(new Event('resize'));
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        // The two-pane shell main.js builds: the pane must exist before the
        // sheet mounts so placeChatContent can find it.
        const pane = document.createElement('div');
        pane.id = 'desktopChatPane';
        document.body.appendChild(pane);
        mountClaudeSheet(document.body);
    });

    afterEach(() => {
        // Restore jsdom's default desktop viewport for unrelated suites.
        Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true, writable: true });
    });

    it('seats the chat content in the pane at desktop and the sheet at mobile', () => {
        setWidth(1280);
        expect(document.getElementById('claudeSheetBody').parentElement.id).toBe('desktopChatPane');
        setWidth(500);
        expect(document.getElementById('claudeSheetBody').parentElement.id).toBe('claudeSheet');
        setWidth(1280);
        expect(document.getElementById('claudeSheetBody').parentElement.id).toBe('desktopChatPane');
    });

    it('treats 1024px as desktop and 1023px as mobile (matches isMobile semantics)', () => {
        setWidth(1024);
        expect(document.getElementById('claudeSheetBody').parentElement.id).toBe('desktopChatPane');
        setWidth(1023);
        expect(document.getElementById('claudeSheetBody').parentElement.id).toBe('claudeSheet');
    });

    it('keeps the chat content as a single node — never duplicated across containers', () => {
        setWidth(1280);
        expect(document.querySelectorAll('#claudeSheetBody').length).toBe(1);
        setWidth(500);
        expect(document.querySelectorAll('#claudeSheetBody').length).toBe(1);
    });

    it('is idempotent — re-running placement in the same breakpoint does not move or duplicate', () => {
        setWidth(1280);
        const node = document.getElementById('claudeSheetBody');
        setWidth(1280);
        expect(document.getElementById('claudeSheetBody')).toBe(node);
        expect(document.querySelectorAll('#claudeSheetBody').length).toBe(1);
    });

    it('preserves event handlers across a container move (tab toggle still works)', () => {
        // Move to desktop, exercise the CHAT/RUNS toggle wired in buildSheet.
        setWidth(1280);
        document.getElementById('claudeTabRuns').click();
        expect(document.getElementById('claudeRunsView').hidden).toBe(false);
        expect(document.getElementById('claudeChatView').hidden).toBe(true);
        // Move to mobile — the same node carries the same handlers.
        setWidth(500);
        document.getElementById('claudeTabChat').click();
        expect(document.getElementById('claudeChatView').hidden).toBe(false);
        expect(document.getElementById('claudeRunsView').hidden).toBe(true);
    });

    it('seats content in the pane when the shell is mounted detached, then attached (real boot order)', () => {
        // Regression for the D2 empty-desktop-pane bug. Real boot (index.js)
        // builds the whole page tree — including #desktopChatPane — inside a
        // DETACHED `base` div, calls mountClaudeSheet on it, and only THEN
        // appends base to document.body. A document-level lookup at mount time
        // misses the still-detached pane, so chatPaneEl is null and the content
        // never moves out of the sheet — the desktop pane renders empty.
        document.body.innerHTML = '';
        Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true, writable: true });
        const base = document.createElement('div');
        const pane = document.createElement('div');
        pane.id = 'desktopChatPane';
        base.appendChild(pane);
        mountClaudeSheet(base);          // base is NOT in the document yet
        document.body.appendChild(base); // attached only now, like index.js:14
        expect(document.getElementById('claudeSheetBody').parentElement.id).toBe('desktopChatPane');
    });

    it('falls back to the sheet when no desktop pane is present', () => {
        // A mount without the pane (e.g. a bare shell) must leave the content in
        // the sheet rather than dropping it.
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        setWidth(1280);
        expect(document.getElementById('claudeSheetBody').parentElement.id).toBe('claudeSheet');
    });
});

// ── Source / CSS: the layout contract.
describe('D2 — desktop chat pane (layout source)', () => {
    const css = read('style.css');
    const main = read('main.js');
    const claude = read('claudeSheet.js');

    it('(a) #desktopChatPane is shown (display:flex) at >=1024px', () => {
        expect(css).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?#desktopChatPane\s*\{[^}]*display:\s*flex/
        );
    });

    it('(b) #claudeSheet is display:none at >=1024px (sheet retired on desktop)', () => {
        expect(css).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?#claudeSheet\s*\{\s*display:\s*none\s*;?\s*\}/
        );
    });

    it('(c) #desktopChatPane is display:none at mobile (base rule outside the desktop media query)', () => {
        // The top-level rule hides the pane; the desktop media query re-shows it.
        expect(css).toMatch(/#desktopChatPane\s*\{\s*display:\s*none\s*;?\s*\}/);
    });

    it('(d) the mobile slide-up sheet is unchanged (still an ~86% bottom sheet at <=1023px)', () => {
        expect(css).toMatch(/@media\s*\(\s*max-width:\s*1023px\s*\)/);
        expect(css).toMatch(/#claudeSheet\s*\{[^}]*height:\s*86%/);
    });

    it('#mainSplit is display:contents on mobile and a flex row at desktop', () => {
        expect(css).toMatch(/#mainSplit\s*\{\s*display:\s*contents\s*;?\s*\}/);
        expect(css).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?#mainSplit\s*\{[^}]*display:\s*flex/
        );
        expect(css).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?#mainSec\s*\{[^}]*flex:\s*1 1 60%/
        );
    });

    it('the launcher is hidden at desktop (the persistent pane is always open)', () => {
        expect(css).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?#claudeLauncher\s*\{\s*display:\s*none\s*;?\s*\}/
        );
    });

    it('main.js wraps the main pane and the chat pane in #mainSplit', () => {
        expect(main).toMatch(/mainSplit\.id\s*=\s*['"]mainSplit['"]/);
        expect(main).toMatch(/desktopChatPane\.id\s*=\s*['"]desktopChatPane['"]/);
        expect(main).toMatch(/mainSplit\.appendChild\(main\)/);
        expect(main).toMatch(/mainSplit\.appendChild\(desktopChatPane\)/);
        expect(main).toMatch(/base\.appendChild\(mainSplit\)/);
    });

    it('claudeSheet.js relocates the content node by breakpoint on mount and resize', () => {
        expect(claude).toMatch(/function\s+placeChatContent\s*\(/);
        expect(claude).toMatch(/getElementById\(\s*['"]desktopChatPane['"]\s*\)/);
        expect(claude).toMatch(/addEventListener\(\s*['"]resize['"]/);
        // The movable node is a single #claudeSheetBody wrapper, not duplicated.
        expect(claude).toMatch(/id\s*=\s*['"]claudeSheetBody['"]/);
    });
});
