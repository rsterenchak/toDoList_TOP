import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile project header's typography and stacking guarantees.
// The screen-level header at the ≤1023px breakpoint reads as the Void theme's
// mono chrome: SpaceMono everywhere, accent-colored title that respects the
// per-project --proj-accent swatch, and a defensive z-index so the empty-state
// block (which lives inside the sibling #mainList) can never hoist above the
// header at any viewport height. Verified through source inspection because
// main.js is too large to instantiate end-to-end in jsdom (CLAUDE.md guidance).
describe('STACK mobile project header typography + stacking', () => {
    const css = read('style.css');
    const main = read('main.js');

    function extractMobileRule(selector) {
        const media = css.indexOf('@media (max-width: 1023px)');
        expect(media).toBeGreaterThan(-1);
        const mediaEnd = (function () {
            let depth = 0;
            for (let i = css.indexOf('{', media); i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) return i;
                }
            }
            return css.length;
        })();
        const haystack = css.slice(media, mediaEnd);
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const ruleRe = new RegExp(
            selector.replace(/[#.[\]"=]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}'
        );
        const match = stripped.match(ruleRe);
        expect(match).not.toBeNull();
        return match[1];
    }

    it('#mobileProjLabel uses SpaceMono at the mobile breakpoint', () => {
        // PROJECT N OF M label sits above the title. The desktop chrome's
        // #footVersion / #footOpen / #footDone all use the SpaceMono stack
        // for the same low-key mono chrome — the mobile header's label
        // joins that family rather than falling through to system sans.
        const rule = extractMobileRule('#mobileProjLabel');
        expect(rule).toMatch(/font-family:\s*'SpaceMono'/);
    });

    it('#mobileProjName uses SpaceMono and resolves the per-project accent color', () => {
        // The title is the marquee of the mobile screen — it must read as
        // the project's accent color (purple by default; per-project
        // swatches recolor it) and in SpaceMono so it matches the rest of
        // the Void chrome rather than appearing as plain sans-serif white.
        const rule = extractMobileRule('#mobileProjName');
        expect(rule).toMatch(/font-family:\s*'SpaceMono'/);
        expect(rule).toMatch(/color:\s*var\(--proj-accent,\s*var\(--accent\)\)/);
    });

    it('#mobileProjCounts uses SpaceMono with the existing letter-spacing', () => {
        // Open/done counts in the stats row. SpaceMono + 0.12em
        // letter-spacing matches the desktop #footOpen / #footDone
        // treatment so the chrome reads as one family across breakpoints.
        const rule = extractMobileRule('#mobileProjCounts');
        expect(rule).toMatch(/font-family:\s*'SpaceMono'/);
        expect(rule).toMatch(/letter-spacing:\s*0\.12em/);
    });

    it('#mobileProjHeader stacks its children with a 20px gap', () => {
        // The three child rows — PROJECT N OF M label, the title row with
        // chevrons, and the open/done stats row — each read as their own
        // distinct band. A 20px gap (rather than the prior 6px) gives the
        // header room to breathe without eating meaningfully into the
        // todo list below.
        const rule = extractMobileRule('#mobileProjHeader');
        expect(rule).toMatch(/gap:\s*20px/);
    });

    it('#mobileProjHeader establishes a stacking context above #mainList', () => {
        // Defensive guarantee: even if a future flex/grid rule reorders
        // children of #mainBar, the empty-state block (rendered inside
        // the sibling #mainList) cannot visually paint over or hoist
        // above the header. position:relative + z-index:1 wins the
        // stacking order regardless of paint order.
        const rule = extractMobileRule('#mobileProjHeader');
        expect(rule).toMatch(/position:\s*relative/);
        expect(rule).toMatch(/z-index:\s*1/);
    });

    it('updateMobileProjHeader applies the per-project accent to the header element', () => {
        // The title color resolves --proj-accent through the CSS var
        // fallback chain. Setting --proj-accent on the header (rather
        // than just #mainList, which is a sibling, not an ancestor) is
        // what makes the title actually recolor when the user picks a
        // per-project swatch from the project context menu.
        const fnIdx = main.indexOf('function updateMobileProjHeader(');
        expect(fnIdx).toBeGreaterThan(-1);
        // Find the closing brace of the function via brace walking so we
        // only inspect that function's body.
        let depth = 0;
        let bodyStart = main.indexOf('{', fnIdx);
        let bodyEnd = bodyStart;
        for (let i = bodyStart; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) { bodyEnd = i; break; }
            }
        }
        const body = main.slice(bodyStart, bodyEnd);
        // Both the active-project branch (apply the accent) and the
        // empty branch (clear it) must run through applyProjectAccent so
        // re-renders don't leave a stale --proj-accent on the header.
        expect(body).toMatch(
            /applyProjectAccent\(\s*mobileProjHeader\s*,\s*listLogic\.getProjectColor\(\s*activeName\s*\)\s*\)/
        );
        expect(body).toMatch(/applyProjectAccent\(\s*mobileProjHeader\s*,\s*null\s*\)/);
    });
});
