import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Source-inspection tests for the per-project "running" spinners in the two
// project-switcher surfaces — the desktop dropdown (projectPicker.js) and the
// mobile sidebar drawer (#projChild rows, built in main.js). Both reuse the
// `fetchActiveRuns` probe and the shared `spin` keyframes from the
// active-project entry, poll all routed repos ONLY while their switcher is
// open, and dedupe the probe by repo. Strategy matches crossDeviceRunStatus and
// projectPickerDropdown: main.js / projectPicker.js are too large / closure-
// bound to instantiate in jsdom (per CLAUDE.md), so the invariants are pinned
// by source regex.

describe('project-switcher run spinners — desktop dropdown (projectPicker.js)', () => {
    const picker = read('projectPicker.js');

    it('imports the routed-repo helpers + fetchActiveRuns from inject.js', () => {
        expect(picker).toMatch(
            /import\s*\{[\s\S]*?\bisInjectConfigured\b[\s\S]*?\bfindTargetById\b[\s\S]*?\bfetchActiveRuns\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('mounts a decorative spinner left of the count badge on each built row', () => {
        // The spinner element is created with the run-spinner class and aria-hidden…
        expect(picker).toMatch(/spinner\.className\s*=\s*['"]projectPickerRunSpinner['"]/);
        expect(picker).toMatch(/spinner\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
        // …and appended between the name and the count (placement A).
        expect(picker).toMatch(
            /row\.appendChild\(label\);[\s\S]{0,80}row\.appendChild\(spinner\);[\s\S]{0,80}row\.appendChild\(countEl\)/
        );
        // The project name is stamped on the row so the poll can resolve its repo.
        expect(picker).toMatch(/row\.dataset\.project\s*=\s*name/);
    });

    it('gates a row on the same routed-repo rule as the bolt (configured AND target id → repo)', () => {
        const start = picker.indexOf('function resolveRowTarget');
        expect(start).toBeGreaterThan(-1);
        const block = picker.slice(start, start + 400);
        expect(block).toMatch(/!isInjectConfigured\(\)/);
        expect(block).toMatch(/listLogic\.getProjectTargetId\(\s*name\s*\)/);
        expect(block).toMatch(/findTargetById\(\s*targetId\s*\)/);
        expect(block).toMatch(/target\.repo/);
    });

    it('dedupes the probe by repo and toggles --active only on active===true', () => {
        const start = picker.indexOf('function refreshPickerRunSpinners');
        expect(start).toBeGreaterThan(-1);
        const block = picker.slice(start, start + 2000);
        // One bucket per distinct repo.
        expect(block).toMatch(/rowsByRepo\s*=\s*new Map\(\)/);
        expect(block).toMatch(/rowsByRepo\.get\(\s*target\.repo\s*\)/);
        // One probe per bucket.
        expect(block).toMatch(/fetchActiveRuns\(\s*\{\s*repo:\s*bucket\.target\.repo/);
        // Stale responses dropped by token.
        expect(block).toMatch(/token\s*!==\s*pickerSpinnerReqToken\s*\)\s*return/);
        expect(block).toMatch(/res\.active\s*===\s*true/);
        expect(block).toMatch(/classList\.toggle\(\s*['"]projectPickerRunSpinner--active['"]\s*,\s*active\s*\)/);
        // Unrouted rows clear immediately, never probed.
        expect(block).toMatch(/classList\.remove\(\s*['"]projectPickerRunSpinner--active['"]\s*\)/);
    });

    it('runs the poll ONLY while the dropdown is open (start on open, stop on close)', () => {
        // 10s cadence.
        expect(picker).toMatch(/PICKER_SPINNER_INTERVAL_MS\s*=\s*10000/);
        // Started from openProjectPicker, stopped from closeProjectPicker.
        const open = picker.slice(picker.indexOf('function openProjectPicker'), picker.indexOf('function openProjectPicker') + 500);
        expect(open).toMatch(/startPickerSpinnerPoll\(\)/);
        const close = picker.slice(picker.indexOf('function closeProjectPicker'), picker.indexOf('function closeProjectPicker') + 500);
        expect(close).toMatch(/stopPickerSpinnerPoll\(\)/);
        // stop clears the interval and bumps the token so no late paint lands.
        const stop = picker.slice(picker.indexOf('function stopPickerSpinnerPoll'), picker.indexOf('function stopPickerSpinnerPoll') + 300);
        expect(stop).toMatch(/clearInterval\(\s*pickerSpinnerInterval\s*\)/);
        expect(stop).toMatch(/pickerSpinnerReqToken\+\+/);
    });
});

describe('project-switcher run spinners — mobile drawer (projectRow.js + main.js)', () => {
    const row = read('projectRow.js');
    const main = read('main.js');

    it('exports a drawer spinner mount + toggle modeled on the inject bolt', () => {
        expect(row).toMatch(/export\s+function\s+attachProjectRunSpinner\s*\(/);
        expect(row).toMatch(/export\s+function\s+setProjectRunSpinnerActive\s*\(/);
    });

    it('mounts the spinner once, just before the count badge, decorative', () => {
        const start = row.indexOf('function attachProjectRunSpinner');
        const block = row.slice(start, start + 1300);
        expect(block).toMatch(/querySelector\(\s*['"]\.projRunSpinner['"]\s*\)/);
        expect(block).toMatch(/sp\.className\s*=\s*['"]projRunSpinner['"]/);
        expect(block).toMatch(/sp\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
        // Inserted before .projBadge.
        expect(block).toMatch(/querySelector\(\s*['"]\.projBadge['"]\s*\)/);
        expect(block).toMatch(/insertBefore\(\s*sp\s*,\s*badge\s*\)/);
    });

    it('hides the spinner while the title is mid-rename (mirrors the bolt)', () => {
        const start = row.indexOf('function attachProjectRunSpinner');
        const block = row.slice(start, start + 1300);
        // focus → drop the spinner column.
        expect(block).toMatch(/addEventListener\(\s*['"]focus['"][\s\S]{0,120}classList\.remove\(\s*['"]hasRunSpinner['"]\s*\)/);
        // The toggle refuses to spin a row whose input is focused.
        const t = row.slice(row.indexOf('function setProjectRunSpinnerActive'), row.indexOf('function setProjectRunSpinnerActive') + 300);
        expect(t).toMatch(/document\.activeElement\s*===\s*titleInput/);
        expect(t).toMatch(/classList\.toggle\(\s*['"]hasRunSpinner['"]\s*,\s*!!active\s*&&\s*!editing\s*\)/);
    });

    it('mounts the spinner on both project-row construction sites', () => {
        const calls = main.match(/attachProjectRunSpinner\(projChild,\s*titleInput\)/g) || [];
        expect(calls.length).toBe(2);
    });

    it('drives + dedupes the drawer poll by repo, dropping stale responses', () => {
        const start = main.indexOf('async function refreshDrawerRunSpinners');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 2000);
        expect(block).toMatch(/sideMain\.querySelectorAll\(\s*['"]#projChild['"]\s*\)/);
        expect(block).toMatch(/resolveActiveProjectTarget\(\s*name\s*\)/);
        expect(block).toMatch(/rowsByRepo\s*=\s*new Map\(\)/);
        expect(block).toMatch(/fetchActiveRuns\(\s*\{\s*repo:\s*bucket\.target\.repo/);
        expect(block).toMatch(/token\s*!==\s*drawerSpinnerReqToken\s*\)\s*return/);
        expect(block).toMatch(/setProjectRunSpinnerActive\(\s*entry\.row\s*,\s*entry\.input\s*,\s*active\s*\)/);
    });

    it('runs the drawer poll ONLY while the sidebar drawer is open', () => {
        expect(main).toMatch(/DRAWER_SPINNER_INTERVAL_MS\s*=\s*10000/);
        const open = main.slice(main.indexOf('function openSidebar'), main.indexOf('function openSidebar') + 700);
        expect(open).toMatch(/startDrawerSpinnerPoll\(\)/);
        const close = main.slice(main.indexOf('function closeSidebar'), main.indexOf('function closeSidebar') + 500);
        expect(close).toMatch(/stopDrawerSpinnerPoll\(\)/);
        const stop = main.slice(main.indexOf('function stopDrawerSpinnerPoll'), main.indexOf('function stopDrawerSpinnerPoll') + 400);
        expect(stop).toMatch(/clearInterval\(\s*drawerSpinnerInterval\s*\)/);
        expect(stop).toMatch(/drawerSpinnerReqToken\+\+/);
    });
});

describe('project-switcher run spinners — styling', () => {
    const css = read('style.css');

    it('styles the dropdown spinner purple, hidden, non-interactive, on shared keyframes', () => {
        const base = css.match(/\.projectPickerRunSpinner\s*\{[^}]*\}/);
        expect(base).not.toBeNull();
        expect(base[0]).toMatch(/display:\s*none/);
        expect(base[0]).toMatch(/#9D93EE/);
        expect(base[0]).toMatch(/pointer-events:\s*none/);
        const active = css.match(/\.projectPickerRunSpinner--active\s*\{[^}]*\}/);
        expect(active).not.toBeNull();
        expect(active[0]).toMatch(/animation:\s*spin\s/);
        // Hidden during rename.
        expect(css).toMatch(/\.projectPickerRow\.editing\s+\.projectPickerRunSpinner\s*\{[^}]*display:\s*none/);
    });

    it('styles the drawer spinner purple, hidden, with its own reserved grid column', () => {
        const base = css.match(/\.projRunSpinner\s*\{[^}]*\}/);
        expect(base).not.toBeNull();
        expect(base[0]).toMatch(/display:\s*none/);
        expect(base[0]).toMatch(/#9D93EE/);
        expect(base[0]).toMatch(/pointer-events:\s*none/);
        // The row gains a column for the spinner, and a 5-column variant coexists with the bolt.
        expect(css).toMatch(/#projChild\.hasRunSpinner\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+auto\s+12px/);
        expect(css).toMatch(/#projChild\.hasInjectBolt\.hasRunSpinner\s*\{[^}]*grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto\s+auto\s+12px/);
        expect(css).toMatch(/#projChild\.hasRunSpinner\s+\.projRunSpinner\s*\{[^}]*animation:\s*spin\s/);
    });

    it('reuses the single shared spin keyframes (no duplicate definition)', () => {
        const matches = css.match(/@keyframes\s+spin\b/g) || [];
        expect(matches.length).toBe(1);
    });
});
