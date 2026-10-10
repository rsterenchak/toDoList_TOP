import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Pins the task filter pill theming: the desktop phase pills and the mobile
// cycle pill take their fill and border from theme tokens in the base rules,
// so light theme no longer renders near-black pills. Unselected pills sit on
// --bg-elevated; the selected pill lifts to --bg-raised so the two differ.
function ruleBody(selector) {
    const re = new RegExp(
        '(^|\\n)' + selector.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}'
    );
    const m = css.match(re);
    expect(m).not.toBeNull();
    return m[2];
}

describe.each(['.taskPhaseFilterPill', '.taskFilterPill'])('%s theming', (pill) => {
    it('unselected pill uses theme tokens, not hardcoded dark hex', () => {
        const body = ruleBody(pill);
        expect(body).toMatch(/background:\s*var\(--bg-elevated\)/);
        expect(body).toMatch(/border:\s*0\.5px solid var\(--border-dim\)/);
        expect(body).toMatch(/color:\s*var\(--text-muted\)/);
        expect(body).not.toMatch(/#15151e|#2a2a3a/i);
    });

    it('selected pill lifts to --bg-raised and keeps accent text and bright border', () => {
        const body = ruleBody(pill + '.selected');
        expect(body).toMatch(/background:\s*var\(--bg-raised\)/);
        expect(body).toMatch(/color:\s*var\(--accent-text\)/);
        expect(body).toMatch(/border-color:\s*var\(--border-bright\)/);
    });

    it('has no light-only override', () => {
        const re = new RegExp(':root\\[data-theme="light"\\][^{]*' + pill.replace('.', '\\.'));
        expect(css).not.toMatch(re);
    });
});
