import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for roving-tabindex ArrowLeft/ArrowRight navigation across
// the three view-switcher pills (Task View / AGENT / STRUCTURE). The pills form
// an ARIA tablist: exactly one is in the Tab order (tabindex 0) while the others
// are tabindex -1, and Left/Right cycle among all three WITH wraparound (Right on
// STRUCTURE lands on Task View; Left on Task View lands on STRUCTURE). This must
// take priority over the header-wide nav Left/Right walk, so the handler stops
// propagation. Enter/Space activation is left to native <button> behaviour.
describe('view-switcher roving-tabindex arrow-key navigation', () => {
    const main = read('main.js');

    function extractNamedFn(name) {
        const sig = 'function ' + name + '(';
        const start = main.indexOf(sig);
        if (start === -1) throw new Error('function not found: ' + name);
        const bodyStart = main.indexOf('{', start);
        let depth = 0;
        for (let i = bodyStart; i < main.length; i++) {
            const c = main[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return main.slice(bodyStart, i + 1);
            }
        }
        throw new Error('unterminated body for: ' + name);
    }

    function extractBlock(signature) {
        const start = main.indexOf(signature);
        if (start === -1) throw new Error('signature not found: ' + signature);
        const bodyStart = main.indexOf('{', start);
        let depth = 0;
        for (let i = bodyStart; i < main.length; i++) {
            const c = main[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return main.slice(bodyStart, i + 1);
            }
        }
        throw new Error('unterminated block for: ' + signature);
    }

    it('wires the roving arrow-nav keydown handler on all three pills', () => {
        // A tablist is only fully navigable if every tab responds to the arrow
        // keys; wiring only two of the three would strand focus on the third.
        expect(main).toMatch(/viewPillProjects\.addEventListener\(\s*['"]keydown['"]\s*,\s*viewSwitcherArrowNav/);
        expect(main).toMatch(/viewPillAgent\.addEventListener\(\s*['"]keydown['"]\s*,\s*viewSwitcherArrowNav/);
        expect(main).toMatch(/viewPillStructure\.addEventListener\(\s*['"]keydown['"]\s*,\s*viewSwitcherArrowNav/);
    });

    it('the arrow-nav handler only acts on unmodified Left/Right and bails on modal/popover', () => {
        const body = extractNamedFn('viewSwitcherArrowNav');
        expect(body).toMatch(/['"]ArrowLeft['"]/);
        expect(body).toMatch(/['"]ArrowRight['"]/);
        // Shift/Ctrl/Meta/Alt + Arrow are reserved for native selection and
        // OS-level chords, and an open popover owns the keystrokes.
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
        expect(body).toMatch(/shiftKey/);
        expect(body).toMatch(/isAnyModalOrPopoverOpen\(\s*\)/);
    });

    it('the arrow-nav handler bails when focus is not on a switcher pill', () => {
        const body = extractNamedFn('viewSwitcherArrowNav');
        // indexOf(e.target) === -1 keeps the handler scoped to the three pills.
        expect(body).toMatch(/indexOf\(\s*e\.target\s*\)/);
        expect(body).toMatch(/===\s*-1/);
    });

    it('the arrow-nav handler wraps around both ends via modulo of the pill count', () => {
        const body = extractNamedFn('viewSwitcherArrowNav');
        // Wraparound is the defining behavior: Right on the last pill returns to
        // the first and Left on the first jumps to the last. A modulo over the
        // pill-count length (guarded with + len so a -1 index normalises) is the
        // canonical clamp-free wrap; a plain "< 0 || >= length → return" gate
        // would instead stop at the ends, which this test rejects.
        expect(body).toMatch(/%/);
        expect(body).toMatch(/\.length/);
        // Must not early-return the out-of-range index (that would be clamping,
        // not wrapping).
        expect(body).not.toMatch(/nextIdx\s*<\s*0/);
    });

    it('the arrow-nav handler takes priority over the header walk by stopping propagation', () => {
        const body = extractNamedFn('viewSwitcherArrowNav');
        // Without stopPropagation the document-level cross-pane ArrowLeft/Right
        // handler would also fire in Projects view and yank focus into the task
        // pane. preventDefault suppresses native caret/scroll side effects.
        expect(body).toMatch(/stopPropagation\(\s*\)/);
        expect(body).toMatch(/preventDefault\(\s*\)/);
    });

    it('moving focus hands the roving tabindex 0 to the target and -1 to the rest', () => {
        const body = extractNamedFn('focusViewPillAt');
        // Exactly one pill tabbable at a time is what makes this a roving
        // tablist rather than three independent tab stops.
        expect(body).toMatch(/setAttribute\(\s*['"]tabindex['"]\s*,\s*p === pill \? '0' : '-1'\s*\)/);
        expect(body).toMatch(/\.focus\(\s*\)/);
    });

    it('applyActiveView keeps the active pill as the sole Tab stop', () => {
        const body = extractNamedFn('applyActiveView');
        // The active view's pill must own tabindex 0 while the others drop to
        // -1, so a Tab press into the header lands on the current view's pill —
        // the roving marker the nav walk also uses to enter the group.
        expect(body).toMatch(/pillProjects\.setAttribute\(\s*['"]tabindex['"]\s*,\s*safe === 'projects' \? '0' : '-1'\s*\)/);
        expect(body).toMatch(/pillAgent\.setAttribute\(\s*['"]tabindex['"]\s*,\s*safe === 'agent' \? '0' : '-1'\s*\)/);
        expect(body).toMatch(/pillStructure\.setAttribute\(\s*['"]tabindex['"]\s*,\s*safe === 'structure' \? '0' : '-1'\s*\)/);
    });

    it('the header nav walk enters the switcher at the roving tab stop, not a fixed pill', () => {
        const body = extractBlock("nav.addEventListener('keydown'");
        // Entering the switcher from either neighbour must land on whichever
        // pill currently owns tabindex 0 (the active view), so the switcher
        // reads as one internally-navigable group rather than a single fixed
        // stop pinned to Task View.
        expect(body).toMatch(/#viewSwitcher \.viewPill\[tabindex="0"\]/);
        expect(body).toMatch(/nextBtn === viewPillProjects/);
    });
});
