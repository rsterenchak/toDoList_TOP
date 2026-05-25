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
        // Acceptance criterion: "'Copy as TODO.md entry' places the
        // textarea contents on the clipboard." The Copy click handler
        // reads textarea.value into a local `text` and passes it to
        // writeText — no .trim(), no markdown normalization in between.
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

    it('the close X button is wired to close()', () => {
        expect(modals).toMatch(/['"]descEditorModalClose['"]/);
        expect(modals).toMatch(/closeX\.addEventListener\(\s*['"]click['"]\s*,\s*close\s*\)/);
    });

    it('clicks on the backdrop close the modal (but inside-dialog clicks do not)', () => {
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx);
        expect(fn).toMatch(
            /backdrop\.addEventListener\(\s*['"]click['"]\s*,\s*function\s*\(\s*event\s*\)\s*\{\s*if\s*\(\s*event\.target\s*===\s*backdrop\s*\)\s*close\(\)/
        );
    });

    it('the document keydown listener closes on Escape', () => {
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        const fn = modals.slice(fnIdx);
        expect(fn).toMatch(
            /event\.key\s*===\s*['"]Escape['"][\s\S]{0,80}close\(\)/
        );
    });

    it('every close path persists the textarea value back to item.desc', () => {
        // Save is implicit on any close — no separate Save button. The
        // close() helper must call the persist routine before tearing
        // down the DOM, otherwise backdrop / Escape close paths lose the
        // user\'s edits.
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        const fn = modals.slice(fnIdx);
        // Persist routine assigns item.desc and saves.
        expect(fn).toMatch(/item\.desc\s*=\s*textarea\.value/);
        // The close handler invokes the persist routine before DOM teardown.
        const closeDecl = fn.match(/function\s+close\s*\(\s*\)\s*\{([\s\S]{0,400}?)backdrop\.parentNode\.removeChild/);
        expect(closeDecl).toBeTruthy();
        expect(closeDecl[1]).toMatch(/persist\s*\(\s*\)|item\.desc\s*=\s*textarea\.value/);
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

    it('coarse-pointer branch calls showDescEditorModal with the row\'s item and a refresh callback', () => {
        expect(toDoRow).toMatch(/showDescEditorModal\s*\(/);
        // The refresh callback re-stamps the row\'s data-has-desc so the
        // indicator icon paints/dims to match the saved desc immediately
        // on modal close.
        expect(toDoRow).toMatch(/showDescEditorModal\s*\([\s\S]{0,200}updateDescIndicator/);
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

    it('the indicator uses an inline SVG (no new icon-font dependency)', () => {
        // CLAUDE.md: "No new dependencies. Use native browser APIs."
        // The icon ships as a built-in SVG glyph in the row markup. The
        // descIndicator id assignment uses either quote style depending on
        // local source convention — accept both.
        const indicatorIdx = toDoRow.search(/descIndicator\.id\s*=\s*['"]descIndicator['"]/);
        expect(indicatorIdx).toBeGreaterThan(-1);
        const tail = toDoRow.slice(indicatorIdx, indicatorIdx + 1200);
        expect(tail).toMatch(/<svg/);
    });

    it('the indicator is CSS-hidden by default and revealed via data-has-desc on the row', () => {
        // data-has-desc is already managed by updateDescIndicator. Driving
        // the icon\'s visibility from the same attribute means the modal\'s
        // onSave callback (which calls updateDescIndicator) flips the icon
        // in lockstep with the saved description.
        expect(css).toMatch(/#descIndicator\s*\{[\s\S]{0,200}display:\s*none/);
        expect(css).toMatch(/#toDoChild\[data-has-desc="true"\]\s+#descIndicator\s*\{[\s\S]{0,200}display:\s*inline-flex/);
    });

    it('the indicator paints in the accent color (purple per the task brief)', () => {
        // Brief: "small purple note-style indicator icon". --accent-text
        // is the existing purple token used by other accent surfaces.
        expect(css).toMatch(/#descIndicator\s*\{[\s\S]{0,300}color:\s*var\(--accent[^)]*\)/);
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

    it('the textarea preserves explicit whitespace (white-space: pre) so markdown indentation round-trips', () => {
        // Brief: "preserve markdown formatting (backticks, indentation,
        // multi-line)". white-space: pre keeps tabs, leading spaces, and
        // explicit newlines intact in the textarea\'s rendered display
        // (saving is already raw via textarea.value).
        expect(css).toMatch(/#descEditorModalTextarea\s*\{[\s\S]{0,800}white-space:\s*pre/);
    });
});
