import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// The STRUCTURE view spans the full main pane at desktop widths: the #mainSec
// queue|detail split collapses to a single track and #descDetailPane is hidden, so
// the navigator rail + detail column own the whole pane. The collapse gate MUST be
// keyed off an attribute on #mainSec or <body> — never #mainBar[data-view] — because
// the split lives on #mainSec while data-view is written on #mainBar (its child), and
// CSS cannot select an ancestor by a descendant's attribute. This regression pins
// that gate so the silent ancestor-selector mistake can't be reintroduced.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const css = readFileSync(resolve(srcDir, 'style.css'), 'utf8');
const mainJs = readFileSync(resolve(srcDir, 'main.js'), 'utf8');

describe('desktop Structure split collapse', () => {
    it('collapses #mainSec via a body[data-view="structure"] gate (an ancestor, not #mainBar)', () => {
        // The gate that reduces #mainSec to a single column is keyed off <body>.
        expect(css).toMatch(
            /body\[data-view="structure"\]\s+#mainSec\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/
        );
    });

    it('never keys the #mainSec split collapse off #mainBar (an unreachable ancestor selector)', () => {
        // #mainBar[data-view=...] #mainSec would never match — #mainBar is a CHILD of
        // #mainSec, so such a rule is a silent no-op. Assert it does not exist.
        expect(css).not.toMatch(/#mainBar\[data-view="structure"\]\s+#mainSec/);
    });

    it('hides #descDetailPane with a [hidden] guard that beats its display:flex', () => {
        expect(css).toMatch(/#descDetailPane\[hidden\]\s*\{\s*display:\s*none/);
    });

    it('toggles #descDetailPane.hidden from applyActiveView when Structure is active', () => {
        // The [hidden] attribute is driven from JS in lockstep with the view switch.
        expect(mainJs).toMatch(/descDetailPane['"]\s*\)[\s\S]{0,120}\.hidden\s*=\s*\(safe === 'structure'\)/);
    });

    it('lays out #structureView as a two-column grid at desktop widths', () => {
        expect(css).toMatch(
            /#mainBar\[data-view="structure"\]\s+#structureView\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*minmax\(260px,\s*300px\)\s*minmax\(0,\s*1fr\)/
        );
    });
});
