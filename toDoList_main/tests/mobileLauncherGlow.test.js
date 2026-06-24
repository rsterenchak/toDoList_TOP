import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression guard for the mobile chat-button glow. A prior PR added the glow
// as a `::before` pseudo-element with `z-index: -1`, but #claudeLauncher is
// `position: fixed` (+ z-index) and so forms its own stacking context — the
// negative-z pseudo painted just above the button's opaque fill at ~15–18%
// opacity and was effectively invisible on real devices. A green Shipped badge
// was not proof the glow rendered. The fix paints the halo with box-shadow
// rings (which draw OUTSIDE the opaque fill, so they always show) and these
// tests pin the invariant that silently no-op'd before: the glow rule must
// target the EXACT id the launcher is rendered with, must live inside the
// mobile media query, and must carry the Void accent color in a glow property.
describe('mobile Claude launcher glow', () => {
    const css = read('style.css');
    const claudeSheet = read('claudeSheet.js');

    // The id the launcher button is actually rendered with, read from the
    // factory in claudeSheet.js (`btn.id = 'claudeLauncher'`). The glow rule's
    // selector is cross-checked against THIS so a future rename of either side
    // without the other fails the test rather than silently missing the button.
    function renderedLauncherId() {
        // Scope to the buildLauncher factory so reordering other id-bearing
        // factories in the file can't make this match the wrong element.
        const fn = claudeSheet.match(/function\s+buildLauncher\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        expect(fn, 'expected a buildLauncher factory in claudeSheet.js').toBeTruthy();
        const m = fn[1].match(/\.id\s*=\s*['"]([^'"]+)['"]/);
        expect(m, 'expected buildLauncher to assign an id literal').toBeTruthy();
        return m[1];
    }

    // Concatenated text of every `@media (max-width: 1023px)` block. The glow
    // must be gated to mobile (the launcher is replaced by the persistent
    // desktop chat pane at ≥1024px), so the rule must live in one of these.
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

    // Body of the lone `#<id> { ... }` rule inside `haystack`, comments removed.
    function ruleBody(haystack, id) {
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const re = new RegExp('#' + id + '\\s*\\{([^}]*)\\}', 'm');
        const m = stripped.match(re);
        return m ? m[1] : null;
    }

    it('renders the launcher with the id the glow rule targets', () => {
        const id = renderedLauncherId();
        expect(id).toBe('claudeLauncher');
        // The CSS must contain a rule for exactly this id — i.e. the selector
        // matches the rendered button, not some stale or mistyped name.
        expect(css.includes('#' + id)).toBe(true);
    });

    it('puts a Void-accent glow on the launcher inside the mobile media query', () => {
        const id = renderedLauncherId();
        const body = ruleBody(mobileMediaText(), id);
        expect(body, `expected a #${id} rule inside @media (max-width: 1023px)`).toBeTruthy();
        // The glow must be a real visible layer: a box-shadow (or radial glow)
        // carrying the Void accent #6C5DF5 → rgb(108, 93, 245). This is the
        // assertion that would have failed against the washed-out no-op.
        expect(/box-shadow|radial-gradient/.test(body)).toBe(true);
        expect(/108\s*,\s*93\s*,\s*245|#6C5DF5/i.test(body)).toBe(true);
    });

    it('paints the launcher as a purple FAB with a white sparkle glyph', () => {
        const id = renderedLauncherId();
        const body = ruleBody(mobileMediaText(), id);
        expect(body, `expected a #${id} rule inside @media (max-width: 1023px)`).toBeTruthy();
        // Purple FAB face: the Void accent #6C5DF5 set as the background, so the
        // button reads as a primary launcher rather than a neutral dark dot.
        expect(/background\s*:\s*#6C5DF5/i.test(body)).toBe(true);
        // White glyph centered on the purple face.
        expect(/color\s*:\s*#(?:fff|ffffff)/i.test(body)).toBe(true);
        // The launcher factory renders the sparkle (✦) icon, not the old "⋯".
        const fn = claudeSheet.match(/function\s+buildLauncher\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        expect(fn, 'expected a buildLauncher factory in claudeSheet.js').toBeTruthy();
        expect(/textContent\s*=\s*['"]✦['"]/.test(fn[1])).toBe(true);
    });

    it('builds the glow as a three-layer Void-accent halo', () => {
        const id = renderedLauncherId();
        const body = ruleBody(mobileMediaText(), id) || '';
        const shadow = body.match(/box-shadow\s*:([^;]*)/i);
        expect(shadow, `expected a box-shadow on #${id}`).toBeTruthy();
        // Three radial glow layers carry the Void accent in rgba form; a final
        // dark drop shadow may follow. Count the accent-colored layers.
        const accentLayers = (shadow[1].match(/rgba\(\s*108\s*,\s*93\s*,\s*245/gi) || []).length;
        expect(accentLayers).toBeGreaterThanOrEqual(3);
    });

    it('keeps the launcher in its fixed position (no layout-shifting glow)', () => {
        const id = renderedLauncherId();
        const body = ruleBody(mobileMediaText(), id) || '';
        // The glow must not reposition or resize the button — only box-shadow /
        // visual layers are allowed in the mobile glow rule.
        expect(/position\s*:/.test(body)).toBe(false);
        expect(/(^|[;{])\s*(top|left|right|bottom|width|height)\s*:/.test(body)).toBe(false);
    });
});
