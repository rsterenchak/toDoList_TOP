import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mountClaudeSheet } from '../src/claudeSheet.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the desktop (>=1024px) two-pane sub-header polish contract:
//   1. a ~16px vertical gap between the top header and the sub-header row,
//      applied so BOTH panes' sub-headers gain it and stay aligned;
//   2. the chat pane's sub-header row aligned with the task pane's view-tab
//      sub-band (the pane lift still equals the band height);
//   3. CHAT / RUNS rendered as a single segmented control — one rounded
//      container with the active half highlighted.
// The structural / wiring halves are verified live (jsdom does no layout but it
// does build DOM); the layout/visual halves are verified by source inspection,
// per CLAUDE.md guidance (main.js is too large to instantiate).
describe('two-pane sub-header polish (desktop)', () => {
    const css = read('style.css');
    const main = read('main.js');

    function consolidationBlock() {
        const start = css.indexOf('DESKTOP HEADER CONSOLIDATION');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('D2 — DESKTOP TWO-PANE CHAT', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    function d2Block() {
        const regionStart = css.indexOf('D2 — DESKTOP TWO-PANE CHAT');
        expect(regionStart).toBeGreaterThan(-1);
        const start = css.indexOf('@media (min-width: 1024px)', regionStart);
        expect(start).toBeGreaterThan(regionStart);
        const end = css.indexOf('D3 — DESKTOP CHAT PANE COLLAPSE', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    function ruleBody(block, selector) {
        const re = new RegExp(
            selector.replace(/[#.]/g, m => '\\' + m).replace(/\s+/g, '\\s+') +
                '\\s*\\{([^}]*)\\}'
        );
        const m = block.match(re);
        expect(m).not.toBeNull();
        return m[1];
    }

    // ── (a) + (d) Roomier gap that preserves alignment ──
    it('(a) the sub-header rows stay aligned — the pane lift equals the band height', () => {
        const subBand = ruleBody(consolidationBlock(), '#desktopViewSubBand');
        const minH = subBand.match(/min-height:\s*(\d+)px/);
        expect(minH).not.toBeNull();
        const bandHeight = parseInt(minH[1], 10);

        const pane = ruleBody(d2Block(), '#desktopChatPane');
        const lift = pane.match(/margin-top:\s*-(\d+)px/);
        expect(lift).not.toBeNull();
        // The chat pane is lifted into the band's row by exactly the band height,
        // so adding a gap above the band drops both rows together and keeps them
        // aligned (the gap is the band's own margin-top, which grows the track).
        expect(parseInt(lift[1], 10)).toBe(bandHeight);
    });

    it('(d) there is a >=12px gap between the top header and the sub-header row', () => {
        const subBand = ruleBody(consolidationBlock(), '#desktopViewSubBand');
        const gap = subBand.match(/margin-top:\s*(\d+)px/);
        expect(gap).not.toBeNull();
        expect(parseInt(gap[1], 10)).toBeGreaterThanOrEqual(12);
    });

    // ── (b) + (e) Segmented control structure + behavior (live DOM) ──
    describe('segmented CHAT / RUNS control', () => {
        beforeEach(() => {
            document.body.innerHTML = '';
            mountClaudeSheet(document.body);
        });

        it('(b) CHAT and RUNS share a single parent (the segmented container)', () => {
            const chatTab = document.getElementById('claudeTabChat');
            const runsTab = document.getElementById('claudeTabRuns');
            const group = chatTab.parentElement;
            expect(group).toBe(runsTab.parentElement);
            expect(group.classList.contains('claudeTabGroup')).toBe(true);
            // The group (and thus the tabs) still lives inside the tab row, so
            // the workspace-pill-shares-the-row contract is unaffected.
            expect(document.getElementById('claudeSheetTabs').contains(group)).toBe(true);
        });

        it('(e) clicking the inactive half switches the active state', () => {
            const chatTab = document.getElementById('claudeTabChat');
            const runsTab = document.getElementById('claudeTabRuns');
            expect(chatTab.getAttribute('aria-selected')).toBe('true');
            expect(runsTab.getAttribute('aria-selected')).toBe('false');
            runsTab.click();
            expect(runsTab.getAttribute('aria-selected')).toBe('true');
            expect(chatTab.getAttribute('aria-selected')).toBe('false');
            chatTab.click();
            expect(chatTab.getAttribute('aria-selected')).toBe('true');
            expect(runsTab.getAttribute('aria-selected')).toBe('false');
        });
    });

    // ── (c) Segmented control is a rounded, bordered container (desktop) ──
    it('(c) the segmented container is rounded and bordered at desktop widths', () => {
        const group = ruleBody(d2Block(), '#desktopChatPane .claudeTabGroup');
        expect(group).toMatch(/display:\s*inline-flex/);
        expect(group).toMatch(/border-radius:\s*\d+px/);
        expect(group).toMatch(/border:\s*1px\s+solid/);
        // The active half is filled with the accent purple.
        const active = d2Block().match(
            /#desktopChatPane\s+\.claudeTabGroup\s+\.claudeTab\[aria-selected="true"\]\s*\{([^}]*)\}/
        );
        expect(active).not.toBeNull();
        expect(active[1]).toMatch(/background:\s*#6C5DF5/i);
    });

    // ── (f) Collapse toggle behavior preserved ──
    it('(f) the collapse button still toggles the chat pane (wiring unchanged)', () => {
        expect(main).toMatch(/chatCollapseBtn\.addEventListener\(\s*['"]click['"][\s\S]*?applyChatPaneCollapsed\(true\)/);
        expect(main).toMatch(/document\.body\.classList\.toggle\(\s*['"]chatPaneCollapsed['"]/);
    });

    // ── (g) Mobile chat sheet is untouched ──
    it('(g) the segmented wrapper is layout-transparent at mobile widths', () => {
        // The base (non-media) rule makes the wrapper display:contents, so the
        // mobile slide-up sheet keeps CHAT / RUNS as the existing flex pills.
        const base = css.match(/\.claudeTabGroup\s*\{([^}]*)\}/);
        expect(base).not.toBeNull();
        expect(base[1]).toMatch(/display:\s*contents/);
        // The base tab still spreads to fill its half on mobile.
        const baseTab = css.match(/\.claudeTab\s*\{([^}]*)\}/);
        expect(baseTab).not.toBeNull();
        expect(baseTab[1]).toMatch(/flex:\s*1/);
        // The segmented restyle is desktop-gated.
        expect(d2Block()).toMatch(/@media\s*\(\s*min-width:\s*1024px\s*\)/);
    });
});
