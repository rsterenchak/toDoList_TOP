import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// Regression guard for "Detail pane: let the phase rail and mode strip span the
// pane's width". In the wide detail pane the phase rail and the WRITE / PASTE /
// GENERATE mode strip both rendered compressed at the left: the rail was capped
// at `max-width: 440px` + `justify-self: start`, and the strip was `inline-flex`
// so it shrank to its content. The fix lets both fill the content column.
//
// jsdom does not compute layout, so this asserts on the CSS declarations that
// PRODUCE the width behaviour, scoped to the #descSibling (desktop pane) host so
// the narrower mobile modal keeps its compact treatment.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const css = readFileSync(resolve(srcDir, 'style.css'), 'utf8');

// Return the declaration body of the FIRST top-level rule whose (possibly
// comma-grouped) selector list contains `needle`.
function ruleBodyContaining(needle) {
    let depth = 0;
    let selectorStart = 0;
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '{') {
            if (depth === 0) {
                const selector = css.slice(selectorStart, i);
                if (selector.includes(needle)) {
                    const blockEnd = css.indexOf('}', i);
                    return css.slice(i + 1, blockEnd);
                }
            }
            depth++;
            continue;
        }
        if (c === '}') {
            depth--;
            if (depth === 0) selectorStart = i + 1;
            continue;
        }
    }
    return null;
}

describe('detail pane: phase rail spans the content column', () => {
    const rail = ruleBodyContaining('#descSibling .phaseRail');

    it('the rail host rule exists', () => {
        expect(rail).not.toBeNull();
    });

    it('no longer caps the rail width (max-width removed)', () => {
        expect(rail).not.toMatch(/max-width:/);
    });

    it('stretches rather than left-aligning so connectors absorb the width', () => {
        expect(rail).not.toMatch(/justify-self:\s*start/);
        expect(rail).toMatch(/justify-self:\s*stretch/);
    });

    it('keeps its content-column placement', () => {
        expect(rail).toMatch(/grid-column:\s*2/);
    });

    it('the shared connector remains the flexible element', () => {
        // The rail only spreads if the connector, not the node, takes the slack.
        const connector = ruleBodyContaining('.phaseRailConnector');
        expect(connector).toMatch(/flex:\s*1 1 0/);
    });
});

describe('detail pane: mode strip spans the content column as equal thirds', () => {
    const strip = ruleBodyContaining('#descSibling .descModeStrip');
    const seg = ruleBodyContaining('#descSibling .descModeStripSeg');

    it('the host strip rule switches to full-width flex', () => {
        expect(strip).not.toBeNull();
        expect(strip).toMatch(/display:\s*flex/);
        // Base rule is `width: fit-content`; the host must reset it so the strip fills.
        expect(strip).not.toMatch(/width:\s*fit-content/);
        expect(strip).toMatch(/grid-column:\s*2/);
    });

    it('the segments divide the width equally', () => {
        expect(seg).not.toBeNull();
        expect(seg).toMatch(/flex:\s*1 1 0/);
        expect(seg).toMatch(/min-width:\s*0/);
    });

    it('the shared base strip keeps its compact inline treatment for the modal host', () => {
        // The un-scoped base rule (line-anchored, not the `#descSibling`-prefixed
        // one) must stay inline-flex/fit-content so the mobile modal is not widened.
        const base = css.match(/\n\.descModeStrip\s*\{([^}]*)\}/);
        expect(base).not.toBeNull();
        expect(base[1]).toMatch(/display:\s*inline-flex/);
        expect(base[1]).toMatch(/width:\s*fit-content/);
    });
});
