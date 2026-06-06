import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The hamburger (#sidebarToggle) is now hidden on mobile outright — it
// opened the same drawer as tapping the project name + ▾ chevron, so it was
// pure redundancy. That unconditional hide subsumes the old "hide the
// hamburger only while the drawer is open" rule (which existed so the
// hamburger wouldn't paint over the open drawer's X close button). This
// file pins that the unconditional mobile hide is in place and that the
// now-obsolete drawer-open-gated rule has been removed.
describe('STACK mobile drawer — hamburger hidden on mobile', () => {
    const css = read('style.css');

    function mobileBlock() {
        const media = css.indexOf('@media (max-width: 1023px)');
        expect(media).toBeGreaterThan(-1);
        let depth = 0;
        let end = css.length;
        for (let i = css.indexOf('{', media); i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        return css.slice(media, end);
    }

    it('hides #sidebarToggle unconditionally at the mobile breakpoint', () => {
        const block = mobileBlock().replace(/\/\*[\s\S]*?\*\//g, '');
        expect(block).toMatch(/#sidebarToggle\s*\{\s*display:\s*none;?\s*\}/);
    });

    it('drops the now-obsolete drawer-open-gated hamburger hide rule', () => {
        // With the hamburger hidden on mobile outright, a rule gated on
        // #sideBar.sidebar-open is redundant and must not linger.
        expect(css).not.toMatch(/body:has\(\s*#sideBar\.sidebar-open\s*\)\s*#sidebarToggle/);
    });
});
