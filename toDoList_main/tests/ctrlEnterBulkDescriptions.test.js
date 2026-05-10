import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the Ctrl+Enter chord: it now mirrors the EXPAND ALL
// button so users can flip every open task description at once from the
// keyboard. The shortcut catalogue in modals.js documents the new behaviour,
// and the legacy Completed-section toggle wiring in main.js is gone.
describe('Ctrl+Enter — bulk description toggle', () => {
    const main = read('main.js');
    const modals = read('modals.js');

    it('routes the chord handler at the EXPAND ALL button click', () => {
        // The Ctrl+Enter handler is the only `keydown` listener that requires
        // both `e.key === 'Enter'` and a Ctrl/Cmd modifier. It must dispatch
        // the same click the on-screen EXPAND ALL button receives so the
        // label and `.expanded` state stay in sync after a keyboard trigger.
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"],[\s\S]*?\}\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]Enter['"]/.test(b)
                && /ctrlKey/.test(b)
                && /metaKey/.test(b);
        });
        expect(handler).toBeTruthy();
        expect(handler).toMatch(/bulkDescToggleBtn\.click\(\s*\)/);
        // Modifiers other than Ctrl/Cmd must bail so Shift+Enter / Alt+Enter
        // remain available to other surfaces.
        expect(handler).toMatch(/altKey/);
        expect(handler).toMatch(/shiftKey/);
        // Modals/popovers absorb the shortcut so the chord can't disturb a
        // dialog the user is actively reading.
        expect(handler).toMatch(/isAnyModalOrPopoverOpen/);
        // Stop the browser's default Enter-handling once we've consumed it.
        expect(handler).toMatch(/preventDefault\(\s*\)/);
    });

    it('drops the legacy Completed-section toggle wiring from the chord', () => {
        // Regression guard: the old handler called setCompletedSectionOpen
        // and updateCompletedSection. Neither should run from the keydown
        // path now that the chord is the bulk-description shortcut. Scope
        // the check to the chord handler block — completed-section helpers
        // are legitimately reused by other surfaces (the mobile drawer's
        // Show completed toggle), so a file-wide regex would over-match.
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"],[\s\S]*?\}\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /e\.key\s*!==\s*['"]Enter['"]/.test(b)
                && /ctrlKey/.test(b)
                && /metaKey/.test(b);
        });
        expect(handler).toBeTruthy();
        expect(handler).not.toMatch(/setCompletedSectionOpen/);
        expect(handler).not.toMatch(/isCompletedSectionOpen/);
        expect(handler).not.toMatch(/updateCompletedSection/);
    });

    it('updates the shortcuts modal description to reflect the new behaviour', () => {
        // The catalogue is the single source of truth shown in the help
        // modal — the Ctrl+Enter row must describe the bulk-description
        // action, not the retired Completed-section toggle.
        const ctrlEnterIdx = modals.indexOf("keys: ['Ctrl', 'Enter']");
        expect(ctrlEnterIdx).toBeGreaterThan(-1);
        const entry = modals.slice(ctrlEnterIdx, ctrlEnterIdx + 300);
        expect(entry).toMatch(/description:\s*['"][^'"]*description[^'"]*['"]/i);
        expect(entry).not.toMatch(/Completed section/);
    });
});
