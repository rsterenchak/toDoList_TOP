import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, it, expect } from 'vitest';

import {
    attachMobileCreateChips,
    applyChosenDueToItem,
    resetMobileCreateSession,
    markChainingActive,
    isChainingActive,
    getChosenDueChip,
} from '../src/mobileTaskCreate.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}


// Pins the STACK mobile inline-expand task-creation slice: the dashed
// `+ Add a task…` placeholder row at the ≤1023px breakpoint expands on
// focus to reveal a chip row (Today / Tomorrow / 📅 / + ¶), the user's
// last picked date chip persists across chained Return-commits via a
// module-level session variable (NOT localStorage), and the session
// resets on project switch. Source inspection is paired with light DOM
// instantiation against the exported helpers — `buildToDoRow` itself is
// too heavily wired to load end-to-end here, but the chip module's
// public surface is small enough to exercise directly.

describe('STACK mobile inline-expand task creation — session state', () => {

    beforeEach(() => {
        resetMobileCreateSession();
    });

    it('defaults the date chip to Today on a fresh session', () => {
        expect(getChosenDueChip()).toBe('today');
    });

    it('chaining starts inactive — first blank placeholder still reads "Add a task…"', () => {
        expect(isChainingActive()).toBe(false);
    });

    it('markChainingActive flips chaining mode on, resetMobileCreateSession flips it back', () => {
        markChainingActive();
        expect(isChainingActive()).toBe(true);
        resetMobileCreateSession();
        expect(isChainingActive()).toBe(false);
    });

    it('resetMobileCreateSession returns the chip to Today even after a switch to Tomorrow', () => {
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);
        row.querySelector('[data-chip="tomorrow"]').click();
        expect(getChosenDueChip()).toBe('tomorrow');
        resetMobileCreateSession();
        expect(getChosenDueChip()).toBe('today');
    });
});


describe('STACK mobile inline-expand task creation — chip row DOM', () => {

    beforeEach(() => {
        resetMobileCreateSession();
        document.body.innerHTML = '';
    });

    it('appends the chip row only to a blank placeholder', () => {
        const blankRow = makeBlankRow();
        attachMobileCreateChips(blankRow, blankRow.__item);
        expect(blankRow.querySelector('#mobileCreateChips')).not.toBeNull();

        const committedRow = makeRowForItem({ tit: 'walk dog', due: '' });
        attachMobileCreateChips(committedRow, committedRow.__item);
        expect(committedRow.querySelector('#mobileCreateChips')).toBeNull();
    });

    it('marks the placeholder row with data-blank-placeholder for CSS targeting', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        expect(row.getAttribute('data-blank-placeholder')).toBe('true');
    });

    it('renders four chips — Today, Tomorrow, 📅 calendar, and + ¶ description toggle', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        const chips = row.querySelector('#mobileCreateChips');
        expect(chips).not.toBeNull();
        expect(chips.querySelector('[data-chip="today"]').textContent).toBe('Today');
        expect(chips.querySelector('[data-chip="tomorrow"]').textContent).toBe('Tomorrow');
        expect(chips.querySelector('[data-chip="custom"]').textContent).toBe('📅');
        expect(chips.querySelector('#mobileCreateDescChip')).not.toBeNull();
    });

    it('highlights the currently-chosen chip via mobileCreateChipSelected', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        const today = row.querySelector('[data-chip="today"]');
        expect(today.classList.contains('mobileCreateChipSelected')).toBe(true);

        row.querySelector('[data-chip="tomorrow"]').click();
        const tomorrow = row.querySelector('[data-chip="tomorrow"]');
        expect(tomorrow.classList.contains('mobileCreateChipSelected')).toBe(true);
        expect(today.classList.contains('mobileCreateChipSelected')).toBe(false);
    });

    it('Today chip updates session state to "today" and clears any stale custom due', () => {
        const row = makeBlankRow();
        const item = row.__item;
        item.due = '6-15-2026';
        attachMobileCreateChips(row, item);

        row.querySelector('[data-chip="today"]').click();
        expect(getChosenDueChip()).toBe('today');
        // Stale custom-picked due must be cleared so the on-commit stamp
        // applies the chip's date instead of falling back through.
        expect(item.due).toBe('');
    });

    it('Tomorrow chip updates session state to "tomorrow"', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);

        row.querySelector('[data-chip="tomorrow"]').click();
        expect(getChosenDueChip()).toBe('tomorrow');
    });
});


describe('STACK mobile inline-expand task creation — applyChosenDueToItem', () => {

    beforeEach(() => {
        resetMobileCreateSession();
        document.body.innerHTML = '';
    });

    it('stamps today\'s M-D-YYYY when chip is Today', () => {
        const row = makeBlankRow();
        const item = row.__item;
        applyChosenDueToItem(item, row);
        const today = new Date();
        const expected = (today.getMonth() + 1) + '-' + today.getDate() + '-' + today.getFullYear();
        expect(item.due).toBe(expected);
    });

    it('stamps tomorrow\'s M-D-YYYY when chip is Tomorrow', () => {
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);
        row.querySelector('[data-chip="tomorrow"]').click();

        applyChosenDueToItem(item, row);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const expected = (tomorrow.getMonth() + 1) + '-' + tomorrow.getDate() + '-' + tomorrow.getFullYear();
        expect(item.due).toBe(expected);
    });
});


describe('STACK mobile inline-expand task creation — toDoRow.js wiring', () => {

    const toDoRow = read('toDoRow.js');

    it('imports the mobileTaskCreate module', () => {
        expect(toDoRow).toMatch(/from\s+['"]\.\/mobileTaskCreate\.js['"]/);
    });

    it('attaches the chip row from buildToDoRow', () => {
        expect(toDoRow).toMatch(/attachMobileCreateChips\(toDoChild,\s*item\)/);
    });

    it('applies the chosen date inside the title-commit handler before the default fallback', () => {
        // The chip-stamp must happen before the default-fallback math so
        // a chip-chosen Today/Tomorrow lands instead of the default. Anchor
        // on the fallback CALL inside the commit handler (the `const
        // fallback = defaultDueParts();` line), not the top-of-file
        // function declaration.
        const chipIdx = toDoRow.indexOf('applyChosenDueToItem(item, toDoChild)');
        const fallbackIdx = toDoRow.indexOf('const fallback = defaultDueParts()');
        expect(chipIdx).toBeGreaterThan(-1);
        expect(fallbackIdx).toBeGreaterThan(-1);
        expect(chipIdx).toBeLessThan(fallbackIdx);
    });

    it('only applies the chip stamp at the <1024px breakpoint', () => {
        // The chip flow is mobile-specific; desktop relies on the default fallback.
        expect(toDoRow).toMatch(/window\.innerWidth\s*<\s*1024[\s\S]*?applyChosenDueToItem/);
    });

    it('defaults an untouched new task to today (offset 0) so desktop matches mobile', () => {
        // Regression: desktop previously stamped today + 7 on commit-without-date,
        // diverging from mobile's today default. The commit fallback offset must be 0.
        expect(toDoRow).toMatch(/const\s+DEFAULT_DUE_OFFSET_DAYS\s*=\s*0\s*;/);
    });

    it('marks chaining active on every mobile commit', () => {
        expect(toDoRow).toMatch(/markChainingActive\(\)/);
    });

    it('swaps the placeholder to "Type the next…" on chained blank placeholders', () => {
        // Initial blank keeps "Add a task — press Enter"; chained blanks
        // (after the first commit) read as the continuation copy.
        expect(toDoRow).toMatch(/['"]Type the next…['"]/);
        expect(toDoRow).toMatch(/isChainingActive\(\)/);
    });

    it('triggers the 700ms purple accent on the just-committed row', () => {
        expect(toDoRow).toMatch(/justCommittedMobile/);
        expect(toDoRow).toMatch(/setTimeout\([^,]+,\s*700\s*\)/);
    });

    it('strips the chip row + data-blank-placeholder attr on commit', () => {
        // Without these, the committed row would still carry the chip
        // affordance — visually wrong and confusing on mobile.
        expect(toDoRow).toMatch(/removeAttribute\(\s*['"]data-blank-placeholder['"]\s*\)/);
        expect(toDoRow).toMatch(/mobileCreateChips[\s\S]*?\.remove\(\)/);
    });
});


describe('STACK mobile inline-expand task creation — main.js project switch reset', () => {

    const main = read('main.js');

    it('imports resetMobileCreateSession from the chip module', () => {
        expect(main).toMatch(/import\s*\{\s*resetMobileCreateSession\s*\}\s*from\s*['"]\.\/mobileTaskCreate\.js['"]/);
    });

    it('calls resetMobileCreateSession on every project switch', () => {
        // Without this hook the new project's first blank would carry the
        // previous project's chip selection — violating "resets on project
        // switch" in the STACK spec.
        expect(main).toMatch(/resetMobileCreateSession\(\)/);
    });
});


describe('STACK mobile inline-expand task creation — CSS surface', () => {

    const css = read('style.css');

    it('hides the chip row by default and reveals it only when the placeholder row is focus-within', () => {
        expect(css).toMatch(/#mobileCreateChips\s*\{[^}]*display:\s*none/);
        expect(css).toMatch(/#toDoChild\[data-blank-placeholder\]:focus-within\s+#mobileCreateChips\s*\{[\s\S]*?display:\s*flex/);
    });

    it('gives the chips a ≥44px touch target', () => {
        expect(css).toMatch(/\.mobileCreateChip\s*\{[\s\S]*?min-height:\s*44px/);
    });

    it('paints a selected chip with the accent fill', () => {
        expect(css).toMatch(/\.mobileCreateChip\.mobileCreateChipSelected\s*\{[\s\S]*?background:\s*var\(--accent\)/);
    });

    it('defines a 0.7s fading accent keyframe and gates the animation behind .justCommittedMobile', () => {
        expect(css).toMatch(/@keyframes\s+justCommittedMobileFlash/);
        expect(css).toMatch(/#toDoChild\.justCommittedMobile\s*\{[\s\S]*?animation:\s*justCommittedMobileFlash\s+0\.7s/);
    });

    it('respects prefers-reduced-motion by disabling the just-committed flash', () => {
        expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.justCommittedMobile[\s\S]*?animation:\s*none/);
    });

    it('scopes the chip styles to the ≤1023px mobile breakpoint', () => {
        // The block must live inside the existing @media (max-width: 1023px)
        // section — desktop never surfaces the chip row, so its styling
        // would be dead weight at the top level.
        const mediaIdx = css.indexOf('@media (max-width: 1023px)');
        const chipsIdx = css.indexOf('#mobileCreateChips');
        expect(mediaIdx).toBeGreaterThan(-1);
        expect(chipsIdx).toBeGreaterThan(mediaIdx);
    });

    it('hides the chip cluster at the ≥1024px desktop breakpoint', () => {
        // The chip DOM is attached unconditionally to every blank placeholder
        // so the JS path stays single-branch, but on desktop the cluster
        // (Today / Tomorrow / 📅 / + ¶) must never paint — desktop
        // placeholder rows must look identical to committed rows.
        const desktopBlocks = Array.from(
            css.matchAll(/@media\s*\(min-width:\s*1024px\)\s*\{[\s\S]*?\n\}/g)
        );
        expect(desktopBlocks.length).toBeGreaterThan(0);
        const hidesChips = desktopBlocks.some(function(m) {
            return /#mobileCreateChips\s*\{[^}]*display:\s*none/.test(m[0]);
        });
        expect(hidesChips).toBe(true);
    });
});


// ── Helpers ──────────────────────────────────────────────────────────

function makeBlankRow() {
    return makeRowForItem({ tit: '', due: '' });
}

function makeRowForItem(item) {
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = item;

    const input = document.createElement('input');
    input.id = 'toDoInput';
    input.value = item.tit || '';
    row.appendChild(input);

    // Hidden duePill so showDueDatePopover has an anchor target if the
    // calendar chip is exercised (the popover code itself isn't called
    // in these tests — they only verify chip wiring + state).
    const duePill = document.createElement('button');
    duePill.id = 'duePill';
    row.appendChild(duePill);

    // descToggle stub so the + ¶ chip can flip its `open` class without
    // pulling in the full wireDescToggle machinery.
    const descToggle = document.createElement('div');
    descToggle.id = 'descToggle';
    descToggle.addEventListener('click', function() {
        descToggle.classList.toggle('open');
    });
    row.appendChild(descToggle);

    document.body.appendChild(row);
    return row;
}
