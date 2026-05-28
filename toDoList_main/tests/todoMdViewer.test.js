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
