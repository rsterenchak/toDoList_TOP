import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the removal of the redundant hamburger (☰ / #sidebarToggle) from the
// compressed mobile header. The hamburger opened the same drawer as tapping
// the project name + ▾ chevron, so on mobile it is pure redundancy and is
// hidden at the ≤1023px breakpoint. The element itself stays in the DOM
// because the SAME #sidebarToggle is the desktop sidebar-rail toggle (and is
// driven by the Ctrl+Backspace shortcut) — so desktop must be untouched and
// the project-name tap must remain the single mobile menu affordance.
// Verified through source inspection because main.js is too large to
// instantiate in jsdom (per CLAUDE.md guidance).
describe('Hamburger removed from the compressed mobile header', () => {
    const css = read('style.css');
    const main = read('main.js');

    // Split the stylesheet at the first mobile media query so desktop rules
    // (above) and mobile rules (below) can be asserted independently.
    function mobileCss() {
        const start = css.indexOf('@media (max-width: 1023px)');
        expect(start).toBeGreaterThan(-1);
        return css.slice(start);
    }
    function desktopCss() {
        const start = css.indexOf('@media (max-width: 1023px)');
        expect(start).toBeGreaterThan(-1);
        return css.slice(0, start);
    }

    it('hides the hamburger at the mobile breakpoint', () => {
        // The mobile #sidebarToggle rule resolves to display:none — the
        // affordance is gone from the compressed header.
        expect(mobileCss()).toMatch(/#sidebarToggle\s*\{\s*display:\s*none;?\s*\}/);
    });

    it('drops the old absolute-anchored mobile hamburger positioning', () => {
        // The former mobile rule absolute-positioned the hamburger at the
        // top-right (position:absolute; right:12px; 44×44). With the button
        // hidden, that positioning is dead and must not linger.
        expect(mobileCss()).not.toMatch(/#sidebarToggle\s*\{[^}]*position:\s*absolute/);
        expect(mobileCss()).not.toMatch(/#sidebarToggle\s*\{[^}]*right:\s*12px/);
    });

    it('removes the now-redundant drawer-open hide rule', () => {
        // Hiding the hamburger only while the drawer was open is redundant
        // once it is hidden unconditionally on mobile.
        expect(css).not.toMatch(/body:has\(#sideBar\.sidebar-open\)\s*#sidebarToggle/);
    });

    it('leaves the desktop hamburger styling untouched', () => {
        // The desktop sidebar-rail toggle keeps its full 36×36 flex styling
        // above the mobile breakpoint — desktop layout is unchanged.
        expect(desktopCss()).toMatch(/#sidebarToggle\s*\{[^}]*width:\s*36px/);
        // The element is still created and wired in main.js (it remains the
        // desktop rail toggle), so the markup is NOT removed.
        expect(main).toMatch(/sidebarToggle\.innerHTML\s*=\s*['"]☰['"]/);
    });

    it('keeps the project name + chevron as the mobile menu affordance', () => {
        // Tapping the title or the ▾ chevron must still open the mobile
        // drawer after the hamburger is gone (regression check). The tap now
        // routes through activateProjectPicker, which opens the drawer below
        // the 1024px breakpoint.
        expect(main).toMatch(/mobileProjName\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
        expect(main).toMatch(/mobileProjChevron\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
        // And the mobile branch of activateProjectPicker opens the drawer.
        expect(main).toMatch(/function activateProjectPicker\(\)\s*\{[\s\S]*?openMobileDrawer\(\)/);
    });
});
