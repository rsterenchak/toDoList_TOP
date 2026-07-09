import { showProjectContextMenu, hideProjectContextMenu } from '../src/projectMenu.js';

// The project right-click/long-press context menu (#projContextMenu) is now a
// real ARIA menu: role="menu" on the container, role="menuitem" + roving
// tabindex on every interactive entry (Edit, each color swatch, Delete), Up/Down
// arrow movement with wraparound, Enter/Space to activate the focused item, and
// Escape to close. projectMenu.js imports only listLogic, so — unlike main.js —
// it runs whole in jsdom and these tests drive the REAL menu DOM.
describe('project context menu keyboard navigation', () => {
    let onEdit, onDelete, onSelect;

    function open() {
        onEdit = vi.fn();
        onDelete = vi.fn();
        onSelect = vi.fn();
        showProjectContextMenu(10, 10, onEdit, onDelete, {
            currentColor: null,
            onSelect,
        });
        return document.getElementById('projContextMenu');
    }

    function items(menu) {
        return Array.prototype.slice.call(menu.querySelectorAll('[role="menuitem"]'));
    }

    function press(key) {
        const menu = document.getElementById('projContextMenu');
        // Arrow / Enter / Space are handled by the listener on the menu node;
        // Escape by the document-level capture listener.
        const target = key === 'Escape' ? document : menu;
        target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    }

    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        hideProjectContextMenu();
    });

    it('marks the container as role=menu and every interactive entry as role=menuitem', () => {
        const menu = open();
        expect(menu.getAttribute('role')).toBe('menu');
        const its = items(menu);
        // Edit + 7 swatches (reset + 6 colors) + Delete = 9
        expect(its.length).toBe(9);
        expect(its[0].textContent).toBe('Edit');
        expect(its[its.length - 1].textContent).toBe('Delete');
    });

    it('focuses the first item on open with a roving tabindex (only the focused item is tabbable)', () => {
        const menu = open();
        const its = items(menu);
        expect(document.activeElement).toBe(its[0]);
        expect(its[0].getAttribute('tabindex')).toBe('0');
        its.slice(1).forEach((it) => expect(it.getAttribute('tabindex')).toBe('-1'));
    });

    it('ArrowDown moves focus to the next item and keeps exactly one item tabbable', () => {
        const menu = open();
        const its = items(menu);
        press('ArrowDown');
        expect(document.activeElement).toBe(its[1]);
        expect(its[1].getAttribute('tabindex')).toBe('0');
        expect(its[0].getAttribute('tabindex')).toBe('-1');
    });

    it('ArrowUp from the first item wraps to the last item', () => {
        const menu = open();
        const its = items(menu);
        press('ArrowUp');
        expect(document.activeElement).toBe(its[its.length - 1]);
    });

    it('ArrowDown from the last item wraps to the first item', () => {
        const menu = open();
        const its = items(menu);
        // walk to the last item
        for (let i = 0; i < its.length - 1; i++) press('ArrowDown');
        expect(document.activeElement).toBe(its[its.length - 1]);
        press('ArrowDown');
        expect(document.activeElement).toBe(its[0]);
    });

    it('Enter activates the focused item (Edit) and closes the menu', () => {
        open();
        // Edit is focused first
        press('Enter');
        expect(onEdit).toHaveBeenCalledTimes(1);
        expect(document.getElementById('projContextMenu')).toBeNull();
    });

    it('Space activates the focused Delete item exactly once (no double-fire from the native button)', () => {
        const menu = open();
        const its = items(menu);
        // move focus to Delete (last item)
        for (let i = 0; i < its.length - 1; i++) press('ArrowDown');
        expect(document.activeElement.textContent).toBe('Delete');
        press(' ');
        expect(onDelete).toHaveBeenCalledTimes(1);
        expect(document.getElementById('projContextMenu')).toBeNull();
    });

    it('Enter on a focused color swatch selects that color once and closes the menu', () => {
        const menu = open();
        const its = items(menu);
        // second item is the reset swatch, third is the first real color swatch
        press('ArrowDown'); // reset swatch
        press('ArrowDown'); // first color swatch
        expect(document.activeElement).toBe(its[2]);
        press('Enter');
        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(document.getElementById('projContextMenu')).toBeNull();
    });

    it('Escape closes the menu (existing affordance preserved)', () => {
        open();
        expect(document.getElementById('projContextMenu')).not.toBeNull();
        press('Escape');
        expect(document.getElementById('projContextMenu')).toBeNull();
    });
});
