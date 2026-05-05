import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for keyboard navigation onto and off of the "+" add-
// project button at the bottom of the sidebar. ArrowDown on the last
// committed project row should fall through to focus the projButton;
// pressing Enter while the projButton is focused should trigger the same
// new-project creation flow a click does; ArrowUp on the projButton
// should return focus to the last project row. This rounds out keyboard
// navigation so users can add a project without reaching for the mouse.
describe('projButton arrow-key navigation', () => {
    const main = read('main.js');
    const css = read('style.css');

    function extractFocusableProjButtonSetup() {
        // The block where projButton.id is set is also where its focusability
        // attributes belong, so the whole stretch should appear together.
        const idIdx = main.indexOf("projButton.id = 'projButton'");
        expect(idIdx).toBeGreaterThan(-1);
        return main.slice(idIdx, idIdx + 600);
    }

    function extractSideMainKeydown() {
        // The sideMain handler is identified by its delegated check for
        // #projChild on e.target.closest — distinct from the document-level
        // arrow handlers that branch on ArrowLeft/ArrowRight or operate on
        // todo rows.
        const sig = "sideMain.addEventListener('keydown'";
        const start = main.indexOf(sig);
        expect(start).toBeGreaterThan(-1);
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
        throw new Error('unterminated sideMain keydown handler');
    }

    function extractProjButtonKeydown() {
        // projButton.addEventListener('keydown' — the keyboard listener
        // attached directly to the "+" element. There may be other
        // projButton listeners (mouseenter/mouseleave/click), so anchor on
        // the keydown signature specifically.
        const sig = "projButton.addEventListener('keydown'";
        const start = main.indexOf(sig);
        expect(start).toBeGreaterThan(-1);
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
        throw new Error('unterminated projButton keydown handler');
    }

    it('marks projButton focusable so the "+" can receive keyboard focus', () => {
        const setup = extractFocusableProjButtonSetup();
        // tabindex=0 puts it in the document tab order; an aria-label gives
        // assistive tech something to announce since the button is a div
        // with a CSS-drawn glyph and no inner text.
        expect(setup).toMatch(/projButton\.setAttribute\(\s*['"]tabindex['"]\s*,\s*['"]0['"]\s*\)/);
        expect(setup).toMatch(/projButton\.setAttribute\(\s*['"]aria-label['"]/);
    });

    it('ArrowDown on the last project row moves focus to projButton', () => {
        const body = extractSideMainKeydown();
        // The handler must reach for #projButton in the no-next-row branch
        // and call .focus() on it — anything else (e.g., scrolling, or
        // returning silently) leaves the keyboard user stranded.
        expect(body).toMatch(/['"]ArrowDown['"]/);
        expect(body).toMatch(/getElementById\(\s*['"]projButton['"]\s*\)/);
        expect(body).toMatch(/projBtn\.focus\(\s*\)|projButton\.focus\(\s*\)/);
    });

    it('the no-next-row branch only redirects on ArrowDown, not ArrowUp', () => {
        const body = extractSideMainKeydown();
        // ArrowUp off the first project row must not wrap to the projButton —
        // that would let the user spin past the add-project surface in the
        // wrong direction. The redirect is gated to ArrowDown only.
        const redirectIdx = body.indexOf("getElementById('projButton')");
        expect(redirectIdx).toBeGreaterThan(-1);
        const window = body.slice(Math.max(0, redirectIdx - 200), redirectIdx);
        expect(window).toMatch(/['"]ArrowDown['"]/);
    });

    it('projButton has its own keydown listener handling Enter and ArrowUp', () => {
        const body = extractProjButtonKeydown();
        expect(body).toMatch(/['"]Enter['"]/);
        expect(body).toMatch(/['"]ArrowUp['"]/);
    });

    it('Enter on projButton synthesizes the click flow rather than reimplementing it', () => {
        const body = extractProjButtonKeydown();
        // Routing through .click() reuses the single source of truth for
        // new-project creation (the click handler that adds the row, focuses
        // the input, etc.) so keyboard and mouse paths can never drift.
        expect(body).toMatch(/projButton\.click\(\s*\)/);
    });

    it('ArrowUp on projButton returns focus to the last project row', () => {
        const body = extractProjButtonKeydown();
        // The last row is queried fresh on each press — projects can be
        // added or removed between presses, so a cached reference would go
        // stale.
        expect(body).toMatch(/sideMain\.querySelectorAll\(\s*['"]#projChild['"]\s*\)/);
        expect(body).toMatch(/last\.focus\(\s*\)/);
    });

    it('ignores modifier-key chords so Ctrl/Shift/Alt+Arrow combos pass through', () => {
        const body = extractProjButtonKeydown();
        // Mirrors the pattern in the cross-pane focus shortcut handler —
        // unmodified arrows / Enter only, so OS-level shortcuts and
        // selection chords are never consumed.
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/shiftKey/);
    });

    it('stops propagation so the document-level todo arrow handler does not also fire', () => {
        const body = extractProjButtonKeydown();
        // Without stopPropagation, ArrowUp on the projButton would bubble
        // to the document handler that drives todo nav and steal focus to
        // a todo row instead of returning to the last project.
        expect(body).toMatch(/stopPropagation\(\s*\)/);
    });

    it('style.css ships a :focus-visible treatment for the "+" button', () => {
        // Without a visible focus ring the keyboard caret would disappear
        // when the user arrows onto the projButton — invisible focus is a
        // dead end. Mirrors the #projChild:focus-visible pattern already
        // used for project rows.
        expect(css).toMatch(/#projButton:focus-visible[\s\S]*outline:\s*2px\s+solid/);
    });
});
