import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The desktop anchored project-picker dropdown replaces the slide-in drawer
// at ≥1024px while leaving the mobile (<1024px) drawer untouched. main.js is
// too large to instantiate in jsdom (per CLAUDE.md), so these invariants are
// pinned by source inspection, mirroring mobileProjHeaderDesktopRow.test.js.
describe('desktop project-picker dropdown', () => {
    const main = read('main.js');
    const css = read('style.css');

    // Slice a named function declaration's body from main.js.
    function fnBody(name) {
        const start = main.indexOf('function ' + name + '(');
        expect(start).toBeGreaterThan(-1);
        // Walk braces to find the matching close.
        let i = main.indexOf('{', start);
        let depth = 0;
        for (; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) return main.slice(start, i + 1);
            }
        }
        throw new Error('unbalanced braces for ' + name);
    }

    it('creates a #projectPickerDropdown element mounted on the body', () => {
        expect(main).toMatch(/projectPickerDropdown\.id\s*=\s*['"]projectPickerDropdown['"]/);
        expect(main).toMatch(/document\.body\.appendChild\(projectPickerDropdown\)/);
    });

    it('(a/b) at desktop the pill activation opens the dropdown, NOT the drawer', () => {
        const body = fnBody('activateProjectPicker');
        // Branches on the 1024px breakpoint.
        expect(body).toMatch(/window\.innerWidth\s*>=\s*1024/);
        // Desktop branch toggles the dropdown.
        expect(body).toMatch(/toggleProjectPicker\(\)/);
    });

    it('(f) at mobile the pill activation opens the slide-in drawer', () => {
        const body = fnBody('activateProjectPicker');
        // The else branch (mobile) routes to the existing drawer opener.
        expect(body).toMatch(/openMobileDrawer\(\)/);
    });

    it('(c) clicking a dropdown row routes through the shared selection path then dismisses', () => {
        const body = fnBody('buildProjectPickerRows');
        // Reuses the same project-selection codepath the drawer rows use.
        expect(body).toMatch(/navigateToProjectByIndex\(/);
        // And closes the dropdown after selection.
        expect(body).toMatch(/closeProjectPicker\(\)/);
    });

    it('reuses listLogic project data + counts (no duplicated project list)', () => {
        const body = fnBody('buildProjectPickerRows');
        expect(body).toMatch(/listLogic\.listProjectsArray\(\)/);
        expect(body).toMatch(/listLogic\.getProjectIncompleteCount/);
    });

    it('highlights the active project row', () => {
        const body = fnBody('buildProjectPickerRows');
        // Active row is flagged off the live header name and gets the
        // .active class (purple accent + ✓ in CSS / markup).
        expect(body).toMatch(/mobileProjName\.textContent/);
        expect(body).toMatch(/classList\.add\(['"]active['"]\)/);
        expect(body).toMatch(/✓/);
    });

    it('does NOT introduce a new create-project path (footer omitted)', () => {
        const body = fnBody('buildProjectPickerRows');
        // The drawer's create flow (#projButton) is not invoked from the
        // dropdown — the footer is intentionally omitted.
        expect(body).not.toMatch(/projButton/);
    });

    it('(d) closes on outside click but ignores clicks on the pill itself', () => {
        // A document click listener closes the open dropdown when the click
        // lands outside both the dropdown and the pill (the pill toggles).
        expect(main).toMatch(/projectPickerDropdown\.contains\(e\.target\)/);
        expect(main).toMatch(/mobileProjHeader\.contains\(e\.target\)/);
    });

    it('(e) closes on Escape', () => {
        // A keydown handler guarded on the open dropdown closes it on Escape.
        expect(main).toMatch(/if \(!projectPickerIsOpen\(\)\) return;[\s\S]{0,120}?closeProjectPicker\(\)/);
        expect(main).toMatch(/e\.key !== ['"]Escape['"]/);
    });

    it('closes the dropdown when the viewport drops to mobile widths', () => {
        // A resize listener dismisses the dropdown when it would otherwise be
        // stranded below the 1024px breakpoint.
        expect(main).toMatch(/addEventListener\(['"]resize['"][\s\S]*?window\.innerWidth\s*<\s*1024[\s\S]*?closeProjectPicker\(\)/);
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
        const body = fnBody('toggleProjectPicker');
        expect(body).toMatch(/projectPickerIsOpen\(\)/);
        expect(body).toMatch(/closeProjectPicker\(\)/);
        expect(body).toMatch(/openProjectPicker\(\)/);
    });
});
