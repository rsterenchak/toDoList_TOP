import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// TODO.md desktop rail strip: `.todoMdViewerStrip` pins at the top of the queue
// rail alongside the task rows, the compose row, and the COMPLETED divider — all
// of which carry an 8px horizontal inset from the column edge (#toDoChild uses
// `margin: 5px 8px`; the desktop #completedHeader uses `margin: 6px 8px 16px`).
// The strip shipped with `margin: 0 0 6px` — zero horizontal — so it spanned the
// rail's full width and its border collided with the column boundary while every
// neighbouring element sat inset. This test pins the strip to the shared 8px inset
// so its edges line up with the rows. Desktop-only: the strip lives inside
// `@media (min-width: 1024px)`.
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

describe('TODO.md rail strip — outer edges inset to match the task rows', () => {
    const block = media1024BlockContaining('.todoMdViewerStrip');

    it('declares the strip inside the desktop @media block', () => {
        expect(block).not.toBeNull();
    });

    it('carries the shared 8px horizontal inset so its border does not touch the column edge', () => {
        const decl = rule(block, '.todoMdViewerStrip');
        expect(decl).not.toBeNull();
        const margin = decl.match(/(?:^|;)\s*margin:\s*([^;]+)/);
        expect(margin).not.toBeNull();
        // margin: <top> <horizontal> <bottom> — the horizontal value must be 8px,
        // matching #toDoChild (5px 8px) and the desktop #completedHeader
        // (6px 8px 16px). A zero horizontal inset is the bug this pins against.
        expect(margin[1].trim()).toMatch(/^0\s+8px\s+6px$/);
    });
});
