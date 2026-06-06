import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the reworked action row in the mobile TODO.md viewer sheet. On the
// <=1023px breakpoint the sync caption, run-state control, and Sync button
// used to crowd onto one line beside the tabs. The rework stacks the header
// into a column: tabs, then the "synced" caption on its own line, then the
// run-state control and Sync split 50/50 on a full-width touch-sized row,
// with Sync promoted to the primary purple action. Desktop is untouched
// (every rule is scoped to #todoMdViewerMobileSheet inside the mobile
// @media). Source-inspection per CLAUDE.md (style.css is large; we assert
// the CSS contract rather than instantiating a layout engine).
describe('Mobile TODO.md viewer sheet action row', () => {
    const css = read('style.css');

    // True when `pos` falls inside a @media (max-width: 1023px) block.
    function inMobileMediaBlock(pos) {
        const mediaIdx = css.lastIndexOf('@media (max-width: 1023px)', pos);
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

    it('gives the tabs their own full-width row via flex-wrap (no header restack)', () => {
        // Stacking is achieved by making the tabs span the full width so
        // the header's existing flex-wrap drops the meta row beneath them —
        // deliberately NOT a flex-direction:column on the header, which a
        // prior bug fix removed for the inline card (todoMdViewer.test.js).
        const re = /#todoMdViewerMobileSheet\s+\.todoMdViewerTabs\s*\{[^}]*\}/;
        const rule = block(re);
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/flex:\s*0\s+0\s+100%|width:\s*100%/);
        expect(inMobileMediaBlock(css.search(re))).toBe(true);
    });

    it('drops the synced caption onto its own full-width line below the tabs', () => {
        const re = /#todoMdViewerMobileSheet\s+\.todoMdViewerSynced\s*\{[^}]*\}/;
        const rule = block(re);
        expect(rule).toBeTruthy();
        // Forced onto its own line: full-width flex basis (100%).
        expect(rule).toMatch(/flex:\s*0\s+0\s+100%|flex-basis:\s*100%|width:\s*100%/);
        expect(inMobileMediaBlock(css.search(re))).toBe(true);
    });

    it('lets the meta container span full width (resets the desktop margin-left:auto)', () => {
        const re = /#todoMdViewerMobileSheet\s+\.todoMdViewerMeta\s*\{[^}]*\}/;
        const rule = block(re);
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/margin-left:\s*0/);
        expect(rule).toMatch(/width:\s*100%/);
        expect(rule).toMatch(/flex-wrap:\s*wrap/);
        expect(inMobileMediaBlock(css.search(re))).toBe(true);
    });

    it('splits the run-state control and Sync 50/50 on a touch-sized row (>=44px tall)', () => {
        // One grouped rule covers the run button, the in-flight run pill
        // (which swaps in for the button), and the Sync button so the row
        // stays 50/50 whether idle or running.
        const re = /#todoMdViewerMobileSheet\s+\.todoMdViewerRunBtn[\s\S]*?\.todoMdViewerSyncBtn\s*\{[^}]*\}/;
        const rule = block(re);
        expect(rule).toBeTruthy();
        // The grouped selector must include the run pill so the in-flight
        // state keeps its half of the row.
        expect(rule).toMatch(/\.todoMdViewerRunPill/);
        expect(rule).toMatch(/flex:\s*1\s+1\s+0/);
        expect(rule).toMatch(/min-height:\s*44px/);
        expect(inMobileMediaBlock(css.search(re))).toBe(true);
    });

    it('promotes Sync to the primary purple action in the sheet', () => {
        // Target the Sync-specific rule that carries the purple fill (a
        // separate grouped rule also matches the bare selector for the
        // 50/50 sizing, so scope by the background declaration).
        const re = /#todoMdViewerMobileSheet\s+\.todoMdViewerSyncBtn\s*\{[^}]*background:\s*#6C5DF5[^}]*\}/i;
        const rule = block(re);
        expect(rule).toBeTruthy();
        expect(inMobileMediaBlock(css.search(re))).toBe(true);
    });
});
