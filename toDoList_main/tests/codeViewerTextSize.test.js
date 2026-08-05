import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// The code viewer's text size — the iOS autosizing fix and the header stepper
// that replaced the hardcoded 12px.
//
// THE BUG: iOS Safari's text autosizing inflates text per block, scaled by the
// block's width against the viewport. `.codeViewerCode` is `white-space: pre`,
// so every source line is a different width, lands in a different inflation
// cluster, and gets a different multiplier — a single file rendered with its
// long import lines visibly smaller than its short comment lines. `style.css`
// set `-webkit-text-size-adjust` nowhere, so iOS applied its `auto` default.
// Desktop engines don't boost, which is why it only showed on the phone.
//
// The opt-out is a CSS declaration with no JS surface and no jsdom behaviour, so
// it is pinned by source inspection — the same shape other CSS-contract tests in
// this suite use. The stepper's behaviour runs against the real module.

vi.mock('../src/inject.js', () => ({
    readRepoFile: vi.fn(() => Promise.resolve({ ok: true, content: 'a\nb\nc', sha: 'sha-1' })),
}));

import {
    renderCodeViewer,
    clearCodeViewer,
    resetCodeViewer,
} from '../src/codeViewer.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

const TARGET = { repo: 'rsterenchak/toDoList_TOP' };
const KEY = 'todoapp_codeFontSize';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) { for (let i = 0; i < n; i++) await tick(); }

// The declaration body of the first rule whose selector list is exactly `sel`.
// Anchored at the start of a line, so `.codeViewerLine` can't match either
// `.codeViewerLine--hit` or `.structureCodeSheet .codeViewerLine`.
function ruleBody(sel) {
    const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const m = css.match(new RegExp('^\\s*' + escaped + '\\s*\\{([^}]*)\\}', 'm'));
    return m ? m[1] : '';
}

function host() { return document.getElementById('col'); }
function pane() { return document.querySelector('.codeViewerPane'); }
function steps() { return Array.from(document.querySelectorAll('.codeViewerSizeStep')); }
function readout() { return document.querySelector('.codeViewerSizeValue'); }

beforeEach(() => {
    document.body.innerHTML = '<div id="col"></div>';
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    resetCodeViewer();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ── The regression itself: the listing opts out of iOS text boosting. ─────────
describe('codeViewer — iOS text autosizing opt-out', () => {
    it('.codeViewerLine disables automatic text size adjustment, prefixed and not', () => {
        const body = ruleBody('.codeViewerLine');
        expect(body).toMatch(/-webkit-text-size-adjust:\s*100%/);
        expect(body).toMatch(/(?<!-)text-size-adjust:\s*100%/);
    });

    it('uses 100% rather than none, which has interfered with user zoom', () => {
        expect(ruleBody('.codeViewerLine')).not.toMatch(/text-size-adjust:\s*none/);
    });

    it('scopes the opt-out to the listing — no other rule in the sheet touches it', () => {
        // Boosting may be doing something desirable elsewhere in the app, so the
        // whole stylesheet must carry exactly the two declarations above.
        const declared = css.match(/[-a-z]*text-size-adjust\s*:/g) || [];
        expect(declared.length).toBe(2);
        const inLine = ruleBody('.codeViewerLine').match(/[-a-z]*text-size-adjust\s*:/g) || [];
        expect(inLine.length).toBe(2);
    });
});

// ── One value sizes the whole listing, so the gutter can't drift from the code.
describe('codeViewer — one size for the gutter and the code', () => {
    it('.codeViewerLine sizes from --code-font-size, falling back to the old 12px', () => {
        expect(ruleBody('.codeViewerLine'))
            .toMatch(/font-size:\s*var\(--code-font-size,\s*12px\)/);
    });

    it('neither the gutter nor the code declares its own font-size', () => {
        expect(ruleBody('.codeViewerGutter')).not.toMatch(/font-size/);
        expect(ruleBody('.codeViewerCode')).not.toMatch(/font-size/);
    });

    it('keeps the gutter width in ch so numbers do not clip at the largest size', () => {
        expect(ruleBody('.codeViewerGutter')).toMatch(/width:\s*\d+ch/);
    });
});

// ── The stepper. ─────────────────────────────────────────────────────────────
describe('codeViewer — the header size stepper', () => {
    it('mounts a minus, a readout and a plus in the header, defaulting to 12px', () => {
        clearCodeViewer(host());

        const control = document.querySelector('.codeViewerHeader > .codeViewerSize');
        expect(control).toBeTruthy();
        expect(steps().length).toBe(2);
        expect(readout().textContent).toBe('12');
        expect(pane().style.getPropertyValue('--code-font-size')).toBe('12px');
    });

    it('steps down and up by 1px', () => {
        clearCodeViewer(host());
        const [down, up] = steps();

        down.click();
        expect(readout().textContent).toBe('11');
        expect(pane().style.getPropertyValue('--code-font-size')).toBe('11px');

        up.click();
        up.click();
        expect(readout().textContent).toBe('13');
        expect(pane().style.getPropertyValue('--code-font-size')).toBe('13px');
    });

    it('disables each control at its end of the 10–18px range', () => {
        clearCodeViewer(host());
        const [down, up] = steps();

        expect(down.disabled).toBe(false);
        expect(up.disabled).toBe(false);

        for (let i = 0; i < 6; i++) down.click();
        expect(readout().textContent).toBe('10');
        expect(down.disabled).toBe(true);
        expect(up.disabled).toBe(false);

        // A click on the disabled end is a no-op even if one is dispatched.
        down.click();
        expect(readout().textContent).toBe('10');

        for (let i = 0; i < 20; i++) up.click();
        expect(readout().textContent).toBe('18');
        expect(up.disabled).toBe(true);
        expect(down.disabled).toBe(false);
    });

    it('does not disable the stepper while the column is empty — it is a preference', () => {
        clearCodeViewer(host());
        expect(steps().every((b) => b.disabled)).toBe(false);
        expect(document.querySelector('.codeViewerExplain').disabled).toBe(true);
    });
});

// ── Persistence, per device, applied to every file opened afterward. ──────────
describe('codeViewer — the size persists', () => {
    it('writes the chosen size under a todoapp_-prefixed key', () => {
        clearCodeViewer(host());
        steps()[1].click();
        expect(localStorage.getItem(KEY)).toBe('13');
    });

    it('applies a stored size when the pane is built, before any line is painted', async () => {
        localStorage.setItem(KEY, '16');
        resetCodeViewer();

        clearCodeViewer(host());
        // Set at build time, with the listing still empty — so the first painted
        // line is measured at 16px rather than reflowing into it.
        expect(pane().style.getPropertyValue('--code-font-size')).toBe('16px');
        expect(document.querySelectorAll('.codeViewerLine').length).toBe(0);
        expect(readout().textContent).toBe('16');

        renderCodeViewer(host(), { target: TARGET, filePath: 'a.js' });
        await flush();
        expect(document.querySelectorAll('.codeViewerLine').length).toBe(3);
        expect(pane().style.getPropertyValue('--code-font-size')).toBe('16px');
    });

    it('clamps a stored size that falls outside the range', () => {
        localStorage.setItem(KEY, '99');
        resetCodeViewer();
        clearCodeViewer(host());
        expect(readout().textContent).toBe('18');
    });

    it('falls back to 12 on an unparseable stored value', () => {
        localStorage.setItem(KEY, 'huge');
        resetCodeViewer();
        clearCodeViewer(host());
        expect(readout().textContent).toBe('12');
    });

    it('survives a localStorage that throws — the size still applies for the session', () => {
        clearCodeViewer(host());
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('QuotaExceededError');
        });

        expect(() => steps()[1].click()).not.toThrow();
        expect(readout().textContent).toBe('13');
        expect(pane().style.getPropertyValue('--code-font-size')).toBe('13px');
    });

    it('moves both hosts, so the size agrees across the two breakpoints', () => {
        document.body.innerHTML = '<div id="col"></div><div id="sheet"></div>';
        clearCodeViewer(document.getElementById('col'));
        clearCodeViewer(document.getElementById('sheet'));

        const panes = Array.from(document.querySelectorAll('.codeViewerPane'));
        expect(panes.length).toBe(2);

        panes[0].querySelector('.codeViewerSizeStep').click(); // the minus
        panes.forEach((p) => {
            expect(p.style.getPropertyValue('--code-font-size')).toBe('11px');
            expect(p.querySelector('.codeViewerSizeValue').textContent).toBe('11');
        });
    });
});

// ── The mobile sheet's header is tight, so the stepper joins the Explain row. ─
describe('codeViewer — stepper placement in the mobile sheet', () => {
    it('drops the stepper onto the Explain row rather than shrinking the path', () => {
        expect(ruleBody('.structureCodeSheet .codeViewerSize')).toMatch(/order:\s*1/);
        // Explain shares that row now, so it can no longer claim all of it.
        expect(ruleBody('.structureCodeSheet .codeViewerExplain')).toMatch(/order:\s*1/);
        expect(ruleBody('.structureCodeSheet .codeViewerExplain')).not.toMatch(/flex:\s*1 1 100%/);
    });

    it('gives the steppers a touch-sized target in the sheet', () => {
        const body = ruleBody('.structureCodeSheet .codeViewerSizeStep');
        expect(body).toMatch(/min-height:\s*40px/);
        expect(body).toMatch(/min-width:\s*3\dpx/);
    });
});
