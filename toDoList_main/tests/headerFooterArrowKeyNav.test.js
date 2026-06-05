import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the boundary arrow-key transitions that connect the
// projects sidebar, the header button row, and the footer version label.
// Tab order is unchanged — these arrow handlers are additive so keyboard
// users can flow between regions without reaching for the mouse:
//   • ArrowUp from the top project row jumps to sidebarToggle.
//   • ArrowLeft / ArrowRight cycle across the seven header controls
//     (hamburger, PROJECTS / INBOX / CALENDAR pills, pomodoro, music,
//     settings).
//   • ArrowDown from projButton lands on the footer version button.
describe('header / footer arrow-key navigation', () => {
    const main = read('main.js');

    function extractBlock(signature) {
        const start = main.indexOf(signature);
        if (start === -1) throw new Error('signature not found: ' + signature);
        const bodyStart = main.indexOf('{', start);
        let depth = 0;
        for (let i = bodyStart; i < main.length; i++) {
            const c = main[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return main.slice(bodyStart, i + 1);
            }
        }
        throw new Error('unterminated block for: ' + signature);
    }

    function extractSideMainKeydown() {
        return extractBlock("sideMain.addEventListener('keydown'");
    }

    function extractProjButtonKeydown() {
        return extractBlock("projButton.addEventListener('keydown'");
    }

    function extractNavKeydown() {
        return extractBlock("nav.addEventListener('keydown'");
    }

    function extractSidebarToggleKeydown() {
        return extractBlock("sidebarToggle.addEventListener('keydown'");
    }

    it('ArrowUp off the first project row jumps to sidebarToggle', () => {
        const body = extractSideMainKeydown();
        // The no-next-row branch handles BOTH boundary directions: ArrowDown
        // already routes to projButton; ArrowUp must route to sidebarToggle
        // so keyboard users can reach the header chain. Anything else (e.g.,
        // returning silently) leaves them stranded on the first row.
        expect(body).toMatch(/getElementById\(\s*['"]sidebarToggle['"]\s*\)/);
        expect(body).toMatch(/sidebarToggleEl\.focus\(\s*\)|sidebarToggle\.focus\(\s*\)/);
    });

    it('the sidebarToggle redirect only fires on ArrowUp, not on ArrowDown', () => {
        const body = extractSideMainKeydown();
        // ArrowDown off the last row routes to projButton, not sidebarToggle.
        // The redirect must be gated to ArrowUp specifically — falling
        // through on ArrowDown would shoot focus across the entire chrome
        // in the wrong direction.
        const idx = body.indexOf("getElementById('sidebarToggle')");
        expect(idx).toBeGreaterThan(-1);
        const window = body.slice(Math.max(0, idx - 300), idx);
        // Within the lead-up we expect either an explicit ArrowUp branch or
        // the else half of the ArrowDown fork.
        expect(/['"]ArrowUp['"]|else\s*\{/.test(window)).toBe(true);
    });

    it('projButton ArrowDown lands on the footer version button', () => {
        const body = extractProjButtonKeydown();
        // The label area uses the existing focusable parent (#footVersion,
        // tabindex=0, role=button) so the existing #footVersion:focus-visible
        // CSS lights up the dotted underline on #footVersionLabel without
        // any new focus-ring styling.
        expect(body).toMatch(/['"]ArrowDown['"]/);
        expect(body).toMatch(/getElementById\(\s*['"]footVersion['"]\s*\)/);
        expect(body).toMatch(/\.focus\(\s*\)/);
    });

    it('projButton ArrowDown stops propagation so the document arrow handler does not also fire', () => {
        const body = extractProjButtonKeydown();
        const idx = body.indexOf("getElementById('footVersion')");
        expect(idx).toBeGreaterThan(-1);
        const window = body.slice(Math.max(0, idx - 200), idx);
        // Without stopPropagation, the document-level todo arrow handler
        // would also fire and steal focus to the first todo row — focus
        // would never reach the footer.
        expect(window).toMatch(/stopPropagation\(\s*\)/);
        expect(window).toMatch(/preventDefault\(\s*\)/);
    });

    it('header has a delegated ArrowLeft / ArrowRight listener on nav', () => {
        const body = extractNavKeydown();
        expect(body).toMatch(/['"]ArrowLeft['"]/);
        expect(body).toMatch(/['"]ArrowRight['"]/);
    });

    it('nav handler walks all seven header controls in on-screen order', () => {
        const body = extractNavKeydown();
        // Order must mirror the visual layout: hamburger, the three
        // view-switcher pills (PROJECTS, INBOX, CALENDAR — that's the
        // sequence #viewSwitcher appendChilds them in), pomodoro, music,
        // settings. A different order would make ArrowRight land on the
        // wrong neighbor relative to where focus appears on screen.
        const seq = body.match(/sidebarToggle[\s\S]*?viewPillProjects[\s\S]*?viewPillInbox[\s\S]*?viewPillCalendar[\s\S]*?pomodoroToggle[\s\S]*?musicToggle[\s\S]*?settingsToggle/);
        expect(seq).toBeTruthy();
    });

    it('nav handler ignores modifier-key chords and bails when a modal is open', () => {
        const body = extractNavKeydown();
        // Unmodified arrows only — Shift+Arrow / Ctrl+Arrow are reserved
        // for native selection and word-jump behavior. While a popover is
        // open, the in-popover focus management owns the keystrokes.
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/shiftKey/);
        expect(body).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
    });

    it('nav handler stops propagation so the cross-pane handler does not also fire', () => {
        const body = extractNavKeydown();
        // The document-level ArrowLeft/ArrowRight cross-pane handler would
        // otherwise jump focus to a project row or the new-task input,
        // hijacking the in-header walk.
        expect(body).toMatch(/stopPropagation\(\s*\)/);
        expect(body).toMatch(/preventDefault\(\s*\)/);
    });

    it('nav handler bails when the keystroke originates outside the seven header controls', () => {
        const body = extractNavKeydown();
        // Without an in-order check, an Arrow press while focus was on an
        // unrelated nav child (e.g., a transient input) would still pick a
        // neighbor and yank focus. A simple indexOf gate keeps the handler
        // scoped to the named controls.
        expect(body).toMatch(/indexOf/);
        expect(body).toMatch(/===\s*-1|=== -1/);
    });

    it('sidebarToggle ArrowDown focuses the first project row, not the first todo', () => {
        // Spatial inverse of the existing sideMain ArrowUp → sidebarToggle
        // transition: the projects sidebar sits directly below the toggle,
        // so ArrowDown out of the toggle must enter the sidebar at its top.
        // Without a dedicated handler the document-level todo arrow-nav
        // handler catches the keystroke and lands focus on the first todo
        // row in the main pane instead, skipping the sidebar entirely.
        const body = extractSidebarToggleKeydown();
        expect(body).toMatch(/['"]ArrowDown['"]/);
        expect(body).toMatch(/['"]#projChild['"]/);
        // The handler must not target todo rows or it would just reproduce
        // the bug it exists to fix.
        expect(body).not.toMatch(/#toDoChild/);
    });

    it('sidebarToggle ArrowDown stops propagation so the document arrow handler does not also fire', () => {
        const body = extractSidebarToggleKeydown();
        // Without stopPropagation, the document-level todo arrow-nav
        // handler also runs and yanks focus to the first todo row after
        // we hand focus to the project — focus would never settle in the
        // sidebar.
        expect(body).toMatch(/stopPropagation\(\s*\)/);
        expect(body).toMatch(/preventDefault\(\s*\)/);
    });

    it('sidebarToggle ArrowDown handler ignores modifier-key chords', () => {
        const body = extractSidebarToggleKeydown();
        // Unmodified arrow only — Shift/Ctrl/Meta/Alt+Arrow are reserved
        // for native selection and OS-level chords. Bailing on modifiers
        // mirrors the gate the nav and projButton handlers already use.
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/shiftKey/);
    });

    // Reaches into the view-aware Inbox / Calendar keydown handler —
    // identified by referencing both #inboxSections and #calendarGrid.
    // Distinct from the Projects-view handler.
    function extractViewArrowHandler() {
        const re = /document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function\s*\([^)]*\)\s*\{/g;
        let match;
        while ((match = re.exec(main)) !== null) {
            const bodyStart = match.index + match[0].length - 1;
            let depth = 0;
            for (let i = bodyStart; i < main.length; i++) {
                const c = main[i];
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        const body = main.slice(bodyStart + 1, i);
                        if (/inboxSections/.test(body) && /calendarGrid/.test(body)) {
                            return body;
                        }
                        break;
                    }
                }
            }
        }
        throw new Error('view-aware arrow-nav keydown handler not found in main.js');
    }

    it('Inbox: ArrowUp on the first row escapes up to #viewPillInbox', () => {
        // Spatial inverse of dropFocusIntoMainView: the INBOX pill sits
        // directly above the inbox list, so ArrowUp out of the first row
        // must escape back into the header chrome. Without this exit,
        // keyboard users on mobile (where the sidebar is collapsed and
        // the sideMain → sidebarToggle ladder isn't available) have no
        // upward escape from the inbox list.
        const body = extractViewArrowHandler();
        expect(body).toMatch(/getElementById\(\s*['"]viewPillInbox['"]\s*\)/);
    });

    it('Inbox: the ArrowUp escape stops propagation so the cross-pane handler does not also fire', () => {
        const body = extractViewArrowHandler();
        const idx = body.indexOf("getElementById('viewPillInbox')");
        expect(idx).toBeGreaterThan(-1);
        // Search forward from the lookup site for the guards that gate
        // the focus call — without stopPropagation the cross-pane
        // ArrowLeft/ArrowRight handler would also fire and clobber the
        // pill focus we just placed.
        const window = body.slice(idx, idx + 400);
        expect(window).toMatch(/stopPropagation\(\s*\)/);
        expect(window).toMatch(/preventDefault\(\s*\)/);
    });

    it('Calendar: ArrowUp on a top-row cell escapes to the side-nearest month-nav arrow', () => {
        // Boundary is side-aware rather than always-pill: the month-nav
        // arrow pair (#calendarPrev / #calendarNext) sits between the
        // pill and the grid, so ArrowUp from a top-row cell must land
        // on whichever arrow is spatially nearer. Cells in columns 0–2
        // (Sun/Mon/Tue) escape up to #calendarPrev; cells in columns
        // 3–6 (Wed/Thu/Fri/Sat) escape up to #calendarNext. The pill
        // itself is reached via a second ArrowUp from the arrows.
        const body = extractViewArrowHandler();
        // Locate the top-row ArrowUp branch by its `idx < 7` predicate
        // so the assertions only consider that branch (not, for example,
        // arrow strings that might appear in unrelated handler logic).
        const branchMatch = body.match(/if\s*\(\s*isUp\s*&&\s*idx\s*<\s*7\s*\)\s*\{[\s\S]*?\n\s*\}/);
        expect(branchMatch).toBeTruthy();
        expect(branchMatch[0]).toMatch(/['"]calendarPrev['"]|calendarPrevBtn/);
        expect(branchMatch[0]).toMatch(/['"]calendarNext['"]|calendarNextBtn/);
    });

    it('Calendar: the ArrowUp escape stops propagation so the cross-pane handler does not also fire', () => {
        const body = extractViewArrowHandler();
        // Locate the top-row ArrowUp branch by its `idx < 7` predicate.
        const branchMatch = body.match(/if\s*\(\s*isUp\s*&&\s*idx\s*<\s*7\s*\)\s*\{[\s\S]*?\n\s*\}/);
        expect(branchMatch).toBeTruthy();
        // Without stopPropagation, the cross-pane ArrowLeft/ArrowRight
        // handler would also fire and could yank focus into the
        // projects list or new-task input. Without preventDefault, the
        // keystroke would still scroll the page.
        expect(branchMatch[0]).toMatch(/stopPropagation\(\s*\)/);
        expect(branchMatch[0]).toMatch(/preventDefault\(\s*\)/);
    });

    // Pins the ArrowDown drop-in target for each pill. The INBOX view
    // rendering is not built yet, so its branch in firstFocusableInActiveMainView
    // returns null — there is nothing to focus until the INBOX placeholder
    // ships in a follow-up entry, and the helper must not reach for the
    // now-nonexistent .todayRow rows. CALENDAR must fall back to the first
    // in-month cell when no .isSelected cell exists so the cold-start case
    // (no prior selection) lands inside the visible month rather than on a
    // dimmed leading day from the prior month.
    function extractFirstFocusableHelper() {
        return extractBlock("function firstFocusableInActiveMainView");
    }

    function extractDropFocusHandler() {
        return extractBlock("function dropFocusIntoMainView");
    }

    it("INBOX: pill ArrowDown finds no focusable target (view rendering not built yet)", () => {
        const body = extractFirstFocusableHelper();
        // With no INBOX dashboard yet, the inbox branch returns null
        // immediately instead of querying for .todayRow rows that the view
        // does not render.
        const inboxBranch = body.match(/view === ['"]inbox['"][\s\S]*?return null;/);
        expect(inboxBranch).toBeTruthy();
        expect(inboxBranch[0]).not.toMatch(/querySelector\(\s*['"]\.todayRow\.todoRowCard['"]\s*\)/);
        expect(inboxBranch[0]).not.toMatch(/querySelector\(\s*['"]\.todayRowTitle['"]\s*\)/);
    });

    it("INBOX: pill ArrowDown marks the row .todo-active so the next ArrowDown advances rows", () => {
        const body = extractDropFocusHandler();
        // Without the .todo-active marker, the document-level Today nav
        // handler treats the row as "not the current row" on the next
        // ArrowDown (because the row sees focus at the row level but no
        // active marker) and re-anchors instead of stepping forward.
        expect(body).toMatch(/classList\.add\(\s*['"]todo-active['"]\s*\)/);
        expect(body).toMatch(/todayRow/);
    });

    it("CALENDAR: pill ArrowDown falls back to the first in-month cell when no .isSelected cell exists", () => {
        const body = extractFirstFocusableHelper();
        // The cold-start case (no prior selection) must skip the leading
        // days from the prior month so focus lands on a cell the user can
        // actually interact with in the visible month. .outOfMonth cells
        // are dimmed and feel like a dead target on first keystroke.
        const calendarBranch = body.match(/view === ['"]calendar['"][\s\S]*?return null;/);
        expect(calendarBranch).toBeTruthy();
        expect(calendarBranch[0]).toMatch(/\.calendarCell\.isSelected/);
        expect(calendarBranch[0]).toMatch(/\.calendarCell:not\(\.outOfMonth\)/);
    });
});
