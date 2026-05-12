import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the 24px floor on env(safe-area-inset-top) for the mobile top chrome.
// On any context where env(safe-area-inset-top) reports 0 — regular browser
// tabs on iOS Safari / Chrome and any non-notched device — the prior
// calc(env(..., 0px) + Npx) form collapsed to just the Npx floor, so the
// browser status bar / URL bar visually clashed with the hamburger and
// project header. Wrapping the inset in max(env(...), 24px) guarantees
// breathing room everywhere while still expanding to the real inset on
// notched standalone PWAs.
describe('Mobile top chrome max() inset floor', () => {
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

    it('#sidebarToggle floors the safe-area inset at 24px so it never hugs the viewport top', () => {
        const rule = extractMobileRule('#sidebarToggle');
        expect(rule).toMatch(
            /top:\s*calc\(\s*max\(\s*env\(safe-area-inset-top\s*,\s*0px\s*\)\s*,\s*24px\s*\)\s*\+\s*8px\s*\)/
        );
    });

    it('#mobileProjHeader floors the safe-area inset at 44px in its top padding to clear iOS status bar / Dynamic Island', () => {
        const rule = extractMobileRule('#mobileProjHeader');
        expect(rule).toMatch(
            /padding:\s*calc\(\s*max\(\s*env\(safe-area-inset-top\s*,\s*0px\s*\)\s*,\s*44px\s*\)\s*\+\s*20px\s*\)\s+16px\s+10px/
        );
    });

    it('#emptyState.emptyStateNoProjects floors the safe-area inset at 24px in its top padding', () => {
        const rule = extractMobileRule('#emptyState.emptyStateNoProjects');
        expect(rule).toMatch(
            /padding:\s*calc\(\s*max\(\s*env\(safe-area-inset-top\s*,\s*0px\s*\)\s*,\s*24px\s*\)\s*\+\s*48px\s*\)\s+16px\s+40px/
        );
    });
});
