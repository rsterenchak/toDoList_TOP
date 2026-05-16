import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the sync between #mainBar's data-view attribute (the CSS routing
// hook that hides #mobileProjHeader on Today / Calendar views) and the
// active mobile tab. Two guarantees:
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
                /mobileTabToday[\s\S]{0,400}classList\.toggle\(\s*['"]active['"]/
            );
            expect(body).toMatch(
                /mobileTabCalendar[\s\S]{0,400}classList\.toggle\(\s*['"]active['"]/
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
});
