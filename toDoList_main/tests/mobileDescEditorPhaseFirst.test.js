import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { showDescEditorModal } from '../src/modals.js';
import { setQueueRows } from '../src/agentQueueStore.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the phase-first mobile description-editor modal: in a blocked phase the
// header eyebrow + dialog border take the phase accent and THE ENTRY region
// (label, file picker, textarea) collapses behind a single disclosure row pinned
// below the phase block, so a short phone shows the phase block without scrolling
// past a 180px textarea. In every non-blocked phase the modal is byte-for-byte its
// prior layout — no disclosure, entry expanded, "Description" eyebrow. The blocked
// paths depend on the agent-queue store, so they are verified by source/CSS
// inspection; the non-blocked byte-for-byte guarantee is exercised at runtime.

describe('phase-first modal — wiring (source inspection)', () => {
    const modals = read('modals.js');

    it('imports isBlockedPhase from phase.js (the single blocked-set source)', () => {
        expect(modals).toMatch(
            /import\s*\{[^}]*\bisBlockedPhase\b[^}]*\}\s*from\s*['"]\.\/phase\.js['"]/
        );
    });

    it('refreshPhaseUI drives both the phase chrome and the entry disclosure from the one derived phase', () => {
        const idx = modals.indexOf('function refreshPhaseUI');
        const fn = modals.slice(idx, idx + 400);
        expect(fn).toMatch(/applyPhaseChrome\(\s*phase\s*\)/);
        expect(fn).toMatch(/renderEntryDisclosure\(\s*phase\s*\)/);
        // Still no second derivePhase — the whole switch reuses the rail's phase.
        expect(fn).not.toMatch(/derivePhase/);
    });

    it('applyPhaseChrome keys off isBlockedPhase, sets data-phase + the phase eyebrow, and restores Description otherwise', () => {
        const idx = modals.indexOf('function applyPhaseChrome(phase)');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 500);
        expect(fn).toMatch(/isBlockedPhase\(phase\)/);
        expect(fn).toMatch(/setAttribute\(\s*['"]data-phase['"]\s*,\s*phase\s*\)/);
        expect(fn).toMatch(/removeAttribute\(\s*['"]data-phase['"]\s*\)/);
        expect(fn).toMatch(/eyebrowLabel\.textContent\s*=\s*['"]Description['"]/);
    });

    it('renderEntryDisclosure gates on isBlockedPhase and mounts a real <button> with aria wiring', () => {
        const idx = modals.indexOf('function renderEntryDisclosure(phase)');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 2200);
        expect(fn).toMatch(/isBlockedPhase\(phase\)/);
        expect(fn).toMatch(/createElement\(\s*['"]button['"]\s*\)/);
        expect(fn).toMatch(/setAttribute\(\s*['"]aria-controls['"]/);
        // Sits directly above THE ENTRY region so an expand reveals it beneath.
        expect(fn).toMatch(/insertBefore\(\s*btn\s*,\s*entryLabel\s*\)/);
    });

    it('the disclosure toggles the hidden ATTRIBUTE, never an inline style.display write', () => {
        const idx = modals.indexOf('function applyEntryVisibility(collapsed)');
        expect(idx).toBeGreaterThan(-1);
        const fn = modals.slice(idx, idx + 600);
        expect(fn).toMatch(/entryLabel\.hidden\s*=\s*collapsed/);
        expect(fn).toMatch(/textarea\.hidden\s*=\s*collapsed/);
        expect(fn).toMatch(/filePicker\.trigger\.hidden\s*=\s*collapsed/);
        expect(fn).not.toMatch(/style\.display/);
    });

    it('paints the expand affordance from aria-expanded, flipping ▾ / ▴', () => {
        const idx = modals.indexOf('function paintDisclosure(');
        const fn = modals.slice(idx, idx + 500);
        expect(fn).toMatch(/setAttribute\(\s*['"]aria-expanded['"]/);
        expect(fn).toMatch(/tap to expand ▾/);
        expect(fn).toMatch(/tap to collapse ▴/);
    });

    it('disclosure state is transient — entryExpanded initializes to false (starts collapsed, never persisted)', () => {
        expect(modals).toMatch(/let\s+entryExpanded\s*=\s*false/);
        // No localStorage / prefs write of the disclosure state.
        const idx = modals.indexOf('function renderEntryDisclosure(phase)');
        const fn = modals.slice(idx, idx + 1400);
        expect(fn).not.toMatch(/localStorage/);
    });
});

describe('phase-first modal — styling (CSS inspection)', () => {
    const css = read('style.css');

    it('the collapsed entry region re-asserts [hidden] with !important (author display would else win)', () => {
        const m = css.match(
            /#descEditorModalEntryLabel\[hidden\][\s\S]{0,200}?\{([^}]*)\}/
        );
        expect(m).toBeTruthy();
        expect(m[1]).toMatch(/display:\s*none\s*!important/);
        expect(css).toMatch(/#descEditorModalTextarea\[hidden\]/);
        expect(css).toMatch(/#descEditorModalTargetPick\[hidden\]/);
    });

    it('the disclosure is a ≥44px tap target row', () => {
        const idx = css.indexOf('.descEditorModalEntryDisclosure {');
        expect(idx).toBeGreaterThan(-1);
        const body = css.slice(idx, css.indexOf('}', idx));
        expect(body).toMatch(/min-height:\s*44px/);
    });

    it('blocked-phase chrome uses the shared amber and stuck danger red — no new tokens', () => {
        expect(css).toMatch(/#descEditorModal\[data-phase\]\s*\{[^}]*border-color:\s*#ffbd5e/);
        expect(css).toMatch(/#descEditorModal\[data-phase="stuck"\]\s*\{[^}]*border-color:\s*#ff5d7a/);
        expect(css).toMatch(/#descEditorModal\[data-phase\]\s+#descEditorModalTitleEyebrowLabel\s*\{[^}]*color:\s*#ffbd5e/);
        expect(css).toMatch(/#descEditorModal\[data-phase="stuck"\]\s+#descEditorModalTitleEyebrowLabel\s*\{[^}]*color:\s*#ff5d7a/);
    });
});

describe('phase-first modal — non-blocked phase is byte-for-byte (runtime)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => {
        // Close via the guarded × so the modal's phase listeners tear down.
        const closeX = document.getElementById('descEditorModalClose');
        if (closeX) closeX.click();
        document.body.innerHTML = '';
    });

    it('renders no disclosure, keeps THE ENTRY expanded, and shows the static Description eyebrow', () => {
        // A bare item with no queue row / entry id derives to PHASE.NONE — a
        // non-blocked phase.
        showDescEditorModal({ id: 'plain', tit: 'A task', desc: 'hello', status: 'active' }, { projectName: 'Work' });

        const dialog = document.getElementById('descEditorModal');
        expect(dialog).not.toBeNull();
        // No blocked-phase accent.
        expect(dialog.hasAttribute('data-phase')).toBe(false);
        // No disclosure row at all.
        expect(document.getElementById('descEditorModalEntryDisclosure')).toBeNull();
        // Entry region expanded (no hidden attribute).
        expect(document.getElementById('descEditorModalTextarea').hidden).toBe(false);
        expect(document.getElementById('descEditorModalEntryLabel').hidden).toBe(false);
        // Static eyebrow.
        expect(document.getElementById('descEditorModalTitleEyebrowLabel').textContent).toBe('Description');
    });
});

describe('phase-first modal — blocked phase collapses the entry (runtime)', () => {
    beforeEach(() => { document.body.innerHTML = ''; });
    afterEach(() => {
        const closeX = document.getElementById('descEditorModalClose');
        if (closeX) closeX.click();
        document.body.innerHTML = '';
        setQueueRows([], undefined);
    });

    it('a stuck task starts collapsed with the phase accent, and the disclosure expands the entry inline', () => {
        // A failed queue row derives to PHASE.STUCK — a blocked phase.
        setQueueRows([{ id: 9, todo_id: 'blk', state: 'failed', entry_id: 'e9' }], 'Work');
        showDescEditorModal({ id: 'blk', tit: 'Broken task', desc: 'body', status: 'active' }, { projectName: 'Work' });

        const dialog = document.getElementById('descEditorModal');
        // STUCK accent on the dialog + its danger-red phase name eyebrow.
        expect(dialog.getAttribute('data-phase')).toBe('stuck');
        expect(document.getElementById('descEditorModalTitleEyebrowLabel').textContent).toBe('Stuck');

        // The entry region starts COLLAPSED behind the disclosure.
        const disclosure = document.getElementById('descEditorModalEntryDisclosure');
        expect(disclosure).not.toBeNull();
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(document.getElementById('descEditorModalTextarea').hidden).toBe(true);
        expect(document.getElementById('descEditorModalEntryLabel').hidden).toBe(true);

        // Tapping the disclosure expands the entry region inline.
        disclosure.click();
        expect(disclosure.getAttribute('aria-expanded')).toBe('true');
        expect(document.getElementById('descEditorModalTextarea').hidden).toBe(false);
        expect(document.getElementById('descEditorModalEntryLabel').hidden).toBe(false);

        // Tapping again collapses it.
        disclosure.click();
        expect(disclosure.getAttribute('aria-expanded')).toBe('false');
        expect(document.getElementById('descEditorModalTextarea').hidden).toBe(true);
    });
});
