import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the help modal and its triggers. The floating `?`
// FAB was retired when the bottom-right slot became the Claude assistant
// launcher; help is now reached two ways: the `?` keystroke for keyboard
// users and the "Help" item inside the ghost menu. Both open the same
// modal — topic-based sections for Tasks, Projects, the Ghost menu, plus a
// Keyboard Shortcuts table.
describe('help modal + triggers', () => {
    const main = read('main.js');
    const modals = read('modals.js');
    const css = read('style.css');

    function extractTopLevelRule(selector) {
        let depth = 0;
        for (let i = 0; i < css.length; i++) {
            const c = css[i];
            if (c === '{') { depth++; continue; }
            if (c === '}') { depth--; continue; }
            if (depth !== 0) continue;
            if (css.startsWith(selector, i) && /[\s{]/.test(css[i + selector.length] || '')) {
                const blockStart = css.indexOf('{', i);
                const blockEnd = css.indexOf('}', blockStart);
                return css.slice(blockStart + 1, blockEnd);
            }
        }
        throw new Error(`Top-level rule for "${selector}" not found`);
    }

    it('exports showHelpModal and isAnyModalOrPopoverOpen from modals.js', () => {
        expect(modals).toMatch(/export\s+function\s+showHelpModal\s*\(/);
        expect(modals).toMatch(/export\s+function\s+isAnyModalOrPopoverOpen\s*\(/);
    });

    it('no longer ships the retired `?` help FAB', () => {
        // The bottom-right slot is now the Claude launcher; the help FAB and
        // its factory are gone so help can't double-mount a stale `?` button.
        expect(modals).not.toMatch(/createHelpFab/);
        expect(modals).not.toMatch(/fab\.id\s*=\s*['"]helpFab['"]/);
        expect(main).not.toMatch(/createHelpFab/);
    });

    it('wires the global `?` keydown in main.js', () => {
        // The ? keydown is a separate handler (not coalesced with the n shortcut)
        // so its guards remain easy to reason about.
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"][\s\S]*?\}\);/g) || [];
        const qBlock = blocks.find(function(b) { return /e\.key\s*!==\s*['"]\?['"]/.test(b); });
        expect(qBlock).toBeTruthy();
        // Skip when modifiers are involved.
        expect(qBlock).toMatch(/ctrlKey/);
        expect(qBlock).toMatch(/metaKey/);
        expect(qBlock).toMatch(/altKey/);
        // Skip when the user is typing in any text-entry surface.
        expect(qBlock).toMatch(/['"]INPUT['"]/);
        expect(qBlock).toMatch(/['"]TEXTAREA['"]/);
        expect(qBlock).toMatch(/isContentEditable/);
        // Skip when any modal/popover is already open — the FAB and the
        // shortcut share the same suppression rule.
        expect(qBlock).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
        // Open the modal + suppress the literal `?` from leaking into focus.
        expect(qBlock).toMatch(/showHelpModal\(\s*\)/);
        expect(qBlock).toMatch(/preventDefault\(\s*\)/);
    });

    it('exposes Help as an item in the ghost menu that opens the same modal', () => {
        // Third trigger — alongside the FAB and the `?` keystroke. Touch
        // users (where the FAB is hidden) reach the modal through here.
        // Anchor on the 'Help', literal inside the buildSettingsMenuItem
        // call (the trailing comma disambiguates from the HELP section
        // heading which also writes 'Help' as a literal).
        expect(main).toMatch(/buildSettingsMenuItem\(\s*['"]Help['"]\s*,/);
        const idx = main.indexOf("'Help',");
        expect(idx).toBeGreaterThan(-1);
        const slice = main.slice(idx, idx + 400);
        expect(slice).toMatch(/showHelpModal\s*\(\s*\)/);
    });

    it('makes the focusBlankToDoInput shortcut defer to the help modal via isAnyModalOrPopoverOpen', () => {
        // The ArrowRight jump-to-new-task shortcut should suppress while a
        // modal / popover is open — including the help modal itself. We
        // route the suppression through `isAnyModalOrPopoverOpen()` (which
        // covers `helpModalBackdrop`, see the dedicated test for that
        // helper) instead of inlining the IDs.
        const block = main.match(/document\.addEventListener\(['"]keydown['"][\s\S]*?focusBlankToDoInput[\s\S]*?\}\);/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
    });

    it('isAnyModalOrPopoverOpen covers every existing modal/popover/context menu', () => {
        const fnIdx = modals.indexOf('function isAnyModalOrPopoverOpen');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = modals.slice(fnIdx, fnIdx + 1200);
        ['confirmModalBackdrop',
         'changelogModalBackdrop',
         'helpModalBackdrop',
         'missedDatesModalBackdrop',
         'dueDatePopover',
         'projContextMenu'].forEach(function(id) {
            expect(body).toContain(id);
        });
    });

    it('renders the modal with role=dialog, aria-modal, the documented title, and a close X', () => {
        expect(modals).toMatch(/dialog\.setAttribute\(\s*['"]role['"]\s*,\s*['"]dialog['"]\s*\)/);
        expect(modals).toMatch(/dialog\.setAttribute\(\s*['"]aria-modal['"]\s*,\s*['"]true['"]\s*\)/);
        expect(modals).toMatch(/dialog\.setAttribute\(\s*['"]aria-labelledby['"]\s*,\s*['"]helpModalTitle['"]\s*\)/);
        expect(modals).toMatch(/title\.textContent\s*=\s*['"]Help['"]/);
        expect(modals).toMatch(/closeX\.id\s*=\s*['"]helpModalClose['"]/);
        expect(modals).toMatch(/closeX\.textContent\s*=\s*['"]×['"]/);
    });

    it('renders topic-based sections for Tasks, Projects, and the Ghost menu', () => {
        // The HELP_TOPICS catalogue lives in modals.js as plain bullet
        // lists describing the visible chrome.
        expect(modals).toMatch(/category:\s*['"]Tasks['"]/);
        expect(modals).toMatch(/category:\s*['"]Projects['"]/);
        expect(modals).toMatch(/category:\s*['"]Ghost Menu['"]/);
    });

    it('renders the Keyboard Shortcuts section with two-column key-cap rows', () => {
        // The Keyboard Shortcuts section is labelled at the top level and
        // the existing `.shortcutsRow` two-column structure (keys + desc)
        // is preserved underneath. Subgroups (Navigation / Editing / Global)
        // remain to keep the table scannable.
        expect(modals).toMatch(/shortcutsLabel\.textContent\s*=\s*['"]Keyboard Shortcuts['"]/);
        expect(modals).toMatch(/category:\s*['"]Navigation['"]/);
        expect(modals).toMatch(/category:\s*['"]Editing['"]/);
        expect(modals).toMatch(/category:\s*['"]Global['"]/);
        // Key-cap rows still use the existing class names so CSS doesn't
        // need a parallel set of selectors.
        expect(modals).toMatch(/['"]shortcutsList['"]/);
        expect(modals).toMatch(/['"]shortcutsRow['"]/);
        expect(modals).toMatch(/['"]shortcutsKeys['"]/);
        expect(modals).toMatch(/['"]shortcutsKey['"]/);
        // The current set of shortcuts lives in the catalogue. ArrowLeft and
        // ArrowRight replace the retired `\` toggle and `Ctrl+\` chord as
        // the cross-pane focus shortcuts.
        expect(modals).toMatch(/keys:\s*\[\s*['"]←['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]→['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]Ctrl['"]\s*,\s*['"]Enter['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]Enter['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]\?['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]Esc['"]\s*\]/);
        // The retired backslash bindings must not reappear in the catalogue.
        expect(modals).not.toMatch(/keys:\s*\[\s*['"]\\\\['"]\s*\]/);
        expect(modals).not.toMatch(/keys:\s*\[\s*['"]Ctrl['"]\s*,\s*['"]\\\\['"]\s*\]/);
    });

    it('closes on the corner X, the footer Close button, the backdrop, and Escape', () => {
        const fnIdx = modals.indexOf('function showHelpModal');
        expect(fnIdx).toBeGreaterThan(-1);
        // Pull the function body — bounded by the next top-level `function ` or
        // EOF — so the assertions don't bleed into adjacent helpers.
        const after = modals.slice(fnIdx);
        const nextFn = after.indexOf('\nexport function ', 1);
        const body = nextFn === -1 ? after : after.slice(0, nextFn);
        expect(body).toMatch(/closeX\.addEventListener\(\s*['"]click['"]\s*,\s*close\s*\)/);
        expect(body).toMatch(/closeBtn\.addEventListener\(\s*['"]click['"]\s*,\s*close\s*\)/);
        expect(body).toMatch(/backdrop\.addEventListener\(\s*['"]click['"]/);
        expect(body).toMatch(/event\.target\s*===\s*backdrop/);
        expect(body).toMatch(/event\.key\s*===\s*['"]Escape['"]/);
    });

    it('removes any prior help modal backdrop before mounting a new one', () => {
        // Defensive de-duping — same pattern as showConfirmModal / showChangelogModal.
        expect(modals).toMatch(/getElementById\(\s*['"]helpModalBackdrop['"]\s*\)/);
    });

    it('styles the topic sections with uppercase accent labels and a bullet list', () => {
        const labelRule = extractTopLevelRule('.helpTopicLabel');
        expect(labelRule).toMatch(/text-transform:\s*uppercase/);
        expect(labelRule).toMatch(/color:\s*var\(--accent-text\)/);
        const listRule = extractTopLevelRule('.helpTopicList');
        expect(listRule).toMatch(/list-style:\s*disc/);
    });

    it('does not persist a "seen" marker for the help modal', () => {
        // Help has no first-run pulse / dot / localStorage flag tracking
        // whether the user opened it; the menu item + `?` key are the surfaces.
        expect(modals).not.toMatch(/helpLastSeen|todoapp_help/i);
    });
});
