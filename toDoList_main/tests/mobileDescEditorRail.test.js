import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the restructure of the mobile description-editor modal into an instrument
// panel: a read-only phase rail leads the dialog (IDEA · DRAFT · REVIEW · DONE),
// the textarea sits under a "The entry" label, Generate carries a budget spend
// caption, and the manual STATUS control is demoted below the actions. Source-
// inspection only, matching the mobileDescEditorModal style — the modal flow is
// too heavily wired to instantiate end-to-end here.

describe('mobile desc editor rail — phase.js vocabulary reuse', () => {
    const modals = read('modals.js');

    it('imports derivePhase + the rail vocabulary from phase.js (single-sourced)', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*derivePhase[^}]*\}\s*from\s*['"]\.\/phase\.js['"]/
        );
        expect(modals).toMatch(
            /import\s*\{[^}]*PHASE_RAIL_ORDER[^}]*\}\s*from\s*['"]\.\/phase\.js['"]/
        );
        expect(modals).toMatch(
            /import\s*\{[^}]*PHASE_RAIL_LABELS[^}]*\}\s*from\s*['"]\.\/phase\.js['"]/
        );
    });

    it('builds the rail nodes by iterating PHASE_RAIL_ORDER (not a hardcoded list)', () => {
        expect(modals).toMatch(/PHASE_RAIL_ORDER\.forEach\(/);
        expect(modals).toMatch(/PHASE_RAIL_LABELS\[/);
    });

    it('derives the current phase from derivePhase (display-only, no phase mutation)', () => {
        const fnIdx = modals.indexOf('function renderRail');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx, fnIdx + 900);
        expect(fn).toMatch(/derivePhase\(\s*item\s*\)/);
    });
});

describe('mobile desc editor rail — markup + placement', () => {
    const modals = read('modals.js');

    it('renders a #descEditorModalRail with descEditorModalRailNode children', () => {
        expect(modals).toMatch(/['"]descEditorModalRail['"]/);
        expect(modals).toMatch(/['"]descEditorModalRailNode/);
    });

    it('the rail is display-only: role="img", no click handler on the rail', () => {
        expect(modals).toMatch(/rail\.setAttribute\(\s*['"]role['"]\s*,\s*['"]img['"]\s*\)/);
        // No tap-to-change: the rail element gets no click listener.
        expect(modals).not.toMatch(/rail\.addEventListener\(\s*['"]click['"]/);
    });

    it('marks nodes before the current phase filled and the current one highlighted', () => {
        const fnIdx = modals.indexOf('function renderRail');
        const fn = modals.slice(fnIdx, fnIdx + 900);
        expect(fn).toMatch(/is-filled/);
        expect(fn).toMatch(/is-current/);
        expect(fn).toMatch(/i\s*<\s*currentIndex/);
        expect(fn).toMatch(/i\s*===\s*currentIndex/);
    });

    it('places the rail immediately after the header, before the body', () => {
        const fnIdx = modals.indexOf('function showDescEditorModal(');
        const fn = modals.slice(fnIdx);
        const headerAppend = fn.search(/dialog\.appendChild\(\s*header\s*\)/);
        const railAppend = fn.search(/dialog\.appendChild\(\s*rail\s*\)/);
        const bodyAppend = fn.search(/dialog\.appendChild\(\s*body\s*\)/);
        expect(headerAppend).toBeGreaterThan(-1);
        expect(railAppend).toBeGreaterThan(-1);
        expect(bodyAppend).toBeGreaterThan(-1);
        expect(headerAppend).toBeLessThan(railAppend);
        expect(railAppend).toBeLessThan(bodyAppend);
    });
});

describe('mobile desc editor rail — live repaint + teardown', () => {
    const modals = read('modals.js');

    it('subscribes the open rail to TODO_RUN_STATUS_EVENT so it repaints on phase change', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*TODO_RUN_STATUS_EVENT[^}]*\}\s*from\s*['"]\.\/inject\.js['"]/
        );
        expect(modals).toMatch(
            /document\.addEventListener\(\s*TODO_RUN_STATUS_EVENT\s*,\s*onRailPhaseChange\s*\)/
        );
    });

    it('tears the listener down on close so a dismissed modal leaves nothing attached', () => {
        const fnIdx = modals.indexOf('function onDescEditorClose');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx, fnIdx + 500);
        expect(fn).toMatch(
            /document\.removeEventListener\(\s*TODO_RUN_STATUS_EVENT\s*,\s*onRailPhaseChange\s*\)/
        );
    });
});

describe('mobile desc editor — THE ENTRY label + Generate spend caption', () => {
    const modals = read('modals.js');

    it('labels the textarea with a "The entry" label appended before the textarea', () => {
        expect(modals).toMatch(/['"]descEditorModalEntryLabel['"]/);
        const labelIdx = modals.indexOf("'descEditorModalEntryLabel'");
        expect(labelIdx).toBeGreaterThan(-1);
        const tail = modals.slice(labelIdx, labelIdx + 300);
        expect(tail).toMatch(/textContent\s*=\s*['"]The entry['"]/);
        // The label is appended before the textarea build.
        const fn = modals.slice(modals.indexOf('function showDescEditorModal('));
        const labelAppend = fn.search(/body\.appendChild\(\s*entryLabel\s*\)/);
        const textareaAppend = fn.search(/body\.appendChild\(\s*textarea\s*\)/);
        expect(labelAppend).toBeGreaterThan(-1);
        expect(textareaAppend).toBeGreaterThan(-1);
        expect(labelAppend).toBeLessThan(textareaAppend);
    });

    it('renders a Generate spend caption naming the budget it dispatches', () => {
        expect(modals).toMatch(/['"]descEditorModalGenerateSpend['"]/);
        const idx = modals.indexOf("'descEditorModalGenerateSpend'");
        expect(idx).toBeGreaterThan(-1);
        const tail = modals.slice(idx, idx + 300);
        // Names a budget/quota — the caption must not be empty boilerplate.
        expect(tail).toMatch(/textContent\s*=\s*['"][^'"]*(quota|budget)[^'"]*['"]/i);
    });

    it('still appends the Generate button into the actions container', () => {
        // The shared makeGenerateButton/syncGenerateControl wiring is unchanged;
        // only the surrounding order and caption are added.
        expect(modals).toMatch(/actions\.appendChild\(generateBtn\)/);
        expect(modals).toMatch(/syncGenerateControl\(generateBtn\)/);
    });
});

describe('mobile desc editor rail — styling', () => {
    const css = read('style.css');

    it('the rail nodes reuse the 10px radius and 36px chip conventions (no new tokens)', () => {
        const ruleMatch = css.match(/\.descEditorModalRailNode\s*\{([\s\S]{0,600}?)\}/);
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        expect(body).toMatch(/border-radius:\s*10px/);
        expect(body).toMatch(/min-height:\s*36px/);
    });

    it('filled + current nodes paint with the accent tokens', () => {
        expect(css).toMatch(
            /\.descEditorModalRailNode\.is-filled\s*\{[\s\S]{0,120}background:\s*var\(--accent\)/
        );
        expect(css).toMatch(
            /\.descEditorModalRailNode\.is-current\s*\{[\s\S]{0,160}border-color:\s*var\(--accent\)/
        );
    });

    it('the status row is separated from the actions above it by a top divider', () => {
        // Demoted to last in the dialog, it carries a top border + bottom padding.
        const ruleMatch = css.match(/#descEditorModalStatusRow\s*\{([\s\S]{0,300}?)\}/);
        expect(ruleMatch).toBeTruthy();
        expect(ruleMatch[1]).toMatch(/border-top:\s*0\.5px\s+solid\s+var\(--border-dim\)/);
    });
});
