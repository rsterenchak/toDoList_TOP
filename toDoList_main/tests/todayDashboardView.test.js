import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the top-level Projects / Agent view switcher.
//
// A pill bar near the top of the main panel toggles between the project
// view and the Agent incubator. The active view is persisted in
// localStorage under `todoapp_active_view` (default 'projects'). A
// persisted legacy 'inbox' / 'today' value (from the retired Inbox view)
// falls back to 'projects'. Clicking any project row auto-switches back to
// PROJECTS so a project context always implies the PROJECTS pill is active.
describe('Projects / Agent view switcher', () => {
    const main   = read('main.js');
    const prefs  = read('prefs.js');
    const css    = read('style.css');

    describe('persistence (prefs.js)', () => {
        it('exposes ACTIVE_VIEW_KEY mapped to todoapp_active_view', () => {
            expect(prefs).toMatch(
                /ACTIVE_VIEW_KEY\s*=\s*['"]todoapp_active_view['"]/
            );
        });

        it('exports getActiveView / setActiveView accessors', () => {
            expect(prefs).toMatch(/export\s+function\s+getActiveView\s*\(/);
            expect(prefs).toMatch(/export\s+function\s+setActiveView\s*\(/);
        });

        it("getActiveView defaults to 'projects' when nothing is stored", () => {
            const fnIdx = prefs.indexOf('function getActiveView');
            expect(fnIdx).toBeGreaterThan(-1);
            const body = prefs.slice(fnIdx, fnIdx + 600);
            // The two live view tokens are honored when persisted —
            // 'projects' and 'agent'. When the key is absent (first
            // load, cleared storage) the fallback is 'projects'. Legacy
            // tokens that are no longer live ('inbox', 'today', 'calendar')
            // are NOT honored, so they fall through to the 'projects'
            // default.
            expect(body).toMatch(/===\s*['"]projects['"]/);
            expect(body).toMatch(/===\s*['"]agent['"]/);
            expect(body).not.toMatch(/===\s*['"]inbox['"]/);
            expect(body).not.toMatch(/===\s*['"]today['"]/);
            expect(body).not.toMatch(/===\s*['"]calendar['"]/);
            expect(body).toMatch(/return\s*['"]projects['"]/);
        });

        it('setActiveView writes only the known view tokens', () => {
            const fnIdx = prefs.indexOf('function setActiveView');
            expect(fnIdx).toBeGreaterThan(-1);
            const body = prefs.slice(fnIdx, fnIdx + 600);
            expect(body).toMatch(/setItem\(\s*ACTIVE_VIEW_KEY/);
            // Only 'agent' is explicitly normalized; anything else
            // (including a legacy 'inbox' / 'calendar') falls back to the
            // 'projects' default so a stray string can't pollute the pref.
            expect(body).toMatch(/===\s*['"]agent['"]/);
            expect(body).not.toMatch(/['"]inbox['"]/);
            expect(body).not.toMatch(/['"]calendar['"]/);
        });
    });

    describe('view switcher pill bar (main.js)', () => {
        it('imports the active-view accessors from prefs.js', () => {
            expect(main).toMatch(/getActiveView/);
            expect(main).toMatch(/setActiveView/);
        });

        it('renders #viewSwitcher with PROJECTS and AGENT pills', () => {
            expect(main).toMatch(/viewSwitcher\.id\s*=\s*['"]viewSwitcher['"]/);
            expect(main).toMatch(/viewPillProjects\.id\s*=\s*['"]viewPillProjects['"]/);
            expect(main).toMatch(/viewPillAgent\.id\s*=\s*['"]viewPillAgent['"]/);
            expect(main).toMatch(/viewPillProjects\.textContent\s*=\s*['"]Task View['"]/);
            expect(main).toMatch(/viewPillAgent\.textContent\s*=\s*['"]AGENT['"]/);
        });

        it('does not render an INBOX pill', () => {
            expect(main).not.toMatch(/viewPillInbox/);
        });

        it('mounts the pill bar in the desktop view sub-band beneath the header', () => {
            // The view tabs ride in the thin sub-band (#desktopViewSubBand)
            // directly below the top header rather than inside #navBar — the
            // desktop header consolidation moved them there and restyles them
            // as underlined text. They are desktop-only (display:none on
            // mobile), so a single permanent home in the sub-band is correct
            // at every breakpoint; the chip cluster's own margin-left:auto
            // keeps it right-anchored in #navBar without the tabs present.
            expect(main).toMatch(/desktopViewSubBand\.appendChild\(\s*viewSwitcher\s*\)/);
            expect(main).toMatch(/main2\.appendChild\(\s*agentView\s*\)/);
        });

        it('wires both pill buttons to applyActiveView', () => {
            expect(main).toMatch(/viewPillProjects\.addEventListener\('click'[\s\S]{0,200}applyActiveView\(\s*['"]projects['"]/);
            expect(main).toMatch(/viewPillAgent\.addEventListener\('click'[\s\S]{0,200}applyActiveView\(\s*['"]agent['"]/);
        });

        it('appends pills in PROJECTS, AGENT order', () => {
            // Visual order in the top bar: PROJECTS first, then AGENT.
            // Pinned so a future refactor can't silently re-shuffle the
            // pill sequence.
            expect(main).toMatch(
                /viewSwitcher\.appendChild\(\s*viewPillProjects\s*\)\s*;\s*\n\s*viewSwitcher\.appendChild\(\s*viewPillAgent\s*\)/
            );
        });
    });

    describe('Inbox view removal', () => {
        it('no longer constructs the #inboxView shell or its child nodes', () => {
            expect(main).not.toMatch(/inboxView\.id\s*=\s*['"]inboxView['"]/);
            expect(main).not.toMatch(/inboxDateHeader/);
            expect(main).not.toMatch(/inboxEmpty/);
            expect(main).not.toMatch(/inboxCountSummary/);
        });

        it('drops the renderInbox import and any call to it', () => {
            expect(main).not.toMatch(/renderInbox/);
            expect(main).not.toMatch(/inboxView\.js/);
        });
    });

    describe('applyActiveView', () => {
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

        it('persists the chosen view via setActiveView', () => {
            expect(body).toMatch(/setActiveView\(/);
        });

        it('flips #mainBar’s data-view attribute (CSS show/hide hook)', () => {
            expect(body).toMatch(/setAttribute\(\s*['"]data-view['"]/);
        });

        it('syncs .active and aria-pressed on both pills', () => {
            expect(body).toMatch(/pillProjects[\s\S]{0,200}classList\.toggle\(\s*['"]active['"]/);
            expect(body).toMatch(/pillAgent[\s\S]{0,200}classList\.toggle\(\s*['"]active['"]/);
            expect(body).toMatch(/aria-pressed/);
        });

        it('does not reference the removed inbox view or its renderer', () => {
            expect(body).not.toMatch(/['"]inbox['"]/);
            expect(body).not.toMatch(/renderInbox\(/);
            expect(body).not.toMatch(/refreshTodayDateHeader\(/);
            expect(body).not.toMatch(/renderTodayDashboard\(/);
        });
    });

    describe('view-switch wiring on project interactions', () => {
        it('calls applyActiveView(‘projects’) inside each project-row click handler', () => {
            // Two click handlers exist: one for new-project commit, one in
            // restoreFromStorage. Each must flip the top-level view back to
            // PROJECTS so the sidebar selection re-asserts as the active
            // surface.
            const clickHandlers = main.match(/projChild\.addEventListener\(\s*["']click["']/g) || [];
            expect(clickHandlers.length).toBeGreaterThanOrEqual(2);
            const calls = main.match(/applyActiveView\(\s*['"]projects['"]/g) || [];
            // ≥3 calls: two project-row click handlers + the projButton
            // (add-project) click handler. The add-project path also has
            // to flip back so the new row's todo list lands in front of
            // the user instead of behind another view.
            expect(calls.length).toBeGreaterThanOrEqual(3);
        });

        it('calls applyActiveView from the projButton add-project click', () => {
            const idx = main.indexOf('projButton.addEventListener("click"');
            expect(idx).toBeGreaterThan(-1);
            const window = main.slice(idx, idx + 800);
            expect(window).toMatch(/applyActiveView\(\s*['"]projects['"]\s*\)/);
        });
    });

    describe('restoreFromStorage', () => {
        it('honors the persisted view on both the empty-projects and populated paths', () => {
            // Two callsites: the early-exit when no projects exist, and
            // the tail of the populated-path branch. Both must read the
            // saved view so reload state is consistent.
            const calls = main.match(/applyActiveView\(\s*getActiveView\(\)\s*\)/g) || [];
            expect(calls.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('CSS surfaces (style.css)', () => {
        it('uses an `auto 1fr` grid for #mainBar — the status filter pill row above the list', () => {
            // The top `auto` track holds the status filter pill row
            // (#taskFilterBar); the 1fr track below is the scrollable list.
            // The Agent view overlays the panel via grid-row: 1 / -1 (see
            // assertion below), so it still covers both tracks when active.
            const idx = css.indexOf('#mainBar {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/grid-template-rows:\s*auto\s+1fr/);
            expect(rule).not.toMatch(/grid-template-rows:\s*auto\s+var\(--row-h\)/);
        });

        it('styles #viewSwitcher as a flex row of pills', () => {
            const idx = css.indexOf('#viewSwitcher {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/display:\s*flex/);
        });

        it('sizes .viewPill compactly (12px font, 4px 12px padding) for a slim top-bar nav element', () => {
            const idx = css.indexOf('.viewPill {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/font-size:\s*12px/);
            expect(rule).toMatch(/padding:\s*4px\s+12px/);
        });

        it('fills the active pill with a semi-transparent accent tint', () => {
            const idx = css.indexOf('.viewPill.active');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/background:\s*rgba\(\s*108\s*,\s*93\s*,\s*245\s*,\s*0?\.20?\s*\)/);
        });

        it('drops the #inboxView rules entirely', () => {
            expect(css).not.toMatch(/#inboxView/);
            expect(css).not.toMatch(/data-view="inbox"/);
        });

        it('hides the project view surfaces when AGENT is active', () => {
            expect(css).toMatch(
                /#mainBar\[data-view="agent"\]\s+#mainList[\s\S]*#mainBar\[data-view="agent"\]\s+#mobileProjHeader[\s\S]*#mainBar\[data-view="agent"\]\s+#bulkDescActions[\s\S]*display:\s*none/
            );
        });

        it('places #agentView across all of #mainBar so it overlays the project content area', () => {
            // Single-row grid now; #agentView still spans every track so
            // the switch is a clean swap instead of a partial overlay.
            const idx = css.indexOf('#agentView {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/grid-row:\s*1\s*\/\s*-1/);
        });

        it('mobile #mainBar grid carries mobile header + filter pills + list', () => {
            const mediaStart = css.indexOf('@media (max-width: 1023px)');
            expect(mediaStart).toBeGreaterThan(-1);
            // Find the matching close of the @media block.
            let depth = 0;
            let mediaEnd = css.length;
            for (let i = css.indexOf('{', mediaStart); i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) { mediaEnd = i; break; }
                }
            }
            const block = css.slice(mediaStart, mediaEnd);
            // Three tracks now: mobile project header, status filter pills, list.
            expect(block).toMatch(/#mainBar\s*\{\s*grid-template-rows:\s*auto\s+auto\s+1fr/);
            // mainList anchored to the final 1fr track (row 3) explicitly.
            expect(block).toMatch(/#mainList\s*\{\s*grid-row:\s*3/);
        });
    });

    // The TODAY/Inbox view rendering was deleted while the shared helpers
    // the Calendar day-detail panel depends on survive. These guards pin
    // that the renderers are gone.
    describe('TODAY view code removal', () => {
        it('drops the renderTodayDashboard renderer and its exclusive helpers', () => {
            expect(main).not.toMatch(/function\s+renderTodayDashboard\b/);
            expect(main).not.toMatch(/function\s+appendTodayCountSegment\b/);
            expect(main).not.toMatch(/function\s+appendCountSeparator\b/);
            expect(main).not.toMatch(/function\s+buildTodaySection\b/);
        });

        it('drops the refreshTodayDateHeader date-header renderer', () => {
            expect(main).not.toMatch(/function\s+refreshTodayDateHeader\b/);
        });

        it('leaves no dangling calls to the removed renderers', () => {
            expect(main).not.toMatch(/renderTodayDashboard\s*\(/);
            expect(main).not.toMatch(/refreshTodayDateHeader\s*\(/);
        });

        it('removes the #inboxSections container', () => {
            expect(main).not.toMatch(/inboxSections\.id\s*=\s*['"]inboxSections['"]/);
            expect(main).not.toMatch(/appendChild\(\s*inboxSections\s*\)/);
        });
    });
});
