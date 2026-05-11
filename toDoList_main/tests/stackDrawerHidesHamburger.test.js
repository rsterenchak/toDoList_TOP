import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the rule that hides #sidebarToggle while the mobile drawer is
// open. Without this, the hamburger paints on top of the drawer's
// surface in the top-right corner — stacking it with the drawer's own
// X close button. The drawer's three-way close vocabulary (X button,
// backdrop, Escape) is unaffected; this is purely a visual rule.
describe('STACK mobile drawer — hides hamburger toggle while open', () => {
    const css = read('style.css');

    function mobileBlock() {
        const media = css.indexOf('@media (max-width: 700px)');
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

    it('hides #sidebarToggle when #sideBar.sidebar-open is present', () => {
        const block = mobileBlock();
        // The :has() selector lets the rule live in CSS alone — no JS
        // change required to toggle a body class on open/close.
        expect(block).toMatch(
            /body:has\(\s*#sideBar\.sidebar-open\s*\)\s*#sidebarToggle\s*\{[^}]*display:\s*none/
        );
    });

    it('rule lives inside the ≤700px breakpoint (desktop layout untouched)', () => {
        // Confirm the rule does not leak outside the mobile media query
        // — desktop 701px+ keeps the persistent rail and never hides the
        // toggle.
        const fullMatches = css.match(/body:has\(\s*#sideBar\.sidebar-open\s*\)\s*#sidebarToggle/g) || [];
        const mobileMatches = mobileBlock().match(/body:has\(\s*#sideBar\.sidebar-open\s*\)\s*#sidebarToggle/g) || [];
        expect(fullMatches.length).toBe(mobileMatches.length);
        expect(mobileMatches.length).toBeGreaterThanOrEqual(1);
    });
});
