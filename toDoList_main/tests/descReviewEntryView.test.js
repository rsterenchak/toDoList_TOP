import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
    buildReviewEntryView,
    descPanelBottomAnchor,
    DESC_PANEL_CHILD_SELECTORS,
} from '../src/toDoRow.js';

// The read-only ENTRY view the review stage mounts in the detail pane's flex-fill
// middle. After the footer-docking reflow the pane pins its trailing sections to the
// floor and lets the entry region absorb the slack — but in `accept` the authoring
// group (textarea included) is hidden, so that middle was a conspicuous void and the
// shipped entry text was nowhere readable in the pane.
//
// The block itself is instantiable in jsdom, so its contract is pinned by building
// it; the mount wiring inside syncReviewPanel (buildToDoRow is too heavily wired to
// instantiate end-to-end — see the row-layer test caveat) is source-pinned, and the
// layout contract is read from the CSS, the style the sibling panel guards use.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');
const toDoRow = read('toDoRow.js');
const css = read('style.css');

// Every top-level rule body whose (possibly comma-grouped) selector list contains
// `needle` — declarations for one child are deliberately split across a grouped rule
// and a standalone one, so "the first match" is not the answer.
function ruleBodies(source, needle) {
    const bodies = [];
    let depth = 0;
    let selectorStart = 0;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '{') {
            if (depth === 0 && source.slice(selectorStart, i).includes(needle)) {
                bodies.push(source.slice(i + 1, source.indexOf('}', i)));
            }
            depth++;
            continue;
        }
        if (c === '}') {
            depth--;
            if (depth === 0) selectorStart = i + 1;
        }
    }
    return bodies;
}

function declares(needle, decl) {
    const bodies = ruleBodies(css, needle);
    expect(bodies.length, `no rule matches ${needle}`).toBeGreaterThan(0);
    return bodies.some((body) => decl.test(body));
}

// The same walk, keeping each rule's selector beside its body — what proves a
// declaration appears ONLY under the selectors meant to carry it, rather than merely
// appearing somewhere. Comments are stripped from the selector so a preamble above an
// @media block can't be mistaken for part of one.
function topLevelRules(source) {
    const rules = [];
    let depth = 0;
    let selectorStart = 0;
    for (let i = 0; i < source.length; i++) {
        const c = source[i];
        if (c === '{') {
            if (depth === 0) {
                rules.push({
                    selector: source.slice(selectorStart, i).replace(/\/\*[\s\S]*?\*\//g, '').trim(),
                    body: source.slice(i + 1, source.indexOf('}', i)),
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

describe('review entry view — the block', () => {
    it('renders the entry text VERBATIM, newlines and indentation intact', () => {
        const desc = '- [ ] **[HIGH]** Ship it\n  - Type: feature\n  - File: a.js';
        const block = buildReviewEntryView({ desc });
        expect(block.className).toBe('descReviewEntryView');
        expect(block.querySelector('.descReviewEntryViewText').textContent).toBe(desc);
    });

    it('leads with the eyebrow naming the block as the shipped entry, read only', () => {
        const block = buildReviewEntryView({ desc: 'entry text' });
        const eyebrow = block.firstChild;
        expect(eyebrow.className).toBe('descReviewEntryViewEyebrow');
        expect(eyebrow.textContent.toLowerCase()).toContain('shipped');
        expect(eyebrow.textContent.toLowerCase()).toContain('read only');
    });

    it('is READ-ONLY by construction — a div, never a disabled textarea', () => {
        // Iterate is the change path for a shipped entry; an edit affordance here
        // (even a disabled one) would advertise a route that does not exist.
        const block = buildReviewEntryView({ desc: 'entry text' });
        expect(block.tagName).toBe('DIV');
        expect(block.querySelector('textarea')).toBeNull();
        expect(block.querySelector('input')).toBeNull();
        expect(block.querySelector('button')).toBeNull();
        expect(block.querySelector('[contenteditable]')).toBeNull();
    });

    it('mounts nothing for an empty or whitespace-only entry', () => {
        expect(buildReviewEntryView({ desc: '' })).toBeNull();
        expect(buildReviewEntryView({ desc: '   \n  ' })).toBeNull();
        expect(buildReviewEntryView({})).toBeNull();
        expect(buildReviewEntryView(null)).toBeNull();
    });
});

describe('review entry view — where it lands in the panel', () => {
    it('sits above the docked footer, in the slot the editor occupies', () => {
        const panel = document.createElement('div');
        panel.id = 'descSibling';
        const descInput = document.createElement('textarea');
        descInput.id = 'descInput';
        panel.appendChild(descInput);
        const footer = document.createElement('div');
        footer.className = 'descPanelFooter';
        panel.appendChild(footer);

        const view = buildReviewEntryView({ desc: 'entry text' });
        panel.insertBefore(view, descPanelBottomAnchor(panel));

        const order = [...panel.children].map((el) => el.className || el.id);
        expect(order.indexOf('descReviewEntryView'))
            .toBeLessThan(order.indexOf('descPanelFooter'));
        // Never inside the footer — that would ride it up off the pane floor.
        expect(footer.querySelector('.descReviewEntryView')).toBeNull();
    });

    it('is registered in the panel child grid contract and placed full-width', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descReviewEntryView');
        expect(declares('#descSibling .descReviewEntryView', /grid-column:\s*1\s*\/\s*-1\s*;/))
            .toBe(true);
    });

    it('re-asserts the hidden state its own display would otherwise outrank', () => {
        expect(declares('#descSibling .descReviewEntryView[hidden]', /display:\s*none\s*;/))
            .toBe(true);
    });
});

describe('review entry view — the pane flex contract', () => {
    it('takes the same flex-fill contract as the textarea it stands in for', () => {
        // Both later moved from basis `auto` to 0: a div has no intrinsic height, so
        // with basis auto a long shipped entry grew the block and the stack with it.
        const sel = '#descDetailPane #descSibling > .descReviewEntryView';
        expect(declares(sel, /flex:\s*1\s+1\s+0\s*;/)).toBe(true);
        expect(declares(sel, /min-height:\s*96px\s*;/)).toBe(true);
    });

    it('scrolls a long entry in place rather than growing the pane', () => {
        expect(declares('.descReviewEntryViewText', /overflow-y:\s*auto\s*;/)).toBe(true);
        expect(declares('.descReviewEntryViewText', /min-height:\s*0\s*;/)).toBe(true);
        // pre-wrap is what makes the verbatim newlines above actually render.
        expect(declares('.descReviewEntryViewText', /white-space:\s*pre-wrap\s*;/)).toBe(true);
    });

    it('leaves the footer pinned to the pane floor', () => {
        expect(declares('#descDetailPane #descSibling > .descPanelFooter', /margin-top:\s*auto\s*;/))
            .toBe(true);
    });
});

// The block shipped with `flex: 1 1 auto` on itself and `min-height: 0` on its text
// region — which reads like a clamp but never was one. `flex: 1 1 auto` only bounds a
// child when every ancestor between it and the height-bounded pane can actually give
// height back, and the panel that stacks it (#descDetailPane #descSibling) carried
// `flex: 1 0 auto`: a flex item with shrink 0 grows to its content no matter what its
// children declare. The editor stage looked exempt because a textarea has an intrinsic
// height regardless of how much text it holds, while the read-only div does not — so a
// long entry grew the panel, the PANE became the scroller instead of the text region,
// and the docked footer (Discuss / FILE / MANUAL STATUS) went below the fold, defeating
// the reflow that docked it there.
//
// Shrink was granted to the panel in review only, which left the WRITE stage on the
// same defect. It is now unscoped, and both entry regions size from a ZERO basis so
// neither can feed content height upward in any stage — see descPaneStackBasis.test.js.
describe('review entry view — the flex-clamp chain', () => {
    // The pane's own layout lives inside the ≥1024px media block, which ruleBodies
    // (top-level rules only) can't reach — pull the bare `#descDetailPane` rules out
    // directly and pick the desktop one out by its grid placement.
    const paneRule = css.split(/#descDetailPane\s*\{/).slice(1)
        .map((chunk) => chunk.slice(0, chunk.indexOf('}')))
        .find((body) => /grid-column:\s*3\s*;/.test(body)) || '';

    it('bounds the pane against its own grid track, so the chain divides a real height', () => {
        expect(paneRule).toMatch(/overflow-y:\s*auto\s*;/);
        // Without this the grid item's automatic minimum size is its content, so a tall
        // panel inflates the track instead of scrolling inside a fixed-height pane.
        expect(paneRule).toMatch(/min-height:\s*0\s*;/);
    });

    it('lets the panel shrink back to the pane — what actually docks the footer', () => {
        expect(declares('#descDetailPane #descSibling', /flex:\s*1\s+1\s+auto\s*;/)).toBe(true);
        expect(declares('#descDetailPane #descSibling', /min-height:\s*0\s*;/)).toBe(true);
    });

    it('grants that shrink in every stage, not review alone', () => {
        // Superseded: the shrink was once scoped to `:has(> .descReviewEntryView)`, on
        // the reasoning that the authoring stages stack blocks with no internal
        // scrollers and would be crushed. That left WRITE on the original defect, and
        // the zero-basis entry region now absorbs the compression instead — every other
        // child keeps min-height: auto, so the dynamic blocks still render in full.
        const scoped = topLevelRules(css).filter(
            (r) => r.selector.includes('#descSibling:has(> .descReviewEntryView'));
        expect(scoped.map((r) => r.selector)).toEqual([]);
    });

    it('makes the block a clamped frame rather than one that grows to its text', () => {
        expect(declares('.descReviewEntryView', /flex-direction:\s*column\s*;/)).toBe(true);
        expect(declares('.descReviewEntryView', /overflow:\s*hidden\s*;/)).toBe(true);
    });

    it('leaves the text region the SOLE scroller, with the eyebrow pinned above it', () => {
        // Basis 0, not auto: the region grows from nothing into its share of the block
        // instead of starting at its full content height and shrinking back.
        expect(declares('.descReviewEntryViewText', /flex:\s*1\s+1\s+0\s*;/)).toBe(true);
        expect(declares('.descReviewEntryViewText', /min-height:\s*0\s*;/)).toBe(true);
        expect(declares('.descReviewEntryViewText', /overflow-y:\s*auto\s*;/)).toBe(true);
        expect(declares('.descReviewEntryViewText', /-webkit-overflow-scrolling:\s*touch\s*;/))
            .toBe(true);
        expect(declares('.descReviewEntryViewEyebrow', /flex:\s*0\s+0\s+auto\s*;/)).toBe(true);
    });
});

describe('review entry view — lifecycle mirrors the review card', () => {
    const start = toDoRow.indexOf('function syncReviewPanel(');
    const body = toDoRow.slice(start, toDoRow.indexOf('\n}', start));

    it('is mounted by the same accept-phase branch that inserts the review card', () => {
        expect(body).toMatch(/buildReviewEntryView\(item\)/);
        // Above the docked footer, not appended past it.
        expect(body).toMatch(/insertBefore\(entryView,\s*descPanelBottomAnchor\(panel\)\)/);
        expect(body.indexOf('buildReviewBlock('))
            .toBeLessThan(body.indexOf('buildReviewEntryView('));
    });

    it('guards the empty case rather than mounting an empty frame', () => {
        expect(body).toMatch(/if \(entryView\) panel\.insertBefore\(entryView/);
    });

    it('is torn down whenever the review card is, leaving no orphan in other phases', () => {
        expect(body).toMatch(/querySelector\('\.descReviewEntryView'\)/);
        // The non-accept branch removes it alongside the card and the action row …
        const teardown = body.slice(body.indexOf('if (!wantReview)'), body.indexOf('const entryKey'));
        expect(teardown).toMatch(/existingEntryView\.remove\(\)/);
        // … and a re-mount for a DIFFERENT entry clears the previous one first, so a
        // repaint can never stack two entry views in the panel.
        const remount = body.slice(body.indexOf('const entryKey'));
        expect(remount).toMatch(/if \(existingEntryView\) existingEntryView\.remove\(\)/);
    });

    it('is NOT swept into the authoring group applyPhaseLayout hides', () => {
        // The group is hidden in exactly the two phases (`done`, `accept`) this block
        // needs to be visible in — sweeping it in would hide it the moment it mounts.
        const groupStart = toDoRow.indexOf('DESC_AUTHORING_GROUP_SELECTORS = Object.freeze([');
        const group = toDoRow.slice(groupStart, toDoRow.indexOf(']', groupStart));
        expect(group).not.toMatch(/descReviewEntryView/);
    });
});
