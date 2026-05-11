import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the focus + arrow-key + Tab-trap contract for the destructive
// confirmation modal (showConfirmModal in modals.js). Cancel — the safer
// landing for a destructive action — receives focus on open so an accidental
// Enter dismisses instead of deleting. Left / Right and Tab move focus
// between the two buttons; Tab is trapped inside the dialog so focus can
// never escape into the disabled background while the prompt is pending.
// Escape still closes the modal.
describe('confirm modal — focus + arrow-key navigation', () => {
    const modals = read('modals.js');
    const css = read('style.css');

    function extractShowConfirmModal() {
        const fnIdx = modals.indexOf('function showConfirmModal');
        if (fnIdx < 0) throw new Error('showConfirmModal not found in modals.js');
        const after = modals.slice(fnIdx);
        const nextFn = after.indexOf('\nexport function ', 1);
        return nextFn === -1 ? after : after.slice(0, nextFn);
    }

    // Returns the body of the rule whose selector list contains `selector`.
    // Tolerates grouped selectors like "#a:focus,\n#a:focus-visible { ... }"
    // — finds the selector substring, then reads from the next `{` to the
    // following `}`. Cheap O(n) scan, no per-character regex allocation.
    function extractTopLevelRule(selector) {
        const idx = css.indexOf(selector);
        if (idx === -1) throw new Error(`Selector "${selector}" not found in CSS`);
        const blockStart = css.indexOf('{', idx);
        if (blockStart === -1) throw new Error(`No opening brace after "${selector}"`);
        const blockEnd = css.indexOf('}', blockStart);
        if (blockEnd === -1) throw new Error(`No closing brace after "${selector}"`);
        return css.slice(blockStart + 1, blockEnd);
    }

    it('focuses the Cancel button on open, not the Delete/Confirm button', () => {
        const body = extractShowConfirmModal();
        // Scope this to the modal-open initialization — the section before
        // the keydown handler is declared. Otherwise the arrow-key branches
        // (which also call cancelBtn.focus / confirmBtn.focus) muddy the
        // signal of which button is focused on open.
        const initEnd = body.indexOf('let closed');
        expect(initEnd).toBeGreaterThan(-1);
        const init = body.slice(0, initEnd);
        // Cancel is the safer landing for a destructive prompt; an accidental
        // Enter immediately after the modal appears must dismiss, not delete.
        expect(init).toMatch(/cancelBtn\.focus\(\s*\)/);
        // The previous behavior — auto-focusing confirmBtn on open — must
        // not regress. Pinning its absence guards the safer default.
        expect(init).not.toMatch(/confirmBtn\.focus\(\s*\)/);
    });

    it('handles ArrowLeft and ArrowRight to move focus between Cancel and Delete', () => {
        const body = extractShowConfirmModal();
        expect(body).toMatch(/event\.key\s*===\s*['"]ArrowLeft['"]/);
        expect(body).toMatch(/event\.key\s*===\s*['"]ArrowRight['"]/);
        // ArrowLeft → Cancel, ArrowRight → Confirm (matches their visual order).
        const arrowIdx = body.search(/ArrowLeft/);
        expect(arrowIdx).toBeGreaterThan(-1);
        const slice = body.slice(arrowIdx, arrowIdx + 400);
        expect(slice).toMatch(/cancelBtn\.focus\(\s*\)/);
        expect(slice).toMatch(/confirmBtn\.focus\(\s*\)/);
        // Arrow keys must not bubble to the document — they're consumed by
        // the dialog so background handlers don't react.
        expect(slice).toMatch(/preventDefault\(\s*\)/);
        expect(slice).toMatch(/stopPropagation\(\s*\)/);
    });

    it('traps Tab inside the dialog, cycling between Cancel and Delete', () => {
        const body = extractShowConfirmModal();
        const tabIdx = body.search(/event\.key\s*===\s*['"]Tab['"]/);
        expect(tabIdx).toBeGreaterThan(-1);
        const slice = body.slice(tabIdx, tabIdx + 400);
        // Tab must not leak to the background while the prompt is pending.
        expect(slice).toMatch(/preventDefault\(\s*\)/);
        // Focus toggles between the two buttons regardless of Tab direction
        // (there are only two focusables, so a simple swap is sufficient).
        // The toggle reads the current activeElement and then focuses
        // whichever button isn't already active — both names must appear in
        // that swap expression.
        expect(slice).toMatch(/document\.activeElement\s*===\s*cancelBtn/);
        expect(slice).toMatch(/cancelBtn/);
        expect(slice).toMatch(/confirmBtn/);
        expect(slice).toMatch(/\.focus\(\s*\)/);
    });

    it('still closes on Escape', () => {
        // Existing affordance — the new keydown branches must not have
        // displaced the Escape-to-close path.
        const body = extractShowConfirmModal();
        expect(body).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
        const escIdx = body.search(/event\.key\s*===\s*['"]Escape['"]/);
        const slice = body.slice(escIdx, escIdx + 200);
        expect(slice).toMatch(/close\(\s*\)/);
    });

    it('Enter still activates the focused button via native button semantics', () => {
        // Both Cancel and Delete are <button type="button"> elements, which
        // the browser activates on Enter when focused. We don't add a
        // special-case Enter branch — instead the test pins the button-type
        // contract so a future refactor doesn't swap them for div/span and
        // silently break Enter activation.
        const body = extractShowConfirmModal();
        expect(body).toMatch(/cancelBtn\.type\s*=\s*['"]button['"]/);
        expect(body).toMatch(/confirmBtn\.type\s*=\s*['"]button['"]/);
    });

    it('exposes a :focus-visible style for both confirmation buttons', () => {
        // Per CLAUDE.md, the focused button must be clearly distinguishable
        // from the unfocused one — without this, keyboard-driven users can't
        // tell which button Enter is about to fire.
        expect(css).toMatch(/#confirmModalCancel:focus-visible/);
        expect(css).toMatch(/#confirmModalConfirm:focus-visible/);
        const cancelRule = extractTopLevelRule('#confirmModalCancel:focus-visible');
        const confirmRule = extractTopLevelRule('#confirmModalConfirm:focus-visible');
        // Both must paint a visible ring (border or shadow) — `outline: none`
        // alone is what we're correcting here.
        expect(cancelRule).toMatch(/box-shadow:|border-color:/);
        expect(confirmRule).toMatch(/box-shadow:|border-color:/);
    });
});
