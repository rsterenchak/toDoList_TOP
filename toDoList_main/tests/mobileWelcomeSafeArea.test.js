import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the iOS safe-area-inset-top fix for the STACK mobile welcome empty
// state. With #navBar collapsed to zero-height on mobile, the topmost
// painted element on the welcome screen (NO PROJECTS yet) is
// #emptyState.emptyStateNoProjects, which previously used a flat 48px top
// padding. On notched iPhones, that put the ghost mascot directly under
// the Dynamic Island / status bar with no clearance. The fix folds
// env(safe-area-inset-top) into the top padding so the ghost has breathing
// room below the OS chrome; the rule resolves to 48px on non-notched
// devices (env(..., 0px) fallback) so the desktop / iPhone SE layout is
// unchanged.
describe('STACK mobile welcome empty-state safe-area-inset-top', () => {
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

    it('#emptyState.emptyStateNoProjects folds env(safe-area-inset-top) into its top padding', () => {
        // The welcome screen's ghost mascot must sit below the iOS Dynamic
        // Island / status bar. With #navBar zero-height on mobile, the
        // empty-state container is the topmost visible element on this
        // screen, so the inset reservation lives here instead of on a nav.
        const rule = extractMobileRule('#emptyState.emptyStateNoProjects');
        expect(rule).toMatch(
            /padding:\s*calc\(\s*env\(safe-area-inset-top[^)]*\)\s*\+\s*48px\s*\)\s+16px\s+40px/
        );
    });

    it('#mobileProjHeader retains its safe-area-inset-top padding (companion to the welcome fix)', () => {
        // The project-loaded screen's topmost element is #mobileProjHeader.
        // This pairs with the welcome-state rule above to cover both
        // top-of-viewport elements on mobile.
        const rule = extractMobileRule('#mobileProjHeader');
        expect(rule).toMatch(
            /padding:\s*calc\(\s*env\(safe-area-inset-top[^)]*\)\s*\+\s*14px\s*\)\s+16px\s+10px/
        );
    });

    it('#sidebarToggle keeps its safe-area-inset-top offset on mobile (hamburger on both screens)', () => {
        // The hamburger is the only top-bar control on both screens (welcome
        // empty state and projects-loaded). It must clear the status bar.
        const rule = extractMobileRule('#sidebarToggle');
        expect(rule).toMatch(
            /top:\s*calc\(\s*env\(safe-area-inset-top[^)]*\)\s*\+\s*8px\s*\)/
        );
    });
});
