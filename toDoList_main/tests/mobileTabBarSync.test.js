import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the sync between #mainBar's data-view attribute (the CSS routing
// hook that hides #mobileProjHeader on the Inbox / Conceive views) and
// the active mobile tab. Two guarantees:
//   1. #mainBar is created with data-view="projects" at the DOM build
//      site — never sits in the DOM without an attribute value, so no
//      boot-time window where the value is unset.
//   2. applyActiveView is the single function that writes data-view,
//      and it does so in lockstep with toggling the mobileTab .active
//      class — so the visual active-tab state and the CSS routing
//      attribute can never drift apart.
// Verified through source inspection because main.js is too large to
// instantiate end-to-end in jsdom (per CLAUDE.md guidance).
describe('mobile tab bar / #mainBar[data-view] sync', () => {
    const main = read('main.js');

    describe('element creation site', () => {
        it('seeds #mainBar.dataset.view = "projects" at the DOM build site', () => {
            // The seed lives near `main2.id = 'mainBar'` so the attribute
            // is set the moment the element exists. Without this, a
            // window between component() returning and applyActiveView()
            // running leaves the attribute unset.
            const mainBarIdIdx = main.indexOf(`main2.id = 'mainBar'`);
            expect(mainBarIdIdx).toBeGreaterThan(-1);
            const window = main.slice(mainBarIdIdx, mainBarIdIdx + 1200);
            expect(window).toMatch(
                /main2\.dataset\.view\s*=\s*['"]projects['"]/
            );
        });
    });

    describe('applyActiveView is the canonical writer', () => {
        function extractApplyActiveView() {
            const idx = main.indexOf('function applyActiveView');
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
            throw new Error('unterminated applyActiveView body');
        }
        const body = extractApplyActiveView();

        it('writes #mainBar data-view inside the function body', () => {
            // The CSS routing attribute write must live inside
            // applyActiveView so every view flip goes through it.
            expect(body).toMatch(
                /getElementById\(\s*['"]mainBar['"]\s*\)[\s\S]{0,200}setAttribute\(\s*['"]data-view['"]/
            );
        });

        it('toggles .active on all three mobile tabs in the same function', () => {
            // Mobile tab .active class is owned by applyActiveView so it
            // cannot be toggled out of band from the data-view write.
            expect(body).toMatch(
                /mobileTabProjects[\s\S]{0,400}classList\.toggle\(\s*['"]active['"]/
            );
            expect(body).toMatch(
                /mobileTabInbox[\s\S]{0,400}classList\.toggle\(\s*['"]active['"]/
            );
            expect(body).toMatch(
                /mobileTabConceive[\s\S]{0,400}classList\.toggle\(\s*['"]active['"]/
            );
        });

        it('writes data-view BEFORE toggling the mobile tab .active classes', () => {
            // Order matters: data-view must be the first paint hook
            // flipped so the CSS swap happens in the same frame as the
            // tab class toggle. Pinning the order so a future refactor
            // can't re-shuffle them apart.
            const dataViewWriteIdx = body.search(
                /setAttribute\(\s*['"]data-view['"]/
            );
            const tabToggleIdx = body.search(
                /mobileTabProjects[\s\S]{0,400}classList\.toggle\(\s*['"]active['"]/
            );
            expect(dataViewWriteIdx).toBeGreaterThan(-1);
            expect(tabToggleIdx).toBeGreaterThan(-1);
            expect(dataViewWriteIdx).toBeLessThan(tabToggleIdx);
        });
    });

    describe('mobile tab click handlers route through applyActiveView', () => {
        it('each mobile tab click handler calls applyActiveView(viewKey)', () => {
            // buildMobileTab wires every button to applyActiveView so
            // taps cannot bypass the canonical writer.
            const builderIdx = main.indexOf('function buildMobileTab');
            expect(builderIdx).toBeGreaterThan(-1);
            const builderBody = main.slice(builderIdx, builderIdx + 1500);
            expect(builderBody).toMatch(
                /addEventListener\(\s*['"]click['"][\s\S]{0,200}applyActiveView\(\s*viewKey\s*\)/
            );
        });
    });

    describe('no out-of-band data-view writes on #mainBar', () => {
        it('every data-view write on #mainBar lives in applyActiveView', () => {
            // Sanity guard: any other site that writes data-view to
            // #mainBar would defeat the sync. The only references to
            // `mainBar` paired with a data-view write should be the one
            // inside applyActiveView and the dataset.view seed at the
            // creation site (which uses dataset.view, not the string
            // selector). The mobile-tab buttons each carry their own
            // btn.dataset.view = viewKey — that's per-button metadata,
            // not the #mainBar attribute, so it's unrelated.
            const sites = main.match(
                /mainBar[\s\S]{0,80}setAttribute\(\s*['"]data-view['"]/g
            ) || [];
            // Exactly one write site: the one inside applyActiveView.
            expect(sites.length).toBe(1);
        });
    });

    describe('data-view write is symmetric across all three views', () => {
        // The bug pattern this guards against: a future refactor that
        // hardcodes the second argument to setAttribute (e.g. always
        // writes 'today' or always writes a non-projects value), or
        // moves the write inside an `if (viewKey !== 'projects')` guard
        // so the projects case never re-asserts the attribute. The
        // header CSS rules key off `data-view="inbox" / "conceive"` —
        // if 'projects' is never written back on the return trip, the
        // attribute stays stuck on the last non-Projects value and
        // #mobileProjHeader stays hidden by the [data-view="inbox"] /
        // "conceive" rule even when the Projects tab is active.
        function extractApplyActiveView() {
            const idx = main.indexOf('function applyActiveView');
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
            throw new Error('unterminated applyActiveView body');
        }
        const body = extractApplyActiveView();

        it('writes data-view using a variable, not a hardcoded string literal', () => {
            // The setAttribute call must pass an identifier as the
            // second argument, never a string literal. A regression that
            // replaces the variable with e.g. 'today' would still
            // technically be "an unconditional write" but would defeat
            // the symmetry — that's the exact bug pattern the user
            // diagnosis in TODO.md called out.
            const m = body.match(
                /setAttribute\(\s*['"]data-view['"]\s*,\s*([^)]+)\)/
            );
            expect(m).not.toBeNull();
            const secondArg = m[1].trim();
            // Identifier-only (no quotes) — rules out the 'projects' /
            // 'today' / 'calendar' literal regressions.
            expect(secondArg).not.toMatch(/^['"`]/);
            expect(secondArg).toMatch(/^[A-Za-z_$][A-Za-z0-9_$]*$/);
        });

        it('maps view === "inbox" to the same normalized value', () => {
            // The normalization step must preserve 'inbox' as 'inbox'.
            // If a future edit drops this branch (or renames the
            // constant), the inbox tab would silently fall through to
            // the 'projects' default and never activate.
            expect(body).toMatch(
                /if\s*\(\s*view\s*===\s*['"]inbox['"]\s*\)\s*safe\s*=\s*['"]inbox['"]/
            );
        });

        it('maps view === "conceive" to the same normalized value', () => {
            expect(body).toMatch(
                /view\s*===\s*['"]conceive['"]\s*\)\s*safe\s*=\s*['"]conceive['"]/
            );
        });

        it('preserves the projects default for unknown view values', () => {
            // Defensive default keeps `safe` a known value when called
            // before getActiveView has resolved (e.g. boot before
            // localStorage reads). PROJECTS is the natural default, so
            // any unrecognized token (including a legacy 'today') lands
            // on the project list rather than a blank view.
            expect(body).toMatch(/let\s+safe\s*=\s*['"]projects['"]/);
        });

        it('writes data-view before the view-specific render branches', () => {
            // The attribute must be set before any branch that depends
            // on view-specific work (renderInbox, the conceive render,
            // etc.) so a thrown exception in those branches still leaves
            // the CSS routing attribute in a consistent state.
            const dataViewWriteIdx = body.search(
                /setAttribute\(\s*['"]data-view['"]/
            );
            const inboxBranchIdx = body.search(
                /if\s*\(\s*safe\s*===\s*['"]inbox['"]\s*\)/
            );
            const conceiveBranchIdx = body.search(
                /(else\s+if|if)\s*\(\s*safe\s*===\s*['"]conceive['"]\s*\)/
            );
            expect(dataViewWriteIdx).toBeGreaterThan(-1);
            expect(inboxBranchIdx).toBeGreaterThan(-1);
            expect(conceiveBranchIdx).toBeGreaterThan(-1);
            expect(dataViewWriteIdx).toBeLessThan(inboxBranchIdx);
            expect(dataViewWriteIdx).toBeLessThan(conceiveBranchIdx);
        });

        it('produces the correct data-view attribute for every view on round-trip (runtime)', () => {
            // Source patterns above pin the shape; this test pins the
            // BEHAVIOR by lifting the normalization-and-write slice from
            // applyActiveView and executing it against a real DOM. This
            // is the assertion that would have caught the round-trip
            // bug the TODO entry describes — initial → inbox →
            // projects → conceive → projects must each leave data-view
            // correctly synced. Extracting just the data-view slice
            // avoids depending on the rest of main.js (pill/tab
            // toggles, renderTodayDashboard, etc.), which can't load
            // standalone.
            const sliceStart = body.search(/let\s+safe\s*=/);
            const writeMatch = body.match(
                /mainBar\.setAttribute\(\s*['"]data-view['"]\s*,\s*[^)]+\)\s*;?/
            );
            expect(sliceStart).toBeGreaterThan(-1);
            expect(writeMatch).not.toBeNull();
            const sliceEnd = body.indexOf(writeMatch[0]) + writeMatch[0].length;
            const slice = body.slice(sliceStart, sliceEnd);

            document.body.innerHTML =
                '<div id="mainBar" data-view="projects"></div>';
            let stored = 'projects';
            const factory = new Function(
                'document',
                'getActiveView',
                'setActiveView',
                'view',
                `${slice}`
            );
            const applyActiveView = function (view) {
                factory(
                    document,
                    function () { return stored; },
                    function (v) { stored = v; },
                    view
                );
            };

            const mainBar = document.getElementById('mainBar');
            expect(mainBar.getAttribute('data-view')).toBe('projects');
            applyActiveView('inbox');
            expect(mainBar.getAttribute('data-view')).toBe('inbox');
            applyActiveView('projects');
            expect(mainBar.getAttribute('data-view')).toBe('projects');
            applyActiveView('conceive');
            expect(mainBar.getAttribute('data-view')).toBe('conceive');
            applyActiveView('projects');
            expect(mainBar.getAttribute('data-view')).toBe('projects');
        });
    });
});
