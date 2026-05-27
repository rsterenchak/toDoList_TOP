import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the desktop description editor surface. On desktop the inline
// descSibling row hosts a per-row editor; the previous build used a
// single-line `<input>` element that collapsed newlines and indentation,
// breaking the paste → save → reload → copy round-trip for multi-line
// markdown drafts. Mobile already uses a `<textarea>` in its full-screen
// modal — these tests pin the desktop catch-up so the two paths share the
// same multi-line element type and persistence semantics.

describe('desktop descInput — textarea element + multi-line semantics', () => {

    const toDoRow = read('toDoRow.js');
    const css     = read('style.css');

    it('descInput is a <textarea>, not a single-line <input>', () => {
        // A single-line `<input>` element cannot hold `\n` characters by HTML
        // spec — any newlines pasted in get normalized out. A textarea is
        // required for the markdown round-trip to survive.
        expect(toDoRow).toMatch(
            /const\s+descInput\s*=\s*document\.createElement\(\s*["']textarea["']\s*\)/
        );
        // The old single-line input creation must be gone.
        expect(toDoRow).not.toMatch(
            /const\s+descInput\s*=\s*document\.createElement\(\s*["']input["']\s*\)/
        );
        // Textareas do not take a `type` attribute; the old `type = "text"`
        // line would be a leftover from the single-line input form.
        expect(toDoRow).not.toMatch(/descInput\.type\s*=\s*["']text["']/);
    });

    it('descInput disables the mobile-Safari smart-substitution heuristics that corrupt markdown', () => {
        // Same trio the mobile modal sets — without these, iOS rewrites
        // `--` to em-dash, `"foo"` to curly quotes, `...` to an ellipsis,
        // and the user's markdown drafts come back malformed.
        expect(toDoRow).toMatch(/descInput\.spellcheck\s*=\s*false/);
        expect(toDoRow).toMatch(/descInput\.autocapitalize\s*=\s*["']off["']/);
        expect(toDoRow).toMatch(
            /descInput\.setAttribute\(\s*["']autocorrect["']\s*,\s*["']off["']\s*\)/
        );
    });

    it('descInput value is assigned via the .value property (never innerHTML / innerText / textContent)', () => {
        // Spec: "Value is assigned via textarea.value = todo.desc (the
        // property), never innerHTML, innerText, or textContent." A DOM
        // round-trip via any of those would re-normalize the multi-line
        // string we're trying to preserve.
        expect(toDoRow).toMatch(/descInput\.value\s*=\s*item\[["']desc["']\]/);
        expect(toDoRow).not.toMatch(/descInput\.innerHTML\s*=/);
        expect(toDoRow).not.toMatch(/descInput\.innerText\s*=/);
        expect(toDoRow).not.toMatch(/descInput\.textContent\s*=/);
    });

    it('persistence handlers store textarea.value as-is (no .trim) so newlines / indentation survive', () => {
        // Match each persistence path's body window and verify .trim() is
        // not in the assignment. Trimming would strip a trailing newline
        // the user explicitly typed, breaking the round-trip acceptance test.
        const keyupBlock = toDoRow.match(
            /descInput\.addEventListener\(\s*["']keyup["'][\s\S]{0,400}?\}\s*\)/
        );
        expect(keyupBlock).toBeTruthy();
        expect(keyupBlock[0]).toMatch(/item\.desc\s*=\s*descInput\.value\b/);
        expect(keyupBlock[0]).not.toMatch(/item\.desc\s*=\s*descInput\.value\.trim\(/);

        const blurBlock = toDoRow.match(
            /descInput\.addEventListener\(\s*["']blur["'][\s\S]{0,400}?\}\s*\)/
        );
        expect(blurBlock).toBeTruthy();
        expect(blurBlock[0]).toMatch(/item\.desc\s*=\s*descInput\.value\b/);
        expect(blurBlock[0]).not.toMatch(/item\.desc\s*=\s*descInput\.value\.trim\(/);
    });

    it('descInput blur handler mirrors the desc edit to Supabase via listLogic.editToDoItem', () => {
        // Regression: descriptions added to todos in non-first projects
        // were vanishing on hard refresh because the desktop blur handler
        // only wrote localStorage. The next hydrateFromSupabase pulled the
        // canonical backend snapshot — which still had an empty desc since
        // the edit never reached Supabase — and overwrote the local draft.
        // Mirrors the mobile descriptor modal's onSave path (see
        // mobileDescEditorModal.test.js's "the row's onSave callback
        // routes the desc write through listLogic.editToDoItem" case).
        // Ctrl+Enter and Escape both call descInput.blur(), so this single
        // boundary covers every exit path.
        const blurBlock = toDoRow.match(
            /descInput\.addEventListener\(\s*["']blur["'][\s\S]{0,600}?\}\s*\)/
        );
        expect(blurBlock).toBeTruthy();
        expect(blurBlock[0]).toMatch(/listLogic\.saveToStorage\s*\(/);
        expect(blurBlock[0]).toMatch(/listLogic\.editToDoItem\s*\(\s*toDoName\s*,\s*item\s*\)/);
    });

    it('plain Enter falls through (textarea inserts a newline); only Ctrl/Cmd+Enter commits', () => {
        // Locate the FIRST descInput keydown listener — the second one is
        // the Escape handler. The Enter branch must require a modifier so
        // plain Enter keeps the natural textarea newline-insertion behavior.
        const firstKeydownIdx = toDoRow.indexOf('descInput.addEventListener("keydown"');
        expect(firstKeydownIdx).toBeGreaterThan(-1);
        const enterBlock = toDoRow.slice(firstKeydownIdx, firstKeydownIdx + 600);
        // Branches on Enter
        expect(enterBlock).toMatch(/event\.key\s*!==\s*["']Enter["']/);
        // Requires a Ctrl or Cmd modifier
        expect(enterBlock).toMatch(/event\.ctrlKey/);
        expect(enterBlock).toMatch(/event\.metaKey/);
        // Commits without .trim() so a trailing newline survives the save.
        expect(enterBlock).toMatch(/item\.desc\s*=\s*descInput\.value\b/);
        expect(enterBlock).not.toMatch(/item\.desc\s*=\s*descInput\.value\.trim\(/);
    });
});

describe('desktop descInput — CSS preserves multi-line whitespace', () => {

    const css = read('style.css');

    it('#descInput uses white-space: pre-wrap so newlines and indentation render visibly', () => {
        // Spec: "<textarea> element with white-space: pre-wrap." Anything
        // else (normal, nowrap, pre) either collapses whitespace, refuses
        // to wrap long lines, or both.
        const ruleIdx = css.indexOf('#descInput {');
        expect(ruleIdx).toBeGreaterThan(-1);
        const closeIdx = css.indexOf('}', ruleIdx);
        const rule = css.slice(ruleIdx, closeIdx);
        expect(rule).toMatch(/white-space:\s*pre-wrap/);
    });

    it('#descInput uses a monospace font so indentation reads correctly in drafts', () => {
        const ruleIdx = css.indexOf('#descInput {');
        const closeIdx = css.indexOf('}', ruleIdx);
        const rule = css.slice(ruleIdx, closeIdx);
        // Either SpaceMono (the project monospace) or a generic monospace
        // declaration in the family chain.
        expect(rule).toMatch(/font-family:\s*[^;]*monospace/);
    });
});
