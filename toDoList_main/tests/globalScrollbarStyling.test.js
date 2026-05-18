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
// todo lists, modals, popovers) with a slim purple thumb on a dark track,
// covering both WebKit and Firefox.
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

    it('declares scrollbar-width: thin and a purple-on-dark scrollbar-color for Firefox', () => {
        const rule = topLevelRule('*');
        expect(rule).toMatch(/scrollbar-width:\s*thin/);
        expect(rule).toMatch(/scrollbar-color:\s*#6C5DF5\s+var\(--bg-elevated\)/);
    });

    it('sizes the WebKit scrollbar at 8px in both axes', () => {
        const rule = topLevelRule('*::-webkit-scrollbar');
        expect(rule).toMatch(/width:\s*8px/);
        expect(rule).toMatch(/height:\s*8px/);
    });

    it('paints the WebKit scrollbar track with the elevated surface color', () => {
        const rule = topLevelRule('*::-webkit-scrollbar-track');
        expect(rule).toMatch(/background:\s*var\(--bg-elevated\)/);
    });

    it('paints the WebKit thumb purple #6C5DF5 with a ~4px border radius', () => {
        const rule = topLevelRule('*::-webkit-scrollbar-thumb');
        expect(rule).toMatch(/background:\s*#6C5DF5/);
        expect(rule).toMatch(/border-radius:\s*4px/);
    });

    it('lifts the thumb to a lighter purple #9D93EE on hover', () => {
        const rule = topLevelRule('*::-webkit-scrollbar-thumb:hover');
        expect(rule).toMatch(/background:\s*#9D93EE/);
    });

    it('drops the old per-element 3px scrollbar override on #sideMa / #mainList in favor of the global rule', () => {
        // The previous styling pinned #sideMa and #mainList to a 3px
        // thumb tinted with --border-bright; replacing that with the
        // global rule is the entire point of this change.
        expect(css).not.toMatch(/#sideMa::-webkit-scrollbar/);
        expect(css).not.toMatch(/#mainList::-webkit-scrollbar/);
    });
});
