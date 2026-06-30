import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: on mobile, the task-pane canvas (#mainBar and #mainList) was
// painted --bg-base, the darkest token, while the surrounding chrome
// (#outerContainer, the project header, and #mobileTabBar) was painted
// --bg-elevated. With a short list the empty area below the last card
// rendered as a darker band between the content and the lighter tab bar.
// Fix: inside the @media (max-width: 1023px) block, repaint #mainBar /
// #mainList to --bg-elevated so the canvas matches the frame. Desktop
// keeps its darker --bg-base canvas. Source-inspection per CLAUDE.md.
describe('Mobile task-pane canvas — matches the elevated frame', () => {
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

    // Match any rule whose selector list contains the given id token (e.g.
    // `#mainBar`, possibly grouped with siblings like `#mainBar, #mainList`)
    // and whose body sets background to --bg-elevated.
    function findMobileElevatedRuleFor(idToken) {
        const re = /([^{}]+)\{([^}]*)\}/g;
        let m;
        while ((m = re.exec(css)) !== null) {
            const selector = m[1];
            const body = m[2];
            if (!new RegExp(idToken + '(?![a-zA-Z0-9_-])').test(selector)) continue;
            if (!/background:\s*var\(--bg-elevated\)/.test(body)) continue;
            if (inMobileMediaBlock(m.index)) return m;
        }
        return null;
    }

    it('repaints #mainBar to --bg-elevated inside the mobile media block', () => {
        expect(findMobileElevatedRuleFor('#mainBar')).toBeTruthy();
    });

    it('repaints #mainList to --bg-elevated inside the mobile media block', () => {
        expect(findMobileElevatedRuleFor('#mainList')).toBeTruthy();
    });

    it('keeps the desktop #mainBar base rule on --bg-base', () => {
        // The first #mainBar { ... } rule outside any @media block is the
        // desktop default. Confirm it still paints --bg-base.
        const hit = findRule(/(^|\n)#mainBar\s*\{[^}]*\}/);
        expect(hit).toBeTruthy();
        expect(hit.rule).toMatch(/background:\s*var\(--bg-base\)/);
        expect(inMobileMediaBlock(hit.pos)).toBe(false);
    });

    it('keeps the desktop #mainList base rule on --bg-base', () => {
        const hit = findRule(/(^|\n)#mainList\s*\{[^}]*\}/);
        expect(hit).toBeTruthy();
        expect(hit.rule).toMatch(/background:\s*var\(--bg-base\)/);
        expect(inMobileMediaBlock(hit.pos)).toBe(false);
    });
});
