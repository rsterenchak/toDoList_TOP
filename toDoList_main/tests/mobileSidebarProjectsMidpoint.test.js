import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the mobile sidebar drawer's two-halves layout: on mobile the
// drawer splits into #sidebarTop (projects header + project list +
// add-project button) and #sidebarBottom (Settings button + footer)
// with each half taking exactly 50% of the sidebar height. The top
// half uses justify-content:center so the projects block centers as
// a single group within the upper half — empty space splits evenly
// above and below, long lists fill outward from the midline and
// #sideMa scrolls within the top half. Desktop is unchanged: the top
// wrapper grows to fill the sidebar and the bottom wrapper holds
// elements that are display:none above the 700px breakpoint.
describe('Mobile sidebar — projects block centers in the upper half', () => {
    const main = read('main.js');
    const css  = read('style.css');

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

    describe('DOM wrappers split the sidebar into top and bottom halves', () => {
        it('creates #sidebarTop and #sidebarBottom wrappers inside #sideBar', () => {
            expect(main).toMatch(/sidebarTop\.id\s*=\s*['"]sidebarTop['"]/);
            expect(main).toMatch(/sidebarBottom\.id\s*=\s*['"]sidebarBottom['"]/);
            expect(main).toMatch(/main1\.appendChild\(sidebarTop\)/);
            expect(main).toMatch(/main1\.appendChild\(sidebarBottom\)/);
        });

        it('the projects group (sideTitle, sideMain, addProj) mounts into #sidebarTop', () => {
            expect(main).toMatch(/sidebarTop\.appendChild\(sideTitle\)/);
            expect(main).toMatch(/sidebarTop\.appendChild\(sideMain\)/);
            expect(main).toMatch(/sidebarTop\.appendChild\(addProj\)/);
        });

        it('the drawer block (drawerSettingsBtn, drawerFooter) mounts into #sidebarBottom', () => {
            expect(main).toMatch(/sidebarBottom\.appendChild\(drawerSettingsBtn\)/);
            expect(main).toMatch(/sidebarBottom\.appendChild\(drawerFooter\)/);
        });

        it('#sidebarTop is appended to #sideBar before #sidebarBottom so source order is top → bottom', () => {
            const topIdx    = main.indexOf('main1.appendChild(sidebarTop)');
            const bottomIdx = main.indexOf('main1.appendChild(sidebarBottom)');
            expect(topIdx).toBeGreaterThan(-1);
            expect(bottomIdx).toBeGreaterThan(topIdx);
        });
    });

    describe('mobile CSS pins each half to exactly 50% of the sidebar', () => {
        it('#sidebarTop is sized flex:0 0 50%', () => {
            const rule = extractMobileRule('#sidebarTop');
            expect(rule).toMatch(/flex:\s*0\s+0\s+50%/);
        });

        it('#sidebarBottom is sized flex:0 0 50%', () => {
            const rule = extractMobileRule('#sidebarBottom');
            expect(rule).toMatch(/flex:\s*0\s+0\s+50%/);
        });

        it('#sidebarTop uses justify-content:center so its content centers within the upper half', () => {
            const rule = extractMobileRule('#sidebarTop');
            expect(rule).toMatch(/justify-content:\s*center/);
        });

        it('#sidebarTop allows the top half to clip its content so long lists scroll inside #sideMa rather than spilling out the top', () => {
            const rule = extractMobileRule('#sidebarTop');
            expect(rule).toMatch(/overflow:\s*hidden/);
            expect(rule).toMatch(/min-height:\s*0/);
        });

        it('#sideMa drops its flex-grow on mobile so the projects block sizes to its rows and the parent\'s center justification can pack everything around the midline', () => {
            const rule = extractMobileRule('#sideMa');
            // 0 1 auto means: no grow, may shrink (so scroll can engage
            // when the list overflows the top half), natural basis.
            expect(rule).toMatch(/flex:\s*0\s+1\s+auto/);
        });
    });

    describe('desktop layout is unchanged', () => {
        // On desktop #sidebarTop should grow to fill the sidebar like
        // the old flat children flow, and #sidebarBottom is visually
        // inert (its children are display:none above 700px) so the
        // overall sidebar shape is identical to before the split.
        it('#sidebarTop has flex:1 1 auto outside the mobile breakpoint so it fills #sideBar on desktop', () => {
            // Strip any @media blocks so we only inspect the base rules.
            const noMedia = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
            const ruleRe = /#sidebarTop\s*\{([^}]*)\}/;
            const match = noMedia.match(ruleRe);
            expect(match, 'expected a base rule for #sidebarTop').not.toBeNull();
            expect(match[1]).toMatch(/flex:\s*1\s+1\s+auto/);
            expect(match[1]).toMatch(/min-height:\s*0/);
        });

        it('drawer chrome inside #sidebarBottom remains display:none on desktop so the bottom half collapses', () => {
            const desktop = css.match(/@media \(min-width:\s*701px\)\s*\{[\s\S]*?\n\}/g) || [];
            const hidesDrawer = desktop.find(function(block) {
                return /#drawerSettingsBtn/.test(block)
                    && /#drawerFooter/.test(block)
                    && /display:\s*none/.test(block);
            });
            expect(hidesDrawer).toBeTruthy();
        });
    });
});
