import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(rel) {
    return readFileSync(resolve(srcDir, rel), 'utf8');
}

// Pins the mobile-row restructure: the inline workflow-status pill is dropped
// from the row at the ≤1023px breakpoint and the status is re-encoded as a
// rounded color tab on the row's left edge (amber for in-progress, accent
// purple for active), while the right-side controls are reordered (due then
// copy) purely via flex `order` so toDoRow.js keeps its DOM assembly. Source
// inspection only — media queries don't apply under jsdom, matching the
// existing mobileCopyTitleAndSlimDuePill / mobileDuePillDaysUntilBadge tests.
describe('mobile row restructure — left-edge status tab + reordered controls', () => {

    const css = read('style.css');

    // The whole feature lives under the first ≤1023px mobile block; grab the
    // slice from that media query onward so position assertions stay scoped to
    // mobile rather than accidentally matching a desktop rule.
    const mobileIdx = css.indexOf('@media (max-width: 1023px)');
    const mobileSlice = css.slice(mobileIdx);

    it('opens a ≤1023px mobile block before any of the new rules', () => {
        expect(mobileIdx).toBeGreaterThan(-1);
    });

    it('hides the inline status pill on mobile (desktop still renders it)', () => {
        expect(mobileSlice).toMatch(/\.todoStatusLabel\s*\{\s*display:\s*none/);
        // The desktop default rule that colors the pill must still exist
        // (the element stays in the DOM for the desktop layout).
        expect(css).toMatch(/\.todoStatusLabel\s*\{[\s\S]*?color:/);
    });

    it('draws the left-edge status tab as a ::before keyed to the status class', () => {
        expect(mobileSlice).toMatch(
            /#toDoChild\.todo-row--in_progress::before[\s\S]*?content:\s*""/);
        expect(mobileSlice).toMatch(
            /#toDoChild\.todo-row--active::before/);
        // Rounded sliver pinned to the left edge.
        const tabBlock = mobileSlice.slice(
            mobileSlice.indexOf('#toDoChild.todo-row--in_progress::before'));
        expect(tabBlock).toMatch(/position:\s*absolute/);
        expect(tabBlock).toMatch(/left:\s*3px/);
        expect(tabBlock).toMatch(/border-radius:\s*3px/);
    });

    it('colors in-progress amber and active accent-purple via theme tokens', () => {
        expect(mobileSlice).toMatch(
            /#toDoChild\.todo-row--in_progress::before\s*\{\s*background:\s*var\(--text-warning\)/);
        expect(mobileSlice).toMatch(
            /#toDoChild\.todo-row--active::before\s*\{\s*background:\s*var\(--accent\)/);
    });

    it('lets the tap-to-read accent edge take precedence over the resting tab', () => {
        expect(mobileSlice).toMatch(
            /#toDoChild\[data-mobile-read="true"\]::before\s*\{\s*display:\s*none/);
    });

    it('pads the title past the left-edge status tab so the first letter clears it', () => {
        // The tab spans left: 3px → 6px; without left padding the title (which
        // sits at the row's 4px content padding) butts against the colored
        // sliver. The fix pads both title elements — #toDoInput (visible title
        // 421–1023px) and .toDoTitleDisplay (the ≤420px read span) — so the
        // first character clears the tab. Must NOT pad the row itself (that
        // would inset the absolutely-positioned swipe panes).
        const paddingRule = mobileSlice.match(
            /#toDoChild:not\(\[data-original-blank="true"\]\)\s+#toDoInput\s*,\s*#toDoChild:not\(\[data-original-blank="true"\]\)\s+\.toDoTitleDisplay\s*\{\s*padding-left:\s*(\d+)px/);
        expect(paddingRule).not.toBeNull();
        // Enough to clear the tab's 6px right edge with breathing room.
        expect(Number(paddingRule[1])).toBeGreaterThanOrEqual(8);
    });

    it('orders the due control before the copy icon via flex order', () => {
        const dueOrder = mobileSlice.match(/#toDoChild\s+#duePill\s*\{\s*order:\s*(\d+)/);
        const copyOrder = mobileSlice.match(/#toDoChild\s+\.copyTitleBtn\s*\{\s*order:\s*(\d+)/);
        expect(dueOrder).not.toBeNull();
        expect(copyOrder).not.toBeNull();
        const due = Number(dueOrder[1]);
        const copy = Number(copyOrder[1]);
        // Due renders before copy, and both sit after the order-0 title.
        expect(due).toBeGreaterThan(0);
        expect(copy).toBeGreaterThan(due);
    });

    it('keeps the DOM assembly unchanged in toDoRow.js (reorder is CSS-only)', () => {
        const toDoRow = read('toDoRow.js');
        const copyAppend = toDoRow.indexOf('toDoChild.appendChild(copyBtn)');
        const pillAppend = toDoRow.indexOf('toDoChild.appendChild(duePill)');
        expect(copyAppend).toBeGreaterThan(-1);
        expect(pillAppend).toBeGreaterThan(-1);
        // Copy is still appended before due in source — only CSS order flips
        // the visual sequence, so toDoRow.js needs no change.
        expect(copyAppend).toBeLessThan(pillAppend);
    });
});
