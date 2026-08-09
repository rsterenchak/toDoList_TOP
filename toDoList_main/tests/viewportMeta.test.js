import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../src/template.html'), 'utf8');

// Locks the viewport meta's content string. Two facts are load-bearing and
// neither is obvious from reading the shell:
//   - viewport-fit=cover opts the document into env(safe-area-inset-*), which
//     the mobile tab bar and bottom sheets rely on to paint flush to the edge.
//   - interactive-widget must stay absent. It was probed for the iOS
//     keyboard-shrink bug and found ignored by the standalone container, so
//     re-adding it would only risk a silent behavior change on a future iOS
//     that honors it — putting bottom-anchored inputs behind the keyboard.
// Both are single-line edits that a formatter or an unrelated head change can
// silently flip, so pin them here.
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

    it('carries no interactive-widget directive', () => {
        expect(meta[0]).not.toMatch(/interactive-widget/);
    });

    it('retains the baseline width and initial-scale directives', () => {
        expect(meta[0]).toMatch(/width\s*=\s*device-width/);
        expect(meta[0]).toMatch(/initial-scale\s*=\s*1/);
    });
});
