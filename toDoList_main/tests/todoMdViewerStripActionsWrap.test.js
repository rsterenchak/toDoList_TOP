import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// TODO.md desktop rail strip: the relocated action controls (synced label, Run
// backlog, Redeploy, Sync, overflow) sit in `.todoMdViewerStripActions`, a nested
// flex row with `margin-left: auto`. Without `flex-wrap` its children could not
// break, so the whole group overflowed the rail as a single unit and the sync
// chip / overflow / expand controls clipped off the right edge — the queue rail
// can shrink toward ~260px when the chat pane docks. The fix makes the actions
// group wrap, sheds the Redeploy label at narrow rail widths (glyph + aria-label
// carry it), and drops the auto margin so a wrapped row starts at the left edge.
// Because the rail width is decoupled from the viewport (the chat pane narrows it
// without a viewport change), the shed threshold is a container query on the
// strip, not a viewport @media. These tests pin that CSS. Desktop-only: the strip
// lives inside `@media (min-width: 1024px)`.
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Return the comment-stripped body of the first `@media (min-width: 1024px)`
// block whose declarations mention `needle`. Naive brace matching, matching the
// other CSS-pinning tests in this suite.
function media1024BlockContaining(needle) {
    let idx = 0;
    while ((idx = css.indexOf('@media (min-width: 1024px)', idx)) !== -1) {
        const start = css.indexOf('{', idx);
        let depth = 0;
        let end = css.length;
        for (let i = start; i < css.length; i++) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') {
                depth--;
                if (depth === 0) { end = i; break; }
            }
        }
        const body = css.slice(start + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
        if (body.includes(needle)) return body;
        idx = end;
    }
    return null;
}

function rule(body, selector) {
    const re = new RegExp(selector.replace(/[#.]/g, m => '\\' + m) + '\\s*\\{([^}]*)\\}');
    const m = body.match(re);
    return m ? m[1] : null;
}

describe('TODO.md rail strip — actions adapt to column width', () => {
    const block = media1024BlockContaining('.todoMdViewerStripActions');

    it('declares the strip inside the desktop @media block', () => {
        expect(block).not.toBeNull();
    });

    it('the actions group wraps instead of clipping as a single unit', () => {
        const decl = rule(block, '.todoMdViewerStripActions');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/flex-wrap:\s*wrap/);
    });

    it('makes the strip an inline-size query container so it responds to rail width', () => {
        const decl = rule(block, '.todoMdViewerStrip');
        expect(decl).not.toBeNull();
        expect(decl).toMatch(/container-type:\s*inline-size/);
    });

    it('sheds the Redeploy label and drops the auto margin at narrow rail widths', () => {
        // A container query — not a viewport @media — because the rail narrows
        // (chat pane docking) without any viewport change.
        expect(block).toMatch(/@container[^{]*\{[\s\S]*?\}/);
        const containerIdx = block.indexOf('@container');
        const containerBody = block.slice(containerIdx);
        // The Redeploy visible label hides (glyph + aria-label remain).
        expect(containerBody).toMatch(/todoMdViewerDeployPillLabel[\s\S]*?display:\s*none/);
        // The auto margin is dropped so a wrapped row starts flush left.
        expect(containerBody).toMatch(/todoMdViewerStripActions[\s\S]*?margin-left:\s*0/);
    });
});
