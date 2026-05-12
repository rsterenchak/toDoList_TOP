import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile drawer reorganization: the drawer slides in from
// the RIGHT at 78vw width and reads top-to-bottom as
//   Projects → View → Appearance → footer
// The View / Appearance toggle rows mirror controls that already live in
// the desktop chrome (settings menu, completed-section caret, bulk desc
// toggle); no new persisted state is introduced — the underlying
// pref/state functions are shared. Selecting a project from the drawer
// keeps it open (browse-and-decide).
describe('STACK mobile drawer — reorganized sections', () => {
    const main = read('main.js');
    const css  = read('style.css');

    describe('drawer slide direction and width', () => {
        it('mobile drawer slides in from the right via translateX(100%)', () => {
            const mobileBlock = css.match(/@media \(max-width:\s*700px\)\s*\{[\s\S]*?\n\}/);
            expect(mobileBlock).toBeTruthy();
            const block = mobileBlock[0];
            // Anchored to the right edge with translateX(100%) for the
            // closed state — flipped from the previous left-anchored
            // translateX(-100%) layout.
            expect(block).toMatch(/#sideBar\s*\{[\s\S]*?right:\s*0[\s\S]*?transform:\s*translateX\(100%\)/);
            // Open state lands the drawer at translateX(0).
            expect(block).toMatch(/#sideBar\.sidebar-open\s*\{[\s\S]*?transform:\s*translateX\(0\)/);
        });

        it('mobile drawer width is ~78vw (capped so it doesn\'t dwarf STACK content)', () => {
            const mobileBlock = css.match(/@media \(max-width:\s*700px\)\s*\{[\s\S]*?\n\}/);
            expect(mobileBlock).toBeTruthy();
            const block = mobileBlock[0];
            expect(block).toMatch(/#sideBar\s*\{[\s\S]*?width:\s*78vw/);
            expect(block).toMatch(/#sideBar\s*\{[\s\S]*?max-width:\s*380px/);
        });
    });

    describe('drawer section structure', () => {
        it('mounts a View section with the View heading', () => {
            expect(main).toMatch(/drawerView\.id\s*=\s*['"]drawerView['"]/);
            expect(main).toMatch(/drawerViewHeading\.textContent\s*=\s*['"]View['"]/);
            // The drawer sections live inside the #sidebarBottom wrapper
            // (added so the projects group can bottom-anchor to the
            // sidebar midpoint on mobile) which is itself appended to
            // #sideBar, so the section still mounts into the drawer.
            expect(main).toMatch(/sidebarBottom\.appendChild\(drawerView\)/);
            expect(main).toMatch(/main1\.appendChild\(sidebarBottom\)/);
        });

        it('mounts an Appearance section with the Appearance heading', () => {
            expect(main).toMatch(/drawerAppearance\.id\s*=\s*['"]drawerAppearance['"]/);
            expect(main).toMatch(/drawerAppearanceHeading\.textContent\s*=\s*['"]Appearance['"]/);
            expect(main).toMatch(/sidebarBottom\.appendChild\(drawerAppearance\)/);
        });

        it('mounts a footer with version label and project count', () => {
            expect(main).toMatch(/drawerFooter\.id\s*=\s*['"]drawerFooter['"]/);
            expect(main).toMatch(/drawerFooterVersion\.id\s*=\s*['"]drawerFooterVersion['"]/);
            expect(main).toMatch(/drawerFooterCount\.id\s*=\s*['"]drawerFooterCount['"]/);
            expect(main).toMatch(/sidebarBottom\.appendChild\(drawerFooter\)/);
        });

        it('mounts the sections in order: View → Appearance → Footer', () => {
            const viewIdx       = main.indexOf('sidebarBottom.appendChild(drawerView)');
            const appearanceIdx = main.indexOf('sidebarBottom.appendChild(drawerAppearance)');
            const footerIdx     = main.indexOf('sidebarBottom.appendChild(drawerFooter)');
            expect(viewIdx).toBeGreaterThan(-1);
            expect(appearanceIdx).toBeGreaterThan(viewIdx);
            expect(footerIdx).toBeGreaterThan(appearanceIdx);
        });
    });

    describe('View section toggles mirror existing controls', () => {
        it('Show completed toggle reads/writes the same pref the in-list caret uses', () => {
            // The label is the user-facing copy; the underlying state
            // routes through isCompletedSectionOpen / setCompletedSectionOpen
            // so the drawer toggle and the in-list caret stay in lockstep.
            expect(main).toMatch(/createDrawerToggleRow\(\s*['"]Show completed['"]/);
            // Prefer the in-list caret's click when mounted so its caret
            // glyph + aria-expanded flip alongside the pref write.
            expect(main).toMatch(/getElementById\(['"]completedHeader['"]\)/);
        });

        it('Expand all descriptions toggle dispatches through the bulkDesc button', () => {
            expect(main).toMatch(/createDrawerToggleRow\(\s*['"]Expand all descriptions['"]/);
            // Routing through the button's click keeps the .expanded class
            // and Expand/Collapse label flip in one place rather than
            // duplicating that logic at the drawer site.
            const expandBlockStart = main.indexOf("'Expand all descriptions'");
            expect(expandBlockStart).toBeGreaterThan(-1);
            const slice = main.slice(expandBlockStart, expandBlockStart + 400);
            expect(slice).toMatch(/bulkDescToggleBtn\.click\(\s*\)/);
        });
    });

    describe('Appearance section toggles mirror existing settings menu items', () => {
        it('Dark theme toggle uses the same applyTheme + localStorage write as the settings menu', () => {
            expect(main).toMatch(/createDrawerToggleRow\(\s*['"]Dark theme['"]/);
            const themeBlockStart = main.indexOf("'Dark theme'");
            expect(themeBlockStart).toBeGreaterThan(-1);
            const slice = main.slice(themeBlockStart, themeBlockStart + 600);
            expect(slice).toMatch(/applyTheme\(/);
            expect(slice).toMatch(/THEME_KEY/);
            expect(slice).toMatch(/theme-transitioning/);
        });

        it('Companion ghost toggle dispatches setCompanionEnabled + ensure/destroy', () => {
            expect(main).toMatch(/createDrawerToggleRow\(\s*['"]Companion ghost['"]/);
            const compBlockStart = main.indexOf("'Companion ghost'");
            expect(compBlockStart).toBeGreaterThan(-1);
            const slice = main.slice(compBlockStart, compBlockStart + 500);
            expect(slice).toMatch(/setCompanionEnabled\(/);
            expect(slice).toMatch(/ensureCompanion\(\s*\)/);
            expect(slice).toMatch(/destroyCompanion\(\s*\)/);
        });
    });

    describe('drawer state stays in sync with the rest of the chrome', () => {
        it('openSidebar refreshes the drawer mirrors before it slides in', () => {
            const openIdx = main.indexOf('function openSidebar()');
            expect(openIdx).toBeGreaterThan(-1);
            // Match the function body up to the next top-level closing brace.
            const slice = main.slice(openIdx, openIdx + 800);
            expect(slice).toMatch(/refreshDrawerSections\(\s*\)/);
            expect(slice).toMatch(/sidebar-open/);
        });

        it('refreshDrawerSections re-reads every toggle\'s state and the project count', () => {
            const fnIdx = main.indexOf('function refreshDrawerSections()');
            expect(fnIdx).toBeGreaterThan(-1);
            const slice = main.slice(fnIdx, fnIdx + 400);
            expect(slice).toMatch(/drawerShowCompleted\.refresh\(\s*\)/);
            expect(slice).toMatch(/drawerExpandAll\.refresh\(\s*\)/);
            expect(slice).toMatch(/drawerTheme\.refresh\(\s*\)/);
            expect(slice).toMatch(/drawerCompanion\.refresh\(\s*\)/);
            expect(slice).toMatch(/refreshDrawerProjectCount\(\s*\)/);
        });

        it('project count helper reads from listLogic (authoritative source)', () => {
            const fnIdx = main.indexOf('function refreshDrawerProjectCount()');
            expect(fnIdx).toBeGreaterThan(-1);
            const slice = main.slice(fnIdx, fnIdx + 400);
            expect(slice).toMatch(/listLogic\.listProjectsArray\(\s*\)\.length/);
            expect(slice).toMatch(/drawerFooterCount\.textContent/);
        });
    });

    describe('browse-and-decide: project tap keeps the drawer open', () => {
        it('does not auto-close the drawer when a project row is tapped on coarse pointer', () => {
            // Regression guard: the previous mobile drawer auto-closed on
            // any projChild tap. STACK explicitly preserves the drawer-open
            // state so the user can tap between projects to compare.
            expect(main).not.toMatch(/matchMedia\(['"]\(pointer: coarse\)['"]\)\.matches[\s\S]{0,400}?closeSidebar\(\s*\)/);
        });
    });

    describe('desktop hides the new drawer-only chrome', () => {
        it('drawer sections are hidden at desktop sizes', () => {
            const desktop = css.match(/@media \(min-width:\s*701px\)\s*\{[\s\S]*?\n\}/g) || [];
            const hidesDrawer = desktop.find(function(block) {
                return /#drawerView/.test(block)
                    && /#drawerAppearance/.test(block)
                    && /#drawerFooter/.test(block)
                    && /display:\s*none/.test(block);
            });
            expect(hidesDrawer).toBeTruthy();
        });
    });
});
