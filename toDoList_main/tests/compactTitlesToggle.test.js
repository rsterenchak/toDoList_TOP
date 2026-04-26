import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the visual-truncation toggle. The toggle is a
// display-only preference (no data mutation), persists across reloads via
// localStorage, lives immediately to the LEFT of the existing Expand All
// control, and is keyed off `data-compact-titles="on"` on <html> so CSS can
// apply the single-line ellipsis treatment to #toDoInput.
describe('compact-titles toggle — visual truncation of long todo titles', () => {
    const main = read('main.js');
    const css = read('style.css');

    it('persists the on/off state under the todoapp_ prefix', () => {
        expect(main).toMatch(/COMPACT_TITLES_KEY\s*=\s*['"]todoapp_compactTitles['"]/);
        expect(main).toMatch(/localStorage\.getItem\(\s*COMPACT_TITLES_KEY\s*\)/);
        expect(main).toMatch(/localStorage\.setItem\(\s*COMPACT_TITLES_KEY\s*,/);
    });

    it('reflects the saved preference onto <html> via data-compact-titles', () => {
        expect(main).toMatch(/setAttribute\(\s*['"]data-compact-titles['"]\s*,\s*on \? ['"]on['"] : ['"]off['"]\s*\)/);
        // Applied at module load (before component() builds the DOM), matching
        // the same pattern as applyTheme — guarantees no flash of unstyled
        // titles on reload when the preference is on.
        expect(main).toMatch(/applyCompactTitles\(\s*isCompactTitlesOn\(\)\s*\)/);
    });

    it('renders the compact-titles button with the documented tooltip and accessible label', () => {
        expect(main).toMatch(/compactTitlesBtn\.id\s*=\s*['"]compactTitlesToggle['"]/);
        expect(main).toMatch(/compactTitlesBtn\.title\s*=\s*['"]Compact titles['"]/);
        expect(main).toMatch(/compactTitlesBtn\.setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]Compact titles['"]\s*\)/);
    });

    it('uses a stacked-lines pixel-art SVG glyph (three bars, each shorter than the last)', () => {
        const m = main.match(/COMPACT_TITLES_SVG\s*=\s*([\s\S]*?);\s*\n/);
        expect(m).toBeTruthy();
        const svg = m[1];
        // Three rect rows at increasing y, with widths strictly decreasing so
        // the glyph reads as stacked horizontal lines that taper.
        const rectRe = /<rect[^>]*y="(\d+)"[^>]*width="(\d+)"/g;
        const widths = [];
        const ys = [];
        let r;
        while ((r = rectRe.exec(svg)) !== null) {
            ys.push(Number(r[1]));
            widths.push(Number(r[2]));
        }
        expect(widths.length).toBe(3);
        expect(widths[0]).toBeGreaterThan(widths[1]);
        expect(widths[1]).toBeGreaterThan(widths[2]);
        expect(ys[0]).toBeLessThan(ys[1]);
        expect(ys[1]).toBeLessThan(ys[2]);
    });

    it('mounts the button into bulkDescActions BEFORE the Expand All control so it sits to its left', () => {
        const compactAppend = main.indexOf('bulkDescActions.appendChild(compactTitlesBtn)');
        const expandAppend = main.indexOf('bulkDescActions.appendChild(bulkDescToggleBtn)');
        expect(compactAppend).toBeGreaterThan(-1);
        expect(expandAppend).toBeGreaterThan(-1);
        expect(compactAppend).toBeLessThan(expandAppend);
    });

    it('toggles aria-pressed on click and persists the new value', () => {
        const clickIdx = main.indexOf("compactTitlesBtn.addEventListener('click'");
        expect(clickIdx).toBeGreaterThan(-1);
        const handler = main.slice(clickIdx, clickIdx + 800);
        expect(handler).toMatch(/setCompactTitlesOn\(\s*next\s*\)/);
        expect(handler).toMatch(/applyCompactTitles\(\s*next\s*\)/);
        expect(handler).toMatch(/syncCompactTitlesBtn\(\)/);
    });

    it('mirrors each todo title onto the input.title attribute so hover tooltips reveal clipped text', () => {
        // Title is set on creation, again after Enter commit, after keyup save,
        // and on blur snap-back so it always matches the visible value.
        expect(main).toMatch(/toDoInput\.title\s*=\s*item\.tit\s*\|\|\s*""/);
        const enterHandler = main.slice(main.indexOf('toDoInput keydown — Enter to commit title'));
        expect(enterHandler.slice(0, 1500)).toMatch(/toDoInput\.title\s*=\s*val/);
        const keyupHandler = main.slice(main.indexOf('toDoInput keyup — save on every keystroke'));
        expect(keyupHandler.slice(0, 800)).toMatch(/toDoInput\.title\s*=\s*val/);
    });

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

    it('styles the button as a small icon-frame in the off state and a subtle accent tint in the on state', () => {
        const baseRule = extractTopLevelRule('.compactTitlesBtn');
        expect(baseRule).toMatch(/background:\s*transparent\s*;/);
        expect(baseRule).toMatch(/border:\s*0?\.?5?p?x? ?[a-z]*\s*var\(--border-bright\)/);
        // Active state uses the accent at lower opacity (--accent-dim) so the
        // button reads as "on" without breaking the segmented-group look it
        // shares with the adjacent Expand All control.
        const pressedRule = extractTopLevelRule('.compactTitlesBtn[aria-pressed="true"]');
        expect(pressedRule).toMatch(/background:\s*var\(--accent-dim\)\s*;/);
    });

    it('truncates #toDoInput to a single line with ellipsis only when compact-titles is on', () => {
        const truncRule = extractTopLevelRule('html[data-compact-titles="on"] #toDoInput');
        expect(truncRule).toMatch(/text-overflow:\s*ellipsis\s*;/);
        expect(truncRule).toMatch(/white-space:\s*nowrap\s*;/);
        expect(truncRule).toMatch(/overflow:\s*hidden\s*;/);
    });

    // The 60ch cap is what makes the ellipsis actually engage on wide rows —
    // without it, text-overflow only kicks in once the title hits the row's
    // far-right edge, which on desktop almost never happens.
    it('caps the truncated title at 60ch so the ellipsis engages well before the row edge', () => {
        const truncRule = extractTopLevelRule('html[data-compact-titles="on"] #toDoInput');
        expect(truncRule).toMatch(/max-width:\s*60ch\s*;/);
    });

    // While the input is focused, the truncation lifts so the user can see
    // and edit the full title. Blurring restores the cap automatically.
    it('drops the cap and ellipsis on :focus so the editing input shows the full title', () => {
        const focusRule = extractTopLevelRule('html[data-compact-titles="on"] #toDoInput:focus');
        expect(focusRule).toMatch(/max-width:\s*none\s*;/);
        expect(focusRule).toMatch(/text-overflow:\s*clip\s*;/);
    });

    // Once the input is capped, the leftover flex space lands at the row's
    // far end by default. `margin-left: auto` on the date pill absorbs that
    // gap so the meta column (date / drag / ×) stays pinned to the right edge.
    it('keeps the meta column right-aligned by giving #duePill margin-left: auto in compact mode', () => {
        const metaRule = extractTopLevelRule('html[data-compact-titles="on"] #toDoChild #duePill');
        expect(metaRule).toMatch(/margin-left:\s*auto\s*;/);
    });

    // The Compact Titles + Expand All buttons render as a single segmented
    // toolbar group: zero gap between them, the first child gets the left
    // side of the outer 6px radius, the last child gets the right side, and
    // the second child uses a -0.5px left margin so the shared border seam
    // doesn't double up.
    it('renders the two header buttons as a segmented group with shared borders and no gap', () => {
        const groupRule = extractTopLevelRule('#bulkDescActions');
        expect(groupRule).toMatch(/gap:\s*0\s*;/);

        const firstRule = extractTopLevelRule('#bulkDescActions > button:first-child');
        expect(firstRule).toMatch(/border-top-left-radius:\s*var\(--radius-md\)\s*;/);
        expect(firstRule).toMatch(/border-bottom-left-radius:\s*var\(--radius-md\)\s*;/);

        const lastRule = extractTopLevelRule('#bulkDescActions > button:last-child');
        expect(lastRule).toMatch(/border-top-right-radius:\s*var\(--radius-md\)\s*;/);
        expect(lastRule).toMatch(/border-bottom-right-radius:\s*var\(--radius-md\)\s*;/);

        const seamRule = extractTopLevelRule('#bulkDescActions > button + button');
        expect(seamRule).toMatch(/margin-left:\s*-0?\.5px\s*;/);
    });
});
