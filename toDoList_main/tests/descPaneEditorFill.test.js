import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { placeDescPanel } from '../src/toDoRow.js';

// Regression: in the desktop detail pane the WRITE-stage description textarea
// stopped growing at ~10 lines and scrolled internally while a large void sat
// between it and the docked footer. The footer reflow had already given the
// textarea its flex contract (`flex: 1 1 auto; min-height: 96px`), but the
// element still ran the INLINE host's sizing model on top of it: the auto-grow
// handler wrote `descInput.style.height` from scrollHeight, and the desktop
// `#descInput { max-height: 200px }` rule clamped the result. An inline height
// wins over any CSS fill, so the flex slack went unused.
//
// The fix has two halves and BOTH must hold — either one alone leaves the cap
// in place, so each is pinned separately here:
//   (a) CSS — the pane's textarea rule neutralizes the shared 200px clamp and
//       states `height: auto` / `overflow-y: auto` so the fill scrolls
//       internally instead of growing.
//   (b) JS — the auto-grow handler stands down in the pane (the
//       `descEditorFill` marker placeDescPanel sets) and the marker clears any
//       inline height a previous host left behind, since CSS cannot override
//       an inline style.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Every top-level rule body whose (possibly comma-grouped) selector list
// contains `needle` — the pane reflow splits this child's declarations across a
// grouped rule and a standalone one, so "the first match" is not the answer.
function ruleBodies(css, needle) {
    const bodies = [];
    let depth = 0;
    let selectorStart = 0;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '{') {
            if (depth === 0 && css.slice(selectorStart, i).includes(needle)) {
                bodies.push(css.slice(i + 1, css.indexOf('}', i)));
            }
            depth++;
            continue;
        }
        if (c === '}') {
            depth--;
            if (depth === 0) selectorStart = i + 1;
        }
    }
    return bodies;
}

function declares(css, needle, decl) {
    const bodies = ruleBodies(css, needle);
    expect(bodies.length, `no rule matches ${needle}`).toBeGreaterThan(0);
    return bodies.some((body) => decl.test(body));
}

const PANE_TEXTAREA = '#descDetailPane #descSibling > #descInput';

describe('detail pane entry editor — the CSS fill contract', () => {
    const css = read('style.css');

    it('neutralizes the shared 200px clamp in the pane, where nothing sits below to be pushed', () => {
        expect(declares(css, PANE_TEXTAREA, /max-height:\s*none\s*;/)).toBe(true);
    });

    it('states height: auto so the flex basis comes from the pane, not from the content', () => {
        expect(declares(css, PANE_TEXTAREA, /height:\s*auto\s*;/)).toBe(true);
    });

    it('scrolls the overflow internally so the docked footer never moves', () => {
        expect(declares(css, PANE_TEXTAREA, /overflow-y:\s*auto\s*;/)).toBe(true);
    });

    it('keeps the flex-fill contract the footer reflow established', () => {
        // The basis later tightened from `auto` to 0 — with basis auto the textarea's
        // hypothetical main size is its content, which is what kept feeding a long
        // entry's height up the stack (see descPaneStackBasis.test.js).
        expect(declares(css, PANE_TEXTAREA, /flex:\s*1\s+1\s+0\s*;/)).toBe(true);
        expect(declares(css, PANE_TEXTAREA, /min-height:\s*96px\s*;/)).toBe(true);
    });

    it('leaves the shared desktop clamp in place for the inline host', () => {
        // Scoped neutralization, not removal: inline, an uncapped textarea
        // pushes the todos below it down — the defect that rule exists for.
        const blockRe = /@media\s*\(\s*min-width:\s*1024px\s*\)\s*\{([\s\S]*?)\n\}/g;
        let match;
        let capped = false;
        while ((match = blockRe.exec(css)) !== null) {
            const rule = match[1].match(/#descInput\s*\{([^}]*)\}/);
            if (rule && /max-height:\s*200px/.test(rule[1])) capped = true;
        }
        expect(capped).toBe(true);
    });

    it('leaves the review-stage read-only view on its own clamp-and-scroll contract', () => {
        // The fix is scoped to the WRITE-stage textarea; `accept` hides it and
        // .descReviewEntryView fills instead, with sizing of its own.
        expect(ruleBodies(css, PANE_TEXTAREA).join('\n')).not.toMatch(/descReviewEntryView/);
        expect(declares(css, '#descDetailPane #descSibling > .descReviewEntryView', /flex:\s*1\s+1\s+0\s*;/))
            .toBe(true);
    });
});

describe('detail pane entry editor — the fill marker', () => {
    const realInnerWidth = window.innerWidth;

    function setWidth(w) {
        Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
    }

    // The minimal row + panel cross-links buildToDoRow sets; buildToDoRow itself
    // is too heavily wired for a full jsdom instantiation, so the placement
    // helper is exercised directly (as the sibling pane suites do).
    function makeRow() {
        const row = document.createElement('div');
        row.id = 'toDoChild';
        const panel = document.createElement('div');
        panel.id = 'descSibling';
        const input = document.createElement('textarea');
        input.id = 'descInput';
        panel.appendChild(input);
        row.__descSibling = panel;
        panel.__ownerRow = row;
        return { row, panel, input };
    }

    function mountPaneHost() {
        const pane = document.createElement('div');
        pane.id = 'descDetailPane';
        document.body.appendChild(pane);
        return pane;
    }

    function mountList() {
        const list = document.createElement('div');
        list.id = 'mainList';
        document.body.appendChild(list);
        return list;
    }

    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => { setWidth(realInnerWidth); document.body.innerHTML = ''; });

    it('marks the textarea as host-sized when the panel mounts into the pane', () => {
        setWidth(1280);
        mountPaneHost();
        const list = mountList();
        const { row, panel, input } = makeRow();
        list.appendChild(row);

        placeDescPanel(panel, row);

        expect(input.classList.contains('descEditorFill')).toBe(true);
    });

    it('clears a stale inline height the inline host left behind', () => {
        // This is the half CSS cannot do: `height: auto` in a stylesheet loses
        // to an inline style, so a value written while inline would survive the
        // move and cap the fill at the old content height.
        setWidth(1280);
        mountPaneHost();
        const list = mountList();
        const { row, panel, input } = makeRow();
        list.appendChild(row);
        input.style.height = '184px';

        placeDescPanel(panel, row);

        expect(input.style.height).toBe('');
    });

    it('drops the marker when the panel mounts inline, so auto-grow resumes', () => {
        setWidth(800);
        mountPaneHost();
        const list = mountList();
        const { row, panel, input } = makeRow();
        list.appendChild(row);
        input.classList.add('descEditorFill');

        placeDescPanel(panel, row);

        expect(input.classList.contains('descEditorFill')).toBe(false);
    });

    it('re-measures the textarea when it leaves the pane for the inline host', () => {
        // Crossing back out, nothing has written a height since the pane took
        // over — without a re-measure the textarea would render one row tall.
        setWidth(1280);
        mountPaneHost();
        const list = mountList();
        const { row, panel, input } = makeRow();
        list.appendChild(row);
        placeDescPanel(panel, row);

        let grew = 0;
        input.addEventListener('input', () => { grew++; });
        setWidth(800);
        placeDescPanel(panel, row);

        expect(grew).toBe(1);
    });

    it('does not fire a re-measure on an ordinary inline open', () => {
        setWidth(800);
        mountPaneHost();
        const list = mountList();
        const { row, panel, input } = makeRow();
        list.appendChild(row);

        let grew = 0;
        input.addEventListener('input', () => { grew++; });
        placeDescPanel(panel, row);

        expect(grew).toBe(0);
    });

    it('is a no-op on a panel with no textarea', () => {
        setWidth(1280);
        mountPaneHost();
        const list = mountList();
        const { row, panel, input } = makeRow();
        panel.removeChild(input);
        list.appendChild(row);

        expect(() => placeDescPanel(panel, row)).not.toThrow();
    });
});

describe('detail pane entry editor — the auto-grow gate', () => {
    // The handler is a closure inside buildToDoRow, which is too heavily wired
    // to instantiate here — so lift the SHIPPED function body out of the source
    // and run it. A copy of the logic would keep passing after the gate was
    // deleted; this cannot.
    function loadAutoGrow() {
        const js = read('toDoRow.js');
        const match = js.match(/\n(\s*)function autoGrowDescInput\(\) \{[\s\S]*?\n\1\}/);
        expect(match, 'autoGrowDescInput not found in toDoRow.js').not.toBeNull();
        // eslint-disable-next-line no-new-func
        return new Function('descInput', `${match[0]}; return autoGrowDescInput;`);
    }

    function makeInput(scrollHeight) {
        const input = document.createElement('textarea');
        Object.defineProperty(input, 'scrollHeight', { value: scrollHeight, configurable: true });
        return input;
    }

    it('writes scrollHeight into the inline height in the inline host', () => {
        const input = makeInput(260);
        loadAutoGrow()(input)();
        expect(input.style.height).toBe('260px');
    });

    it('writes nothing while the pane owns the height', () => {
        const input = makeInput(260);
        input.classList.add('descEditorFill');
        loadAutoGrow()(input)();
        expect(input.style.height).toBe('');
    });

    it('clears a height already on the element rather than leaving it to cap the fill', () => {
        const input = makeInput(260);
        input.classList.add('descEditorFill');
        input.style.height = '184px';
        loadAutoGrow()(input)();
        expect(input.style.height).toBe('');
    });
});
