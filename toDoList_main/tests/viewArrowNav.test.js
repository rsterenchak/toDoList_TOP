import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for keyboard navigation gating on the Projects view.
// The legacy todo arrow-nav handler and the cross-pane ArrowLeft/ArrowRight
// shortcut both branch off #mainBar's data-view attribute and must bail
// when the active view is not 'projects', so other views (e.g. Conceive)
// keep native caret movement instead of having focus yanked into the
// hidden #mainList.
describe('view-aware arrow-key navigation — Projects gating', () => {
    const main = read('main.js');

    it('the existing Projects-view arrow-nav handler is gated to projects view', () => {
        // The legacy Up/Down/Enter/Delete handler that drives #toDoChild
        // navigation must bail when view !== 'projects'; otherwise it would
        // grab focus on a non-Projects view and yank it back to a stale
        // .todo-active row in the hidden #mainList.
        const re = /document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function\s*\([^)]*\)\s*\{/g;
        let match;
        let found = false;
        while ((match = re.exec(main)) !== null) {
            const bodyStart = match.index + match[0].length - 1;
            let depth = 0;
            for (let i = bodyStart; i < main.length; i++) {
                const c = main[i];
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        const body = main.slice(bodyStart + 1, i);
                        if (/isArrowDown/.test(body) && /closeButtonToDo/.test(body)) {
                            expect(body).toMatch(/getActiveView\(\s*\)\s*!==\s*['"]projects['"]/);
                            found = true;
                        }
                        break;
                    }
                }
            }
        }
        if (!found) throw new Error('legacy todo arrow-nav handler not located');
    });

    it('the cross-pane ArrowLeft/ArrowRight handler is gated to projects view', () => {
        // ArrowLeft / ArrowRight outside the Projects view must fall through
        // to native caret movement, not the cross-pane focus shortcut that
        // moves focus to a project rail icon or the new-task input.
        const re = /document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function\s*\([^)]*\)\s*\{/g;
        let match;
        let found = false;
        while ((match = re.exec(main)) !== null) {
            const bodyStart = match.index + match[0].length - 1;
            let depth = 0;
            for (let i = bodyStart; i < main.length; i++) {
                const c = main[i];
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        const body = main.slice(bodyStart + 1, i);
                        if (/focusBlankToDoInput/.test(body) && /#projChild\.selectedProject/.test(body)) {
                            expect(body).toMatch(/getActiveView\(\s*\)\s*!==\s*['"]projects['"]/);
                            found = true;
                        }
                        break;
                    }
                }
            }
        }
        if (!found) throw new Error('cross-pane ArrowLeft/Right handler not located');
    });
});
