import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Regression pin for: "Fix mobile title vanishing on first tap of
// read-mode row". The original bug came from keying the title-display
// vs. title-input swap on `:focus-within`, which spuriously matched
// whenever the first-tap synthetic descToggle.click() handed focus to
// the toggle button — collapsing the visible title behind an empty
// band on Android Chrome (and any other engine that focuses synthetic
// button clicks). The fix replaces `:focus-within` with an explicit
// `data-title-edit` attribute set by the second-tap focus path. The same
// attribute now drives the desktop queue-rail title swap, so it is set at
// every width rather than gated on the mobile breakpoint.

describe('mobile read-mode keeps the title span visible', () => {

    const toDoRow = read('toDoRow.js');

    it('committed-row activation sets data-title-edit before focusing the input', () => {
        // Order matters: the input is opacity:0 / pointer-events:none until
        // the attribute flips the CSS swap (on phones AND in the desktop
        // rail). A focus() call without the attribute set first is a no-op.
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = toDoRow.slice(fnIdx, fnIdx + 4000);
        const attrIdx = fn.indexOf("setAttribute('data-title-edit', 'true')");
        expect(attrIdx).toBeGreaterThan(-1);
        // The relevant focus() is the committed-row activation focus that
        // immediately follows the attribute set — not the blank-row early
        // focus at the top of the function (which is unrelated). Search
        // for the next focus() AFTER the attribute set.
        const focusIdx = fn.indexOf('toDoInput.focus()', attrIdx);
        expect(focusIdx).toBeGreaterThan(-1);
        // The attribute set must come before the focus() call so the
        // CSS swap has happened by the time focus lands.
        expect(attrIdx).toBeLessThan(focusIdx);
    });

    it('attribute set fires at every width, not gated on the mobile breakpoint', () => {
        // data-title-edit now drives the desktop queue-rail title swap as
        // well as the phone read/edit swap, so the set must NOT be wrapped in
        // an `if (isMobile)` guard — a lingering gate would leave desktop rail
        // rows clipping their titles in the input as before.
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        const fn = toDoRow.slice(fnIdx, fnIdx + 4000);
        expect(fn).toMatch(
            /toDoChild\.setAttribute\(\s*['"]data-title-edit['"]\s*,\s*['"]true['"]\s*\)/
        );
        expect(fn).not.toMatch(
            /if\s*\(\s*isMobile\s*\)\s*toDoChild\.setAttribute\(\s*['"]data-title-edit['"]/
        );
    });

    it('toDoInput blur handler clears data-title-edit', () => {
        // Without this, the row would stay in edit mode after the user
        // taps away — the input would remain visible and the span
        // hidden, defeating the whole point of the swap.
        const blurIdx = toDoRow.indexOf('toDoInput.addEventListener("blur"');
        expect(blurIdx).toBeGreaterThan(-1);
        const block = toDoRow.slice(blurIdx, blurIdx + 1200);
        expect(block).toMatch(
            /removeAttribute\(\s*['"]data-title-edit['"]\s*\)/
        );
    });

    it('descToggle close handler also clears data-title-edit defensively', () => {
        // Closing the description panel should fully collapse the row
        // back to single-line, regardless of whether the title was in
        // edit mode. This covers the path where the user closes the
        // description without first blurring the input.
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        const fn = toDoRow.slice(fnIdx);
        // Locate the descToggle close handler by anchoring on the
        // existing data-mobile-read removal — the data-title-edit
        // removal must live in the same handler body, so a window of
        // characters around that anchor is enough to assert co-location.
        const readRemovalIdx = fn.indexOf("removeAttribute('data-mobile-read')");
        expect(readRemovalIdx).toBeGreaterThan(-1);
        const window = fn.slice(Math.max(0, readRemovalIdx - 300), readRemovalIdx + 600);
        expect(window).toMatch(
            /descToggle\.addEventListener\(\s*['"]click['"]/
        );
        expect(window).toMatch(
            /removeAttribute\(\s*['"]data-title-edit['"]\s*\)/
        );
    });
});


describe('mobile read-mode CSS no longer hides the title on :focus-within', () => {

    const css = read('style.css');

    it('the buggy focus-within hide rule is gone', () => {
        // Root cause of the original bug. The synthetic descToggle.click()
        // in the first-tap path landed focus on the toggle button, which
        // (being inside #toDoChild) made :focus-within match and hid the
        // span — leaving an empty title band even though the row was
        // visually marked active.
        expect(css).not.toMatch(
            /#toDoChild:not\(\[data-original-blank="true"\]\):focus-within\s+\.toDoTitleDisplay/
        );
    });

    it('the companion :focus rule on the input is gone', () => {
        // The pseudo-class-keyed input un-hide is replaced by the
        // attribute-keyed rule on #toDoChild[data-title-edit="true"].
        expect(css).not.toMatch(
            /#toDoChild:not\(\[data-original-blank="true"\]\)\s+#toDoInput:focus\s*\{/
        );
    });

    it('the phone attribute-keyed swap rules live inside the ≤420px media block', () => {
        // The phone half of the swap stays scoped to the ≤420px block (the
        // desktop half lives in its own ≥1024px block). At 421–1023px the
        // span is hidden by the default cascade and the input is the visible
        // title slot, so the data-title-edit attribute is inert there.
        const phoneIdx = css.indexOf('@media (max-width: 420px)');
        expect(phoneIdx).toBeGreaterThan(-1);
        const phoneBlock = css.slice(phoneIdx);
        expect(phoneBlock).toMatch(
            /#toDoChild\[data-title-edit="true"\]:not\(\[data-original-blank="true"\]\)\s+\.toDoTitleDisplay/
        );
        expect(phoneBlock).toMatch(
            /#toDoChild\[data-title-edit="true"\]:not\(\[data-original-blank="true"\]\)\s+#toDoInput/
        );
    });
});
