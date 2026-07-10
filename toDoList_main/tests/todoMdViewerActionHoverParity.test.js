import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Strip /* ... */ comments so selector mentions inside comments can't be
// mistaken for real rules.
function stripComments(css) {
    return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

// Returns the normalized declarations (lowercased, whitespace-collapsed,
// trailing-semicolon-stripped) of the rule block whose selector text is exactly
// `selector`, or null if no such rule exists. Operates on comment-stripped CSS.
function declarationsFor(rawCss, selector) {
    const css = stripComments(rawCss);
    const re = new RegExp(
        `(?:^|})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`
    );
    const match = css.match(re);
    if (!match) return null;
    return match[1]
        .split(';')
        .map((d) => d.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean)
        .sort();
}

// The TODO.md viewer's three action controls — Run backlog
// (.todoMdViewerRunBtn), Run this entry (.todoMdViewerRunEntryBtn), and
// Redeploy (.todoMdViewerDeployPill) — must share ONE hover affordance so they
// can never drift apart. The unification is a single shared rule keyed on the
// .todoMdViewerActionBtn marker class, which all three carry in the markup.
describe('TODO.md viewer action-button hover unification', () => {
    const css = read('style.css');
    const js = read('todoMdViewer.js');

    it('defines exactly one shared hover rule with the Option A treatment', () => {
        const shared = declarationsFor(css, '.todoMdViewerActionBtn:hover:not(:disabled)');
        expect(shared).toEqual(
            [
                'background: var(--bg-elevated)',
                'color: var(--text-primary)',
                'border-color: var(--accent)',
            ].sort()
        );
    });

    it('all three action buttons carry the shared marker class in the markup', () => {
        // Run backlog + Run this entry set className to a literal string.
        expect(js).toMatch(/todoMdViewerRunBtn todoMdViewerActionBtn/);
        expect(js).toMatch(/todoMdViewerRunEntryBtn todoMdViewerActionBtn/);
        // The deploy pill is rebuilt on every state change; the marker class must
        // survive that reassignment, so it appears in the renderDeployPill template.
        expect(js).toMatch(/todoMdViewerDeployPill todoMdViewerActionBtn todoMdViewerDeployPill--/);
    });

    it('no per-button hover rule survives to diverge from the shared one', () => {
        expect(declarationsFor(css, '.todoMdViewerRunBtn:hover')).toBeNull();
        expect(declarationsFor(css, '.todoMdViewerRunBtn--idle:hover')).toBeNull();
        expect(declarationsFor(css, '.todoMdViewerRunEntryBtn:hover:not(:disabled)')).toBeNull();
        expect(declarationsFor(css, '.todoMdViewerDeployPill--idle:hover')).toBeNull();
    });

    it('the failed-publish pill still overrides the shared hover to stay red', () => {
        const failure = declarationsFor(css, '.todoMdViewerDeployPill--failure:hover');
        // Must neutralize the shared background and keep the danger color/border.
        expect(failure).toContain('background: transparent');
        expect(failure).toContain('color: var(--text-danger)');
        expect(failure).toContain('border-color: var(--text-danger)');
    });
});
