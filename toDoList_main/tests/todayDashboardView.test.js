import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the top-level Inbox / Projects view switcher.
//
// A pill bar near the top of the main panel toggles between the Inbox
// view shell and the existing project view. The active view is
// persisted in localStorage under `todoapp_active_view` (default
// 'projects'). A legacy stored 'today' value migrates to 'inbox'.
// Clicking any project row auto-switches back to PROJECTS so a project
// context always implies the PROJECTS pill is active. The Inbox view
// rendering is still a follow-up entry; the shell's #inboxView /
// #inboxDateHeader / #inboxEmpty nodes remain blank for now.
describe('Inbox view + view switcher', () => {
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
            // The three live view tokens are honored when persisted —
            // 'inbox', 'projects', and 'calendar' — and a legacy stored
            // 'today' migrates to 'inbox'. When the key is absent (first
            // load, cleared storage) the fallback is 'projects'.
            expect(body).toMatch(/===\s*['"]projects['"]/);
            expect(body).toMatch(/===\s*['"]calendar['"]/);
            expect(body).toMatch(/===\s*['"]inbox['"]/);
            expect(body).toMatch(/===\s*['"]today['"]/);
            expect(body).toMatch(/return\s*['"]projects['"]/);
        });

        it('setActiveView writes only the known view tokens', () => {
            const fnIdx = prefs.indexOf('function setActiveView');
            expect(fnIdx).toBeGreaterThan(-1);
            const body = prefs.slice(fnIdx, fnIdx + 600);
            expect(body).toMatch(/setItem\(\s*ACTIVE_VIEW_KEY/);
            // Reject anything other than 'inbox' / 'calendar' / 'projects'
            // so a stray string can't pollute the stored pref ('projects'
            // is the default fallback).
            expect(body).toMatch(/===\s*['"]inbox['"]/);
            expect(body).toMatch(/===\s*['"]calendar['"]/);
        });
    });

    describe('view switcher pill bar (main.js)', () => {
        it('imports the active-view accessors from prefs.js', () => {
            expect(main).toMatch(/getActiveView/);
            expect(main).toMatch(/setActiveView/);
        });

        it('renders #viewSwitcher with INBOX and PROJECTS pills', () => {
            expect(main).toMatch(/viewSwitcher\.id\s*=\s*['"]viewSwitcher['"]/);
            expect(main).toMatch(/viewPillInbox\.id\s*=\s*['"]viewPillInbox['"]/);
            expect(main).toMatch(/viewPillProjects\.id\s*=\s*['"]viewPillProjects['"]/);
            expect(main).toMatch(/viewPillInbox\.textContent\s*=\s*['"]INBOX['"]/);
            expect(main).toMatch(/viewPillProjects\.textContent\s*=\s*['"]PROJECTS['"]/);
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
            expect(main).toMatch(/main2\.appendChild\(\s*inboxView\s*\)/);
        });

        it('wires both pill buttons to applyActiveView', () => {
            expect(main).toMatch(/viewPillInbox\.addEventListener\('click'[\s\S]{0,200}applyActiveView\(\s*['"]inbox['"]/);
            expect(main).toMatch(/viewPillProjects\.addEventListener\('click'[\s\S]{0,200}applyActiveView\(\s*['"]projects['"]/);
        });

        it('appends pills in PROJECTS, INBOX, CALENDAR order', () => {
            // Visual order in the top bar: PROJECTS first, then INBOX,
            // then CALENDAR. Pinned so a future refactor can't silently
            // re-shuffle the pill sequence.
            expect(main).toMatch(
                /viewSwitcher\.appendChild\(\s*viewPillProjects\s*\)\s*;\s*\n\s*viewSwitcher\.appendChild\(\s*viewPillInbox\s*\)\s*;\s*\n\s*viewSwitcher\.appendChild\(\s*viewPillCalendar\s*\)/
            );
        });
    });

    describe('Inbox shell DOM', () => {
        it('creates #inboxView with a #inboxDateHeader and #inboxEmpty', () => {
            expect(main).toMatch(/inboxView\.id\s*=\s*['"]inboxView['"]/);
            expect(main).toMatch(/inboxDateHeader\.id\s*=\s*['"]inboxDateHeader['"]/);
            expect(main).toMatch(/inboxEmpty\.id\s*=\s*['"]inboxEmpty['"]/);
        });

        it('uses the spec’s empty-state copy', () => {
            // Pinning the exact text so the follow-up placeholder task can
            // tell at a glance which surfaces still render the shell-only
            // empty state vs. the aggregated sections.
            expect(main).toMatch(
                /inboxEmpty\.textContent\s*=\s*['"]No items due yet — add a todo from any project to see it here['"]/
            );
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
            expect(body).toMatch(/viewPillInbox[\s\S]{0,200}classList\.toggle\(\s*['"]active['"]/);
            expect(body).toMatch(/viewPillProjects[\s\S]{0,200}classList\.toggle\(\s*['"]active['"]/);
            expect(body).toMatch(/aria-pressed/);
        });

        it('does NOT clear .selectedProject when switching to INBOX', () => {
            // The sidebar selection persists across view switches so that
            // returning to PROJECTS re-paints the mobile header off the
            // still-selected sidebar row. Clearing on INBOX left
            // #mobileProjHeader stuck with data-empty="true" on the return
            // trip — see TODO bug entry.
            expect(body).not.toMatch(
                /['"]inbox['"][\s\S]{0,400}querySelector\(\s*['"]\.selectedProject['"][\s\S]{0,300}classList\.remove\(\s*['"]selectedProject['"]/
            );
        });

        it('does NOT clear .selectedProject when switching to CALENDAR', () => {
            // Same reasoning as TODAY — the sidebar selection persists so
            // PROJECTS returns to a populated mobile header instead of an
            // empty one.
            expect(body).not.toMatch(
                /['"]calendar['"][\s\S]{0,400}querySelector\(\s*['"]\.selectedProject['"][\s\S]{0,300}classList\.remove\(\s*['"]selectedProject['"]/
            );
        });

        it('still recognizes the INBOX view without calling the removed renderers', () => {
            // The TODAY view code was removed and the routing identifier
            // renamed to INBOX: switching to INBOX must still flip
            // data-view="inbox" (covered above) without invoking the
            // deleted dashboard / date-header renderers. The INBOX
            // placeholder content ships in a follow-up entry.
            expect(body).toMatch(/['"]inbox['"]/);
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
            // the user instead of behind the dashboard.
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
            // The Today shell and Calendar view each overlay the panel via
            // grid-row: 1 / -1 (see assertion below), so they still cover
            // both tracks when active.
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

        it('hides #inboxView by default and shows it via #mainBar[data-view="inbox"]', () => {
            const baseIdx = css.indexOf('#inboxView {');
            expect(baseIdx).toBeGreaterThan(-1);
            const base = css.slice(baseIdx, css.indexOf('}', baseIdx));
            expect(base).toMatch(/display:\s*none/);
            // Active rule
            expect(css).toMatch(/#mainBar\[data-view="inbox"\]\s+#inboxView[\s\S]{0,160}display:\s*flex/);
        });

        it('hides the project view surfaces when INBOX is active', () => {
            expect(css).toMatch(
                /#mainBar\[data-view="inbox"\]\s+#mainList[\s\S]*#mainBar\[data-view="inbox"\]\s+#mobileProjHeader[\s\S]*#mainBar\[data-view="inbox"\]\s+#bulkDescActions[\s\S]*display:\s*none/
            );
        });

        it('places #inboxView across all of #mainBar so it overlays the project content area', () => {
            // Single-row grid now; #inboxView still spans every track so
            // the switch is a clean swap instead of a partial overlay.
            const idx = css.indexOf('#inboxView {');
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

    // The TODAY view rendering was deleted while the tab, routing
    // identifier, CSS branch, and keyboard-nav handlers were intentionally
    // left in place (TODAY → INBOX rename + INBOX placeholder ship in
    // follow-up entries). These guards pin that the renderers are gone but
    // the shared helpers the Calendar day-detail panel depends on survive.
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

        it('removes the #inboxSections container from the Inbox shell', () => {
            // The render target the deleted dashboard wrote into is gone.
            // The keyboard-nav handlers still reference it by id (renamed
            // to #inboxSections) but no longer create the element.
            expect(main).not.toMatch(/inboxSections\.id\s*=\s*['"]inboxSections['"]/);
            expect(main).not.toMatch(/appendChild\(\s*inboxSections\s*\)/);
        });

        it('keeps buildTodayRow and handleTodayCheckboxToggle — shared with the Calendar day-detail panel', () => {
            expect(main).toMatch(/function\s+buildTodayRow\b/);
            expect(main).toMatch(/function\s+handleTodayCheckboxToggle\b/);
        });
    });
});
