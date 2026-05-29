import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the mobile-only bottom sheet that hosts the
// TODO.md viewer card when the user taps the inline viewer on the
// <=700px breakpoint. The inline card is cramped on touch — the sheet
// gives it a full-height surface and reuses the COMPLETED-sheet pattern
// (DOM move, four-affordance dismiss, mainListRendered refresh) so the
// touch wiring is shared rather than duplicated. Source-inspection
// because main.js is too large to instantiate end-to-end in jsdom (per
// CLAUDE.md).
describe('Mobile TODO.md viewer bottom sheet', () => {
    const main = read('main.js');
    const css  = read('style.css');

    it('attaches a click handler on the viewer card that opens the sheet on mobile only', () => {
        // The handler lives inside buildTodoMdViewerCard so the listener
        // is wired exactly once per card built (the card's click bubble
        // would otherwise multiplied across rebuilds).
        const buildIdx = main.indexOf('function buildTodoMdViewerCard(');
        expect(buildIdx).toBeGreaterThan(-1);
        // Walk to the next top-level function so the slice stays scoped
        // to this builder.
        const nextFnIdx = main.indexOf('\nfunction ', buildIdx + 1);
        const slice = main.slice(buildIdx, nextFnIdx > -1 ? nextFnIdx : buildIdx + 8000);
        // Card-level click handler that bails when not on mobile.
        expect(slice).toMatch(/card\.addEventListener\(\s*['"]click['"]/);
        expect(slice).toMatch(/isMobileViewport\(\s*\)/);
        // Skip clicks on internal interactive controls (button / tab /
        // anchor / input / label) so Sync / tabs / expand still work
        // without opening a redundant sheet.
        expect(slice).toMatch(/event\.target\.closest\(/);
        expect(slice).toMatch(/button/);
        // Open the sheet only when the card lives in #mainList (i.e.
        // not when it has already been moved into a sheet body).
        expect(slice).toMatch(/openViewerMobileSheet\(\s*card\s*\)/);
        expect(slice).toMatch(/mainListDiv\.contains\(\s*card\s*\)/);
    });

    it('declines to open when the COMPLETED sheet is already showing the viewer', () => {
        // The COMPLETED sheet moves the viewer card into its own body —
        // a second sheet on top of it would be redundant and would
        // strand the card in the wrong overlay. The click guard must
        // bail when completedMobileSheetState is open.
        const buildIdx = main.indexOf('function buildTodoMdViewerCard(');
        const nextFnIdx = main.indexOf('\nfunction ', buildIdx + 1);
        const slice = main.slice(buildIdx, nextFnIdx > -1 ? nextFnIdx : buildIdx + 8000);
        expect(slice).toMatch(/completedMobileSheetState[\s\S]{0,80}\.open/);
    });

    it('builds the sheet as a dialog with role + aria-modal + an aria label tying to its title', () => {
        const fnIdx = main.indexOf('function openViewerMobileSheet(');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 6000);
        expect(slice).toMatch(/setAttribute\(\s*['"]role['"]\s*,\s*['"]dialog['"]\s*\)/);
        expect(slice).toMatch(/setAttribute\(\s*['"]aria-modal['"]\s*,\s*['"]true['"]\s*\)/);
        expect(slice).toMatch(/setAttribute\(\s*['"]aria-labelledby['"]\s*,\s*['"]todoMdViewerMobileSheetTitle['"]\s*\)/);
    });

    it('moves the existing viewer card into the sheet body (DOM move, not clone)', () => {
        // Cloning would duplicate the card's event listeners (tabs,
        // Sync, expand) and lose closure state. Moving keeps them
        // attached so interactions inside the sheet still drive the
        // same code paths.
        const fnIdx = main.indexOf('function openViewerMobileSheet(');
        const slice = main.slice(fnIdx, fnIdx + 6000);
        expect(slice).toMatch(/body\.appendChild\(\s*card\s*\)/);
        expect(slice).not.toMatch(/card\.cloneNode/);
    });

    it('returns the moved viewer card to #mainList on close so the inline rendering owns it again', () => {
        const fnIdx = main.indexOf('function closeViewerMobileSheet(');
        expect(fnIdx).toBeGreaterThan(-1);
        const slice = main.slice(fnIdx, fnIdx + 3000);
        expect(slice).toMatch(/getElementById\(\s*['"]mainList['"]\s*\)/);
        // placeViewerCard restores the card to its anchor position
        // ahead of the projectsGhostSpacer.
        expect(slice).toMatch(/placeViewerCard\(/);
    });

    it('wires the four-affordance close vocabulary: X button, backdrop tap, Escape, and touch swipe-down', () => {
        const fnIdx = main.indexOf('function openViewerMobileSheet(');
        const slice = main.slice(fnIdx, fnIdx + 6000);
        expect(slice).toMatch(/closeX\.addEventListener\(\s*['"]click['"]\s*,\s*closeViewerMobileSheet\s*\)/);
        expect(slice).toMatch(/backdrop\.addEventListener\(\s*['"]click['"][\s\S]{0,200}event\.target\s*===\s*backdrop[\s\S]{0,200}closeViewerMobileSheet/);
        expect(slice).toMatch(/event\.key\s*!==\s*['"]Escape['"]/);
        expect(slice).toMatch(/addEventListener\(\s*['"]keydown['"]\s*,\s*onKeydown\s*,\s*true\s*\)/);
        // Touch swipe-down attached to handle AND header — must reuse
        // the shared attachCompletedSheetSwipeDown helper rather than
        // duplicating the touchstart / touchmove / touchend wiring.
        expect(slice).toMatch(/attachCompletedSheetSwipeDown\(\s*handle\s*,/);
        expect(slice).toMatch(/attachCompletedSheetSwipeDown\(\s*headerEl\s*,/);
    });

    it('refreshes its content on mainListRendered so rebuilds of the viewer stay live in the sheet', () => {
        const idx = main.indexOf("addEventListener('mainListRendered'");
        expect(idx).toBeGreaterThan(-1);
        let pos = idx;
        let found = false;
        while (pos !== -1) {
            const slice = main.slice(pos, Math.min(main.length, pos + 600));
            if (slice.indexOf('refreshViewerMobileSheetContent') !== -1) {
                found = true;
                break;
            }
            pos = main.indexOf("addEventListener('mainListRendered'", pos + 1);
        }
        expect(found).toBe(true);
    });

    it('dismisses the sheet on a resize past the mobile breakpoint so desktop falls back to the inline card', () => {
        expect(main).toMatch(/addEventListener\(\s*['"]resize['"][\s\S]{0,400}!isMobileViewport\(\s*\)[\s\S]{0,200}closeViewerMobileSheet/);
    });

    it('styles the sheet as a bottom-anchored slide-up overlay with safe-area padding', () => {
        const backdropBlock = css.match(/#todoMdViewerMobileSheetBackdrop\s*\{[^}]*\}/);
        expect(backdropBlock).toBeTruthy();
        expect(backdropBlock[0]).toMatch(/position:\s*fixed/);
        expect(backdropBlock[0]).toMatch(/inset:\s*0/);
        expect(backdropBlock[0]).toMatch(/align-items:\s*flex-end/);

        const sheetBlock = css.match(/#todoMdViewerMobileSheet\s*\{[^}]*\}/);
        expect(sheetBlock).toBeTruthy();
        expect(sheetBlock[0]).toMatch(/transform:\s*translateY\(100%\)/);
        expect(sheetBlock[0]).toMatch(/transition:\s*transform\s+0?\.\d+s/);
        expect(sheetBlock[0]).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom/);

        expect(css).toMatch(/#todoMdViewerMobileSheetBackdrop\.is-open\s+#todoMdViewerMobileSheet\s*\{[\s\S]*?transform:\s*translateY\(0\)/);
    });

    it('takes over the full viewport (height:100dvh, no capped bottom-sheet height) with safe-area padding on the top and bottom edges', () => {
        const sheetBlock = css.match(/#todoMdViewerMobileSheet\s*\{[^}]*\}/);
        expect(sheetBlock).toBeTruthy();
        // Full dynamic-viewport height so the mobile address bar can't clip
        // the bottom and the underlying page can't peek through the top.
        expect(sheetBlock[0]).toMatch(/height:\s*100dvh/);
        // The old partial bottom-sheet cap that left the page peeking is gone.
        expect(sheetBlock[0]).not.toMatch(/max-height:\s*85vh/);
        // Notch + home-indicator padding so content clears the safe areas.
        expect(sheetBlock[0]).toMatch(/padding-top:\s*env\(safe-area-inset-top/);
        expect(sheetBlock[0]).toMatch(/padding-bottom:\s*env\(safe-area-inset-bottom/);

        // Backdrop no longer paints a dark strip — the full-screen sheet
        // covers the viewport, so no darkened page shows through behind it.
        const backdropBlock = css.match(/#todoMdViewerMobileSheetBackdrop\s*\{[^}]*\}/);
        expect(backdropBlock).toBeTruthy();
        expect(backdropBlock[0]).not.toMatch(/background:\s*rgba\(/);
    });

    it('propagates flex height down the sheet chain so the viewer body fills the full-screen sheet and scrolls', () => {
        // After the sheet became height:100dvh the container is full-height
        // but the inner content sized to itself, leaving dead space below.
        // The flex chain — sheet body → viewer card → viewer body — must each
        // grow (flex:1 1 auto), be allowed to shrink (min-height:0), and the
        // body must scroll within the remaining height (overflow-y:auto, no
        // max-height cap). Scoped to the sheet so the inline desktop card is
        // untouched.
        const sheetBody = css.match(/#todoMdViewerMobileSheet\s+\.completedMobileSheetBody\s*\{[^}]*\}/);
        expect(sheetBody).toBeTruthy();
        expect(sheetBody[0]).toMatch(/flex:\s*1\s+1\s+auto/);
        expect(sheetBody[0]).toMatch(/min-height:\s*0/);

        const card = css.match(/#todoMdViewerMobileSheet\s+\.todoMdViewerCard\s*\{[^}]*\}/);
        expect(card).toBeTruthy();
        expect(card[0]).toMatch(/flex:\s*1\s+1\s+auto/);
        expect(card[0]).toMatch(/min-height:\s*0/);

        const viewerBody = css.match(/#todoMdViewerMobileSheet\s+\.todoMdViewerBody\s*\{[^}]*\}/);
        expect(viewerBody).toBeTruthy();
        expect(viewerBody[0]).toMatch(/flex:\s*1\s+1\s+auto/);
        expect(viewerBody[0]).toMatch(/min-height:\s*0/);
        expect(viewerBody[0]).toMatch(/overflow-y:\s*auto/);
        expect(viewerBody[0]).toMatch(/max-height:\s*none/);
    });

    it('reads as interactive on mobile via cursor + pressed feedback', () => {
        // The viewer card sits inline below #completedHeader on mobile;
        // it must read as tappable (cursor + :active feedback) so the
        // sheet affordance is discoverable without a visible label.
        // Verify the cursor + active rules exist, then confirm both
        // sit inside the first @media (max-width: 700px) block (the
        // shared mobile bucket — putting them in their own narrower
        // @media would split the bucket).
        const cursorRuleIdx = css.search(/#mainList\s+\.todoMdViewerCard\s*\{[^}]*cursor:\s*pointer/);
        expect(cursorRuleIdx).toBeGreaterThan(-1);
        const activeRuleIdx = css.search(/#mainList\s+\.todoMdViewerCard:active\s*\{[^}]*background:\s*var\(--bg-hover\)/);
        expect(activeRuleIdx).toBeGreaterThan(-1);

        // Confirm both rules live inside a @media (max-width: 700px)
        // block (walk braces from the nearest preceding @media to find
        // its end; both rules must fall inside that range).
        function inMobileMediaBlock(pos) {
            const mediaIdx = css.lastIndexOf('@media (max-width: 700px)', pos);
            if (mediaIdx === -1) return false;
            let depth = 0;
            let openSeen = false;
            for (let i = css.indexOf('{', mediaIdx); i < css.length; i++) {
                if (css[i] === '{') { depth++; openSeen = true; }
                else if (css[i] === '}') {
                    depth--;
                    if (openSeen && depth === 0) return pos <= i;
                }
            }
            return false;
        }
        expect(inMobileMediaBlock(cursorRuleIdx)).toBe(true);
        expect(inMobileMediaBlock(activeRuleIdx)).toBe(true);
    });
});
