import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the mobile sidebar drawer's dynamic-viewport + safe-area fix.
// The bug was: on iOS Safari the open drawer used height:100% which only
// fills #mainSec — that container doesn't reach the visual viewport
// bottom, leaving a dark strip below the V1.1 footer. The PROJECTS
// header also sat directly under the status bar / notch, and the
// absolutely-positioned × close button stayed clipped even after a
// padding-top was added to #sideTit (absolute children sit at the
// containing block's padding-box top edge and ignore its padding-top).
// The fix:
// - #sideBar uses height:100dvh so it fills the dynamic viewport
// - #sideBar reserves env(safe-area-inset-bottom) at the drawer level
// - #sideBar reserves env(safe-area-inset-top) as the single source of
//   inset truth, shifting the whole #sideTit block — close button and
//   PROJECTS label — below device chrome as one unit
// - #sideTit carries only visual breathing-room padding (no env())
describe('Mobile sidebar drawer safe-area layout', () => {
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

    it('#sideBar fills the dynamic viewport so the drawer bg reaches the home indicator', () => {
        const rule = extractMobileRule('#sideBar');
        expect(rule).toMatch(/height:\s*100dvh/);
    });

    it('#sideBar reserves env(safe-area-inset-bottom) so the footer sits flush above the home indicator', () => {
        const rule = extractMobileRule('#sideBar');
        expect(rule).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom\s*,\s*0px\)/);
    });

    // Regression: the mobile drawer's close (×) button is position:absolute
    // with top:8px relative to #sideTit. Absolute positioning ignores its
    // containing block's padding for the offset origin, so #sideTit's
    // existing padding-top inset did not push the close button below the
    // notch / status bar — only the PROJECTS label, which sits inside the
    // padding area. Adding env(safe-area-inset-top) at the #sideBar level
    // shifts #sideTit (and therefore the absolutely-positioned close
    // button) down by the inset on iOS, so the × control clears the
    // status bar / Dynamic Island.
    it('#sideBar reserves env(safe-area-inset-top) so the close button clears the iOS status bar / notch', () => {
        const rule = extractMobileRule('#sideBar');
        expect(rule).toMatch(/padding-top:\s*env\(safe-area-inset-top\s*,\s*0px\)/);
    });

    // Regression: position:absolute resolves against #mainSec, whose
    // overflow:hidden clipped the drawer above the footer track and left
    // a strip of dimmed app footer visible below the open drawer. Pinning
    // the drawer to the viewport with position:fixed lets height:100dvh
    // actually reach the home indicator instead of being clipped by the
    // ancestor grid track.
    it('#sideBar uses position:fixed so it anchors to the viewport rather than the clipped #mainSec containing block', () => {
        const rule = extractMobileRule('#sideBar');
        expect(rule).toMatch(/position:\s*fixed/);
        expect(rule).not.toMatch(/position:\s*absolute/);
    });

    // The safe-area inset that clears the iOS status bar / notch /
    // Dynamic Island lives on #sideBar's padding-top (see test above),
    // not on #sideTit. Putting env(safe-area-inset-top) on #sideTit
    // shifts only its in-flow children (the PROJECTS label); the
    // absolutely-positioned close button anchors against #sideTit's
    // padding-box top edge and would still sit at top:8px under the
    // status bar. Carrying the inset on the parent shifts the entire
    // #sideTit block — close button included — down as one unit, with
    // a single source of inset truth so other top-anchored children
    // can't drift out of sync.
    it('#sideTit does NOT reapply env(safe-area-inset-top) — the inset lives on #sideBar so the close button shifts down with the header block', () => {
        const rule = extractMobileRule('#sideTit');
        expect(rule).not.toMatch(/env\(\s*safe-area-inset-top/);
    });

    it('#sideTit keeps a non-inset padding-top + min-height so the PROJECTS label has visual breathing room above the natural --row-h content row', () => {
        const rule = extractMobileRule('#sideTit');
        expect(rule).toMatch(/padding-top:\s*14px/);
        expect(rule).toMatch(/min-height:\s*calc\(\s*var\(--row-h\)\s*\+\s*14px\s*\)/);
    });
});
