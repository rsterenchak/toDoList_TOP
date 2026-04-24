import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for the mobile no-projects empty-state button.
// Bug: tapping "Create your first project" on a mobile viewport created
// the new project input inside a sidebar that was still translated
// off-screen, so the user saw nothing happen and iOS Safari suppressed
// the soft keyboard. Fix opens the sidebar synchronously in the same
// user-gesture tick as the .focus() call.
describe('empty-state "Create your first project" button opens sidebar on mobile', () => {
    const js = read('main.js');

    // Isolate the click handler attached to #emptyStateCreateBtn so the
    // assertions below don't false-positive against unrelated code in main.js.
    function extractCreateBtnClickHandler() {
        const marker = "createBtn.id = 'emptyStateCreateBtn'";
        const markerIdx = js.indexOf(marker);
        expect(markerIdx).toBeGreaterThan(-1);
        const handlerStart = js.indexOf("addEventListener('click'", markerIdx);
        expect(handlerStart).toBeGreaterThan(-1);
        const bodyStart = js.indexOf('{', handlerStart);
        let depth = 0;
        for (let i = bodyStart; i < js.length; i++) {
            const c = js[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return js.slice(bodyStart, i + 1);
            }
        }
        throw new Error('unterminated empty-state create-btn click handler');
    }

    const rawBody = extractCreateBtnClickHandler();
    // Strip line and block comments so position-based assertions below don't
    // false-match against text inside explanatory comments in the handler.
    const body = rawBody
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');

    it('opens the mobile sidebar by adding the sidebar-open class', () => {
        expect(body).toMatch(/classList\.add\(\s*['"]sidebar-open['"]\s*\)/);
    });

    it('creates the new project by clicking #projButton', () => {
        expect(body).toMatch(/getElementById\(\s*['"]projButton['"]\s*\)/);
        expect(body).toMatch(/\.click\(\s*\)/);
    });

    it('focuses the newly appended project input', () => {
        expect(body).toMatch(/\.focus\(\s*\)/);
    });

    it('opens the sidebar before calling focus so iOS keeps the soft keyboard', () => {
        const openIdx = body.indexOf('sidebar-open');
        const focusIdx = body.indexOf('.focus(');
        expect(openIdx).toBeGreaterThan(-1);
        expect(focusIdx).toBeGreaterThan(-1);
        expect(openIdx).toBeLessThan(focusIdx);
    });
});
