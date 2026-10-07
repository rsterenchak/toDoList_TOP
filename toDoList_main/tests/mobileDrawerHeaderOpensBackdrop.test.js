import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(resolve(here, '../src/main.js'), 'utf8');

// Regression: on mobile the projects drawer is opened by tapping the project
// pill in the header (activateProjectPicker → openMobileDrawer), not the
// hamburger. That path added `sidebar-open` to #sideBar but never showed
// #sidebarOverlay, so the drawer slid in over an undimmed tasks pane — the
// deep dim + blur backdrop rules never got a visible element to paint.
describe('Mobile header drawer open shows the dimming backdrop', () => {
    function body(name) {
        const start = main.indexOf('function ' + name + '()');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        const open = main.indexOf('{', start);
        for (let i = open; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) return main.slice(open + 1, i);
            }
        }
        return main.slice(open + 1);
    }

    it('openMobileDrawer opens the drawer and makes #sidebarOverlay visible', () => {
        const fn = body('openMobileDrawer');
        expect(fn).toMatch(/main1\.classList\.add\(\s*['"]sidebar-open['"]\s*\)/);
        expect(fn).toMatch(/sidebarOverlay\.classList\.add\(\s*['"]visible['"]\s*\)/);
    });

    it('the mobile pill still routes through openMobileDrawer', () => {
        expect(body('activateProjectPicker')).toMatch(/openMobileDrawer\(\)/);
    });
});
