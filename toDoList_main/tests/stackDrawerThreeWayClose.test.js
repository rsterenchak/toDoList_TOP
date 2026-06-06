import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the three-way close vocabulary on the projects drawer (CLAUDE.md
// modal rule + STACK acceptance criterion). The drawer must close on:
//   1. tapping an explicit close (×) button
//   2. tapping the backdrop overlay
//   3. pressing Escape
// As of D1b the sidebar is an overlay drawer at EVERY breakpoint (the
// persistent desktop rail/column was retired), so the close vocabulary —
// including the X button and the Escape handler — is no longer mobile-gated.
describe('STACK projects drawer — three-way close vocabulary', () => {
    const main = read('main.js');
    const css  = read('style.css');

    it('mounts an X close button inside the drawer header', () => {
        expect(main).toMatch(/mobileSidebarClose\.id\s*=\s*['"]mobileSidebarClose['"]/);
        // Close button lives inside #sideTit (the drawer header) so
        // it sits at the top of the drawer regardless of scroll.
        expect(main).toMatch(/sideTitle\.appendChild\(mobileSidebarClose\)/);
        // aria-label is required since the visible glyph (×) isn't a
        // semantic close affordance for screen readers on its own.
        expect(main).toMatch(/mobileSidebarClose\.setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]Close projects drawer['"]/);
    });

    it('X-button click calls closeSidebar', () => {
        const start = main.indexOf("mobileSidebarClose.addEventListener('click'");
        expect(start).toBeGreaterThan(-1);
        const slice = main.slice(start, start + 240);
        expect(slice).toMatch(/closeSidebar\(\s*\)/);
    });

    it('backdrop tap still calls closeSidebar (regression guard)', () => {
        // Pre-existing behavior — locked here so the STACK rework
        // doesn't accidentally drop the backdrop leg.
        expect(main).toMatch(/sidebarOverlay\.addEventListener\(\s*['"]click['"]\s*,\s*closeSidebar\s*\)/);
    });

    // Locate the capture-phase Escape handler dedicated to the drawer
    // (distinct from the popover/bottom-sheet Escape handlers). It is
    // identified by reading sidebarIsOpen() and calling closeSidebar().
    function findDrawerEscapeHandler() {
        const blocks = main.match(/document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function[\s\S]*?\}\s*,\s*true\s*\)\s*;/g) || [];
        return blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]Escape['"]/.test(b)
                && /sidebarIsOpen\(\)/.test(b)
                && /closeSidebar\(\s*\)/.test(b);
        });
    }

    it('Escape closes the drawer when it is open', () => {
        const handler = findDrawerEscapeHandler();
        expect(handler).toBeTruthy();
        expect(handler).toMatch(/closeSidebar\(\s*\)/);
    });

    it('Escape handler bails when another modal/popover already owns the keystroke', () => {
        const handler = findDrawerEscapeHandler();
        expect(handler).toMatch(/isAnyModalOrPopoverOpen/);
    });

    it('Escape handler is NOT gated on viewport — the drawer exists at all breakpoints', () => {
        // D1b unified the drawer across desktop and mobile, so the old
        // `if (!isMobile()) return;` desktop bail must be gone: Escape now
        // closes the drawer at every width.
        const handler = findDrawerEscapeHandler();
        expect(handler).toBeTruthy();
        expect(handler).not.toMatch(/!\s*isMobile\(\)/);
        expect(handler).not.toMatch(/isMobile\(\)/);
    });

    it('X button is visible at desktop sizes (not hidden)', () => {
        // The drawer — and therefore its X close affordance — renders at all
        // breakpoints now, so no rule may set the button to display:none.
        expect(css).not.toMatch(/#mobileSidebarClose\s*\{\s*display:\s*none/);
        // It is positioned and shown inside a desktop media query.
        expect(css).toMatch(/@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#mobileSidebarClose\s*\{[\s\S]*?display:\s*inline-flex/);
    });
});
