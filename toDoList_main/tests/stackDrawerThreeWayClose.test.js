import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the three-way close vocabulary on the mobile drawer (CLAUDE.md
// modal rule + STACK acceptance criterion). The drawer must close on:
//   1. tapping an explicit close (×) button
//   2. tapping the backdrop overlay
//   3. pressing Escape
// (1) and (3) are net-new in the STACK foundation; (2) was already wired
// via #sidebarOverlay's click listener — we just lock it down here so a
// future refactor can't remove a leg of the vocabulary unnoticed.
describe('STACK mobile drawer — three-way close vocabulary', () => {
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

    it('Escape closes the drawer when open on mobile', () => {
        // Locate the Escape handler dedicated to the drawer (distinct
        // from the popover-specific Escape handlers that pre-date STACK).
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"][\s\S]*?\}\s*,\s*true\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]Escape['"]/.test(b)
                && /isMobile\(\)/.test(b)
                && /sidebarIsOpen\(\)/.test(b);
        });
        expect(handler).toBeTruthy();
        expect(handler).toMatch(/closeSidebar\(\s*\)/);
    });

    it('Escape handler bails when another modal/popover already owns the keystroke', () => {
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"][\s\S]*?\}\s*,\s*true\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]Escape['"]/.test(b)
                && /isMobile\(\)/.test(b)
                && /sidebarIsOpen\(\)/.test(b);
        });
        expect(handler).toMatch(/isAnyModalOrPopoverOpen/);
    });

    it('Escape handler bails on desktop (sidebar is a persistent rail there)', () => {
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"][\s\S]*?\}\s*,\s*true\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]Escape['"]/.test(b)
                && /isMobile\(\)/.test(b)
                && /sidebarIsOpen\(\)/.test(b);
        });
        expect(handler).toMatch(/!\s*isMobile\(\)/);
    });

    it('mobile X button is hidden at desktop sizes', () => {
        const desktop = css.match(/@media \(min-width:\s*1024px\)\s*\{[\s\S]*?#mobileSidebarClose\s*\{\s*display:\s*none/);
        expect(desktop).toBeTruthy();
    });
});
