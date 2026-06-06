import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile nav-bar collapse: at the ≤1023px breakpoint the
// dedicated 44px nav band above the project header disappears. The
// hamburger toggle is hidden on mobile (it was redundant with the project
// name + ▾ chevron drawer tap), but #sidebarToggle stays a child of
// #navBar in the DOM so the desktop fallback (1024px+) keeps the existing
// flex-row chrome and the rail toggle.
describe('STACK mobile nav-bar collapse', () => {
    const css = read('style.css');

    function extractMobileRule(selector) {
        const media = css.indexOf('@media (max-width: 1023px)');
        expect(media).toBeGreaterThan(-1);
        let depth = 0;
        let mediaEnd = css.length;
        for (let i = css.indexOf('{', media); i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') {
                depth--;
                if (depth === 0) { mediaEnd = i; break; }
            }
        }
        const haystack = css.slice(media, mediaEnd);
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const ruleRe = new RegExp(
            selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
        );
        const match = stripped.match(ruleRe);
        expect(match, 'expected a mobile rule for ' + selector).not.toBeNull();
        return match[1];
    }

    it('#outerContainer collapses both nav and footer grid tracks to 0 at the mobile breakpoint', () => {
        // The desktop grid reserves `var(--nav-h)` for the nav row and
        // `var(--foot-h) + safe-area-inset-bottom` for the footer row.
        // With the nav band gone and #footBar hidden on mobile (the
        // version label + project count moved to the Settings modal's
        // About section), both reservations collapse to `0`. The second
        // track is `auto` for the now-playing strip (collapses to 0 while
        // hidden); the third track is 0 for the desktop view sub-band (hidden
        // on mobile, where #mobileTabBar is the sole navigator); and the
        // minmax(0, 1fr) main track owns the rest of the viewport.
        const rule = extractMobileRule('#outerContainer');
        expect(rule).toMatch(/grid-template-rows:\s*0\s+auto\s+0\s+minmax\(\s*0\s*,\s*1fr\s*\)\s+0/);
    });

    it('#navBar collapses to invisible 0-height chrome on mobile (not display:none)', () => {
        // The box collapses (height:0, no padding/border/background) with
        // overflow:visible rather than display:none. All navBar children are
        // hidden on mobile (hamburger + pomodoro/music/settings via the
        // rules pinned in mobileNavUtilityButtonsHidden.test.js), but the
        // box is kept rendering so the desktop fallback is a pure unset.
        const rule = extractMobileRule('#navBar');
        expect(rule).toMatch(/height:\s*0/);
        expect(rule).toMatch(/min-height:\s*0/);
        expect(rule).toMatch(/padding:\s*0/);
        expect(rule).toMatch(/border:\s*none/);
        expect(rule).toMatch(/background:\s*transparent/);
        expect(rule).toMatch(/overflow:\s*visible/);
        expect(rule).not.toMatch(/display:\s*none/);
    });

    it('#sidebarToggle is hidden on mobile (redundant with the project-name drawer tap)', () => {
        // The hamburger opened the same drawer as tapping the project name +
        // ▾ chevron, so on mobile it is hidden outright. No absolute
        // positioning or hit-target sizing remains — the rule collapses to
        // display:none. The desktop rail toggle (1024px+) is untouched.
        const rule = extractMobileRule('#sidebarToggle');
        expect(rule).toMatch(/display:\s*none/);
        expect(rule).not.toMatch(/position:\s*absolute/);
    });

    it('#viewSwitcher is display:none on mobile (bottom tab bar is the sole navigator)', () => {
        // The view-switch pill cluster duplicates the bottom tab bar's
        // destinations and would clip into the status bar / Dynamic Island
        // on the collapsed mobile nav. Pin display:none inside the mobile
        // media query so a future refactor can't silently un-hide it.
        const rule = extractMobileRule('#viewSwitcher');
        expect(rule).toMatch(/display:\s*none/);
    });

    it('#mobileProjHeader absorbs env(safe-area-inset-top) into its padding', () => {
        // The safe-area-inset-top moved off #navBar (now collapsed) onto
        // the project header so the iOS notch / Dynamic Island clearance
        // still applies above PROJECT N OF M.
        const rule = extractMobileRule('#mobileProjHeader');
        expect(rule).toMatch(/padding:\s*calc\(\s*max\(\s*env\(safe-area-inset-top[^)]*\)\s*,\s*44px\s*\)\s*\+\s*20px\s*\)\s+16px\s+10px/);
        // Defensive: the absolute-positioning target context was already
        // declared on the header; keep it present so future moves don't
        // accidentally drop it.
        expect(rule).toMatch(/position:\s*relative/);
    });

    it('the desktop #sidebarToggle 36×36 rule is preserved (untouched outside the breakpoint)', () => {
        // Desktop layout (1024px+) is unchanged — the desktop declaration
        // still defines the 36×36 button with no positioning.
        const desktopBlock = css.match(/#sidebarToggle\s*\{[^}]*\}/);
        expect(desktopBlock).not.toBeNull();
        expect(desktopBlock[0]).toMatch(/width:\s*36px/);
        expect(desktopBlock[0]).toMatch(/height:\s*36px/);
        expect(desktopBlock[0]).not.toMatch(/position:\s*absolute/);
    });
});
