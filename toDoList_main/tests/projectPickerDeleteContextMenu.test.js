import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The desktop project-picker dropdown gains a right-click / long-press
// "Delete project…" context menu — the affordance the desktop revamp dropped
// when it removed the per-row ×. main.js is too large to instantiate in jsdom
// (per CLAUDE.md), so these invariants are pinned by source inspection,
// mirroring projectPickerDropdown.test.js.
describe('desktop project-picker delete context menu', () => {
    const main = read('main.js');
    const css = read('style.css');

    // Slice a named function declaration's body from main.js.
    function fnBody(name) {
        const start = main.indexOf('function ' + name + '(');
        expect(start).toBeGreaterThan(-1);
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

    it('every dropdown row gets the delete context menu wired', () => {
        const body = fnBody('buildProjectPickerRows');
        expect(body).toMatch(/attachProjectPickerRowContextMenu\(row,\s*name\)/);
    });

    it('rows open the menu on right-click (contextmenu, preventDefault)', () => {
        const body = fnBody('attachProjectPickerRowContextMenu');
        expect(body).toMatch(/addEventListener\(['"]contextmenu['"]/);
        expect(body).toMatch(/event\.preventDefault\(\)/);
        expect(body).toMatch(/showProjectRowContextMenu\(event\.clientX,\s*event\.clientY/);
    });

    it('rows open the menu on a ~500ms long-press with a movement-cancel threshold', () => {
        const body = fnBody('attachProjectPickerRowContextMenu');
        // touch trio with a 500ms timer and a 10px movement cancel.
        expect(body).toMatch(/addEventListener\(['"]touchstart['"]/);
        expect(body).toMatch(/addEventListener\(['"]touchmove['"]/);
        expect(body).toMatch(/addEventListener\(['"]touchend['"]/);
        expect(body).toMatch(/setTimeout\([\s\S]*?,\s*500\)/);
        expect(body).toMatch(/>\s*10/);
        // long-press fire suppresses the follow-up tap (project navigation).
        expect(body).toMatch(/lpFired[\s\S]*?preventDefault\(\)/);
    });

    it('the menu is a single "Delete project…" danger item routed through deleteProjectFlow', () => {
        const body = fnBody('showProjectRowContextMenu');
        expect(body).toMatch(/id\s*=\s*['"]projRowContextMenu['"]/);
        expect(body).toMatch(/Delete project…/);
        expect(body).toMatch(/projContextMenuItem danger/);
        expect(body).toMatch(/deleteProjectFlow\(projChild,\s*projectName\)/);
    });

    it('the delete item resolves the backing #projChild by its #projInput value', () => {
        const body = fnBody('findProjChildByName');
        expect(body).toMatch(/querySelectorAll\(['"]#projChild['"]\)/);
        expect(body).toMatch(/querySelector\(['"]#projInput['"]\)/);
    });

    it('closes 4 ways: item select, outside click, Escape, right-click elsewhere', () => {
        const show = fnBody('showProjectRowContextMenu');
        // outside click + right-click elsewhere + Escape, all capture phase.
        expect(show).toMatch(/addEventListener\(['"]click['"],\s*onProjRowCtxOutsideClick,\s*true\)/);
        expect(show).toMatch(/addEventListener\(['"]contextmenu['"],\s*onProjRowCtxOutsideCtx,\s*true\)/);
        expect(show).toMatch(/addEventListener\(['"]keydown['"],\s*onProjRowCtxKeydown,\s*true\)/);
        // item-select close: the delete handler hides the menu itself.
        expect(show).toMatch(/hideProjectRowContextMenu\(\)/);
        // Escape handler keys off Escape and dismisses.
        const key = fnBody('onProjRowCtxKeydown');
        expect(key).toMatch(/e\.key !== ['"]Escape['"]/);
        expect(key).toMatch(/hideProjectRowContextMenu\(\)/);
    });

    it('hide tears down all global dismiss listeners (no leak)', () => {
        const body = fnBody('hideProjectRowContextMenu');
        expect(body).toMatch(/removeEventListener\(['"]click['"],\s*onProjRowCtxOutsideClick,\s*true\)/);
        expect(body).toMatch(/removeEventListener\(['"]contextmenu['"],\s*onProjRowCtxOutsideCtx,\s*true\)/);
        expect(body).toMatch(/removeEventListener\(['"]keydown['"],\s*onProjRowCtxKeydown,\s*true\)/);
    });

    it('CSS styles #projRowContextMenu by sharing the #projContextMenu surface', () => {
        expect(css).toMatch(/#projContextMenu,\s*#projRowContextMenu\s*\{/);
    });

    // Return the brace-matched bodies of every rule whose selector list
    // contains `selector` as a standalone token. Brace-matching (not a flat
    // regex) so the file's many nested @media blocks don't desync parsing.
    function ruleBodies(selector) {
        const bodies = [];
        let idx = 0;
        while ((idx = css.indexOf(selector, idx)) !== -1) {
            const after = css[idx + selector.length];
            const braceStart = css.indexOf('{', idx);
            // `after` must be a selector boundary (not e.g. `.open`), and the
            // gap up to `{` must be only more selectors / commas / whitespace.
            const between = braceStart === -1 ? '' : css.slice(idx + selector.length, braceStart);
            if (after && /[\s,{]/.test(after) && /^[\s,#.\w:>\-\[\]()="']*$/.test(between)) {
                let depth = 0, i = braceStart;
                for (; i < css.length; i++) {
                    if (css[i] === '{') depth++;
                    else if (css[i] === '}') { depth--; if (depth === 0) break; }
                }
                bodies.push(css.slice(braceStart + 1, i));
            }
            idx += selector.length;
        }
        return bodies;
    }

    // Effective z-index for an exact selector: the last rule that sets it wins.
    function zIndexOf(selector) {
        let z = null;
        for (const body of ruleBodies(selector)) {
            const zm = /z-index:\s*(\d+)/.exec(body);
            if (zm) z = parseInt(zm[1], 10);
        }
        return z;
    }

    // Regression: the menu is portaled to document.body alongside
    // #projectPickerDropdown, so it must stack ABOVE the dropdown — otherwise it
    // renders behind the dropdown that triggered it and "Delete project…" is
    // unreachable.
    it('#projRowContextMenu stacks above the project-picker dropdown', () => {
        const dropZ = zIndexOf('#projectPickerDropdown');
        const menuZ = zIndexOf('#projRowContextMenu');
        expect(dropZ).toBeGreaterThan(0);
        expect(menuZ).toBeGreaterThan(dropZ);
    });

    // Regression: the drawer's full project context menu (#projContextMenu —
    // Edit / color / Delete) is also portaled to document.body, so if it is ever
    // raised over the desktop picker it must clear the dropdown. The bare 20 it
    // shipped with sat below the dropdown's 100. A relational assertion (not a
    // bare number) fails the moment the two cross again, however the picker bumps
    // its own z-index.
    it('#projContextMenu stacks above the project-picker dropdown', () => {
        const dropZ = zIndexOf('#projectPickerDropdown');
        const menuZ = zIndexOf('#projContextMenu');
        expect(dropZ).toBeGreaterThan(0);
        expect(menuZ).toBeGreaterThan(dropZ);
    });

    // Regression: a portaled child can outlive its conceptual parent. When the
    // dropdown closes (outside click, Escape, resize to mobile), the menu must
    // close too — closeProjectPicker tears it down.
    it('closeProjectPicker also dismisses the portaled delete menu', () => {
        const body = fnBody('closeProjectPicker');
        expect(body).toMatch(/hideProjectRowContextMenu\(\)/);
    });
});

// The desktop dropdown's context menu reaches parity with the sidebar by
// exposing a Rename item above Delete, wired to the same rename flow the
// sidebar's Edit item uses. main.js is too large to instantiate in jsdom, so
// these invariants are pinned by source inspection (mirroring the delete suite
// above); projectRow.js's small surface is read directly for the parity check.
describe('desktop project-picker rename context menu', () => {
    const main = read('main.js');
    const projectRow = read('projectRow.js');

    function fnBody(name) {
        const start = main.indexOf('function ' + name + '(');
        expect(start).toBeGreaterThan(-1);
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

    it('the menu exposes a default-treatment "Rename" item', () => {
        const body = fnBody('showProjectRowContextMenu');
        // A default (non-danger) projContextMenuItem labelled Rename.
        expect(body).toMatch(/textContent\s*=\s*['"]Rename['"]/);
        // The Rename element is built with the plain item class (no danger).
        expect(body).toMatch(/className\s*=\s*['"]projContextMenuItem['"]\s*;/);
    });

    it('Rename sits above "Delete project…" in the menu', () => {
        const body = fnBody('showProjectRowContextMenu');
        const renameIdx = body.indexOf("'Rename'");
        const deleteIdx = body.indexOf('Delete project…');
        expect(renameIdx).toBeGreaterThan(-1);
        expect(deleteIdx).toBeGreaterThan(-1);
        expect(renameIdx).toBeLessThan(deleteIdx);
    });

    it('Rename closes the menu + dropdown and routes through beginProjectRename on the backing #projChild', () => {
        const body = fnBody('showProjectRowContextMenu');
        // Selecting Rename tears down the menu, closes the dropdown, resolves the
        // backing row by name, and hands its #projInput to the shared rename flow.
        expect(body).toMatch(/hideProjectRowContextMenu\(\)/);
        expect(body).toMatch(/closeProjectPicker\(\)/);
        expect(body).toMatch(/findProjChildByName\(projectName\)/);
        expect(body).toMatch(/querySelector\(['"]#projInput['"]\)/);
        expect(body).toMatch(/beginProjectRename\(projChild,\s*input\)/);
    });

    it('main.js imports beginProjectRename from projectRow.js', () => {
        expect(main).toMatch(/import\s*\{[\s\S]*?beginProjectRename[\s\S]*?\}\s*from\s*['"]\.\/projectRow\.js['"]/);
    });

    // Parity: the sidebar's Edit item and the dropdown's Rename item must drive
    // the SAME rename flow. projectRow.js exports beginProjectRename, and the
    // sidebar context menu's onEdit routes through it — so both surfaces fire
    // the identical callback.
    it('projectRow.js exports beginProjectRename and the sidebar Edit routes through it', () => {
        expect(projectRow).toMatch(/export function beginProjectRename\(projChild,\s*titleInput\)/);
        const onEditIdx = projectRow.indexOf('function onEdit()');
        expect(onEditIdx).toBeGreaterThan(-1);
        const onEditBody = projectRow.slice(onEditIdx, onEditIdx + 120);
        expect(onEditBody).toMatch(/beginProjectRename\(projChild,\s*titleInput\)/);
    });
});
