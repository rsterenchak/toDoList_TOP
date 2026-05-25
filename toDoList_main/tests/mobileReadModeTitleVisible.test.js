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
// `data-mobile-edit` attribute set only by the second-tap focus path.

describe('mobile read-mode keeps the title span visible', () => {

    const toDoRow = read('toDoRow.js');

    it('committed-row activation sets data-mobile-edit before focusing the input', () => {
        // Order matters: on phones the input is opacity:0 / pointer-
        // events:none until the attribute flips the CSS swap. A focus()
        // call without the attribute being set first is a no-op.
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        expect(fnIdx).toBeGreaterThan(-1);
        const fn = toDoRow.slice(fnIdx, fnIdx + 4000);
        const attrIdx = fn.indexOf("setAttribute('data-mobile-edit', 'true')");
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

    it('attribute set is gated on the mobile breakpoint check', () => {
        // data-mobile-edit is a phone concept (the CSS rules live in the
        // ≤420px block). Gating on isMobile keeps the attribute off
        // desktop rows where it would be inert anyway.
        const fnIdx = toDoRow.indexOf('function wireToDoRowClick(');
        const fn = toDoRow.slice(fnIdx, fnIdx + 4000);
        expect(fn).toMatch(
            /if\s*\(\s*isMobile\s*\)\s*toDoChild\.setAttribute\(\s*['"]data-mobile-edit['"]\s*,\s*['"]true['"]\s*\)/
        );
    });

    it('toDoInput blur handler clears data-mobile-edit', () => {
        // Without this, the row would stay in edit mode after the user
        // taps away — the input would remain visible and the span
        // hidden, defeating the whole point of the swap.
        const blurIdx = toDoRow.indexOf('toDoInput.addEventListener("blur"');
        expect(blurIdx).toBeGreaterThan(-1);
        const block = toDoRow.slice(blurIdx, blurIdx + 1200);
        expect(block).toMatch(
            /removeAttribute\(\s*['"]data-mobile-edit['"]\s*\)/
        );
    });

    it('description close also clears data-mobile-edit defensively', () => {
        // Closing the description panel should fully collapse the row
        // back to single-line, regardless of whether the title was in
        // edit mode. This covers the path where the user closes the
        // description without first blurring the input. The cleanup now
        // lives in the row's __closeDesc helper, so the data-mobile-read
        // removal and the data-mobile-edit removal must sit together
        // inside that close function body — scoped to
        // wireDescriptionPanel so we don't accidentally match the
        // statsToggle modal's `close()` further down the file.
        const wireIdx = toDoRow.indexOf('function wireDescriptionPanel(');
        expect(wireIdx).toBeGreaterThan(-1);
        const wireBody = toDoRow.slice(wireIdx, wireIdx + 4000);
        const closeIdx = wireBody.indexOf('function close()');
        expect(closeIdx).toBeGreaterThan(-1);
        const closeBody = wireBody.slice(closeIdx, closeIdx + 1200);
        expect(closeBody).toMatch(
            /removeAttribute\(\s*['"]data-mobile-read['"]\s*\)/
        );
        expect(closeBody).toMatch(
            /removeAttribute\(\s*['"]data-mobile-edit['"]\s*\)/
        );
    });
});


describe('mobile read-mode CSS no longer hides the title on :focus-within', () => {

    const css = read('style.css');

    it('the buggy focus-within hide rule is gone', () => {
        // Root cause of the original bug: when the description toggle
        // was inside #toDoChild, the synthetic open click landed focus
        // on the toggle button, which made :focus-within match and hid
        // the span — leaving an empty title band even though the row
        // was visually marked active.
        expect(css).not.toMatch(
            /#toDoChild:not\(\[data-original-blank="true"\]\):focus-within\s+\.toDoTitleDisplay/
        );
    });

    it('the companion :focus rule on the input is gone', () => {
        // The pseudo-class-keyed input un-hide is replaced by the
        // attribute-keyed rule on #toDoChild[data-mobile-edit="true"].
        expect(css).not.toMatch(
            /#toDoChild:not\(\[data-original-blank="true"\]\)\s+#toDoInput:focus\s*\{/
        );
    });

    it('the new attribute-keyed swap rules live inside the ≤420px media block', () => {
        // Scope must stay phone-only — at 421–700px tablet the span is
        // hidden by the default cascade and the input is the visible
        // title slot, so the data-mobile-edit attribute being set on
        // tablet rows is harmless but the swap rule must not leak.
        const phoneIdx = css.indexOf('@media (max-width: 420px)');
        expect(phoneIdx).toBeGreaterThan(-1);
        const phoneBlock = css.slice(phoneIdx);
        expect(phoneBlock).toMatch(
            /#toDoChild\[data-mobile-edit="true"\]:not\(\[data-original-blank="true"\]\)\s+\.toDoTitleDisplay/
        );
        expect(phoneBlock).toMatch(
            /#toDoChild\[data-mobile-edit="true"\]:not\(\[data-original-blank="true"\]\)\s+#toDoInput/
        );
    });
});
