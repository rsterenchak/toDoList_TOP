import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { openViewerMobileSheet } from '../src/mobileSheets.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression pin: on mobile the TODO.md viewer's collapse/expand chevron was a
// dead control. Both mobile surfaces ignore the card's `collapsed` flag — the
// inline #mainList launcher hides its body unconditionally, and the bottom
// sheet lives outside #mainList so the `#mainList ... .collapsed` body-hide
// rule never matches it. Tapping the chevron therefore only swapped its own
// glyph, which read as a broken toggle. The chevron is now hidden on both
// mobile surfaces (desktop keeps it, where it genuinely collapses the in-list
// card), and the sheet expands the card explicitly on open rather than relying
// on that CSS scoping accident.

describe('Mobile TODO.md viewer — collapse toggle hidden, sheet always expanded', () => {
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

    it('hides the collapse chevron on the inline mobile launcher and inside the bottom sheet', () => {
        const idx = css.search(
            /#mainList\s*>\s*#todoMdViewerCard\s+\.todoMdViewerCollapseBtn,\s*#todoMdViewerMobileSheet\s+\.todoMdViewerCollapseBtn\s*\{[^}]*display:\s*none/
        );
        expect(idx).toBeGreaterThan(-1);
        expect(inMobileMediaBlock(idx)).toBe(true);
    });

    it('scopes every collapse-chevron hide rule so desktop keeps the working toggle', () => {
        // A bare `.todoMdViewerCollapseBtn { display: none }` (or any rule
        // outside the mobile media block) would strip the chevron from the
        // desktop in-list card, where collapsing genuinely hides the body.
        const hideRules = [...css.matchAll(/([^{}]*\.todoMdViewerCollapseBtn[^{}]*)\{([^}]*)\}/g)]
            .filter((m) => /display:\s*none/.test(m[2]));
        expect(hideRules.length).toBeGreaterThan(0);
        for (const m of hideRules) {
            expect(m[1]).toMatch(/#mainList|#todoMdViewerMobileSheet/);
            expect(inMobileMediaBlock(css.indexOf(m[0]))).toBe(true);
        }
    });
});

describe('openViewerMobileSheet — card renders expanded in the sheet', () => {
    let mainListDiv;

    function mountCard(collapsed) {
        mainListDiv = document.createElement('div');
        mainListDiv.id = 'mainList';
        const card = document.createElement('div');
        card.id = 'todoMdViewerCard';
        card.className = 'todoMdViewerCard' + (collapsed ? ' collapsed' : '');
        mainListDiv.appendChild(card);
        document.body.appendChild(mainListDiv);
        return card;
    }

    function closeViaEscape() {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }

    afterEach(() => {
        closeViaEscape();
        const stray = document.getElementById('todoMdViewerMobileSheetBackdrop');
        if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
        if (mainListDiv && mainListDiv.parentNode) {
            mainListDiv.parentNode.removeChild(mainListDiv);
        }
        mainListDiv = null;
    });

    it('strips the collapsed flag when the card moves into the sheet', () => {
        const card = mountCard(true);
        openViewerMobileSheet(card);
        const sheet = document.getElementById('todoMdViewerMobileSheet');
        expect(sheet).toBeTruthy();
        expect(sheet.contains(card)).toBe(true);
        expect(card.classList.contains('collapsed')).toBe(false);
    });

    it('restores the collapsed flag when the card returns to #mainList', () => {
        // The inline card mounts collapsed and its chevron glyph/aria (owned by
        // todoMdViewer.js) tracks that flag, so the sheet must hand the card
        // back in the state it borrowed it in.
        const card = mountCard(true);
        openViewerMobileSheet(card);
        closeViaEscape();
        expect(mainListDiv.contains(card)).toBe(true);
        expect(card.classList.contains('collapsed')).toBe(true);
    });

    it('leaves an already-expanded card expanded through open and close', () => {
        const card = mountCard(false);
        openViewerMobileSheet(card);
        expect(card.classList.contains('collapsed')).toBe(false);
        closeViaEscape();
        expect(card.classList.contains('collapsed')).toBe(false);
    });
});
