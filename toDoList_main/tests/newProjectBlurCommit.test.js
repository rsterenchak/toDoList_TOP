import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Locks in the fix for the half-created new-project bug. When the user clicks
// the "+" button to add a project, types a name into the inline input, and
// then clicks away (instead of pressing Enter), the project should commit as
// if Enter were pressed. If the field is empty on blur the in-progress row
// should be discarded silently. The pre-existing bug left the row stranded:
// visible but never wired up via listLogic.addProject(), so clicking it back
// did nothing and the user could not recover without refreshing.
describe('new project commits or discards on blur', () => {
    const js = read('main.js');

    // Isolate the projButton click handler that creates the new-project row.
    // All assertions below run against this slice so they cannot false-match
    // against unrelated blur listeners elsewhere in main.js.
    function extractAddProjectClickHandler() {
        const marker = '// Click Listener: That adds new project element';
        const markerIdx = js.indexOf(marker);
        expect(markerIdx).toBeGreaterThan(-1);
        const handlerStart = js.indexOf('addEventListener("click"', markerIdx);
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
        throw new Error('unterminated projButton click handler');
    }

    const rawBody = extractAddProjectClickHandler();
    const body = rawBody
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, '');

    // Pull out the body of the blur listener registered on titleInput within
    // this click handler. Returns the text between the listener's outer
    // braces so individual assertions can scan only that block.
    function extractTitleInputBlurBody() {
        const re = /titleInput\.addEventListener\(\s*["']blur["']\s*,\s*function\s*\([^)]*\)\s*\{/g;
        const match = re.exec(body);
        if (!match) return null;
        const bodyStart = match.index + match[0].length - 1;
        let depth = 0;
        for (let i = bodyStart; i < body.length; i++) {
            const c = body[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) return body.slice(bodyStart + 1, i);
            }
        }
        throw new Error('unterminated titleInput blur listener');
    }

    it('registers a blur listener on the new-project titleInput', () => {
        const blurBody = extractTitleInputBlurBody();
        expect(blurBody).not.toBeNull();
    });

    it('removes the in-progress projChild from the DOM when blurred with an empty value', () => {
        const blurBody = extractTitleInputBlurBody();
        expect(blurBody).not.toBeNull();
        // Blur handler must reference both the empty-value check and the
        // DOM removal of the abandoned projChild row.
        expect(blurBody).toMatch(/projChild/);
        expect(blurBody).toMatch(/removeChild\(\s*projChild\s*\)|projChild\.remove\(\s*\)/);
    });

    it('restores the add-project button so the user can try again after a discard', () => {
        const blurBody = extractTitleInputBlurBody();
        expect(blurBody).not.toBeNull();
        // pointer-events must be re-enabled on projButton, otherwise the
        // sidebar "+" stays dead after an empty-name blur.
        expect(blurBody).toMatch(/projButton\.style\.pointerEvents\s*=\s*["']auto["']/);
    });

    it('commits the project on blur when the input has a non-empty value', () => {
        const blurBody = extractTitleInputBlurBody();
        expect(blurBody).not.toBeNull();
        // Commit path can either call listLogic.addProject directly or
        // re-dispatch the Enter keydown so the existing handler runs.
        const dispatchesEnter = /dispatchEvent\(\s*new KeyboardEvent\(\s*['"]keydown['"]\s*,\s*\{[^}]*key:\s*['"]Enter['"]/.test(blurBody);
        const callsAddProject = /listLogic\.addProject\(/.test(blurBody);
        expect(dispatchesEnter || callsAddProject).toBe(true);
    });

    it('guards against double-commit when Enter was the trigger for the blur', () => {
        const blurBody = extractTitleInputBlurBody();
        expect(blurBody).not.toBeNull();
        // The Enter keydown handler calls titleInput.blur() to lock the row,
        // which would re-enter the new commit path without a guard. The
        // handler must therefore consult some flag (e.g. committingViaEnter)
        // before attempting to commit again.
        const earlyReturn = /if\s*\([^)]*(committ|enter|skip|handled)[^)]*\)\s*\{[^}]*return/i.test(blurBody);
        expect(earlyReturn).toBe(true);
    });
});
