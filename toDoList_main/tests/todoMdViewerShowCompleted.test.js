import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
    parseTodoMdChecklist,
    filterCompletedTokens,
    countCompletedTodoMdEntries,
    buildViewerRenderedBody,
} from '../src/main.js';
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

describe('todo.md viewer — show-completed toggle wiring (main.js)', () => {
    const main = read('main.js');

    it('imports the show-completed pref helpers from prefs.js', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bisTodoMdShowCompleted\b[\s\S]*?\bsetTodoMdShowCompleted\b[\s\S]*?\}\s*from\s*['"]\.\/prefs\.js['"]/
        );
    });

    it('builds an icon button (no text-pill label) in the header meta row', () => {
        expect(main).toMatch(/showCompletedBtn\.className\s*=\s*['"]todoMdViewerShowCompletedBtn['"]/);
        // The text-pill label span is gone — the trigger is now an icon glyph.
        expect(main).not.toMatch(/showCompletedLabel\.textContent\s*=\s*['"]Show completed['"]/);
        expect(main).toMatch(/meta\.appendChild\(showCompletedBtn\);/);
    });

    it('renders a standalone checkmark SVG glyph (no checkbox outline) inside the button', () => {
        const start = main.indexOf('showCompletedBtn.innerHTML');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 400);
        // The new glyph is a single polyline checkmark…
        expect(block).toMatch(/<polyline points="20 6 9 17 4 12"\s*\/>/);
        // …with no surrounding checkbox rectangle <path> from the prior glyph.
        expect(block).not.toMatch(/<path /);
    });

    it('mounts the show-completed button as the last child of the meta row', () => {
        // The button moved into the slot the removed body-collapse button
        // vacated, so it is appended last in the header meta row.
        const appendIdx = main.indexOf('meta.appendChild(showCompletedBtn);');
        expect(appendIdx).toBeGreaterThan(-1);
        // No other meta.appendChild call follows the show-completed append.
        const after = main.slice(appendIdx + 'meta.appendChild(showCompletedBtn);'.length);
        const nextAppend = after.indexOf('meta.appendChild(');
        const headerEnd = after.indexOf('header.appendChild(meta);');
        expect(headerEnd).toBeGreaterThan(-1);
        // Either there is no further meta append, or it comes after the
        // header is assembled (i.e. not part of this meta row).
        expect(nextAppend === -1 || nextAppend > headerEnd).toBe(true);
    });

    it('renders a floating count badge as the button child', () => {
        expect(main).toMatch(/showCompletedCount\.className\s*=\s*['"]todoMdViewerShowCompletedBadge['"]/);
        expect(main).toMatch(/showCompletedBtn\.appendChild\(showCompletedCount\)/);
    });

    it('sets a descriptive aria-label + title carrying the count and verb', () => {
        const start = main.indexOf('function applyShowCompletedState');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1100);
        expect(block).toMatch(/aria-label/);
        expect(block).toMatch(/\.title\s*=/);
        expect(block).toMatch(/Hide/);
        expect(block).toMatch(/Show/);
    });

    it('hides the badge (via the --empty modifier) when the count is zero', () => {
        const start = main.indexOf('function applyShowCompletedState');
        const block = main.slice(start, start + 1100);
        expect(block).toMatch(/todoMdViewerShowCompletedBtn--empty/);
        expect(block).toMatch(/===?\s*0/);
    });

    it('reflects state via aria-pressed (keyboard-accessible <button>)', () => {
        expect(main).toMatch(/showCompletedBtn\.type\s*=\s*['"]button['"]/);
        expect(main).toMatch(/showCompletedBtn\.setAttribute\(\s*['"]aria-pressed['"]/);
    });

    it('persists the choice and re-renders on click without re-fetching', () => {
        const start = main.indexOf("showCompletedBtn.addEventListener('click'");
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 500);
        expect(block).toMatch(/setTodoMdShowCompleted\(\s*!isTodoMdShowCompleted\(\)\s*\)/);
        expect(block).toMatch(/applyTab\(viewerActiveTab\)/);
        // No worker re-fetch on a toggle click.
        expect(block).not.toMatch(/readTodoMdFromWorker/);
    });

    it('preserves body scroll position across a toggle', () => {
        const start = main.indexOf("showCompletedBtn.addEventListener('click'");
        const block = main.slice(start, start + 500);
        expect(block).toMatch(/prevScroll\s*=\s*body\.scrollTop/);
        expect(block).toMatch(/body\.scrollTop\s*=\s*prevScroll/);
    });

    it('passes hideCompleted into both rendered-body builds, gated on the pref', () => {
        const matches = main.match(/buildViewerRenderedBody\([^;]*hideCompleted:\s*!isTodoMdShowCompleted\(\)/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('does NOT write TODO.md on a toggle — the toggle is render-side only', () => {
        // The pipeline reads the full file server-side; the toggle must never
        // mutate the file or dispatch an inject/dispatch call.
        const start = main.indexOf("showCompletedBtn.addEventListener('click'");
        const block = main.slice(start, start + 500);
        expect(block).not.toMatch(/injectEntry|dispatchRun|postToWorker|fetch\s*\(/);
    });
});

describe('todo.md viewer — show-completed icon button CSS (style.css)', () => {
    const css = read('style.css');

    it('sizes the button as a 32×32 square, not text-width', () => {
        const start = css.indexOf('.todoMdViewerShowCompletedBtn {');
        expect(start).toBeGreaterThan(-1);
        const block = css.slice(start, start + 700);
        expect(block).toMatch(/width:\s*32px/);
        expect(block).toMatch(/height:\s*32px/);
        expect(block).toMatch(/border-radius:\s*8px/);
    });

    it('inverts the background on the pressed/active state', () => {
        expect(css).toMatch(/\.todoMdViewerShowCompletedBtn\[aria-pressed="true"\]/);
        expect(css).toMatch(/rgba\(108,\s*93,\s*245,\s*0\.18\)/);
    });

    it('positions a floating badge and hides it when empty', () => {
        expect(css).toMatch(/\.todoMdViewerShowCompletedBadge\s*\{/);
        const badgeStart = css.indexOf('.todoMdViewerShowCompletedBadge {');
        const block = css.slice(badgeStart, badgeStart + 500);
        expect(block).toMatch(/position:\s*absolute/);
        expect(block).toMatch(/top:\s*-5px/);
        expect(block).toMatch(/right:\s*-5px/);
        expect(css).toMatch(/--empty\s+\.todoMdViewerShowCompletedBadge\s*\{\s*display:\s*none/);
    });
});
