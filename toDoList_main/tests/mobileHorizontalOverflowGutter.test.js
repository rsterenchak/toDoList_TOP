import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Mobile horizontal overflow: on narrow phones the 12px side padding on the
// status-filter / Sort row (#taskFilterBar) and the 8px side margins on todo
// rows (#toDoChild) and their attached drawers (#descSibling, #statsSibling)
// pushed the Sort control and the right edge of each row past the viewport,
// where #mainBar / #mainList's overflow:hidden clipped them off-screen. The fix
// tightens both gutters to ~4px inside the phone breakpoint so all row content
// and the Sort control fit without horizontal scrolling, while desktop layout
// (≥1024px) is left completely unchanged. These tests pin that CSS.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Walk every `@media (max-width: 480px)` block and return the comment-stripped
// body of the first one whose declarations mention `needle`. Same naive
// brace-matching parse as the other mobile-layout tests in this suite.
function media480BlockContaining(needle) {
    let idx = 0;
    while ((idx = css.indexOf('@media (max-width: 480px)', idx)) !== -1) {
        const start = css.indexOf('{', idx);
        let depth = 0;
        let end = css.length;
        for (let i = start; i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        const body = css.slice(start + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
        if (body.includes(needle)) return body;
        idx = end;
    }
    return null;
}

function rule(body, selector) {
    // Allow `selector` to appear anywhere in a (possibly grouped) selector list,
    // e.g. `#descSibling, #statsSibling { ... }`, by tolerating other selectors
    // between it and the opening brace.
    const re = new RegExp(selector.replace(/[#.]/g, m => '\\' + m) + '[^{}]*\\{([^}]*)\\}');
    const m = body.match(re);
    return m ? m[1] : null;
}

describe('mobile horizontal overflow — tightened gutters at ≤480px', () => {
    const block = media480BlockContaining('#taskFilterBar');

    it('declares the gutter fix inside a phone @media block', () => {
        expect(block).not.toBeNull();
    });

    it('tightens the Sort/filter bar side padding to 4px', () => {
        const decl = rule(block, '#taskFilterBar');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/padding-left:\s*4px/);
        expect(decl).toMatch(/padding-right:\s*4px/);
    });

    it('tightens todo row side margins to 4px', () => {
        const decl = rule(block, '#toDoChild');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/margin-left:\s*4px/);
        expect(decl).toMatch(/margin-right:\s*4px/);
    });

    it('keeps the attached drawers aligned with the tightened rows', () => {
        // #descSibling / #statsSibling visually attach to the bottom of their
        // row, so their side gutter must match #toDoChild's new 4px or they
        // would overhang the row edges.
        const desc = rule(block, '#descSibling');
        const stats = rule(block, '#statsSibling');
        expect(desc).not.toBeNull();
        expect(stats).not.toBeNull();
        expect(desc).toMatch(/margin-left:\s*4px/);
        expect(desc).toMatch(/margin-right:\s*4px/);
        expect(stats).toMatch(/margin-left:\s*4px/);
        expect(stats).toMatch(/margin-right:\s*4px/);
    });
});

describe('mobile horizontal overflow — desktop gutters untouched', () => {
    it('leaves the base Sort/filter bar padding at its wider desktop value', () => {
        // The base rule (applied at desktop widths) keeps its 12px side padding;
        // only the ≤480px override tightens it.
        const m = css.match(/#taskFilterBar\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        expect(m[1]).toMatch(/padding:\s*8px\s+12px\s+6px/);
    });

    it('leaves the base todo row side margin at 8px', () => {
        const m = css.match(/#toDoChild\s*\{([\s\S]*?)\}/);
        expect(m).not.toBeNull();
        expect(m[1]).toMatch(/margin:\s*5px\s+8px/);
    });
});
