import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the top-level Projects / Structure view switcher.
//
// A pill bar near the top of the main panel toggles between the project
// view and the Structure map. The active view is persisted in
// localStorage under `todoapp_active_view` (default 'projects'). A
// persisted legacy value (from a retired Inbox / Agent view) falls back to
// 'projects'. Clicking any project row auto-switches back to PROJECTS so a
// project context always implies the PROJECTS pill is active.
describe('Stream / Structure view switcher', () => {
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
            // 'projects' and 'structure'. When the key is absent (first
            // load, cleared storage) the fallback is 'projects'. Tokens
            // that are no longer live ('inbox', 'today', 'calendar', and
            // the retired 'agent' board) are NOT honored, so they fall
            // through to the 'projects' default.
            expect(body).toMatch(/===\s*['"]projects['"]/);
            expect(body).toMatch(/===\s*['"]structure['"]/);
            expect(body).not.toMatch(/===\s*['"]agent['"]/);
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
            // Only 'structure' is explicitly normalized; anything else
            // (including the retired 'agent' or a legacy 'inbox' /
            // 'calendar') falls back to the 'projects' default so a stray
            // string can't pollute the pref.
            expect(body).toMatch(/===\s*['"]structure['"]/);
            expect(body).not.toMatch(/['"]agent['"]/);
            expect(body).not.toMatch(/['"]inbox['"]/);
            expect(body).not.toMatch(/['"]calendar['"]/);
        });
    });

    describe('view switcher pill bar (main.js)', () => {
        it('imports the active-view accessors from prefs.js', () => {
            expect(main).toMatch(/getActiveView/);
            expect(main).toMatch(/setActiveView/);
        });

        it('renders #viewSwitcher with STREAM and STRUCTURE pills', () => {
            expect(main).toMatch(/viewSwitcher\.id\s*=\s*['"]viewSwitcher['"]/);
            expect(main).toMatch(/viewPillProjects\.id\s*=\s*['"]viewPillProjects['"]/);
            expect(main).toMatch(/viewPillStructure\.id\s*=\s*['"]viewPillStructure['"]/);
            expect(main).toMatch(/viewPillProjects\.textContent\s*=\s*['"]STREAM['"]/);
            expect(main).toMatch(/viewPillStructure\.textContent\s*=\s*['"]STRUCTURE['"]/);
        });

        it('does not render an INBOX or AGENT pill', () => {
            // The AGENT tab was retired: the board is reached by tapping a
            // DRAFTED / STUCK / MOCKUP badge, not by a pill.
            expect(main).not.toMatch(/viewPillInbox/);
            expect(main).not.toMatch(/viewPillAgent/);
        });

        it('mounts the pill bar inside the top header row (#navBar)', () => {
            // The view tabs ride inside #navBar, inserted before the chip
            // cluster (pomodoroToggle) so the header reads pill → view tabs →
            // chips. They are desktop-only (display:none on mobile), so a single
            // permanent home in the header is correct at every breakpoint; the
            // chip cluster's own margin-left:auto keeps it right-anchored.
            expect(main).toMatch(/nav\.insertBefore\(\s*viewSwitcher\s*,\s*pomodoroToggle\s*\)/);
        });

        it('wires both pill buttons to applyActiveView', () => {
            expect(main).toMatch(/viewPillProjects\.addEventListener\('click'[\s\S]{0,200}applyActiveView\(\s*['"]projects['"]/);
            expect(main).toMatch(/viewPillStructure\.addEventListener\('click'[\s\S]{0,200}applyActiveView\(\s*['"]structure['"]/);
        });

        it('appends pills in STREAM, STRUCTURE order', () => {
            // Visual order in the top bar: STREAM first, then STRUCTURE.
            // Pinned so a future refactor can't silently re-shuffle the
            // pill sequence.
            expect(main).toMatch(
                /viewSwitcher\.appendChild\(\s*viewPillProjects\s*\)\s*;\s*\n\s*viewSwitcher\.appendChild\(\s*viewPillStructure\s*\)/
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

    describe('Agent view severed from main.js', () => {
        it('drops the agentView.js import and its board renderers', () => {
            // renderAgentView / subscribeAgentView / unsubscribeAgentView and
            // the './agentView.js' import are gone — main.js no longer reaches
            // into the board module. (The module itself survives until a later
            // step; only main.js's wiring to it is severed here.)
            expect(main).not.toMatch(/agentView\.js/);
            expect(main).not.toMatch(/renderAgentView/);
            expect(main).not.toMatch(/subscribeAgentView/);
            expect(main).not.toMatch(/unsubscribeAgentView/);
        });

        it('no longer constructs the #agentView container', () => {
            expect(main).not.toMatch(/agentView\.id\s*=\s*['"]agentView['"]/);
            expect(main).not.toMatch(/appendChild\(\s*agentView\s*\)/);
        });

        it('the view switch no longer accepts an agent value', () => {
            // No branch normalizes or renders 'agent'; a restored 'agent'
            // pref falls back to the projects default (see prefs.js).
            expect(main).not.toMatch(/safe\s*=\s*['"]agent['"]/);
            expect(main).not.toMatch(/safe\s*===\s*['"]agent['"]/);
            expect(main).not.toMatch(/getActiveView\(\)\s*===\s*['"]agent['"]/);
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
            expect(body).toMatch(/pillStructure[\s\S]{0,200}classList\.toggle\(\s*['"]active['"]/);
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

        it('drops every #mainBar[data-view="agent"] gating rule', () => {
            // The Agent view was severed from main.js: it mounts no #agentView
            // container and the view switch no longer accepts 'agent', so the
            // data-view="agent" CSS that showed the container and hid the
            // project surfaces is dead and removed.
            expect(css).not.toMatch(/data-view="agent"/);
        });

        it('drops the #agentView container rule entirely', () => {
            // No container is mounted for the Agent view any more, so its
            // styling block is removed. (The .agentView* content classes are
            // retired with the module in a later step.)
            expect(css.indexOf('#agentView {')).toBe(-1);
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
