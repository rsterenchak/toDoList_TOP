import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the cross-project INBOX ideas view, which REPLACES
// the earlier "Inbox coming soon" placeholder. renderInbox() owns the
// runtime render: it pulls every status==='idea' todo across projects from
// listLogic.getIdeaTodosAcrossProjects(), builds one row per idea (reusing
// the entry-#2 status-change popover), and shows a centered empty state
// when there are none. buildInboxRow() shapes each row to the contract the
// shared status popover depends on (id="toDoChild" + data-value + __item +
// .todoStatusLabel). The runtime query behaviour is covered separately in
// inboxIdeasQuery.test.js.
describe('Cross-project INBOX ideas view', () => {
    const main = read('main.js');
    const inbox = read('inboxView.js');
    const css = read('style.css');

    // Extract a top-level `function <name>(...) { ... }` body by brace
    // matching, matching the approach the sibling view tests use. The inbox
    // render cluster now lives in inboxView.js; applyActiveView stays in
    // main.js — pass the right source for each.
    function extractFn(name, source) {
        source = source || main;
        const idx = source.indexOf('function ' + name);
        expect(idx).toBeGreaterThan(-1);
        const braceStart = source.indexOf('{', idx);
        let depth = 0;
        for (let i = braceStart; i < source.length; i++) {
            if (source[i] === '{') depth++;
            else if (source[i] === '}') {
                depth--;
                if (depth === 0) return source.slice(braceStart, i + 1);
            }
        }
        throw new Error('unterminated ' + name + ' body');
    }

    describe('placeholder removal (i)', () => {
        it('no longer defines renderInboxPlaceholder', () => {
            expect(main).not.toMatch(/function\s+renderInboxPlaceholder/);
        });

        it('does not render the "Inbox coming soon" placeholder anywhere', () => {
            expect(main).not.toMatch(/Inbox coming soon/);
            expect(main).not.toMatch(/inboxPlaceholder/);
        });

        it('drops the dead .inboxPlaceholder CSS rule', () => {
            expect(css).not.toMatch(/\.inboxPlaceholder\s*\{/);
        });
    });

    describe('renderInbox (inboxView.js)', () => {
        const body = extractFn('renderInbox', inbox);

        it('short-circuits when #inboxView is missing (boot-order safe)', () => {
            expect(body).toMatch(/getElementById\(\s*['"]inboxView['"]\s*\)/);
            expect(body).toMatch(/if\s*\(\s*!inboxView\s*\)\s*return/);
        });

        it('reuses the entry-#2 status popover by wiring delegation on #inboxView', () => {
            expect(body).toMatch(/wireStatusLabelDelegation\(\s*inboxView\s*\)/);
        });

        it('clears #inboxView before rebuilding its contents', () => {
            expect(body).toMatch(/while\s*\(\s*inboxView\.firstChild\s*\)/);
        });

        it('(e) pulls ideas from the cross-project query and builds one row per idea', () => {
            expect(body).toMatch(/listLogic\.getIdeaTodosAcrossProjects\(\s*\)/);
            expect(body).toMatch(/forEach[\s\S]{0,120}buildInboxRow\(/);
        });

        it('(h) renders the empty state with the exact muted copy when there are no ideas', () => {
            expect(body).toMatch(/if\s*\(\s*!ideas\.length\s*\)/);
            expect(body).toMatch(/className\s*=\s*['"]inboxEmptyState['"]/);
            expect(body).toMatch(
                /Nothing captured yet\. Ideas you don't commit to right away end up here\./
            );
        });
    });

    describe('buildInboxRow (inboxView.js) — popover reuse contract (f)', () => {
        const body = extractFn('buildInboxRow', inbox);

        it('shapes the row like a committed todo row so the delegated popover resolves it', () => {
            expect(body).toMatch(/\.id\s*=\s*['"]toDoChild['"]/);
            expect(body).toMatch(/setAttribute\(\s*['"]data-value['"]\s*,\s*projectName\s*\)/);
            expect(body).toMatch(/\.__item\s*=\s*item/);
        });

        it('uses the shared buildStatusLabel as the status tap target', () => {
            expect(body).toMatch(/buildStatusLabel\(\s*item\s*\)/);
        });

        it('shows the originating project name and the task title', () => {
            expect(body).toMatch(/inboxRowProject/);
            expect(body).toMatch(/inboxRowTitle/);
            expect(body).toMatch(/textContent\s*=\s*item\.tit/);
        });
    });

    describe('status-change re-render (g)', () => {
        const body = extractFn('ensureInboxStatusRerender', inbox);

        it('re-renders the inbox after a status option commit, scoped to the inbox view', () => {
            expect(body).toMatch(/todoStatusOption/);
            expect(body).toMatch(/getActiveView\(\s*\)\s*!==\s*['"]inbox['"]/);
            expect(body).toMatch(/renderInbox/);
            // Capture phase so it fires before the popover's stopPropagation.
            expect(body).toMatch(/addEventListener\([\s\S]*?,\s*true\s*\)/);
        });
    });

    describe('applyActiveView wiring (main.js)', () => {
        const body = extractFn('applyActiveView');

        it('renders the inbox from the INBOX branch, after the data-view write', () => {
            const calls = body.match(/renderInbox\(\s*\)/g) || [];
            expect(calls.length).toBe(1);
            // The data-view attribute must be written before the render
            // branches so the CSS show/hide hook is in place by the time
            // renderInbox paints the surface.
            const dataViewIdx = body.indexOf("setAttribute('data-view', safe)");
            const callIdx = body.indexOf('renderInbox(');
            const inboxIdx = body.lastIndexOf("safe === 'inbox'");
            expect(dataViewIdx).toBeGreaterThan(-1);
            expect(inboxIdx).toBeGreaterThan(-1);
            // renderInbox is reached only via the safe === 'inbox' branch...
            expect(callIdx).toBeGreaterThan(inboxIdx);
            // ...and the data-view flip happens before that render branch.
            expect(dataViewIdx).toBeLessThan(inboxIdx);
        });

        it('still flips #mainBar data-view so switching to PROJECTS hides the Inbox surface', () => {
            expect(body).toMatch(/setAttribute\(\s*['"]data-view['"]\s*,\s*safe\s*\)/);
        });
    });

    describe('CSS (style.css)', () => {
        it('centers .inboxEmptyState with muted ~14px text and no inline JS styling', () => {
            const idx = css.indexOf('.inboxEmptyState {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/margin:\s*auto/);
            expect(rule).toMatch(/text-align:\s*center/);
            expect(rule).toMatch(/font-size:\s*14px/);
            expect(rule).toMatch(/color:\s*var\(--text-muted\)/);
        });

        it('styles the idea row title at >=16px (mobile no-zoom) and muted', () => {
            const idx = css.indexOf('.inboxRowTitle {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/font-size:\s*16px/);
            expect(rule).toMatch(/color:\s*var\(--text-muted\)/);
        });

        it('keeps #inboxView hidden unless INBOX is the active view', () => {
            const baseIdx = css.indexOf('#inboxView {');
            expect(baseIdx).toBeGreaterThan(-1);
            const base = css.slice(baseIdx, css.indexOf('}', baseIdx));
            expect(base).toMatch(/display:\s*none/);
            expect(css).toMatch(/#mainBar\[data-view="inbox"\]\s+#inboxView[\s\S]{0,160}display:\s*flex/);
        });
    });
});
