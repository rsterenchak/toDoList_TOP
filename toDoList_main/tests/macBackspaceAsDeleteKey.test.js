import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the fix for the Mac Delete key (which is actually Backspace) not
// removing the selected project or todo row. The same global keydown handler
// that owns ArrowUp/ArrowDown/Enter/Delete in main.js must treat Backspace as
// an alias for Delete — matches what a MacBook user gets when they press the
// key labeled "Delete" on their keyboard, which fires e.key === "Backspace"
// (the forward-delete key from a full-size keyboard doesn't exist on Mac
// laptops). The existing input/textarea/contenteditable guard stays in place
// so Backspace inside the rename input or a description textarea still just
// deletes a character. Sub-controls (checkbox, expand caret, close X, etc.)
// already wire their own Backspace-as-exit handler that bounces focus to the
// row; the global handler must not also fire delete from those bubbled
// events, so Backspace specifically requires e.target to be the row itself.
describe('Mac Backspace as Delete-key alias for project / todo deletion', () => {
    const main = read('main.js');

    function extractArrowNavHandler() {
        const re = /document\.addEventListener\(\s*['"]keydown['"]\s*,\s*function\s*\([^)]*\)\s*\{/g;
        let match;
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
                        if (/ArrowDown/.test(body) && /isDelete/.test(body)) return body;
                        break;
                    }
                }
            }
        }
        throw new Error('arrow-nav keydown handler not found in main.js');
    }

    it('isDelete accepts both "Delete" and "Backspace"', () => {
        const body = extractArrowNavHandler();
        // Mac laptops have no forward-delete key; the labeled "Delete" key
        // fires e.key === "Backspace". Both must route through the same
        // confirm-then-delete flow so the keyboard shortcut works on every
        // platform.
        expect(body).toMatch(/isDelete[\s\S]{0,80}e\.key\s*===\s*['"]Delete['"][\s\S]{0,40}\|\|[\s\S]{0,40}e\.key\s*===\s*['"]Backspace['"]/);
    });

    it('Backspace on a project-row sub-control does NOT trigger delete (must originate on the row itself)', () => {
        // Without this guard, Backspace on a hypothetical project-row sub-
        // control would bubble to the global handler and fire delete. The
        // existing isInputLike guard catches projInput; this catches any
        // other future child whose own Backspace handler bounces focus to
        // the row. The check is scoped to Backspace so the original Delete
        // key keeps working from any descendant.
        const body = extractArrowNavHandler();
        const projBranchIdx = body.search(/closest\(\s*['"]#projChild['"]\s*\)/);
        expect(projBranchIdx).toBeGreaterThan(-1);
        // Slice through deleteProjectFlow — that call marks the end of the
        // project-delete branch, so any guard the branch needs lives above it.
        const flowIdx = body.indexOf('deleteProjectFlow(', projBranchIdx);
        expect(flowIdx).toBeGreaterThan(-1);
        const projBranch = body.slice(projBranchIdx, flowIdx);
        expect(projBranch).toMatch(/e\.key\s*===\s*['"]Backspace['"]/);
        expect(projBranch).toMatch(/e\.target\s*!==/);
    });

    it('Backspace on a todo-row sub-control does NOT trigger delete (must originate on the row itself)', () => {
        // Sub-controls (checkbox, duePill, descToggle, statsToggle,
        // closeButtonToDo) each wire wireSubControlBackspaceExit which
        // bounces focus to the row on Backspace. Without this guard the
        // bubbled event would then hit the global delete branch and
        // confirm-then-delete the row — surprising the user who pressed
        // Backspace to exit a sub-control. Scoped to Backspace so the
        // original Delete key keeps deleting from any descendant.
        const body = extractArrowNavHandler();
        // The todo delete branch is the second `if (isDelete) {` block —
        // sliced from there through closeButtonToDo.click(), which marks
        // the end of the branch. Any guard the branch needs lives above
        // the click() call.
        const isDeleteRe = /if\s*\(\s*isDelete\s*\)\s*\{/g;
        let match;
        const matches = [];
        while ((match = isDeleteRe.exec(body)) !== null) matches.push(match.index);
        expect(matches.length).toBeGreaterThanOrEqual(2);
        const todoDeleteIdx = matches[matches.length - 1];
        const clickIdx = body.indexOf('closeBtn.click(', todoDeleteIdx);
        expect(clickIdx).toBeGreaterThan(-1);
        const todoBranch = body.slice(todoDeleteIdx, clickIdx);
        expect(todoBranch).toMatch(/e\.key\s*===\s*['"]Backspace['"]/);
        expect(todoBranch).toMatch(/e\.target\s*!==/);
    });

    it('the isInputLike bail-out still applies, so Backspace inside an input/textarea/contentEditable falls through to native character delete', () => {
        // Mirrors the existing guard the original Delete-key path uses; the
        // Backspace alias inherits the same protection because it routes
        // through the same `if (isInputLike) return` line above the delete
        // branches.
        const body = extractArrowNavHandler();
        expect(body).toMatch(/isInputLike/);
        // The non-arrow bail-out fires for Enter / Delete / Backspace alike.
        expect(body).toMatch(/if\s*\(\s*isInputLike\s*\)\s*return/);
    });

    it('the Ctrl+Backspace sidebar-toggle handler still bails out before reaching the delete path', () => {
        // The arrow-nav handler bails on any modifier key (ctrlKey, metaKey,
        // altKey). Without that guard, Ctrl+Backspace would both toggle the
        // sidebar AND delete the focused item.
        const body = extractArrowNavHandler();
        expect(body).toMatch(/ctrlKey/);
        expect(body).toMatch(/metaKey/);
        expect(body).toMatch(/altKey/);
    });
});
