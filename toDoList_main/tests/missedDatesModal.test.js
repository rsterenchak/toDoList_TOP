import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the missed-dates modal — opened by the `+ N more`
// chip in the recurring-task stats drawer when a row accumulates more
// missed dates than the inline pill list comfortably surfaces. The
// modal lives next to showChangelogModal / showHelpModal in modals.js
// and inherits their close vocabulary (X / backdrop / Escape).
describe('missed dates modal', () => {
    const modals = read('modals.js');
    const toDoRow = read('toDoRow.js');

    it('exports showMissedDatesModal from modals.js', () => {
        expect(modals).toMatch(/export\s+function\s+showMissedDatesModal\s*\(/);
    });

    it('renders the modal with role=dialog, aria-modal, aria-labelledby, and a close X', () => {
        // The aria-labelledby points at the modal title so screen readers
        // announce "Missed: <task title>" on focus.
        const fnIdx = modals.indexOf('function showMissedDatesModal');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = modals.slice(fnIdx, fnIdx + 8000);
        expect(body).toMatch(/dialog\.setAttribute\(\s*['"]role['"]\s*,\s*['"]dialog['"]\s*\)/);
        expect(body).toMatch(/dialog\.setAttribute\(\s*['"]aria-modal['"]\s*,\s*['"]true['"]\s*\)/);
        expect(body).toMatch(/dialog\.setAttribute\(\s*['"]aria-labelledby['"]\s*,\s*['"]missedDatesModalTitle['"]\s*\)/);
        expect(body).toMatch(/closeX\.id\s*=\s*['"]missedDatesModalClose['"]/);
        expect(body).toMatch(/closeX\.textContent\s*=\s*['"]×['"]/);
        expect(body).toMatch(/['"]Missed:\s*['"]\s*\+/);
    });

    it('groups misses by month with a heading per group and reuses the pill class', () => {
        const fnIdx = modals.indexOf('function showMissedDatesModal');
        const body = modals.slice(fnIdx, fnIdx + 8000);
        // Bucket by year-month key (newest-first iteration order is
        // preserved by the upstream sort).
        expect(body).toMatch(/getFullYear\(\)\s*\+\s*['"]-['"]\s*\+\s*d\.getMonth\(\)/);
        // Month heading + per-month pill row both render.
        expect(body).toMatch(/missedDatesMonthGroup/);
        expect(body).toMatch(/missedDatesMonthHeading/);
        // The renderer reuses the existing pill class for the date chips
        // inside each month group — keeps the modal visually consistent
        // with the drawer's inline pill list.
        expect(body).toMatch(/['"]statsMissedPill['"]/);
    });

    it('renders a single-line overview above the month groups', () => {
        const fnIdx = modals.indexOf('function showMissedDatesModal');
        const body = modals.slice(fnIdx, fnIdx + 8000);
        expect(body).toMatch(/missedDatesOverview/);
        expect(body).toMatch(/missed dates across/);
        expect(body).toMatch(/missed dates in /);
    });

    it('closes on the corner X, the footer Close button, the backdrop, and Escape', () => {
        const fnIdx = modals.indexOf('function showMissedDatesModal');
        const after = modals.slice(fnIdx);
        const nextFn = after.indexOf('\nexport function ', 1);
        const body = nextFn === -1 ? after : after.slice(0, nextFn);
        // Close is centralized in the shared wireModalDismiss helper; the modal
        // hands it both close controls and its backdrop, and the helper wires
        // the close-button clicks, the backdrop-target guard, and Escape once.
        const call = body.match(/wireModalDismiss\(\{[\s\S]*?\}\)/);
        expect(call).not.toBeNull();
        expect(call[0]).toMatch(/closeButtons:\s*\[\s*closeX\s*,\s*closeBtn\s*\]/);
        expect(call[0]).toMatch(/backdrop:\s*backdrop/);
        expect(modals).toMatch(/closeButtons\[i\]\.addEventListener\(\s*['"]click['"]\s*,\s*close\s*\)/);
        expect(modals).toMatch(/event\.target\s*===\s*backdrop/);
        expect(modals).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
    });

    it('removes any prior missed-dates modal backdrop before mounting a new one', () => {
        expect(modals).toMatch(/getElementById\(\s*['"]missedDatesModalBackdrop['"]\s*\)/);
    });

    it('restores focus to the previously-focused element on close', () => {
        // The `+ N more` chip in the drawer is the typical opener — focus
        // restoration sends keyboard users back to the chip so a follow-up
        // Enter / Space doesn't fall through to the wrong element.
        const fnIdx = modals.indexOf('function showMissedDatesModal');
        const body = modals.slice(fnIdx, fnIdx + 8000);
        expect(body).toMatch(/previouslyFocused\s*=\s*document\.activeElement/);
        expect(body).toMatch(/previouslyFocused\.focus\(\s*\)/);
    });

    it('toDoRow wires the `+ N more` chip to the modal beyond the pill threshold', () => {
        // Threshold constant is one-line tunable.
        expect(toDoRow).toMatch(/MISS_PILL_THRESHOLD\s*=\s*7/);
        // The chip opens the modal with the task title and the miss list.
        expect(toDoRow).toMatch(/showMissedDatesModal\(\s*item\.tit/);
        // Inline list label switches to "Most recent misses:" beyond the
        // threshold so the abbreviated 5-pill preview reads correctly.
        expect(toDoRow).toMatch(/Most recent misses:/);
        // The chip label is a `+ N more` button with an accessible
        // aria-label.
        expect(toDoRow).toMatch(/statsMissedMoreBtn/);
    });

    it('toDoRow renders the pattern callout below the contributions grid', () => {
        // The callout uses summarizeRecurringMissPattern from listLogic so
        // the rendering logic stays a thin wrapper around the pure helper.
        expect(toDoRow).toMatch(/summarizeRecurringMissPattern/);
        expect(toDoRow).toMatch(/statsMissCallout/);
        // The info-glyph SVG prefix is built inline; no new icon assets.
        expect(toDoRow).toMatch(/buildInfoGlyph/);
    });
});
