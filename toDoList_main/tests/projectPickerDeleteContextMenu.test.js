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
});
