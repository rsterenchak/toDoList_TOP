import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression pin for: "Desktop queue rail: task titles clip mid-word instead
// of ellipsizing". At the ~308px desktop queue rail an <input> (#toDoInput)
// clips its title at the content box with no ellipsis. The fix reuses the
// existing read/edit title swap — generalised off the `mobile` prefix to the
// width-neutral `data-title-edit` attribute — so an unfocused committed row
// shows the wrappable .toDoTitleDisplay span truncated to a single line with a
// trailing ellipsis, and focusing swaps to the real input for renaming.

describe('desktop queue rail title ellipsis (CSS)', () => {

    const css = read('style.css');

    // Slice out the desktop (>=1024px) media block that carries the rail
    // title swap. It follows the existing chat-collapse min-width:1024px
    // block, so match the block that actually names .toDoTitleDisplay.
    function desktopTitleBlock() {
        const re = /@media \(min-width: 1024px\) \{[\s\S]*?\n\}/g;
        let m;
        while ((m = re.exec(css)) !== null) {
            if (m[0].includes('.toDoTitleDisplay') && m[0].includes('#toDoInput')) {
                return m[0];
            }
        }
        return null;
    }

    it('a desktop media block styles the committed-row title span with single-line ellipsis', () => {
        const block = desktopTitleBlock();
        expect(block).toBeTruthy();
        const rule = block.match(
            /#toDoChild:not\(\[data-original-blank="true"\]\)\s+\.toDoTitleDisplay\s*\{([\s\S]{0,500}?)\}/
        );
        expect(rule).toBeTruthy();
        const body = rule[1];
        expect(body).toMatch(/white-space:\s*nowrap/);
        expect(body).toMatch(/overflow:\s*hidden/);
        expect(body).toMatch(/text-overflow:\s*ellipsis/);
        // min-width:0 is the easy-to-miss rule without which the span forces
        // its max-content width and pushes the trailing controls off the rail.
        expect(body).toMatch(/min-width:\s*0/);
        // Single line, NOT the phone two-line clamp — #toDoChild has a fixed
        // height and overflow:clip, so a second line would be cropped.
        expect(body).not.toMatch(/-webkit-line-clamp/);
    });

    it('the desktop rail hides the input by default and reveals it on data-title-edit', () => {
        const block = desktopTitleBlock();
        const defaultInput = block.match(
            /#toDoChild:not\(\[data-original-blank="true"\]\)\s+#toDoInput\s*\{([\s\S]{0,400}?)\}/
        );
        expect(defaultInput).toBeTruthy();
        expect(defaultInput[1]).toMatch(/opacity:\s*0/);
        expect(defaultInput[1]).toMatch(/position:\s*absolute/);
        expect(defaultInput[1]).toMatch(/pointer-events:\s*none/);

        const editInput = block.match(
            /#toDoChild\[data-title-edit="true"\]:not\(\[data-original-blank="true"\]\)\s+#toDoInput\s*\{([\s\S]{0,400}?)\}/
        );
        expect(editInput).toBeTruthy();
        expect(editInput[1]).toMatch(/opacity:\s*1/);
        expect(editInput[1]).toMatch(/position:\s*static/);
        expect(editInput[1]).toMatch(/pointer-events:\s*auto/);

        // The edit swap hides the display span so the input owns the slot.
        expect(block).toMatch(
            /#toDoChild\[data-title-edit="true"\]:not\(\[data-original-blank="true"\]\)\s+\.toDoTitleDisplay\s*\{[\s\S]{0,120}display:\s*none/
        );
    });

    it('the desktop rail keeps the default absolute input inert even when the row is todo-active', () => {
        // Without this override the base `.todo-active #toDoInput
        // { pointer-events: auto }` rule would make the invisible full-row
        // input swallow clicks meant for the checkbox and controls.
        const block = desktopTitleBlock();
        expect(block).toMatch(
            /#toDoChild\.todo-active:not\(\[data-original-blank="true"\]\)\s+#toDoInput\s*\{[\s\S]{0,120}pointer-events:\s*none/
        );
    });
});

describe('desktop rail title swap wiring (JS)', () => {

    const toDoRow = read('toDoRow.js');

    it('the edit attribute is set at all widths, not gated on isMobile', () => {
        // The swap now applies to the desktop rail too, so the attribute set
        // must fire on every width — a lingering `if (isMobile)` gate would
        // leave desktop rows clipping in the input as before.
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = toDoRow.slice(fnIdx, fnIdx + 4000);
        const attrIdx = fn.indexOf("setAttribute('data-title-edit', 'true')");
        expect(attrIdx).toBeGreaterThan(-1);
        // No `if (isMobile)` immediately guarding this specific set.
        expect(fn).not.toMatch(
            /if\s*\(\s*isMobile\s*\)\s*toDoChild\.setAttribute\(\s*['"]data-title-edit['"]/
        );
        // The attribute set precedes the activation focus() so the swap has
        // happened by the time focus lands (the input is opacity:0 until then).
        const focusIdx = fn.indexOf('toDoInput.focus()', attrIdx);
        expect(focusIdx).toBeGreaterThan(-1);
        expect(attrIdx).toBeLessThan(focusIdx);
    });

    it('the blur handler clears data-title-edit so the row returns to the display span', () => {
        const blurIdx = toDoRow.indexOf('toDoInput.addEventListener("blur"');
        expect(blurIdx).toBeGreaterThan(-1);
        const block = toDoRow.slice(blurIdx, blurIdx + 1200);
        expect(block).toMatch(/removeAttribute\(\s*['"]data-title-edit['"]\s*\)/);
    });

    it('the descToggle close handler also clears data-title-edit', () => {
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        const fn = toDoRow.slice(fnIdx);
        const readRemovalIdx = fn.indexOf("removeAttribute('data-mobile-read')");
        expect(readRemovalIdx).toBeGreaterThan(-1);
        const window = fn.slice(Math.max(0, readRemovalIdx - 300), readRemovalIdx + 600);
        expect(window).toMatch(/descToggle\.addEventListener\(\s*['"]click['"]/);
        expect(window).toMatch(/removeAttribute\(\s*['"]data-title-edit['"]\s*\)/);
    });
});
