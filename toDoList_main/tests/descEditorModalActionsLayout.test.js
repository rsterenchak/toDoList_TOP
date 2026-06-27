import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression guard for the primary + secondary actions layout of the mobile
// description-editor modal (#descEditorModalActions). Inject is the actual
// pipeline action, so it takes a full-width filled-primary row of its own
// above an equal-width (50/50) Clear / Copy outline pair. These tests pin the
// CSS invariants so the layout can't silently collapse back to one mixed-width
// row or flip the fill emphasis.
describe('desc editor modal — primary + secondary actions layout', () => {
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

    it('Inject takes a full-width row ordered first', () => {
        const body = ruleBody('#descEditorModalActions .injectBtn');
        expect(body).not.toBeNull();
        // order:-1 floats it above the (later-DOM) Clear/Copy pair; 100% basis
        // forces it onto its own row in the wrapping flex container.
        expect(body).toMatch(/order:\s*-1/);
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
