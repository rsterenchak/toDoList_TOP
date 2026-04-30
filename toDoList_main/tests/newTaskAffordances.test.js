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

    it('renders the `+` glyph and `N` badge only on blank placeholder rows', () => {
        // Both elements are gated on `!item.tit` so committed rows don't carry
        // them, and they're stamped with aria-hidden since they're decorative.
        expect(toDoRow).toMatch(/!item\.tit\s*\?\s*document\.createElement\(\s*["']span["']\s*\)/);
        expect(toDoRow).toMatch(/addGlyph\.id\s*=\s*['"]addGlyph['"]/);
        expect(toDoRow).toMatch(/keyHintBadge\.id\s*=\s*['"]keyHintBadge['"]/);
        expect(toDoRow).toMatch(/addGlyph\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
        expect(toDoRow).toMatch(/keyHintBadge\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
        expect(toDoRow).toMatch(/addGlyph\.textContent\s*=\s*["']\+["']/);
        expect(toDoRow).toMatch(/keyHintBadge\.textContent\s*=\s*["']N["']/);
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

    it('wires a global `N` keydown listener that focuses the blank input', () => {
        // The shortcut lives in main.js (event-wiring layer) and pulls in
        // focusBlankToDoInput from toDoRow.js to do the focus.
        expect(main).toMatch(/import\s*\{[\s\S]*?focusBlankToDoInput\b[\s\S]*?\}\s*from\s*['"]\.\/toDoRow\.js['"]/);
        const keydownIdx = main.indexOf("document.addEventListener('keydown'");
        expect(keydownIdx).toBeGreaterThan(-1);
        const handler = main.slice(keydownIdx, keydownIdx + 1500);
        // Match both lower- and upper-case so a stuck shift key still works.
        expect(handler).toMatch(/e\.key\s*!==\s*['"]n['"]\s*&&\s*e\.key\s*!==\s*['"]N['"]/);
        // Skip when modifiers are involved — Cmd-N / Ctrl-N must keep their
        // browser default.
        expect(handler).toMatch(/ctrlKey/);
        expect(handler).toMatch(/metaKey/);
        expect(handler).toMatch(/altKey/);
        // Focus call + preventDefault so the letter doesn't leak into the field.
        expect(handler).toMatch(/focusBlankToDoInput\(\s*\)/);
        expect(handler).toMatch(/preventDefault\(\s*\)/);
    });

    it('skips the `N` shortcut when the user is already typing or a modal is open', () => {
        const keydownIdx = main.indexOf("document.addEventListener('keydown'");
        const handler = main.slice(keydownIdx, keydownIdx + 1500);
        // Skip when focus is in any text-entry surface so typing "n" mid-edit
        // can't yank focus out of the row the user is editing.
        expect(handler).toMatch(/['"]INPUT['"]/);
        expect(handler).toMatch(/['"]TEXTAREA['"]/);
        expect(handler).toMatch(/isContentEditable/);
        // Modals/popovers absorb the shortcut too — the user is in a focused
        // task and shouldn't be teleported out of it.
        expect(handler).toMatch(/confirmModalBackdrop/);
        expect(handler).toMatch(/changelogModalBackdrop/);
        expect(handler).toMatch(/dueDatePopover/);
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

    it('styles the `+` glyph in the accent color and disables pointer events', () => {
        // Purple tint comes from --accent (the same variable the empty-state
        // CTA and focus ring use) so the glyph stays in-theme across light/dark.
        const rule = extractTopLevelRule('#addGlyph');
        expect(rule).toMatch(/color:\s*var\(--accent\)/);
        // Decorative — clicks must fall through to the row click handler.
        expect(rule).toMatch(/pointer-events:\s*none/);
    });

    it('styles the `N` badge as a subtle bordered chip with no pointer events', () => {
        const rule = extractTopLevelRule('#keyHintBadge');
        expect(rule).toMatch(/border:[^;]*var\(--border-bright\)/);
        expect(rule).toMatch(/pointer-events:\s*none/);
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
