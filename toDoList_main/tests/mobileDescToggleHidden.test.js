import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile contract: at the ≤700px breakpoint the per-row
// `▾` description-toggle chevron is hidden so titles reclaim the
// horizontal space. Tapping the row itself already opens the description
// on touch (wireToDoRowClick), so the chevron is redundant on mobile.
// Source-inspection only, mirroring mobileCheckboxHidden / mobileCloseButtonHidden.
describe('STACK mobile per-row description toggle chevron hidden', () => {
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

    function extractAllMobileRules(haystack, selector) {
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const escaped = selector.replace(/[#.]/g, m => '\\' + m);
        const re = new RegExp(
            '(?:^|[\\s,{}])' + escaped + '\\s*(?=[,{])',
            'mg'
        );
        const bodies = [];
        let m;
        while ((m = re.exec(stripped)) !== null) {
            const startIdx = stripped.indexOf('{', m.index);
            if (startIdx === -1) continue;
            const endIdx = stripped.indexOf('}', startIdx);
            if (endIdx === -1) continue;
            bodies.push(stripped.slice(startIdx + 1, endIdx));
        }
        return bodies;
    }

    function findHidingBlock(selector) {
        const blocks = allMobileMediaBlocks();
        for (const block of blocks) {
            const bodies = extractAllMobileRules(block.text, selector);
            for (const body of bodies) {
                if (/display:\s*none/.test(body)) return { block, body };
            }
        }
        return null;
    }

    it('#descToggle is hidden at the ≤700px breakpoint', () => {
        const hit = findHidingBlock('#descToggle');
        expect(hit).not.toBeNull();
    });

    it('the mobile hide rule uses !important to defeat the inline style.display = "flex" writes in toDoRow.js', () => {
        // toDoRow.js sets `descToggle.style.display = "flex"` on row
        // creation (when the row has a title) and on first-commit reveal.
        // Inline styles outrank stylesheet rules at any specificity, so
        // the mobile override has to carry `!important` — otherwise the
        // chevron paints anyway on every committed row.
        const hit = findHidingBlock('#descToggle');
        expect(hit).not.toBeNull();
        expect(hit.body).toMatch(/display:\s*none\s*!important/);
    });

    it('desktop #descToggle declaration is untouched (still sized/styled at 24×24 with ::after caret)', () => {
        // Hiding on mobile must not regress the desktop chevron — the
        // desktop rule keeps the 24×24 hit area, hover treatment, and
        // ::after `▾` glyph. Spot-check width/height and the ::after
        // content declaration.
        const desktopIdx = css.indexOf('#descToggle {');
        expect(desktopIdx).toBeGreaterThan(-1);
        const desktopBody = css.slice(
            css.indexOf('{', desktopIdx) + 1,
            css.indexOf('}', desktopIdx)
        );
        expect(desktopBody).toMatch(/width:\s*24px/);
        expect(desktopBody).toMatch(/height:\s*24px/);
        expect(css).toMatch(/#descToggle::after\s*\{[^}]*content:\s*['"]▾['"]/);
    });

    it('row-click handler still routes through descToggle.click() so tapping a row opens the description on mobile', () => {
        // Hiding the chevron only works because the row itself is still
        // the touch target for opening the description. If wireToDoRowClick
        // ever stops dispatching descToggle.click() on first tap, mobile
        // users lose the only path into the description panel.
        const toDoRow = read('toDoRow.js');
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = toDoRow.slice(fnIdx, fnIdx + 4000);
        expect(fn).toMatch(/isMobile/);
        expect(fn).toMatch(/descToggle\.click\(\)/);
    });

    it('placeholder-detection guard in main.js still reads inline style.display so the !important rule does not break it', () => {
        // main.js skips blank placeholder rows during bulk descToggle
        // dispatch by reading `descToggle.style.display === 'none'` —
        // an inline-style check, not computed style. The mobile @media
        // rule never sets inline style, so this guard keeps working
        // even when the CSS-hidden chevron is in fact display:none on
        // mobile (its inline style is still "flex" for committed rows).
        const main = read('main.js');
        expect(main).toMatch(/descToggle\.style\.display\s*===\s*['"]none['"]/);
    });
});
