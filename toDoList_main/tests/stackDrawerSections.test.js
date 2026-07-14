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
//   Projects → Settings button → footer
// The previous inline View / Appearance toggle rows now live behind a
// single Settings button at the bottom of #sidebarBottom that opens a
// modal. Each toggle preserves its underlying state source (the in-list
// completed caret, the bulkDesc toggle, theme prefs, companion prefs) —
// no new persisted state is introduced. Selecting a project from the
// drawer still keeps it open (browse-and-decide).
describe('STACK mobile drawer — Settings entry + modal', () => {
    const main = read('main.js');
    const css  = read('style.css');

    describe('drawer slide direction and width', () => {
        it('mobile drawer slides in from the right via translateX(100%)', () => {
            const mobileBlock = css.match(/@media \(max-width:\s*1023px\)\s*\{[\s\S]*?\n\}/);
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
            const mobileBlock = css.match(/@media \(max-width:\s*1023px\)\s*\{[\s\S]*?\n\}/);
            expect(mobileBlock).toBeTruthy();
            const block = mobileBlock[0];
            expect(block).toMatch(/#sideBar\s*\{[\s\S]*?width:\s*78vw/);
            expect(block).toMatch(/#sideBar\s*\{[\s\S]*?max-width:\s*380px/);
        });
    });

    describe('drawer bottom structure', () => {
        it('mounts a Settings button inside #sidebarBottom (via a centering wrap)', () => {
            expect(main).toMatch(/drawerSettingsBtn\.id\s*=\s*['"]drawerSettingsBtn['"]/);
            // The button's text content lives in a dedicated label span so a
            // sibling sync-state badge can also be appended to the button
            // without disturbing the centered label layout.
            expect(main).toMatch(/drawerSettingsBtnLabel\.textContent\s*=\s*['"]Settings['"]/);
            expect(main).toMatch(/drawerSettingsBtn\.appendChild\(drawerSettingsBtnLabel\)/);
            expect(main).toMatch(/drawerSettingsBtnWrap\.id\s*=\s*['"]drawerSettingsBtnWrap['"]/);
            expect(main).toMatch(/drawerSettingsBtnWrap\.appendChild\(drawerSettingsBtn\)/);
            expect(main).toMatch(/sidebarBottom\.appendChild\(drawerSettingsBtnWrap\)/);
            expect(main).toMatch(/main1\.appendChild\(sidebarBottom\)/);
        });

        it('mounts a footer with version label and project count', () => {
            expect(main).toMatch(/drawerFooter\.id\s*=\s*['"]drawerFooter['"]/);
            expect(main).toMatch(/drawerFooterVersion\.id\s*=\s*['"]drawerFooterVersion['"]/);
            expect(main).toMatch(/drawerFooterCount\.id\s*=\s*['"]drawerFooterCount['"]/);
            expect(main).toMatch(/sidebarBottom\.appendChild\(drawerFooter\)/);
        });

        it('mounts the Settings button before the footer (Settings → Footer source order)', () => {
            const settingsIdx = main.indexOf('sidebarBottom.appendChild(drawerSettingsBtnWrap)');
            const footerIdx   = main.indexOf('sidebarBottom.appendChild(drawerFooter)');
            expect(settingsIdx).toBeGreaterThan(-1);
            expect(footerIdx).toBeGreaterThan(settingsIdx);
        });

        it('the previous inline drawer View / Appearance sections are no longer mounted', () => {
            // The four toggles moved into the Settings modal; the
            // always-visible drawerView / drawerAppearance wrappers
            // should not be appended to the drawer anymore.
            expect(main).not.toMatch(/sidebarBottom\.appendChild\(drawerView\)/);
            expect(main).not.toMatch(/sidebarBottom\.appendChild\(drawerAppearance\)/);
        });
    });

    describe('Settings modal hosts the four toggles under View / Appearance sub-headers', () => {
        it('Show completed toggle reads/writes the same pref the in-list caret uses', () => {
            // The label is the user-facing copy; the underlying state
            // routes through isCompletedSectionOpen / setCompletedSectionOpen
            // so the modal toggle and the in-list caret stay in lockstep.
            expect(main).toMatch(/createDrawerToggleRow\(\s*['"]Show completed['"]/);
            // Prefer the in-list caret's click when mounted so its caret
            // glyph + aria-expanded flip alongside the pref write.
            expect(main).toMatch(/getElementById\(['"]completedHeader['"]\)/);
        });

        it('Expand all descriptions toggle dispatches through the shared bulk-description toggle', () => {
            expect(main).toMatch(/createDrawerToggleRow\(\s*['"]Expand all descriptions['"]/);
            const expandBlockStart = main.indexOf("'Expand all descriptions'");
            expect(expandBlockStart).toBeGreaterThan(-1);
            const slice = main.slice(expandBlockStart, expandBlockStart + 400);
            expect(slice).toMatch(/toggleBulkDescriptions\(\s*\)/);
        });

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

        it('Settings modal groups toggles under View and Appearance sub-headers', () => {
            const showFnIdx = main.indexOf('function showSettingsModal()');
            expect(showFnIdx).toBeGreaterThan(-1);
            const slice = main.slice(showFnIdx, showFnIdx + 8000);
            expect(slice).toMatch(/viewHeading\.textContent\s*=\s*['"]View['"]/);
            expect(slice).toMatch(/appearanceHeading\.textContent\s*=\s*['"]Appearance['"]/);
            // All four toggle builders mount into the modal body.
            expect(slice).toMatch(/buildShowCompletedToggle\(\s*\)/);
            expect(slice).toMatch(/buildExpandAllToggle\(\s*\)/);
            expect(slice).toMatch(/buildDarkThemeToggle\(\s*\)/);
            expect(slice).toMatch(/buildCompanionToggle\(\s*\)/);
        });

        it('Settings button click opens the modal', () => {
            const start = main.indexOf("drawerSettingsBtn.addEventListener('click'");
            expect(start).toBeGreaterThan(-1);
            const slice = main.slice(start, start + 240);
            expect(slice).toMatch(/showSettingsModal\(\s*\)/);
        });
    });

    describe('Settings modal three-way close vocabulary (CLAUDE.md modal rule)', () => {
        const showFnIdx = main.indexOf('function showSettingsModal()');
        const fnSlice   = showFnIdx > -1 ? main.slice(showFnIdx, showFnIdx + 15000) : '';
        // The three-way close is now wired through the shared wireDismissable
        // helper rather than hand-rolled listeners inside showSettingsModal;
        // pull that call's options object out to assert what the modal delegates.
        const dismissCall = fnSlice.match(/wireDismissable\(\{[\s\S]*?\}\)/);
        const dismissOpts = dismissCall ? dismissCall[0] : '';

        it('explicit close (×) button is mounted and closes the modal', () => {
            expect(fnSlice).toMatch(/closeX\.id\s*=\s*['"]settingsModalClose['"]/);
            expect(dismissOpts).toMatch(/closeBtn:\s*closeX/);
        });

        it('backdrop click closes the modal', () => {
            expect(dismissOpts).toMatch(/backdrop:\s*backdrop/);
            // The helper implements the backdrop-target guard that closes only
            // on a click landing on the backdrop itself.
            expect(main).toMatch(/event\.target\s*===\s*backdrop[\s\S]*?close\(\s*\)/);
        });

        it('Escape closes the modal', () => {
            // Escape is implemented once in the shared helper; the modal opts in
            // by wiring itself through wireDismissable.
            expect(dismissOpts).not.toBe('');
            expect(main).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
            expect(main).toMatch(/document\.addEventListener\(\s*['"]keydown['"]/);
        });

        it('restores focus to the pre-open element on close', () => {
            expect(dismissOpts).toMatch(/restoreFocusTo:\s*previouslyFocused/);
        });

        it('settingsModalBackdrop participates in the global modal-open check', () => {
            const modals = read('modals.js');
            const fn = modals.match(/function isAnyModalOrPopoverOpen\(\)\s*\{[\s\S]*?\}/);
            expect(fn).toBeTruthy();
            expect(fn[0]).toMatch(/settingsModalBackdrop/);
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

        it('refreshDrawerSections refreshes the project count footer (toggle state is rebuilt per modal open)', () => {
            const fnIdx = main.indexOf('function refreshDrawerSections()');
            expect(fnIdx).toBeGreaterThan(-1);
            const slice = main.slice(fnIdx, fnIdx + 400);
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
        it('drawer Settings button and footer are hidden at desktop sizes', () => {
            const desktop = css.match(/@media \(min-width:\s*1024px\)\s*\{[\s\S]*?\n\}/g) || [];
            const hidesDrawer = desktop.find(function(block) {
                return /#drawerSettingsBtn/.test(block)
                    && /#drawerFooter/.test(block)
                    && /display:\s*none/.test(block);
            });
            expect(hidesDrawer).toBeTruthy();
        });

        it('the Settings button wrap is also hidden at desktop sizes', () => {
            const desktop = css.match(/@media \(min-width:\s*1024px\)\s*\{[\s\S]*?\n\}/g) || [];
            const hidesWrap = desktop.find(function(block) {
                return /#drawerSettingsBtnWrap/.test(block)
                    && /display:\s*none/.test(block);
            });
            expect(hidesWrap).toBeTruthy();
        });
    });

    describe('Settings button centers within the drawer bottom half on both axes', () => {
        it('#drawerSettingsBtnWrap is a flex container with center justify and center align on mobile', () => {
            const mobileBlock = css.match(/@media \(max-width:\s*1023px\)\s*\{[\s\S]*?\n\}/);
            expect(mobileBlock).toBeTruthy();
            const block = mobileBlock[0];
            const wrapRule = block.match(/#drawerSettingsBtnWrap\s*\{([^}]*)\}/);
            expect(wrapRule, 'expected a mobile rule for #drawerSettingsBtnWrap').not.toBeNull();
            const body = wrapRule[1];
            expect(body).toMatch(/display:\s*flex/);
            expect(body).toMatch(/justify-content:\s*center/);
            expect(body).toMatch(/align-items:\s*center/);
        });

        it('#drawerSettingsBtnWrap grows to fill the space above the footer so vertical centering has room', () => {
            const mobileBlock = css.match(/@media \(max-width:\s*1023px\)\s*\{[\s\S]*?\n\}/);
            expect(mobileBlock).toBeTruthy();
            const block = mobileBlock[0];
            const wrapRule = block.match(/#drawerSettingsBtnWrap\s*\{([^}]*)\}/);
            expect(wrapRule).not.toBeNull();
            // flex-grow on the wrap so it consumes the available height
            // above the footer (footer is flex-shrink:0 and stays bottom-
            // anchored). Without grow, the wrap collapses to button size
            // and "vertical centering" is a no-op.
            expect(wrapRule[1]).toMatch(/flex:\s*1\s+1\s+auto/);
        });

        it('centering layout is scoped to the wrap, not applied to the shared #sidebarBottom parent', () => {
            // Pin the wrapping-div approach so the footer sibling inside
            // #sidebarBottom is not rearranged by flex centering.
            const mobileBlock = css.match(/@media \(max-width:\s*1023px\)\s*\{[\s\S]*?\n\}/);
            expect(mobileBlock).toBeTruthy();
            const block = mobileBlock[0];
            const bottomRule = block.match(/#sidebarBottom\s*\{([^}]*)\}/);
            expect(bottomRule, 'expected a mobile rule for #sidebarBottom').not.toBeNull();
            expect(bottomRule[1]).not.toMatch(/justify-content:\s*center/);
            expect(bottomRule[1]).not.toMatch(/align-items:\s*center/);
        });
    });
});
