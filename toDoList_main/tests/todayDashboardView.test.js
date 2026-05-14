import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the top-level Today / Projects view switcher.
//
// A pill bar near the top of the main panel toggles between the new
// Today dashboard shell and the existing project view. The active view
// is persisted in localStorage under `todoapp_active_view` (default
// 'today'). Switching to TODAY clears any selected project; clicking
// any project row auto-switches back to PROJECTS so a project context
// always implies the PROJECTS pill is active. The Today shell only
// renders a date header and an empty-state line — overdue/today/upcoming
// aggregation lands in a follow-up task.
describe('Today dashboard view + view switcher', () => {
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

        it("getActiveView defaults to 'today' when nothing is stored", () => {
            const fnIdx = prefs.indexOf('function getActiveView');
            expect(fnIdx).toBeGreaterThan(-1);
            const body = prefs.slice(fnIdx, fnIdx + 600);
            // 'projects' and 'calendar' are honored as non-default values;
            // anything else (including null / missing) falls back to 'today'.
            expect(body).toMatch(/===\s*['"]projects['"]/);
            expect(body).toMatch(/===\s*['"]calendar['"]/);
            expect(body).toMatch(/return\s*['"]today['"]/);
        });

        it('setActiveView writes only the three known view tokens', () => {
            const fnIdx = prefs.indexOf('function setActiveView');
            expect(fnIdx).toBeGreaterThan(-1);
            const body = prefs.slice(fnIdx, fnIdx + 600);
            expect(body).toMatch(/setItem\(\s*ACTIVE_VIEW_KEY/);
            // Reject anything other than 'projects' / 'calendar' / 'today'
            // so a stray string can't pollute the stored pref.
            expect(body).toMatch(/===\s*['"]projects['"]/);
            expect(body).toMatch(/===\s*['"]calendar['"]/);
        });
    });

    describe('view switcher pill bar (main.js)', () => {
        it('imports the active-view accessors from prefs.js', () => {
            expect(main).toMatch(/getActiveView/);
            expect(main).toMatch(/setActiveView/);
        });

        it('renders #viewSwitcher with TODAY and PROJECTS pills', () => {
            expect(main).toMatch(/viewSwitcher\.id\s*=\s*['"]viewSwitcher['"]/);
            expect(main).toMatch(/viewPillToday\.id\s*=\s*['"]viewPillToday['"]/);
            expect(main).toMatch(/viewPillProjects\.id\s*=\s*['"]viewPillProjects['"]/);
            expect(main).toMatch(/viewPillToday\.textContent\s*=\s*['"]TODAY['"]/);
            expect(main).toMatch(/viewPillProjects\.textContent\s*=\s*['"]PROJECTS['"]/);
        });

        it('mounts the pill bar in the top nav, anchored right of the hamburger', () => {
            // The pill bar lives inside #navBar (next to the hamburger
            // toggle) and pushes the right-side icon cluster — pomodoro,
            // music, settings — to the far right via margin-right:auto
            // on #viewSwitcher. insertBefore(pomodoroToggle) preserves
            // the existing right-cluster order while anchoring the pills
            // left of it.
            expect(main).toMatch(/nav\.insertBefore\(\s*viewSwitcher\s*,\s*pomodoroToggle\s*\)/);
            expect(main).toMatch(/main2\.appendChild\(\s*todayView\s*\)/);
        });

        it('wires both pill buttons to applyActiveView', () => {
            expect(main).toMatch(/viewPillToday\.addEventListener\('click'[\s\S]{0,200}applyActiveView\(\s*['"]today['"]/);
            expect(main).toMatch(/viewPillProjects\.addEventListener\('click'[\s\S]{0,200}applyActiveView\(\s*['"]projects['"]/);
        });

        it('appends pills in PROJECTS, TODAY, CALENDAR order', () => {
            // Visual order in the top bar: PROJECTS first, then TODAY,
            // then CALENDAR. Pinned so a future refactor can't silently
            // re-shuffle the pill sequence.
            expect(main).toMatch(
                /viewSwitcher\.appendChild\(\s*viewPillProjects\s*\)\s*;\s*\n\s*viewSwitcher\.appendChild\(\s*viewPillToday\s*\)\s*;\s*\n\s*viewSwitcher\.appendChild\(\s*viewPillCalendar\s*\)/
            );
        });
    });

    describe('Today shell DOM', () => {
        it('creates #todayView with a #todayDateHeader and #todayEmpty', () => {
            expect(main).toMatch(/todayView\.id\s*=\s*['"]todayView['"]/);
            expect(main).toMatch(/todayDateHeader\.id\s*=\s*['"]todayDateHeader['"]/);
            expect(main).toMatch(/todayEmpty\.id\s*=\s*['"]todayEmpty['"]/);
        });

        it('uses the spec’s empty-state copy', () => {
            // Pinning the exact text so the follow-up aggregation task can
            // tell at a glance which surfaces still render the shell-only
            // empty state vs. the aggregated sections.
            expect(main).toMatch(
                /todayEmpty\.textContent\s*=\s*['"]No items due yet — add a todo from any project to see it here['"]/
            );
        });

        it('formats the date header in the user’s locale on every TODAY switch', () => {
            const fnIdx = main.indexOf('function refreshTodayDateHeader');
            expect(fnIdx).toBeGreaterThan(-1);
            const body = main.slice(fnIdx, fnIdx + 800);
            expect(body).toMatch(/toLocaleDateString/);
            // Long, human-readable shape — weekday + month + day + year.
            expect(body).toMatch(/weekday:\s*['"]long['"]/);
            expect(body).toMatch(/month:\s*['"]long['"]/);
            expect(body).toMatch(/day:\s*['"]numeric['"]/);
            expect(body).toMatch(/year:\s*['"]numeric['"]/);
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
            expect(body).toMatch(/viewPillToday[\s\S]{0,200}classList\.toggle\(\s*['"]active['"]/);
            expect(body).toMatch(/viewPillProjects[\s\S]{0,200}classList\.toggle\(\s*['"]active['"]/);
            expect(body).toMatch(/aria-pressed/);
        });

        it('clears any .selectedProject when switching to TODAY', () => {
            // Today owns the main panel — the sidebar selection only makes
            // sense once PROJECTS is active again.
            expect(body).toMatch(
                /['"]today['"][\s\S]{0,400}querySelector\(\s*['"]\.selectedProject['"][\s\S]{0,300}classList\.remove\(\s*['"]selectedProject['"]/
            );
        });

        it('rebuilds the date header on every TODAY switch', () => {
            expect(body).toMatch(/refreshTodayDateHeader\(/);
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
        it('uses a single 1fr row for #mainBar so the list (or overlay views) fill the panel', () => {
            // The pill bar lives in #navBar, and the previous title bar
            // above the list (#mainTitle) was retired. The Today shell
            // and Calendar view each overlay the panel via grid-row:
            // 1 / -1 (see assertion below).
            const idx = css.indexOf('#mainBar {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/grid-template-rows:\s*1fr/);
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

        it('uses the accent variable for the active pill (honors theme)', () => {
            const idx = css.indexOf('.viewPill.active');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/background:\s*var\(--accent-text\)/);
        });

        it('hides #todayView by default and shows it via #mainBar[data-view="today"]', () => {
            const baseIdx = css.indexOf('#todayView {');
            expect(baseIdx).toBeGreaterThan(-1);
            const base = css.slice(baseIdx, css.indexOf('}', baseIdx));
            expect(base).toMatch(/display:\s*none/);
            // Active rule
            expect(css).toMatch(/#mainBar\[data-view="today"\]\s+#todayView[\s\S]{0,160}display:\s*flex/);
        });

        it('hides the project view surfaces when TODAY is active', () => {
            expect(css).toMatch(
                /#mainBar\[data-view="today"\]\s+#mainList[\s\S]*#mainBar\[data-view="today"\]\s+#mobileProjHeader[\s\S]*#mainBar\[data-view="today"\]\s+#bulkDescActions[\s\S]*display:\s*none/
            );
        });

        it('places #todayView across all of #mainBar so it overlays the project content area', () => {
            // Single-row grid now; #todayView still spans every track so
            // the switch is a clean swap instead of a partial overlay.
            const idx = css.indexOf('#todayView {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/grid-row:\s*1\s*\/\s*-1/);
        });

        it('mobile #mainBar grid carries mobile header + list (no leading pill row, no title row)', () => {
            const mediaStart = css.indexOf('@media (max-width: 700px)');
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
            // Two tracks now: mobile project header, list.
            expect(block).toMatch(/#mainBar\s*\{\s*grid-template-rows:\s*auto\s+1fr/);
            // mainList anchored to the final 1fr track explicitly.
            expect(block).toMatch(/#mainList\s*\{\s*grid-row:\s*2/);
        });
    });
});
