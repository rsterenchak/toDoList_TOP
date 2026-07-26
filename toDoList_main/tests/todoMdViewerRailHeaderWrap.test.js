import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the fix for the TODO.md viewer header clipping in the desktop queue
// rail. Since the queue column landed at a fixed ~308px rail (minmax(260px,
// 308px)), the viewer card's `.todoMdViewerMeta` group — synced label, Run
// backlog, Redeploy, sync, overflow, and the expand chevron — no longer fits
// on one line beside the tabs. The nested meta row had no `flex-wrap`, so it
// overflowed as a single unit and clipped rather than wrapping. The fix, at
// the >=1024px breakpoint and scoped to the #mainList host, lets the group
// wrap and drops the `margin-left: auto` so wrapped rows start at the card's
// left edge. Source-inspection per CLAUDE.md (style.css is large; we assert
// the CSS contract rather than instantiating a layout engine).
describe('TODO.md viewer header wraps in the desktop queue rail', () => {
    const css = read('style.css');

    // True when `pos` falls inside a @media (min-width: 1024px) block.
    function inDesktopMediaBlock(pos) {
        const mediaIdx = css.lastIndexOf('@media (min-width: 1024px)', pos);
        if (mediaIdx === -1) return false;
        let depth = 0;
        let openSeen = false;
        for (let i = css.indexOf('{', mediaIdx); i < css.length; i++) {
            if (css[i] === '{') { depth++; openSeen = true; }
            else if (css[i] === '}') {
                depth--;
                if (openSeen && depth === 0) return pos <= i;
            }
        }
        return false;
    }

    function block(selectorRe) {
        const m = css.match(selectorRe);
        return m ? m[0] : null;
    }

    it('lets the meta group wrap at the rail width', () => {
        const re = /#mainList\s+\.todoMdViewerMeta\s*\{[^}]*\}/;
        const rule = block(re);
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/flex-wrap:\s*wrap/);
        expect(inDesktopMediaBlock(css.search(re))).toBe(true);
    });

    it('drops the auto margin so wrapped rows start at the left edge', () => {
        const re = /#mainList\s+\.todoMdViewerMeta\s*\{[^}]*\}/;
        const rule = block(re);
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/margin-left:\s*0/);
        expect(inDesktopMediaBlock(css.search(re))).toBe(true);
    });

    it('gives wrapped lines a row-gap so they are not flush', () => {
        const re = /#mainList\s+\.todoMdViewerMeta\s*\{[^}]*\}/;
        const rule = block(re);
        expect(rule).toBeTruthy();
        // Either an explicit row-gap or the inherited shorthand gap on the
        // base rule provides the vertical spacing between wrapped rows.
        expect(rule).toMatch(/row-gap:\s*8px|gap:\s*8px/);
        expect(inDesktopMediaBlock(css.search(re))).toBe(true);
    });
});
