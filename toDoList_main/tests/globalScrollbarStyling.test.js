import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the global Void-themed scrollbar styling. The default browser
// scrollbar (bright thumb on a near-black background) clashed with the
// dark aesthetic — especially on long calendar/expanded views — so a
// single * rule paints every scrollable surface (page, projects sidebar,
// todo lists, modals, popovers) with an ultra-thin neutral gray thumb on
// an invisible track, covering both WebKit and Firefox.
describe('Global scrollbar styling matches the Void aesthetic', () => {
    const css = read('style.css');

    // Find the body of a top-level rule whose selector matches `selector`
    // exactly (no extra characters before the `{`). This avoids the
    // `*, *::before, *::after` reset rule being matched when the caller
    // asks for the bare `*` rule.
    function topLevelRule(selector) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(
            '(?:^|}|\\*/)\\s*' + escaped + '\\s*\\{([^{}]*)\\}'
        );
        const match = css.match(re);
        if (!match) throw new Error(`Top-level rule for "${selector}" not found`);
        return match[1];
    }

    it('declares scrollbar-width: thin and a neutral-gray-on-transparent scrollbar-color for Firefox', () => {
        const rule = topLevelRule('*');
        expect(rule).toMatch(/scrollbar-width:\s*thin/);
        expect(rule).toMatch(/scrollbar-color:\s*color-mix\(in srgb, var\(--border-bright\) 70%, var\(--text-muted\)\)\s+transparent/);
    });

    it('sizes the WebKit scrollbar at 4px in both axes', () => {
        const rule = topLevelRule('*::-webkit-scrollbar');
        expect(rule).toMatch(/width:\s*4px/);
        expect(rule).toMatch(/height:\s*4px/);
    });

    it('leaves the WebKit scrollbar track transparent so no rail is visible', () => {
        const rule = topLevelRule('*::-webkit-scrollbar-track');
        expect(rule).toMatch(/background:\s*transparent/);
    });

    it('paints the WebKit thumb muted gray (border-bright toward text-muted) with a ~2px border radius', () => {
        const rule = topLevelRule('*::-webkit-scrollbar-thumb');
        expect(rule).toMatch(/background:\s*color-mix\(in srgb, var\(--border-bright\) 70%, var\(--text-muted\)\)/);
        expect(rule).toMatch(/border-radius:\s*2px/);
    });

    it('lifts the thumb to a slightly lighter gray on hover', () => {
        const rule = topLevelRule('*::-webkit-scrollbar-thumb:hover');
        // Hover shade leans further toward --text-muted than the resting
        // thumb (70% --border-bright) so the lift is visible in every theme.
        const match = rule.match(/background:\s*color-mix\(in srgb, var\(--border-bright\) (\d+)%, var\(--text-muted\)\)/);
        expect(match).not.toBeNull();
        expect(Number(match[1])).toBeLessThan(70);
    });

    it('drops the old per-element 3px scrollbar override on #sideMa / #mainList in favor of the global rule', () => {
        // The previous styling pinned #sideMa and #mainList to a 3px
        // thumb tinted with --border-bright; replacing that with the
        // global rule is the entire point of this change.
        expect(css).not.toMatch(/#sideMa::-webkit-scrollbar/);
        expect(css).not.toMatch(/#mainList::-webkit-scrollbar/);
    });
});
