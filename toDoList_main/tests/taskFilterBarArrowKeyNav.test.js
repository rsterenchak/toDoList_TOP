import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { buildTaskFilterBar, firstFocusableInTaskFilterBar, taskFilterArrowTarget } from '../src/taskFilter.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The status/sort filter bar (#taskFilterBar) sits in the DOM directly between
// the view switcher and the todo list. This pins its arrow-key contract: it is
// a two-way stop, so ArrowUp from the top of the list lands on the bar first
// (only a second ArrowUp reaches the view pill) and ArrowDown from a view pill
// lands on the bar first (only a second ArrowDown reaches the list).

describe('firstFocusableInTaskFilterBar — visible-control resolution', () => {
    // jsdom does no layout, so getClientRects() is empty for every element by
    // default. buildTaskFilterBar CSS-hides the desktop cycle pill on mobile
    // and the segmented control on desktop; the helper distinguishes them via
    // getClientRects (empty => hidden). Stub it per test to model a breakpoint.
    function show(el) {
        el.getClientRects = () => [{ width: 40, height: 20 }];
    }

    beforeEach(() => {
        document.body.innerHTML = '';
    });
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('returns the desktop cycle pill when it is the on-screen control', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        show(bar.querySelector('.taskCyclePill'));
        expect(firstFocusableInTaskFilterBar()).toBe(bar.querySelector('.taskCyclePill'));
    });

    it('skips the CSS-hidden cycle pill and returns the first visible mobile segment', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        // Cycle pill hidden (default empty rects); segments visible.
        const segs = bar.querySelectorAll('.taskFilterSeg');
        segs.forEach(show);
        expect(firstFocusableInTaskFilterBar()).toBe(segs[0]);
    });

    it('returns null when the bar is present but nothing is on screen', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        // No control stubbed visible — mirrors the bar being display:none
        // outside the Projects view, so callers fall back to their old target.
        expect(firstFocusableInTaskFilterBar()).toBeNull();
    });

    it('returns null when there is no filter bar in the document', () => {
        expect(firstFocusableInTaskFilterBar()).toBeNull();
    });

    it('skips a disabled visible control', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        const pill = bar.querySelector('.taskCyclePill');
        show(pill);
        pill.disabled = true;
        // Only the pill is visible; disabled => no focusable control on screen.
        expect(firstFocusableInTaskFilterBar()).toBeNull();
    });
});

describe('taskFilterArrowTarget — Left/Right roving between filter and Sort', () => {
    // jsdom does no layout, so getClientRects() is empty by default (=> hidden).
    // Stub it per element to model the on-screen breakpoint controls.
    function show(el) {
        el.getClientRects = () => [{ width: 40, height: 20 }];
    }

    // The desktop Sort trigger (#taskSortBtn) is created in main.js, not by
    // buildTaskFilterBar, so add stand-ins with the ids the helper resolves.
    function addSortBtn(id) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = id;
        document.body.appendChild(btn);
        return btn;
    }

    beforeEach(() => {
        document.body.innerHTML = '';
    });
    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('desktop: ArrowRight moves from the cycle pill to the Sort trigger', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        const pill = bar.querySelector('.taskCyclePill');
        const sort = addSortBtn('taskSortBtn');
        show(pill);
        show(sort);
        expect(taskFilterArrowTarget(pill, 'ArrowRight')).toBe(sort);
    });

    it('desktop: ArrowLeft moves from the Sort trigger back to the cycle pill', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        const pill = bar.querySelector('.taskCyclePill');
        const sort = addSortBtn('taskSortBtn');
        show(pill);
        show(sort);
        expect(taskFilterArrowTarget(sort, 'ArrowLeft')).toBe(pill);
    });

    it('clamps at both ends — ArrowLeft on the pill and ArrowRight on Sort return null', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        const pill = bar.querySelector('.taskCyclePill');
        const sort = addSortBtn('taskSortBtn');
        show(pill);
        show(sort);
        expect(taskFilterArrowTarget(pill, 'ArrowLeft')).toBeNull();
        expect(taskFilterArrowTarget(sort, 'ArrowRight')).toBeNull();
    });

    it('mobile: arrows rove across the visible segments and into the mobile Sort trigger', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        // Cycle pill hidden (default empty rects); segments + mobile sort visible.
        const segs = bar.querySelectorAll('.taskFilterSeg');
        segs.forEach(show);
        const mobileSort = addSortBtn('taskSortBtnMobile');
        show(mobileSort);
        expect(taskFilterArrowTarget(segs[0], 'ArrowRight')).toBe(segs[1]);
        expect(taskFilterArrowTarget(segs[2], 'ArrowRight')).toBe(mobileSort);
        expect(taskFilterArrowTarget(mobileSort, 'ArrowLeft')).toBe(segs[2]);
    });

    it('ignores non-horizontal keys', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        const pill = bar.querySelector('.taskCyclePill');
        const sort = addSortBtn('taskSortBtn');
        show(pill);
        show(sort);
        expect(taskFilterArrowTarget(pill, 'ArrowUp')).toBeNull();
        expect(taskFilterArrowTarget(pill, 'Enter')).toBeNull();
        expect(taskFilterArrowTarget(pill, ' ')).toBeNull();
    });

    it('returns null when only one control is on screen (nothing to move to)', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        const pill = bar.querySelector('.taskCyclePill');
        show(pill);
        // No visible Sort trigger => no partner.
        expect(taskFilterArrowTarget(pill, 'ArrowRight')).toBeNull();
    });

    it('returns null when the focused element is not a filter/sort control', () => {
        const bar = buildTaskFilterBar();
        document.body.appendChild(bar);
        show(bar.querySelector('.taskCyclePill'));
        show(addSortBtn('taskSortBtn'));
        const stray = document.createElement('button');
        document.body.appendChild(stray);
        expect(taskFilterArrowTarget(stray, 'ArrowRight')).toBeNull();
    });
});

describe('filter-bar arrow-key wiring in main.js', () => {
    const main = read('main.js');

    function extractFn(signature) {
        const start = main.indexOf(signature);
        if (start === -1) throw new Error('signature not found: ' + signature);
        const bodyStart = main.indexOf('{', start);
        let depth = 0;
        for (let i = bodyStart; i < main.length; i++) {
            const c = main[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return main.slice(bodyStart, i + 1);
            }
        }
        throw new Error('unterminated block for: ' + signature);
    }

    it('imports the filter-bar focus helper from taskFilter.js', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*firstFocusableInTaskFilterBar[^}]*\}\s*from\s*['"]\.\/taskFilter\.js['"]/
        );
    });

    it('imports the Left/Right target resolver from taskFilter.js', () => {
        expect(main).toMatch(
            /import\s*\{[^}]*taskFilterArrowTarget[^}]*\}\s*from\s*['"]\.\/taskFilter\.js['"]/
        );
    });

    it('wires a Left/Right keydown handler on main2 that delegates to taskFilterArrowTarget', () => {
        // The desktop Sort trigger sits in the #bulkDescActions sibling, so the
        // horizontal handler lives on main2 (their shared parent), not the bar.
        const body = extractFn("main2.addEventListener('keydown'");
        expect(body).toMatch(/ArrowLeft/);
        expect(body).toMatch(/ArrowRight/);
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/shiftKey/);
        expect(body).toMatch(/getActiveView\(\s*\)\s*!==\s*['"]projects['"]/);
        expect(body).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
        // Only acts when a real filter/sort control is focused.
        expect(body).toMatch(/taskCyclePill/);
        expect(body).toMatch(/taskFilterSeg/);
        expect(body).toMatch(/taskSortBtn/);
        expect(body).toMatch(/taskFilterArrowTarget/);
        // preventDefault + stopPropagation so the document todo-arrow handler
        // can't also fire and clobber the placed focus.
        expect(body).toMatch(/preventDefault\(\s*\)/);
        expect(body).toMatch(/stopPropagation\(\s*\)/);
    });

    it('the pill drop-in (ArrowDown) tries the filter bar before falling into the list', () => {
        const body = extractFn('function dropFocusIntoMainView');
        // The filter bar is the first stop below a view pill; the list is the
        // fallback. Ordering the OR this way makes the bar the first landing
        // and the list the second ArrowDown target.
        expect(body).toMatch(
            /firstFocusableInTaskFilterBar\(\s*\)\s*\|\|\s*firstFocusableInActiveMainView\(\s*\)/
        );
    });

    it('the placeholder ArrowUp escape tries the filter bar before the view pill', () => {
        // Grep the whole file: the escape branch resolves its target as the
        // filter-bar control OR the active view pill, so ArrowUp from the top
        // of the list stops on the bar first.
        expect(main).toMatch(
            /firstFocusableInTaskFilterBar\(\s*\)\s*\|\|[\s\S]{0,120}#viewSwitcher \.viewPill\.active/
        );
    });

    it('wires a keydown handler on the filter bar covering ArrowUp and ArrowDown', () => {
        expect(main).toMatch(/taskFilterBar\.addEventListener\(\s*['"]keydown['"]/);
    });

    it('the filter-bar keydown handler is gated to the Projects view and modifier-free', () => {
        const idx = main.indexOf("taskFilterBar.addEventListener('keydown'");
        expect(idx).toBeGreaterThan(-1);
        const body = extractFn("taskFilterBar.addEventListener('keydown'");
        // Only unmodified ArrowUp/ArrowDown, and only in PROJECTS (the only
        // view where the bar is visible); Agent/Structure keep native behaviour.
        expect(body).toMatch(/ArrowUp/);
        expect(body).toMatch(/ArrowDown/);
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/shiftKey/);
        expect(body).toMatch(/getActiveView\(\s*\)\s*!==\s*['"]projects['"]/);
        expect(body).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
    });

    it('the filter-bar keydown handler escapes up to the view pill and drops into the list', () => {
        const body = extractFn("taskFilterBar.addEventListener('keydown'");
        // ArrowUp → active view pill; ArrowDown → the same list-only target the
        // pill drop-in uses, so the two-way chain stays symmetric.
        expect(body).toMatch(/#viewSwitcher \.viewPill\.active/);
        expect(body).toMatch(/firstFocusableInActiveMainView\(\s*\)/);
        // Must only act when a real filter/sort control is focused.
        expect(body).toMatch(/taskCyclePill/);
        expect(body).toMatch(/taskFilterSeg/);
        expect(body).toMatch(/taskSortBtnMobile/);
    });

    it('the filter-bar keydown handler preventDefaults and stops propagation', () => {
        const body = extractFn("taskFilterBar.addEventListener('keydown'");
        // Without stopPropagation the document-level todo arrow handler would
        // also fire and clobber the focus we place.
        expect(body).toMatch(/preventDefault\(\s*\)/);
        expect(body).toMatch(/stopPropagation\(\s*\)/);
    });
});
