import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { DESC_PANEL_CHILD_SELECTORS } from '../src/toDoRow.js';

// The detail-pane MOCKUP-phase flow — the shared A/B/C mockup flow mounted for a
// `needs_mockup` task above the authoring region, laid out three variants across —
// is source-pinned like the ASKING / STUCK / Dispatch / REVIEW block wiring
// (buildToDoRow is too heavily wired to instantiate end-to-end in jsdom — see the
// row-layer test caveat). These pins assert it mounts only in the mockup phase and
// only in detail-pane mode, reuses the SHARED mockupFlow implementation rather than
// a second copy, is grid-placed, is excluded from the done-phase authoring hide,
// and repaints on both open and the live sweep — plus the CSS that lays the three
// variants across and scales each preview to fit its tile.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');
const toDoRow = read('toDoRow.js');
const css = read('style.css');

function ruleBodyContaining(cssText, needle) {
    let depth = 0;
    let selectorStart = 0;
    for (let i = 0; i < cssText.length; i++) {
        const c = cssText[i];
        if (c === '{') {
            if (depth === 0 && cssText.slice(selectorStart, i).includes(needle)) {
                return cssText.slice(i + 1, cssText.indexOf('}', i));
            }
            depth++;
        } else if (c === '}') {
            depth--;
            if (depth === 0) selectorStart = i + 1;
        }
    }
    return null;
}

describe('toDoRow MOCKUP-phase pane flow wiring', () => {
    it('mounts the flow only for the mockup phase', () => {
        expect(toDoRow).toMatch(/function syncMockupPanel\(/);
        const start = toDoRow.indexOf('function syncMockupPanel(');
        const body = toDoRow.slice(start, start + 1400);
        expect(body).toMatch(/phase === PHASE\.MOCKUP/);
    });

    it('is DESKTOP-ONLY — gated on detail-pane mode so nothing mounts on mobile', () => {
        const start = toDoRow.indexOf('function syncMockupPanel(');
        const body = toDoRow.slice(start, start + 300);
        expect(body).toMatch(/if \(!isDetailPaneMode\(\)\) return;/);
    });

    it('reuses the SHARED mockupFlow implementation, not a reimplementation', () => {
        expect(toDoRow).toMatch(/import \{ buildMockupSecondary \} from '\.\/mockupFlow\.js'/);
        // The row layer must not import the Agent view (cycle-avoidance boundary).
        expect(toDoRow).not.toMatch(/from '\.\/agentView\.js'/);
        const start = toDoRow.indexOf('function buildMockupPanelBlock(');
        const body = toDoRow.slice(start, start + 900);
        // Requests the three-across grid layout and a height re-snapshot hook, both
        // routed through the shared renderer's options.
        expect(body).toMatch(/buildMockupSecondary\(queueRow, \{/);
        expect(body).toMatch(/grid: true/);
        expect(body).toMatch(/onRender: refreshViewerExpandedHeight/);
    });

    it('mounts on panel open AND repaints on the live sweep (one def + two call sites)', () => {
        const calls = toDoRow.match(/syncMockupPanel\(/g) || [];
        expect(calls.length).toBeGreaterThanOrEqual(3);
    });

    it('re-applies the expanded-viewer height when the block is added or removed', () => {
        const start = toDoRow.indexOf('function syncMockupPanel(');
        const body = toDoRow.slice(start, start + 1400);
        expect(body).toMatch(/refreshViewerExpandedHeight\(\)/);
    });

    it('registers the block in the panel child grid contract, placed full-width', () => {
        expect(DESC_PANEL_CHILD_SELECTORS).toContain('#descSibling .descMockupBlock');
        const body = ruleBodyContaining(css, '#descSibling .descMockupBlock');
        expect(body).not.toBeNull();
        expect(body).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    });

    it('is NOT in the authoring group hidden by applyPhaseLayout (mockup is never done/accept)', () => {
        const start = toDoRow.indexOf('DESC_AUTHORING_GROUP_SELECTORS = Object.freeze([');
        const group = toDoRow.slice(start, toDoRow.indexOf(']', start));
        expect(group).not.toMatch(/descMockupBlock/);
    });

    it('lays the three variants across and scales each preview to fit its tile', () => {
        // Three-across grid on the pane's preview container.
        const grid = ruleBodyContaining(css, '.agentMockup--grid .agentMockupPreviews');
        expect(grid).not.toBeNull();
        expect(grid).toMatch(/display:\s*grid/);
        expect(grid).toMatch(/grid-template-columns:\s*repeat\(3,/);
        // Each scaled frame renders at a fixed authoring width inside a clipping
        // wrapper and is shrunk with a transform — the frame is positioned and
        // transform-origin'd for the JS-driven scale.
        const scaler = ruleBodyContaining(css, '.agentMockupFrameScaler');
        expect(scaler).not.toBeNull();
        expect(scaler).toMatch(/overflow:\s*hidden/);
        const framed = ruleBodyContaining(css, '.agentMockupFrameScaler .agentMockupFrame');
        expect(framed).not.toBeNull();
        expect(framed).toMatch(/transform-origin:\s*top left/);
    });
});
