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
// <=1023px breakpoint. The inline card is cramped on touch — the sheet
// gives it a full-height surface and reuses the COMPLETED-sheet pattern
// (DOM move, four-affordance dismiss, mainListRendered refresh) so the
// touch wiring is shared rather than duplicated. Source-inspection
// because main.js is too large to instantiate end-to-end in jsdom (per
// CLAUDE.md).
describe('Mobile TODO.md viewer bottom sheet', () => {
    // After the mobileSheets.js extraction the viewer-sheet contract spans
    // main.js (the setViewerCardTapHandler registration + its guards) and
    // mobileSheets.js (the open/close/refresh machinery + isAnyMobileSheetOpen).
    // Read both so the source-pattern pins below match wherever the contract
    // now lives.
    const main = read('main.js') + '\n' + read('mobileSheets.js');
    const viewer = read('todoMdViewer.js');
    const css  = read('style.css');

    it('attaches a click handler on the viewer card that opens the sheet on mobile only', () => {
        // The card-level click listener lives in buildTodoMdViewerCard
        // (todoMdViewer.js) and delegates to a handler registered by main.js
        // via setViewerCardTapHandler — the mobile-sheet machinery stays in
        // main.js without a circular import. The guard logic (mobile-only,
        // skip internal controls, #mainList-only, not-already-in-a-sheet)
        // lives in that registered handler.
        const buildIdx = viewer.indexOf('function buildTodoMdViewerCard(');
        expect(buildIdx).toBeGreaterThan(-1);
        // Walk to the next top-level function so the slice stays scoped
        // to this builder.
        const nextFnIdx = viewer.indexOf('\nfunction ', buildIdx + 1);
        const slice = viewer.slice(buildIdx, nextFnIdx > -1 ? nextFnIdx : buildIdx + 8000);
        // Card-level click handler that delegates to the injected tap handler.
        expect(slice).toMatch(/card\.addEventListener\(\s*['"]click['"]/);
        expect(slice).toMatch(/viewerCardTapHandler\(\s*card\s*,\s*event\s*\)/);

        // The registered handler in main.js carries the guards + sheet open.
        const handlerIdx = main.indexOf('setViewerCardTapHandler(function');
        expect(handlerIdx).toBeGreaterThan(-1);
        const handler = main.slice(handlerIdx, handlerIdx + 800);
        // Bails when not on mobile.
        expect(handler).toMatch(/isMobileViewport\(\s*\)/);
        // Skip clicks on internal interactive controls (button / tab /
        // anchor / input / label) so Sync / tabs / expand still work
        // without opening a redundant sheet.
        expect(handler).toMatch(/event\.target\.closest\(/);
        expect(handler).toMatch(/button/);
        // Open the sheet only when the card lives in #mainList (i.e.
        // not when it has already been moved into a sheet body).
        expect(handler).toMatch(/openViewerMobileSheet\(\s*card\s*\)/);
        expect(handler).toMatch(/mainListDiv\.contains\(\s*card\s*\)/);
    });

    it('declines to open when the COMPLETED sheet is already showing the viewer', () => {
        // The COMPLETED sheet moves the viewer card into its own body —
        // a second sheet on top of it would be redundant and would
        // strand the card in the wrong overlay. The registered tap handler
        // in main.js bails via isAnyMobileSheetOpen(), whose implementation
        // in mobileSheets.js checks completedMobileSheetState.open.
        const handlerIdx = main.indexOf('setViewerCardTapHandler(function');
        const handler = main.slice(handlerIdx, handlerIdx + 800);
        expect(handler).toMatch(/isAnyMobileSheetOpen\(\s*\)/);
        const accessorIdx = main.indexOf('function isAnyMobileSheetOpen(');
        expect(accessorIdx).toBeGreaterThan(-1);
        const accessor = main.slice(accessorIdx, accessorIdx + 300);
        expect(accessor).toMatch(/completedMobileSheetState[\s\S]{0,80}\.open/);
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
        // sit inside the first @media (max-width: 1023px) block (the
        // shared mobile bucket — putting them in their own narrower
        // @media would split the bucket).
        const cursorRuleIdx = css.search(/#mainList\s+\.todoMdViewerCard\s*\{[^}]*cursor:\s*pointer/);
        expect(cursorRuleIdx).toBeGreaterThan(-1);
        const activeRuleIdx = css.search(/#mainList\s+\.todoMdViewerCard:active\s*\{[^}]*background:\s*var\(--bg-hover\)/);
        expect(activeRuleIdx).toBeGreaterThan(-1);

        // Confirm both rules live inside a @media (max-width: 1023px)
        // block (walk braces from the nearest preceding @media to find
        // its end; both rules must fall inside that range).
        function inMobileMediaBlock(pos) {
            const mediaIdx = css.lastIndexOf('@media (max-width: 1023px)', pos);
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

// Pins the mobile-only "compact launcher" contract for the INLINE viewer
// card (the copy that lives in #mainList, not the bottom-sheet copy). On
// mobile the inline card used to render its full header + body, which a
// long todo list squeezed into the grid's floored 54px track — the card
// clipped to a sliver and overlapped the ghost spacer below it. The fix
// hides the tabs + body inline and collapses the header to a single
// launcher row that fits the track, while the bottom sheet keeps the full
// view. Source-inspection (CSS only) because the behavior is purely
// stylistic and main.js is too large to instantiate in jsdom (per CLAUDE.md).
describe('Mobile inline TODO.md viewer launcher', () => {
    const css = read('style.css');

    // True when `pos` falls inside a @media (max-width: 1023px) block.
    function inMobileMediaBlock(pos) {
        const mediaIdx = css.lastIndexOf('@media (max-width: 1023px)', pos);
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

    it('hides the inline markdown body, scoped to #mainList so the sheet copy keeps its body', () => {
        // Any rule that hides .todoMdViewerBody MUST be scoped to the inline
        // #mainList card — a global `.todoMdViewerBody { display: none }`
        // would blank the bottom sheet too.
        const hideBlocks = [...css.matchAll(/([^{}]*\.todoMdViewerBody[^{}]*)\{([^}]*)\}/g)]
            .filter((m) => /display:\s*none/.test(m[2]));
        expect(hideBlocks.length).toBeGreaterThan(0);
        for (const m of hideBlocks) {
            expect(m[1]).toMatch(/#mainList/);
        }
        const idx = css.search(/#mainList\s*>\s*#todoMdViewerCard[^{]*\.todoMdViewerBody[^{]*\{[^}]*display:\s*none/);
        expect(idx).toBeGreaterThan(-1);
        expect(inMobileMediaBlock(idx)).toBe(true);
    });

    it('hides the inline Rendered/Raw tabs, scoped to #mainList', () => {
        const hideBlocks = [...css.matchAll(/([^{}]*\.todoMdViewerTabs[^{}]*)\{([^}]*)\}/g)]
            .filter((m) => /display:\s*none/.test(m[2]));
        expect(hideBlocks.length).toBeGreaterThan(0);
        for (const m of hideBlocks) {
            expect(m[1]).toMatch(/#mainList/);
        }
        const idx = css.search(/#mainList\s*>\s*#todoMdViewerCard[^{]*\.todoMdViewerTabs[^{]*\{[^}]*display:\s*none/);
        expect(idx).toBeGreaterThan(-1);
        expect(inMobileMediaBlock(idx)).toBe(true);
    });

    it('constrains the inline card to a single launcher row that fits the 54px grid track', () => {
        // The inline card must not exceed its floored grid track, so it can
        // never clip to a sliver: cap its height and let overflow hide any
        // spillover. Scoped to the inline card via the child combinator so
        // the bottom-sheet copy (flex:1 1 auto / min-height:0) is untouched.
        const block = css.match(/#mainList\s*>\s*#todoMdViewerCard\s*\{([^}]*)\}/);
        expect(block).toBeTruthy();
        expect(block[1]).toMatch(/max-height:\s*54px/);
        expect(block[1]).toMatch(/overflow:\s*hidden/);
        const idx = css.indexOf(block[0]);
        expect(inMobileMediaBlock(idx)).toBe(true);
    });

    it('sizes the launcher to the todo-row rhythm so it fits the floor without the track growing', () => {
        // max-height alone left the card's outer margin + content over the 54px
        // floor; with no free space in an overflowing grid the track stayed
        // pinned and overflow:hidden shaved the baseline. The fix mirrors the
        // todo-row box: an explicit height of var(--item-h) plus a small
        // vertical margin so height + margin never exceeds the floor, and the
        // header's vertical padding is trimmed so the single row centers.
        const block = css.match(/#mainList\s*>\s*#todoMdViewerCard\s*\{([^}]*)\}/);
        expect(block).toBeTruthy();
        expect(block[1]).toMatch(/height:\s*var\(--item-h\)/);
        expect(block[1]).toMatch(/margin:\s*5px\s+8px/);
        expect(block[1]).toMatch(/justify-content:\s*center/);
        const header = css.match(/#mainList\s*>\s*#todoMdViewerCard\s+\.todoMdViewerHeader\s*\{([^}]*)\}/);
        expect(header).toBeTruthy();
        expect(header[1]).toMatch(/padding-top:\s*0/);
        expect(header[1]).toMatch(/padding-bottom:\s*0/);
        expect(inMobileMediaBlock(css.indexOf(block[0]))).toBe(true);
    });

    it('shows a "TODO.md" launcher label on the inline header', () => {
        // With the tabs hidden the header needs a label so the launcher is
        // self-describing; a ::before on the inline header supplies it
        // without touching main.js.
        const idx = css.search(/#mainList\s*>\s*#todoMdViewerCard[^{]*\.todoMdViewerHeader::before\s*\{[^}]*content:\s*['"]TODO\.md['"]/);
        expect(idx).toBeGreaterThan(-1);
        expect(inMobileMediaBlock(idx)).toBe(true);
    });

    it('leaves the bottom-sheet copy rendering its full body (no inline hide bleeds into the sheet)', () => {
        // Guard against regressions: the sheet's body rule must still set it
        // to fill + scroll, never display:none.
        const sheetBody = css.match(/#todoMdViewerMobileSheet\s+\.todoMdViewerBody\s*\{([^}]*)\}/);
        expect(sheetBody).toBeTruthy();
        expect(sheetBody[1]).not.toMatch(/display:\s*none/);
        expect(sheetBody[1]).toMatch(/overflow-y:\s*auto/);
    });
});
