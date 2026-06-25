import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression guard for the vertical centering of the white sparkle (✦) glyph
// inside the mobile chat FAB (#claudeLauncher). The glyph is rendered as raw
// button text, so flex centering (in the base rule) only centers the line box —
// the ✦ ink sits high within its em box and reads visually off-center on the
// FAB. The fix keeps flex centering as the primary mechanism AND adds a small
// vertical optical correction (a `transform: translateY(...)`) in the mobile
// rule. These tests pin both halves: lose the flex centering or the nudge and
// the glyph drifts off-center again.
describe('mobile Claude launcher sparkle centering', () => {
    const css = read('style.css');

    // Body of the lone `#<id> { ... }` rule that appears in `haystack`, with
    // comments stripped so commentary can't satisfy a property assertion.
    function ruleBody(haystack, id) {
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const re = new RegExp('#' + id + '\\s*\\{([^}]*)\\}', 'm');
        const m = stripped.match(re);
        return m ? m[1] : null;
    }

    // Body of the base (non-media) #claudeLauncher rule. The base rule's
    // selector starts at column 0, while every media-nested launcher rule is
    // indented inside its block — so anchor on a line-start selector to pick
    // the base rule specifically.
    function baseLauncherBody() {
        const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
        const m = stripped.match(/^#claudeLauncher\s*\{([^}]*)\}/m);
        return m ? m[1] : null;
    }

    // Concatenated text of every `@media (max-width: 1023px)` block — the mobile
    // breakpoint that styles the FAB (the launcher is replaced by the desktop
    // chat pane at >=1024px, so the FAB only exists here).
    function mobileMediaText() {
        let out = '';
        let cursor = 0;
        while (true) {
            const media = css.indexOf('@media (max-width: 1023px)', cursor);
            if (media === -1) break;
            let depth = 0;
            let end = css.length;
            for (let i = css.indexOf('{', media); i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) { end = i + 1; break; }
                }
            }
            out += css.slice(media, end) + '\n';
            cursor = end;
        }
        return out;
    }

    it('flex-centers the glyph on the base launcher rule', () => {
        const body = baseLauncherBody();
        expect(body, 'expected a base #claudeLauncher rule').toBeTruthy();
        expect(/display\s*:\s*flex/.test(body)).toBe(true);
        expect(/align-items\s*:\s*center/.test(body)).toBe(true);
        expect(/justify-content\s*:\s*center/.test(body)).toBe(true);
        // line-height: 1 keeps the line box equal to the glyph's em box so flex
        // centering has nothing extra to offset.
        expect(/line-height\s*:\s*1\b/.test(body)).toBe(true);
    });

    it('applies a vertical optical-centering nudge to the FAB glyph', () => {
        const body = ruleBody(mobileMediaText(), 'claudeLauncher');
        expect(body, 'expected a #claudeLauncher rule inside @media (max-width: 1023px)').toBeTruthy();
        const transform = body.match(/transform\s*:([^;]*)/i);
        expect(transform, 'expected a transform on the mobile #claudeLauncher rule').toBeTruthy();
        // The correction must shift the glyph up by a fixed 15px to land the ✦
        // ink on the FAB's optical center.
        const ty = transform[1].match(/translateY\(\s*(-?[\d.]+)([a-z%]*)\s*\)/i);
        expect(ty, 'expected a translateY(...) optical correction').toBeTruthy();
        expect(parseFloat(ty[1])).toBe(-15);
        expect(ty[2]).toBe('px');
    });

    it('does not reposition or resize the FAB while correcting the glyph', () => {
        // Mirrors the glow regression guard: the centering fix must be purely a
        // glyph nudge — no layout-shifting position/size changes on the FAB.
        const body = ruleBody(mobileMediaText(), 'claudeLauncher') || '';
        expect(/position\s*:/.test(body)).toBe(false);
        expect(/(^|[;{])\s*(top|left|right|bottom|width|height)\s*:/.test(body)).toBe(false);
    });
});
