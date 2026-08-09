import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, it, expect } from 'vitest';

import {
    attachMobileCreateChips,
    createPasteChipTrigger,
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
        expect(blankRow.querySelector('#createChipRow')).toBeNull();

        const committedRow = makeRowForItem({ tit: 'walk dog', due: '' });
        attachMobileCreateChips(committedRow, committedRow.__item);
        expect(chipsFor(committedRow)).toBeNull();
    });

    it('marks the placeholder row with data-blank-placeholder for CSS targeting', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        expect(row.getAttribute('data-blank-placeholder')).toBe('true');
    });

    it('renders four chips — Today, Tomorrow, calendar icon, and + ¶ description toggle', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        const chips = chipsFor(row);
        expect(chips).not.toBeNull();
        expect(chips.querySelector('[data-chip="today"]').textContent).toBe('Today');
        expect(chips.querySelector('[data-chip="tomorrow"]').textContent).toBe('Tomorrow');
        // The calendar chip now carries a themed currentColor SVG icon rather
        // than a raw 📅 emoji glyph, so it recolors with the theme.
        const calChip = chips.querySelector('[data-chip="custom"]');
        expect(calChip.classList.contains('calChip')).toBe(true);
        expect(calChip.querySelector('svg')).not.toBeNull();
        expect(calChip.textContent).not.toContain('📅');
        expect(calChip.getAttribute('aria-label')).toBe('Pick a date');
        expect(chips.querySelector('#createDescChip')).not.toBeNull();
        // The 📋 paste trigger no longer lives in the strip — it moved to the
        // input row (built by buildToDoRow, left of the mic).
        expect(chips.querySelector('#createPasteChip')).toBeNull();
    });

    it('highlights the currently-chosen chip via createChipSelected', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        const chips = chipsFor(row);
        const today = chips.querySelector('[data-chip="today"]');
        expect(today.classList.contains('createChipSelected')).toBe(true);

        chips.querySelector('[data-chip="tomorrow"]').click();
        const tomorrow = chips.querySelector('[data-chip="tomorrow"]');
        expect(tomorrow.classList.contains('createChipSelected')).toBe(true);
        expect(today.classList.contains('createChipSelected')).toBe(false);
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

    it('builds the 📋 paste trigger for the blank placeholder only, guarded like the mic', () => {
        // The trigger belongs to the always-pinned blank placeholder, so it is
        // built only when the row has no title (mirrors the micBtn guard).
        expect(toDoRow).toMatch(/const\s+pasteChip\s*=\s*!item\.tit\s*\?\s*createPasteChipTrigger\(toDoChild,\s*item\)/);
    });

    it('mounts the paste trigger in the input row, immediately left of the mic', () => {
        // Appending the paste chip before the mic renders it to the mic's left,
        // both on the row's trailing side. The append must precede the mic's.
        const pasteAppendIdx = toDoRow.indexOf('toDoChild.appendChild(pasteChip)');
        const micAppendIdx = toDoRow.indexOf('toDoChild.appendChild(micBtn)');
        expect(pasteAppendIdx).toBeGreaterThan(-1);
        expect(micAppendIdx).toBeGreaterThan(-1);
        expect(pasteAppendIdx).toBeLessThan(micAppendIdx);
    });

    it('strips the paste trigger on commit alongside the mic', () => {
        // A committed row is a real todo — it must shed both blank-only controls.
        expect(toDoRow).toMatch(/pasteChip\s*&&\s*pasteChip\.parentElement\s*\)\s*pasteChip\.remove\(\)/);
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
        expect(toDoRow).toMatch(/createChipRow[\s\S]*?\.remove\(\)/);
    });

    it('strips the chip row at every width, not only the mobile breakpoint', () => {
        // The 📋 paste chip commits on desktop too, so the chip-row + marker
        // cleanup must sit OUTSIDE (before) the mobile-only accent/chaining
        // block — otherwise a committed desktop row keeps its visible chip
        // sibling and its blank-placeholder marker.
        const removeAttrIdx = toDoRow.indexOf("removeAttribute('data-blank-placeholder')");
        const mobileAccentIdx = toDoRow.indexOf('justCommittedMobile');
        expect(removeAttrIdx).toBeGreaterThan(-1);
        expect(mobileAccentIdx).toBeGreaterThan(-1);
        // Cleanup precedes the mobile accent block…
        expect(removeAttrIdx).toBeLessThan(mobileAccentIdx);
        // …and the width guard that wraps that block comes AFTER the cleanup,
        // so the cleanup is not itself gated behind `window.innerWidth < 1024`.
        const guardIdx = toDoRow.lastIndexOf('window.innerWidth < 1024', mobileAccentIdx);
        expect(guardIdx).toBeGreaterThan(removeAttrIdx);
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
        expect(css).toMatch(/#createChipRow\s*\{[^}]*display:\s*none/);
        // The chip row is the placeholder's sibling now, so the reveal uses
        // the adjacent-sibling (`+`) combinator rather than a descendant match.
        expect(css).toMatch(/#toDoChild\[data-blank-placeholder\]:focus-within\s*\+\s*#createChipRow\s*\{[\s\S]*?display:\s*flex/);
    });

    it('gives the chips a ≥44px touch target', () => {
        expect(css).toMatch(/\.createChip\s*\{[\s\S]*?min-height:\s*44px/);
    });

    it('paints a selected chip with the accent fill', () => {
        expect(css).toMatch(/\.createChip\.createChipSelected\s*\{[\s\S]*?background:\s*var\(--accent\)/);
    });

    it('defines a 0.7s fading accent keyframe and gates the animation behind .justCommittedMobile', () => {
        expect(css).toMatch(/@keyframes\s+justCommittedMobileFlash/);
        expect(css).toMatch(/#toDoChild\.justCommittedMobile\s*\{[\s\S]*?animation:\s*justCommittedMobileFlash\s+0\.7s/);
    });

    it('respects prefers-reduced-motion by disabling the just-committed flash', () => {
        expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\.justCommittedMobile[\s\S]*?animation:\s*none/);
    });

    it('keeps the full chip cluster styling inside the ≤1023px mobile breakpoint', () => {
        // The cluster's appearance (Today / Tomorrow / 📅 / + ¶ plus the
        // wrap + tuck layout) lives inside the existing @media (max-width:
        // 1023px) section. Desktop only restates the small surface the 📋
        // paste chip needs, so the first #createChipRow rule is the
        // mobile one.
        const mediaIdx = css.indexOf('@media (max-width: 1023px)');
        const chipsIdx = css.indexOf('#createChipRow');
        expect(mediaIdx).toBeGreaterThan(-1);
        expect(chipsIdx).toBeGreaterThan(mediaIdx);
    });

    it('sizes the input-row paste trigger to the mic without new colour tokens', () => {
        // The trigger reuses .micButton for its box; its own .addTaskPasteChip
        // base rule only sizes the glyph and spacing, and must not introduce a
        // hardcoded colour.
        const match = css.match(/\.addTaskPasteChip\s*\{[^}]*\}/);
        expect(match).not.toBeNull();
        expect(match[0]).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    });

    it('keeps the chip strip hidden at the ≥1024px desktop breakpoint — the paste trigger left it', () => {
        // The date/description chips are mobile-only, and the 📋 paste trigger
        // now lives in the input row (.addTaskPasteChip, a top-level rule) rather
        // than this strip. So at desktop widths the strip is simply hidden and is
        // never revealed on focus-within.
        const desktopBlocks = Array.from(
            css.matchAll(/@media\s*\(min-width:\s*1024px\)\s*\{[\s\S]*?\n\}/g)
        );
        expect(desktopBlocks.length).toBeGreaterThan(0);
        const chipBlock = desktopBlocks.find(function(m) {
            return /#createChipRow\s*\{[^}]*display:\s*none/.test(m[0]);
        });
        expect(chipBlock).toBeTruthy();
        // Desktop no longer reveals the strip — the paste trigger moved out.
        expect(chipBlock[0]).not.toMatch(/:focus-within\s*\+\s*#createChipRow\s*\{[\s\S]*?display:\s*flex/);
        // The input-row trigger is styled outside the media blocks so it paints
        // at desktop and mobile alike.
        expect(css).toMatch(/\.addTaskPasteChip\s*\{/);
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

    it('builds the 📋 paste trigger for the input row, sized to the mic and absent from the strip', () => {
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);
        // The trigger no longer sits in the date-chip strip…
        expect(chipsFor(row).querySelector('#createPasteChip')).toBeNull();

        // …it is built for the input row by createPasteChipTrigger.
        const chip = createPasteChipTrigger(row, row.__item);
        row.appendChild(chip);
        // The glyph is a monochrome inline SVG (not the old 📋 emoji) so it
        // inherits the button's currentColor and matches the mic's icon set.
        const glyph = chip.querySelector('svg');
        expect(glyph).not.toBeNull();
        expect(chip.textContent).toBe('');
        // No hardcoded colour on the SVG — it must inherit currentColor, so the
        // stroke is "currentColor" and there is no own fill colour.
        expect(glyph.getAttribute('stroke')).toBe('currentColor');
        expect(glyph.getAttribute('fill')).toBe('none');
        expect(chip.getAttribute('aria-label')).toBe('Paste entry as a new task');
        // Reuses .micButton so it matches the mic's 36×36 box exactly.
        expect(chip.classList.contains('micButton')).toBe(true);
        expect(chip.classList.contains('addTaskPasteChip')).toBe(true);
        expect(row.querySelector('#createPasteChip')).toBe(chip);
    });
});


// The paste chip now opens an inline panel where the entry is shown and edited
// before it lands, rather than committing straight from the clipboard. These
// tests supersede the earlier "commit flow" block that pinned the direct
// clipboard-to-task behavior, which this entry deliberately replaces.
describe('Compose row paste-entry — inline panel', () => {

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

    function panelFor(row) {
        let n = row.nextElementSibling;
        while (n && n.id === 'createChipRow') n = n.nextElementSibling;
        return n && n.id === 'pasteEntryPanel' ? n : null;
    }

    // The paste trigger now lives in the input row (built by buildToDoRow via
    // createPasteChipTrigger), not the date-chip strip. Mount it lazily against
    // the row's item so the existing setup — makeBlankRow + attachMobileCreateChips
    // for the strip — still exercises the same toggle wiring.
    function pasteChipFor(row) {
        let chip = row.querySelector('#createPasteChip');
        if (!chip) {
            chip = createPasteChipTrigger(row, row.__item);
            row.appendChild(chip);
        }
        return chip;
    }

    function tapPasteChip(row) {
        pasteChipFor(row).click();
    }

    it('opens the inline panel and presses the chip on tap', async () => {
        setClipboard(() => Promise.resolve(''));
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);

        tapPasteChip(row);
        await flush();

        const panel = panelFor(row);
        expect(panel).not.toBeNull();
        // The panel is a sibling of the row, mounted right after the chip row —
        // never a descendant (the row is overflow: clip at a fixed height).
        expect(chipsFor(row).nextElementSibling).toBe(panel);
        expect(row.querySelector('#pasteEntryPanel')).toBeNull();
        expect(panel.querySelector('.pasteEntryInput')).not.toBeNull();
        expect(panel.querySelector('.pasteEntryAdd')).not.toBeNull();
        expect(panel.querySelector('.pasteEntryCancel')).not.toBeNull();
        expect(pasteChipFor(row)
            .classList.contains('createChipSelected')).toBe(true);
        expect(row.getAttribute('data-paste-open')).toBe('true');
        restoreClipboard();
    });

    it('tapping the chip again closes the panel (toggle)', async () => {
        setClipboard(() => Promise.resolve(''));
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);

        tapPasteChip(row);
        await flush();
        expect(panelFor(row)).not.toBeNull();

        tapPasteChip(row);
        expect(panelFor(row)).toBeNull();
        expect(row.getAttribute('data-paste-open')).toBeNull();
        expect(pasteChipFor(row)
            .classList.contains('createChipSelected')).toBe(false);
        restoreClipboard();
    });

    it('reopening after a close leaves exactly one panel', async () => {
        setClipboard(() => Promise.resolve(''));
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);

        tapPasteChip(row); await flush();   // open
        tapPasteChip(row);                   // close
        tapPasteChip(row); await flush();    // open again

        expect(document.querySelectorAll('#pasteEntryPanel').length).toBe(1);
        restoreClipboard();
    });

    it('pre-fills the textarea from a successful clipboard read', async () => {
        const entry = '- [ ] **[MEDIUM]** Pasted headline\n  - Type: feature';
        setClipboard(() => Promise.resolve(entry));
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);

        tapPasteChip(row);
        await flush();

        expect(panelFor(row).querySelector('.pasteEntryInput').value).toBe(entry);
        restoreClipboard();
    });

    it('opens an empty, focused textarea when the clipboard read is denied — no toast', async () => {
        // A denied or unavailable clipboard is a normal path here (iOS Safari
        // blocks it frequently), not a fallback: no toast, no error, just an
        // empty focused textarea to paste into.
        setClipboard(() => Promise.reject(new Error('denied')));
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);

        tapPasteChip(row);
        await flush();

        const ta = panelFor(row).querySelector('.pasteEntryInput');
        expect(ta.value).toBe('');
        expect(document.activeElement).toBe(ta);
        expect(document.getElementById('injectToast')).toBeNull();
        restoreClipboard();
    });

    it('PARSE & ADD parses the textarea, sets item.desc, dispatches Enter, and closes', async () => {
        setClipboard(() => Promise.reject(new Error('denied')));
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);

        let enterFired = false;
        row.querySelector('#toDoInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enterFired = true;
        });

        tapPasteChip(row);
        await flush();

        const entry = '- [ ] **[HIGH]** Typed entry\n  - Type: feature';
        panelFor(row).querySelector('.pasteEntryInput').value = entry;
        panelFor(row).querySelector('.pasteEntryAdd').click();

        expect(item.desc).toBe(entry);
        expect(row.querySelector('#toDoInput').value).toBe('Typed entry');
        expect(enterFired).toBe(true);
        expect(panelFor(row)).toBeNull();
        restoreClipboard();
    });

    it('PARSE & ADD lands the entry in_progress, not the factory default', async () => {
        setClipboard(() => Promise.reject(new Error('denied')));
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);

        tapPasteChip(row);
        await flush();

        panelFor(row).querySelector('.pasteEntryInput').value =
            '- [ ] **[HIGH]** Typed entry\n  - Type: feature';
        panelFor(row).querySelector('.pasteEntryAdd').click();

        // Set before the Enter dispatch so the commit handler builds the
        // in-progress badge and persists that status. Matches
        // commitEntryToActiveProject — both paste-commit surfaces agree.
        expect(item.status).toBe('in_progress');
        restoreClipboard();
    });

    it('PARSE & ADD with empty text is inert and leaves the panel open', async () => {
        setClipboard(() => Promise.reject(new Error('denied')));
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);

        let enterFired = false;
        row.querySelector('#toDoInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enterFired = true;
        });

        tapPasteChip(row);
        await flush();

        panelFor(row).querySelector('.pasteEntryInput').value = '   ';
        panelFor(row).querySelector('.pasteEntryAdd').click();

        expect(enterFired).toBe(false);
        expect(item.desc).toBeUndefined();
        // Nothing committed, so the in_progress stamp must not land either.
        expect(item.status).toBeUndefined();
        expect(panelFor(row)).not.toBeNull();
        restoreClipboard();
    });

    it('CANCEL closes the panel and creates nothing', async () => {
        setClipboard(() => Promise.reject(new Error('denied')));
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);

        let enterFired = false;
        row.querySelector('#toDoInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enterFired = true;
        });

        tapPasteChip(row);
        await flush();

        panelFor(row).querySelector('.pasteEntryInput').value = 'discard me';
        panelFor(row).querySelector('.pasteEntryCancel').click();

        expect(panelFor(row)).toBeNull();
        expect(enterFired).toBe(false);
        expect(item.desc).toBeUndefined();
        expect(row.getAttribute('data-paste-open')).toBeNull();
        restoreClipboard();
    });

    it('commits at a desktop viewport width too', async () => {
        const originalWidth = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
        setClipboard(() => Promise.reject(new Error('denied')));
        const row = makeBlankRow();
        const item = row.__item;
        attachMobileCreateChips(row, item);

        let enterFired = false;
        row.querySelector('#toDoInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') enterFired = true;
        });

        tapPasteChip(row);
        await flush();
        panelFor(row).querySelector('.pasteEntryInput').value =
            '- [ ] **[HIGH]** Desktop paste\n  - Type: feature';
        panelFor(row).querySelector('.pasteEntryAdd').click();

        expect(item.desc).toBe('- [ ] **[HIGH]** Desktop paste\n  - Type: feature');
        expect(enterFired).toBe(true);
        Object.defineProperty(window, 'innerWidth', { value: originalWidth, configurable: true });
        restoreClipboard();
    });

    it('still surfaces the marker toast when the pasted entry carries an id', async () => {
        setClipboard(() => Promise.reject(new Error('denied')));
        const row = makeBlankRow();
        attachMobileCreateChips(row, row.__item);

        tapPasteChip(row);
        await flush();
        panelFor(row).querySelector('.pasteEntryInput').value =
            '- [ ] **[MEDIUM]** Existing entry\n  <!-- id: abc-123 -->';
        panelFor(row).querySelector('.pasteEntryAdd').click();

        expect(document.getElementById('injectToast')).not.toBeNull();
        restoreClipboard();
    });
});


describe('Compose row paste-entry — sibling-order + CSS', () => {

    const toDoRow = read('toDoRow.js');
    const css = read('style.css');

    it('teaches every blank-placeholder sibling walk about the paste-entry panel', () => {
        // The description-panel insert/remove anchors, openDescSiblingFor, the
        // reorder-rebuild collector, and the commit cleanup all walk past
        // #createChipRow; each must ALSO account for #pasteEntryPanel, or an
        // open description panel lands in the wrong slot when the paste panel is
        // open (and a commit-via-typed-title orphans the panel). This is a
        // source-structural guard — it does not compute layout.
        const chipWalks = (toDoRow.match(/id === 'createChipRow'/g) || []).length;
        const pasteWalks = (toDoRow.match(/id === 'pasteEntryPanel'/g) || []).length;
        expect(chipWalks).toBeGreaterThan(0);
        expect(pasteWalks).toBeGreaterThanOrEqual(chipWalks);
    });

    it('mounts the panel styling outside the media blocks so it paints at every width', () => {
        // #pasteEntryPanel's base rule sits ahead of every responsive @media
        // block in the file, so it is a top-level rule — the paste chip surfaces
        // on desktop and mobile alike, so its panel must too.
        const panelIdx = css.indexOf('#pasteEntryPanel {');
        const firstMobileMedia = css.indexOf('@media (max-width: 1023px)');
        const firstDesktopMedia = css.indexOf('@media (min-width: 1024px)');
        expect(panelIdx).toBeGreaterThan(-1);
        expect(panelIdx).toBeLessThan(firstMobileMedia);
        expect(panelIdx).toBeLessThan(firstDesktopMedia);
    });

    it('gives the paste textarea a ≥16px font to avoid iOS focus auto-zoom', () => {
        const body = css.match(/\.pasteEntryInput\s*\{[^}]*\}/);
        expect(body).not.toBeNull();
        expect(body[0]).toMatch(/font-size:\s*16px/);
    });

    it('keeps the chip row (and pressed chip) visible while the panel is open via data-paste-open', () => {
        expect(css).toMatch(/data-blank-placeholder\]\[data-paste-open\]\s*\+\s*#createChipRow/);
    });
});


// ── Helpers ──────────────────────────────────────────────────────────

// The chip row now mounts as the placeholder's NEXT SIBLING (its own grid
// row), not a child, so reach it via the row's sibling rather than a
// descendant query.
function chipsFor(row) {
    const sib = row.nextElementSibling;
    return sib && sib.id === 'createChipRow' ? sib : null;
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
