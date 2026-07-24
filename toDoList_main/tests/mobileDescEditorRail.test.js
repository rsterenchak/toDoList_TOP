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
//
// The rail markup itself now lives in the shared phaseRail.js builder (so the
// desktop #descSibling panel renders the same rail); this file pins the modal's
// USE of that builder, and phaseRail.test.js pins the builder's own DOM.

describe('mobile desc editor rail — shared phaseRail.js builder reuse', () => {
    const modals = read('modals.js');

    it('imports derivePhase from phase.js (single-sourced phase derivation)', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*derivePhase[^}]*\}\s*from\s*['"]\.\/phase\.js['"]/
        );
    });

    it('imports the rail builder from the shared phaseRail.js module', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*buildPhaseRail[^}]*\}\s*from\s*['"]\.\/phaseRail\.js['"]/
        );
        expect(modals).toMatch(
            /import\s*\{[^}]*paintPhaseRail[^}]*\}\s*from\s*['"]\.\/phaseRail\.js['"]/
        );
    });

    it('no longer inlines the rail vocabulary — the node-building moved to phaseRail.js', () => {
        // The extraction's point is one implementation. If modals reintroduces the
        // PHASE_RAIL_ORDER iteration it would be a second copy that could drift.
        expect(modals).not.toMatch(/PHASE_RAIL_ORDER\.forEach\(/);
    });

    it('renderRail derives the current phase and repaints via the shared builder', () => {
        const fnIdx = modals.indexOf('function renderRail');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = modals.slice(fnIdx, fnIdx + 400);
        expect(fn).toMatch(/derivePhase\(\s*item\s*\)/);
        expect(fn).toMatch(/paintPhaseRail\(\s*rail\s*,/);
    });
});

describe('mobile desc editor rail — markup + placement', () => {
    const modals = read('modals.js');

    it('builds the rail through buildPhaseRail and gives it the modal host id', () => {
        expect(modals).toMatch(/buildPhaseRail\(\s*derivePhase\(\s*item\s*\)\s*\)/);
        expect(modals).toMatch(/rail\.id\s*=\s*['"]descEditorModalRail['"]/);
    });

    it('the rail is display-only: no click handler is attached to it in the modal', () => {
        // No tap-to-change: the rail element gets no click listener (role="img"
        // itself is set by the shared builder — see phaseRail.test.js).
        expect(modals).not.toMatch(/rail\.addEventListener\(\s*['"]click['"]/);
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

describe('mobile desc editor rail — connected-rail styling', () => {
    const css = read('style.css');

    it('is a connected rail: fixed-width dot-over-caption columns joined by connectors', () => {
        // Each node is a plain column, NOT a chip/box — no border-radius box and
        // no min-height button chrome on the node itself. Classes are the shared
        // host-neutral phaseRail* names.
        const nodeMatch = css.match(/\.phaseRailNode\s*\{([\s\S]{0,400}?)\}/);
        expect(nodeMatch).toBeTruthy();
        const nodeBody = nodeMatch[1];
        expect(nodeBody).toMatch(/flex-direction:\s*column/);
        expect(nodeBody).not.toMatch(/border-radius/);
        expect(nodeBody).not.toMatch(/min-height/);
        // The dot is the only round element — a 10px circle.
        const dotMatch = css.match(/\.phaseRailDot\s*\{([\s\S]{0,300}?)\}/);
        expect(dotMatch).toBeTruthy();
        expect(dotMatch[1]).toMatch(/border-radius:\s*50%/);
        expect(dotMatch[1]).toMatch(/width:\s*10px/);
        // Connectors join the dots.
        expect(css).toMatch(/\.phaseRailConnector\s*\{[\s\S]{0,200}flex:\s*1\s+1\s+0/);
    });

    it('filled + current dots paint with the accent tokens; current gets a halo ring', () => {
        // Passed dots: solid accent fill.
        expect(css).toMatch(
            /\.phaseRailNode\.is-filled\s+\.phaseRailDot\s*\{[\s\S]{0,120}background:\s*var\(--accent\)/
        );
        // The connector trailing a passed/current node is accent too.
        expect(css).toMatch(
            /\.phaseRailConnector\.is-filled\s*\{[\s\S]{0,80}background:\s*var\(--accent\)/
        );
        // Current dot: accent outline plus a soft box-shadow halo (spread, not a
        // border, so it doesn't resize the dot's box).
        expect(css).toMatch(
            /\.phaseRailNode\.is-current\s+\.phaseRailDot\s*\{[\s\S]{0,200}box-shadow:\s*0 0 0 3px/
        );
    });

    it('the rail carries no interactive affordances — no hover, active, or cursor', () => {
        // Guard the affordance-lie fix: the rail elements must never grow a
        // :hover / :active feedback rule or a pointer cursor.
        expect(css).not.toMatch(/\.phaseRail(Node|Dot|Connector)[^{]*:hover/);
        expect(css).not.toMatch(/\.phaseRail(Node|Dot|Connector)[^{]*:active/);
        expect(css).not.toMatch(/\.phaseRail(Node|Dot|Connector)[^{]*\{[^}]*cursor:\s*pointer/);
    });

    it('the four action controls convert to SpaceMono uppercase letterspaced type', () => {
        const ruleMatch = css.match(
            /#descEditorModalActions\s+\.descEditorModalBtn\s*\{([\s\S]{0,300}?)\}/
        );
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        expect(body).toMatch(/font-family:\s*'SpaceMono'/);
        expect(body).toMatch(/text-transform:\s*uppercase/);
        expect(body).toMatch(/letter-spacing:/);
    });

    it('the Generate spend caption is uppercase letterspaced and left-aligned', () => {
        const ruleMatch = css.match(/#descEditorModalGenerateSpend\s*\{([\s\S]{0,400}?)\}/);
        expect(ruleMatch).toBeTruthy();
        const body = ruleMatch[1];
        expect(body).toMatch(/text-transform:\s*uppercase/);
        expect(body).toMatch(/text-align:\s*left/);
    });

    it('Generate carries a leading dispatch mark that Inject does not', () => {
        // Scoped to the modal so the desktop sparkle is untouched.
        expect(css).toMatch(
            /#descEditorModalActions\s+\.generateBtn[^{]*\.generateBtnLabel::before\s*\{[\s\S]{0,120}content:/
        );
    });

    it('the status row is separated from the actions above it by a top divider', () => {
        // Demoted to last in the dialog, it carries a top border + bottom padding.
        const ruleMatch = css.match(/#descEditorModalStatusRow\s*\{([\s\S]{0,300}?)\}/);
        expect(ruleMatch).toBeTruthy();
        expect(ruleMatch[1]).toMatch(/border-top:\s*0\.5px\s+solid\s+var\(--border-dim\)/);
    });
});
