import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the TODAY-view auto-collapse / PROJECTS-view
// auto-expand of the desktop projects sidebar.
//
// When the active top-level view becomes TODAY, the projects sidebar
// collapses to the 54px icon rail (the dashboard owns the main panel
// and the project list is just navigation chrome at that point). When
// the view becomes PROJECTS, the sidebar re-expands to the full
// named-project sidebar. The hamburger remains a manual override within
// the current view — auto-collapse only fires when the view actually
// changes, so a user who opened the sidebar on TODAY keeps it open
// until they switch views or click the hamburger again. Mobile is
// excluded: the rail is a desktop-and-up affordance and the mobile
// drawer is already hidden by default.
describe('view switch — auto-collapse sidebar on TODAY, auto-expand on PROJECTS', () => {
    const main = read('main.js');

    function extractFn(name) {
        const idx = main.indexOf('function ' + name);
        expect(idx).toBeGreaterThan(-1);
        const braceStart = main.indexOf('{', idx);
        let depth = 0;
        for (let i = braceStart; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) return main.slice(braceStart, i + 1);
            }
        }
        throw new Error('unterminated ' + name + ' body');
    }

    describe('applyViewDefaultSidebar helper', () => {
        const body = extractFn('applyViewDefaultSidebar');

        it('bails on mobile so the drawer behavior stays untouched', () => {
            // Mobile drawer already hides by default — touching the rail
            // pref there would change unrelated behavior. The <1024px guard
            // matches the rest of the codebase's isMobile() definition.
            expect(body).toMatch(/innerWidth\s*<\s*1024/);
        });

        it("collapses to the icon rail when the view is anything other than 'projects'", () => {
            // wantRail is true unless the view is explicitly 'projects',
            // so a stray view token still defaults to the dashboard layout.
            expect(body).toMatch(/!==\s*['"]projects['"]/);
            expect(body).toMatch(/setSidebarRailOn\(/);
            expect(body).toMatch(/applySidebarRail\(/);
        });

        it('is a no-op when the rail pref already matches the desired state', () => {
            // Avoids redundant DOM/localStorage writes when the user is
            // already on the right rail state for the incoming view.
            expect(body).toMatch(/isSidebarRailOn\(\)\s*!==\s*wantRail/);
        });
    });

    describe('applyActiveView wiring', () => {
        const body = extractFn('applyActiveView');

        it('captures the previous view before persisting the new one', () => {
            // The view-change guard needs the old value, so getActiveView()
            // must be read before setActiveView() overwrites it.
            const prevIdx = body.indexOf('getActiveView');
            const setIdx  = body.indexOf('setActiveView');
            expect(prevIdx).toBeGreaterThan(-1);
            expect(setIdx).toBeGreaterThan(prevIdx);
        });

        it('only fires the sidebar default when the view actually changed', () => {
            // Guard exists so calling applyActiveView with the same view
            // (e.g., user clicks the already-active pill) does not clobber
            // a manual hamburger override.
            expect(body).toMatch(/prevView\s*!==\s*safe[\s\S]{0,200}applyViewDefaultSidebar/);
        });
    });

    describe('restoreFromStorage initial-load default', () => {
        it('applies the view-default sidebar on both restore paths', () => {
            // Two callsites mirror the two applyActiveView(getActiveView())
            // callsites: the empty-projects early-exit and the populated
            // tail. Initial load must honor the saved view's default rail
            // state regardless of what isSidebarRailOn() returns.
            const calls = main.match(/applyViewDefaultSidebar\(\s*getActiveView\(\)\s*\)/g) || [];
            expect(calls.length).toBeGreaterThanOrEqual(2);
        });
    });
});
