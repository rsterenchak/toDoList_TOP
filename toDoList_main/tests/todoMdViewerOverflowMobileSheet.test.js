import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    openOverflowMobileSheet,
    closeOverflowMobileSheet,
    isAnyMobileSheetOpen,
} from '../src/mobileSheets.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// The TODO.md viewer's "⋯" overflow button opens a slide-up bottom-sheet menu
// on the mobile breakpoint (large touch targets) instead of the cramped
// anchored dropdown; desktop keeps the dropdown unchanged. The viewer owns the
// menu element + item handlers and DOM-moves it into / out of the sheet, so
// every handler and the state the items read stay live. Source-inspection
// covers the viewer↔sheet wiring (the full card mount needs a Worker stub);
// behavioral tests exercise the sheet shell directly against jsdom.

describe('viewer overflow mobile sheet — todoMdViewer.js wiring', () => {
    const main = read('todoMdViewer.js');

    it('imports the shared mobile-viewport check', () => {
        expect(main).toMatch(
            /import\s*\{\s*isMobileViewport\s*\}\s*from\s*['"]\.\/viewport\.js['"]/
        );
    });

    it('exposes a sheet-controller setter (registered by main.js, no circular import)', () => {
        expect(main).toMatch(/export\s+function\s+setOverflowSheetController\s*\(/);
        // Guards the shape: both open() and close() must be functions.
        const start = main.indexOf('function setOverflowSheetController');
        const block = main.slice(start, start + 320);
        expect(block).toMatch(/typeof\s+controller\.open\s*===\s*['"]function['"]/);
        expect(block).toMatch(/typeof\s+controller\.close\s*===\s*['"]function['"]/);
    });

    it('openOverflowMenu opens the bottom sheet on mobile, falling back to the dropdown', () => {
        const start = main.indexOf('function openOverflowMenu');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1100);
        // Mobile + a registered controller routes to the sheet…
        expect(block).toMatch(
            /if\s*\(\s*isMobileViewport\(\)\s*&&\s*overflowSheetController\s*\)\s*\{[\s\S]{0,80}openOverflowSheet\(\)/
        );
        // …and the desktop dropdown path (the --menuOpen class) still follows.
        expect(block).toMatch(/card\.classList\.add\(\s*['"]todoMdViewerCard--menuOpen['"]\s*\)/);
    });

    it('openOverflowSheet DOM-moves the menu element into the sheet and wires onDismiss to re-home it', () => {
        const start = main.indexOf('function openOverflowSheet');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1000);
        // The actual menu element is handed to the controller (DOM move keeps
        // its item handlers + closure state alive).
        expect(block).toMatch(/overflowSheetController\.open\(\s*overflowMenu\s*,/);
        expect(block).toMatch(/overflowBtn\.setAttribute\(\s*['"]aria-expanded['"]\s*,\s*['"]true['"]\s*\)/);
        // onDismiss (user-affordance close) restores the menu + resets aria.
        expect(block).toMatch(/onDismiss[\s\S]{0,320}restoreOverflowMenuToWrap\(\)/);
    });

    it('closeOverflowMenu dismisses the sheet and re-homes the menu when it was in the sheet', () => {
        const start = main.indexOf('function closeOverflowMenu');
        const block = main.slice(start, start + 1300);
        expect(block).toMatch(/if\s*\(\s*overflowInSheet\s*\)\s*\{/);
        expect(block).toMatch(/overflowSheetController\.close\(\)/);
        expect(block).toMatch(/restoreOverflowMenuToWrap\(\)/);
    });

    it('restoreOverflowMenuToWrap re-appends the menu under its anchored wrapper', () => {
        const start = main.indexOf('function restoreOverflowMenuToWrap');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 260);
        expect(block).toMatch(/overflowMenu\.parentNode\s*!==\s*overflowWrap/);
        expect(block).toMatch(/overflowWrap\.appendChild\(\s*overflowMenu\s*\)/);
    });
});

describe('viewer overflow mobile sheet — main.js controller registration', () => {
    const main = read('main.js');

    it('registers the sheet open/close pair as the overflow controller', () => {
        expect(main).toMatch(
            /setOverflowSheetController\(\s*\{[\s\S]{0,160}open:\s*openOverflowMobileSheet[\s\S]{0,80}close:\s*closeOverflowMobileSheet/
        );
        expect(main).toMatch(
            /import\s*\{[\s\S]*?openOverflowMobileSheet[\s\S]*?closeOverflowMobileSheet[\s\S]*?\}\s*from\s*['"]\.\/mobileSheets\.js['"]/
        );
    });
});

describe('viewer overflow mobile sheet — mobileSheets.js wiring', () => {
    const sheets = read('mobileSheets.js');

    it('exports the open + close pair', () => {
        expect(sheets).toMatch(/export\s+function\s+openOverflowMobileSheet\s*\(/);
        expect(sheets).toMatch(/export\s+function\s+closeOverflowMobileSheet\s*\(/);
    });

    it('the programmatic close does not re-fire onDismiss; the affordance dismiss does', () => {
        // Shared teardown takes a `notify` flag: dismiss → true, close → false.
        expect(sheets).toMatch(/function\s+dismissOverflowMobileSheet\(\)\s*\{[\s\S]{0,80}teardownOverflowMobileSheet\(\s*true\s*\)/);
        expect(sheets).toMatch(/closeOverflowMobileSheet\(\)\s*\{[\s\S]{0,80}teardownOverflowMobileSheet\(\s*false\s*\)/);
        const td = sheets.indexOf('function teardownOverflowMobileSheet');
        const block = sheets.slice(td, td + 700);
        expect(block).toMatch(/if\s*\(\s*notify\s*&&\s*typeof\s+state\.onDismiss\s*===\s*['"]function['"]\s*\)/);
    });

    it('closes the four required ways (X / backdrop / Escape / swipe-down)', () => {
        expect(sheets).toMatch(/closeX\.addEventListener\(\s*['"]click['"]\s*,\s*dismissOverflowMobileSheet\s*\)/);
        expect(sheets).toMatch(/if\s*\(\s*event\.target\s*===\s*backdrop\s*\)\s*dismissOverflowMobileSheet\(\)/);
        const ok = sheets.indexOf('export function openOverflowMobileSheet');
        const block = sheets.slice(ok, ok + 3200);
        expect(block).toMatch(/event\.key\s*!==\s*['"]Escape['"]/);
        expect(block).toMatch(/attachCompletedSheetSwipeDown\(\s*handle\s*,\s*sheet\s*,\s*dismissOverflowMobileSheet\s*\)/);
    });

    it('lower sheets ignore Escape while the overflow sheet is open (single Escape = topmost only)', () => {
        // Both the completed and viewer sheet keydown handlers bail when the
        // overflow sheet is up, so its own Escape handler claims the keypress.
        const guards = sheets.match(
            /if\s*\(\s*overflowMobileSheetState\s*&&\s*overflowMobileSheetState\.open\s*\)\s*return;/g
        ) || [];
        // Two in the lower sheet keydown handlers, plus the open-guards in the
        // render/resize listeners — at least the two keydown guards.
        expect(guards.length).toBeGreaterThanOrEqual(2);
    });

    it('dismisses on a viewer re-render and on resize past the mobile breakpoint', () => {
        expect(sheets).toMatch(
            /mainListRendered[\s\S]{0,260}overflowMobileSheetState\s*&&\s*overflowMobileSheetState\.open[\s\S]{0,80}dismissOverflowMobileSheet\(\)/
        );
        expect(sheets).toMatch(
            /resize[\s\S]{0,260}overflowMobileSheetState\s*&&\s*overflowMobileSheetState\.open[\s\S]{0,120}!isMobileViewport\(\)[\s\S]{0,80}dismissOverflowMobileSheet\(\)/
        );
    });

    it('isAnyMobileSheetOpen accounts for the overflow sheet', () => {
        const start = sheets.indexOf('export function isAnyMobileSheetOpen');
        const block = sheets.slice(start, start + 400);
        expect(block).toMatch(/overflowMobileSheetState\s*&&\s*overflowMobileSheetState\.open/);
    });
});

describe('viewer overflow mobile sheet — style.css', () => {
    const css = read('style.css');

    it('renders the sheet as a slide-up bottom sheet above the other sheets', () => {
        expect(css).toMatch(/#todoMdViewerOverflowMobileSheetBackdrop\s*\{[\s\S]{0,200}position:\s*fixed/);
        // Stacks above the viewer/completed sheets (z-index 4000) it can open over.
        expect(css).toMatch(/#todoMdViewerOverflowMobileSheetBackdrop\s*\{[\s\S]{0,260}z-index:\s*4100/);
        expect(css).toMatch(/#todoMdViewerOverflowMobileSheet\s*\{[\s\S]{0,300}transform:\s*translateY\(100%\)/);
        expect(css).toMatch(/#todoMdViewerOverflowMobileSheetBackdrop\.is-open\s+#todoMdViewerOverflowMobileSheet\s*\{[\s\S]{0,80}transform:\s*translateY\(0\)/);
    });

    it('strips the dropdown chrome and enlarges items into touch targets inside the sheet', () => {
        expect(css).toMatch(/#todoMdViewerOverflowMobileSheet\s+\.todoMdViewerOverflowMenu\s*\{[\s\S]{0,200}position:\s*static/);
        // 16px label / generous padding = large, zoom-safe touch rows.
        expect(css).toMatch(
            /#todoMdViewerOverflowMobileSheet\s+\.todoMdViewerOverflowItem[\s\S]{0,160}font-size:\s*16px/
        );
    });
});

describe('viewer overflow mobile sheet — behavior (jsdom)', () => {
    function buildMenu() {
        const menu = document.createElement('div');
        menu.className = 'todoMdViewerOverflowMenu';
        menu.setAttribute('role', 'menu');
        const item = document.createElement('button');
        item.className = 'todoMdViewerOverflowItem';
        item.textContent = 'Clear all';
        menu.appendChild(item);
        return { menu, item };
    }

    afterEach(() => {
        // Ensure nothing leaks between tests.
        closeOverflowMobileSheet();
        const stray = document.getElementById('todoMdViewerOverflowMobileSheetBackdrop');
        if (stray && stray.parentNode) stray.parentNode.removeChild(stray);
        document.body.innerHTML = '';
    });

    it('moves the menu element into a sheet appended to the body and marks a sheet open', () => {
        const { menu } = buildMenu();
        const wrap = document.createElement('div');
        wrap.appendChild(menu);
        document.body.appendChild(wrap);

        openOverflowMobileSheet(menu, { title: 'More actions' });
        const backdrop = document.getElementById('todoMdViewerOverflowMobileSheetBackdrop');
        expect(backdrop).not.toBeNull();
        const sheetBody = backdrop.querySelector('.completedMobileSheetBody');
        expect(sheetBody.contains(menu)).toBe(true);
        expect(isAnyMobileSheetOpen()).toBe(true);
        // Title carries through.
        expect(backdrop.querySelector('#todoMdViewerOverflowMobileSheetTitle').textContent)
            .toBe('More actions');
    });

    it('the close button dismisses and fires onDismiss', () => {
        const { menu } = buildMenu();
        document.body.appendChild(menu);
        let dismissed = 0;
        openOverflowMobileSheet(menu, { onDismiss: () => { dismissed++; } });
        const backdrop = document.getElementById('todoMdViewerOverflowMobileSheetBackdrop');
        backdrop.querySelector('.completedMobileSheetClose').click();
        expect(dismissed).toBe(1);
        expect(document.getElementById('todoMdViewerOverflowMobileSheetBackdrop')).toBeNull();
        expect(isAnyMobileSheetOpen()).toBe(false);
    });

    it('a backdrop tap dismisses (clicks on the sheet itself do not)', () => {
        const { menu } = buildMenu();
        document.body.appendChild(menu);
        let dismissed = 0;
        openOverflowMobileSheet(menu, { onDismiss: () => { dismissed++; } });
        const backdrop = document.getElementById('todoMdViewerOverflowMobileSheetBackdrop');
        const sheet = document.getElementById('todoMdViewerOverflowMobileSheet');
        // Click inside the sheet — must NOT dismiss.
        sheet.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(dismissed).toBe(0);
        // Click the backdrop itself — dismisses.
        backdrop.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
        expect(dismissed).toBe(1);
    });

    it('Escape dismisses the sheet', () => {
        const { menu } = buildMenu();
        document.body.appendChild(menu);
        let dismissed = 0;
        openOverflowMobileSheet(menu, { onDismiss: () => { dismissed++; } });
        document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(dismissed).toBe(1);
        expect(document.getElementById('todoMdViewerOverflowMobileSheetBackdrop')).toBeNull();
    });

    it('the programmatic close() tears down WITHOUT firing onDismiss', () => {
        const { menu } = buildMenu();
        document.body.appendChild(menu);
        let dismissed = 0;
        openOverflowMobileSheet(menu, { onDismiss: () => { dismissed++; } });
        closeOverflowMobileSheet();
        expect(dismissed).toBe(0);
        expect(document.getElementById('todoMdViewerOverflowMobileSheetBackdrop')).toBeNull();
        expect(isAnyMobileSheetOpen()).toBe(false);
    });

    it('menu item click handlers survive the DOM move into the sheet', () => {
        const { menu, item } = buildMenu();
        let clicks = 0;
        item.addEventListener('click', () => { clicks++; });
        document.body.appendChild(menu);
        openOverflowMobileSheet(menu, {});
        // The same element, now inside the sheet, still fires its handler.
        item.click();
        expect(clicks).toBe(1);
    });
});
