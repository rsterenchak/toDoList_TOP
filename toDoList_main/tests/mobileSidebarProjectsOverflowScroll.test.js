import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the mobile sidebar overflow fix. When enough projects exist to
// overflow the upper half of the drawer, the previous layout let #sideMa
// grow past its container — pushing #sideTit upward behind the iOS status
// bar and #addProj downward into the lower settings half. The fix keeps
// #sideTit and #addProj pinned (flex-shrink:0) and forces #sideMa to
// shrink with internal scrolling: re-declaring min-height:0 and
// overflow-y:auto on the mobile rule (the base values cascade, but
// redeclaring keeps the mobile contract explicit and audit-friendly) and
// adding a bottom-edge mask that hints at "more below" when the list
// overflows. Desktop layout is untouched.
describe('Mobile sidebar — projects list overflows internally', () => {
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

    describe('flex children of #sidebarTop never collapse', () => {
        it('#sideTit pins to its row height with flex-shrink:0 in base CSS', () => {
            // Strip any @media blocks so we only inspect the base rules.
            const noMedia = css.replace(
                /@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''
            );
            const match = noMedia.match(/#sideTit\s*\{([^}]*)\}/);
            expect(match, 'expected a base rule for #sideTit').not.toBeNull();
            expect(match[1]).toMatch(/flex-shrink:\s*0/);
        });

        it('#addProj pins to its natural height with flex-shrink:0 in base CSS', () => {
            const noMedia = css.replace(
                /@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''
            );
            const match = noMedia.match(/#addProj\s*\{([^}]*)\}/);
            expect(match, 'expected a base rule for #addProj').not.toBeNull();
            expect(match[1]).toMatch(/flex-shrink:\s*0/);
        });
    });

    describe('mobile #sideMa shrinks and scrolls internally on overflow', () => {
        it('re-declares min-height:0 so the flex child can shrink below its content size', () => {
            const rule = extractMobileRule('#sideMa');
            expect(rule).toMatch(/min-height:\s*0/);
        });

        it('re-declares overflow-y:auto so a long list scrolls internally instead of pushing siblings out', () => {
            const rule = extractMobileRule('#sideMa');
            expect(rule).toMatch(/overflow-y:\s*auto/);
        });

        it('adds a bottom-edge mask-image fade so the last visible row hints at "more below"', () => {
            const rule = extractMobileRule('#sideMa');
            // Both prefixed and unprefixed forms are paired so iOS Safari
            // and modern Chromium/Firefox both render the fade.
            expect(rule).toMatch(/-webkit-mask-image:\s*linear-gradient\(/);
            expect(rule).toMatch(/(?:^|\s)mask-image:\s*linear-gradient\(/);
        });
    });

    describe('global scrollbar styling covers #sideMa', () => {
        it('the global * rule paints every scrollable surface (including #sideMa) with the ultra-thin neutral gray thumb', () => {
            // Scrollbar styling now lives on a single global * rule that
            // covers the page, sidebar, todo lists, modals, and popovers.
            // No per-element override exists for #sideMa anymore — it
            // inherits the same 4px neutral-gray-on-transparent scrollbar
            // as the rest of the app.
            expect(css).toMatch(
                /\*::-webkit-scrollbar[^{]*\{[^}]*width:\s*4px/
            );
            expect(css).toMatch(
                /\*::-webkit-scrollbar-thumb[^{]*\{[^}]*#3a3a48/i
            );
            expect(css).not.toMatch(/#sideMa::-webkit-scrollbar/);
        });
    });
});
