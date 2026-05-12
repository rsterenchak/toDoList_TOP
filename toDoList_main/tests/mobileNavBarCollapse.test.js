import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile nav-bar collapse: at the ≤700px breakpoint the
// dedicated 44px nav band above the project header disappears, and the
// hamburger toggle re-anchors to the top-right of the viewport visually
// aligned with PROJECT N OF M. The change is CSS-only — #sidebarToggle
// stays a child of #navBar in the DOM but is repositioned absolutely so
// the desktop fallback (701px+) keeps the existing flex-row chrome.
describe('STACK mobile nav-bar collapse', () => {
    const css = read('style.css');

    function extractMobileRule(selector) {
        const media = css.indexOf('@media (max-width: 700px)');
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

    it('#outerContainer collapses the first grid track to 0 at the mobile breakpoint', () => {
        // The desktop grid reserves `var(--nav-h) + safe-area-inset-top` for
        // the nav row. With the nav band gone, that reservation is replaced
        // with `0` so #mainSec sits flush at the top of the viewport.
        const rule = extractMobileRule('#outerContainer');
        expect(rule).toMatch(/grid-template-rows:\s*0\s+minmax\(\s*0\s*,\s*1fr\s*\)\s+calc\(\s*var\(--foot-h\)\s*\+\s*env\(safe-area-inset-bottom\)\s*\)/);
    });

    it('#navBar collapses to invisible 0-height chrome on mobile (not display:none)', () => {
        // display:none on #navBar would also hide the #sidebarToggle child
        // — so we collapse the box (height:0, no padding/border/background)
        // and use overflow:visible to let the absolutely-positioned toggle
        // render outside its 0-height parent. The other navBar children
        // (pomodoro/music/settings) are already display:none on mobile via
        // the rules pinned in mobileNavUtilityButtonsHidden.test.js.
        const rule = extractMobileRule('#navBar');
        expect(rule).toMatch(/height:\s*0/);
        expect(rule).toMatch(/min-height:\s*0/);
        expect(rule).toMatch(/padding:\s*0/);
        expect(rule).toMatch(/border:\s*none/);
        expect(rule).toMatch(/background:\s*transparent/);
        expect(rule).toMatch(/overflow:\s*visible/);
        expect(rule).not.toMatch(/display:\s*none/);
    });

    it('#sidebarToggle anchors absolutely at the top-right of the viewport on mobile', () => {
        // Position resolves against #navBar's existing position:relative
        // (which sits at top:0 with 0 height after the collapse), so the
        // top/right offsets land the hamburger at viewport-top coordinates.
        // safe-area-inset-top tucks it below the iOS Dynamic Island.
        const rule = extractMobileRule('#sidebarToggle');
        expect(rule).toMatch(/position:\s*absolute/);
        expect(rule).toMatch(/top:\s*calc\(\s*max\(\s*env\(safe-area-inset-top[^)]*\)\s*,\s*24px\s*\)\s*\+\s*8px\s*\)/);
        expect(rule).toMatch(/right:\s*12px/);
        expect(rule).toMatch(/z-index:\s*20/);
    });

    it('#sidebarToggle remains a ≥44×44 hit target on mobile', () => {
        // CLAUDE.md mobile rule + STACK acceptance criterion. Desktop is
        // 36×36; the breakpoint override bumps it to satisfy the touch
        // target standard.
        const rule = extractMobileRule('#sidebarToggle');
        expect(rule).toMatch(/width:\s*44px/);
        expect(rule).toMatch(/height:\s*44px/);
    });

    it('#mobileProjHeader absorbs env(safe-area-inset-top) into its padding', () => {
        // The safe-area-inset-top moved off #navBar (now collapsed) onto
        // the project header so the iOS notch / Dynamic Island clearance
        // still applies above PROJECT N OF M.
        const rule = extractMobileRule('#mobileProjHeader');
        expect(rule).toMatch(/padding:\s*calc\(\s*max\(\s*env\(safe-area-inset-top[^)]*\)\s*,\s*24px\s*\)\s*\+\s*14px\s*\)\s+16px\s+10px/);
        // Defensive: the absolute-positioning target context was already
        // declared on the header; keep it present so future moves don't
        // accidentally drop it.
        expect(rule).toMatch(/position:\s*relative/);
    });

    it('the desktop #sidebarToggle 36×36 rule is preserved (untouched outside the breakpoint)', () => {
        // Desktop layout (701px+) is unchanged — the desktop declaration
        // still defines the 36×36 button with no positioning.
        const desktopBlock = css.match(/#sidebarToggle\s*\{[^}]*\}/);
        expect(desktopBlock).not.toBeNull();
        expect(desktopBlock[0]).toMatch(/width:\s*36px/);
        expect(desktopBlock[0]).toMatch(/height:\s*36px/);
        expect(desktopBlock[0]).not.toMatch(/position:\s*absolute/);
    });
});
