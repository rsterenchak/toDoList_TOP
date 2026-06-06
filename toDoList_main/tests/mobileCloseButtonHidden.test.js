import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile contract: at the ≤1023px breakpoint the per-row
// `×` delete button is hidden so the row's right cluster reads as just
// the due pill + expand caret. Destructive removal is owned by the
// swipe-left gesture (with the 5s UNDO toast) which is the expected
// mobile pattern. Source-inspection only, mirroring the
// mobileNavUtilityButtonsHidden / stackMobileLayoutCollapse approach —
// jsdom isn't needed to verify a CSS contract.
describe('STACK mobile per-row delete button hidden', () => {
    const css = read('style.css');

    function allMobileMediaBlocks() {
        const blocks = [];
        let cursor = 0;
        while (true) {
            const media = css.indexOf('@media (max-width: 1023px)', cursor);
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

    it('#closeButtonToDo is hidden at the ≤1023px breakpoint', () => {
        const hit = findHidingBlock('#closeButtonToDo');
        expect(hit).not.toBeNull();
    });

    it('the mobile hide rule comes AFTER the desktop #closeButtonToDo declaration so source order wins', () => {
        // No !important is used; the cascade fix relies on the mobile
        // rule block sitting later in the file than the desktop
        // declaration so the override wins at equal (1-ID) specificity.
        const desktopIdx = css.indexOf('#closeButtonToDo {');
        expect(desktopIdx).toBeGreaterThan(-1);
        const hit = findHidingBlock('#closeButtonToDo');
        expect(hit).not.toBeNull();
        expect(hit.block.start).toBeGreaterThan(desktopIdx);
    });

    it('desktop #closeButtonToDo declaration is untouched (still sized/styled at 24×24)', () => {
        // Hiding on mobile must not regress the desktop button — the
        // desktop rule keeps the 24×24 hit target, hover styles, and
        // ::after × glyph. Spot-check the width/height and ::after.
        const desktopIdx = css.indexOf('#closeButtonToDo {');
        const desktopBody = css.slice(
            css.indexOf('{', desktopIdx) + 1,
            css.indexOf('}', desktopIdx)
        );
        expect(desktopBody).toMatch(/width:\s*24px/);
        expect(desktopBody).toMatch(/height:\s*24px/);
        expect(css).toMatch(/#closeButtonToDo::after\s*\{[^}]*content:\s*['"]×['"]/);
    });

    it('swipe-left handler still routes through listLogic.removeToDoByItem, not closeButtonToDo.click()', () => {
        // The hide rule is only safe because the swipe path goes
        // directly to the data model. If swipe-left ever falls back to
        // clicking the (now-hidden) button, deletion silently breaks on
        // mobile.
        const toDoRow = read('toDoRow.js');
        const swipeOnLeft = toDoRow.match(/onLeft:\s*function\s*\(\)\s*\{([\s\S]*?)^\s{8}\}/m);
        expect(swipeOnLeft).toBeTruthy();
        expect(swipeOnLeft[1]).toMatch(/listLogic\.removeToDoByItem/);
    });
});
