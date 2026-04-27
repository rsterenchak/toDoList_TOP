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


export function showProjectContextMenu(x, y, onEdit, onDelete, colorContext) {

    hideProjectContextMenu();

    const menu = document.createElement('div');
    menu.id = 'projContextMenu';
    menu.style.left = x + 'px';
    menu.style.top  = y + 'px';

    const editOpt = document.createElement('div');
    editOpt.className = 'projContextMenuItem';
    editOpt.textContent = 'Edit';
    editOpt.addEventListener('click', function() {
        hideProjectContextMenu();
        onEdit();
    });

    const delOpt = document.createElement('div');
    delOpt.className = 'projContextMenuItem danger';
    delOpt.textContent = 'Delete';
    delOpt.addEventListener('click', function() {
        hideProjectContextMenu();
        onDelete();
    });

    menu.appendChild(editOpt);
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
}
