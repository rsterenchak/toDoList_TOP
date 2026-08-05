import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the CSS contract for four Structure-view elements that declare
// `display` in their base rule while also being toggled via `.hidden` from
// structureView.js. Because an author-level `display` declaration outranks the
// UA stylesheet's `[hidden] { display: none }`, each base rule needs an
// explicit `[hidden] { display: none; }` guard or the `hidden` toggle is a
// no-op. Source inspection only, mirroring the mobileCheckboxHidden approach —
// jsdom does not model the UA-vs-author cascade for the `hidden` attribute.
describe('Structure-view [hidden] guards override the base display declaration', () => {
    const css = read('style.css');

    function ruleBody(selector) {
        const start = css.indexOf(selector + ' {');
        if (start === -1) return null;
        const open = css.indexOf('{', start);
        const close = css.indexOf('}', open);
        if (open === -1 || close === -1) return null;
        return css.slice(open + 1, close);
    }

    const cases = [
        '.structureFilterClear',
        '.structureToolbar',
        '.structureActionToolbar',
        '.structureFindResult',
    ];

    for (const selector of cases) {
        it(`${selector} declares display in its base rule (the reason the guard is needed)`, () => {
            const body = ruleBody(selector);
            expect(body).not.toBeNull();
            expect(body).toMatch(/display:\s*(?:flex|inline-flex)/);
        });

        it(`${selector}[hidden] { display: none } guard exists so .hidden = true actually hides`, () => {
            const guard = new RegExp(
                selector.replace('.', '\\.') + '\\[hidden\\]\\s*\\{\\s*display:\\s*none'
            );
            expect(css).toMatch(guard);
        });

        it(`the ${selector}[hidden] guard comes AFTER its base rule so source order wins at equal specificity`, () => {
            const baseIdx = css.indexOf(selector + ' {');
            const guardIdx = css.indexOf(selector + '[hidden]');
            expect(baseIdx).toBeGreaterThan(-1);
            expect(guardIdx).toBeGreaterThan(-1);
            expect(guardIdx).toBeGreaterThan(baseIdx);
        });
    }

    it('structureView.js still drives these elements via the hidden attribute (guards would be dead otherwise)', () => {
        const js = read('structureView.js');
        expect(js).toMatch(/\.hidden\s*=/);
        expect(js).toMatch(/filterClearEl\.hidden/);
    });
});

// The detail-column code viewer toggles four elements the same way, and each of
// them declares a `display` too — so each needs the same guard. The pane and its
// empty state are the pair that swaps as a file opens and closes; the banner and
// the two chunk loaders come and go within an open file.
describe('Code-viewer [hidden] guards override the base display declaration', () => {
    const css = read('style.css');

    function ruleBody(selector) {
        const start = css.indexOf(selector + ' {');
        if (start === -1) return null;
        const open = css.indexOf('{', start);
        const close = css.indexOf('}', open);
        if (open === -1 || close === -1) return null;
        return css.slice(open + 1, close);
    }

    const cases = [
        '.codeViewerPane',
        '.codeViewerEmpty',
        '.codeViewerBanner',
        '.codeViewerStatus',
        '.codeViewerMore',
    ];

    for (const selector of cases) {
        it(`${selector} declares display in its base rule (the reason the guard is needed)`, () => {
            const body = ruleBody(selector);
            expect(body).not.toBeNull();
            expect(body).toMatch(/display:\s*(?:flex|inline-flex|block)/);
        });

        it(`${selector}[hidden] { display: none } guard exists so .hidden = true actually hides`, () => {
            const guard = new RegExp(
                selector.replace('.', '\\.') + '\\[hidden\\]\\s*\\{\\s*display:\\s*none'
            );
            expect(css).toMatch(guard);
        });

        it(`the ${selector}[hidden] guard comes AFTER its base rule so source order wins at equal specificity`, () => {
            const baseIdx = css.indexOf(selector + ' {');
            const guardIdx = css.indexOf(selector + '[hidden]');
            expect(baseIdx).toBeGreaterThan(-1);
            expect(guardIdx).toBeGreaterThan(-1);
            expect(guardIdx).toBeGreaterThan(baseIdx);
        });
    }

    it('codeViewer.js still drives these elements via the hidden attribute', () => {
        const js = read('codeViewer.js');
        expect(js).toMatch(/\.hidden\s*=/);
        expect(js).toMatch(/moreUp\.hidden/);
        expect(js).toMatch(/banner\.hidden/);
    });

    it('codeViewer.js styles through classes only — no inline style writes, no innerHTML', () => {
        const js = read('codeViewer.js');
        expect(js).not.toMatch(/\.style\./);
        expect(js).not.toMatch(/setProperty\(/);
        // Fetched repo source reaches the DOM through textContent, never markup.
        expect(js).not.toMatch(/innerHTML\s*=/);
    });
});
