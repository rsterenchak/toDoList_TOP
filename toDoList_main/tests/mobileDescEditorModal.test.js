import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the mobile description editor modal — a touch-device editor that
// opens when a user taps a committed todo row body on `(pointer: coarse)`
// devices. The descSibling's single-line input can't host multi-line
// markdown drafting; the modal replaces it on touch with a 16px monospace
// textarea, a Copy-as-TODO.md-entry action, and a confirmation-gated Clear.
//
// Source-inspection only — buildToDoRow + the modal flow are too heavily
// wired to instantiate end-to-end here, mirroring the existing
// mobileTapToViewEdit / mobileTaskInteractions / mobileTitleWrapSpan style.

describe('mobile desc editor modal — modals.js export and shell', () => {

    const modals = read('modals.js');

    it('exports a showDescEditorModal function', () => {
        expect(modals).toMatch(/export\s+function\s+showDescEditorModal\s*\(/);
    });

    it('mounts the modal under a #descEditorModalBackdrop / #descEditorModal pair', () => {
        expect(modals).toMatch(/#descEditorModalBackdrop|['"]descEditorModalBackdrop['"]/);
        expect(modals).toMatch(/['"]descEditorModal['"]/);
    });

    it('renders a textarea for the desc value (multi-line, not a single-line input)', () => {
        expect(modals).toMatch(/createElement\(\s*['"]textarea['"]\s*\)/);
        expect(modals).toMatch(/['"]descEditorModalTextarea['"]/);
    });

    it('seeds the textarea with the item\'s desc field as-is (no trim) so markdown formatting is preserved', () => {
        // The textarea.value assignment must read from item.desc; trimming
        // would discard leading whitespace that markdown indentation relies
        // on (nested list bullets, code-block indentation).
        expect(modals).toMatch(/textarea\.value\s*=\s*[^;]*item[\.\[]/);
        // The persist path must also avoid .trim() so saved markdown round-
        // trips through localStorage unchanged.
        const persistBlock = modals.match(/item\.desc\s*=\s*textarea\.value[^;]*;/);
        expect(persistBlock).toBeTruthy();
        expect(persistBlock[0]).not.toMatch(/\.trim\(/);
    });

    it('routes the save through listLogic so persistence stays inside the data-model layer', () => {
        // CLAUDE.md: "Do not mutate the data model from UI files. Go through
        // listLogic.js." The modal sets item.desc + calls saveToStorage,
        // mirroring the existing descInput.blur handler in toDoRow.js.
        expect(modals).toMatch(/import\s*\{[^}]*listLogic[^}]*\}\s*from\s*['"]\.\/listLogic\.js['"]/);
        expect(modals).toMatch(/listLogic\.saveToStorage\s*\(\s*\)/);
    });
});

describe('mobile desc editor modal — toolbar Copy + Clear actions', () => {

    const modals = read('modals.js');

    it('renders a Copy button that copies the textarea contents to the clipboard', () => {
        expect(modals).toMatch(/['"]descEditorModalCopy['"]/);
        // Use the async clipboard API as the primary path — required for
        // mobile Safari to honor the write from a button activation.
        expect(modals).toMatch(/navigator\.clipboard\.writeText\(/);
    });

    it('the Copy button copies the raw textarea contents (not a normalized variant)', () => {
        // Acceptance criterion: "'Copy entry' places the textarea contents
        // on the clipboard." The Copy click handler reads textarea.value
        // into a local `text` and passes it to writeText — no .trim(), no
        // markdown normalization in between.
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx);
        expect(fn).toMatch(/const\s+text\s*=\s*textarea\.value/);
        expect(fn).toMatch(/writeText\(\s*text\s*\)/);
    });

    it('renders a Clear button that goes through the confirm modal before wiping content', () => {
        // CLAUDE.md: destructive actions require a confirmation step.
        // Clearing a saved description throws away data — must confirm.
        expect(modals).toMatch(/['"]descEditorModalClear['"]/);
        const clearIdx = modals.indexOf("'descEditorModalClear'");
        expect(clearIdx).toBeGreaterThan(-1);
        const tail = modals.slice(clearIdx);
        // The Clear click handler must invoke showConfirmModal before
        // wiping the textarea (search a generous window since the handler
        // can sit downfile from the element id).
        expect(tail).toMatch(/showConfirmModal\s*\(/);
    });
});

describe('mobile desc editor modal — close affordances (X / backdrop / Escape)', () => {

    const modals = read('modals.js');

    it('the close X button is wired through the shared dismiss helper', () => {
        expect(modals).toMatch(/['"]descEditorModalClose['"]/);
        // Close wiring is centralized in the shared wireModalDismiss helper
        // rather than a hand-rolled closeX listener; the editor hands it closeX.
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        const fn = modals.slice(fnIdx);
        const call = fn.match(/wireModalDismiss\(\{[\s\S]*?\}\)/);
        expect(call).not.toBeNull();
        expect(call[0]).toMatch(/closeButtons:\s*\[\s*closeX\s*\]/);
        // The helper wires each supplied close control's click to close().
        expect(modals).toMatch(/closeButtons\[i\]\.addEventListener\(\s*['"]click['"]\s*,\s*close\s*\)/);
    });

    it('clicks on the backdrop close the modal (but inside-dialog clicks do not)', () => {
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx);
        // The editor hands its backdrop to the shared helper, which closes only
        // on a click that lands on the backdrop itself.
        const call = fn.match(/wireModalDismiss\(\{[\s\S]*?\}\)/);
        expect(call).not.toBeNull();
        expect(call[0]).toMatch(/backdrop:\s*backdrop/);
        expect(modals).toMatch(
            /backdrop\.addEventListener\(\s*['"]click['"]\s*,\s*function\s*\(\s*event\s*\)\s*\{\s*if\s*\(\s*event\.target\s*===\s*backdrop\s*\)\s*close\(\)/
        );
    });

    it('the document keydown listener closes on Escape', () => {
        // Escape is implemented once in the shared wireModalDismiss helper; the
        // editor opts in by routing its close wiring through it.
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        const fn = modals.slice(fnIdx);
        expect(fn).toMatch(/wireModalDismiss\(\{/);
        expect(modals).toMatch(
            /event\.key\s*===\s*['"]Escape['"][\s\S]{0,80}close\(\)/
        );
    });

    it('every close path persists the textarea value back to item.desc', () => {
        // Save is implicit on any close — no separate Save button. The editor
        // hands wireModalDismiss an onClose hook that persists, so backdrop /
        // Escape / X close paths all save the user's edits.
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        const fn = modals.slice(fnIdx);
        // Persist routine assigns item.desc and saves.
        expect(fn).toMatch(/item\.desc\s*=\s*textarea\.value/);
        // The close hook passed to the shared helper invokes persist().
        const call = fn.match(/wireModalDismiss\(\{[\s\S]*?\}\)/);
        expect(call).not.toBeNull();
        expect(call[0]).toMatch(/onClose:\s*onDescEditorClose/);
        expect(fn).toMatch(/function\s+onDescEditorClose\s*\(\s*\)\s*\{[\s\S]*?persist\s*\(\s*\)/);
    });
});

describe('mobile desc editor modal — registered with isAnyModalOrPopoverOpen', () => {

    const modals = read('modals.js');

    it('descEditorModalBackdrop participates in the global modal-open guard', () => {
        // The `?` help shortcut and the help FAB visibility both consult
        // this predicate. Forgetting to register a new modal here lets
        // both surface stack on top of an active editor.
        expect(modals).toMatch(
            /isAnyModalOrPopoverOpen[\s\S]*descEditorModalBackdrop/
        );
    });
});

describe('mobile desc editor modal — touch-device tap opens it', () => {

    const toDoRow = read('toDoRow.js');

    it('toDoRow.js imports showDescEditorModal from modals.js', () => {
        expect(toDoRow).toMatch(
            /import\s*\{[^}]*showDescEditorModal[^}]*\}\s*from\s*['"]\.\/modals\.js['"]/
        );
    });

    it('wireToDoRowClick short-circuits to the modal on `(pointer: coarse)` before the width-based mobile branch', () => {
        // Gate is matchMedia('(pointer: coarse)'), not innerWidth — the
        // task brief is explicit: "Gate the tap-to-open listener on
        // window.matchMedia('(pointer: coarse)').matches so desktop
        // behavior is unchanged."
        expect(toDoRow).toMatch(/matchMedia\(\s*['"]\(pointer:\s*coarse\)['"]\s*\)\.matches/);
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        const fn = toDoRow.slice(fnIdx);
        // The coarse-pointer modal-open branch must precede the width-
        // based mobile branch so touch users don\'t fall through to the
        // descSibling expand path first.
        const coarseIdx = fn.search(/isCoarsePointerTap\s*\(\s*\)|matchMedia\(\s*['"]\(pointer:\s*coarse\)['"]\s*\)\.matches/);
        const mobileIdx = fn.search(/isMobile\s*&&\s*!descOpen\s*&&\s*descToggle/);
        expect(coarseIdx).toBeGreaterThan(-1);
        expect(mobileIdx).toBeGreaterThan(-1);
        expect(coarseIdx).toBeLessThan(mobileIdx);
    });

    it('coarse-pointer branch calls showDescEditorModal with the row\'s item and a save callback', () => {
        expect(toDoRow).toMatch(/showDescEditorModal\s*\(/);
        // The onSave callback routes the desc write through listLogic so the
        // edit persists to Supabase (see the desc-save-persistence suite); the
        // leading-slot glyph no longer tracks the description.
        expect(toDoRow).toMatch(/showDescEditorModal\s*\([\s\S]{0,400}listLogic\.editToDoItem/);
    });

    it('coarse-pointer branch is excluded from blank placeholder rows (no desc to edit yet)', () => {
        // The blank-row early-return at the top of the click handler
        // fires BEFORE the coarse-pointer branch, so taps on the blank
        // placeholder still focus the input for the first-keystroke flow.
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        const fn = toDoRow.slice(fnIdx, fnIdx + 4000);
        const blankIdx = fn.indexOf("!toDoInput.value.trim()");
        const coarseIdx = fn.search(/isCoarsePointerTap\s*\(\s*\)|matchMedia\(\s*['"]\(pointer:\s*coarse\)['"]\s*\)\.matches/);
        expect(blankIdx).toBeGreaterThan(-1);
        expect(coarseIdx).toBeGreaterThan(-1);
        expect(blankIdx).toBeLessThan(coarseIdx);
    });

    it('coarse-pointer branch is gated below the same controls-exclusion guard as the desktop flow', () => {
        // Tapping the checkbox, due pill, delete, etc. must NOT open the
        // modal. Each control\'s id (or the closest() ancestor selector)
        // must appear in the exclusion guard above the coarse-pointer
        // branch.
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        const fn = toDoRow.slice(fnIdx, fnIdx + 4000);
        const guardIdx = fn.indexOf("'checkToDo'");
        const coarseIdx = fn.search(/isCoarsePointerTap\s*\(\s*\)|matchMedia\(\s*['"]\(pointer:\s*coarse\)['"]\s*\)\.matches/);
        expect(guardIdx).toBeGreaterThan(-1);
        expect(coarseIdx).toBeGreaterThan(-1);
        expect(guardIdx).toBeLessThan(coarseIdx);
        // Spot-check the relevant ids appear in the guard.
        const guardSlice = fn.slice(guardIdx, coarseIdx);
        expect(guardSlice).toMatch(/checkToDo/);
        expect(guardSlice).toMatch(/closeButtonToDo/);
        expect(guardSlice).toMatch(/duePill/);
    });
});

describe('mobile desc editor modal — row description indicator', () => {

    const toDoRow = read('toDoRow.js');
    const css = read('style.css');

    it('every row builds a #descIndicator element', () => {
        // Inserted between the checkbox and the title — wireCheckbox does
        // insertBefore(checkToDo, toDoInput), and the indicator is then
        // inserted via insertBefore(descIndicator, toDoInput) so the final
        // order is: checkbox · indicator · title.
        expect(toDoRow).toMatch(/['"]descIndicator['"]/);
        expect(toDoRow).toMatch(/insertBefore\(\s*descIndicator\s*,\s*toDoInput\s*\)/);
    });

    it('the run-status glyphs are inline SVG (no new icon-font dependency)', () => {
        // CLAUDE.md: "No new dependencies. Use native browser APIs." The
        // shipped/pending glyphs ship as built-in SVG markup applied to the
        // #descIndicator slot by applyRunStatusGlyph.
        expect(toDoRow).toMatch(/RUN_STATUS_SHIPPED_SVG\s*=\s*['"]<svg/);
        expect(toDoRow).toMatch(/RUN_STATUS_PENDING_SVG\s*=\s*['"]<svg/);
    });

    it('the indicator is CSS-hidden by default and revealed by a run-status state class', () => {
        // The slot takes no space until applyRunStatusGlyph adds a
        // runStatusGlyph--shipped / --pending class, so a task with no entry
        // id shows nothing in the leading position.
        expect(css).toMatch(/#descIndicator\s*\{[\s\S]{0,200}display:\s*none/);
        expect(css).toMatch(/#descIndicator\.runStatusGlyph--(shipped|pending)[\s\S]{0,120}display:\s*inline-flex/);
    });

    it('the glyph paints in the feature/warning tokens per shipped/pending state', () => {
        // Shipped = feature green, pending = warning amber — legible in both
        // dark and light themes via the shared tokens.
        expect(css).toMatch(/#descIndicator\.runStatusGlyph--shipped\s*\{[\s\S]{0,80}color:\s*var\(--type-feature\)/);
        expect(css).toMatch(/#descIndicator\.runStatusGlyph--pending\s*\{[\s\S]{0,80}color:\s*var\(--text-warning\)/);
    });

    it('the indicator releases pointer events so clicks pass through to the row body', () => {
        // Without this, clicks on the indicator wouldn\'t reach the row\'s
        // click handler and the modal wouldn\'t open from a tap on the icon.
        expect(css).toMatch(/#descIndicator\s*\{[\s\S]{0,300}pointer-events:\s*none/);
    });
});

describe('mobile desc editor modal — textarea styling', () => {

    const css = read('style.css');

    it('the textarea uses a monospace font for markdown drafting', () => {
        // The brief calls for a monospace textarea so indentation and
        // backticks paint at consistent column widths — matches the
        // existing changelog/help body fonts.
        expect(css).toMatch(/#descEditorModalTextarea\s*\{[\s\S]{0,500}font-family:[^;]*(SpaceMono|monospace)/);
    });

    it('the textarea font-size is 16px or larger (iOS no-auto-zoom rule)', () => {
        // CLAUDE.md: "Text inputs used on mobile must have font-size: 16px
        // or larger to prevent iOS Safari auto-zoom on focus."
        const ruleMatch = css.match(/#descEditorModalTextarea\s*\{([\s\S]{0,800}?)\}/);
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        const sizeMatch = body.match(/font-size:\s*(\d+)px/);
        expect(sizeMatch).toBeTruthy();
        expect(parseInt(sizeMatch[1], 10)).toBeGreaterThanOrEqual(16);
    });

    it('the textarea preserves explicit whitespace (white-space: pre-wrap) so markdown indentation round-trips while long lines wrap', () => {
        // Brief: "preserve markdown formatting (backticks, indentation,
        // multi-line)". white-space: pre-wrap keeps tabs, leading spaces, and
        // explicit newlines intact in the textarea\'s rendered display
        // (saving is already raw via textarea.value) while wrapping long lines
        // so they don\'t run off the right edge.
        expect(css).toMatch(/#descEditorModalTextarea\s*\{[\s\S]{0,800}white-space:\s*pre-wrap/);
    });
});

describe('mobile desc editor modal — iOS-safe input attributes', () => {

    const modals = read('modals.js');

    it('the textarea sets autocapitalize="off" so iOS does not auto-capitalize list items', () => {
        // Markdown bullets like `- foo` or `* bar` would be auto-capitalized
        // by iOS Safari, breaking round-trip fidelity into TODO.md.
        expect(modals).toMatch(/textarea\.autocapitalize\s*=\s*['"]off['"]/);
    });

    it('the textarea sets autocorrect="off" so iOS does not smart-substitute markdown punctuation', () => {
        // iOS Safari's smart-substitution pass rewrites `--` → em-dash,
        // `"foo"` → curly quotes, `...` → ellipsis — all of which corrupt
        // markdown content. The attribute is iOS-specific (non-standard) so
        // it must be applied via setAttribute, not a property assignment.
        expect(modals).toMatch(
            /textarea\.setAttribute\(\s*['"]autocorrect['"]\s*,\s*['"]off['"]\s*\)/
        );
    });

    it('the textarea sets spellcheck=false so squiggle underlines do not nag the user', () => {
        expect(modals).toMatch(/textarea\.spellcheck\s*=\s*false/);
    });
});

describe('mobile desc editor modal — editable title', () => {

    const modals = read('modals.js');
    const css = read('style.css');
    const toDoRow = read('toDoRow.js');

    it('renders a static title span next to a pencil affordance and a (hidden) input', () => {
        // The title shell contains three children so tap-to-edit can swap
        // from the static display to the input in place. Without the
        // separate text/affordance/input nodes, the row's title couldn't be
        // renamed from the mobile editor.
        expect(modals).toMatch(/['"]descEditorModalTitleText['"]/);
        expect(modals).toMatch(/['"]descEditorModalTitleEdit['"]/);
        expect(modals).toMatch(/['"]descEditorModalTitleInput['"]/);
    });

    it('the pencil affordance is rendered as the U+270E pencil glyph (✎)', () => {
        // Task brief: "small pencil affordance (✎)".
        const editIdx = modals.indexOf("'descEditorModalTitleEdit'");
        expect(editIdx).toBeGreaterThan(-1);
        const tail = modals.slice(editIdx, editIdx + 400);
        expect(tail).toMatch(/['"]✎['"]/);
    });

    it('the pencil affordance is hidden from assistive tech (decorative)', () => {
        // The whole title is rendered as accessible text already; the pencil
        // is a visual cue only. Marking it aria-hidden avoids announcing a
        // decorative glyph on every modal open.
        const editIdx = modals.indexOf("'descEditorModalTitleEdit'");
        expect(editIdx).toBeGreaterThan(-1);
        const tail = modals.slice(editIdx, editIdx + 400);
        expect(tail).toMatch(/setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
    });

    it('the title input is labelled for assistive tech ("Todo title")', () => {
        // Without an aria-label the input collapses to an unlabelled control
        // when it swaps in over the static text — VoiceOver / TalkBack would
        // announce "edit text" with no clue what the user is renaming.
        const inputIdx = modals.indexOf("'descEditorModalTitleInput'");
        expect(inputIdx).toBeGreaterThan(-1);
        const tail = modals.slice(inputIdx, inputIdx + 600);
        expect(tail).toMatch(/setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]Todo title['"]\s*\)/);
    });

    it('the title input is seeded with the item\'s title (no trim) and starts hidden', () => {
        const inputIdx = modals.indexOf("'descEditorModalTitleInput'");
        expect(inputIdx).toBeGreaterThan(-1);
        const tail = modals.slice(inputIdx, inputIdx + 600);
        expect(tail).toMatch(/titleInput\.value\s*=\s*[^;]*item\.tit/);
        expect(tail).toMatch(/titleInput\.style\.display\s*=\s*['"]none['"]/);
    });

    it('clicking the static title text swaps in the input (focused + selected)', () => {
        // Tap-to-edit affordance: tapping the visible title hands the user a
        // prefilled input. Without focus + select the user has to manually
        // tap into the field and select-all before editing.
        expect(modals).toMatch(
            /titleText\.addEventListener\(\s*['"]click['"]\s*,\s*enterTitleEditMode\s*\)/
        );
        const enterIdx = modals.indexOf('function enterTitleEditMode');
        expect(enterIdx).toBeGreaterThan(-1);
        const fn = modals.slice(enterIdx, enterIdx + 500);
        expect(fn).toMatch(/titleInput\.focus\(/);
        expect(fn).toMatch(/titleInput\.select\(/);
    });

    it('clicking the pencil affordance also enters edit mode', () => {
        expect(modals).toMatch(
            /titleEdit\.addEventListener\(\s*['"]click['"]\s*,\s*enterTitleEditMode\s*\)/
        );
    });

    it('Enter commits the title and uses the renameHandledByEnter flag so blur does not re-run the commit', () => {
        // Mirrors the projChild rename in main.js: Enter blurs the input, the
        // blur handler then sees the flag set and skips its own commit path.
        // Without the flag both handlers would write item.tit twice and dispatch
        // duplicate saves.
        expect(modals).toMatch(/let\s+titleRenameHandledByEnter\s*=\s*false/);
        const keydownIdx = modals.indexOf("titleInput.addEventListener('keydown'");
        expect(keydownIdx).toBeGreaterThan(-1);
        const tail = modals.slice(keydownIdx, keydownIdx + 1200);
        // Enter sets the flag before commitTitle runs.
        expect(tail).toMatch(
            /event\.key\s*===\s*['"]Enter['"][\s\S]{0,500}titleRenameHandledByEnter\s*=\s*true[\s\S]{0,200}commitTitle\(/
        );
        // The blur handler short-circuits when the flag is set.
        const blurIdx = modals.indexOf("titleInput.addEventListener('blur'");
        expect(blurIdx).toBeGreaterThan(-1);
        const blur = modals.slice(blurIdx, blurIdx + 600);
        expect(blur).toMatch(/if\s*\(\s*titleRenameHandledByEnter\s*\)\s*\{[\s\S]{0,80}titleRenameHandledByEnter\s*=\s*false/);
    });

    it('blur (without Enter) commits the title', () => {
        // Tap-away on mobile is the natural commit gesture. Without a blur
        // commit, renames typed and tapped-away from would silently drop.
        const blurIdx = modals.indexOf("titleInput.addEventListener('blur'");
        expect(blurIdx).toBeGreaterThan(-1);
        const blur = modals.slice(blurIdx, blurIdx + 600);
        expect(blur).toMatch(/commitTitle\(/);
    });

    it('Escape reverts the in-flight edit (does not close the modal)', () => {
        // The document-level Escape handler closes the modal; the input's
        // Escape must stopPropagation so a softer cancel (just exit edit
        // mode and restore the prior value) is possible.
        const keydownIdx = modals.indexOf("titleInput.addEventListener('keydown'");
        const tail = modals.slice(keydownIdx, keydownIdx + 1500);
        expect(tail).toMatch(
            /event\.key\s*===\s*['"]Escape['"][\s\S]{0,300}stopPropagation\(/
        );
        expect(tail).toMatch(
            /event\.key\s*===\s*['"]Escape['"][\s\S]{0,500}titleInput\.value\s*=\s*[^;]*item\.tit/
        );
    });

    it('empty titles revert to the previous value rather than blocking', () => {
        // Task brief: "Empty titles revert to the previous value rather than
        // blocking." The commit path must not bail on an empty newVal — it
        // must restore item.tit and exit edit mode.
        const commitIdx = modals.indexOf('function commitTitle');
        expect(commitIdx).toBeGreaterThan(-1);
        const fn = modals.slice(commitIdx, commitIdx + 800);
        // newVal length 0 → restore prior, exit
        expect(fn).toMatch(
            /newVal\.length\s*===\s*0[\s\S]{0,200}titleInput\.value\s*=\s*prior/
        );
        // commitTitle must call exitTitleEditMode on the revert branch too.
        expect(fn).toMatch(/exitTitleEditMode\(/);
    });

    it('a real rename updates item.tit, persists via listLogic.saveToStorage, and fires onTitleSave', () => {
        // CLAUDE.md: mutations route through listLogic. saveToStorage is the
        // existing path used by descInput.blur for desc edits — title edits
        // mirror it. onTitleSave is the hook the row uses to refresh its DOM
        // and trigger the backend sync via editToDoItem.
        const commitIdx = modals.indexOf('function commitTitle');
        expect(commitIdx).toBeGreaterThan(-1);
        const fn = modals.slice(commitIdx, commitIdx + 1000);
        expect(fn).toMatch(/item\.tit\s*=\s*newVal/);
        expect(fn).toMatch(/listLogic\.saveToStorage\s*\(\s*\)/);
        expect(fn).toMatch(/opts\.onTitleSave/);
    });

    it('the title input uses font-size 16px or larger (iOS no-auto-zoom rule)', () => {
        // CLAUDE.md: "Text inputs used on mobile must have font-size: 16px
        // or larger to prevent iOS Safari auto-zoom on focus." The static
        // title display is 12px (uppercase label styling), but the input
        // must override that when it swaps in.
        const ruleMatch = css.match(/#descEditorModalTitleInput\s*\{([\s\S]{0,1000}?)\}/);
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        const sizeMatch = body.match(/font-size:\s*(\d+)px/);
        expect(sizeMatch).toBeTruthy();
        expect(parseInt(sizeMatch[1], 10)).toBeGreaterThanOrEqual(16);
    });

    it('the pencil affordance paints in the accent color', () => {
        // Task brief: "small pencil affordance (✎) in the accent color".
        expect(css).toMatch(
            /#descEditorModalTitleEdit\s*\{[\s\S]{0,300}color:\s*var\(--accent[^)]*\)/
        );
    });

    it('the row\'s onTitleSave callback refreshes row DOM and routes through listLogic.editToDoItem', () => {
        // The modal mutates item.tit + saveToStorage, but the row still has
        // its own DOM cells (toDoInput, toDoTitleDisplay) and the Supabase
        // sync gate lives behind editToDoItem. The callback bridges them so
        // the rename appears immediately on close and reaches the backend.
        const openIdx = toDoRow.indexOf('function openDescEditorForRow(');
        expect(openIdx).toBeGreaterThan(-1);
        const fn = toDoRow.slice(openIdx, openIdx + 1600);
        expect(fn).toMatch(/onTitleSave\s*:/);
        expect(fn).toMatch(/toDoInput\.value\s*=\s*newTitle/);
        expect(fn).toMatch(/toDoTitleDisplay\.textContent\s*=\s*newTitle/);
        expect(fn).toMatch(/listLogic\.editToDoItem\s*\(/);
    });
});

describe('mobile desc editor modal — desc save persistence', () => {

    const toDoRow = read('toDoRow.js');

    it('the row\'s onSave callback routes the desc write through listLogic.editToDoItem', () => {
        // Regression: the modal's persist() routine mutated item.desc +
        // saveToStorage (localStorage only) without firing the Supabase
        // persistMutation gate. On the next hydrate the canonical backend
        // snapshot overwrote the local desc edit, making the user's drafting
        // silently disappear on hard refresh. Titles already routed through
        // editToDoItem via onTitleSave; the desc path mirrors that so
        // localStorage and Supabase stay aligned.
        const openIdx = toDoRow.indexOf('function openDescEditorForRow(');
        expect(openIdx).toBeGreaterThan(-1);
        const fn = toDoRow.slice(openIdx, openIdx + 1600);
        const onSaveMatch = fn.match(/onSave\s*:\s*function\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*,/);
        expect(onSaveMatch).toBeTruthy();
        const body = onSaveMatch[1];
        expect(body).toMatch(/listLogic\.editToDoItem\s*\(/);
    });
});

describe('mobile desc editor modal — footer button labels fit narrow viewports', () => {

    const modals = read('modals.js');
    const inject = read('inject.js');
    const css = read('style.css');

    it('the Copy button uses the short "Copy entry" label (not the wider "Copy as TODO.md entry")', () => {
        // Regression: the longer label combined with the Clear button and the
        // inject button pushed the leftmost button past the dialog's left
        // edge on iPhone-width viewports. The shorter label keeps the row
        // within the dialog at narrow widths.
        expect(modals).toMatch(/copyBtn\.textContent\s*=\s*['"]Copy entry['"]/);
        expect(modals).not.toMatch(/copyBtn\.textContent\s*=\s*['"]Copy as TODO\.md entry['"]/);
    });

    it('the inject button\'s unconfigured-state label is the short "Inject" (not "Configure inject in settings")', () => {
        // The unconfigured label shows in the mobile modal footer when the
        // user hasn\'t set up a Worker URL yet — the long label was the
        // primary cause of overflow on narrow viewports.
        const unconfIdx = inject.search(/dataset\.state\s*=\s*['"]unconfigured['"]/);
        expect(unconfIdx).toBeGreaterThan(-1);
        const block = inject.slice(unconfIdx, unconfIdx + 800);
        expect(block).toMatch(/label\.textContent\s*=\s*['"]Inject['"]/);
        expect(block).not.toMatch(/label\.textContent\s*=\s*['"]Configure inject in settings['"]/);
    });

    it('the modal footer buttons never wrap and shrink gracefully on narrow viewports', () => {
        // Without white-space:nowrap, labels would wrap mid-button and break
        // the row\'s vertical rhythm. flex:0 1 auto plus min-width:0 lets the
        // buttons shrink below their content size when the viewport gets
        // narrower than the natural row width.
        const ruleMatch = css.match(/\.descEditorModalBtn\s*\{([\s\S]{0,800}?)\}/);
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        expect(body).toMatch(/white-space:\s*nowrap/);
        expect(body).toMatch(/flex:\s*0\s+1\s+auto/);
        expect(body).toMatch(/min-width:\s*0/);
    });
});

describe('mobile desc editor modal — two-tier header (eyebrow + wrapped title)', () => {

    const modals = read('modals.js');
    const css = read('style.css');

    it('renders a static "Description" eyebrow row above the task title', () => {
        // The header is restructured into two tiers: a small accent eyebrow
        // reading "Description" and, beneath it, the real task title in the
        // body font. The eyebrow is a dedicated element so the pencil can sit
        // in it right-aligned without competing with the title for the line.
        expect(modals).toMatch(/['"]descEditorModalTitleEyebrow['"]/);
        expect(modals).toMatch(/['"]descEditorModalTitleEyebrowLabel['"]/);
        const labelIdx = modals.indexOf("'descEditorModalTitleEyebrowLabel'");
        expect(labelIdx).toBeGreaterThan(-1);
        const tail = modals.slice(labelIdx, labelIdx + 300);
        expect(tail).toMatch(/textContent\s*=\s*['"]Description['"]/);
    });

    it('moves the pencil affordance into the eyebrow row', () => {
        // The rename pencil is appended to the eyebrow (right-aligned via the
        // eyebrow's space-between), not to the title text line.
        expect(modals).toMatch(/eyebrow\.appendChild\(\s*titleEdit\s*\)/);
    });

    it('appends the eyebrow before the task title in the title shell', () => {
        // Order matters: eyebrow on top, then the wrapped title, then the
        // hidden rename input that swaps in over the title.
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        const fn = modals.slice(fnIdx);
        const eyebrowAppend = fn.search(/title\.appendChild\(\s*eyebrow\s*\)/);
        const textAppend = fn.search(/title\.appendChild\(\s*titleText\s*\)/);
        expect(eyebrowAppend).toBeGreaterThan(-1);
        expect(textAppend).toBeGreaterThan(-1);
        expect(eyebrowAppend).toBeLessThan(textAppend);
    });

    it('points the dialog aria-labelledby at the task title (not the eyebrow shell)', () => {
        // The accessible name must remain the task title, so aria-labelledby
        // resolves to the title-text element rather than the whole shell,
        // which now also contains the static "Description" eyebrow text.
        expect(modals).toMatch(
            /dialog\.setAttribute\(\s*['"]aria-labelledby['"]\s*,\s*['"]descEditorModalTitleText['"]\s*\)/
        );
    });

    it('the eyebrow label is the small uppercase monospace accent style', () => {
        // SpaceMono, ~10px, uppercase, ~0.14em tracking, accent color — the
        // eyebrow keeps the original label aesthetic the title shed.
        const ruleMatch = css.match(/#descEditorModalTitleEyebrowLabel\s*\{([\s\S]{0,400}?)\}/);
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        expect(body).toMatch(/font-family:[^;]*SpaceMono/);
        expect(body).toMatch(/text-transform:\s*uppercase/);
        expect(body).toMatch(/letter-spacing:\s*0\.14em/);
        expect(body).toMatch(/color:\s*var\(--accent[^)]*\)/);
        const sizeMatch = body.match(/font-size:\s*(\d+)px/);
        expect(sizeMatch).toBeTruthy();
        expect(parseInt(sizeMatch[1], 10)).toBeLessThanOrEqual(11);
    });

    it('the task title renders in the proportional body font, natural case, wrapping up to two lines', () => {
        // The title moves to Trebuchet MS (the app's existing body font — no
        // new dependency), ~14px, primary text color, and clamps to two lines
        // instead of the old single ellipsised monospace line.
        const ruleMatch = css.match(/#descEditorModalTitleText\s*\{([\s\S]{0,500}?)\}/);
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        expect(body).toMatch(/font-family:[^;]*Trebuchet/);
        expect(body).toMatch(/color:\s*var\(--text-primary\)/);
        expect(body).toMatch(/-webkit-line-clamp:\s*2/);
        // Natural case — the title must NOT be uppercased the way the old
        // single-line monospace label was.
        expect(body).not.toMatch(/text-transform:\s*uppercase/);
        const sizeMatch = body.match(/font-size:\s*(\d+)px/);
        expect(sizeMatch).toBeTruthy();
        expect(parseInt(sizeMatch[1], 10)).toBe(14);
    });
});

describe('mobile desc editor modal — copy feedback label', () => {

    const modals = read('modals.js');

    it('the copy feedback label is "Copied ✓" (checkmark, not exclamation)', () => {
        // Brief: "button label flips to 'Copied ✓' for ~1.2s, then reverts".
        // The checkmark mirrors the per-row copyTitleBtn cue so the two
        // copy surfaces feel consistent.
        expect(modals).toMatch(/btn\.textContent\s*=\s*['"]Copied\s*✓['"]/);
        // Negative guard: the prior "Copied!" string must be gone so the
        // two surfaces don\'t drift in feedback vocabulary.
        expect(modals).not.toMatch(/btn\.textContent\s*=\s*['"]Copied!['"]/);
    });

    it('the copy feedback reverts after ~1.2s, not the prior 1s', () => {
        // The brief asks for "~1.2s" so the checkmark is visible long
        // enough on a thumb-driven tap to register without lingering.
        const fnIdx = modals.indexOf('function flashCopyFeedback(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx, fnIdx + 600);
        const tMatch = fn.match(/setTimeout\([^,]+,\s*(\d+)\s*\)/);
        expect(tMatch).toBeTruthy();
        expect(parseInt(tMatch[1], 10)).toBeGreaterThanOrEqual(1100);
    });
});
