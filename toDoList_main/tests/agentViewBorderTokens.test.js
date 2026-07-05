import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression: the Agent view's structural borders were declared as
// `var(--border, var(--accent))`, but `--border` is not a token in the
// design system, so every card/input/block fell through to `--accent`
// (#6C5DF5, purple) instead of the intended neutral hairline. The fix
// swaps those fallbacks to the real `--border-mid` token, leaving the
// deliberate `var(--accent)` borders on interactive accent controls alone.
describe('Agent view structural borders use --border-mid, not the undefined --border fallback', () => {
    const css = read('style.css');

    // Body of a top-level rule whose selector matches `selector` exactly.
    function ruleBody(selector) {
        const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp('(?:^|}|\\*/)\\s*' + escaped + '\\s*\\{([^{}]*)\\}');
        const match = css.match(re);
        if (!match) throw new Error(`Rule for "${selector}" not found`);
        return match[1];
    }

    it('has no `var(--border, …)` fallback left anywhere in the stylesheet', () => {
        // `--border` is undefined, so any such fallback resolves to its
        // second arg — the source of the purple-border bug.
        expect(css).not.toMatch(/var\(--border,/);
    });

    const structural = [
        '.agentStatusPill--idle',
        '.agentViewToast',
        '.agentCard',
        '.agentAnswerInput',
        '.agentDraftBlock',
        '.agentMockupDesignLink',
        '.agentMockupPaste',
    ];

    for (const selector of structural) {
        it(`${selector} borders with var(--border-mid)`, () => {
            const body = ruleBody(selector);
            expect(body).toMatch(/border:[^;]*var\(--border-mid\)/);
            expect(body).not.toMatch(/border:[^;]*var\(--accent\)/);
        });
    }

    // The deliberate accent borders on interactive controls must survive.
    it('keeps the accent border on interactive accent controls (e.g. .agentMockupCopy)', () => {
        expect(ruleBody('.agentMockupCopy')).toMatch(/border:[^;]*var\(--accent\)/);
    });
});
