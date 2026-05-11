import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile nav contract: at the ≤700px breakpoint the
// pomodoro, music, and ghost-menu triggers in #navBar are hidden so the
// nav reads as just the hamburger toggle on the left. The three desktop
// triggers either migrate to the bottom sheet (pomodoro + music) or are
// mirrored in the drawer (ghost menu actions), so the icon cluster has
// no place in the STACK mobile chrome.
describe('STACK mobile nav utility buttons hidden', () => {
    const css = read('style.css');

    // Walk every `@media (max-width: 700px)` block in the file and return
    // them concatenated. The hide rules can live in any mobile block; what
    // matters for cascade is that the rule sits AFTER the matching desktop
    // declaration, which is asserted separately below.
    function allMobileMediaBlocks() {
        const blocks = [];
        let cursor = 0;
        while (true) {
            const media = css.indexOf('@media (max-width: 700px)', cursor);
            if (media === -1) break;
            let depth = 0;
            let end = css.length;
            for (let i = css.indexOf('{', media); i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) { end = i + 1; break; }
                }
            }
            blocks.push({ start: media, end, text: css.slice(media, end) });
            cursor = end;
        }
        expect(blocks.length).toBeGreaterThan(0);
        return blocks;
    }

    // Match the declaration block for `selector` whether it's a standalone
    // rule (`#x { ... }`) or one of several selectors in a comma-joined list
    // (`#x, #y, #z { ... }`). Returns the body text of the rule.
    function extractMobileRule(haystack, selector) {
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const escaped = selector.replace(/[#.]/g, m => '\\' + m);
        // Selector followed by optional whitespace, then either `{` (lone)
        // or `,` (start of a multi-selector list). For the comma case, walk
        // past the rest of the selector list to the opening brace.
        const re = new RegExp(
            '(?:^|[\\s,{}])' + escaped + '\\s*(?=[,{])',
            'm'
        );
        const m = re.exec(stripped);
        if (!m) return null;
        const startIdx = stripped.indexOf('{', m.index);
        if (startIdx === -1) return null;
        const endIdx = stripped.indexOf('}', startIdx);
        if (endIdx === -1) return null;
        return stripped.slice(startIdx + 1, endIdx);
    }

    // Locate the mobile media block that actually contains a `display: none`
    // declaration for `selector`. Returns { block, body } where `body` is
    // the rule's declaration text. Used by the per-selector hide tests so
    // they can also assert the cascade ordering against that block.
    function findHidingBlock(selector) {
        const blocks = allMobileMediaBlocks();
        for (const block of blocks) {
            const body = extractMobileRule(block.text, selector);
            if (body && /display:\s*none/.test(body)) return { block, body };
        }
        return null;
    }

    it('#pomodoroToggle is hidden at the mobile breakpoint', () => {
        const hit = findHidingBlock('#pomodoroToggle');
        expect(hit).not.toBeNull();
    });

    it('#musicToggle is hidden at the mobile breakpoint', () => {
        const hit = findHidingBlock('#musicToggle');
        expect(hit).not.toBeNull();
    });

    it('#settingsToggle (ghost menu) is hidden at the mobile breakpoint', () => {
        const hit = findHidingBlock('#settingsToggle');
        expect(hit).not.toBeNull();
    });

    it('#sidebarToggle (hamburger) is NOT hidden — it remains the only nav button on mobile', () => {
        // Strip comments so the source narrative around #sidebarToggle
        // (which can mention "display: none" elsewhere) can't be matched.
        const blocks = allMobileMediaBlocks();
        for (const block of blocks) {
            const stripped = block.text.replace(/\/\*[\s\S]*?\*\//g, '');
            const ruleRe = /([^{}]+)\{([^}]*)\}/g;
            let match;
            while ((match = ruleRe.exec(stripped)) !== null) {
                const selectorList = match[1];
                const body = match[2];
                if (/#sidebarToggle\b/.test(selectorList) && /display:\s*none/.test(body)) {
                    throw new Error(
                        'sidebarToggle is hidden by mobile rule: ' + selectorList.trim()
                    );
                }
            }
        }
    });

    it('the mobile hide rules come AFTER the desktop rules so source order wins', () => {
        // No !important is used; the cascade fix relies on the mobile rule
        // block sitting later in the file than each desktop declaration so
        // the override wins at equal (1-ID) specificity. Mirrors the
        // ordering check in stackMobileLayoutCollapse.test.js.
        const desktopPomodoro = css.indexOf('#pomodoroToggle {');
        const desktopMusic    = css.indexOf('#musicToggle {');
        const desktopSettings = css.indexOf('#settingsToggle {');
        expect(desktopPomodoro).toBeGreaterThan(-1);
        expect(desktopMusic).toBeGreaterThan(-1);
        expect(desktopSettings).toBeGreaterThan(-1);

        for (const [selector, desktopIdx] of [
            ['#pomodoroToggle', desktopPomodoro],
            ['#musicToggle', desktopMusic],
            ['#settingsToggle', desktopSettings],
        ]) {
            const hit = findHidingBlock(selector);
            expect(hit, 'expected a mobile hide rule for ' + selector).not.toBeNull();
            expect(hit.block.start).toBeGreaterThan(desktopIdx);
        }
    });
});
