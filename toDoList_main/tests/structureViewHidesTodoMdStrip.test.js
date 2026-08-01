import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: the TODO.md rail strip (#todoMdViewerStrip) is a Stream-only
// child of #mainBar, but the `#mainBar[data-view="structure"]` rule that
// hides the other queue-column children by name (#mainList, #mobileProjHeader,
// #taskFilterBar, #bulkDescActions) was written before the strip was pinned
// into #mainBar, so the strip kept rendering under STRUCTURE and peeked past
// the right edge of the expanded Structure view. The fix adds the strip to
// that same hide rule so the section listing every Stream-only child stays the
// single place a future addition is checked against.
describe('Structure view hides the TODO.md rail strip', () => {
    const css = read('style.css');

    // The single hide rule for Stream-only #mainBar children under STRUCTURE.
    // Selectors can't contain { or }, so [^{}]* captures the whole comma group
    // from the anchor selector up to the block, then the block body.
    const match = css.match(
        /#mainBar\[data-view="structure"\] #mainList[^{}]*\{[^{}]*\}/
    );

    it('has the structure-view hide rule', () => {
        expect(match).not.toBeNull();
    });

    it('hides #todoMdViewerStrip alongside the other Stream-only children', () => {
        const rule = match[0];
        expect(rule).toMatch(/#mainBar\[data-view="structure"\] #todoMdViewerStrip/);
        // The rule collapses the strip to nothing so the Structure view owns
        // the full pane; a residual display would let the strip peek through.
        expect(rule).toMatch(/display:\s*none/);
    });
});
