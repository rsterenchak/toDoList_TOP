import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the D1b contract: at desktop widths (>=1024px) the projects sidebar
// is a slide-in overlay drawer (same presentation as mobile), NOT a
// persistent left column or icon rail. The rail / resizer / auto-collapse
// machinery is retired. Verified via source inspection because main.js is
// too large to instantiate in jsdom (per CLAUDE.md guidance).
describe('D1b — desktop sidebar is a slide-in drawer', () => {
    const main = read('main.js');
    const css = read('style.css');
    const prefs = read('prefs.js');

    it('(a) #sideBar is position:fixed at desktop widths (an overlay drawer)', () => {
        // A min-width:1024 block must declare #sideBar as a fixed overlay,
        // translated off-screen by default and slid in via .sidebar-open.
        expect(css).toMatch(/@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#sideBar\s*\{[\s\S]*?position:\s*fixed/);
        expect(css).toMatch(/@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#sideBar\s*\{[\s\S]*?transform:\s*translateX\(100%\)/);
        expect(css).toMatch(/#sideBar\.sidebar-open\s*\{\s*transform:\s*translateX\(0\)/);
    });

    it('(b) the X close button (#mobileSidebarClose) is visible at desktop (not display:none)', () => {
        expect(css).not.toMatch(/#mobileSidebarClose\s*\{\s*display:\s*none/);
        expect(css).toMatch(/@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#mobileSidebarClose\s*\{[\s\S]*?display:\s*inline-flex/);
    });

    it('(c) the drawer Escape handler has no isMobile() gating', () => {
        const blocks = main.match(/document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function[\s\S]*?\}\s*,\s*true\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]Escape['"]/.test(b)
                && /sidebarIsOpen\(\)/.test(b)
                && /closeSidebar\(\s*\)/.test(b);
        });
        expect(handler).toBeTruthy();
        expect(handler).not.toMatch(/isMobile\(\)/);
    });

    it('(d) Ctrl+Backspace routes through sidebarToggle.click() with no viewport branch', () => {
        const blocks = main.match(/document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function[\s\S]*?\}\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]Backspace['"]/.test(b) && /ctrlKey/.test(b);
        });
        expect(handler).toBeTruthy();
        expect(handler).toMatch(/sidebarToggle\.click\(\s*\)/);
        // No rail/desktop branching — the click handler does the right thing
        // at every breakpoint.
        expect(handler).not.toMatch(/isMobile\(\)/);
    });

    it('(e) prefs.js no longer exports the rail preference accessors', () => {
        expect(prefs).not.toMatch(/isSidebarRailOn/);
        expect(prefs).not.toMatch(/setSidebarRailOn/);
        expect(prefs).not.toMatch(/SIDEBAR_RAIL_KEY/);
    });

    it('(f) the main content area reserves no room for a persistent sidebar', () => {
        // #mainSec is a single full-width column (the drawer is out of flow),
        // so there is no sidebar grid track and no margin/padding offset.
        const idx = css.indexOf('#mainSec {');
        expect(idx).toBeGreaterThan(-1);
        const rule = css.slice(idx, css.indexOf('}', idx) + 1);
        expect(rule).toMatch(/grid-template-columns:\s*1fr/);
        expect(rule).not.toMatch(/var\(--sidebar-w\)/);
        expect(rule).not.toMatch(/margin-left/);
        expect(rule).not.toMatch(/padding-left/);
    });

    it('retires the rail / resizer / auto-collapse machinery in main.js', () => {
        expect(main).not.toMatch(/applySidebarRail/);
        expect(main).not.toMatch(/isSidebarRailOn/);
        expect(main).not.toMatch(/setSidebarRailOn/);
        expect(main).not.toMatch(/applyViewDefaultSidebar/);
        expect(main).not.toMatch(/sidebarResizer/);
        expect(main).not.toMatch(/data-sidebar-rail/);
    });

    it('retires the rail / resizer CSS', () => {
        expect(css).not.toMatch(/data-sidebar-rail/);
        expect(css).not.toMatch(/#sidebarResizer/);
        expect(css).not.toMatch(/--rail-w/);
        expect(css).not.toMatch(/--rail-chip/);
        expect(css).not.toMatch(/sidebar-collapsed/);
    });

    it('drops the stale todoapp_sidebarRail key on load', () => {
        expect(main).toMatch(/removeItem\(\s*['"]todoapp_sidebarRail['"]\s*\)/);
    });
});
