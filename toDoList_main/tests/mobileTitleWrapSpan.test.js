import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the sibling-span title rendering used at ≤420px so long titles can
// wrap into multi-line text when a row is active. The previous CSS-only
// attempt unclamped #toDoInput, which has no visual effect because an
// <input type="text"> is single-line by HTML spec. The fix introduces a
// <span id="toDoTitleDisplay"> that takes over the visible title slot on
// phones and swaps back to the input on focus for editing.

describe('Mobile tap-to-expand uses a wrappable span for the title', () => {

    const toDoRow = read('toDoRow.js');

    it('buildToDoRow creates a toDoTitleDisplay span element', () => {
        expect(toDoRow).toMatch(/toDoTitleDisplay\.id\s*=\s*["']toDoTitleDisplay["']/);
        expect(toDoRow).toMatch(/toDoTitleDisplay\.className\s*=\s*["']toDoTitleDisplay["']/);
    });

    it('the span is appended to the row immediately before #toDoInput', () => {
        // Per the task: "placed immediately before #toDoInput in
        // buildToDoRow". DOM order matters for the visual title slot —
        // the span needs to occupy the same flex column the input did.
        const fnIdx = toDoRow.indexOf('export function buildToDoRow');
        const fn = toDoRow.slice(fnIdx);
        const spanIdx = fn.indexOf('toDoChild.appendChild(toDoTitleDisplay)');
        const inputIdx = fn.indexOf('toDoChild.appendChild(toDoInput)');
        expect(spanIdx).toBeGreaterThan(-1);
        expect(inputIdx).toBeGreaterThan(-1);
        expect(spanIdx).toBeLessThan(inputIdx);
    });

    it('the span seeds its textContent from item.tit on construction', () => {
        expect(toDoRow).toMatch(/toDoTitleDisplay\.textContent\s*=\s*item\.tit\s*\|\|\s*["']["']/);
    });

    it('blank placeholder rows hide the span via inline display:none', () => {
        // The input's "Add a task — press Enter" placeholder is the
        // affordance on a blank row; the span would otherwise paint as
        // an empty element competing with the input for the visual slot.
        expect(toDoRow).toMatch(
            /if\s*\(\s*!item\.tit\s*\)\s*toDoTitleDisplay\.style\.display\s*=\s*["']none["']/
        );
    });
});


describe('span textContent stays in sync with item.tit', () => {

    const toDoRow = read('toDoRow.js');

    // Each of these four write sites mutates item.tit and so must also
    // update the span so the visible title doesn't drift from the model.
    // The acceptance criteria call this out explicitly: "Typing in the
    // input updates the displayed title on blur."

    it('Enter-commit handler updates toDoTitleDisplay.textContent', () => {
        const commitIdx = toDoRow.indexOf('toDoInput keydown — Enter to commit title');
        expect(commitIdx).toBeGreaterThan(-1);
        const block = toDoRow.slice(commitIdx, commitIdx + 2500);
        expect(block).toMatch(/toDoTitleDisplay\.textContent\s*=\s*val/);
    });

    it('Enter-commit handler clears the inline display:none on first commit', () => {
        // The blank-row hide is set inline at construction; without
        // explicitly clearing it, a row that started as a placeholder
        // would never surface its span on mobile after commit.
        const commitIdx = toDoRow.indexOf('toDoInput keydown — Enter to commit title');
        const block = toDoRow.slice(commitIdx, commitIdx + 2500);
        expect(block).toMatch(/toDoTitleDisplay\.style\.display\s*=\s*["']["']/);
    });

    it('keyup persistence handler updates the span when val is non-empty', () => {
        const keyupIdx = toDoRow.indexOf('toDoInput keyup');
        expect(keyupIdx).toBeGreaterThan(-1);
        const block = toDoRow.slice(keyupIdx, keyupIdx + 1500);
        expect(block).toMatch(/toDoTitleDisplay\.textContent\s*=\s*val/);
    });

    it('blur snap-back path updates the span to item.tit', () => {
        const blurIdx = toDoRow.indexOf('toDoInput.addEventListener("blur"');
        expect(blurIdx).toBeGreaterThan(-1);
        const block = toDoRow.slice(blurIdx, blurIdx + 800);
        expect(block).toMatch(/toDoTitleDisplay\.textContent\s*=\s*item\.tit/);
    });

    it('Escape revert handler updates the span to savedTitle', () => {
        // The Escape branch lives in a second keydown listener on
        // toDoInput further down in the function. Grep for the savedTitle
        // restoration block and assert the span is restored alongside.
        const escIdx = toDoRow.indexOf('Escape on the title cancels');
        expect(escIdx).toBeGreaterThan(-1);
        const block = toDoRow.slice(escIdx, escIdx + 1200);
        expect(block).toMatch(/toDoTitleDisplay\.textContent\s*=\s*savedTitle/);
    });
});


describe('CSS surfaces the span on phones and hides it elsewhere', () => {

    const css = read('style.css');

    it('the span is hidden by default at the top-level cascade', () => {
        // Default display:none keeps desktop and 421–700px tablet
        // rendering unchanged — the input remains the visible title slot
        // at those breakpoints. The ≤420px media block flips it on.
        expect(css).toMatch(/\.toDoTitleDisplay\s*\{[\s\S]{0,80}display:\s*none/);
    });

    it('phone media block (≤420px) shows the span on committed rows', () => {
        const phoneIdx = css.indexOf('@media (max-width: 420px)');
        expect(phoneIdx).toBeGreaterThan(-1);
        const phoneBlock = css.slice(phoneIdx);
        expect(phoneBlock).toMatch(
            /#toDoChild:not\(\[data-original-blank="true"\]\)\s+\.toDoTitleDisplay\s*\{[\s\S]{0,400}display:\s*block/
        );
    });

    it('collapsed phone span has the single-line ellipsis treatment', () => {
        // Acceptance criterion: "A 60-character title in a collapsed
        // mobile row truncates with an ellipsis as today."
        const phoneIdx = css.indexOf('@media (max-width: 420px)');
        const phoneBlock = css.slice(phoneIdx);
        const spanRule = phoneBlock.match(
            /#toDoChild:not\(\[data-original-blank="true"\]\)\s+\.toDoTitleDisplay\s*\{([\s\S]{0,500}?)\}/
        );
        expect(spanRule).toBeTruthy();
        const body = spanRule[1];
        expect(body).toMatch(/overflow:\s*hidden/);
        expect(body).toMatch(/text-overflow:\s*ellipsis/);
        expect(body).toMatch(/white-space:\s*nowrap/);
    });

    it('active mobile-read row unclamps the span so titles wrap multi-line', () => {
        // The four properties together (white-space:normal, overflow:visible,
        // text-overflow:clip, line-height:1.4) are what take the span from
        // single-line ellipsis to wrapped paragraph rendering.
        const phoneIdx = css.indexOf('@media (max-width: 420px)');
        const phoneBlock = css.slice(phoneIdx);
        const activeRule = phoneBlock.match(
            /#toDoChild\[data-mobile-read="true"\][^{]*\.toDoTitleDisplay\s*\{([\s\S]{0,400}?)\}/
        );
        expect(activeRule).toBeTruthy();
        const body = activeRule[1];
        expect(body).toMatch(/white-space:\s*normal/);
        expect(body).toMatch(/overflow:\s*visible/);
        expect(body).toMatch(/text-overflow:\s*clip/);
        expect(body).toMatch(/line-height:\s*1\.4/);
    });

    it('phone input is opacity-hidden and pulled out of normal flow on committed rows', () => {
        // Hide-via-opacity keeps the input in the layout flow so the
        // existing focus management (focus(), setSelectionRange, blur
        // listeners) still works. Position:absolute lifts it off the
        // span so clicks fall through to the row click handler.
        const phoneIdx = css.indexOf('@media (max-width: 420px)');
        const phoneBlock = css.slice(phoneIdx);
        const inputRule = phoneBlock.match(
            /#toDoChild:not\(\[data-original-blank="true"\]\)\s+#toDoInput\s*\{([\s\S]{0,400}?)\}/
        );
        expect(inputRule).toBeTruthy();
        const body = inputRule[1];
        expect(body).toMatch(/opacity:\s*0/);
        expect(body).toMatch(/position:\s*absolute/);
        expect(body).toMatch(/pointer-events:\s*none/);
    });

    it('phone input becomes visible again on focus, kicking the span out', () => {
        // Second tap on the active row → toDoInput.focus() — at that
        // moment the span hides and the input takes over the visual slot
        // for editing.
        const phoneIdx = css.indexOf('@media (max-width: 420px)');
        const phoneBlock = css.slice(phoneIdx);
        const focusRule = phoneBlock.match(
            /#toDoChild:not\(\[data-original-blank="true"\]\)\s+#toDoInput:focus\s*\{([\s\S]{0,400}?)\}/
        );
        expect(focusRule).toBeTruthy();
        const body = focusRule[1];
        expect(body).toMatch(/opacity:\s*1/);
        expect(body).toMatch(/position:\s*static/);
        expect(body).toMatch(/pointer-events:\s*auto/);
        // Sibling cascade hides the span when the row contains focus.
        expect(phoneBlock).toMatch(
            /#toDoChild:not\(\[data-original-blank="true"\]\):focus-within\s+\.toDoTitleDisplay\s*\{[\s\S]{0,120}display:\s*none/
        );
    });

    it('the global ≤420px ellipsis rule on #toDoInput is preserved', () => {
        // Per the task: "leave it in place (it's still the source of
        // truth for desktop column widths between 421–700px)". Even
        // though the input is opacity-hidden on phones, the rule must
        // stay so the tablet range (421–700px) renders the input with
        // the existing ellipsis chrome.
        const phoneIdx = css.indexOf('@media (max-width: 420px)');
        const phoneBlock = css.slice(phoneIdx);
        expect(phoneBlock).toMatch(
            /#toDoInput\s*\{[\s\S]{0,200}text-overflow:\s*ellipsis[\s\S]{0,200}white-space:\s*nowrap/
        );
    });
});
