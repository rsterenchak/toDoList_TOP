import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the Ctrl+Backspace chord: it toggles the sidebar the
// same way the hamburger button does, stays out of the way while typing in
// editable surfaces (so the browser's native word-delete keeps working), and
// stops the browser's "go back" gesture from firing once consumed. The
// shortcuts catalogue in modals.js lists the chord under Navigation so the
// help modal stays the single source of truth.
describe('Ctrl+Backspace — sidebar toggle', () => {
    const main = read('main.js');
    const modals = read('modals.js');

    function findHandler() {
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"],[\s\S]*?\}\s*\)\s*;/g) || [];
        return blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]Backspace['"]/.test(b)
                && /ctrlKey/.test(b)
                && /metaKey/.test(b);
        });
    }

    it('routes the chord through the on-screen sidebar toggle button', () => {
        const handler = findHandler();
        expect(handler).toBeTruthy();
        // Mirrors the existing on-screen control so the desktop rail/full
        // and mobile drawer branches stay in lockstep with the hamburger.
        expect(handler).toMatch(/sidebarToggle\.click\(\s*\)/);
    });

    it('bails on Alt or Shift modifiers and absorbs nothing while a modal is open', () => {
        const handler = findHandler();
        expect(handler).toMatch(/altKey/);
        expect(handler).toMatch(/shiftKey/);
        expect(handler).toMatch(/isAnyModalOrPopoverOpen/);
    });

    it('skips the chord while focus is in an editable surface so word-delete still fires', () => {
        const handler = findHandler();
        // The guard must include INPUT, TEXTAREA, and contentEditable so
        // task titles, description boxes, and any future rich-text surface
        // continue to receive the browser's native Ctrl+Backspace.
        expect(handler).toMatch(/INPUT/);
        expect(handler).toMatch(/TEXTAREA/);
        expect(handler).toMatch(/isContentEditable/);
    });

    it('stops the browser default so the "go back" gesture does not fire', () => {
        const handler = findHandler();
        expect(handler).toMatch(/preventDefault\(\s*\)/);
    });

    it('lists Ctrl+Backspace in the shortcuts modal under the sidebar toggle description', () => {
        // The catalogue is the single source of truth shown in the help
        // modal — the new chord must be discoverable there alongside the
        // other navigation shortcuts.
        const idx = modals.indexOf("keys: ['Ctrl', 'Backspace']");
        expect(idx).toBeGreaterThan(-1);
        const entry = modals.slice(idx, idx + 300);
        expect(entry).toMatch(/description:\s*['"][^'"]*sidebar[^'"]*['"]/i);
    });
});
