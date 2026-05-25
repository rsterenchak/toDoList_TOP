import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile contract: at the ≤700px breakpoint the per-row
// `#checkToDo` checkbox is hidden so titles get the reclaimed horizontal
// room. Completion is owned by the swipe-right gesture which programmatically
// toggles `checkToDo.checked` and dispatches its `change` event, so the
// data path and the just-completed micro-interaction are unchanged. Source
// inspection only, mirroring the mobileCloseButtonHidden approach —
// jsdom isn't needed to verify a CSS contract.
describe('STACK mobile per-row check-off checkbox hidden', () => {
    const css = read('style.css');

    function allMobileMediaBlocks() {
        const blocks = [];
        let cursor = 0;
        while (true) {
            const media = css.indexOf('@media (max-width: 700px)', cursor);
            if (media === -1) break;
            let depth = 0;
            let end = css.length;
            for (let i = css.indexOf('{', media); i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) { end = i + 1; break; }
                }
            }
            blocks.push({ start: media, end, text: css.slice(media, end) });
            cursor = end;
        }
        expect(blocks.length).toBeGreaterThan(0);
        return blocks;
    }

    function extractMobileRule(haystack, selector) {
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const escaped = selector.replace(/[#.]/g, m => '\\' + m);
        const re = new RegExp(
            '(?:^|[\\s,{}])' + escaped + '\\s*(?=[,{])',
            'm'
        );
        const m = re.exec(stripped);
        if (!m) return null;
        const startIdx = stripped.indexOf('{', m.index);
        if (startIdx === -1) return null;
        const endIdx = stripped.indexOf('}', startIdx);
        if (endIdx === -1) return null;
        return stripped.slice(startIdx + 1, endIdx);
    }

    function findHidingBlock(selector) {
        const blocks = allMobileMediaBlocks();
        for (const block of blocks) {
            const body = extractMobileRule(block.text, selector);
            if (body && /display:\s*none/.test(body)) return { block, body };
        }
        return null;
    }

    it('#checkToDo is hidden at the ≤700px breakpoint', () => {
        const hit = findHidingBlock('#checkToDo');
        expect(hit).not.toBeNull();
    });

    it('the mobile hide rule comes AFTER the desktop #checkToDo declaration so source order wins', () => {
        // No !important is used; the cascade fix relies on the mobile
        // rule block sitting later in the file than the desktop
        // declaration so the override wins at equal (1-ID) specificity.
        const desktopIdx = css.indexOf('#checkToDo {');
        expect(desktopIdx).toBeGreaterThan(-1);
        const hit = findHidingBlock('#checkToDo');
        expect(hit).not.toBeNull();
        expect(hit.block.start).toBeGreaterThan(desktopIdx);
    });

    it('desktop #checkToDo declaration is untouched (still sized/styled at 18×18 with custom appearance)', () => {
        // Hiding on mobile must not regress the desktop checkbox — the
        // desktop rule keeps the 18×18 box, the custom appearance reset,
        // and the accent-on-checked styling. Spot-check width/height/appearance.
        const desktopIdx = css.indexOf('#checkToDo {');
        const desktopBody = css.slice(
            css.indexOf('{', desktopIdx) + 1,
            css.indexOf('}', desktopIdx)
        );
        expect(desktopBody).toMatch(/width:\s*18px/);
        expect(desktopBody).toMatch(/height:\s*18px/);
        expect(desktopBody).toMatch(/appearance:\s*none/);
    });

    it('swipe-right handler still routes through checkToDo.dispatchEvent so the change-listener completion path is unchanged', () => {
        // The hide rule is only safe because the swipe path keeps using
        // the existing checkbox change listener for persistence and the
        // just-completed micro-interaction. If swipe-right ever bypasses
        // dispatchEvent and writes the model directly, completion stops
        // animating and recurring-task advancement breaks on mobile.
        const toDoRow = read('toDoRow.js');
        const swipeOnRight = toDoRow.match(/onRight:\s*function\s*\(\)\s*\{([\s\S]*?)^\s{8}\}/m);
        expect(swipeOnRight).toBeTruthy();
        expect(swipeOnRight[1]).toMatch(/cb\.dispatchEvent\(new Event\(['"]change['"]\)\)/);
    });

    it('swipe-right handler keeps its cb.style.display === "none" guard so blank placeholder rows still no-op', () => {
        // Blank placeholder rows set checkToDo.style.display = "none"
        // inline (wireCheckbox in toDoRow.js). The swipe-right guard
        // reads `cb.style.display`, which is the inline style only —
        // hiding via the mobile @media rule does NOT set inline style,
        // so committed rows still complete on swipe while placeholders
        // continue to no-op. Pin the guard so future refactors don't
        // collapse it to a truthy check that would let placeholders fire.
        const toDoRow = read('toDoRow.js');
        const swipeOnRight = toDoRow.match(/onRight:\s*function\s*\(\)\s*\{([\s\S]*?)^\s{8}\}/m);
        expect(swipeOnRight).toBeTruthy();
        expect(swipeOnRight[1]).toMatch(/cb\.style\.display\s*===\s*['"]none['"]/);
    });
});
