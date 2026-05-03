import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the projects sidebar icon rail. The full-width
// PROJECTS sidebar is replaced by a 54px icon rail whose chips show each
// project's first letter; the active chip wears the purple accent. The
// hamburger toggle moves out of the top nav and into the rail itself,
// where it switches between the rail and the full-named sidebar. A new
// breadcrumb in the main column surfaces the active project name + open
// count textually, since the rail itself only shows initials.
describe('projects sidebar — 54px icon rail', () => {
    const main = read('main.js');
    const prefs = read('prefs.js');
    const css = read('style.css');

    it('persists rail vs. full mode in localStorage under todoapp_sidebarRail', () => {
        expect(prefs).toMatch(/SIDEBAR_RAIL_KEY\s*=\s*['"]todoapp_sidebarRail['"]/);
        expect(prefs).toMatch(/export\s+function\s+isSidebarRailOn\s*\(/);
        expect(prefs).toMatch(/export\s+function\s+setSidebarRailOn\s*\(/);
    });

    it('defaults to rail mode when no preference is stored', () => {
        // The getter must treat "no key set" as rail-on so first-time users
        // land in the new design rather than the legacy full sidebar.
        const fnIdx = prefs.indexOf('function isSidebarRailOn');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = prefs.slice(fnIdx, fnIdx + 400);
        expect(body).toMatch(/===\s*null\s*\?\s*true/);
    });

    it('mirrors the rail pref onto <html data-sidebar-rail> before component()', () => {
        expect(main).toMatch(/function\s+applySidebarRail\s*\(/);
        expect(main).toMatch(/setAttribute\(\s*['"]data-sidebar-rail['"]/);
        // Called at module top-level so the first paint already reflects the
        // saved state — matches the pattern used by applyTheme/applyCompactTitles.
        expect(main).toMatch(/applySidebarRail\(\s*isSidebarRailOn\(\)\s*\)/);
    });

    it('moves the hamburger out of the nav bar and into the sidebar header', () => {
        // The hamburger now anchors to the rail it controls.
        expect(main).not.toMatch(/nav\.appendChild\(\s*sidebarToggle\s*\)/);
        expect(main).toMatch(/sideTitle\.appendChild\(\s*sidebarToggle\s*\)/);
    });

    it('places the add-project button at the bottom of the sidebar column', () => {
        // addProj is the last flex child of #sideBar so it sits below the
        // scrollable project list (#sideMa).
        expect(main).toMatch(/main1\.appendChild\(\s*sideMain\s*\)[\s\S]{0,200}main1\.appendChild\(\s*addProj\s*\)/);
        // It is no longer nested inside #sideTit.
        expect(main).not.toMatch(/sideTitle\.appendChild\(\s*addProj\s*\)/);
    });

    it('hamburger toggles rail vs. full mode on desktop, drawer on mobile', () => {
        const handlerIdx = main.indexOf("sidebarToggle.addEventListener('click'");
        expect(handlerIdx).toBeGreaterThan(-1);
        const handler = main.slice(handlerIdx, handlerIdx + 600);
        // Mobile path stays on the existing drawer behavior.
        expect(handler).toMatch(/isMobile\s*\(\s*\)/);
        expect(handler).toMatch(/closeSidebar|openSidebar/);
        // Desktop path flips the rail pref and re-applies it.
        expect(handler).toMatch(/setSidebarRailOn\s*\(/);
        expect(handler).toMatch(/applySidebarRail\s*\(/);
    });

    it('writes the project initial onto each row via applyProjectInitial', () => {
        // Single helper used by both the new-project commit and restore
        // paths so the rail chip and tooltip stay in sync with the name.
        expect(main).toMatch(/function\s+applyProjectInitial\s*\(/);
        expect(main).toMatch(/setAttribute\(\s*['"]data-initial['"]/);
        expect(main).toMatch(/setAttribute\(\s*['"]data-project-name['"]/);
        // Called from the restore loop and the new-project commit branch.
        const calls = (main.match(/applyProjectInitial\s*\(/g) || []).length;
        expect(calls).toBeGreaterThanOrEqual(3);
    });

    it('renders the active project name + open count in a main-column breadcrumb', () => {
        expect(main).toMatch(/mainCrumb\.id\s*=\s*['"]mainCrumb['"]/);
        expect(main).toMatch(/mainCrumbName\.id\s*=\s*['"]mainCrumbName['"]/);
        expect(main).toMatch(/mainCrumbCount\.id\s*=\s*['"]mainCrumbCount['"]/);
        // The breadcrumb is wired into the existing footer-counts updater so
        // it tracks both project selection and todo add/remove/complete.
        const fnIdx = main.indexOf('function updateFooterCounts');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = main.slice(fnIdx, main.indexOf('}', fnIdx + 600) + 1);
        expect(body).toMatch(/mainCrumbName\.textContent/);
        expect(body).toMatch(/mainCrumbCount\.textContent/);
        expect(body).toMatch(/open\s*\+\s*['"] open['"]|['"] open['"]\s*\+|open\s*\+\s*['"] open/);
    });

    it('locks the rail track to 54px and hides the resizer when rail is on', () => {
        expect(css).toMatch(/--rail-w:\s*54px/);
        expect(css).toMatch(/html\[data-sidebar-rail="on"\]\s+#mainSec[\s\S]*grid-template-columns:\s*var\(--rail-w\)/);
        expect(css).toMatch(/html\[data-sidebar-rail="on"\]\s+#sidebarResizer[\s\S]*pointer-events:\s*none/);
    });

    it('renders 34px chips with the data-initial as the visible label', () => {
        expect(css).toMatch(/--rail-chip:\s*34px/);
        expect(css).toMatch(/html\[data-sidebar-rail="on"\]\s+#projChild[\s\S]*width:\s*var\(--rail-chip\)[\s\S]*height:\s*var\(--rail-chip\)/);
        expect(css).toMatch(/html\[data-sidebar-rail="on"\]\s+#projChild::after[\s\S]*content:\s*attr\(data-initial\)/);
        // The selected chip wears the purple accent on bg + border + text.
        expect(css).toMatch(/html\[data-sidebar-rail="on"\]\s+#projChild\.selectedProject[\s\S]*background:\s*var\(--proj-accent[\s\S]*color:\s*#ffffff/);
    });

    it('gives the rail-mode add-project button a dashed border', () => {
        expect(css).toMatch(/html\[data-sidebar-rail="on"\]\s+#projButton[\s\S]*border:\s*1px\s+dashed/);
    });

    it('shows a hover tooltip with the full name after a 300ms delay', () => {
        // Custom CSS-only tooltip — the visible-state transition delay
        // realizes the ~300ms hover hold described in the spec.
        expect(css).toMatch(/html\[data-sidebar-rail="on"\]\s+#projChild::before[\s\S]*content:\s*attr\(data-project-name\)/);
        expect(css).toMatch(/html\[data-sidebar-rail="on"\]\s+#projChild:hover::before[\s\S]*transition-delay:\s*300ms/);
    });
});
