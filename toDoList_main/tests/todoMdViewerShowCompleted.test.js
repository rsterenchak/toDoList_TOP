import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    parseTodoMdChecklist,
    filterCompletedTokens,
    countCompletedTodoMdEntries,
    buildViewerRenderedBody,
} from '../src/todoMdViewer.js';
import {
    isTodoMdShowCompleted,
    setTodoMdShowCompleted,
    TODO_MD_SHOW_COMPLETED_KEY,
} from '../src/prefs.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// A fixture with one heading, two completed entries (one with the full
// sub-bullet structure + marker, one minimal), and one active entry. Mirrors
// the real TODO.md shape so the hide-range logic is exercised end to end.
const FIXTURE = [
    '# TODO LIST',
    '',
    '- [x] **[MEDIUM]** Painted the strip',
    '  - Type: bug',
    '  - Description: some long description',
    '  - File: src/style.css',
    '  - Completed: 2026-06-07',
    '  <!-- id: aaaaaaaa-0000-0000-0000-000000000001 -->',
    '',
    '- [ ] **[HIGH]** Add the toggle',
    '  - Type: feature',
    '  - Description: the active task',
    '  - File: src/main.js',
    '  <!-- id: bbbbbbbb-0000-0000-0000-000000000002 -->',
    '',
    '- [x] Minimal done entry',
    '',
].join('\n');

describe('todo.md viewer — show-completed pref (prefs.js)', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('uses the todoapp_-prefixed key', () => {
        expect(TODO_MD_SHOW_COMPLETED_KEY).toBe('todoapp_todoMdShowCompleted');
    });

    it('defaults to OFF (false) when no key is set', () => {
        expect(isTodoMdShowCompleted()).toBe(false);
    });

    it('persists true / false as the documented strings', () => {
        setTodoMdShowCompleted(true);
        expect(localStorage.getItem(TODO_MD_SHOW_COMPLETED_KEY)).toBe('true');
        expect(isTodoMdShowCompleted()).toBe(true);
        setTodoMdShowCompleted(false);
        expect(localStorage.getItem(TODO_MD_SHOW_COMPLETED_KEY)).toBe('false');
        expect(isTodoMdShowCompleted()).toBe(false);
    });

    it('only the exact string "true" reads as ON', () => {
        localStorage.setItem(TODO_MD_SHOW_COMPLETED_KEY, 'TRUE');
        expect(isTodoMdShowCompleted()).toBe(false);
        localStorage.setItem(TODO_MD_SHOW_COMPLETED_KEY, '1');
        expect(isTodoMdShowCompleted()).toBe(false);
    });
});

describe('todo.md viewer — filterCompletedTokens / count', () => {
    it('counts completed top-level entries regardless of hide flag', () => {
        expect(countCompletedTodoMdEntries(FIXTURE)).toBe(2);
        // The count is independent of whether we are hiding.
        const tokens = parseTodoMdChecklist(FIXTURE);
        expect(filterCompletedTokens(tokens, true).completedCount).toBe(2);
        expect(filterCompletedTokens(tokens, false).completedCount).toBe(2);
    });

    it('reports (0) when there are no completed entries', () => {
        expect(countCompletedTodoMdEntries('# TODO LIST\n\n- [ ] Only active\n')).toBe(0);
    });

    it('when hiding, drops the completed checkbox line AND all its nested lines', () => {
        const tokens = parseTodoMdChecklist(FIXTURE);
        const kept = filterCompletedTokens(tokens, true).tokens;
        const texts = kept.map((t) => t.text);
        // No completed top-level lines survive.
        expect(kept.some((t) => t.type === 'checkbox' && t.checked)).toBe(false);
        // The completed entry's sub-bullets and marker are gone.
        expect(texts.some((t) => /Painted the strip/.test(t))).toBe(false);
        expect(texts.some((t) => /some long description/.test(t))).toBe(false);
        expect(texts.some((t) => /id: aaaaaaaa/.test(t))).toBe(false);
        expect(texts.some((t) => /Minimal done entry/.test(t))).toBe(false);
        // The active entry and its sub-bullets survive intact.
        expect(texts.some((t) => /Add the toggle/.test(t))).toBe(true);
        expect(texts.some((t) => /the active task/.test(t))).toBe(true);
        // The heading always survives.
        expect(kept.some((t) => t.type === 'heading')).toBe(true);
    });

    it('when not hiding, keeps every token unchanged', () => {
        const tokens = parseTodoMdChecklist(FIXTURE);
        const kept = filterCompletedTokens(tokens, false).tokens;
        expect(kept).toHaveLength(tokens.length);
    });

    it('an active entry following a completed one ends the hide range', () => {
        const text = [
            '- [x] done',
            '  - sub of done',
            '- [ ] active',
            '  - sub of active',
        ].join('\n');
        const kept = filterCompletedTokens(parseTodoMdChecklist(text), true).tokens;
        const texts = kept.map((t) => t.text);
        // Non-checkbox sub-bullets are 'text' tokens that retain their raw
        // indentation, so match against the full line text.
        expect(texts).toContain('active');
        expect(texts).toContain('  - sub of active');
        expect(texts).not.toContain('done');
        expect(texts).not.toContain('  - sub of done');
    });
});

describe('todo.md viewer — buildViewerRenderedBody hideCompleted option', () => {
    it('renders no completed rows when hideCompleted is true', () => {
        const wrap = buildViewerRenderedBody(FIXTURE, { hideCompleted: true });
        expect(wrap.querySelectorAll('.todoMdViewerCheckRow--done')).toHaveLength(0);
        // Active row still renders.
        const rows = wrap.querySelectorAll('.todoMdViewerCheckRow');
        expect(rows.length).toBeGreaterThan(0);
        expect(wrap.textContent).toMatch(/Add the toggle/);
        expect(wrap.textContent).not.toMatch(/Painted the strip/);
        // The completed entry's nested description is gone too.
        expect(wrap.textContent).not.toMatch(/some long description/);
    });

    it('renders completed rows when hideCompleted is false (today’s behavior)', () => {
        const wrap = buildViewerRenderedBody(FIXTURE, { hideCompleted: false });
        expect(wrap.querySelectorAll('.todoMdViewerCheckRow--done').length).toBeGreaterThan(0);
        expect(wrap.textContent).toMatch(/Painted the strip/);
        expect(wrap.textContent).toMatch(/some long description/);
    });
});

// The first completed entry in FIXTURE carries this marker; treat it as the
// shipped-but-unreviewed one for these tests.
const UNREVIEWED_MARKER = 'aaaaaaaa-0000-0000-0000-000000000001';
const isUnreviewed = (id) => id === UNREVIEWED_MARKER;

describe('todo.md viewer — shipped-but-unreviewed entries (isEntryUnreviewed)', () => {
    it('keeps an unreviewed shipped entry visible even while completed are hidden', () => {
        const tokens = parseTodoMdChecklist(FIXTURE);
        const kept = filterCompletedTokens(tokens, true, isUnreviewed).tokens;
        const texts = kept.map((t) => t.text);
        // The unreviewed shipped entry (and its sub-bullets) survive the hide.
        expect(texts.some((t) => /Painted the strip/.test(t))).toBe(true);
        expect(texts.some((t) => /some long description/.test(t))).toBe(true);
        // The other completed entry (reviewed → predicate false) is still hidden.
        expect(texts.some((t) => /Minimal done entry/.test(t))).toBe(false);
    });

    it('excludes unreviewed shipped entries from the completed count', () => {
        // Two completed entries, one of them unreviewed → only one counts as hidden.
        expect(countCompletedTodoMdEntries(FIXTURE, isUnreviewed)).toBe(1);
        // With no predicate, both count (unchanged legacy behavior).
        expect(countCompletedTodoMdEntries(FIXTURE)).toBe(2);
    });

    it('gives an unreviewed shipped row the amber treatment and an Acknowledge pill', () => {
        const acks = [];
        const wrap = buildViewerRenderedBody(FIXTURE, {
            hideCompleted: false,
            isEntryUnreviewed: isUnreviewed,
            onAcknowledgeEntry: (id, btn) => acks.push({ id, btn }),
        });
        const reviewRows = wrap.querySelectorAll('.todoMdViewerCheckRow--review');
        expect(reviewRows).toHaveLength(1);
        const pill = wrap.querySelector('.todoMdViewerAckEntryBtn');
        expect(pill).not.toBeNull();
        expect(pill.dataset.entryId).toBe(UNREVIEWED_MARKER);
        pill.click();
        expect(acks).toHaveLength(1);
        expect(acks[0].id).toBe(UNREVIEWED_MARKER);
    });

    it('adds no amber treatment or Acknowledge pill when the entry is reviewed', () => {
        const wrap = buildViewerRenderedBody(FIXTURE, {
            hideCompleted: false,
            isEntryUnreviewed: () => false,
            onAcknowledgeEntry: () => {},
        });
        expect(wrap.querySelectorAll('.todoMdViewerCheckRow--review')).toHaveLength(0);
        expect(wrap.querySelector('.todoMdViewerAckEntryBtn')).toBeNull();
    });

    it('omits the Acknowledge pill when no onAcknowledgeEntry callback is supplied', () => {
        const wrap = buildViewerRenderedBody(FIXTURE, {
            hideCompleted: false,
            isEntryUnreviewed: isUnreviewed,
        });
        // The amber treatment still paints, but there is no pill to tap.
        expect(wrap.querySelectorAll('.todoMdViewerCheckRow--review')).toHaveLength(1);
        expect(wrap.querySelector('.todoMdViewerAckEntryBtn')).toBeNull();
    });
});

describe('todo.md viewer — show-completed menu item wiring (todoMdViewer.js)', () => {
    const main = read('todoMdViewer.js');

    it('imports the show-completed pref helpers from prefs.js', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bisTodoMdShowCompleted\b[\s\S]*?\bsetTodoMdShowCompleted\b[\s\S]*?\}\s*from\s*['"]\.\/prefs\.js['"]/
        );
    });

    it('builds the toggle as a checkable overflow-menu item (menuitemcheckbox), not a header button', () => {
        expect(main).toMatch(/showCompletedItem\.className\s*=\s*['"]todoMdViewerOverflowItem todoMdViewerShowCompletedItem['"]/);
        expect(main).toMatch(/showCompletedItem\.setAttribute\(\s*['"]role['"]\s*,\s*['"]menuitemcheckbox['"]/);
        expect(main).toMatch(/showCompletedItem\.setAttribute\(\s*['"]aria-checked['"]\s*,\s*['"]false['"]/);
        // The old standalone header icon button (and its badge) is gone entirely.
        expect(main).not.toMatch(/showCompletedBtn/);
        expect(main).not.toMatch(/todoMdViewerShowCompletedBadge/);
    });

    it('places the toggle at the top of the overflow menu, above a divider, above the clear items', () => {
        const order = [
            'overflowMenu.appendChild(showCompletedItem);',
            'overflowMenu.appendChild(overflowDivider);',
            'overflowMenu.appendChild(clearCompletedItem);',
            'overflowMenu.appendChild(clearAllItem);',
        ];
        let cursor = -1;
        for (const line of order) {
            const idx = main.indexOf(line, cursor + 1);
            expect(idx).toBeGreaterThan(cursor);
            cursor = idx;
        }
    });

    it('no longer appends the toggle to the header meta row (row: synced/run/sync/overflow/collapse)', () => {
        expect(main).not.toMatch(/meta\.appendChild\(showCompletedBtn\);/);
        expect(main).not.toMatch(/meta\.appendChild\(showCompletedItem\);/);
        const order = [
            'meta.appendChild(syncedLabel);',
            'meta.appendChild(runBacklogBtn);',
            'meta.appendChild(syncBtn);',
            'meta.appendChild(overflowWrap);',
            'meta.appendChild(collapseBodyBtn);',
        ];
        let cursor = -1;
        for (const line of order) {
            const idx = main.indexOf(line, cursor + 1);
            expect(idx).toBeGreaterThan(cursor);
            cursor = idx;
        }
    });

    it('renders a standalone checkmark polyline glyph inside the item (no box outline)', () => {
        expect(main).toMatch(/showCompletedCheck\.innerHTML\s*=[\s\S]*?<svg[\s\S]*?<polyline[\s\S]*?<\/svg>/);
        expect(main).toMatch(/<polyline points="20 6 9 17 4 12"\/>/);
    });

    it('applyShowCompletedState reflects state via aria-checked and a Show/Hide completed (N) label', () => {
        const start = main.indexOf('function applyShowCompletedState');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 800);
        expect(block).toMatch(/showCompletedItem\.setAttribute\(\s*['"]aria-checked['"]/);
        expect(block).toMatch(/showCompletedLabel\.textContent\s*=/);
        expect(block).toMatch(/Hide/);
        expect(block).toMatch(/Show/);
        expect(block).toMatch(/ completed \(/);
    });

    it('hides + disables the item (and its divider) when the count is zero', () => {
        const start = main.indexOf('function applyShowCompletedState');
        const block = main.slice(start, start + 800);
        expect(block).toMatch(/===?\s*0/);
        expect(block).toMatch(/showCompletedItem\.hidden\s*=/);
        expect(block).toMatch(/showCompletedItem\.disabled\s*=/);
        expect(block).toMatch(/overflowDivider\.hidden\s*=/);
    });

    it('persists the choice and re-renders on click without re-fetching', () => {
        const start = main.indexOf("showCompletedItem.addEventListener('click'");
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 700);
        expect(block).toMatch(/setTodoMdShowCompleted\(\s*!isTodoMdShowCompleted\(\)\s*\)/);
        expect(block).toMatch(/applyTab\(viewerActiveTab\)/);
        // No worker re-fetch on a toggle click.
        expect(block).not.toMatch(/readTodoMdFromWorker/);
    });

    it('preserves body scroll position across a toggle', () => {
        const start = main.indexOf("showCompletedItem.addEventListener('click'");
        const block = main.slice(start, start + 700);
        expect(block).toMatch(/prevScroll\s*=\s*body\.scrollTop/);
        expect(block).toMatch(/body\.scrollTop\s*=\s*prevScroll/);
    });

    it('closes the overflow menu on select (matching the clear items)', () => {
        const start = main.indexOf("showCompletedItem.addEventListener('click'");
        const block = main.slice(start, start + 700);
        expect(block).toMatch(/closeOverflowMenu\(\)/);
    });

    it('passes hideCompleted into both rendered-body builds, gated on the pref', () => {
        const matches = main.match(/buildViewerRenderedBody\([^;]*hideCompleted:\s*!isTodoMdShowCompleted\(\)/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('does NOT write TODO.md on a toggle — the toggle is render-side only', () => {
        // The pipeline reads the full file server-side; the toggle must never
        // mutate the file or dispatch an inject/dispatch call.
        const start = main.indexOf("showCompletedItem.addEventListener('click'");
        const block = main.slice(start, start + 700);
        expect(block).not.toMatch(/injectEntry|dispatchRun|postToWorker|fetch\s*\(/);
    });
});

describe('todo.md viewer — expand-button removal & meta row (todoMdViewer.js)', () => {
    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('removes the #todoMdViewerExpandBtn (diagonal-arrows) button entirely', () => {
        // No DOM construction, class assignment, glyph constants, or CSS for it.
        expect(main).not.toMatch(/todoMdViewerExpandBtn/);
        expect(main).not.toMatch(/expandIconHtml/);
        expect(main).not.toMatch(/collapseIconHtml/);
        expect(css).not.toMatch(/\.todoMdViewerExpandBtn/);
    });

    it('preserves the #todoMdViewerCollapseBtn (chevron body-collapse) button untouched', () => {
        // Construction, append, handler, and CSS for the collapse button all stay.
        expect(main).toMatch(/collapseBodyBtn\.className\s*=\s*['"]todoMdViewerCollapseBtn['"]/);
        expect(main).toMatch(/meta\.appendChild\(collapseBodyBtn\);/);
        expect(main).toMatch(/collapseBodyBtn\.addEventListener\(\s*['"]click['"]/);
        expect(css).toMatch(/\.todoMdViewerCollapseBtn\s*\{/);
    });

    it('the collapse button is the final child appended to the meta row', () => {
        // After the relocation the meta row ends synced/run/sync/overflow/collapse.
        expect(main.indexOf('meta.appendChild(overflowWrap);'))
            .toBeLessThan(main.indexOf('meta.appendChild(collapseBodyBtn);'));
    });
});

describe('todo.md viewer — show-completed menu item CSS (style.css)', () => {
    const css = read('style.css');

    it('removes the old standalone icon-button rules (button, icon, badge)', () => {
        expect(css).not.toMatch(/\.todoMdViewerShowCompletedBtn\b/);
        expect(css).not.toMatch(/\.todoMdViewerShowCompletedIcon\b/);
        expect(css).not.toMatch(/\.todoMdViewerShowCompletedBadge\b/);
    });

    it('lays the item out as a checkmark slot + label (flex)', () => {
        const start = css.indexOf('.todoMdViewerShowCompletedItem {');
        expect(start).toBeGreaterThan(-1);
        const block = css.slice(start, start + 300);
        expect(block).toMatch(/display:\s*flex/);
        expect(block).toMatch(/align-items:\s*center/);
    });

    it('shows the checkmark only when the item is checked (aria-checked="true")', () => {
        expect(css).toMatch(/\.todoMdViewerShowCompletedCheck\s*\{[\s\S]*?visibility:\s*hidden/);
        expect(css).toMatch(/\.todoMdViewerShowCompletedItem\[aria-checked="true"\]\s+\.todoMdViewerShowCompletedCheck\s*\{\s*visibility:\s*visible/);
    });

    it('hides the item and its divider when the N=0 hidden attribute is set', () => {
        expect(css).toMatch(/\.todoMdViewerShowCompletedItem\[hidden\]\s*\{\s*display:\s*none/);
        expect(css).toMatch(/\.todoMdViewerOverflowDivider\[hidden\]\s*\{\s*display:\s*none/);
    });

    it('styles the divider as a quiet 1px separator', () => {
        const start = css.indexOf('.todoMdViewerOverflowDivider {');
        expect(start).toBeGreaterThan(-1);
        const block = css.slice(start, start + 200);
        expect(block).toMatch(/height:\s*1px/);
        expect(block).toMatch(/background:/);
    });
});
