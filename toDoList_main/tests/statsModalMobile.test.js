import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

function extractFunction(source, signature) {
    const start = source.indexOf(signature);
    if (start === -1) throw new Error('signature not found: ' + signature);
    const bodyStart = source.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        const c = source[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    throw new Error('unterminated function for: ' + signature);
}

// On phone-width viewports (≤420px) the inline `#statsSibling` drawer
// fought #mainList's grid track sizing too hard — bigger cells, single-row
// strips, and height fixes never fully contained the drawer's content.
// The fix swaps the mobile surface for a full-screen `#statsModal` that
// lives outside #mainList entirely, lets the contributions grid render
// at desktop size, and reuses the existing renderStatsContent payload.
// Desktop (>420px) keeps the inline drawer unchanged.
describe('recurring-task stats use a full-screen modal on phone viewports', () => {
    const toDoRow = read('toDoRow.js');
    const css = read('style.css');
    const modals = read('modals.js');

    it('wireStatsToggle branches on matchMedia(max-width: 420px) — true opens the modal, false uses the drawer', () => {
        const fn = extractFunction(toDoRow, 'function wireStatsToggle(');
        expect(fn).toMatch(/matchMedia\(\s*['"]\(max-width:\s*420px\)['"]\s*\)/);
        // The mobile branch must route to the modal helper, not insert
        // a #statsSibling into #mainList.
        expect(fn).toMatch(/openStatsModal\s*\(/);
        // The inline-drawer path still inserts #statsSibling into the
        // list for the desktop branch.
        expect(fn).toMatch(/insertBefore\(\s*drawer/);
    });

    it('openStatsModal builds the dialog shell with backdrop, dialog, header (title + close X), and a body', () => {
        const fn = extractFunction(toDoRow, 'function openStatsModal(');
        expect(fn).toMatch(/statsModalBackdrop/);
        expect(fn).toMatch(/['"]statsModal['"]/);
        expect(fn).toMatch(/statsModalHeader/);
        expect(fn).toMatch(/statsModalTitle/);
        expect(fn).toMatch(/statsModalSubtitle/);
        expect(fn).toMatch(/statsModalClose/);
        expect(fn).toMatch(/statsModalBody/);
        // Dialog role + aria-modal so the modal announces itself correctly.
        expect(fn).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]dialog['"]/);
        expect(fn).toMatch(/setAttribute\(\s*['"]aria-modal['"]\s*,\s*['"]true['"]/);
    });

    it('openStatsModal wires the three close affordances — X click, backdrop click, Escape', () => {
        const fn = extractFunction(toDoRow, 'function openStatsModal(');
        // X click
        expect(fn).toMatch(/closeX\.addEventListener\(\s*['"]click['"]/);
        // Backdrop click — close only when target IS backdrop (not bubbled from dialog)
        expect(fn).toMatch(/event\.target\s*===\s*backdrop/);
        // Escape via document keydown listener
        expect(fn).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
    });

    it('openStatsModal resets the window selection to 30d on every open', () => {
        const fn = extractFunction(toDoRow, 'function openStatsModal(');
        expect(fn).toMatch(/currentWindow\s*=\s*['"]30d['"]/);
    });

    it('renderStatsContent always uses buildContributionsGrid for non-month/year cadences regardless of viewport', () => {
        const fn = extractFunction(toDoRow, 'function renderStatsContent(');
        // The previous mobile branch that swapped in buildFallbackStrip
        // with a `true` mobile flag must be gone — the modal renders the
        // full contributions grid at desktop dimensions.
        expect(fn).not.toMatch(/buildFallbackStrip\s*\(\s*stats\s*,\s*true\s*\)/);
        // Both grids still appear: contributions grid for daily/weekly,
        // fallback strip (no flag) for month/year cadences.
        expect(fn).toMatch(/buildContributionsGrid\s*\(/);
        expect(fn).toMatch(/buildFallbackStrip\s*\(\s*stats\s*\)/);
    });

    it('buildFallbackStrip no longer accepts a mobile parameter — the dead code is gone', () => {
        const fn = extractFunction(toDoRow, 'function buildFallbackStrip(');
        expect(fn).toMatch(/function\s+buildFallbackStrip\s*\(\s*stats\s*\)/);
        // No mobile branches inside the function body.
        expect(fn).not.toMatch(/\bmobile\b/);
        // Caption and label divs were mobile-only chrome — they're gone too.
        expect(fn).not.toMatch(/statsFallbackStripCaption/);
        expect(fn).not.toMatch(/statsFallbackStripLabels?/);
    });

    it('statsFallbackStripMobile class is gone from toDoRow.js and style.css', () => {
        expect(toDoRow).not.toMatch(/statsFallbackStripMobile/);
        expect(css).not.toMatch(/statsFallbackStripMobile/);
        // The caption / labels CSS rules were dead code once the mobile
        // strip went — assert they're gone so the cleanup is complete.
        expect(css).not.toMatch(/\.statsFallbackStripCaption\s*\{/);
        expect(css).not.toMatch(/\.statsFallbackStripLabels?\s*\{/);
    });

    it('#statsModal CSS shell exists with the expected modal vocabulary', () => {
        expect(css).toMatch(/#statsModalBackdrop\s*\{/);
        expect(css).toMatch(/#statsModal\s*\{/);
        expect(css).toMatch(/#statsModalHeader\s*\{/);
        expect(css).toMatch(/#statsModalTitle\s*\{/);
        expect(css).toMatch(/#statsModalSubtitle\s*\{/);
        expect(css).toMatch(/#statsModalClose\s*\{/);
        expect(css).toMatch(/#statsModalBody\s*\{/);

        // Backdrop must be fixed-position and full-viewport — same shape
        // as #missedDatesModalBackdrop. Without this, the modal would
        // anchor to its DOM-insertion ancestor instead of the viewport.
        const backdropRule = css.match(/#statsModalBackdrop\s*\{([^}]*)\}/);
        expect(backdropRule).not.toBeNull();
        expect(backdropRule[1]).toMatch(/position:\s*fixed/);
        expect(backdropRule[1]).toMatch(/inset:\s*0/);
    });

    it('isAnyModalOrPopoverOpen knows about #statsModalBackdrop so the help FAB and ? shortcut suppress while the modal is open', () => {
        const fn = extractFunction(modals, 'export function isAnyModalOrPopoverOpen(');
        expect(fn).toMatch(/statsModalBackdrop/);
    });

    it('the Claude launcher hides while the stats modal is open', () => {
        // The body:has(#statsModalBackdrop) selector must appear in the
        // launcher hide rule alongside the other modal backdrops.
        expect(css).toMatch(/body:has\(#statsModalBackdrop\)\s+#claudeLauncher/);
    });
});
