import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression guard for the mobile Claude launcher overlapping the TODO.md
// viewer card's header controls. On mobile the launcher FAB is fixed at
// `bottom: 56px; right: 18px`; when a repo-backed project's inline viewer card
// mounts at the bottom of the task list, its collapse / overflow buttons land
// directly beneath the FAB and become untappable. The fix gives the task list
// extra bottom padding while the card is present so the user can scroll the
// viewer's header row clear of the FAB, via a `:has()` selector that needs no
// JS. These tests pin the invariant: the padding rule must live in the mobile
// media query, must be gated on the viewer card being present, and must add
// enough `padding-bottom` to scroll past the FAB (the FAB height plus its base
// 56px offset plus a clearance gap, ~100px).
describe('mobile Claude launcher clears the TODO.md viewer', () => {
    const css = read('style.css');
    const viewerSrc = read('todoMdViewer.js');

    // The id the inline viewer card is actually rendered with, read from the
    // factory (`card.id = 'todoMdViewerCard'`). Cross-checking against this
    // means a rename of either side without the other fails the test rather
    // than silently missing the element the lift rule depends on.
    function renderedViewerCardId() {
        const fn = viewerSrc.match(/function\s+buildTodoMdViewerCard\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        expect(fn, 'expected a buildTodoMdViewerCard factory in todoMdViewer.js').toBeTruthy();
        const m = fn[1].match(/\.id\s*=\s*['"]([^'"]+)['"]/);
        expect(m, 'expected buildTodoMdViewerCard to assign an id literal').toBeTruthy();
        return m[1];
    }

    // Concatenated text of every `@media (max-width: 1023px)` block. The
    // padding must be gated to mobile (the launcher is replaced by the
    // persistent desktop chat pane at ≥1024px), so the rule must live in one of
    // these.
    function mobileMediaText() {
        let out = '';
        let cursor = 0;
        while (true) {
            const media = css.indexOf('@media (max-width: 1023px)', cursor);
            if (media === -1) break;
            let depth = 0;
            let end = css.length;
            for (let i = css.indexOf('{', media); i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) { end = i + 1; break; }
                }
            }
            out += css.slice(media, end) + '\n';
            cursor = end;
        }
        return out;
    }

    // The lone rule whose selector both is gated on the viewer card via :has()
    // and targets #mainList. Returns { selector, body } or null.
    function paddingRule(haystack) {
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const re = /([^{}]*#mainList[^{}]*)\{([^}]*)\}/g;
        let m;
        while ((m = re.exec(stripped)) !== null) {
            const selector = m[1];
            if (/:has\([^)]*todoMdViewerCard[^)]*\)/.test(selector)) {
                return { selector: selector.trim(), body: m[2] };
            }
        }
        return null;
    }

    it('renders the viewer card with the id the padding rule targets', () => {
        const id = renderedViewerCardId();
        expect(id).toBe('todoMdViewerCard');
        expect(css.includes('#' + id)).toBe(true);
    });

    it('pads the task list while the viewer card is present, inside the mobile media query', () => {
        const id = renderedViewerCardId();
        const rule = paddingRule(mobileMediaText());
        expect(rule, 'expected a #mainList padding rule gated on the viewer card inside @media (max-width: 1023px)').toBeTruthy();
        // The gate must reference the actual rendered card id, not a stale name.
        expect(rule.selector.includes(id)).toBe(true);
    });

    it('adds bottom padding deep enough to scroll the viewer header clear of the FAB (~100px)', () => {
        const rule = paddingRule(mobileMediaText());
        expect(rule, 'expected a viewer-gated #mainList padding rule').toBeTruthy();
        const m = rule.body.match(/padding-bottom\s*:\s*(\d+)px/);
        expect(m, 'expected the padding rule to set a px padding-bottom').toBeTruthy();
        const padding = parseInt(m[1], 10);
        // Must let the user scroll past the FAB: at least the launcher's base
        // 56px offset plus its height so the header row clears it.
        expect(padding).toBeGreaterThan(56);
        expect(padding).toBeGreaterThanOrEqual(100);
    });

    it('no longer lifts the launcher via a viewer-gated bottom offset', () => {
        // The old approach raised #claudeLauncher's `bottom` while the card was
        // present; the padding approach supersedes it, so no viewer-gated
        // launcher lift rule should remain.
        const stripped = mobileMediaText().replace(/\/\*[\s\S]*?\*\//g, '');
        const re = /([^{}]*#claudeLauncher[^{}]*)\{([^}]*)\}/g;
        let m;
        while ((m = re.exec(stripped)) !== null) {
            if (/:has\([^)]*todoMdViewerCard[^)]*\)/.test(m[1])) {
                throw new Error('found a viewer-gated #claudeLauncher lift rule; expected it replaced by #mainList padding');
            }
        }
    });
});
