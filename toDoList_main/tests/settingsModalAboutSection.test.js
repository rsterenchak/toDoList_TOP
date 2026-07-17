// Tests for the mobile Settings modal's About section — the version
// label + live project count that moved out of #footBar / #drawerFooter
// when the mobile footer track was collapsed. Source-level pins: the
// About section sits between Appearance and Help, both rows are built
// from the new createDrawerInfoRow helper (which returns { row, refresh }
// mirroring createDrawerToggleRow's shape), and the project-count row
// reads listLogic.listProjectsArray() so the value stays live on every
// modal open.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

describe('mobile Settings modal — About section', () => {
    const main = read('main.js');
    const css  = read('style.css');
    // The drawer-row factory helpers (createDrawerInfoRow /
    // createDrawerToggleRow / createDrawerActionRow) were extracted into
    // drawerRows.js; their definitions are pinned there now. The About
    // section markup and its createDrawerInfoRow call sites still live in
    // main.js's showSettingsModal.
    const drawerRows = read('drawerRows.js');

    function showSettingsModalSlice() {
        const idx = main.indexOf('function showSettingsModal()');
        expect(idx).toBeGreaterThan(-1);
        // Wide enough to cover the whole modal body, including the new
        // About section + the body.appendChild ordering at the bottom.
        return main.slice(idx, idx + 10000);
    }

    describe('createDrawerInfoRow helper', () => {
        it('declares createDrawerInfoRow next to the other drawer-row helpers', () => {
            expect(drawerRows).toMatch(/function\s+createDrawerInfoRow\s*\(/);
            const infoIdx   = drawerRows.indexOf('function createDrawerInfoRow');
            const toggleIdx = drawerRows.indexOf('function createDrawerToggleRow');
            const actionIdx = drawerRows.indexOf('function createDrawerActionRow');
            expect(toggleIdx).toBeGreaterThan(-1);
            expect(actionIdx).toBeGreaterThan(-1);
            // All four drawer-row helpers cluster in one neighborhood so
            // they're easy to maintain together.
            const lo = Math.min(infoIdx, toggleIdx, actionIdx);
            const hi = Math.max(infoIdx, toggleIdx, actionIdx);
            expect(hi - lo).toBeLessThan(5000);
        });

        it('returns { row, refresh } mirroring createDrawerToggleRow', () => {
            const idx = drawerRows.indexOf('function createDrawerInfoRow');
            expect(idx).toBeGreaterThan(-1);
            const fn = drawerRows.slice(idx, idx + 1200);
            expect(fn).toMatch(/return\s*\{\s*row:\s*row\s*,\s*refresh:\s*refresh\s*\}/);
        });

        it('paints the value into a .settingsInfoPill element', () => {
            const idx = drawerRows.indexOf('function createDrawerInfoRow');
            const fn = drawerRows.slice(idx, idx + 1200);
            expect(fn).toMatch(/pill\.className\s*=\s*['"]settingsInfoPill['"]/);
        });

        it('refresh() reads the value from the passed valueGetter', () => {
            const idx = drawerRows.indexOf('function createDrawerInfoRow');
            const fn = drawerRows.slice(idx, idx + 1200);
            // The pill text comes from valueGetter() — no hardcoded string.
            expect(fn).toMatch(/pill\.textContent\s*=\s*String\(\s*valueGetter\(\)\s*\)/);
        });
    });

    describe('About section structure', () => {
        it('builds an About heading via the existing settingsSectionHeading class', () => {
            const slice = showSettingsModalSlice();
            expect(slice).toMatch(/aboutHeading\.className\s*=\s*['"]settingsSectionHeading['"]/);
            expect(slice).toMatch(/aboutHeading\.textContent\s*=\s*['"]About['"]/);
        });

        it('mounts the About section between Appearance and Help in the modal body', () => {
            const slice = showSettingsModalSlice();
            const viewAppend       = slice.indexOf('body.appendChild(viewSection)');
            const appearanceAppend = slice.indexOf('body.appendChild(appearanceSection)');
            const aboutAppend      = slice.indexOf('body.appendChild(aboutSection)');
            const helpAppend       = slice.indexOf('body.appendChild(helpSection)');
            expect(viewAppend).toBeGreaterThan(-1);
            expect(appearanceAppend).toBeGreaterThan(viewAppend);
            expect(aboutAppend).toBeGreaterThan(appearanceAppend);
            expect(helpAppend).toBeGreaterThan(aboutAppend);
        });

        it('builds the section with the existing .settingsSection class', () => {
            const slice = showSettingsModalSlice();
            expect(slice).toMatch(/aboutSection\.className\s*=\s*['"]settingsSection['"]/);
        });
    });

    describe('About rows', () => {
        it('appends a Version row built from createDrawerInfoRow', () => {
            const slice = showSettingsModalSlice();
            expect(slice).toMatch(
                /aboutSection\.appendChild\(\s*createDrawerInfoRow\(\s*['"]Version['"]/
            );
        });

        it('Version row value is the static v1.1 string', () => {
            const slice = showSettingsModalSlice();
            // Match the valueGetter returning the version literal.
            const versionRowMatch = slice.match(
                /createDrawerInfoRow\(\s*['"]Version['"][\s\S]{0,300}return\s*['"](v[\d.]+)['"]/
            );
            expect(versionRowMatch).not.toBeNull();
            expect(versionRowMatch[1]).toBe('v1.1');
        });

        it('gives the Version row a title attribute with the full build string', () => {
            const slice = showSettingsModalSlice();
            // The version row element (captured before paintAboutVersionUpdateCue)
            // gets a title so hovering reveals the full build string the
            // abbreviated "v1.1" pill stands in for.
            const titleMatch = slice.match(
                /versionRow\.setAttribute\(\s*['"]title['"]\s*,\s*['"]([^'"]+)['"]\s*\)/
            );
            expect(titleMatch).not.toBeNull();
            expect(titleMatch[1]).toMatch(/v1\.1/);
        });

        it('appends a Projects row built from createDrawerInfoRow', () => {
            const slice = showSettingsModalSlice();
            expect(slice).toMatch(
                /aboutSection\.appendChild\(\s*createDrawerInfoRow\(\s*['"]Projects['"]/
            );
        });

        it('Projects row reads listLogic.listProjectsArray().length live (no cached number)', () => {
            const slice = showSettingsModalSlice();
            // The Projects row's valueGetter must invoke the live array
            // getter so the count stays fresh on every modal open.
            const projectsRowMatch = slice.match(
                /createDrawerInfoRow\(\s*['"]Projects['"][\s\S]{0,400}listLogic\.listProjectsArray\(\)/
            );
            expect(projectsRowMatch).not.toBeNull();
        });

        it('Projects row matches singular vs plural (1 Project vs N Projects)', () => {
            const slice = showSettingsModalSlice();
            const projectsRowMatch = slice.match(
                /createDrawerInfoRow\(\s*['"]Projects['"][\s\S]{0,500}\}\)\.row/
            );
            expect(projectsRowMatch).not.toBeNull();
            const body = projectsRowMatch[0];
            // Both singular and plural label fragments are present.
            expect(body).toMatch(/Project\b/);
            expect(body).toMatch(/Projects\b/);
            // Conditional pivots on the count === 1 case.
            expect(body).toMatch(/===\s*1/);
        });
    });

    describe('runtime behavior — createDrawerInfoRow', () => {
        it('refresh() re-reads the value getter so the row stays live across calls', () => {
            // Lift just the createDrawerInfoRow function body and run it
            // in jsdom. The slice approach mirrors the pattern other
            // tests in this suite use against the source (which is too
            // large to instantiate end-to-end).
            const idx = drawerRows.indexOf('function createDrawerInfoRow');
            expect(idx).toBeGreaterThan(-1);
            const braceStart = drawerRows.indexOf('{', idx);
            let depth = 0;
            let body;
            for (let i = braceStart; i < drawerRows.length; i++) {
                if (drawerRows[i] === '{') depth++;
                else if (drawerRows[i] === '}') {
                    depth--;
                    if (depth === 0) {
                        body = drawerRows.slice(braceStart + 1, i);
                        break;
                    }
                }
            }
            expect(body).toBeDefined();

            const factory = new Function('document', 'labelText', 'valueGetter', body);
            let n = 3;
            const result = factory(document, 'Projects', function() {
                return n + (n === 1 ? ' Project' : ' Projects');
            });
            expect(result.row).toBeInstanceOf(Element);
            expect(result.row.classList.contains('drawerInfoRow')).toBe(true);

            const pill = result.row.querySelector('.settingsInfoPill');
            expect(pill).not.toBeNull();
            expect(pill.textContent).toBe('3 Projects');

            // Change the underlying value and call refresh().
            n = 1;
            result.refresh();
            expect(pill.textContent).toBe('1 Project');

            n = 0;
            result.refresh();
            expect(pill.textContent).toBe('0 Projects');
        });
    });

    describe('settingsInfoPill chrome', () => {
        it('declares .settingsInfoPill matching the OFF drawerTogglePill shape (muted color, uppercase, spaced)', () => {
            // The class declaration must exist in style.css with the
            // same muted-color / letter-spacing / uppercase chrome the
            // OFF state of .drawerTogglePill uses, so the read-only
            // About rows visually align with the toggle rows above.
            const m = css.match(/\.settingsInfoPill\s*\{([^}]*)\}/);
            expect(m).not.toBeNull();
            const rule = m[1];
            expect(rule).toMatch(/color:\s*var\(--text-muted\)/);
            expect(rule).toMatch(/text-transform:\s*uppercase/);
            expect(rule).toMatch(/letter-spacing/);
            expect(rule).toMatch(/font-weight/);
        });
    });
});
