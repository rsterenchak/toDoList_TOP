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
// monochrome currentColor rocket for Redeploy (an inline SVG, not the old full-
// color emoji) — as compact monochrome squares. Desktop keeps the labels.
// Asserted by source inspection, matching the viewer's test strategy.

describe('todoMdViewer — icon-only Run backlog / Redeploy on mobile', () => {
    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('renders a mobile-only monochrome rocket SVG on the Redeploy pill for non-deploying states', () => {
        // The glyph is appended inside the `state !== 'deploying'` guard so the
        // amber spinner stands alone while a publish is in flight. It is an inline
        // SVG stroked with currentColor (not the old '🚀' emoji) so it recolors
        // with the pill state and stays monochrome next to the other stroke icons.
        const start = main.indexOf('function renderDeployPill');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 2200);
        expect(block).toMatch(
            /if\s*\(\s*state\s*!==\s*['"]deploying['"]\s*\)\s*\{[\s\S]*?todoMdViewerDeployPillMobileGlyph[\s\S]*?innerHTML\s*=[\s\S]*?<svg[\s\S]*?stroke="currentColor"/
        );
        // The old full-color emoji glyph must be gone.
        expect(block).not.toMatch(/mobileGlyph\.textContent\s*=\s*['"]🚀['"]/);
        expect(block).toMatch(/mobileGlyph\.setAttribute\(\s*['"]aria-hidden['"]\s*,\s*['"]true['"]\s*\)/);
    });

    it('keeps the Run backlog play glyph and its accessible label wiring intact', () => {
        // The play glyph is the existing SVG; only the text label is hidden via
        // CSS, and the button keeps its aria-label so the icon stays labeled.
        expect(main).toMatch(/todoMdViewerRunIcon/);
        expect(main).toMatch(/runBacklogBtn\.setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]Run backlog automation['"]\s*\)/);
    });

    it('hides the mobile rocket glyph on desktop by default and centers the SVG', () => {
        // font-size no longer governs the glyph now that it's an SVG; the span
        // uses flex centering so the inline rocket sits centered in the square.
        expect(css).toMatch(
            /\.todoMdViewerDeployPillMobileGlyph\s*\{[^}]*display:\s*none;[^}]*align-items:\s*center;/
        );
        expect(css).not.toMatch(
            /\.todoMdViewerDeployPillMobileGlyph\s*\{[^}]*font-size:\s*15px/
        );
    });

    it('collapses both buttons to transparent monochrome squares on the inline launcher', () => {
        expect(css).toMatch(
            /#mainList > #todoMdViewerCard \.todoMdViewerRunBtn,\s*#mainList > #todoMdViewerCard \.todoMdViewerDeployPill\s*\{[\s\S]*?width:\s*36px;[\s\S]*?background:\s*transparent;[\s\S]*?color:\s*var\(--text-secondary\);[\s\S]*?\}/
        );
    });

    it('hides the Run label and Redeploy SVG glyph + label, showing the rocket, scoped to the inline card', () => {
        expect(css).toMatch(
            /#mainList > #todoMdViewerCard \.todoMdViewerRunLabel,\s*#mainList > #todoMdViewerCard \.todoMdViewerDeployPillGlyph,\s*#mainList > #todoMdViewerCard \.todoMdViewerDeployPillLabel\s*\{\s*display:\s*none;\s*\}/
        );
        expect(css).toMatch(
            /#mainList > #todoMdViewerCard \.todoMdViewerDeployPillMobileGlyph\s*\{\s*display:\s*inline-flex;\s*\}/
        );
    });

    it('places the icon-only rules inside the max-width:1023px block and above the mobile-sheet rules', () => {
        // Scoped to the inline #todoMdViewerCard launcher; the full-screen mobile
        // sheet keeps its labeled 50/50 touch targets.
        const media = css.indexOf('@media (max-width: 1023px)');
        const rocketRule = css.indexOf('#mainList > #todoMdViewerCard .todoMdViewerDeployPillMobileGlyph {');
        const sheetRule = css.indexOf('#todoMdViewerMobileSheet .todoMdViewerHeader');
        expect(media).toBeGreaterThan(-1);
        expect(rocketRule).toBeGreaterThan(media);
        expect(rocketRule).toBeLessThan(sheetRule);
    });
});
