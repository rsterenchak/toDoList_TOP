import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: after the mobile canvas was repainted to --bg-elevated, the
// collapsed in-list TODO.md launcher (#mainList > #todoMdViewerCard, floored to
// var(--item-h) with its body hidden — so its header IS the whole card) painted
// `background: var(--bg-elevated)` from .todoMdViewerHeader, the exact same fill
// as the canvas behind it. Only two ~3px slivers of --bg-surface and a 1px
// --border-dim edge showed, so against the todo rows it read as a flat dark band
// rather than a card. Fix: inside the @media (max-width: 1023px) block, clear the
// launcher header's background so the card paints one contiguous --bg-surface,
// and raise the card's border to --border-mid so its edge is legible against the
// elevated canvas. Scoped to #mainList > #todoMdViewerCard only — the bottom
// sheet, the desktop pane-hosted card, and the desktop rail strip are untouched.
// Source-inspection per CLAUDE.md (style.css is large; we assert the CSS
// contract rather than instantiating a layout engine).
describe('Mobile TODO.md launcher — reads as a card, not a flat band', () => {
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

    function findRule(selectorRe) {
        const m = css.match(selectorRe);
        if (!m) return null;
        return { rule: m[0], pos: m.index };
    }

    const LAUNCHER_HEADER_RE =
        /#mainList\s*>\s*#todoMdViewerCard\s+\.todoMdViewerHeader\s*\{[^}]*\}/;
    const LAUNCHER_CARD_RE = /#mainList\s*>\s*#todoMdViewerCard\s*\{[^}]*\}/;

    it('clears the elevated fill on the collapsed launcher header', () => {
        const hit = findRule(LAUNCHER_HEADER_RE);
        expect(hit).toBeTruthy();
        // The header lets the card's own --bg-surface through.
        expect(hit.rule).toMatch(/background:\s*transparent/);
        expect(hit.rule).not.toMatch(/background:\s*var\(--bg-elevated\)/);
        // Mobile-only; the desktop in-list card keeps its elevated header.
        expect(inMobileMediaBlock(hit.pos)).toBe(true);
    });

    it('raises the launcher card border to --border-mid on mobile', () => {
        const hit = findRule(LAUNCHER_CARD_RE);
        expect(hit).toBeTruthy();
        expect(hit.rule).toMatch(/border-color:\s*var\(--border-mid\)/);
        expect(inMobileMediaBlock(hit.pos)).toBe(true);
    });

    it('keeps the card surface as the launcher fill', () => {
        // With the header transparent, the card's base background is what
        // actually paints the launcher — it must stay --bg-surface.
        const hit = findRule(/(^|\n)\.todoMdViewerCard\s*\{[^}]*\}/);
        expect(hit).toBeTruthy();
        expect(hit.rule).toMatch(/background:\s*var\(--bg-surface\)/);
        expect(hit.rule).toMatch(/border:\s*1px solid var\(--border-dim\)/);
        expect(inMobileMediaBlock(hit.pos)).toBe(false);
    });

    it('leaves the base header rule on --bg-elevated for desktop', () => {
        const hit = findRule(/(^|\n)\.todoMdViewerHeader\s*\{[^}]*\}/);
        expect(hit).toBeTruthy();
        expect(hit.rule).toMatch(/background:\s*var\(--bg-elevated\)/);
        // And it keeps the divider the expanded in-list card relies on.
        expect(hit.rule).toMatch(/border-bottom:\s*1px solid var\(--border-dim\)/);
        expect(inMobileMediaBlock(hit.pos)).toBe(false);
    });

    it('does not touch the other three viewer hosts', () => {
        // Bottom sheet: still borderless and margin-free.
        const sheet = findRule(/#todoMdViewerMobileSheet\s+\.todoMdViewerCard\s*\{[^}]*\}/);
        expect(sheet).toBeTruthy();
        expect(sheet.rule).toMatch(/border:\s*none/);
        expect(sheet.rule).not.toMatch(/border-color:\s*var\(--border-mid\)/);

        // Neither the pane-hosted card nor the rail strip picks up a
        // transparent header from this change — the only transparent-header
        // rules are the sheet's (pre-existing) and the launcher's.
        const transparentHeaderSelectors = [];
        const ruleRe = /([^{}]+)\{([^}]*)\}/g;
        let m;
        while ((m = ruleRe.exec(css)) !== null) {
            // Strip any leading comment block so only the selector remains.
            const selector = m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();
            if (!/\.todoMdViewerHeader$/.test(selector)) continue;
            if (!/background:\s*transparent/.test(m[2])) continue;
            transparentHeaderSelectors.push(selector);
        }
        expect(transparentHeaderSelectors.sort()).toEqual([
            '#mainList > #todoMdViewerCard .todoMdViewerHeader',
            '#todoMdViewerMobileSheet .todoMdViewerHeader',
        ]);
    });
});
