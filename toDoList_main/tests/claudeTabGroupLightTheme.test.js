import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression for: the desktop CHAT/RUNS segmented control
// (#desktopChatPane .claudeTabGroup) hardcodes a dark palette
// (#15151e background, #3a3a50 border, light text) that becomes invisible /
// low-contrast on the light page background. theme.js sets data-theme="light"
// on <html>, so a :root[data-theme="light"] override must retint the
// container and pills to the light-purple Option B palette. CSS-only fix.
describe('claudeTabGroup responds to light theme', () => {
    const css = read('style.css');

    // Body of the first rule whose selector matches `selector` exactly.
    function ruleBody(selector) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(
            '(?:^|}|\\*/)\\s*' + escaped + '\\s*\\{([^{}]*)\\}'
        );
        const match = css.match(re);
        if (!match) throw new Error(`Rule for "${selector}" not found`);
        return match[1];
    }

    it('tints the tab group container with the light-purple Option B palette', () => {
        const rule = ruleBody(':root[data-theme="light"] #desktopChatPane .claudeTabGroup');
        expect(rule).toMatch(/background:\s*#ddddf0/i);
        expect(rule).toMatch(/border-color:\s*#c0c0e0/i);
    });

    it('sets the inactive tab label to the muted purple-gray', () => {
        const rule = ruleBody(':root[data-theme="light"] #desktopChatPane .claudeTabGroup .claudeTab');
        expect(rule).toMatch(/color:\s*#5a5a7a/i);
    });

    it('fills the active pill with the brand purple and white label', () => {
        const rule = ruleBody(':root[data-theme="light"] #desktopChatPane .claudeTabGroup .claudeTab[aria-selected="true"]');
        expect(rule).toMatch(/background:\s*#6C5DF5/i);
        expect(rule).toMatch(/color:\s*#ffffff/i);
    });
});
