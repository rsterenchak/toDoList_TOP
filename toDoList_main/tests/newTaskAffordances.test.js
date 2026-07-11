import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the new-task input affordances: a leading purple `+`
// glyph and an inviting placeholder on the blank placeholder row. The `+`
// glyph is decorative — clicks on it must fall through to the row click
// handler that focuses the input, and it must be stripped from the DOM once
// the row commits so it doesn't outlive the blank placeholder state. The
// previous Ctrl+\ chord badge has been retired in favour of the global
// ArrowLeft / ArrowRight cross-pane focus shortcuts (see
// arrowFocusShortcuts.test.js for that contract).
describe('new-task input affordances — `+` glyph and placeholder', () => {
    const main = read('main.js');
    const toDoRow = read('toDoRow.js');
    const css = read('style.css');

    it('updates the placeholder to invite a task and surface the Enter shortcut', () => {
        expect(toDoRow).toMatch(/toDoInput\.placeholder\s*=\s*['"]Add a task — press Enter['"]/);
        // The legacy "New Item" copy must be retired so it can't shadow the new one.
        expect(toDoRow).not.toMatch(/toDoInput\.placeholder\s*=\s*['"]New Item['"]/);
    });

    it('drops the "press Enter" hint from the placeholder at mobile widths (<1024)', () => {
        // Touch has no Enter-key affordance, so a blank placeholder row reads
        // simply "Add a task" below 1024px; desktop keeps the full hint above.
        expect(toDoRow).toMatch(/window\.innerWidth\s*<\s*1024[\s\S]{0,120}toDoInput\.placeholder\s*=\s*['"]Add a task['"]/);
    });

    it('renders the `+` glyph only on blank placeholder rows', () => {
        // Glyph is gated on `!item.tit` so committed rows don't carry it,
        // and is stamped with aria-hidden since it's decorative.
        expect(toDoRow).toMatch(/!item\.tit\s*\?\s*document\.createElement\(\s*["']span["']\s*\)/);
        expect(toDoRow).toMatch(/addGlyph\.id\s*=\s*['"]addGlyph['"]/);
        expect(toDoRow).toMatch(/addGlyph\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
        expect(toDoRow).toMatch(/addGlyph\.textContent\s*=\s*["']\+["']/);
    });

    it('no longer renders the legacy Ctrl+\\ chord hint badge on the placeholder row', () => {
        // The chord badge was retired alongside the Ctrl+\ shortcut. The new
        // ArrowLeft / ArrowRight focus shortcuts don't need an inline hint —
        // arrow keys are a universally-recognised navigation pattern and
        // anything more on the placeholder row competes with the `+` glyph.
        expect(toDoRow).not.toMatch(/keyHintBadge/);
    });

    it('strips the affordance cue from the DOM when the blank row commits', () => {
        // After the user presses Enter, the row becomes a real todo and the
        // glyph would mislead — it gets removed alongside the existing
        // close-button / due-pill reveal logic.
        const enterIdx = toDoRow.indexOf('toDoInput keydown — Enter to commit title');
        expect(enterIdx).toBeGreaterThan(-1);
        const handler = toDoRow.slice(enterIdx, enterIdx + 3000);
        expect(handler).toMatch(/addGlyph\b[\s\S]*?\.remove\(\)/);
        expect(handler).not.toMatch(/keyHintBadge/);
    });

    it('strips the voice mic button from the DOM when the blank row commits', () => {
        // The mic is mounted only on the blank placeholder (gated on
        // `!item.tit`), but committing reuses the same row DOM in place, so
        // without an explicit removal it lingers on the now-committed todo.
        // It must be stripped alongside the `+` glyph in the Enter handler.
        const enterIdx = toDoRow.indexOf('toDoInput keydown — Enter to commit title');
        expect(enterIdx).toBeGreaterThan(-1);
        const handler = toDoRow.slice(enterIdx, enterIdx + 3500);
        expect(handler).toMatch(/micBtn\b[\s\S]*?\.remove\(\)/);
    });

    it('drops the bare `\\` toggle and the Ctrl+\\ chord handler from main.js', () => {
        // The cross-pane focus model now lives on ArrowLeft / ArrowRight —
        // the backslash bindings were the previous spec, superseded by this
        // task. Pin their absence so they can't silently come back.
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"],[\s\S]*?\}\s*\)\s*;/g) || [];
        const backslashBlock = blocks.find(function(b) { return /e\.key\s*!==\s*['"]\\\\['"]/.test(b); });
        expect(backslashBlock).toBeFalsy();
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

    it('removes the chord-badge styling now that the badge itself is gone', () => {
        // The `#keyHintBadge` rules in style.css existed only to support the
        // retired chord hint; with the badge removed they'd be dead weight.
        expect(css).not.toMatch(/#keyHintBadge\b/);
    });
});
