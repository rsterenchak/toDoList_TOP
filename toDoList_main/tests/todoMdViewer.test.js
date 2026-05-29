import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseTodoMdChecklist } from '../src/main.js';

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

    const main = read('main.js');

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

    it('exposes a Sync button that re-fetches on click', () => {
        expect(main).toMatch(/syncBtn\.textContent\s*=\s*['"]Sync['"]/);
        expect(main).toMatch(/syncBtn\.addEventListener\s*\(\s*['"]click['"]\s*,\s*runSync\s*\)/);
    });

    it('reuses readTodoMdFromWorker — no parallel transport in main.js', () => {
        // The card MUST go through inject.js's helper, not a freestanding
        // fetch() call, so the Worker URL / Bearer secret / Authorization
        // header live in exactly one place.
        expect(main).toMatch(/readTodoMdFromWorker\s*\(\s*target\s*\)/);
        // No bare fetch( inside the viewer block — search for the
        // viewer-scoped functions and assert fetch isn't used there.
        const viewerStart = main.indexOf('VIEWER_LASTFETCH_PREFIX');
        const viewerEnd = main.indexOf("__todoMdViewerListenerRegistered");
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
        expect(main).toMatch(/__todoMdViewerListenerRegistered/);
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

describe('todo.md viewer — expand/collapse toggle', () => {

    const main = read('main.js');
    const css = read('style.css');

    it('persists expand state per project under the todoapp_ prefix', () => {
        expect(main).toMatch(/['"]todoapp_todomd_expanded_['"]/);
        expect(main).toMatch(/function\s+viewerExpandedKey\s*\(\s*projectName\s*\)/);
        expect(main).toMatch(/function\s+readViewerExpanded\s*\(\s*projectName\s*\)/);
        expect(main).toMatch(/function\s+writeViewerExpanded\s*\(\s*projectName\s*,\s*expanded\s*\)/);
    });

    it('renders an expand toggle button in the header', () => {
        expect(main).toMatch(/expandBtn\s*=\s*document\.createElement\(\s*['"]button['"]\s*\)/);
        expect(main).toMatch(/expandBtn\.className\s*=\s*['"]todoMdViewerExpandBtn['"]/);
    });

    it('appends the expand button immediately after the Sync button in the meta row', () => {
        // Acceptance: "Toggle appears right of Sync." Source-order check
        // catches the regression of inserting the expand button before
        // the Sync button or elsewhere in the header.
        const syncIdx = main.indexOf('meta.appendChild(syncBtn);');
        const expandIdx = main.indexOf('meta.appendChild(expandBtn);');
        expect(syncIdx).toBeGreaterThan(-1);
        expect(expandIdx).toBeGreaterThan(syncIdx);
    });

    it('restores the per-project expand state on mount and persists on click', () => {
        // Default-collapsed is enforced by readViewerExpanded returning
        // false when the key is missing (i.e. !== '1').
        expect(main).toMatch(/applyExpandedState\s*\(\s*readViewerExpanded\s*\(\s*projectName\s*\)\s*\)/);
        expect(main).toMatch(/writeViewerExpanded\s*\(\s*projectName\s*,\s*next\s*\)/);
    });

    it('flips icon and aria-label between expand and collapse on toggle', () => {
        expect(main).toMatch(/aria-label['"]\s*,\s*['"]Expand TODO\.md viewer['"]/);
        expect(main).toMatch(/aria-label['"]\s*,\s*['"]Collapse TODO\.md viewer['"]/);
    });

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

    it('styles the expand button to match the Void aesthetic (#161622 fill, #2a2a38 border, #9D93EE icon, ~28px)', () => {
        const ruleMatch = css.match(/\.todoMdViewerExpandBtn\s*\{[^}]*\}/);
        expect(ruleMatch).not.toBeNull();
        const rule = ruleMatch[0];
        expect(rule).toMatch(/background:\s*#161622/);
        expect(rule).toMatch(/border:[^;]*#2a2a38/);
        expect(rule).toMatch(/color:\s*#9D93EE/);
        expect(rule).toMatch(/width:\s*28px/);
        expect(rule).toMatch(/height:\s*28px/);
    });

    it('lifts the body max-height ceiling in the expanded state', () => {
        // Otherwise the desktop/mobile `max-height` ceilings would cap
        // the JS-computed inline height and the body would never fill.
        expect(css).toMatch(/\.todoMdViewerCard--expanded\s+\.todoMdViewerBody\s*\{[\s\S]{0,120}max-height:\s*none/);
    });
});

describe('todo.md viewer — Run backlog button + dispatchRun helper', () => {

    const inject = read('inject.js');
    const main = read('main.js');
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
        const block = main.slice(start, start + 2000);
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

    it('styles the Run backlog button to match the spec (#161622 fill, #2a2a38 border, #9D93EE text)', () => {
        const ruleMatch = css.match(/\.todoMdViewerRunBtn\s*\{[^}]*\}/);
        expect(ruleMatch).not.toBeNull();
        const rule = ruleMatch[0];
        expect(rule).toMatch(/background:\s*#161622/);
        expect(rule).toMatch(/border:[^;]*#2a2a38/);
        expect(rule).toMatch(/color:\s*#9D93EE/);
    });
});

describe('todo.md viewer — run-status pill + pollRunStatus helper', () => {

    const inject = read('inject.js');
    const main = read('main.js');
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
        const block = main.slice(start, start + 1200);
        expect(block).toMatch(/state:\s*['"]starting['"][\s\S]{0,80}label:\s*['"]Starting…['"][\s\S]{0,40}spinner:\s*true/);
    });

    it('maps Worker status responses to the documented pill states', () => {
        const start = main.indexOf('async function pollRunOnce');
        expect(start).toBeGreaterThan(-1);
        const block = main.slice(start, start + 1400);
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
        const block = main.slice(start, start + 700);
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

    it('gives up after 10 minutes with a neutral "still running" state, not a failure', () => {
        expect(main).toMatch(/RUN_GIVE_UP_MS\s*=\s*10\s*\*\s*60\s*\*\s*1000/);
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

    it('styles the in-flight pill quiet (muted) and only colors the terminal states', () => {
        const baseMatch = css.match(/\.todoMdViewerRunPill\s*\{[^}]*\}/);
        expect(baseMatch).not.toBeNull();
        const base = baseMatch[0];
        expect(base).toMatch(/background:\s*#161622/);
        expect(base).toMatch(/border:[^;]*#2a2a38/);
        expect(base).toMatch(/color:\s*#8a8699/);

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

        const spinner = css.match(/\.todoMdViewerRunPillSpinner\s*\{[^}]*\}/);
        expect(spinner).not.toBeNull();
        expect(spinner[0]).toMatch(/#534AB7/);
        expect(spinner[0]).toMatch(/#cdc9ee/);
    });
});

describe('todo.md viewer — run-status pill persistence across navigation/reload', () => {

    const main = read('main.js');

    it('stores the active run in a single localStorage slot under the todoapp_ prefix', () => {
        expect(main).toMatch(/ACTIVE_RUN_KEY\s*=\s*['"]todoapp_activeRun['"]/);
    });

    it('defines read/write/clear helpers for the active-run record', () => {
        expect(main).toMatch(/function\s+readActiveRun\s*\(/);
        expect(main).toMatch(/function\s+writeActiveRun\s*\(/);
        expect(main).toMatch(/function\s+clearActiveRun\s*\(/);
        // The record persists via localStorage keyed by ACTIVE_RUN_KEY.
        expect(main).toMatch(/localStorage\.getItem\(\s*ACTIVE_RUN_KEY\s*\)/);
        expect(main).toMatch(/localStorage\.setItem\(\s*ACTIVE_RUN_KEY\s*,/);
        expect(main).toMatch(/localStorage\.removeItem\(\s*ACTIVE_RUN_KEY\s*\)/);
    });

    it('readActiveRun rejects records without a usable correlation id', () => {
        const start = main.indexOf('function readActiveRun');
        const block = main.slice(start, start + 400);
        expect(block).toMatch(/typeof\s+rec\.correlationId\s*!==\s*['"]string['"]/);
    });

    it('writes the record on a successful dispatch with project, target and dispatch timestamp', () => {
        const start = main.indexOf('async function runBacklog');
        const block = main.slice(start, start + 2000);
        expect(block).toMatch(/writeActiveRun\(\s*\{[\s\S]{0,260}correlationId:\s*correlationId/);
        expect(block).toMatch(/writeActiveRun\(\s*\{[\s\S]{0,260}project:\s*projectName/);
        expect(block).toMatch(/writeActiveRun\(\s*\{[\s\S]{0,260}dispatchedAt:\s*Date\.now\(\)/);
    });

    it('re-attaches the pill on mount only when the active run belongs to this project', () => {
        // Fires on every card mount (project switch AND full page reload).
        expect(main).toMatch(
            /const\s+activeRun\s*=\s*readActiveRun\(\)[\s\S]{0,200}activeRun\.project\s*===\s*projectName[\s\S]{0,80}startRunPill\(\s*activeRun\.correlationId\s*\)/
        );
    });

    it('computes the 10-minute give-up against the persisted dispatch timestamp, not the re-attach time', () => {
        const start = main.indexOf('function startRunPill');
        const block = main.slice(start, start + 1400);
        // startedAt comes from the persisted record's dispatchedAt.
        expect(block).toMatch(/readActiveRun\(\)/);
        expect(block).toMatch(/rec\.dispatchedAt[\s\S]{0,60}rec\.dispatchedAt/);
        expect(block).toMatch(/startedAt\s*=\s*\(rec[\s\S]{0,80}rec\.dispatchedAt/);
    });

    it('polls once immediately on (re)start so an already-finished run skips the running flash', () => {
        const start = main.indexOf('function startRunPill');
        const block = main.slice(start, start + 2200);
        // An immediate poll exists in addition to the setInterval poll.
        const polls = block.match(/pollRunOnce\(\s*correlationId\s*,\s*startedAt\s*\)/g) || [];
        expect(polls.length).toBeGreaterThanOrEqual(2);
    });

    it('clears the persisted record on every terminal outcome so a stale record cannot re-attach a finished run', () => {
        for (const fn of ['showRunSuccess', 'showRunFailure', 'showRunTimeout']) {
            const start = main.indexOf('function ' + fn);
            expect(start).toBeGreaterThan(-1);
            const block = main.slice(start, start + 500);
            expect(block).toMatch(/clearActiveRun\(\)/);
        }
    });
});

describe('todo.md viewer — per-entry "Run this entry" control', () => {

    const main = read('main.js');
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
        const block = main.slice(start, start + 2000);
        expect(block).toMatch(/dispatchedId\s*=\s*correlationId/);
        expect(block).toMatch(/if\s*\(\s*dispatchedId\s*\)\s*startRunPill\s*\(\s*dispatchedId\s*\)/);
    });

    it('persists the active-run record on an entry dispatch so the pill survives navigation', () => {
        const start = main.indexOf('async function runEntry');
        const block = main.slice(start, start + 2000);
        expect(block).toMatch(/writeActiveRun\(\s*\{[\s\S]{0,260}correlationId:\s*correlationId/);
        expect(block).toMatch(/writeActiveRun\(\s*\{[\s\S]{0,260}project:\s*projectName/);
    });

    it('refuses to dispatch a second run while one is already tracked (single-run model)', () => {
        const start = main.indexOf('async function runEntry');
        const block = main.slice(start, start + 600);
        expect(block).toMatch(/if\s*\(\s*runPill\s*\|\|\s*viewerRunPollInterval\s*\)\s*return/);
    });

    it('disables every per-entry control while the pill is active', () => {
        expect(main).toMatch(/function\s+syncRunEntryButtonsDisabled\s*\(/);
        const start = main.indexOf('function syncRunEntryButtonsDisabled');
        const block = main.slice(start, start + 500);
        expect(block).toMatch(/const\s+active\s*=\s*!!runPill/);
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

    it('drops the repo·path label and its mobile-only header fork — the meta row carries only the timestamp + Sync button on every viewport so the button no longer overflows at ~380px', () => {
        // Bug: at ~380px the meta row tried to fit repo·path, "synced Xd
        // ago", and the Sync button on one line, pushing Sync off the
        // card. Fix removes the repo·path label entirely (project name
        // already tells the user which file they're viewing) and
        // collapses to a single header layout, no breakpoint fork.
        const mainJs = read('main.js');
        expect(mainJs).not.toMatch(/todoMdViewerRepo/);
        expect(mainJs).not.toMatch(/target\.repo\s*\+\s*['"][^'"]*['"]\s*\+\s*target\.file_path/);
        expect(css).not.toMatch(/\.todoMdViewerRepo\b/);
        // Single layout — the previously mobile-only header restack
        // (flex-direction: column inside @media (max-width: 700px)) is
        // gone, so there's one style to maintain across viewports.
        expect(css).not.toMatch(/\.todoMdViewerHeader\s*\{[^}]*flex-direction:\s*column/);
    });
});
