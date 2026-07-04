import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// On mobile widths the inline #todoMdViewerCard collapses to a single floored
// launcher row, so its Run backlog and Redeploy buttons drop their text labels
// and show only a glyph — a play ▶ for Run backlog (its existing SVG icon) and a
// monochrome currentColor rocket for Redeploy. The rocket is now a single
// definition (`deployPillGlyph`) shown on desktop beside the "Redeploy" label
// and icon-only on the collapsed mobile card — there is no separate mobile-only
// glyph anymore. Asserted by source inspection, matching the viewer's strategy.

describe('todoMdViewer — icon-only Run backlog / Redeploy on mobile', () => {
    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('defines a single monochrome rocket SVG as the Redeploy pill glyph', () => {
        // One rocket definition, stroked with currentColor so it recolors with
        // the pill state (grey idle, red failure) and stays monochrome next to
        // the other stroke icons — not the old refresh arrows and not an emoji.
        const match = main.match(/const deployPillGlyph\s*=\s*\n?\s*'([^']*)'/);
        expect(match).not.toBeNull();
        const glyph = match[1];
        expect(glyph).toMatch(/<svg[\s\S]*viewBox="0 0 14 14"/);
        expect(glyph).toMatch(/stroke="currentColor"/);
        // The rocket body path, window circle, and fins — distinguishes it from
        // the retired refresh-arrows glyph, which had no <circle>.
        expect(glyph).toMatch(/<circle cx="7" cy="5" r="1"\/>/);
        // The old full-color emoji glyph must be gone entirely.
        expect(main).not.toMatch(/textContent\s*=\s*['"]🚀['"]/);
    });

    it('renders the rocket glyph for non-deploying states via the shared icon span', () => {
        // The rocket rides on the pill's icon span in the non-deploying branch;
        // the amber spinner stands alone while a publish is in flight.
        const start = main.indexOf('function renderDeployPill');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 2200);
        expect(block).toMatch(/icon\.className\s*=\s*['"]todoMdViewerDeployPillGlyph['"]/);
        expect(block).toMatch(/icon\.innerHTML\s*=\s*deployPillGlyph/);
        // The separate mobile-only glyph block is retired.
        expect(block).not.toMatch(/todoMdViewerDeployPillMobileGlyph/);
    });

    it('keeps the Run backlog play glyph and its accessible label wiring intact', () => {
        // The play glyph is the existing SVG; only the text label is hidden via
        // CSS, and the button keeps its aria-label so the icon stays labeled.
        expect(main).toMatch(/todoMdViewerRunIcon/);
        expect(main).toMatch(/runBacklogBtn\.setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]Run backlog automation['"]\s*\)/);
    });

    it('drops the retired mobile-only rocket CSS class entirely', () => {
        // The single deployPillGlyph now carries the rocket on every breakpoint,
        // so the mobile-only glyph class no longer exists in the stylesheet.
        expect(css).not.toMatch(/todoMdViewerDeployPillMobileGlyph/);
    });

    it('collapses both buttons to transparent monochrome squares on the inline launcher', () => {
        expect(css).toMatch(
            /#mainList > #todoMdViewerCard \.todoMdViewerRunBtn,\s*#mainList > #todoMdViewerCard \.todoMdViewerDeployPill\s*\{[\s\S]*?width:\s*36px;[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*var\(--text-secondary\);[\s\S]*?\}/
        );
    });

    it('hides only the Run and Redeploy text labels on the inline card, keeping the rocket glyph visible', () => {
        // The rocket glyph is no longer hidden on the collapsed card — it is the
        // icon. Only the text labels drop so mobile stays icon-only.
        expect(css).toMatch(
            /#mainList > #todoMdViewerCard \.todoMdViewerRunLabel,\s*#mainList > #todoMdViewerCard \.todoMdViewerDeployPillLabel\s*\{\s*display:\s*none;\s*\}/
        );
        // The glyph must NOT be in the hidden group anymore.
        expect(css).not.toMatch(
            /#mainList > #todoMdViewerCard \.todoMdViewerDeployPillGlyph,\s*#mainList > #todoMdViewerCard \.todoMdViewerDeployPillLabel\s*\{\s*display:\s*none;/
        );
    });

    it('places the label-hiding rule inside the max-width:1023px block and above the mobile-sheet rules', () => {
        // Scoped to the inline #todoMdViewerCard launcher; the full-screen mobile
        // sheet keeps its labeled 50/50 touch targets.
        const media = css.indexOf('@media (max-width: 1023px)');
        const labelRule = css.indexOf('#mainList > #todoMdViewerCard .todoMdViewerDeployPillLabel {');
        const sheetRule = css.indexOf('#todoMdViewerMobileSheet .todoMdViewerHeader');
        expect(media).toBeGreaterThan(-1);
        expect(labelRule).toBeGreaterThan(media);
        expect(labelRule).toBeLessThan(sheetRule);
    });
});
