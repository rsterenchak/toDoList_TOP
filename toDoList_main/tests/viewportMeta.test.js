import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../src/template.html'), 'utf8');

// Locks the viewport meta's content string. Two attributes are load-bearing
// and neither is obvious from reading the shell:
//   - viewport-fit=cover opts the document into env(safe-area-inset-*), which
//     the mobile tab bar and bottom sheets rely on to paint flush to the edge.
//   - interactive-widget=resizes-visual is the probe for the iOS keyboard
//     shrink bug — it asks the browser to resize only the visual viewport for
//     the software keyboard, leaving the layout viewport (innerHeight) alone.
// Both are single-line edits that a formatter or an unrelated head change can
// silently drop, so pin them here.
describe('viewport meta', () => {
    const meta = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/i);

    it('template.html declares exactly one viewport meta', () => {
        expect(meta).not.toBeNull();
        const all = html.match(/<meta[^>]+name=["']viewport["'][^>]*>/gi) || [];
        expect(all.length).toBe(1);
    });

    it('keeps viewport-fit=cover so env() safe-area insets resolve', () => {
        expect(meta[0]).toMatch(/viewport-fit\s*=\s*cover/);
    });

    it('carries interactive-widget=resizes-visual for the keyboard probe', () => {
        expect(meta[0]).toMatch(/interactive-widget\s*=\s*resizes-visual/);
    });

    it('retains the baseline width and initial-scale directives', () => {
        expect(meta[0]).toMatch(/width\s*=\s*device-width/);
        expect(meta[0]).toMatch(/initial-scale\s*=\s*1/);
    });
});
