// Project context menu + per-project accent color.
//
// Right-click (or long-press on touch) a project row to open a custom menu
// with Edit, an inline color picker, and Delete. The menu replaces the old
// inline `×` delete button. Dismiss on: selection, Escape, outside click,
// outside right-click, viewport resize, scroll. Mirrors the dismissal
// affordances of the due-date popover.
//
// `applyProjectAccent` writes the chosen color through the `--proj-accent`
// CSS custom property; `style.css` resolves it via `var(--proj-accent,
// var(--accent))` so a null key cleanly falls back to the theme accent.
// PROJECT_COLOR_HEX maps listLogic's color keys to concrete swatch values
// shared across both light and dark themes.

import { listLogic } from './listLogic.js';


// ── PROJECT ACCENT COLORS ──
// Concrete hex values for each per-project color key in listLogic's palette.
// Both light and dark themes share the same swatches — values are picked to
// read cleanly on either surface. A null key means "use the theme accent",
// which the CSS `var(--proj-accent, var(--accent))` fallback resolves.
export const PROJECT_COLOR_HEX = {
    red:    '#e06a7a',
    orange: '#e29050',
    yellow: '#d9b86a',
    green:  '#7ac481',
    blue:   '#6ab5e0',
    purple: '#b779e0'
};

// Apply a project's accent color to an element via CSS custom property.
// Passing null removes the property so the theme accent takes over.
export function applyProjectAccent(el, colorKey) {
    if (!el) return;
    if (colorKey && PROJECT_COLOR_HEX[colorKey]) {
        el.style.setProperty('--proj-accent', PROJECT_COLOR_HEX[colorKey]);
    } else {
        el.style.removeProperty('--proj-accent');
    }
}


// ── PROJECT CONTEXT MENU ──

export function hideProjectContextMenu() {
    const existing = document.getElementById('projContextMenu');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    document.removeEventListener('click', onProjContextOutsideClick, true);
    document.removeEventListener('contextmenu', onProjContextOutsideCtx, true);
    document.removeEventListener('keydown', onProjContextKeydown, true);
    window.removeEventListener('resize', hideProjectContextMenu);
    window.removeEventListener('scroll', hideProjectContextMenu, true);
}

function onProjContextOutsideClick(event) {
    const menu = document.getElementById('projContextMenu');
    if (menu && !menu.contains(event.target)) hideProjectContextMenu();
}

function onProjContextOutsideCtx(event) {
    const menu = document.getElementById('projContextMenu');
    if (menu && !menu.contains(event.target)) hideProjectContextMenu();
}

function onProjContextKeydown(event) {
    if (event.key === 'Escape') hideProjectContextMenu();
}

// Collect the menu's interactive items (Edit, the Due-dates toggle, each color
// swatch, Delete) in DOM order — the flat ring the roving tabindex + arrow keys
// walk over. The Due-dates row is a menuitemcheckbox, so it's matched too.
function getProjContextItems(menu) {
    return Array.prototype.slice.call(
        menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')
    );
}

// Move focus to the item at `index`, keeping exactly one item in the tab order
// (roving tabindex): the focused item is tabindex 0, every other is -1.
function focusProjContextItem(items, index) {
    items.forEach(function(item, i) {
        item.setAttribute('tabindex', i === index ? '0' : '-1');
    });
    if (items[index]) items[index].focus();
}

// Up/Down move focus between menu items with wraparound; Enter/Space activate
// the focused item. Escape is handled by the document-level onProjContextKeydown
// so it closes the menu from anywhere. Attached to the menu element itself, so
// it only fires while focus is inside the menu and is torn down with the node.
function onProjContextMenuKeydown(event) {
    const menu = document.getElementById('projContextMenu');
    if (!menu) return;
    const items = getProjContextItems(menu);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement);

    if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = current < 0 ? 0 : (current + 1) % items.length;
        focusProjContextItem(items, next);
    } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const prev = current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length;
        focusProjContextItem(items, prev);
    } else if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        if (current >= 0) {
            // Neutralize native activation (buttons fire click on Enter/Space)
            // so the manual click() below is the single, uniform activation for
            // both the div items and the swatch buttons.
            event.preventDefault();
            items[current].click();
        }
    }
}

// Build the inline color-picker strip that sits between Edit and Delete in
// the project context menu. Single click on any swatch assigns the color
// and closes the menu — matching how Edit and Delete already behave.
function buildColorPicker(currentColorKey, onSelect) {
    const picker = document.createElement('div');
    picker.className = 'projContextColorPicker';

    // Reset (theme accent) slot first so it's the leftmost option.
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'projContextColorSwatch reset';
    resetBtn.setAttribute('role', 'menuitem');
    resetBtn.setAttribute('tabindex', '-1');
    resetBtn.setAttribute('aria-label', 'Reset to theme accent');
    if (!currentColorKey) resetBtn.classList.add('active');
    resetBtn.addEventListener('click', function() {
        hideProjectContextMenu();
        onSelect(null);
    });
    picker.appendChild(resetBtn);

    listLogic.PROJECT_COLOR_KEYS.forEach(function(key) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'projContextColorSwatch';
        btn.setAttribute('role', 'menuitem');
        btn.setAttribute('tabindex', '-1');
        btn.style.setProperty('--swatch-color', PROJECT_COLOR_HEX[key]);
        btn.setAttribute('aria-label', 'Set project color: ' + key);
        if (currentColorKey === key) btn.classList.add('active');
        btn.addEventListener('click', function() {
            hideProjectContextMenu();
            onSelect(key);
        });
        picker.appendChild(btn);
    });

    return picker;
}


// Build the "Due dates" toggle-switch row that sits between Edit and the color
// picker. The switch reads ON (accent track) when dates are shown — the default
// — and OFF (muted track) when the project hides them, so it flips the project's
// hideDates flag. Tapping it closes the menu and calls onToggle, matching how
// Edit / color swatches / Delete already close on select.
function buildDatesToggleRow(hidden, onToggle) {
    const row = document.createElement('div');
    row.className = 'projContextMenuItem projContextDatesItem';
    row.setAttribute('role', 'menuitemcheckbox');
    row.setAttribute('tabindex', '-1');

    const datesShown = !hidden;
    row.setAttribute('aria-checked', datesShown ? 'true' : 'false');

    const label = document.createElement('span');
    label.className = 'projContextDatesLabel';
    label.textContent = 'Due dates';

    const sw = document.createElement('span');
    sw.className = 'projContextDatesToggle' + (datesShown ? ' on' : '');
    const knob = document.createElement('span');
    knob.className = 'projContextDatesKnob';
    sw.appendChild(knob);

    row.appendChild(label);
    row.appendChild(sw);
    row.addEventListener('click', function() {
        hideProjectContextMenu();
        onToggle();
    });
    return row;
}


export function showProjectContextMenu(x, y, onEdit, onDelete, colorContext, datesContext) {

    hideProjectContextMenu();

    const menu = document.createElement('div');
    menu.id = 'projContextMenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Project actions');
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const editOpt = document.createElement('div');
    editOpt.className = 'projContextMenuItem';
    editOpt.setAttribute('role', 'menuitem');
    editOpt.setAttribute('tabindex', '-1');
    editOpt.textContent = 'Edit';
    editOpt.addEventListener('click', function() {
        hideProjectContextMenu();
        onEdit();
    });

    const delOpt = document.createElement('div');
    delOpt.className = 'projContextMenuItem danger';
    delOpt.setAttribute('role', 'menuitem');
    delOpt.setAttribute('tabindex', '-1');
    delOpt.textContent = 'Delete';
    delOpt.addEventListener('click', function() {
        hideProjectContextMenu();
        onDelete();
    });

    menu.appendChild(editOpt);
    if (datesContext && typeof datesContext.onToggle === 'function') {
        menu.appendChild(buildDatesToggleRow(!!datesContext.hidden, datesContext.onToggle));
    }
    if (colorContext && typeof colorContext.onSelect === 'function') {
        menu.appendChild(buildColorPicker(colorContext.currentColor || null, colorContext.onSelect));
    }
    menu.appendChild(delOpt);
    document.body.appendChild(menu);

    // clamp to viewport so the menu is fully visible
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth)  menu.style.left = Math.max(0, window.innerWidth  - rect.width  - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top  = Math.max(0, window.innerHeight - rect.height - 4) + 'px';

    // capture-phase listeners so outside interactions always close the menu
    document.addEventListener('click',      onProjContextOutsideClick, true);
    document.addEventListener('contextmenu', onProjContextOutsideCtx,  true);
    document.addEventListener('keydown',    onProjContextKeydown,      true);
    window.addEventListener('resize', hideProjectContextMenu);
    window.addEventListener('scroll', hideProjectContextMenu, true);

    // Roving-tabindex keyboard nav across the menu items (Up/Down + Enter/Space).
    // The listener lives on the menu node, so it's removed automatically when the
    // menu is torn down. Focus the first item so arrow keys work immediately.
    menu.addEventListener('keydown', onProjContextMenuKeydown);
    focusProjContextItem(getProjContextItems(menu), 0);
}
