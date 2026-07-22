import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression guard for the mobile description-editor Generate button's outline.
// The button (#descEditorModalActions .generateBtn) is the first flex child in
// the actions block, sitting directly below the container's 0.5px border-top +
// padding. That places its own 0.5px hairline top border at a fractional
// device-pixel position, where it antialiases to near-invisibility against the
// dark surface — the outline reads as an open-topped box, unlike the Clear /
// Copy siblings further down the block. Promoting the button to its own paint
// layer snaps it to the device-pixel grid so the complete 0.5px outline renders
// on all four sides, matching its siblings without thickening the hairline.
describe('desc editor modal — Generate button top border renders', () => {
    const css = read('style.css');

    // Body of the LAST `<selector> { ... }` rule whose selector matches the
    // given literal, with comments stripped so commentary can't satisfy an
    // assertion.
    function ruleBody(selector) {
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
        const re = new RegExp(
            selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}',
            'mg'
        );
        let m, last = null;
        while ((m = re.exec(stripped)) !== null) last = m[1];
        return last;
    }

    it('keeps its 0.5px accent hairline border (not thickened past its siblings)', () => {
        // Anchor on the standalone base `.generateBtn` rule (preceded by a rule
        // boundary), so the scoped `#descEditorModalActions .generateBtn` and
        // `#descSibling .generateBtn` rules can't be picked up instead.
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
        const m = /(?:^|\})\s*\.generateBtn\s*\{([^}]*)\}/m.exec(stripped);
        expect(m).not.toBeNull();
        // The complete outline is achieved by fixing the sub-pixel loss, not by
        // bumping the hairline — so the base border stays a 0.5px accent stroke.
        expect(m[1]).toMatch(/border:\s*0\.5px\s+solid\s+var\(--accent\)/);
    });

    it('promotes the modal Generate button to its own paint layer so the hairline top border is not lost to sub-pixel antialiasing', () => {
        const body = ruleBody('#descEditorModalActions .generateBtn');
        expect(body).not.toBeNull();
        // translateZ(0) / translate3d(...) forces a composited layer snapped to
        // the device-pixel grid, restoring the top edge of the hairline outline.
        expect(body).toMatch(/transform:\s*translate(Z\(0\)|3d\([^)]*\))/);
    });
});
