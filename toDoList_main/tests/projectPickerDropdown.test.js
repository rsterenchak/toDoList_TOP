import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The desktop anchored project-picker dropdown replaces the slide-in drawer
// at ≥1024px while leaving the mobile (<1024px) drawer untouched. The picker
// subsystem now lives in projectPicker.js (extracted from component()); the pill
// activation + the document-level outside-click / Escape dismissers stay in
// main.js. Both files are too large / closure-bound to instantiate in jsdom (per
// CLAUDE.md), so these invariants are pinned by source inspection, mirroring
// mobileProjHeaderDesktopRow.test.js.
describe('desktop project-picker dropdown', () => {
    const main = read('main.js');
    const picker = read('projectPicker.js');
    const css = read('style.css');

    // Slice a named function declaration's body from a source string.
    function fnBody(src, name) {
        const start = src.indexOf('function ' + name + '(');
        expect(start).toBeGreaterThan(-1);
        // Walk braces to find the matching close.
        let i = src.indexOf('{', start);
        let depth = 0;
        for (; i < src.length; i++) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') {
                depth--;
                if (depth === 0) return src.slice(start, i + 1);
            }
        }
        throw new Error('unbalanced braces for ' + name);
    }

    it('creates a #projectPickerDropdown element mounted on the body', () => {
        expect(main).toMatch(/projectPickerDropdown\.id\s*=\s*['"]projectPickerDropdown['"]/);
        expect(main).toMatch(/document\.body\.appendChild\(projectPickerDropdown\)/);
    });

    it('(a/b) at desktop the pill activation opens the dropdown, NOT the drawer', () => {
        const body = fnBody(main, 'activateProjectPicker');
        // Branches on the 1024px breakpoint.
        expect(body).toMatch(/window\.innerWidth\s*>=\s*1024/);
        // Desktop branch toggles the dropdown through the picker's public API.
        expect(body).toMatch(/projectPicker\.toggle\(\)/);
    });

    it('(f) at mobile the pill activation opens the slide-in drawer', () => {
        const body = fnBody(main, 'activateProjectPicker');
        // The else branch (mobile) routes to the existing drawer opener.
        expect(body).toMatch(/openMobileDrawer\(\)/);
    });

    it('(c) clicking a dropdown row routes through the shared selection path then dismisses', () => {
        const body = fnBody(picker, 'buildProjectPickerRows');
        // Reuses the same project-selection codepath the drawer rows use.
        expect(body).toMatch(/navigateToProjectByIndex\(/);
        // And closes the dropdown after selection.
        expect(body).toMatch(/closeProjectPicker\(\)/);
    });

    it('reuses listLogic project data + counts (no duplicated project list)', () => {
        const body = fnBody(picker, 'buildProjectPickerRows');
        expect(body).toMatch(/listLogic\.listProjectsArray\(\)/);
        expect(body).toMatch(/listLogic\.getProjectIncompleteCount/);
    });

    it('highlights the active project row', () => {
        const body = fnBody(picker, 'buildProjectPickerRows');
        // Active row is flagged off the live header name and gets the
        // .active class (purple accent + ✓ in CSS / markup).
        expect(body).toMatch(/mobileProjName\.textContent/);
        expect(body).toMatch(/classList\.add\(['"]active['"]\)/);
        expect(body).toMatch(/✓/);
    });

    it('does NOT introduce a new create-project path (footer omitted)', () => {
        const body = fnBody(picker, 'buildProjectPickerRows');
        // The drawer's create flow (#projButton) is not invoked from the
        // dropdown — the footer is intentionally omitted.
        expect(body).not.toMatch(/projButton/);
    });

    it('header row carries a purple "+ new project" button that reveals the inline create input', () => {
        const body = fnBody(picker, 'buildProjectPickerRows');
        // The header builds an add button with the create class + accessible label.
        expect(body).toMatch(/projectPickerAddBtn/);
        expect(body).toMatch(/aria-label['"]\s*,\s*['"]Add new project['"]/);
        // Clicking it toggles the inline create input (no sidebar drawer).
        expect(body).toMatch(/event\.stopPropagation\(\)[\s\S]{0,40}?toggleInlineCreate\(\)/);
        // It no longer routes the add button through the drawer-based create flow.
        expect(body).not.toMatch(/onCreateProjectNamed/);
    });

    it('mounts the inline create input row between the header and the project list', () => {
        const body = fnBody(picker, 'buildProjectPickerRows');
        // The create row is appended after the header and before the list, so
        // it sits above existing projects and below the header label.
        const headerIdx = body.indexOf("appendChild(header)");
        const createIdx = body.indexOf("appendChild(buildInlineCreateRow())");
        const listIdx   = body.indexOf("projectPickerList");
        expect(headerIdx).toBeGreaterThan(-1);
        expect(createIdx).toBeGreaterThan(headerIdx);
        expect(listIdx).toBeGreaterThan(createIdx);
    });

    it('inline create input: placeholder, Enter/confirm commit, Escape cancel, validation', () => {
        const build = fnBody(picker, 'buildInlineCreateRow');
        expect(build).toMatch(/projectPickerCreateInput/);
        expect(build).toMatch(/placeholder\s*=\s*['"]New project name…['"]/);
        expect(build).toMatch(/projectPickerCreateConfirm/);
        // Enter and the confirm + button both commit through submitInlineCreate.
        expect(build).toMatch(/e\.key === ['"]Enter['"][\s\S]{0,80}?submitInlineCreate\(\)/);
        expect(build).toMatch(/submitInlineCreate\(\)/);
        // Escape cancels the input and stops the event so the dropdown's own
        // Escape-to-close doesn't also fire.
        expect(build).toMatch(/e\.key === ['"]Escape['"][\s\S]{0,320}?cancelInlineCreate\(\)/);

        const submit = fnBody(picker, 'submitInlineCreate');
        // Empty and duplicate names are rejected (no create) and stay open.
        expect(submit).toMatch(/trimmed\.length === 0[\s\S]{0,60}?rejectInlineCreate\(\)/);
        expect(submit).toMatch(/indexOf\(trimmed\)\s*!==\s*-1[\s\S]{0,60}?rejectInlineCreate\(\)/);
        // Valid commit routes through the injected create flow, then refreshes
        // the dropdown + repaints counts so the new project shows as active.
        expect(submit).toMatch(/onCreateProjectNamed\(trimmed\)/);
        expect(submit).toMatch(/buildProjectPickerRows\(\)/);

        const reject = fnBody(picker, 'rejectInlineCreate');
        expect(reject).toMatch(/classList\.add\(['"]error['"]\)/);
    });

    it('cancelInlineCreate clears the input, hides the row, and is exposed on the public API', () => {
        const cancel = fnBody(picker, 'cancelInlineCreate');
        // No-op (returns false) when nothing is open; otherwise clears + hides.
        expect(cancel).toMatch(/if \(!inlineCreateOpen\) return false/);
        expect(cancel).toMatch(/inlineCreateInput\.value = ['"]['"]/);
        expect(cancel).toMatch(/classList\.remove\(['"]open['"]\)/);
        expect(cancel).toMatch(/return true/);
        // Exposed so main.js's Escape handler can give it priority.
        expect(picker).toMatch(/cancelInlineCreate:\s*cancelInlineCreate/);
    });

    it('closeProjectPicker cancels a half-typed inline create', () => {
        const body = fnBody(picker, 'closeProjectPicker');
        expect(body).toMatch(/cancelInlineCreate\(\)/);
    });

    it('main.js wires onCreateProjectNamed to the SAME #projButton create+select path', () => {
        // The picker is constructed with an onCreateProjectNamed callback bound
        // to createProjectByName, which drives the #projButton row-build and a
        // synthetic Enter commit (no parallel create path).
        expect(main).toMatch(/onCreateProjectNamed:\s*createProjectByName/);
        const body = fnBody(main, 'createProjectByName');
        expect(body).toMatch(/projButton\.click\(\)/);
        expect(body).toMatch(/#projInput/);
        expect(body).toMatch(/KeyboardEvent\(['"]keydown['"][\s\S]{0,60}?Enter/);
        // The drawer is NOT opened — desktop names in the dropdown, not the sidebar.
        expect(body).not.toMatch(/openMobileDrawer/);
    });

    it('CSS styles the header add button with the purple accent', () => {
        expect(css).toMatch(/\.projectPickerAddBtn\s*\{[^}]*background:\s*#6C5DF5/);
    });

    it('CSS hides the inline create row by default and reveals it via .open', () => {
        expect(css).toMatch(/\.projectPickerCreateRow\s*\{[^}]*display:\s*none/);
        expect(css).toMatch(/\.projectPickerCreateRow\.open\s*\{[^}]*display:\s*flex/);
        // Confirm + button carries the purple accent; the input shows a red
        // border on validation reject; the input is 16px to avoid iOS zoom.
        expect(css).toMatch(/\.projectPickerCreateConfirm\s*\{[^}]*background:\s*#6C5DF5/);
        expect(css).toMatch(/\.projectPickerCreateInput\.error\s*\{[^}]*border-color:\s*#e5484d/);
        expect(css).toMatch(/\.projectPickerCreateInput\s*\{[^}]*font-size:\s*16px/);
    });

    it('(d) closes on outside click but ignores clicks on the pill itself', () => {
        // A document click listener closes the open dropdown when the click
        // lands outside both the dropdown and the pill (the pill toggles).
        expect(main).toMatch(/projectPickerDropdown\.contains\(e\.target\)/);
        expect(main).toMatch(/mobileProjHeader\.contains\(e\.target\)/);
    });

    it('(e) Escape cancels the inline create input first, else closes the dropdown', () => {
        // A keydown handler in main.js guarded on the open dropdown gives the
        // inline create input first claim on Escape (cancel + clear, dropdown
        // stays open), and only closes the dropdown when nothing is being typed.
        expect(main).toMatch(/e\.key !== ['"]Escape['"]/);
        expect(main).toMatch(
            /if \(projectPicker\.cancelInlineCreate\(\)\) return;[\s\S]{0,40}?projectPicker\.close\(\)/
        );
    });

    it('closes the dropdown when the viewport drops to mobile widths', () => {
        // A resize listener inside the picker factory dismisses the dropdown when
        // it would otherwise be stranded below the 1024px breakpoint.
        expect(picker).toMatch(/addEventListener\(['"]resize['"][\s\S]*?window\.innerWidth\s*<\s*1024[\s\S]*?closeProjectPicker\(\)/);
    });

    it('(g) CSS force-hides the dropdown below 1024px', () => {
        const mobile = css.slice(css.indexOf('@media (max-width: 1023px) {\n  #projectPickerDropdown'));
        expect(mobile.slice(0, 120)).toMatch(/#projectPickerDropdown\s*\{\s*display:\s*none\s*!important/);
    });

    it('(g) CSS default-hides the dropdown and reveals it via .open', () => {
        expect(css).toMatch(/#projectPickerDropdown\s*\{[^}]*display:\s*none/);
        expect(css).toMatch(/#projectPickerDropdown\.open\s*\{[^}]*display:\s*block/);
    });

    it('(h) desktop header counts color "open" purple and "done" muted gray', () => {
        expect(css).toMatch(/#navBar #mobileProjOpen\s*\{\s*color:\s*#6C5DF5/);
        expect(css).toMatch(/#navBar #mobileProjDone\s*\{\s*color:\s*#5a5a6a/);
    });

    // Regression: the dropdown "only opens sometimes" race. activateProjectPicker
    // toggles at desktop (open ↔ close). The pill name (#mobileProjName) and the
    // ▾ indicator (#mobileProjChevron) carry their own click→activate handlers
    // AND are descendants of #mobileProjHeader, whose handler also activates. A
    // click on the name/chevron therefore fired the toggle twice (direct +
    // bubbled) — opening then immediately closing — while a click on the padding
    // fired once and opened. The fix: the header handler skips clicks that
    // originate on the name or the ▾ chevron so exactly one toggle runs per click.
    it('header handler skips name/chevron clicks to avoid the double-toggle', () => {
        // The name + ▾ chevron carry their own direct activate handlers, so the
        // header handler must exclude them (alongside the ‹ › carousel chevrons)
        // to keep exactly one toggle per click.
        expect(main).toMatch(
            /mobileProjHeader\.addEventListener\(['"]click['"][\s\S]{0,400}?closest\(['"]#mobileProjName, #mobileProjChevron['"]\)[\s\S]{0,80}?return/
        );
        // The per-element bindings the header handler defers to remain wired.
        expect(main).toMatch(/mobileProjName\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
        expect(main).toMatch(/mobileProjChevron\.addEventListener\(\s*['"]click['"]\s*,\s*activateProjectPicker\s*\)/);
    });

    it('toggles open/closed so a second pill click dismisses the dropdown', () => {
        const body = fnBody(picker, 'toggleProjectPicker');
        expect(body).toMatch(/projectPickerIsOpen\(\)/);
        expect(body).toMatch(/closeProjectPicker\(\)/);
        expect(body).toMatch(/openProjectPicker\(\)/);
    });
});
