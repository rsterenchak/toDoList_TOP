import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the floating `?` help button and the keyboard
// shortcuts modal it opens. The FAB is a discoverable surface for the
// shortcut catalogue, the `?` keystroke duplicates that path for keyboard
// users, and both must be suppressed when another modal/popover is already
// open or when the device is touch-only.
describe('floating help button + keyboard shortcuts modal', () => {
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

    it('exports showShortcutsModal, createShortcutsHelpFab, and isAnyModalOrPopoverOpen from modals.js', () => {
        expect(modals).toMatch(/export\s+function\s+showShortcutsModal\s*\(/);
        expect(modals).toMatch(/export\s+function\s+createShortcutsHelpFab\s*\(/);
        expect(modals).toMatch(/export\s+function\s+isAnyModalOrPopoverOpen\s*\(/);
    });

    it('creates the FAB with id="shortcutsHelpFab", a `?` glyph, and aria metadata', () => {
        expect(modals).toMatch(/fab\.id\s*=\s*['"]shortcutsHelpFab['"]/);
        expect(modals).toMatch(/fab\.textContent\s*=\s*['"]\?['"]/);
        expect(modals).toMatch(/fab\.setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]Open keyboard shortcuts['"]\s*\)/);
        expect(modals).toMatch(/fab\.setAttribute\(\s*['"]aria-haspopup['"]\s*,\s*['"]dialog['"]\s*\)/);
    });

    it('appends the FAB to the DOM and wires the global `?` keydown in main.js', () => {
        // FAB is created and attached during component()
        expect(main).toMatch(/createShortcutsHelpFab\b/);
        expect(main).toMatch(/base\.appendChild\(\s*shortcutsHelpFab\s*\)/);

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
        expect(qBlock).toMatch(/showShortcutsModal\(\s*\)/);
        expect(qBlock).toMatch(/preventDefault\(\s*\)/);
    });

    it('makes the focusBlankToDoInput shortcut defer to the shortcuts modal via isAnyModalOrPopoverOpen', () => {
        // The jump-to-new-task shortcut (now `Ctrl+/`, formerly `N`) should
        // suppress while a modal/popover is open — including the shortcuts
        // modal itself. We route the suppression through
        // `isAnyModalOrPopoverOpen()` (which covers `shortcutsModalBackdrop`,
        // see the dedicated test for that helper) instead of inlining the IDs.
        const block = main.match(/document\.addEventListener\(['"]keydown['"][\s\S]*?focusBlankToDoInput[\s\S]*?\}\);/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
    });

    it('isAnyModalOrPopoverOpen covers every existing modal/popover/context menu', () => {
        const fnIdx = modals.indexOf('function isAnyModalOrPopoverOpen');
        expect(fnIdx).toBeGreaterThan(-1);
        const body = modals.slice(fnIdx, fnIdx + 600);
        ['confirmModalBackdrop',
         'changelogModalBackdrop',
         'shortcutsModalBackdrop',
         'dueDatePopover',
         'projContextMenu'].forEach(function(id) {
            expect(body).toContain(id);
        });
    });

    it('renders the modal with role=dialog, aria-modal, the documented title, and a close X', () => {
        expect(modals).toMatch(/dialog\.setAttribute\(\s*['"]role['"]\s*,\s*['"]dialog['"]\s*\)/);
        expect(modals).toMatch(/dialog\.setAttribute\(\s*['"]aria-modal['"]\s*,\s*['"]true['"]\s*\)/);
        expect(modals).toMatch(/dialog\.setAttribute\(\s*['"]aria-labelledby['"]\s*,\s*['"]shortcutsModalTitle['"]\s*\)/);
        expect(modals).toMatch(/title\.textContent\s*=\s*['"]Keyboard Shortcuts['"]/);
        expect(modals).toMatch(/closeX\.id\s*=\s*['"]shortcutsModalClose['"]/);
        expect(modals).toMatch(/closeX\.textContent\s*=\s*['"]×['"]/);
    });

    it('groups shortcuts under Navigation, Editing, and Global headings', () => {
        // The catalogue is hardcoded in the module — three categories so the
        // modal stays the single source of truth for what the keyboard does.
        expect(modals).toMatch(/category:\s*['"]Navigation['"]/);
        expect(modals).toMatch(/category:\s*['"]Editing['"]/);
        expect(modals).toMatch(/category:\s*['"]Global['"]/);
        // The current set of shortcuts lives in the catalogue. Bare `\` is
        // the sidebar↔placeholder toggle; `Ctrl+\` is the always-to-placeholder
        // fast path; `Ctrl+Enter` collapses Completed; the in-row Enter and
        // the global ? / Esc round it out.
        expect(modals).toMatch(/keys:\s*\[\s*['"]\\\\['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]Ctrl['"]\s*,\s*['"]\\\\['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]Ctrl['"]\s*,\s*['"]Enter['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]Enter['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]\?['"]\s*\]/);
        expect(modals).toMatch(/keys:\s*\[\s*['"]Esc['"]\s*\]/);
    });

    it('closes on the corner X, the footer Close button, the backdrop, and Escape', () => {
        const fnIdx = modals.indexOf('function showShortcutsModal');
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

    it('removes any prior shortcuts modal backdrop before mounting a new one', () => {
        // Defensive de-duping — same pattern as showConfirmModal / showChangelogModal.
        expect(modals).toMatch(/getElementById\(\s*['"]shortcutsModalBackdrop['"]\s*\)/);
    });

    it('styles the FAB as a 36×36 circle pinned to the bottom-right with a border and shadow', () => {
        const rule = extractTopLevelRule('#shortcutsHelpFab');
        expect(rule).toMatch(/position:\s*fixed/);
        expect(rule).toMatch(/right:\s*\d+px/);
        expect(rule).toMatch(/bottom:\s*\d+px/);
        expect(rule).toMatch(/width:\s*36px/);
        expect(rule).toMatch(/height:\s*36px/);
        expect(rule).toMatch(/border-radius:\s*50%/);
        expect(rule).toMatch(/border:[^;]*var\(--border-bright\)/);
        expect(rule).toMatch(/box-shadow:/);
    });

    it('hides the FAB on pointer:coarse viewports', () => {
        const coarseBlocks = css.match(/@media\s*\(\s*pointer:\s*coarse\s*\)\s*\{([\s\S]*?)\n\}/g) || [];
        const hides = coarseBlocks.some(function(block) {
            return /#shortcutsHelpFab\s*\{[^}]*display:\s*none/.test(block);
        });
        expect(hides).toBe(true);
    });

    it('hides the FAB whenever another modal, popover, or context menu is in the DOM', () => {
        // CSS :has() drives the visibility — no JS bookkeeping needed since the
        // backdrop / popover elements own their own lifecycle.
        ['#confirmModalBackdrop',
         '#changelogModalBackdrop',
         '#shortcutsModalBackdrop',
         '#dueDatePopover',
         '#projContextMenu'].forEach(function(sel) {
            const re = new RegExp('body:has\\(\\s*' + sel.replace(/[.#]/g, '\\$&') + '\\s*\\)\\s*#shortcutsHelpFab');
            expect(css).toMatch(re);
        });
    });

    it('does not persist a "seen" marker for the shortcuts modal', () => {
        // The FAB itself is the discoverable surface; there is no first-run
        // pulse / dot / localStorage flag to track whether the user opened it.
        expect(modals).not.toMatch(/shortcutsLastSeen|todoapp_shortcuts/i);
    });
});
