import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Regression for: ~309 color values in style.css named the Void violets
// directly (#6C5DF5, #9D93EE, #8b7bff and their rgba forms) instead of
// reading theme tokens, so they ignored data-theme. They now resolve through
// --accent-strong / --accent-soft / --accent, defined per theme.
describe('Void violets resolve through theme tokens', () => {
    function block(selector) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const match = css.match(new RegExp('(?:^|\\n)' + escaped + '\\s*\\{([^}]*)\\}'));
        if (!match) throw new Error(`Block for "${selector}" not found`);
        return match[1];
    }

    it('defines --accent-strong and --accent-soft with the Void values in :root', () => {
        const root = block(':root');
        expect(root).toMatch(/--accent-strong:\s*#6C5DF5;/i);
        expect(root).toMatch(/--accent-soft:\s*#9D93EE;/i);
    });

    it('gives both tokens the darker light-theme violets', () => {
        const light = block(':root[data-theme="light"]');
        expect(light).toMatch(/--accent-strong:\s*#5d4eca;/i);
        expect(light).toMatch(/--accent-soft:\s*#4a3bb8;/i);
    });

    it('leaves no Void violet literal outside the :root token definitions', () => {
        const withoutRoot = css.replace(block(':root'), '');
        expect(withoutRoot).not.toMatch(/#(?:6C5DF5|9D93EE|8b7bff)\b/i);
        expect(withoutRoot).not.toMatch(/rgba\(\s*(?:108\s*,\s*93\s*,\s*245|139\s*,\s*123\s*,\s*255|157\s*,\s*147\s*,\s*238)\s*,/i);
    });

    it('expresses translucent violets as color-mix over the matching token', () => {
        expect(css).toMatch(/color-mix\(in srgb, var\(--accent-strong\) 18%, transparent\)/);
        expect(css).toMatch(/color-mix\(in srgb, var\(--accent\) 12%, transparent\)/);
        expect(css).toMatch(/color-mix\(in srgb, var\(--accent-soft\) 30%, transparent\)/);
    });
});
