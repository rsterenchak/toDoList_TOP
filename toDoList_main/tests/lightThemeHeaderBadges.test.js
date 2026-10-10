import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression for: dark-mode colors leaking into the light theme. The mobile
// project header (≤1023px Variant C block) hardcoded a near-black #15151e bar,
// and the Runs-tab status badges hardcoded dark-only hex tints with no light
// override, so both stayed dark-on-light. Both now derive from theme tokens:
// the header from --bg-elevated, each badge from a per-status --c mixed via
// color-mix() against --bg-elevated / --text-primary. CSS-only fix.
describe('light theme: mobile project header and Claude run badges', () => {
    const css = read('style.css');

    function denseBlock() {
        const start = css.indexOf('── Dense left-aligned mobile header (Variant C)');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('App-root safe-area paint', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    // Body of the first rule whose selector matches `selector` exactly.
    function ruleBody(source, selector) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(?:^|}|\\*/)\\s*' + escaped + '\\s*\\{([^{}]*)\\}');
        const match = source.match(re);
        if (!match) throw new Error(`Rule for "${selector}" not found`);
        return match[1];
    }

    it('paints the mobile project header from the themed elevated surface', () => {
        const header = ruleBody(denseBlock(), '#mobileProjHeader');
        expect(header).toMatch(/background:\s*var\(--bg-elevated\)/);
        expect(header).not.toMatch(/#15151e/i);
        expect(header).toMatch(/position:\s*relative/);
    });

    const statuses = {
        shipped: 'var(--type-feature)',
        queued: 'var(--text-secondary)',
        failed: 'var(--text-danger)',
        unconfirmed: 'var(--text-warning)',
        nochange: 'var(--text-muted)',
        awaiting: 'var(--accent)',
    };

    it.each(Object.entries(statuses))('drives the %s badge from a themed --c with no hex tints', (status, token) => {
        const body = ruleBody(css, `.claudeRunBadge--${status}`);
        expect(body).toMatch(new RegExp('--c:\\s*' + token.replace(/[()]/g, '\\$&')));
        expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    });

    it('derives badge background, border and text from --c via color-mix', () => {
        const css1 = css.replace(/\s+/g, ' ');
        expect(css1).toMatch(/background:\s*color-mix\(in srgb, var\(--c\) 14%, var\(--bg-elevated\)\)/);
        expect(css1).toMatch(/border-color:\s*color-mix\(in srgb, var\(--c\) 45%, transparent\)/);
        expect(css1).toMatch(/color:\s*color-mix\(in srgb, var\(--c\) 75%, var\(--text-primary\)\)/);
    });
});
