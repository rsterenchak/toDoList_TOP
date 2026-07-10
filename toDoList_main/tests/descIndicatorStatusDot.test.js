import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';

import {
    hasShippedRunForEntry,
    CLAUDE_RUNS_KEY,
} from '../src/inject.js';
// refreshDescStatusDots is exactly what the module-level TODO_RUN_STATUS_EVENT
// listener delegates to; calling it drives the same production dot logic.
import { refreshDescStatusDots } from '../src/toDoRow.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Feature: a small run-status dot overlaid on #descIndicator — green once the
// row's injected entry has shipped a run, amber while injected-but-pending, and
// absent when the entry was never injected. buildToDoRow is too heavily wired to
// instantiate here, so the DOM behaviour is driven through a light #toDoChild
// stand-in plus the real document listener; the inject correlation helper and
// the wiring are exercised functionally and by source inspection.

function setRuns(records) {
    localStorage.setItem(CLAUDE_RUNS_KEY, JSON.stringify(records));
}

// Mirror the subset of buildToDoRow's output the dot logic touches: a
// #toDoChild carrying an __item anchor, with a nested #descIndicator.
function makeRow(item) {
    const ml = document.getElementById('mainList') || (function () {
        const el = document.createElement('div');
        el.id = 'mainList';
        document.body.appendChild(el);
        return el;
    })();
    const row = document.createElement('div');
    row.id = 'toDoChild';
    row.__item = item;
    const indicator = document.createElement('span');
    indicator.id = 'descIndicator';
    row.appendChild(indicator);
    ml.appendChild(row);
    return { row, indicator };
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});
afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
});

describe('hasShippedRunForEntry — run correlation helper', () => {
    it('returns false with no run records stored', () => {
        expect(hasShippedRunForEntry('abc')).toBe(false);
    });

    it('returns false when no record with a SHIPPED status matches the entry', () => {
        setRuns([
            { entryId: 'abc', status: 'RUNNING' },
            { entryId: 'abc', status: 'QUEUED' },
            { entryId: 'other', status: 'SHIPPED' },
        ]);
        expect(hasShippedRunForEntry('abc')).toBe(false);
    });

    it('returns true when a SHIPPED record correlates to the entry id', () => {
        setRuns([
            { entryId: 'abc', status: 'FAILED' },
            { entryId: 'abc', status: 'SHIPPED' },
        ]);
        expect(hasShippedRunForEntry('abc')).toBe(true);
    });

    it('returns false for a falsy entry id and tolerates malformed storage', () => {
        expect(hasShippedRunForEntry('')).toBe(false);
        expect(hasShippedRunForEntry(null)).toBe(false);
        localStorage.setItem(CLAUDE_RUNS_KEY, 'not json {');
        expect(hasShippedRunForEntry('abc')).toBe(false);
        localStorage.setItem(CLAUDE_RUNS_KEY, JSON.stringify({ not: 'an array' }));
        expect(hasShippedRunForEntry('abc')).toBe(false);
    });
});

describe('description-status dot — live refresh through the document listener', () => {
    it('renders no dot when the entry was never injected', () => {
        const { indicator } = makeRow({ entryId: 'abc', injectedAt: null });
        refreshDescStatusDots();
        expect(indicator.querySelector('.dot')).toBeNull();
    });

    it('renders an amber pending dot when injected but not yet shipped', () => {
        const { indicator } = makeRow({ entryId: 'abc', injectedAt: 1700000000000 });
        refreshDescStatusDots();
        const dot = indicator.querySelector('.dot');
        expect(dot).not.toBeNull();
        expect(dot.classList.contains('dot--pending')).toBe(true);
    });

    it('renders a green shipped dot (no pending modifier) once a SHIPPED run correlates', () => {
        setRuns([{ entryId: 'abc', status: 'SHIPPED' }]);
        const { indicator } = makeRow({ entryId: 'abc', injectedAt: 1700000000000 });
        refreshDescStatusDots();
        const dot = indicator.querySelector('.dot');
        expect(dot).not.toBeNull();
        expect(dot.classList.contains('dot--pending')).toBe(false);
    });

    it('flips a pending dot to shipped in place when the run reconciles', () => {
        const { indicator } = makeRow({ entryId: 'abc', injectedAt: 1700000000000 });
        refreshDescStatusDots();
        expect(indicator.querySelector('.dot').classList.contains('dot--pending')).toBe(true);

        // The run reconciles to SHIPPED and claudeSheet re-emits the event.
        setRuns([{ entryId: 'abc', status: 'SHIPPED' }]);
        refreshDescStatusDots();
        const dots = indicator.querySelectorAll('.dot');
        expect(dots.length).toBe(1); // reused in place, not duplicated
        expect(dots[0].classList.contains('dot--pending')).toBe(false);
    });
});

describe('wiring — dot is built on render and updated by the pipeline', () => {
    const toDoRow = read('toDoRow.js');
    const inject = read('inject.js');
    const claudeSheet = read('claudeSheet.js');
    const css = read('style.css');

    it('buildToDoRow overlays the status dot right after inserting the indicator', () => {
        expect(toDoRow).toMatch(
            /insertBefore\(descIndicator,\s*toDoInput\);[\s\S]{0,400}applyDescStatusDot\(descIndicator,\s*item\)/
        );
    });

    it('refreshDescStatusDots sweeps every rendered indicator', () => {
        expect(toDoRow).toMatch(
            /export\s+function\s+refreshDescStatusDots\s*\([\s\S]{0,240}querySelectorAll\(\s*['"]#descIndicator['"]\)/
        );
    });

    it('a single document listener delegates to refreshDescStatusDots on the run-status event', () => {
        expect(toDoRow).toMatch(
            /document\.addEventListener\(\s*TODO_RUN_STATUS_EVENT\s*,\s*refreshDescStatusDots\s*\)/
        );
    });

    it('inject.js emits the run-status event after a successful inject', () => {
        expect(inject).toMatch(
            /refreshInjectButton\(btn,\s*item\);[\s\S]{0,200}emitTodoRunStatusChange\(\)/
        );
    });

    it('claudeSheet.js emits the run-status event whenever run records persist', () => {
        expect(claudeSheet).toMatch(
            /function\s+saveRunRecords\s*\([\s\S]{0,500}emitTodoRunStatusChange\(\)/
        );
    });

    it('the dot is styled from theme tokens and anchored inside the indicator', () => {
        expect(css).toMatch(/#descIndicator\s*\{[\s\S]{0,160}position:\s*relative/);
        expect(css).toMatch(/#descIndicator\s+\.dot\s*\{[\s\S]{0,200}background:\s*var\(--type-feature\)/);
        expect(css).toMatch(/#descIndicator\s+\.dot--pending\s*\{[\s\S]{0,120}background:\s*var\(--text-warning\)/);
    });
});
