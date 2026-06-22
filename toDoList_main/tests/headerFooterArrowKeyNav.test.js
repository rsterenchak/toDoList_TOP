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
//   • ArrowLeft / ArrowRight cycle across the five header controls
//     (hamburger, PROJECTS pill, pomodoro, music, settings).
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

    it('nav handler walks all five header controls in on-screen order', () => {
        const body = extractNavKeydown();
        // Order must mirror the visual layout: hamburger, the PROJECTS
        // view-switcher pill, pomodoro, music, settings. A different order
        // would make ArrowRight land on the wrong neighbor relative to
        // where focus appears on screen.
        const seq = body.match(/sidebarToggle[\s\S]*?viewPillProjects[\s\S]*?pomodoroToggle[\s\S]*?musicToggle[\s\S]*?settingsToggle/);
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
});
