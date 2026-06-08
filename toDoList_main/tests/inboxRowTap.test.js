import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the "tap an Inbox row to open the existing description editor" feature.
// The Inbox row becomes a compact one-line card (title on one line, status
// pill + project name on a meta row below, decorative chevron on the right)
// whose whole-row tap opens the EXISTING showDescEditorModal — the same modal
// the project-page row tap uses. That modal has no completion wiring, so no
// dismiss path can mark an idea complete. CRITICAL non-regression: this entry
// must NOT touch buildToDoRow / the shared project-page render path.
//
// main.js cannot be imported at runtime (boot-time side effects), so these
// assertions are source-pattern checks against the extracted function body —
// the established idiom for main.js view tests (see inboxIdeasView.test.js).
describe('Inbox row tap-to-open description editor', () => {
    const main = read('main.js');
    const css = read('style.css');

    // Extract a top-level `function <name>(...) { ... }` body by brace
    // matching, matching the approach the sibling inbox view tests use.
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

    const body = extractFn('buildInboxRow');

    describe('import wiring', () => {
        it('imports showDescEditorModal from modals.js', () => {
            expect(main).toMatch(
                /import\s*\{[\s\S]*?showDescEditorModal[\s\S]*?\}\s*from\s*['"]\.\/modals\.js['"]/
            );
        });
    });

    describe('compact one-line card structure (regression 1)', () => {
        it('renders the title element and a chevron child', () => {
            expect(body).toMatch(/inboxRowTitle/);
            expect(body).toMatch(/textContent\s*=\s*item\.tit/);
            expect(body).toMatch(/inboxRowChev/);
            expect(body).toMatch(/textContent\s*=\s*['"]›['"]/);
        });

        it('keeps the status pill + project name on the meta row', () => {
            expect(body).toMatch(/buildStatusLabel\(\s*item\s*\)/);
            expect(body).toMatch(/inboxRowProject/);
        });

        it('truncates the title to a single line via CSS', () => {
            const idx = css.indexOf('.inboxRowTitle {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/white-space:\s*nowrap/);
            expect(rule).toMatch(/overflow:\s*hidden/);
            expect(rule).toMatch(/text-overflow:\s*ellipsis/);
        });

        it('styles the chevron as a flex-shrink-0 muted glyph', () => {
            const idx = css.indexOf('.inboxRowChev {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/flex:\s*0 0 auto/);
            expect(rule).toMatch(/color:\s*var\(--text-muted\)/);
        });

        it('makes the inbox row tappable (cursor pointer)', () => {
            const idx = css.indexOf('.inboxRow {');
            expect(idx).toBeGreaterThan(-1);
            const rule = css.slice(idx, css.indexOf('}', idx));
            expect(rule).toMatch(/cursor:\s*pointer/);
        });
    });

    describe('whole-row tap opens the existing modal (regression 2)', () => {
        it('calls showDescEditorModal with the item and the project/onSave/onTitleSave option shape', () => {
            expect(body).toMatch(
                /showDescEditorModal\(\s*item\s*,\s*\{[\s\S]*?projectName[\s\S]*?onSave[\s\S]*?onTitleSave[\s\S]*?\}\s*\)/
            );
        });

        it('wires a click listener on the row', () => {
            expect(body).toMatch(/addEventListener\(\s*['"]click['"]/);
        });
    });

    describe('tap targets that must NOT open the modal (regressions 3 & 4)', () => {
        it('bails on the status-label chip so its popover wins', () => {
            expect(body).toMatch(/closest\(\s*['"]\.todoStatusLabel['"]\s*\)/);
        });

        it('bails on the non-interactive check glyph', () => {
            expect(body).toMatch(/closest\(\s*['"]\.inboxRowCheck['"]\s*\)/);
        });
    });

    describe('chevron is decorative (regression 5)', () => {
        it('marks the chevron aria-hidden and gives it no own handler', () => {
            // The chevron span is created and appended but never gets its own
            // addEventListener — clicks fall through to the row handler.
            const chevIdx = body.indexOf('inboxRowChev');
            expect(chevIdx).toBeGreaterThan(-1);
            expect(body).toMatch(/chev\.setAttribute\(\s*['"]aria-hidden['"]/);
            expect(body).not.toMatch(/chev\.addEventListener/);
        });
    });

    describe('save callbacks refresh the inbox (regression 6)', () => {
        it('routes the persist through listLogic.editToDoItem and re-renders', () => {
            expect(body).toMatch(/listLogic\.editToDoItem\(\s*projectName\s*,\s*item\s*\)/);
            // Both onSave and onTitleSave call renderInbox().
            const renders = body.match(/renderInbox\(\s*\)/g) || [];
            expect(renders.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('completion non-regression (regression 7)', () => {
        it('never calls setToDoCompleted from the inbox row', () => {
            expect(body).not.toMatch(/setToDoCompleted/);
        });
    });

    describe('shared render-path isolation (regression 9)', () => {
        it('does not reference buildToDoRow from the inbox row builder', () => {
            expect(body).not.toMatch(/buildToDoRow/);
        });

        it('leaves the shared project-page row builder defined and intact in toDoRow.js', () => {
            const toDoRow = read('toDoRow.js');
            expect(toDoRow).toMatch(/function\s+buildToDoRow\b/);
        });
    });

    describe('accessibility (regression 10)', () => {
        it('exposes the row as a focusable button with an aria-label', () => {
            expect(body).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]button['"]\s*\)/);
            expect(body).toMatch(/setAttribute\(\s*['"]tabindex['"]\s*,\s*['"]0['"]\s*\)/);
            expect(body).toMatch(/setAttribute\(\s*['"]aria-label['"]/);
        });

        it('activates the tap on Enter and Space via a keydown listener', () => {
            expect(body).toMatch(/addEventListener\(\s*['"]keydown['"]/);
            expect(body).toMatch(/['"]Enter['"]/);
            expect(body).toMatch(/['"] ['"]|['"]Spacebar['"]/);
        });

        it('gives the focused row a focus-visible outline', () => {
            expect(css).toMatch(/\.inboxRow:focus-visible\s*\{[\s\S]*?outline:/);
        });
    });
});
