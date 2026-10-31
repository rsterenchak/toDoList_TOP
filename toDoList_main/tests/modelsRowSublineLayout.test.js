// Regression: a Models panel row's subline (e.g. ESCALATE's "second triage pass
// for rows the sweep couldn't root-cause") used to sit on the same flex line as
// the model chip with `flex: 0 0 auto`, so it never shrank and squeezed the chip
// until the model name ellipsized. The row is now a grid: chip wrap on line one,
// subline stacked beneath it in the same column, so the subline can't take
// width from the chip. jsdom has no layout engine, so the contract is pinned on
// the stylesheet rules plus the rendered DOM order.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

function rule(selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp('(^|\\n)' + escaped + '\\s*\\{([^}]*)\\}'));
    expect(match, selector + ' rule exists').not.toBeNull();
    return match[2];
}

function decl(body, prop) {
    const match = body.match(new RegExp('(^|[;\\s])' + prop + '\\s*:\\s*([^;]+);'));
    return match ? match[2].trim() : null;
}

describe('Models panel row layout keeps the subline off the chip line', () => {
    it('lays the row out as an 8px / 62px / 1fr grid', () => {
        const row = rule('.modelsRow');
        expect(decl(row, 'display')).toBe('grid');
        expect(decl(row, 'grid-template-columns')).toBe('8px 62px minmax(0, 1fr)');
        expect(decl(row, 'padding')).toBe('8px 14px');
    });

    it('stacks the subline on its own line under the chip wrap', () => {
        const sub = rule('.modelsRowSubline');
        expect(decl(sub, 'grid-row')).toBe('2');
        expect(decl(sub, 'grid-column')).toBe('3');
        // The old `flex: 0 0 auto` is what let the subline refuse to shrink and
        // starve the chip; it must not come back.
        expect(decl(sub, 'flex')).toBeNull();
        const wrap = rule('.modelsRowChipWrap');
        expect(decl(wrap, 'grid-row')).toBe('1');
        expect(decl(wrap, 'grid-column')).toBe('3');
    });

    it('keeps the dot, label and lock on the first line', () => {
        expect(decl(rule('.modelsRowDot'), 'grid-row')).toBe('1');
        expect(decl(rule('.modelsRowLabel'), 'grid-row')).toBe('1');
        const lock = rule('.modelsRowLock');
        expect(decl(lock, 'grid-row')).toBe('1');
        expect(decl(lock, 'grid-column')).toBe('4');
    });
});
