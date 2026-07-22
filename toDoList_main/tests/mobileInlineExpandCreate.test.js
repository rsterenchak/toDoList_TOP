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
    parsePastedEntry,
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
        chipsFor(row).querySelector('[data-chip="tomorrow"]').click();
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

    it('mounts the chip row as a sibling only for a blank placeholder', () => {
        const blankRow = makeBlankRow();
        attachMobileCreateChips(blankRow, blankRow.__item);
        expect(chipsFor(blankRow)).not.toBeNull();
        // The chip row is a sibling, never a descendant of the row.
        expect(blankRow.querySelector('#mobileCreateChips')).toBeNull();

        const committedRow = makeRowForItem({ tit: 'walk dog', due: '' });
        attachMobileCreateChips(committedRow, committedRow.__item);
        expect(chipsFor(committedRow)).toBeNull();
    });

    it('marks the placeholder row with data-blank-placeholder for CSS targeting', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        expect(row.getAttribute('data-blank-placeholder')).toBe('true');
    });

    it('renders four chips — Today, Tomorrow, 📅 calendar, and + ¶ description toggle', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        const chips = chipsFor(row);
        expect(chips).not.toBeNull();
        expect(chips.querySelector('[data-chip="today"]').textContent).toBe('Today');
        expect(chips.querySelector('[data-chip="tomorrow"]').textContent).toBe('Tomorrow');
        expect(chips.querySelector('[data-chip="custom"]').textContent).toBe('📅');
        expect(chips.querySelector('#mobileCreateDescChip')).not.toBeNull();
    });

    it('highlights the currently-chosen chip via mobileCreateChipSelected', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        const chips = chipsFor(row);
        const today = chips.querySelector('[data-chip="today"]');
        expect(today.classList.contains('mobileCreateChipSelected')).toBe(true);

        chips.querySelector('[data-chip="tomorrow"]').click();
        const tomorrow = chips.querySelector('[data-chip="tomorrow"]');
        expect(tomorrow.classList.contains('mobileCreateChipSelected')).toBe(true);
        expect(today.classList.contains('mobileCreateChipSelected')).toBe(false);
    });

    it('Today chip updates session state to "today" and clears any stale custom due', () => {
        const row = makeBlankRow();
        const item = row.__item;
        item.due = '6-15-2026';
        attachMobileCreateChips(row, item);

        chipsFor(row).querySelector('[data-chip="today"]').click();
        expect(getChosenDueChip()).toBe('today');
        // Stale custom-picked due must be cleared so the on-commit stamp
        // applies the chip's date instead of falling back through.
        expect(item.due).toBe('');
    });

    it('Tomorrow chip updates session state to "tomorrow"', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);

        chipsFor(row).querySelector('[data-chip="tomorrow"]').click();
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
        chipsFor(row).querySelector('[data-chip="tomorrow"]').click();

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

    it('hides the chip row by default and reveals it via the adjacent-sibling combinator when the placeholder row is focus-within', () => {
        expect(css).toMatch(/#mobileCreateChips\s*\{[^}]*display:\s*none/);
        // The chip row is the placeholder's sibling now, so the reveal uses
        // the adjacent-sibling (`+`) combinator rather than a descendant match.
        expect(css).toMatch(/#toDoChild\[data-blank-placeholder\]:focus-within\s*\+\s*#mobileCreateChips\s*\{[\s\S]*?display:\s*flex/);
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

    it('styles the paste chip on the shared chip surface — no new colour tokens', () => {
        // The paste chip reuses .mobileCreateChip; its own rule only adjusts
        // spacing/glyph size and must not introduce a hardcoded colour.
        const match = css.match(/\.mobileCreatePasteChip\s*\{[^}]*\}/);
        expect(match).not.toBeNull();
        expect(match[0]).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
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


// Pins the "paste a TODO.md entry straight into a new task" affordance:
// a 📋 chip on the mobile create row reads the clipboard, parses a pasted
// entry into a display title + verbatim description, and commits the task
// through the same Enter path a typed title uses.

describe('Compose row paste-entry — parsePastedEntry', () => {

    it('takes the title from the checkbox headline, stripping the priority marker', () => {
        const raw = '- [ ] **[MEDIUM]** Add a paste affordance\n  - Type: feature';
        const parsed = parsePastedEntry(raw);
        expect(parsed.title).toBe('Add a paste affordance');
    });

    it('keeps the full entry (headline included) as the description', () => {
        const raw = '- [ ] **[HIGH]** Do the thing\n  - Type: bug\n  - File: a.js';
        const parsed = parsePastedEntry(raw);
        // The description must keep the headline line — that is what Inject commits.
        expect(parsed.description).toBe(raw);
    });

    it('strips a wrapping code fence but preserves the body byte-for-byte', () => {
        const raw = '```markdown\n- [ ] **[LOW]** Fenced task\n  - Type: feature\n```';
        const parsed = parsePastedEntry(raw);
        expect(parsed.title).toBe('Fenced task');
        expect(parsed.description).toBe('- [ ] **[LOW]** Fenced task\n  - Type: feature');
        expect(parsed.description).not.toMatch(/```/);
    });

    it('drops a trailing "— Completed: …" note from the title', () => {
        const raw = '- [x] **[MEDIUM]** Shipped task — Completed: 2026-07-22 (PR #999)';
        const parsed = parsePastedEntry(raw);
        expect(parsed.title).toBe('Shipped task');
    });

    it('falls back to the first non-empty line when there is no checkbox headline', () => {
        const raw = '\n\nRough idea with no checkbox\nsecond line\n';
        const parsed = parsePastedEntry(raw);
        expect(parsed.title).toBe('Rough idea with no checkbox');
        expect(parsed.description).toBe(raw);
    });

    it('flags an entry that already carries an <!-- id: … --> marker', () => {
        const withMarker = '- [ ] **[MEDIUM]** Existing entry\n  <!-- id: abc-123 -->';
        const without = '- [ ] **[MEDIUM]** Fresh entry';
        expect(parsePastedEntry(withMarker).hasMarker).toBe(true);
        expect(parsePastedEntry(without).hasMarker).toBe(false);
    });

    it('returns empty fields for empty input rather than throwing', () => {
        const parsed = parsePastedEntry('');
        expect(parsed.title).toBe('');
        expect(parsed.description).toBe('');
        expect(parsed.hasMarker).toBe(false);
    });
});


describe('Compose row paste-entry — chip DOM', () => {

    beforeEach(() => {
        resetMobileCreateSession();
        document.body.innerHTML = '';
    });

    it('renders the 📋 paste chip in the create chip row', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        const chip = chipsFor(row).querySelector('#mobileCreatePasteChip');
        expect(chip).not.toBeNull();
        expect(chip.textContent).toBe('📋');
        expect(chip.getAttribute('aria-label')).toBe('Paste entry as a new task');
    });
});


describe('Compose row paste-entry — commit flow', () => {

    let originalClipboard;

    beforeEach(() => {
        resetMobileCreateSession();
        document.body.innerHTML = '';
        originalClipboard = navigator.clipboard;
    });

    function setClipboard(readText) {
        Object.defineProperty(navigator, 'clipboard', {
            value: { readText: readText },
            configurable: true,
        });
    }

    function restoreClipboard() {
        Object.defineProperty(navigator, 'clipboard', {
            value: originalClipboard,
            configurable: true,
        });
    }

    const flush = () => new Promise((r) => setTimeout(r, 0));

    it('sets item.desc to the parsed entry and dispatches Enter on the title input', async () => {
        setClipboard(() => Promise.resolve('- [ ] **[MEDIUM]** Pasted headline\n  - Type: feature'));
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);

        let enterFired = false;
        row.querySelector('#toDoInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enterFired = true;
        });

        chipsFor(row).querySelector('#mobileCreatePasteChip').click();
        await flush();

        expect(item.desc).toBe('- [ ] **[MEDIUM]** Pasted headline\n  - Type: feature');
        expect(row.querySelector('#toDoInput').value).toBe('Pasted headline');
        expect(enterFired).toBe(true);
        restoreClipboard();
    });

    it('creates nothing and toasts on an empty clipboard', async () => {
        setClipboard(() => Promise.resolve('   '));
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);

        let enterFired = false;
        row.querySelector('#toDoInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enterFired = true;
        });

        chipsFor(row).querySelector('#mobileCreatePasteChip').click();
        await flush();

        expect(enterFired).toBe(false);
        expect(item.desc).toBeUndefined();
        expect(document.getElementById('injectToast')).not.toBeNull();
        restoreClipboard();
    });

    it('focuses the title input and toasts when the clipboard read is denied', async () => {
        setClipboard(() => Promise.reject(new Error('denied')));
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);

        let enterFired = false;
        const input = row.querySelector('#toDoInput');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enterFired = true;
        });

        chipsFor(row).querySelector('#mobileCreatePasteChip').click();
        await flush();

        expect(enterFired).toBe(false);
        expect(document.getElementById('injectToast')).not.toBeNull();
        expect(document.activeElement).toBe(input);
        restoreClipboard();
    });
});


// ── Helpers ──────────────────────────────────────────────────────────

// The chip row now mounts as the placeholder's NEXT SIBLING (its own grid
// row), not a child, so reach it via the row's sibling rather than a
// descendant query.
function chipsFor(row) {
    const sib = row.nextElementSibling;
    return sib && sib.id === 'mobileCreateChips' ? sib : null;
}

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
