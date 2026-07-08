import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTodoMdChecklist, buildViewerRenderedBody, hasUncheckedTodoEntries } from '../src/todoMdViewer.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Source-inspection + unit tests for the read-only TODO.md viewer card.
// The card mounts below the Completed section for projects routed to an
// inject target, fetches the target file via the existing Worker, and
// surfaces two tabs (Rendered / Raw markdown) plus a Sync button. Test
// strategy mirrors injectToTodoMd / projectInjectRouting (source regex)
// since the full project-select → fetch path needs jsdom + Worker stub.

describe('todo.md viewer — inject.js worker-read helper', () => {

    const inject = read('inject.js');

    it('exports readTodoMdFromWorker for the viewer to call', () => {
        expect(inject).toMatch(/export\s+async\s+function\s+readTodoMdFromWorker\s*\(/);
    });

    it('sends `{ read: true, repo, filePath }` to the existing postToWorker', () => {
        // Reuses the same Worker URL + Bearer secret path the inject
        // button uses — no new transport, no new config surface.
        expect(inject).toMatch(
            /postToWorker\s*\(\s*\{[\s\S]{0,160}read:\s*true[\s\S]{0,160}repo:\s*target\.repo[\s\S]{0,160}filePath:\s*target\.file_path/
        );
    });

    it('returns { ok: true, content, sha } on success', () => {
        expect(inject).toMatch(/ok:\s*true[\s\S]{0,200}content:\s*res\.content[\s\S]{0,80}sha:\s*res\.sha/);
    });

    it('returns { ok: false, reason } when the target is missing or the call fails', () => {
        expect(inject).toMatch(/ok:\s*false[\s\S]{0,40}reason:\s*['"]No target['"]/);
        // Generic catch path funnels through describeError just like the
        // inject button's failure path, so the inline error label matches
        // the existing 401 / 403 / network error vocabulary.
        expect(inject).toMatch(/readTodoMdFromWorker[\s\S]{0,800}catch[\s\S]{0,80}describeError/);
    });
});

describe('todo.md viewer — main.js card wiring', () => {

    const main = read('todoMdViewer.js');

    it('imports findTargetById and readTodoMdFromWorker from inject.js', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bfindTargetById\b[\s\S]*?\breadTodoMdFromWorker\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('persists the last-fetch timestamp under the todoapp_ prefix, keyed by project', () => {
        // Per task spec: "Persist the per-project last-fetch timestamp
        // under the `todoapp_` localStorage prefix, keyed by project."
        expect(main).toMatch(/['"]todoapp_todomd_lastfetch_['"]/);
        expect(main).toMatch(/function\s+viewerLastFetchKey\s*\(\s*projectName\s*\)/);
    });

    it('mounts the card with id #todoMdViewerCard', () => {
        expect(main).toMatch(/['"]todoMdViewerCard['"]/);
    });

    it('renders two tabs labelled "Rendered" and "Raw markdown"', () => {
        expect(main).toMatch(/renderedTab\.textContent\s*=\s*['"]Rendered['"]/);
        expect(main).toMatch(/rawTab\.textContent\s*=\s*['"]Raw markdown['"]/);
    });

    it('exposes an icon-only Sync button that re-fetches on click', () => {
        // The bar restyle drops the "Sync" text label for a refresh glyph
        // (aria-label + title keep the action named); the button renders the
        // SYNC_GLYPH SVG and still wires runSync on click.
        expect(main).toMatch(/syncBtn\.innerHTML\s*=\s*SYNC_GLYPH/);
        expect(main).toMatch(/syncBtn\.setAttribute\(\s*['"]aria-label['"]\s*,\s*['"]Sync TODO\.md['"]\s*\)/);
        expect(main).toMatch(/syncBtn\.addEventListener\s*\(\s*['"]click['"]\s*,\s*runSync\s*\)/);
    });

    it('swaps the Sync button for a spinner + "Syncing" label while a sync is in flight', () => {
        const start = main.indexOf('async function runSync');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1400);
        // Loading state: spinner glyph element + "Syncing" label replace the
        // idle "Sync" text, and the --loading class is applied.
        expect(block).toMatch(/syncBtn\.classList\.add\(\s*['"]todoMdViewerSyncBtn--loading['"]\s*\)/);
        expect(block).toMatch(/todoMdViewerSyncSpinner/);
        expect(block).toMatch(/Syncing/);
    });

    it('restores the idle Sync button state in finally on both success and failure', () => {
        const start = main.indexOf('async function runSync');
        const block = main.slice(start, start + 1400);
        expect(block).toMatch(/finally[\s\S]{0,200}syncBtn\.classList\.remove\(\s*['"]todoMdViewerSyncBtn--loading['"]\s*\)/);
        expect(block).toMatch(/finally[\s\S]{0,240}syncBtn\.innerHTML\s*=\s*SYNC_GLYPH/);
    });

    it('defines the sync spinner with a keyframe rotation and the Void accent color', () => {
        const css = read('style.css');
        expect(css).toMatch(/\.todoMdViewerSyncSpinner\s*\{[\s\S]*?animation:\s*todoMdViewerSyncSpin/);
        expect(css).toMatch(/\.todoMdViewerSyncSpinner\s*\{[\s\S]*?border-top-color:\s*#9D93EE/i);
        expect(css).toMatch(/@keyframes\s+todoMdViewerSyncSpin\s*\{[\s\S]*?rotate\(360deg\)/);
    });

    it('reuses readTodoMdFromWorker — no parallel transport in main.js', () => {
        // The card MUST go through inject.js's helper, not a freestanding
        // fetch() call, so the Worker URL / Bearer secret / Authorization
        // header live in exactly one place.
        expect(main).toMatch(/readTodoMdFromWorker\s*\(\s*target\s*\)/);
        // No bare fetch( inside the viewer block — search for the
        // viewer-scoped functions and assert fetch isn't used there.
        const viewerStart = main.indexOf('VIEWER_LASTFETCH_PREFIX');
        const viewerEnd = main.indexOf("document.addEventListener('mainListRendered'");
        expect(viewerStart).toBeGreaterThan(-1);
        expect(viewerEnd).toBeGreaterThan(viewerStart);
        const block = main.slice(viewerStart, viewerEnd);
        expect(block).not.toMatch(/\bfetch\s*\(/);
    });

    it('hides the card for projects without an inject target', () => {
        // Acceptance: "Viewer appears only for projects with an inject
        // target; absent for None-routed projects." Implementation hooks
        // off listLogic.getProjectTargetId + findTargetById; when the
        // resolved target is null, any existing card is removed.
        expect(main).toMatch(/listLogic\.getProjectTargetId\s*\(\s*projectName\s*\)/);
        expect(main).toMatch(
            /if\s*\(\s*!target\s*\)\s*\{[\s\S]{0,200}existing\.parentNode\.removeChild\s*\(\s*existing\s*\)/
        );
    });

    it('subscribes to the mainListRendered event so re-renders re-place the card idempotently', () => {
        expect(main).toMatch(/['"]mainListRendered['"]/);
        expect(main).toMatch(/document\.addEventListener\(\s*['"]mainListRendered['"]/);
    });

    it('tab toggle reuses cached content (no re-fetch on tab swap)', () => {
        // Acceptance: "Both tabs render correctly; toggling between them
        // doesn't re-fetch." applyTab() reads card.dataset.content and
        // never touches readTodoMdFromWorker.
        const applyTabStart = main.indexOf('function applyTab(');
        expect(applyTabStart).toBeGreaterThan(-1);
        const applyTabEnd = main.indexOf('renderedTab.addEventListener', applyTabStart);
        const body = main.slice(applyTabStart, applyTabEnd);
        expect(body).toMatch(/card\.dataset\.content/);
        expect(body).not.toMatch(/readTodoMdFromWorker/);
    });
});

describe('todo.md viewer — emptyState.js render event', () => {

    const emptyState = read('emptyState.js');

    it('dispatches mainListRendered from updateCompletedSection so the viewer can re-hook', () => {
        expect(emptyState).toMatch(/['"]mainListRendered['"]/);
        // Fires on both code paths — the no-completed early return AND
        // the normal render — so every #mainList re-render notifies the
        // viewer regardless of completed-rows state.
        const matches = emptyState.match(/mainListRendered/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });
});

describe('todo.md viewer — parseTodoMdChecklist', () => {

    it('recognises unchecked and checked GFM checkbox rows', () => {
        const tokens = parseTodoMdChecklist('- [ ] Buy milk\n- [x] Pay bills');
        expect(tokens).toHaveLength(2);
        expect(tokens[0]).toMatchObject({ type: 'checkbox', checked: false, text: 'Buy milk' });
        expect(tokens[1]).toMatchObject({ type: 'checkbox', checked: true, text: 'Pay bills' });
    });

    it('treats uppercase X as checked', () => {
        const tokens = parseTodoMdChecklist('- [X] Done');
        expect(tokens[0]).toMatchObject({ type: 'checkbox', checked: true, text: 'Done' });
    });

    it('captures heading lines with their level', () => {
        const tokens = parseTodoMdChecklist('# Big\n## Small');
        expect(tokens[0]).toMatchObject({ type: 'heading', level: 1, text: 'Big' });
        expect(tokens[1]).toMatchObject({ type: 'heading', level: 2, text: 'Small' });
    });

    it('falls back to plain text for non-checklist lines and preserves blanks', () => {
        const tokens = parseTodoMdChecklist('hello\n\nworld');
        expect(tokens).toHaveLength(3);
        expect(tokens[0]).toMatchObject({ type: 'text', text: 'hello' });
        expect(tokens[1]).toMatchObject({ type: 'text', text: '' });
        expect(tokens[2]).toMatchObject({ type: 'text', text: 'world' });
    });

    it('returns an empty array for non-string input', () => {
        expect(parseTodoMdChecklist(null)).toEqual([]);
        expect(parseTodoMdChecklist(undefined)).toEqual([]);
        expect(parseTodoMdChecklist(42)).toEqual([]);
    });

    it('captures the indent depth of nested checklist items', () => {
        const tokens = parseTodoMdChecklist('- [ ] top\n  - [ ] nested');
        expect(tokens[0]).toMatchObject({ checked: false, indent: 0 });
        expect(tokens[1]).toMatchObject({ checked: false, indent: 2 });
    });

    it('attaches the entry id from a marker on a following line within the entry block', () => {
        const text = [
            '- [ ] Add a thing',
            '    - Type: feature',
            '    <!-- id: 11111111-2222-3333-4444-555555555555 -->',
        ].join('\n');
        const tokens = parseTodoMdChecklist(text);
        expect(tokens[0]).toMatchObject({
            type: 'checkbox',
            indent: 0,
            entryId: '11111111-2222-3333-4444-555555555555',
        });
    });

    it('attaches the entry id from a marker inline on the checkbox line', () => {
        const tokens = parseTodoMdChecklist('- [ ] Inline task <!-- id: abc-123 -->');
        expect(tokens[0].entryId).toBe('abc-123');
    });

    it('does not attach an id when the entry has no marker', () => {
        const tokens = parseTodoMdChecklist('- [ ] No marker here\n    - Type: bug');
        expect(tokens[0].entryId).toBeUndefined();
    });

    it('scopes a marker to its own entry — it does not bleed onto a later entry', () => {
        const text = [
            '- [ ] First',
            '    <!-- id: first-id -->',
            '- [ ] Second',
            '    - Type: feature',
        ].join('\n');
        const tokens = parseTodoMdChecklist(text);
        const checkboxes = tokens.filter((t) => t.type === 'checkbox');
        expect(checkboxes[0].entryId).toBe('first-id');
        expect(checkboxes[1].entryId).toBeUndefined();
    });

    it('only matches the exact `<!-- id: <id> -->` marker form', () => {
        // Wrong spacing must not resolve — the dedup guard / Worker rely on
        // the exact one-space-each-side shape.
        const tokens = parseTodoMdChecklist('- [ ] Task\n    <!--id:nope-->');
        expect(tokens[0].entryId).toBeUndefined();
    });
});

describe('todo.md viewer — hasUncheckedTodoEntries', () => {

    it('returns true when a top-level entry is unchecked', () => {
        expect(hasUncheckedTodoEntries('- [ ] Buy milk\n- [x] Pay bills')).toBe(true);
    });

    it('returns false when every top-level entry is checked', () => {
        expect(hasUncheckedTodoEntries('- [x] Done\n- [X] Also done')).toBe(false);
    });

    it('ignores nested unchecked items under a completed top-level entry', () => {
        const text = [
            '- [x] Parent done',
            '  - [ ] nested still open',
        ].join('\n');
        expect(hasUncheckedTodoEntries(text)).toBe(false);
    });

    it('returns false for empty or checkbox-free content', () => {
        expect(hasUncheckedTodoEntries('')).toBe(false);
        expect(hasUncheckedTodoEntries('# TODO LIST\n\njust prose')).toBe(false);
        expect(hasUncheckedTodoEntries(null)).toBe(false);
    });
});

describe('todo.md viewer — expand/collapse toggle', () => {

    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('persists expand state per project under the todoapp_ prefix', () => {
        expect(main).toMatch(/['"]todoapp_todomd_expanded_['"]/);
        expect(main).toMatch(/function\s+viewerExpandedKey\s*\(\s*projectName\s*\)/);
        expect(main).toMatch(/function\s+readViewerExpanded\s*\(\s*projectName\s*\)/);
        expect(main).toMatch(/function\s+writeViewerExpanded\s*\(\s*projectName\s*,\s*expanded\s*\)/);
    });

    // The diagonal-arrows expand toggle button (#todoMdViewerExpandBtn) was
    // removed from the header; its DOM construction, aria/icon flipping, and
    // dedicated CSS no longer exist. The fill-to-bottom semantic now rides on
    // the surviving collapse button — uncollapsing the body also applies the
    // `--expanded` class and calls applyExpandedHeight() (see the
    // "collapse button fills body to bottom" block below). The per-project
    // expand state localStorage helpers remain inert and covered below.

    it('computes the expanded body height from #mainList and the card header', () => {
        // The expanded body fills the room from the header's bottom edge
        // to #mainList's visible bottom edge — keeps the flex-fill from
        // silently collapsing when the parent chain doesn't propagate a
        // resolved height (the same root cause as the prior music-vis
        // bar bug, per task spec).
        expect(main).toMatch(/function\s+applyExpandedHeight/);
        expect(main).toMatch(/mainListDiv\.getBoundingClientRect\(\)/);
        expect(main).toMatch(/header\.getBoundingClientRect\(\)/);
    });

    it('re-applies height on window resize while expanded', () => {
        expect(main).toMatch(/window\.addEventListener\s*\(\s*['"]resize['"]\s*,\s*viewerResizeHandler/);
        expect(main).toMatch(/todoMdViewerCard--expanded/);
    });

    it('cleans up the resize listener when the card is removed', () => {
        // Avoid leaking a resize listener every time the user switches
        // off a project that has a viewer card.
        expect(main).toMatch(/function\s+detachViewerResizeHandler/);
        const updateStart = main.indexOf('function updateTodoMdViewerCard');
        const updateEnd = main.indexOf('function activeProjectNameForViewer', updateStart);
        const block = main.slice(updateStart, updateEnd === -1 ? main.length : updateEnd);
        const detachCount = (block.match(/detachViewerResizeHandler\s*\(\s*\)/g) || []).length;
        expect(detachCount).toBeGreaterThanOrEqual(2);
    });

    it('lifts the body max-height ceiling in the expanded state', () => {
        // Otherwise the desktop/mobile `max-height` ceilings would cap
        // the JS-computed inline height and the body would never fill.
        expect(css).toMatch(/\.todoMdViewerCard--expanded\s+\.todoMdViewerBody\s*\{[\s\S]{0,120}max-height:\s*none/);
    });
});

describe('todo.md viewer — body collapse toggle', () => {

    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('renders a body-collapse toggle button in the header meta row', () => {
        expect(main).toMatch(/collapseBodyBtn\s*=\s*document\.createElement\(\s*['"]button['"]\s*\)/);
        expect(main).toMatch(/collapseBodyBtn\.className\s*=\s*['"]todoMdViewerCollapseBtn['"]/);
        expect(main).toMatch(/meta\.appendChild\(collapseBodyBtn\);/);
    });

    it('toggles a `collapsed` class on the viewer card when clicked', () => {
        expect(main).toMatch(/collapseBodyBtn\.addEventListener\(\s*['"]click['"]/);
        expect(main).toMatch(/card\.classList\.toggle\(\s*['"]collapsed['"]/);
    });

    it('flips icon and aria-label between collapse and expand on toggle', () => {
        expect(main).toMatch(/aria-label['"]\s*,\s*['"]Collapse panel['"]/);
        expect(main).toMatch(/aria-label['"]\s*,\s*['"]Expand panel['"]/);
    });

    it('defaults to collapsed on mount and does not persist collapse state', () => {
        // The card always mounts collapsed — collapse is in-memory only,
        // so there is no localStorage key for it.
        expect(main).toMatch(/applyCollapsedState\(\s*true\s*\)/);
        expect(main).not.toMatch(/todoapp_todomd_collapsed/);
    });

    it('hides the body via display:none when the card carries the collapsed class', () => {
        expect(css).toMatch(/\.todoMdViewerCard\.collapsed\s+\.todoMdViewerBody\s*\{[\s\S]{0,80}display:\s*none/);
    });

    it('never keys the ⋯ overflow control\'s visibility off the collapsed class (collapse must not toggle it)', () => {
        // Regression: a `.todoMdViewerCard.collapsed .todoMdViewerOverflowWrap
        // { display: none }` rule made the collapse chevron show/hide the ⋯
        // overflow button along with the card body on mobile. The overflow
        // control belongs to the viewer sheet and must stay put regardless of
        // collapse, so no rule — in any media block — may hide the wrap based
        // on the collapsed class. Brace-match every rule whose selector pairs
        // `.todoMdViewerCard.collapsed` with the overflow wrap and assert none
        // sets display:none.
        const anchor = '.todoMdViewerCard.collapsed';
        let idx = 0;
        while ((idx = css.indexOf(anchor, idx)) !== -1) {
            const braceStart = css.indexOf('{', idx);
            const selectorText = css.slice(idx, braceStart);
            idx = braceStart + 1;
            if (!/todoMdViewerOverflowWrap/.test(selectorText)) continue;
            let depth = 1;
            let end = css.length;
            for (let i = braceStart + 1; i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
            }
            const block = css.slice(braceStart + 1, end);
            expect(block).not.toMatch(/display:\s*none/);
        }
    });

    it('renders the collapse button as a neutral 36×36 chip in dark mode (#15161d fill, faint purple border, #8b8c99 icon)', () => {
        // Bar restyle: the expand toggle is normalized to the same quiet
        // neutral chip as Sync so only the amber Run backlog pill carries
        // color emphasis.
        const ruleMatch = css.match(/\.todoMdViewerCollapseBtn\s*\{[^}]*\}/);
        expect(ruleMatch).not.toBeNull();
        const rule = ruleMatch[0];
        expect(rule).toMatch(/width:\s*36px/);
        expect(rule).toMatch(/height:\s*36px/);
        expect(rule).toMatch(/background:\s*#15161d/);
        expect(rule).toMatch(/border:[^;]*rgba\(157,\s*147,\s*238/);
        expect(rule).toMatch(/color:\s*#8b8c99/);
        expect(rule).toMatch(/border-radius:\s*10px/);
    });

    it('swaps the collapse button to the deeper #6C5DF5 purple ghost in light mode', () => {
        const btnMatch = css.match(
            /:root\[data-theme="light"\]\s+\.todoMdViewerCollapseBtn\s*\{[^}]*\}/
        );
        expect(btnMatch).not.toBeNull();
        const btnRule = btnMatch[0];
        expect(btnRule).toMatch(/background:\s*none/);
        expect(btnRule).toMatch(/border-color:\s*rgba\(108,\s*93,\s*245/);
        expect(btnRule).toMatch(/color:\s*#6C5DF5/);
    });
});

describe('todo.md viewer — collapse button fills body to bottom on expand', () => {

    const main = read('todoMdViewer.js');

    // The collapse button is the only surviving expand affordance. Previously
    // it toggled only the `collapsed` class, so uncollapsing showed the body at
    // its default max-height ceiling — leaving a large blank gap below the card.
    // The handler now also drives the `--expanded` class (which lifts the
    // max-height ceiling) and calls applyExpandedHeight() so the body fills to
    // the bottom of #mainList on every tap.
    const handler = (() => {
        const anchor = main.indexOf("collapseBodyBtn.addEventListener('click'");
        expect(anchor).toBeGreaterThan(-1);
        return main.slice(anchor, anchor + 600);
    })();

    it('derives the next collapsed state once and passes it to applyCollapsedState', () => {
        expect(handler).toMatch(
            /const\s+willBeCollapsed\s*=\s*!card\.classList\.contains\(\s*['"]collapsed['"]\s*\)/
        );
        expect(handler).toMatch(/applyCollapsedState\(\s*willBeCollapsed\s*\)/);
    });

    it('syncs the --expanded class to the un-collapsed state in the same handler', () => {
        // Toggled ON when uncollapsing, OFF when collapsing, so the body's
        // max-height ceiling lifts and drops in lockstep with visibility.
        expect(handler).toMatch(
            /card\.classList\.toggle\(\s*['"]todoMdViewerCard--expanded['"]\s*,\s*!willBeCollapsed\s*\)/
        );
    });

    it('calls applyExpandedHeight() after toggling so the body fills (or clears) immediately on tap', () => {
        // applyExpandedHeight computes the fill height when --expanded is
        // present and clears the inline height when it is absent, so a single
        // call covers both the expand and the collapse direction.
        const togglePos = handler.indexOf('todoMdViewerCard--expanded');
        const applyPos = handler.indexOf('applyExpandedHeight()');
        expect(applyPos).toBeGreaterThan(togglePos);
    });
});

describe('todo.md viewer — Run backlog button + dispatchRun helper', () => {

    const inject = read('inject.js');
    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('exports dispatchRun from inject.js', () => {
        expect(inject).toMatch(/export\s+async\s+function\s+dispatchRun\s*\(/);
    });

    it('dispatchRun POSTs `{ dispatch: true, mode, entry_id, correlation_id, repo, filePath }` through postToWorker', () => {
        // Reuses the same Worker URL + Bearer secret path as inject/read —
        // the client never calls GitHub directly or holds a token.
        expect(inject).toMatch(
            /postToWorker\s*\(\s*\{[\s\S]{0,260}dispatch:\s*true[\s\S]{0,260}mode:\s*opts\.mode[\s\S]{0,260}entry_id:[\s\S]{0,260}correlation_id:\s*opts\.correlationId/
        );
    });

    it('dispatchRun funnels failures through describeError like the other helpers', () => {
        expect(inject).toMatch(/dispatchRun[\s\S]{0,600}catch[\s\S]{0,80}describeError/);
    });

    it('main.js imports dispatchRun and showInjectToast from inject.js', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bdispatchRun\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bshowInjectToast\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('builds a Run backlog button with the todoMdViewerRunBtn class and a play-glyph label', () => {
        expect(main).toMatch(/runBacklogBtn\.className\s*=\s*['"]todoMdViewerRunBtn['"]/);
        expect(main).toMatch(/Run backlog/);
    });

    it('places the Run backlog button immediately left of the Sync button in the meta row', () => {
        // Acceptance: button sits to the left of Sync.
        const runIdx = main.indexOf('meta.appendChild(runBacklogBtn);');
        const syncIdx = main.indexOf('meta.appendChild(syncBtn);');
        expect(runIdx).toBeGreaterThan(-1);
        expect(syncIdx).toBeGreaterThan(runIdx);
    });

    it('dispatches a backlog run on click with a fresh correlation id', () => {
        expect(main).toMatch(/runBacklogBtn\.addEventListener\s*\(\s*['"]click['"]\s*,\s*runBacklog\s*\)/);
        expect(main).toMatch(/mode:\s*['"]backlog['"]/);
        expect(main).toMatch(/crypto\.randomUUID\s*\(\s*\)/);
    });

    it('disables the button while a dispatch is in flight to block double-clicks', () => {
        const start = main.indexOf('async function runBacklog');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 2400);
        expect(block).toMatch(/runBacklogBtn\.disabled\s*=\s*true/);
        expect(block).toMatch(/todoMdViewerRunBtn--loading/);
        expect(block).toMatch(/finally[\s\S]{0,160}runBacklogBtn\.disabled\s*=\s*false/);
    });

    it('shows a transient confirmation on success and an error variant on failure', () => {
        const start = main.indexOf('async function runBacklog');
        const block = main.slice(start, start + 2000);
        expect(block).toMatch(/showInjectToast\([^)]*dispatched/i);
        expect(block).toMatch(/showInjectToast\([^,]*,\s*['"]error['"]\s*\)/);
    });

    it('styles the Run backlog button as an amber 36px pill (amber fill/border/text, radius 10px)', () => {
        // Bar restyle: Run backlog carries the pipeline's amber identity as
        // the highest-consequence control, distinct from the neutral Sync /
        // expand chips.
        const ruleMatch = css.match(/\.todoMdViewerRunBtn\s*\{[^}]*\}/);
        expect(ruleMatch).not.toBeNull();
        const rule = ruleMatch[0];
        expect(rule).toMatch(/height:\s*36px/);
        expect(rule).toMatch(/background:\s*rgba\(217,\s*184,\s*106,\s*0\.08\)/);
        expect(rule).toMatch(/border:[^;]*rgba\(217,\s*184,\s*106,\s*0\.55\)/);
        expect(rule).toMatch(/color:\s*#ffbd5e/);
        expect(rule).toMatch(/border-radius:\s*10px/);
    });

    it('renders the Run backlog button as a ghost in light mode (transparent fill, #6C5DF5 border/text, currentColor icon)', () => {
        const btnMatch = css.match(
            /:root\[data-theme="light"\]\s+\.todoMdViewerRunBtn\s*\{[^}]*\}/
        );
        expect(btnMatch).not.toBeNull();
        const btnRule = btnMatch[0];
        expect(btnRule).toMatch(/background:\s*transparent/);
        expect(btnRule).toMatch(/border:[^;]*1\.5px[^;]*#6C5DF5/);
        expect(btnRule).toMatch(/color:\s*#6C5DF5/);

        const iconMatch = css.match(
            /:root\[data-theme="light"\]\s+\.todoMdViewerRunIcon\s*\{[^}]*\}/
        );
        expect(iconMatch).not.toBeNull();
        expect(iconMatch[0]).toMatch(/fill:\s*currentColor/);
    });
});

describe('todo.md viewer — run-status pill + pollRunStatus helper', () => {

    const inject = read('inject.js');
    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('exports pollRunStatus from inject.js', () => {
        expect(inject).toMatch(/export\s+async\s+function\s+pollRunStatus\s*\(/);
    });

    it('pollRunStatus POSTs `{ status: true, correlation_id, repo, filePath }` through postToWorker', () => {
        // Reuses the same Worker URL + Bearer secret path as dispatch/read —
        // the client never calls GitHub directly or holds a token.
        expect(inject).toMatch(
            /postToWorker\s*\(\s*\{[\s\S]{0,200}status:\s*true[\s\S]{0,200}correlation_id:\s*opts\.correlationId[\s\S]{0,200}repo:[\s\S]{0,200}filePath:/
        );
    });

    it('pollRunStatus funnels failures through describeError like the other helpers', () => {
        expect(inject).toMatch(/pollRunStatus[\s\S]{0,800}catch[\s\S]{0,80}describeError/);
    });

    it('main.js imports pollRunStatus from inject.js', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\bpollRunStatus\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('swaps the Run backlog button for a status pill only on a successful dispatch', () => {
        // The dispatch handler records the correlation id only when the
        // Worker accepts the run, then starts the pill in its finally block.
        expect(main).toMatch(/dispatchedId\s*=\s*correlationId/);
        expect(main).toMatch(/if\s*\(\s*dispatchedId\s*\)\s*startRunPill\s*\(\s*dispatchedId\s*\)/);
    });

    it('mounts the pill in place of the button, swapping it into the meta slot', () => {
        expect(main).toMatch(/runPill\.className\s*=\s*['"]todoMdViewerRunPill['"]/);
        expect(main).toMatch(/runBacklogBtn\.parentNode\.replaceChild\s*\(\s*runPill\s*,\s*runBacklogBtn\s*\)/);
    });

    it('polls the Worker every 5 seconds via pollRunStatus', () => {
        expect(main).toMatch(/RUN_POLL_INTERVAL_MS\s*=\s*5000/);
        expect(main).toMatch(/viewerRunPollInterval\s*=\s*setInterval\(/);
        expect(main).toMatch(/setInterval\([\s\S]{0,160}RUN_POLL_INTERVAL_MS\s*\)/);
        expect(main).toMatch(/pollRunStatus\s*\(\s*\{\s*correlationId:/);
    });

    it('starts in a label-only "Starting…" state for the post-dispatch race window', () => {
        const start = main.indexOf('function startRunPill');
        const block = main.slice(start, start + 1700);
        expect(block).toMatch(/state:\s*['"]starting['"][\s\S]{0,80}label:\s*['"]Starting…['"][\s\S]{0,40}spinner:\s*true/);
    });

    it('maps Worker status responses to the documented pill states', () => {
        const start = main.indexOf('async function pollRunOnce');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1700);
        // found:false keeps the race-window "Starting…" state.
        expect(block).toMatch(/res\.found\s*===\s*false[\s\S]{0,160}Starting…/);
        // completed + success → success pill; any other conclusion → failure.
        expect(block).toMatch(/res\.conclusion\s*===\s*['"]success['"]\s*\)\s*showRunSuccess\(\)/);
        expect(block).toMatch(/else\s+showRunFailure\(/);
        // queued vs in-progress.
        expect(block).toMatch(/res\.status\s*===\s*['"]queued['"][\s\S]{0,120}Queued/);
        expect(block).toMatch(/Running…/);
    });

    it('auto-dismisses the success pill after ~5s, restoring the button', () => {
        const start = main.indexOf('function showRunSuccess');
        const block = main.slice(start, start + 900);
        expect(block).toMatch(/state:\s*['"]success['"]/);
        expect(block).toMatch(/setTimeout\([\s\S]{0,260}restoreRunButton\(\)[\s\S]{0,120}5000\s*\)/);
    });

    it('persists the failure pill with an Actions link and tap-to-dismiss', () => {
        const start = main.indexOf('function showRunFailure');
        const block = main.slice(start, start + 400);
        expect(block).toMatch(/state:\s*['"]failure['"]/);
        expect(block).toMatch(/dismissible:\s*true/);
        // Tap anywhere but the link dismisses; the link opens Actions.
        expect(main).toMatch(/if\s*\(\s*event\.target\.closest\(\s*['"]a['"]\s*\)\s*\)\s*return/);
        expect(main).toMatch(/dataset\.dismissible\s*===\s*['"]1['"]\s*\)\s*restoreRunButton\(\)/);
    });

    it('gives up after 20 minutes with a neutral "still running" state, not a failure', () => {
        expect(main).toMatch(/RUN_GIVE_UP_MS\s*=\s*20\s*\*\s*60\s*\*\s*1000/);
        const start = main.indexOf('function showRunTimeout');
        const block = main.slice(start, start + 400);
        expect(block).toMatch(/state:\s*['"]timeout['"]/);
        expect(block).toMatch(/check Actions/);
    });

    it('clears the poll interval when the viewer card is torn down', () => {
        expect(main).toMatch(/function stopViewerRunPoll[\s\S]{0,160}clearInterval\(\s*viewerRunPollInterval\s*\)/);
        expect(main).toMatch(/function detachViewerResizeHandler[\s\S]{0,400}stopViewerRunPoll\(\)/);
    });

    it('never renders the correlation id — the pill label is driven only by static state text', () => {
        // The correlation_id is internal plumbing for the dispatch/status
        // calls; the pill label always comes from opts.label, and the id is
        // only ever passed to dispatchRun / pollRunStatus / startRunPill.
        expect(main).toMatch(/\.textContent\s*=\s*opts\.label/);
        expect(main).not.toMatch(/textContent\s*=\s*correlationId/);
        expect(main).not.toMatch(/innerHTML\s*=\s*[^;]*correlationId/);
    });

    it('styles the in-flight pill amber (matching the Redeploy pill) and colors the terminal states', () => {
        const baseMatch = css.match(/\.todoMdViewerRunPill\s*\{[^}]*\}/);
        expect(baseMatch).not.toBeNull();
        const base = baseMatch[0];
        expect(base).toMatch(/background:\s*#161622/);
        expect(base).toMatch(/border:[^;]*#2a2a38/);
        expect(base).toMatch(/color:\s*#8a8699/);

        // In-flight states (starting/queued/running) now mirror the Deploy
        // pill's amber "Deploying" treatment: transparent fill, amber text and
        // border via --text-warning.
        const inFlight = css.match(
            /\.todoMdViewerRunPill--starting,\s*\.todoMdViewerRunPill--queued,\s*\.todoMdViewerRunPill--running\s*\{[^}]*\}/
        );
        expect(inFlight).not.toBeNull();
        expect(inFlight[0]).toMatch(/background:\s*transparent/);
        expect(inFlight[0]).toMatch(/color:\s*var\(--text-warning\)/);
        expect(inFlight[0]).toMatch(/border-color:\s*var\(--text-warning\)/);

        const success = css.match(/\.todoMdViewerRunPill--success\s*\{[^}]*\}/);
        expect(success).not.toBeNull();
        expect(success[0]).toMatch(/#0f2a20/);
        expect(success[0]).toMatch(/#1d6e56/);
        expect(success[0]).toMatch(/#5dcaa5/);

        const failure = css.match(/\.todoMdViewerRunPill--failure\s*\{[^}]*\}/);
        expect(failure).not.toBeNull();
        expect(failure[0]).toMatch(/#2a1414/);
        expect(failure[0]).toMatch(/#a32d2d/);
        expect(failure[0]).toMatch(/#f09595/);

        const timeout = css.match(/\.todoMdViewerRunPill--timeout\s*\{[^}]*\}/);
        expect(timeout).not.toBeNull();
        expect(timeout[0]).toMatch(/#444441/);
        expect(timeout[0]).toMatch(/#888780/);

        // The spinner only renders in the in-flight states, so it too is amber,
        // mirroring .todoMdViewerDeployPillSpinner.
        const spinner = css.match(/\.todoMdViewerRunPillSpinner\s*\{[^}]*\}/);
        expect(spinner).not.toBeNull();
        expect(spinner[0]).toMatch(/border:\s*2px solid var\(--text-warning\)/);
        expect(spinner[0]).toMatch(/border-top-color:\s*transparent/);
    });
});

describe('todo.md viewer — run-status pill persistence across navigation/reload', () => {

    const main = read('todoMdViewer.js');

    it('sources the per-project active-run helpers from the shared runState module', () => {
        // The single-slot helpers were replaced by the per-project runState
        // module so a chat-shipped run drives this same pill; the viewer no
        // longer defines or keys its own active-run storage.
        expect(main).toMatch(
            /import\s*\{[\s\S]*?readActiveRun[\s\S]*?writeActiveRun[\s\S]*?clearActiveRun[\s\S]*?activeProjectNameForViewer[\s\S]*?ACTIVE_RUN_CHANGE_EVENT[\s\S]*?\}\s*from\s*['"]\.\/runState\.js['"]/
        );
        expect(main).not.toMatch(/ACTIVE_RUN_KEY\s*=/);
        expect(main).not.toMatch(/function\s+readActiveRun\s*\(/);
        expect(main).not.toMatch(/function\s+writeActiveRun\s*\(/);
        expect(main).not.toMatch(/function\s+clearActiveRun\s*\(/);
    });

    it('writes the record on a successful dispatch under this project key with target and timestamp', () => {
        const start = main.indexOf('async function runBacklog');
        const block = main.slice(start, start + 2000);
        expect(block).toMatch(/writeActiveRun\(\s*projectName\s*,\s*\{[\s\S]{0,260}correlationId:\s*correlationId/);
        expect(block).toMatch(/writeActiveRun\(\s*projectName\s*,\s*\{[\s\S]{0,260}project:\s*projectName/);
        expect(block).toMatch(/writeActiveRun\(\s*projectName\s*,\s*\{[\s\S]{0,260}dispatchedAt:\s*Date\.now\(\)/);
    });

    it('sources the redeploy-flag helpers from runState so run dispatch can gate on a redeploy', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?readActiveRedeploy[\s\S]*?writeActiveRedeploy[\s\S]*?clearActiveRedeploy[\s\S]*?\}\s*from\s*['"]\.\/runState\.js['"]/
        );
    });

    it('mirrors the local rebuild flag into the shared redeploy state via setPagesRebuilding', () => {
        // Every rebuild-flag transition routes through one helper so the shared
        // per-project redeploy flag stays in lockstep with pagesRebuilding.
        const start = main.indexOf('function setPagesRebuilding');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 300);
        expect(block).toMatch(/pagesRebuilding\s*=\s*active/);
        expect(block).toMatch(/writeActiveRedeploy\(\s*projectName\s*,/);
        expect(block).toMatch(/clearActiveRedeploy\(\s*projectName\s*\)/);
        // The raw true-assignment was replaced by the helper (the only bare
        // `pagesRebuilding =` left is its `let ... = false` declaration).
        expect(main).not.toMatch(/pagesRebuilding\s*=\s*true/);
        expect((main.match(/pagesRebuilding\s*=\s*false/g) || []).length).toBe(1);
    });

    it('sets the shared redeploy flag when a redeploy starts and clears it when it settles', () => {
        // requestPagesRedeploy flips it on at tap time.
        const redeploy = main.indexOf('async function requestPagesRedeploy');
        expect(redeploy).toBeGreaterThan(-1);
        expect(main.slice(redeploy, redeploy + 600)).toMatch(/setPagesRebuilding\(\s*true\s*\)/);
        // The poll clears it on both terminal paths (completed settle + give-up).
        const poll = main.indexOf('function startPagesPoll');
        const pollBlock = main.slice(poll, poll + 1200);
        expect((pollBlock.match(/setPagesRebuilding\(\s*false\s*\)/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    it('blocks Run backlog dispatch while a redeploy is in progress for this project', () => {
        const start = main.indexOf('async function runBacklog');
        const block = main.slice(start, start + 800);
        expect(block).toMatch(/if\s*\(\s*readActiveRedeploy\(\s*projectName\s*\)\s*\)\s*\{/);
        expect(block).toMatch(/A redeploy is in progress for this project/);
        // The redeploy gate sits before the button is disabled / the dispatch fires.
        expect(block.indexOf('readActiveRedeploy')).toBeLessThan(block.indexOf('runBacklogBtn.disabled = true'));
    });

    it('blocks Run this entry dispatch while a redeploy is in progress for this project', () => {
        const start = main.indexOf('async function runEntry');
        const block = main.slice(start, start + 800);
        expect(block).toMatch(/if\s*\(\s*readActiveRedeploy\(\s*projectName\s*\)\s*\)\s*\{/);
        expect(block).toMatch(/A redeploy is in progress for this project/);
    });

    it('re-attaches the pill on mount from this project key (runState scopes it per project)', () => {
        // Fires on every card mount (project switch AND full page reload). The
        // key is project-scoped, so runs on other projects never surface here.
        expect(main).toMatch(
            /const\s+activeRun\s*=\s*readActiveRun\(\s*projectName\s*\)[\s\S]{0,120}startRunPill\(\s*activeRun\.correlationId\s*\)/
        );
    });

    it('subscribes to the runState change event so a mounted viewer attaches/detaches with the project key', () => {
        // A chat-shipped run writes the project key; a viewer already showing
        // that project attaches its pill on the change event and restores the
        // button when the key is cleared (ignoring other projects' events).
        expect(main).toMatch(/document\.addEventListener\(\s*ACTIVE_RUN_CHANGE_EVENT\s*,\s*viewerActiveRunChangeHandler\s*\)/);
        const start = main.indexOf('viewerActiveRunChangeHandler = function');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 600);
        expect(block).toMatch(/!==\s*projectName\s*\)\s*return/);
        expect(block).toMatch(/readActiveRun\(\s*projectName\s*\)/);
        // A local run takes over even from a server-driven (cross-device) pill,
        // so the start condition also fires when serverDrivenPill is set.
        expect(block).toMatch(/if\s*\(\s*!runPill\s*\|\|\s*serverDrivenPill\s*\)\s*startRunPill\(\s*rec\.correlationId\s*\)/);
        expect(block).toMatch(/restoreRunButton\(\)/);
        // The subscription is torn down with the card.
        expect(main).toMatch(/removeEventListener\(\s*ACTIVE_RUN_CHANGE_EVENT\s*,\s*viewerActiveRunChangeHandler\s*\)/);
    });

    it('computes the 20-minute give-up against the persisted dispatch timestamp, not the re-attach time', () => {
        const start = main.indexOf('function startRunPill');
        const block = main.slice(start, start + 1900);
        // startedAt comes from the persisted (project-keyed) record's dispatchedAt.
        expect(block).toMatch(/readActiveRun\(\s*projectName\s*\)/);
        expect(block).toMatch(/rec\.dispatchedAt[\s\S]{0,60}rec\.dispatchedAt/);
        expect(block).toMatch(/startedAt\s*=\s*\(rec[\s\S]{0,80}rec\.dispatchedAt/);
    });

    it('polls once immediately on (re)start so an already-finished run skips the running flash', () => {
        const start = main.indexOf('function startRunPill');
        const block = main.slice(start, start + 2400);
        // An immediate poll exists in addition to the setInterval poll.
        const polls = block.match(/pollRunOnce\(\s*correlationId\s*,\s*startedAt\s*\)/g) || [];
        expect(polls.length).toBeGreaterThanOrEqual(2);
    });

    it('clears the persisted record on every terminal outcome so a stale record cannot re-attach a finished run', () => {
        for (const fn of ['showRunSuccess', 'showRunFailure', 'showRunTimeout']) {
            const start = main.indexOf('function ' + fn);
            expect(start).toBeGreaterThan(-1);
            const block = main.slice(start, start + 600);
            expect(block).toMatch(/clearActiveRun\(\s*projectName\s*\)/);
        }
    });
});

describe('todo.md viewer — per-entry "Run this entry" control', () => {

    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('passes an onRunEntry callback into the rendered-body builder', () => {
        // The rendered body is rebuilt on tab swap and on sync; both pass the
        // card-scoped runEntry handler so per-entry controls can dispatch.
        const matches = main.match(/buildViewerRenderedBody\([^)]*onRunEntry:\s*runEntry/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('renders the control only for top-level entries that resolved a marker id', () => {
        const start = main.indexOf('function buildViewerRenderedBody');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 2600);
        expect(block).toMatch(/onRunEntry\s*&&\s*tok\.indent\s*===\s*0\s*&&\s*tok\.entryId/);
        expect(block).toMatch(/todoMdViewerRunEntryBtn/);
        expect(block).toMatch(/Run this entry/);
    });

    it('dispatches an entry-mode run with the resolved id and a fresh correlation id', () => {
        const start = main.indexOf('async function runEntry');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 2000);
        expect(block).toMatch(/mode:\s*['"]entry['"]/);
        expect(block).toMatch(/entryId:\s*entryId/);
        expect(block).toMatch(/crypto\.randomUUID\s*\(\s*\)/);
    });

    it('hands a successful dispatch to the shared header pill via startRunPill', () => {
        const start = main.indexOf('async function runEntry');
        const block = main.slice(start, start + 2400);
        expect(block).toMatch(/dispatchedId\s*=\s*correlationId/);
        expect(block).toMatch(/if\s*\(\s*dispatchedId\s*\)\s*startRunPill\s*\(\s*dispatchedId\s*\)/);
    });

    it('persists the active-run record on an entry dispatch so the pill survives navigation', () => {
        const start = main.indexOf('async function runEntry');
        const block = main.slice(start, start + 2000);
        expect(block).toMatch(/writeActiveRun\(\s*projectName\s*,\s*\{[\s\S]{0,260}correlationId:\s*correlationId/);
        expect(block).toMatch(/writeActiveRun\(\s*projectName\s*,\s*\{[\s\S]{0,260}project:\s*projectName/);
    });

    it('refuses to dispatch a second run while this project already has a fresh active run', () => {
        // The single-run model is now scoped per project via runState: a run on
        // a different project no longer blocks; only this project's fresh run does.
        const start = main.indexOf('async function runEntry');
        const block = main.slice(start, start + 600);
        expect(block).toMatch(/if\s*\(\s*readActiveRun\(\s*projectName\s*\)\s*\)\s*\{/);
        expect(block).toMatch(/A run is already in progress for this project/);
    });

    it('disables every per-entry control while the pill is active', () => {
        expect(main).toMatch(/function\s+syncRunEntryButtonsDisabled\s*\(/);
        const start = main.indexOf('function syncRunEntryButtonsDisabled');
        const block = main.slice(start, start + 500);
        expect(block).toMatch(/const\s+runActive\s*=\s*!!runPill/);
        expect(block).toMatch(/todoMdViewerRunEntryBtn/);
        // Toggled on both pill start and teardown.
        const pillStart = main.indexOf('function startRunPill');
        const pillEnd = main.indexOf('async function runBacklog', pillStart);
        expect(main.slice(pillStart, pillEnd)).toMatch(/syncRunEntryButtonsDisabled\(\)/);
        const restoreStart = main.indexOf('function restoreRunButton');
        const restoreEnd = main.indexOf('function syncRunEntryButtonsDisabled', restoreStart);
        expect(main.slice(restoreStart, restoreEnd)).toMatch(/syncRunEntryButtonsDisabled\(\)/);
    });

    it('shows the inject/run error toast variant on a failed dispatch', () => {
        const start = main.indexOf('async function runEntry');
        const block = main.slice(start, start + 2000);
        expect(block).toMatch(/showInjectToast\([^,]*,\s*['"]error['"]\s*\)/);
    });

    it('never renders the marker comment as visible content', () => {
        // Marker-only lines are suppressed and an inline marker is stripped
        // from the row label — the id is internal plumbing.
        const start = main.indexOf('function buildViewerRenderedBody');
        const end = main.indexOf('function buildViewerRawBody', start);
        const block = main.slice(start, end === -1 ? start + 3200 : end);
        // Inline marker stripped from the row label.
        expect(block).toMatch(/replace\(\s*TODO_MD_ID_MARKER_RE/);
        // Marker-only lines suppressed from the rendered output.
        expect(block).toMatch(/<!-- id: \\S\+ -->/);
    });

    it('styles the control with the inject/run vocabulary (#161622 fill, #2a2a38 border, #9D93EE text)', () => {
        const ruleMatch = css.match(/\.todoMdViewerRunEntryBtn\s*\{[^}]*\}/);
        expect(ruleMatch).not.toBeNull();
        const rule = ruleMatch[0];
        expect(rule).toMatch(/background:\s*#161622/);
        expect(rule).toMatch(/border:[^;]*#2a2a38/);
        expect(rule).toMatch(/color:\s*#9D93EE/);
    });
});

describe('todo.md viewer — style.css', () => {

    const css = read('style.css');

    it('defines the card surface and tab styling matching the Void aesthetic', () => {
        expect(css).toMatch(/\.todoMdViewerCard\s*\{/);
        expect(css).toMatch(/\.todoMdViewerTab\s*\{/);
        // Purple accent on the active tab underline, per spec.
        expect(css).toMatch(/\.todoMdViewerTab\.is-active[\s\S]{0,200}#6C5DF5/);
    });

    it('uses monospace for the raw tab body', () => {
        expect(css).toMatch(/\.todoMdViewerRaw[\s\S]{0,200}SpaceMono/);
    });

    it('keeps the inline #mainList card sized to content so it cannot collapse to the 54px grid floor', () => {
        // Bug: #mainList uses grid-auto-rows: minmax(54px, auto). The card's
        // base rule has `min-height: 0` + `overflow: hidden`, which zeroes its
        // grid-track minimum contribution. Once a project has many completed
        // rows the grid overflows (no free space to maximize tracks), the
        // card's auto track resolves to the 54px floor, and overflow:hidden
        // crops it to a sliver. The inline card must declare an explicit
        // `min-height: max-content` so its minimum contribution is its real
        // content height and the track always grows to fit.
        const ruleMatch = css.match(/#mainList\s+\.todoMdViewerCard\s*\{[^}]*\}/);
        expect(ruleMatch).not.toBeNull();
        expect(ruleMatch[0]).toMatch(/min-height:\s*max-content/);
    });

    it('pins the viewer card to flex: 0 0 auto when #mainList is in empty-state flex mode so it cannot be squeezed to a sliver', () => {
        // Bug: on a project with no open todos #mainList gets
        // .emptyStatePresent, switching it to a flex column. The completed
        // rows are pinned flex: 0 0 auto but #todoMdViewerCard was left at
        // the default shrinkable flex: 0 1 auto. With many completed rows the
        // shrink deficit collapses the card (min-height:0 + overflow:hidden)
        // to a one-line sliver. The card must join the pinned group.
        const ruleMatch = css.match(
            /#mainList\.emptyStatePresent\s+#completedHeader[\s\S]*?\{\s*flex:\s*0\s+0\s+auto;\s*\}/
        );
        expect(ruleMatch).not.toBeNull();
        expect(ruleMatch[0]).toMatch(/#mainList\.emptyStatePresent\s+#todoMdViewerCard\b/);
    });

    it('drops the repo·path label and its mobile-only header fork — the meta row carries only the timestamp + Sync button on every viewport so the button no longer overflows at ~380px', () => {
        // Bug: at ~380px the meta row tried to fit repo·path, "synced Xd
        // ago", and the Sync button on one line, pushing Sync off the
        // card. Fix removes the repo·path label entirely (project name
        // already tells the user which file they're viewing) and
        // collapses to a single header layout, no breakpoint fork.
        const mainJs = read('todoMdViewer.js');
        expect(mainJs).not.toMatch(/todoMdViewerRepo/);
        expect(mainJs).not.toMatch(/target\.repo\s*\+\s*['"][^'"]*['"]\s*\+\s*target\.file_path/);
        expect(css).not.toMatch(/\.todoMdViewerRepo\b/);
        // Single layout — the previously mobile-only header restack
        // (flex-direction: column inside @media (max-width: 1023px)) is
        // gone, so there's one style to maintain across viewports.
        expect(css).not.toMatch(/\.todoMdViewerHeader\s*\{[^}]*flex-direction:\s*column/);
    });
});

describe('todo.md viewer — per-entry delete + clear ops (rewrite)', () => {

    const inject = read('inject.js');
    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('inject.js exports rewriteTodoMd', () => {
        expect(inject).toMatch(/export\s+async\s+function\s+rewriteTodoMd\s*\(/);
    });

    it('rewriteTodoMd POSTs `{ rewrite: true, op, id, repo, filePath }` through postToWorker', () => {
        expect(inject).toMatch(
            /postToWorker\s*\(\s*\{[\s\S]{0,200}rewrite:\s*true[\s\S]{0,200}op:\s*op[\s\S]{0,200}id:\s*id[\s\S]{0,200}repo:\s*target\.repo[\s\S]{0,200}filePath:\s*target\.file_path/
        );
    });

    it('rewriteTodoMd guards a missing target and funnels failures through describeError', () => {
        expect(inject).toMatch(/rewriteTodoMd[\s\S]{0,200}reason:\s*['"]No target['"]/);
        expect(inject).toMatch(/rewriteTodoMd[\s\S]{0,600}catch[\s\S]{0,80}describeError/);
    });

    it('viewer imports rewriteTodoMd and showConfirmModal', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\brewriteTodoMd\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
        expect(main).toMatch(/import\s*\{\s*showConfirmModal\s*\}\s*from\s*['"]\.\/modals\.js['"]/);
    });

    it('renders the trash button only for top-level id-bearing entries, same gate as Run', () => {
        // The render gate is `onDeleteEntry && tok.indent === 0 && tok.entryId`,
        // mirroring the Run button so an id-less entry never gets a trash.
        expect(main).toMatch(/onDeleteEntry\s*&&\s*tok\.indent\s*===\s*0\s*&&\s*tok\.entryId/);
        expect(main).toMatch(/delBtn\.className\s*=\s*['"]todoMdViewerDeleteEntryBtn['"]/);
    });

    it('the trash click stops propagation so it never triggers the row/card tap or the Run action', () => {
        const start = main.indexOf("delBtn.addEventListener('click'");
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 200);
        expect(block).toMatch(/event\.stopPropagation\(\)/);
        expect(block).toMatch(/onDeleteEntry\(\s*tok\.entryId/);
    });

    it('per-entry delete confirms (naming the entry) then deletes by id via op delete_entry', () => {
        const start = main.indexOf('function deleteEntry');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 400);
        expect(block).toMatch(/showConfirmModal/);
        expect(block).toMatch(/performRewrite\(\s*['"]delete_entry['"]\s*,\s*entryId/);
    });

    it('renders a "⋯" overflow menu in the meta row with Clear completed and Clear all items', () => {
        expect(main).toMatch(/overflowBtn\.className\s*=\s*['"]todoMdViewerOverflowBtn['"]/);
        expect(main).toMatch(/meta\.appendChild\(overflowWrap\);/);
        expect(main).toMatch(/clearCompletedItem\.textContent\s*=\s*['"]Clear completed['"]/);
        expect(main).toMatch(/clearAllItem\.textContent\s*=\s*['"]Clear all['"]/);
    });

    it('the overflow menu closes four ways (select, outside-click, Escape, re-tap)', () => {
        // Re-tap: the button toggles open/closed. Outside-click + Escape are
        // wired via document listeners installed on open and removed on close.
        expect(main).toMatch(/overflowBtn\.addEventListener\(\s*['"]click['"]/);
        expect(main).toMatch(/if\s*\(\s*overflowMenu\.hidden\s*\)\s*openOverflowMenu\(\)[\s\S]{0,40}else\s+closeOverflowMenu\(\)/);
        expect(main).toMatch(/!overflowWrap\.contains\(\s*event\.target\s*\)\s*\)\s*closeOverflowMenu/);
        expect(main).toMatch(/event\.key\s*===\s*['"]Escape['"][\s\S]{0,80}closeOverflowMenu/);
        // Selecting an item closes the menu before opening the confirm.
        const cc = main.indexOf("clearCompletedItem.addEventListener('click'");
        expect(main.slice(cc, cc + 200)).toMatch(/closeOverflowMenu\(\)/);
    });

    it('toggles a --menuOpen class on the card so a collapsed card un-clips its overflow while the menu is open', () => {
        // A collapsed card is only as tall as its header and clips with
        // `overflow: hidden`; the menu drops below the header into that clipped
        // region. openOverflowMenu adds the class, closeOverflowMenu removes it.
        const openStart = main.indexOf('function openOverflowMenu');
        expect(openStart).toBeGreaterThan(-1);
        expect(main.slice(openStart, openStart + 900))
            .toMatch(/card\.classList\.add\(\s*['"]todoMdViewerCard--menuOpen['"]\s*\)/);

        const closeStart = main.indexOf('function closeOverflowMenu');
        expect(closeStart).toBeGreaterThan(-1);
        expect(main.slice(closeStart, closeStart + 900))
            .toMatch(/card\.classList\.remove\(\s*['"]todoMdViewerCard--menuOpen['"]\s*\)/);

        // CSS un-clips the inline card while the menu is open.
        expect(css).toMatch(
            /#mainList\s+\.todoMdViewerCard\.todoMdViewerCard--menuOpen\s*\{[\s\S]{0,80}overflow:\s*visible/
        );
    });

    it('Clear completed and Clear all route the right ops, with Clear all gated by a two-step confirm', () => {
        const ccStart = main.indexOf("clearCompletedItem.addEventListener('click'");
        const ccBlock = main.slice(ccStart, ccStart + 700);
        expect(ccBlock).toMatch(/performRewrite\(\s*['"]clear_completed['"]/);

        const caStart = main.indexOf("clearAllItem.addEventListener('click'");
        const caBlock = main.slice(caStart, caStart + 1000);
        // Two showConfirmModal calls nested — the second only reached after the
        // first confirms — before the irreversible clear_all write.
        expect((caBlock.match(/showConfirmModal/g) || []).length).toBeGreaterThanOrEqual(2);
        expect(caBlock).toMatch(/performRewrite\(\s*['"]clear_all['"]/);
    });

    it('performRewrite re-runs the viewer fetch-and-render after a successful rewrite', () => {
        const start = main.indexOf('async function performRewrite');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 500);
        expect(block).toMatch(/rewriteTodoMd\(\s*target\s*,\s*op\s*,\s*id\s*\)/);
        expect(block).toMatch(/if\s*\(\s*res\.ok\s*\)\s*\{[\s\S]{0,80}runSync\(\)/);
        // A failure surfaces a toast rather than refreshing.
        expect(block).toMatch(/showInjectToast\([^,]*,\s*['"]error['"]\s*\)/);
    });

    it('styles the trash button and the overflow menu (menu mirrors the project context menu surface)', () => {
        expect(css).toMatch(/\.todoMdViewerDeleteEntryBtn\s*\{/);
        expect(css).toMatch(/\.todoMdViewerOverflowMenu\s*\{[\s\S]{0,400}box-shadow/);
        expect(css).toMatch(/\.todoMdViewerOverflowItem\.danger\s*\{/);
    });

    // Behavior tests on the exported pure renderer — the trash button presence
    // and its callback are exercised directly without the full card mount.
    it('buildViewerRenderedBody renders a trash button for an id-bearing entry and fires onDeleteEntry on click', () => {
        const text = '- [ ] Add a thing <!-- id: entry-xyz -->';
        const calls = [];
        const wrap = buildViewerRenderedBody(text, {
            onDeleteEntry: (id, label, btn) => calls.push({ id, label, btn }),
        });
        const trash = wrap.querySelector('.todoMdViewerDeleteEntryBtn');
        expect(trash).not.toBeNull();
        expect(trash.dataset.entryId).toBe('entry-xyz');
        trash.click();
        expect(calls).toHaveLength(1);
        expect(calls[0].id).toBe('entry-xyz');
        expect(calls[0].label).toBe('Add a thing');
    });

    it('buildViewerRenderedBody omits the trash button for an entry without an id marker', () => {
        const wrap = buildViewerRenderedBody('- [ ] No marker here', {
            onDeleteEntry: () => {},
        });
        expect(wrap.querySelector('.todoMdViewerDeleteEntryBtn')).toBeNull();
    });

    it('buildViewerRenderedBody omits the trash button when no onDeleteEntry callback is supplied', () => {
        const wrap = buildViewerRenderedBody('- [ ] Add a thing <!-- id: entry-xyz -->', {});
        expect(wrap.querySelector('.todoMdViewerDeleteEntryBtn')).toBeNull();
    });
});

describe('todo.md viewer — per-entry Revert control on completed rows', () => {

    const inject = read('inject.js');
    const main = read('todoMdViewer.js');
    const css = read('style.css');

    it('inject.js exports revertEntry, the helper shared with the Runs-tab control', () => {
        expect(inject).toMatch(/export\s+async\s+function\s+revertEntry\s*\(\s*entryId\s*,\s*target\s*\)/);
        expect(inject).toMatch(/revertEntry[\s\S]{0,400}revert:\s*true[\s\S]{0,80}entry_id:\s*entryId/);
    });

    it('viewer imports revertEntry from inject.js', () => {
        expect(main).toMatch(
            /import\s*\{[\s\S]*?\brevertEntry\b[\s\S]*?\}\s*from\s*['"]\.\/inject\.js['"]/
        );
    });

    it('passes an onRevertEntry callback into the rendered-body builder on both render paths', () => {
        const matches = main.match(/buildViewerRenderedBody\([^)]*onRevertEntry:\s*revertCompletedEntry/g) || [];
        expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('renders the Revert pill only for top-level, completed, id-bearing entries not yet reverted', () => {
        const start = main.indexOf('function buildViewerRenderedBody');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 5200);
        expect(block).toMatch(
            /onRevertEntry\s*&&\s*tok\.indent\s*===\s*0\s*&&\s*tok\.entryId\s*&&\s*tok\.checked\s*&&\s*[\s\S]{0,60}!revertedThisSession\.has\(\s*tok\.entryId\s*\)/
        );
        expect(block).toMatch(/todoMdViewerRevertEntryBtn/);
        expect(block).toMatch(/>Revert</);
    });

    it('hides "Run this entry" on completed rows (Run gate now also requires !tok.checked)', () => {
        const start = main.indexOf('function buildViewerRenderedBody');
        const block = main.slice(start, start + 5200);
        expect(block).toMatch(/onRunEntry\s*&&\s*tok\.indent\s*===\s*0\s*&&\s*tok\.entryId\s*&&\s*!tok\.checked/);
    });

    it('the Revert click stops propagation so it never triggers the row/card tap or iterate', () => {
        const start = main.indexOf("revertBtn.addEventListener('click'");
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 200);
        expect(block).toMatch(/event\.stopPropagation\(\)/);
        expect(block).toMatch(/onRevertEntry\(\s*tok\.entryId/);
    });

    it('revertCompletedEntry confirms (naming the entry) then reverts by id, with no active-run guard', () => {
        const start = main.indexOf('function revertCompletedEntry');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 800);
        // Not gated by readActiveRun — a revert is a PR op, not a dispatch.
        expect(block).not.toMatch(/readActiveRun/);
        expect(block).toMatch(/showConfirmModal/);
        expect(block).toMatch(/ships a rollback/);
        expect(block).toMatch(/performRevert\(\s*entryId\s*,\s*btn\s*\)/);
    });

    it('a pending revert PR opens that PR rather than POSTing a duplicate revert', () => {
        const start = main.indexOf('function revertCompletedEntry');
        const block = main.slice(start, start + 800);
        expect(block).toMatch(/pendingRevertPrUrls\.get\(\s*entryId\s*\)/);
        expect(block).toMatch(/window\.open\(/);
    });

    it('performRevert handles the three Worker outcomes (merged / pending PR / error)', () => {
        const start = main.indexOf('async function performRevert');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1600);
        expect(block).toMatch(/revertEntry\(\s*entryId\s*,\s*target\s*\)/);
        // merged:true → success toast + record reverted this session (double-revert guard).
        expect(block).toMatch(/res\.merged\s*===\s*true/);
        expect(block).toMatch(/revertedThisSession\.add\(\s*entryId\s*\)/);
        expect(block).toMatch(/Reverted — new build shipping/);
        // merged:false → persist the PR url so the control links to it next render.
        expect(block).toMatch(/res\.merged\s*===\s*false/);
        expect(block).toMatch(/pendingRevertPrUrls\.set\(\s*entryId\s*,\s*res\.revert_pr_url\s*\)/);
        // ok:false → error toast.
        expect(block).toMatch(/showInjectToast\([^,]*,\s*['"]error['"]\s*\)/);
    });

    it('styles the Revert pill on the Run-pill geometry with the warning-amber accent', () => {
        const ruleMatch = css.match(/\.todoMdViewerRevertEntryBtn\s*\{[^}]*\}/);
        expect(ruleMatch).not.toBeNull();
        const rule = ruleMatch[0];
        expect(rule).toMatch(/color:\s*var\(--text-warning\)/);
        expect(rule).toMatch(/margin-left:\s*auto/);
    });

    // Behavior tests on the exported pure renderer — Revert presence is keyed
    // on the entry being completed, and it replaces Run there.
    it('buildViewerRenderedBody renders a Revert pill (not Run) for a completed id-bearing entry and fires onRevertEntry', () => {
        const text = '- [x] Ship a thing <!-- id: done-1 -->';
        const calls = [];
        const wrap = buildViewerRenderedBody(text, {
            onRunEntry: () => {},
            onRevertEntry: (id, label, btn) => calls.push({ id, label, btn }),
        });
        const revert = wrap.querySelector('.todoMdViewerRevertEntryBtn');
        expect(revert).not.toBeNull();
        expect(wrap.querySelector('.todoMdViewerRunEntryBtn')).toBeNull();
        expect(revert.dataset.entryId).toBe('done-1');
        revert.click();
        expect(calls).toHaveLength(1);
        expect(calls[0].id).toBe('done-1');
        expect(calls[0].label).toBe('Ship a thing');
    });

    it('buildViewerRenderedBody renders Run (not Revert) for an open id-bearing entry', () => {
        const text = '- [ ] Build a thing <!-- id: open-1 -->';
        const wrap = buildViewerRenderedBody(text, {
            onRunEntry: () => {},
            onRevertEntry: () => {},
        });
        expect(wrap.querySelector('.todoMdViewerRunEntryBtn')).not.toBeNull();
        expect(wrap.querySelector('.todoMdViewerRevertEntryBtn')).toBeNull();
    });

    it('buildViewerRenderedBody omits the Revert pill for a completed entry without an id marker', () => {
        const wrap = buildViewerRenderedBody('- [x] No marker here', {
            onRevertEntry: () => {},
        });
        expect(wrap.querySelector('.todoMdViewerRevertEntryBtn')).toBeNull();
    });

    it('buildViewerRenderedBody omits the Revert pill when no onRevertEntry callback is supplied', () => {
        const wrap = buildViewerRenderedBody('- [x] Ship a thing <!-- id: done-2 -->', {});
        expect(wrap.querySelector('.todoMdViewerRevertEntryBtn')).toBeNull();
    });
});
