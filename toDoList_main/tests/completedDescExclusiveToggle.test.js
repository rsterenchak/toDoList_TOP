import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the cross-collapse contract between todo description panels and the
// COMPLETED section. The prior CSS-reflow fix wasn't enough — opening either
// one while the other was already open still let the panels visually collide.
// The contract now: opening any todo description collapses the COMPLETED
// section if it's open, and expanding the COMPLETED section collapses every
// open description. Only one of {any open description, the COMPLETED section}
// can be expanded at a time. The bulk EXPAND ALL control is the user's
// explicit override and bypasses the auto-collapse via a marker flag so
// "expand everything" still expands everything.
describe('description and COMPLETED section are mutually exclusive', () => {

    const main = read('main.js');

    // Locate the cross-collapse wiring by id-pair. The handler references
    // both #descToggle and #completedHeader inside the same closure — walk
    // every occurrence of #completedHeader and pick the proximity window
    // that also mentions #descToggle, so an unrelated comment or helper
    // can't shadow the match.
    function findCrossCollapseBlock() {
        const windowSize = 1500;
        let from = 0;
        let best = '';
        while (true) {
            const idx = main.indexOf('#completedHeader', from);
            if (idx === -1) break;
            const start = Math.max(0, idx - windowSize);
            const end = Math.min(main.length, idx + windowSize);
            const slice = main.slice(start, end);
            if (slice.indexOf('#descToggle') !== -1) {
                if (slice.length > best.length) best = slice;
            }
            from = idx + 1;
        }
        return best;
    }

    it('main.js wires a click listener that bridges #descToggle and #completedHeader', () => {
        const block = findCrossCollapseBlock();
        expect(block).not.toBe('');
        expect(block).toMatch(/#descToggle/);
        expect(block).toMatch(/#completedHeader/);
    });

    it('opening a single description triggers the COMPLETED chevron click when the section is open', () => {
        const block = findCrossCollapseBlock();
        // The handler must (a) detect "about to open" by checking the
        // descToggle does NOT currently have the .open class, (b) only act
        // when the persisted COMPLETED-section flag says it's open, and
        // (c) reuse the existing chevron click rather than re-implementing
        // its state writes.
        expect(block).toMatch(/classList\.contains\(\s*['"]open['"]\s*\)/);
        expect(block).toMatch(/isCompletedSectionOpen\(\s*\)/);
        expect(block).toMatch(/(completedHeader|header)\.click\(\s*\)/);
    });

    it('expanding the COMPLETED section calls collapseAllDescriptions', () => {
        const block = findCrossCollapseBlock();
        // The reverse direction: a click on the chevron that would OPEN the
        // section (current flag is false) must close every open description
        // first. Reuses the existing bulk helper so the per-row switcher
        // state stays in sync.
        expect(block).toMatch(/!\s*isCompletedSectionOpen\(\s*\)/);
        expect(block).toMatch(/collapseAllDescriptions\(\s*\)/);
    });

    it('the EXPAND ALL bulk path bypasses the cross-collapse via a marker flag', () => {
        // Find the expandAllDescriptions function body by bracket-matching.
        const sig = 'function expandAllDescriptions';
        const i = main.indexOf(sig);
        expect(i).toBeGreaterThan(-1);
        const braceStart = main.indexOf('{', i);
        let depth = 0;
        let body = '';
        for (let k = braceStart; k < main.length; k++) {
            if (main[k] === '{') depth++;
            else if (main[k] === '}') {
                depth--;
                if (depth === 0) {
                    body = main.slice(braceStart, k + 1);
                    break;
                }
            }
        }
        expect(body).toBeTruthy();
        // The bulk path sets a marker (a data-* flag on mainList) the
        // cross-collapse listener checks to bail out, then clears it after
        // iterating. The marker name itself can change, but it must be
        // both set and cleared inside this function so the bypass is
        // scoped to the bulk iteration.
        expect(body).toMatch(/bulkDesc/);
        // The cross-collapse block must read the same marker, so an EXPAND
        // ALL invocation can't accidentally collapse the COMPLETED section
        // (and so a synthetic COMPLETED-toggle click from the bulk path,
        // if any, can't recursively collapseAllDescriptions).
        const block = findCrossCollapseBlock();
        expect(block).toMatch(/bulkDesc/);
    });

});
