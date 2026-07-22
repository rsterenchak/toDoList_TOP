import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression guard for the stacked actions layout of the mobile
// description-editor modal (#descEditorModalActions). The block reads top to
// bottom: Generate (order 1) leading, its spend caption (order 2), Inject
// (order 4), then an equal-width (50/50) Clear / Copy outline pair (orders 5/6).
// Generate and Inject each take a full-width row; Inject keeps the deeper
// filled-primary emphasis in its ready state. These tests pin the CSS
// invariants so the sequence can't silently collapse or flip emphasis.
describe('desc editor modal — stacked actions layout', () => {
    const css = read('style.css');

    // Body of the first `<selector> { ... }` rule whose selector matches the
    // given literal, with comments stripped so commentary can't satisfy an
    // assertion.
    function ruleBody(selector) {
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
        // Global match, returning the LAST rule body. `#...Copy` also appears
        // as the second selector of the combined Clear/Copy rule, so the
        // standalone Copy rule (which is later in the file) is the last match.
        const re = new RegExp(
            selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}',
            'mg'
        );
        let m, last = null;
        while ((m = re.exec(stripped)) !== null) last = m[1];
        return last;
    }

    it('the actions container wraps so the buttons can stack across two rows', () => {
        const body = ruleBody('#descEditorModalActions');
        expect(body).not.toBeNull();
        expect(body).toMatch(/flex-wrap:\s*wrap/);
    });

    it('Generate leads the block on its own full-width row (order 1)', () => {
        const body = ruleBody('#descEditorModalActions .generateBtn');
        expect(body).not.toBeNull();
        expect(body).toMatch(/order:\s*1\b/);
        expect(body).toMatch(/flex:\s*0\s+0\s+100%/);
    });

    it('Inject takes a full-width row below Generate + its spend caption (order 4)', () => {
        const body = ruleBody('#descEditorModalActions .injectBtn');
        expect(body).not.toBeNull();
        // order:4 sits below Generate (1) and its spend caption (2); 100% basis
        // forces it onto its own row in the wrapping flex container.
        expect(body).toMatch(/order:\s*4\b/);
        expect(body).toMatch(/flex:\s*0\s+0\s+100%/);
    });

    it('the Generate spend caption sits directly under Generate (order 2, full-width)', () => {
        const body = ruleBody('#descEditorModalGenerateSpend');
        expect(body).not.toBeNull();
        expect(body).toMatch(/order:\s*2\b/);
        expect(body).toMatch(/flex:\s*0\s+0\s+100%/);
    });

    it('Inject carries the deeper #6C5DF5 fill in its ready state', () => {
        const body = ruleBody(
            '#descEditorModalActions .injectBtn:not(.injectBtn--unconfigured):not(.injectBtn--no-target):not(.injectBtn--injected)'
        );
        expect(body).not.toBeNull();
        expect(body).toMatch(/background:\s*#6C5DF5/i);
        expect(body).toMatch(/border-color:\s*#6C5DF5/i);
    });

    it('Clear and Copy share the second row at equal width', () => {
        const body = ruleBody(
            '#descEditorModalActions #descEditorModalClear,\n#descEditorModalActions #descEditorModalCopy'
        );
        expect(body).not.toBeNull();
        expect(body).toMatch(/flex:\s*1\s+1\s+0/);
    });

    it('Copy entry drops to a border-bright outline (no longer the solid fill)', () => {
        const body = ruleBody('#descEditorModalActions #descEditorModalCopy');
        expect(body).not.toBeNull();
        expect(body).toMatch(/border-color:\s*var\(--border-bright\)/);
        // The fill must NOT be the solid accent — that emphasis moved to Inject.
        expect(body).not.toMatch(/background:\s*var\(--accent\)\s*;/);
    });
});
