import { beforeEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
    isChatPaneCollapsed,
    setChatPaneCollapsed,
    CHAT_PANE_COLLAPSED_KEY,
} from '../src/prefs.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the D3 contract: at desktop widths (>=1024px) the persistent chat pane
// (D2) can be collapsed so the task pane fills the viewport, with the state
// persisted in localStorage (todoapp_chatPaneCollapsed, default expanded). A
// collapse `›` button sits in the pane; a fixed `‹` expand tab returns it. At
// mobile widths the preference has no visual effect — the slide-up sheet is
// untouched. The button + body-class wiring lives in main.js, which is too
// large to instantiate in jsdom (per CLAUDE.md), so that half is verified by
// source inspection; the persistence half runs against the real prefs module.

// ── Persistence: the collapse preference round-trips through localStorage.
describe('D3 — chat pane collapse preference (prefs)', () => {
    beforeEach(() => {
        try { localStorage.clear(); } catch (e) { /* ignore */ }
    });

    it('defaults to expanded (false) when nothing is stored', () => {
        expect(isChatPaneCollapsed()).toBe(false);
    });

    it('uses the todoapp_-prefixed key', () => {
        expect(CHAT_PANE_COLLAPSED_KEY).toBe('todoapp_chatPaneCollapsed');
    });

    it('round-trips true and false through localStorage', () => {
        setChatPaneCollapsed(true);
        expect(localStorage.getItem(CHAT_PANE_COLLAPSED_KEY)).toBe('true');
        expect(isChatPaneCollapsed()).toBe(true);
        setChatPaneCollapsed(false);
        expect(localStorage.getItem(CHAT_PANE_COLLAPSED_KEY)).toBe('false');
        expect(isChatPaneCollapsed()).toBe(false);
    });

    it('reads any non-"true" stored value as expanded (stale/hand-edited safe)', () => {
        localStorage.setItem(CHAT_PANE_COLLAPSED_KEY, 'garbage');
        expect(isChatPaneCollapsed()).toBe(false);
    });
});

// ── CSS: the collapsed-state layout contract.
describe('D3 — chat pane collapse (layout source)', () => {
    const css = read('style.css');

    // Slice the dedicated D3 block so assertions can't accidentally read
    // unrelated rules elsewhere in the sheet.
    function d3Block() {
        const start = css.indexOf('D3 — DESKTOP CHAT PANE COLLAPSE');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('PHONE ≤ 420px', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    it('(a) both buttons are display:none by default (outside the desktop media query)', () => {
        expect(d3Block()).toMatch(
            /#chatCollapseButton,\s*#chatExpandButton\s*\{\s*display:\s*none\s*;?\s*\}/
        );
    });

    it('(b) the collapse button is shown (inline-flex) at >=1024px', () => {
        expect(d3Block()).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?#chatCollapseButton\s*\{[^}]*display:\s*inline-flex/
        );
    });

    it('(c) the collapsed class hides the pane at desktop', () => {
        expect(d3Block()).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?body\.chatPaneCollapsed\s+#desktopChatPane\s*\{\s*display:\s*none\s*;?\s*\}/
        );
    });

    it('(d) the task pane reclaims full width when collapsed', () => {
        expect(d3Block()).toMatch(
            /body\.chatPaneCollapsed\s+#mainSec\s*\{[^}]*flex:\s*1 1 100%/
        );
    });

    it('(e) the expand tab is surfaced only while collapsed, inside the desktop media query', () => {
        expect(d3Block()).toMatch(
            /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{[\s\S]*?body\.chatPaneCollapsed\s+#chatExpandButton\s*\{[^}]*display:\s*inline-flex/
        );
    });

    it('(f) the collapsed-state rules are desktop-scoped — the mobile sheet is never gated by the class', () => {
        // The collapsed-pane and expand-tab rules must only exist inside the
        // 1024px media query, so applying the class at mobile does nothing.
        const block = d3Block();
        const mediaIdx = block.indexOf('@media');
        expect(mediaIdx).toBeGreaterThan(-1);
        const beforeMedia = block.slice(0, mediaIdx);
        // No collapsed-state layout RULE (selector usage) appears before the
        // media query opens — only the prose doc comment may name the class.
        expect(beforeMedia).not.toMatch(/body\.chatPaneCollapsed\s*[#.{]/);
        // And the class never targets the slide-up sheet at all.
        expect(block).not.toMatch(/body\.chatPaneCollapsed\s+#claudeSheet\b/);
    });
});

// ── main.js: the controls and their wiring.
describe('D3 — chat pane collapse (main.js wiring)', () => {
    const main = read('main.js');

    it('builds a collapse button with the documented id and aria-label', () => {
        expect(main).toMatch(/chatCollapseBtn\.id\s*=\s*['"]chatCollapseButton['"]/);
        expect(main).toMatch(/chatCollapseBtn\.setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]Collapse chat pane['"]\s*\)/);
    });

    it('builds an expand button with the documented id and aria-label', () => {
        expect(main).toMatch(/chatExpandBtn\.id\s*=\s*['"]chatExpandButton['"]/);
        expect(main).toMatch(/chatExpandBtn\.setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]Expand chat pane['"]\s*\)/);
    });

    it('seats the collapse button inside the chat pane and the expand button in the shell', () => {
        expect(main).toMatch(/desktopChatPane\.appendChild\(chatCollapseBtn\)/);
        expect(main).toMatch(/base\.appendChild\(chatExpandBtn\)/);
    });

    it('toggles the body class and persists on click', () => {
        // A single helper flips the class and persists, wired to both buttons.
        expect(main).toMatch(/document\.body\.classList\.toggle\(\s*['"]chatPaneCollapsed['"]\s*,\s*collapsed\s*\)/);
        expect(main).toMatch(/setChatPaneCollapsed\(collapsed\)/);
        expect(main).toMatch(/chatCollapseBtn\.addEventListener\(\s*['"]click['"][\s\S]*?applyChatPaneCollapsed\(true\)/);
        expect(main).toMatch(/chatExpandBtn\.addEventListener\(\s*['"]click['"][\s\S]*?applyChatPaneCollapsed\(false\)/);
    });

    it('seeds the body class from the persisted pref on mount (no flash on reload)', () => {
        expect(main).toMatch(/document\.body\.classList\.toggle\(\s*['"]chatPaneCollapsed['"]\s*,\s*isChatPaneCollapsed\(\)\s*\)/);
    });
});
