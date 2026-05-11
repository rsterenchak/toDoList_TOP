import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { updateEmptyState } from '../src/emptyState.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK mobile NO TODOS YET ordering: the dashed empty-state
// input renders at the TOP of the empty pane with the gray ghost mascot
// and the dotted up-arrow below it, so the arrow visually anchors to
// the input it's pointing up at. Desktop preserves the historical
// [icon, title, sub, input] layout via a CSS `order: 99` rule on the
// input — both behaviors share one DOM, layout-driven swap per
// CLAUDE.md's "no inline styles" guidance.
describe('STACK mobile NO TODOS YET source order', () => {

    function makeMainList() {
        document.body.innerHTML = '';
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        document.body.appendChild(mainList);
        return mainList;
    }

    function addCommittedRow(mainList, value, completed) {
        const row = document.createElement('div');
        row.id = 'toDoChild';
        if (completed) row.classList.add('completed');
        const input = document.createElement('input');
        input.id = 'toDoInput';
        input.value = value;
        row.appendChild(input);
        mainList.appendChild(row);
    }

    function classOf(el) {
        // The block builds two mascot classes ("emptyStateMascot
        // emptyStateMascotGray") — return the variant identifier we care
        // about so positional assertions don't depend on whitespace or
        // class order.
        if (!el) return null;
        if (el.classList.contains('emptyStateMascot')) return 'mascot';
        if (el.classList.contains('emptyStateIcon')) return 'icon';
        if (el.classList.contains('emptyStateUpArrow')) return 'upArrow';
        if (el.classList.contains('emptyStateTitle')) return 'title';
        if (el.classList.contains('emptyStateSub')) return 'sub';
        if (el.id === 'emptyStateInput') return 'input';
        return el.id || el.className || el.tagName;
    }

    it('renders the input as the first child of the no-todos empty-state block', () => {
        const mainList = makeMainList();
        addCommittedRow(mainList, '', false);
        updateEmptyState(mainList);

        const block = mainList.querySelector('#emptyState.emptyStateNoTodos');
        expect(block).not.toBeNull();

        const order = Array.from(block.children).map(classOf);
        // The mobile-correct source order: input first, then mascot, icon,
        // up-arrow, title, sub. On desktop the input is pushed to the
        // bottom via CSS `order: 99`; mobile resets that to keep the
        // natural source order. Desktop layout is verified by the CSS
        // assertion below.
        expect(order).toEqual(['input', 'mascot', 'icon', 'upArrow', 'title', 'sub']);
    });

    it('keeps the all-caught-up variant input at the bottom of the block', () => {
        const mainList = makeMainList();
        addCommittedRow(mainList, 'finished task', true);
        addCommittedRow(mainList, '', false);
        updateEmptyState(mainList);

        const block = mainList.querySelector('#emptyState.emptyStateAllCaughtUp');
        expect(block).not.toBeNull();

        // The all-caught-up variant is unchanged by the no-todos reorder
        // — sparkles flow with the mascot, and the input stays at the
        // bottom of the block in source order.
        const order = Array.from(block.children).map(classOf);
        expect(order[0]).toBe('mascot');
        expect(order[order.length - 1]).toBe('input');
    });

    it('preserves the dashed accent border CSS on the empty-state input', () => {
        // The previous corrective entry added a dashed accent border to
        // the empty-state input on mobile NO TODOS YET; this reorder
        // must not strip that styling.
        const css = read('style.css');
        expect(css).toMatch(/#emptyState\.emptyStateNoTodos\s+#emptyStateInput\s*\{[^}]*border-style:\s*dashed/);
        expect(css).toMatch(/#emptyState\.emptyStateNoTodos\s+#emptyStateInput\s*\{[^}]*border-color:\s*var\(--accent\)/);
    });

    describe('CSS order-based desktop layout', () => {
        const css = read('style.css');

        it('pushes the no-todos input to the bottom of the desktop flex column with order: 99', () => {
            // Outside the mobile media block the input gets `order: 99` so
            // the visible desktop layout stays [icon, title, sub, input]
            // even though it appears first in source.
            expect(css).toMatch(
                /#emptyState\.emptyStateNoTodos\s+#emptyStateInput\s*\{[^}]*order:\s*99/
            );
        });

        it('resets the input order inside the ≤700px media block so mobile gets natural source order', () => {
            // The mobile-scoped reset is required: without it, the desktop
            // `order: 99` rule would also apply on mobile and re-push the
            // input back to the bottom — defeating the whole point of the
            // reorder.
            const mobileBlockMatch = css.match(/@media\s*\(max-width:\s*700px\)\s*\{([\s\S]*)$/);
            expect(mobileBlockMatch).not.toBeNull();
            const mobileBlock = mobileBlockMatch[1];
            expect(mobileBlock).toMatch(
                /#emptyState\.emptyStateNoTodos\s+#emptyStateInput\s*\{[^}]*order:\s*0/
            );
        });
    });
});
