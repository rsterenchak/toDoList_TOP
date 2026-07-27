import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the header polish after the view sub-band was retired. Two things:
//   (1) the STREAM / STRUCTURE tabs render as bordered pills (the base
//       .viewPill treatment) rather than the flat underlined-text override the
//       old tab-strip band used, and
//   (2) the taller two-line project block gets vertical + horizontal breathing
//       room in the header instead of sitting flush against the top edge and
//       crowding the pills.
// Verified via CSS source inspection because jsdom does no layout and main.js
// is too large to instantiate (per CLAUDE.md guidance).
describe('header — bordered STREAM/STRUCTURE pills + project-block spacing', () => {
    const css = read('style.css');

    // Slice the desktop header consolidation media region so these assertions
    // read only the desktop header rules.
    function consolidationBlock() {
        const start = css.indexOf('DESKTOP HEADER CONSOLIDATION');
        expect(start).toBeGreaterThan(-1);
        const end = css.indexOf('D2 — DESKTOP TWO-PANE CHAT', start);
        expect(end).toBeGreaterThan(start);
        return css.slice(start, end);
    }

    it('(1) removes the flat #navBar .viewPill underlined-text override', () => {
        const block = consolidationBlock();
        // No per-navBar override rule stripping the pill chrome...
        expect(block).not.toMatch(/#navBar\s+\.viewPill\s*\{/);
        expect(block).not.toMatch(/#navBar\s+\.viewPill\.active/);
        // ...and no residual ::after underline marker on the active pill.
        expect(block).not.toMatch(/\.viewPill\.active::after/);
    });

    it('(1) base .viewPill keeps the reviewed bordered-pill treatment', () => {
        const rule = css.match(/\n\.viewPill\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/border:\s*0\.5px solid/);
        expect(rule[1]).toMatch(/border-radius:\s*6px/);
        const active = css.match(/\n\.viewPill\.active\s*\{([^}]*)\}/);
        expect(active).not.toBeNull();
        expect(active[1]).toMatch(/background:\s*rgba\(108, 93, 245/);
        expect(active[1]).toMatch(/border-color:\s*#6C5DF5/);
    });

    it('(2) opens horizontal space between the project block and the pills without a second auto margin', () => {
        const block = consolidationBlock();
        const m = block.match(/#navBar\s+#viewSwitcher\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        const ml = m[1].match(/margin-left:\s*(\d+)px/);
        expect(ml).not.toBeNull();
        expect(parseInt(ml[1], 10)).toBeGreaterThanOrEqual(8);
        // The row's only auto margin stays the chip cluster's margin-left:auto;
        // the switcher's own margin-right:auto is still cleared to 0.
        expect(m[1]).not.toMatch(/margin-left:\s*auto/);
        expect(m[1]).toMatch(/margin-right:\s*0/);
    });

    it('(2) gives the header extra height at desktop so the two-line block breathes', () => {
        const block = consolidationBlock();
        const m = block.match(/:root\s*\{([^}]*)\}/);
        expect(m).not.toBeNull();
        const nh = m[1].match(/--nav-h:\s*(\d+)px/);
        expect(nh).not.toBeNull();
        // Base --nav-h is 44px; desktop grows it for the two-line block.
        expect(parseInt(nh[1], 10)).toBeGreaterThan(44);
    });

    it('(3) the changes are scoped to the desktop media query (>= 1024px)', () => {
        const block = consolidationBlock();
        expect(block).toMatch(/@media \(min-width:\s*1024px\)/);
    });
});
