import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the new-task input affordances: a leading purple `+`
// glyph, an inviting placeholder, and a trailing `N` keyboard-hint badge on
// the blank placeholder row, plus a global `N` shortcut that focuses the
// blank input when the user is not already typing somewhere else. The cues
// are decorative — clicks on them must fall through to the row click handler
// that focuses the input, and they must be stripped from the DOM once the
// row commits so they don't outlive the blank placeholder state.
describe('new-task input affordances — `+` glyph, placeholder, `N` shortcut', () => {
    const main = read('main.js');
    const toDoRow = read('toDoRow.js');
    const css = read('style.css');

    it('updates the placeholder to invite a task and surface the Enter shortcut', () => {
        expect(toDoRow).toMatch(/toDoInput\.placeholder\s*=\s*['"]Add a task — press Enter['"]/);
        // The legacy "New Item" copy must be retired so it can't shadow the new one.
        expect(toDoRow).not.toMatch(/toDoInput\.placeholder\s*=\s*['"]New Item['"]/);
    });

    it('renders the `+` glyph and `Ctrl+\\` chord badge only on blank placeholder rows', () => {
        // Both elements are gated on `!item.tit` so committed rows don't carry
        // them, and they're stamped with aria-hidden since they're decorative.
        expect(toDoRow).toMatch(/!item\.tit\s*\?\s*document\.createElement\(\s*["']span["']\s*\)/);
        expect(toDoRow).toMatch(/addGlyph\.id\s*=\s*['"]addGlyph['"]/);
        expect(toDoRow).toMatch(/keyHintBadge\.id\s*=\s*['"]keyHintBadge['"]/);
        expect(toDoRow).toMatch(/addGlyph\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
        expect(toDoRow).toMatch(/keyHintBadge\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
        expect(toDoRow).toMatch(/addGlyph\.textContent\s*=\s*["']\+["']/);
        // Badge mirrors the always-to-placeholder chord (Ctrl + \) — two
        // <kbd> chips separated by a `+` span. Pin the literal labels so
        // the badge can't silently drift away from the actual keybinding in
        // main.js (escape twice: once for JS string, once for the regex).
        expect(toDoRow).toMatch(/textContent\s*=\s*["']Ctrl["']/);
        expect(toDoRow).toMatch(/textContent\s*=\s*['"]\\\\['"]/);
        expect(toDoRow).toMatch(/textContent\s*=\s*["']\+["']/);
    });

    it('strips the affordance cues from the DOM when the blank row commits', () => {
        // After the user presses Enter, the row becomes a real todo and the
        // glyph/badge would mislead — they get removed alongside the existing
        // close-button / due-pill reveal logic.
        const enterIdx = toDoRow.indexOf('toDoInput keydown — Enter to commit title');
        expect(enterIdx).toBeGreaterThan(-1);
        const handler = toDoRow.slice(enterIdx, enterIdx + 3000);
        expect(handler).toMatch(/addGlyph\b[\s\S]*?\.remove\(\)/);
        expect(handler).toMatch(/keyHintBadge\b[\s\S]*?\.remove\(\)/);
    });

    it('wires a global `\\` keydown toggle that flips between the sidebar and the new-task input', () => {
        // The shortcut lives in main.js (event-wiring layer) and pulls in
        // focusBlankToDoInput from toDoRow.js to do the placeholder focus.
        expect(main).toMatch(/import\s*\{[\s\S]*?focusBlankToDoInput\b[\s\S]*?\}\s*from\s*['"]\.\/toDoRow\.js['"]/);
        // Identify the toggle uniquely — only the toggle has the second
        // direction (focus a `#projChild`); the companion `Ctrl+\` chord
        // handler in this file shares everything else but only goes one way.
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"],[\s\S]*?\}\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]\\\\['"]/.test(b)
                && /focusBlankToDoInput/.test(b)
                && /#projChild/.test(b);
        });
        expect(handler).toBeTruthy();
        // Toggle behaviour requires both directions: focus the placeholder
        // when in the sidebar, and focus a #projChild when in the placeholder.
        expect(handler).toMatch(/focusBlankToDoInput\(\s*\)/);
        expect(handler).toMatch(/#projChild/);
        // preventDefault so the literal `\` doesn't leak into the page.
        expect(handler).toMatch(/preventDefault\(\s*\)/);
        // Modals/popovers absorb the shortcut — the user is in a focused
        // task and shouldn't be teleported out of it.
        expect(handler).toMatch(/isAnyModalOrPopoverOpen/);
    });

    it('also wires a `Ctrl+\\` chord handler as the always-to-placeholder fast path', () => {
        // Companion to the bare-\ toggle: from a committed todo, the toggle
        // routes to the sidebar (default direction), so users mid-list need
        // a one-step "back to the new-task line" shortcut. The chord handler
        // is identifiable by its `ctrlKey || metaKey` requirement and the
        // absence of the toggle's `#projChild` second branch.
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"],[\s\S]*?\}\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]\\\\['"]/.test(b)
                && /focusBlankToDoInput/.test(b)
                && !/#projChild/.test(b);
        });
        expect(handler).toBeTruthy();
        // Require Ctrl OR Cmd (Mac), and exclude Alt/Shift to keep the chord
        // unambiguous and to leave the bare `\` toggle alone.
        expect(handler).toMatch(/ctrlKey/);
        expect(handler).toMatch(/metaKey/);
        expect(handler).toMatch(/altKey/);
        expect(handler).toMatch(/shiftKey/);
        expect(handler).toMatch(/focusBlankToDoInput\(\s*\)/);
        expect(handler).toMatch(/preventDefault\(\s*\)/);
        expect(handler).toMatch(/isAnyModalOrPopoverOpen/);
    });

    function extractTopLevelRule(selector) {
        let depth = 0;
        for (let i = 0; i < css.length; i++) {
            const c = css[i];
            if (c === '{') { depth++; continue; }
            if (c === '}') { depth--; continue; }
            if (depth !== 0) continue;
            if (css.startsWith(selector, i) && /[\s{]/.test(css[i + selector.length] || '')) {
                const blockStart = css.indexOf('{', i);
                const blockEnd = css.indexOf('}', blockStart);
                return css.slice(blockStart + 1, blockEnd);
            }
        }
        throw new Error(`Top-level rule for "${selector}" not found`);
    }

    it('styles the `+` glyph in a muted grey and disables pointer events', () => {
        // Muted grey via --text-muted reads as an unobtrusive affordance hint
        // alongside the input's grey placeholder, instead of competing with
        // the accent-coloured controls in the row.
        const rule = extractTopLevelRule('#addGlyph');
        expect(rule).toMatch(/color:\s*var\(--text-muted\)/);
        // Decorative — clicks must fall through to the row click handler.
        expect(rule).toMatch(/pointer-events:\s*none/);
    });

    it('styles the chord badge as two subtle bordered chips with no pointer events', () => {
        // Top-level `#keyHintBadge` is a flex container holding two <kbd>
        // chips and a separator; the chip styling lives on the descendant
        // selector `#keyHintBadge kbd` so each key reads as its own
        // bordered key-cap (matching the shortcut modal's two-key layout).
        const containerRule = extractTopLevelRule('#keyHintBadge');
        expect(containerRule).toMatch(/pointer-events:\s*none/);
        const kbdRule = extractTopLevelRule('#keyHintBadge kbd');
        expect(kbdRule).toMatch(/border:[^;]*var\(--border-bright\)/);
    });

    it('hides the `N` badge below 480px so touch users do not see a desktop-only hint', () => {
        // Mobile users won't use the keyboard shortcut, so the badge becomes
        // visual noise. Keep the `+` glyph visible.
        const phoneRules = css.match(/@media\s*\(\s*max-width:\s*480px\s*\)\s*\{([\s\S]*?)\n\}/g) || [];
        const hides = phoneRules.some(function(block) {
            return /#keyHintBadge\s*\{[^}]*display:\s*none/.test(block);
        });
        expect(hides).toBe(true);
    });
});
