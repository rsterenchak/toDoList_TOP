import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the Inbox "coming soon" placeholder. The real
// cross-project ideas view is a follow-up entry; this entry closes the
// visual gap left by the Today removal / rename with a single centered
// placeholder. renderInboxPlaceholder() owns the runtime render and is
// invoked from applyActiveView's `safe === 'inbox'` branch.
describe('Inbox "coming soon" placeholder', () => {
    const main = read('main.js');
    const css  = read('style.css');

    // Extract a top-level `function <name>(...) { ... }` body by brace
    // matching, matching the approach the sibling view tests use.
    function extractFn(name) {
        const idx = main.indexOf('function ' + name);
        expect(idx).toBeGreaterThan(-1);
        const braceStart = main.indexOf('{', idx);
        let depth = 0;
        for (let i = braceStart; i < main.length; i++) {
            if (main[i] === '{') depth++;
            else if (main[i] === '}') {
                depth--;
                if (depth === 0) return main.slice(braceStart, i + 1);
            }
        }
        throw new Error('unterminated ' + name + ' body');
    }

    describe('renderInboxPlaceholder (main.js)', () => {
        const body = extractFn('renderInboxPlaceholder');

        it('builds a .inboxPlaceholder element reading "Inbox coming soon"', () => {
            expect(body).toMatch(/createElement\(\s*['"]div['"]\s*\)/);
            expect(body).toMatch(/className\s*=\s*['"]inboxPlaceholder['"]/);
            expect(body).toMatch(/textContent\s*=\s*['"]Inbox coming soon['"]/);
        });

        it('targets #inboxView, clears it, then mounts the placeholder', () => {
            expect(body).toMatch(/getElementById\(\s*['"]inboxView['"]\s*\)/);
            expect(body).toMatch(/while\s*\(\s*inboxView\.firstChild\s*\)/);
            expect(body).toMatch(/appendChild\(\s*placeholder\s*\)/);
        });

        it('short-circuits when #inboxView is missing (boot-order safe)', () => {
            expect(body).toMatch(/if\s*\(\s*!inboxView\s*\)\s*return/);
        });

        it('is idempotent — bails out when the placeholder already exists', () => {
            expect(body).toMatch(
                /querySelector\(\s*['"]\.inboxPlaceholder['"]\s*\)[\s\S]{0,40}return/
            );
        });
    });

    describe('applyActiveView wiring (main.js)', () => {
        const body = extractFn('applyActiveView');

        it('renders the placeholder from the INBOX branch only', () => {
            const calls = body.match(/renderInboxPlaceholder\(\s*\)/g) || [];
            expect(calls.length).toBe(1);
            // The single call must live inside the `safe === 'inbox'` branch,
            // which sits before the `safe === 'calendar'` branch — never in
            // the calendar path.
            const callIdx     = body.indexOf('renderInboxPlaceholder(');
            const inboxIdx    = body.lastIndexOf("safe === 'inbox'");
            const calendarIdx = body.indexOf("safe === 'calendar'", inboxIdx);
            expect(inboxIdx).toBeGreaterThan(-1);
            expect(calendarIdx).toBeGreaterThan(-1);
            expect(callIdx).toBeGreaterThan(inboxIdx);
            expect(callIdx).toBeLessThan(calendarIdx);
        });

        it('still flips #mainBar data-view so switching to PROJECTS hides the Inbox surface', () => {
            // Switching away sets data-view to the new view; #inboxView is
            // display:none unless data-view="inbox" (CSS test below), so the
            // placeholder is cleared from view on the way to PROJECTS.
            expect(body).toMatch(/setAttribute\(\s*['"]data-view['"]\s*,\s*safe\s*\)/);
        });
    });

    describe('firstFocusableInActiveMainView (main.js)', () => {
        const body = extractFn('firstFocusableInActiveMainView');

        it('returns null for the INBOX view — the placeholder has no focusable content', () => {
            expect(body).toMatch(/view\s*===\s*['"]inbox['"][\s\S]{0,400}return null/);
        });
    });

    describe('CSS (style.css)', () => {
        it('centers .inboxPlaceholder with muted ~14px text and no inline JS styling', () => {
            const idx = css.indexOf('.inboxPlaceholder {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/margin:\s*auto/);
            expect(rule).toMatch(/text-align:\s*center/);
            expect(rule).toMatch(/font-size:\s*14px/);
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
