import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Regression: in the desktop detail pane a long entry still pushed the docked footer
// (filter through MANUAL STATUS) below the fold and turned the whole pane into a
// scroller, even after the editor-fill work landed. The missing piece was the flex
// BASIS, not another clamp:
//
//   • The entry region — the WRITE-stage textarea and the review stage's read-only
//     .descReviewEntryView — carried `flex: 1 1 auto`. With basis `auto` a flex
//     child's hypothetical main size is its CONTENT, so as the entry grew the child
//     fed that height back up the stack.
//   • The panel that stacks them carried `flex: 1 0 auto` — shrink 0, so it could
//     never hand that height back to the pane and simply grew past it.
//   • The pane's legacy `overflow-y: auto` (written when the pane WAS the scroll
//     container) then engaged, and the footer sank with the overflow.
//
// The docked-footer contract and the pane-as-scroller contract are mutually
// exclusive, so the entry region now sizes purely from distributed slack (basis 0,
// never from content) and the panel can shrink back to the pane. The pane keeps
// `overflow-y: auto` solely as the degenerate-window safety net.
//
// Every assertion here reads the shipped CSS, the style the sibling pane guards use.

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Every top-level rule, selector beside body — what proves a declaration appears
// only under the selectors meant to carry it, rather than merely somewhere.
function topLevelRules(source) {
    const rules = [];
    let depth = 0;
    let selectorStart = 0;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '{') {
            if (depth === 0) {
                const close = source.indexOf('}', i);
                rules.push({
                    selector: source.slice(selectorStart, i).trim(),
                    body: source.slice(i + 1, close),
                });
            }
            depth++;
            continue;
        }
        if (c === '}') {
            depth--;
            if (depth === 0) selectorStart = i + 1;
        }
    }
    return rules;
}

const rules = topLevelRules(css);

function bodies(needle) {
    const matched = rules.filter((r) => r.selector.includes(needle)).map((r) => r.body);
    expect(matched.length, `no rule matches ${needle}`).toBeGreaterThan(0);
    return matched;
}

function declares(needle, decl) {
    return bodies(needle).some((body) => decl.test(body));
}

const PANE_PANEL = '#descDetailPane #descSibling';
const PANE_TEXTAREA = '#descDetailPane #descSibling > #descInput';
const PANE_REVIEW = '#descDetailPane #descSibling > .descReviewEntryView';

describe('detail pane stack — the entry region sizes from slack, never from content', () => {
    it('gives the WRITE-stage textarea a zero basis so its content cannot inflate the stack', () => {
        expect(declares(PANE_TEXTAREA, /flex:\s*1\s+1\s+0\s*;/)).toBe(true);
        expect(declares(PANE_TEXTAREA, /flex:\s*1\s+1\s+auto\s*;/)).toBe(false);
    });

    it('keeps the textarea floor and its internal scroller', () => {
        expect(declares(PANE_TEXTAREA, /min-height:\s*96px\s*;/)).toBe(true);
        expect(declares(PANE_TEXTAREA, /overflow-y:\s*auto\s*;/)).toBe(true);
    });

    it('gives the review-stage entry view the same zero basis', () => {
        expect(declares(PANE_REVIEW, /flex:\s*1\s+1\s+0\s*;/)).toBe(true);
        expect(declares(PANE_REVIEW, /flex:\s*1\s+1\s+auto\s*;/)).toBe(false);
    });

    it('keeps the review view floor and leaves its text region the sole scroller', () => {
        expect(declares(PANE_REVIEW, /min-height:\s*96px\s*;/)).toBe(true);
        expect(declares('.descReviewEntryViewText', /flex:\s*1\s+1\s+0\s*;/)).toBe(true);
        expect(declares('.descReviewEntryViewText', /min-height:\s*0\s*;/)).toBe(true);
        expect(declares('.descReviewEntryViewText', /overflow-y:\s*auto\s*;/)).toBe(true);
    });
});

describe('detail pane stack — the panel spans the pane and can hand height back', () => {
    it('stacks the panel as a full-height flex column', () => {
        expect(declares(PANE_PANEL, /display:\s*flex\s*;/)).toBe(true);
        expect(declares(PANE_PANEL, /flex-direction:\s*column\s*;/)).toBe(true);
    });

    it('lets the panel shrink back to the pane, so the footer pins to the PANE floor', () => {
        expect(declares(PANE_PANEL, /flex:\s*1\s+1\s+auto\s*;/)).toBe(true);
        expect(declares(PANE_PANEL, /min-height:\s*0\s*;/)).toBe(true);
    });

    it('never reintroduces shrink 0 on the panel — the basis that fed the overflow', () => {
        // Guards the whole stylesheet, not just the rule the fix edits: a shrink-0
        // panel anywhere in the pane's cascade restores the defect wholesale.
        const shrinkZero = rules.filter((r) => r.selector.includes(PANE_PANEL)
            && !r.selector.includes('>')
            && (/flex:\s*\d+\s+0\s+/.test(r.body) || /flex-shrink:\s*0\s*;/.test(r.body)));
        expect(shrinkZero.map((r) => r.selector)).toEqual([]);
    });

    it('applies the shrink to every stage, not only review', () => {
        // It shipped scoped to `:has(> .descReviewEntryView)` while the authoring
        // stages kept shrink 0 — which is exactly why the WRITE stage still pushed
        // the footer down. The zero-basis entry region now absorbs the compression
        // in every stage, so the scoped exception is gone.
        const scoped = rules.filter((r) => r.selector.includes('#descSibling:has(> .descReviewEntryView'));
        expect(scoped.map((r) => r.selector)).toEqual([]);
    });

    it('keeps the footer docked by auto margin', () => {
        expect(declares('#descDetailPane #descSibling > .descPanelFooter', /margin-top:\s*auto\s*;/))
            .toBe(true);
    });
});

describe('detail pane stack — the pane keeps its degenerate-window safety net', () => {
    // The pane's own layout lives inside the ≥1024px media block, which the
    // top-level walk can't reach — pull the bare `#descDetailPane` rules out
    // directly and pick the desktop one by its grid placement.
    const paneRule = css.split(/#descDetailPane\s*\{/).slice(1)
        .map((chunk) => chunk.slice(0, chunk.indexOf('}')))
        .find((body) => /grid-column:\s*3\s*;/.test(body)) || '';

    it('bounds the pane against its own grid track so the stack divides a real height', () => {
        expect(paneRule).toMatch(/min-height:\s*0\s*;/);
    });

    it('retains overflow-y: auto for the window too short for the floors and the footer', () => {
        expect(paneRule).toMatch(/overflow-y:\s*auto\s*;/);
    });
});
