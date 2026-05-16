import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the STACK mobile bottom sheet utility surface — the
// bottom-anchored container that houses the Pomodoro timer and the YouTube
// music player at the ≤700px breakpoint. The sheet cycles through three
// visible states (IDLE → PEEK → EXPANDED), reuses the existing pomodoro.js /
// music.js controllers without changing their logic, and follows the
// CLAUDE.md three-way modal close vocabulary when expanded. Source
// inspection (rather than full jsdom instantiation) is used because main.js
// is too large to load end-to-end (see CLAUDE.md note on file size).
describe('STACK mobile bottom sheet utility surface', () => {
    const main   = read('main.js');
    const css    = read('style.css');
    const modals = read('modals.js');

    it('mounts the sheet inside #outerContainer (base) so it respects scroll context', () => {
        expect(main).toMatch(/bottomSheet\.id\s*=\s*['"]bottomSheet['"]/);
        expect(main).toMatch(/base\.appendChild\(bottomSheet\)/);
    });

    it('builds the three visible state nodes (IDLE nub, PEEK strip, EXPANDED dialog)', () => {
        expect(main).toMatch(/sheetNub\.id\s*=\s*['"]bottomSheetNub['"]/);
        expect(main).toMatch(/sheetPeek\.id\s*=\s*['"]bottomSheetPeek['"]/);
        expect(main).toMatch(/sheetExpanded\.id\s*=\s*['"]bottomSheetExpanded['"]/);
        // EXPANDED carries the modal dialog role so screen readers
        // announce it correctly.
        expect(main).toMatch(/sheetExpanded\.setAttribute\(\s*['"]role['"]\s*,\s*['"]dialog['"]/);
        expect(main).toMatch(/sheetExpanded\.setAttribute\(\s*['"]aria-modal['"]\s*,\s*['"]true['"]/);
    });

    it('renders the PEEK strip with timer + music segments and an expand chevron', () => {
        expect(main).toMatch(/sheetPeekDot/);
        expect(main).toMatch(/peekTime\.className\s*=\s*['"]sheetPeekTime['"]/);
        expect(main).toMatch(/peekStation\.className\s*=\s*['"]sheetPeekStation['"]/);
        // CSS visualizer bars need an explicit parent height; verify the
        // parent gets the bars container class.
        expect(main).toMatch(/peekBars\.className\s*=\s*['"]sheetPeekBars['"]/);
        expect(main).toMatch(/peekChevron\.textContent\s*=\s*['"]⌃['"]/);
    });

    it('explicitly sets a parent height on the peek bars container (prior failure mode)', () => {
        // The documented prior failure was percentage-height bars rendering
        // at 0 because the parent had no explicit height. Pin the explicit
        // height so a future refactor can't drop it again.
        const match = css.match(/\.sheetPeekBars\s*\{[^}]*height:\s*\d+px/);
        expect(match).toBeTruthy();
    });

    it('subscribes to the pomodoro controller and drives PEEK/IDLE off snapshots', () => {
        expect(main).toMatch(/pomCtl\.subscribe\(syncPomodoroSheet\)/);
        // utilityIsActive treats RUNNING, PAUSED, and COMPLETE_UNACKED as
        // "timer active" so the peek shows during the post-complete
        // acknowledgement window.
        expect(main).toMatch(/function utilityIsActive\(/);
        expect(main).toMatch(/s === ['"]RUNNING['"] \|\| s === ['"]PAUSED['"] \|\| s === ['"]COMPLETE_UNACKED['"]/);
    });

    it('subscribes to the music controller and treats PLAYING / BUFFERING as active', () => {
        expect(main).toMatch(/musicCtl\.subscribe\(syncMusicSheet\)/);
        expect(main).toMatch(/s === ['"]PLAYING['"] \|\| s === ['"]BUFFERING['"]/);
    });

    it('auto-collapses PEEK → IDLE after a 3s grace window so completion frames are legible', () => {
        // 3s = 3000ms grace per the spec — pin the exact constant.
        const graceIdx = main.indexOf('sheetIdleGraceTimer');
        expect(graceIdx).toBeGreaterThan(-1);
        expect(main).toMatch(/setTimeout\(function\(\)\s*\{[\s\S]*?setSheetState\(\s*['"]IDLE['"]\s*\)[\s\S]*?\}\s*,\s*3000\s*\)/);
    });

    it('expands on a tap of the IDLE nub or the PEEK strip', () => {
        expect(main).toMatch(/sheetNub\.addEventListener\(\s*['"]click['"]\s*,\s*function\(\)\s*\{\s*setSheetState\(\s*['"]EXPANDED['"]\s*\)/);
        expect(main).toMatch(/sheetPeek\.addEventListener\(\s*['"]click['"]/);
    });

    it('exposes a Pomodoro section with mode tabs and Reset / primary / Skip actions', () => {
        expect(main).toMatch(/sheetPomTabs/);
        expect(main).toMatch(/sheetPomPrimary\.className\s*=\s*['"]sheetPomPrimary['"]/);
        expect(main).toMatch(/sheetPomReset\.textContent\s*=\s*['"]Reset['"]/);
        expect(main).toMatch(/sheetPomSkip\.textContent\s*=\s*['"]Skip['"]/);
        // Primary toggles start/pause on the existing controller — no
        // new state, just chrome.
        expect(main).toMatch(/sheetPomPrimary\.addEventListener\(\s*['"]click['"][\s\S]*?if \(status === ['"]RUNNING['"]\) ctl\.pause\(\)/);
    });

    it('mounts a music card with play/pause + ›chevron that drills into the picker', () => {
        expect(main).toMatch(/sheetMusicPlayPause/);
        expect(main).toMatch(/sheetMusicMore\.textContent\s*=\s*['"]›['"]/);
        // ›chevron click swaps `data-view` to 'picker' — drilldown is a
        // view swap within the same sheet, not a stacked second sheet.
        expect(main).toMatch(/sheetMusicMore\.addEventListener\(\s*['"]click['"]\s*,\s*function\(\)\s*\{\s*bottomSheet\.setAttribute\(\s*['"]data-view['"]\s*,\s*['"]picker['"]/);
        // Back chevron returns to controls view.
        expect(main).toMatch(/sheetPickerBack\.addEventListener\(\s*['"]click['"]\s*,\s*function\(\)\s*\{\s*bottomSheet\.setAttribute\(\s*['"]data-view['"]\s*,\s*['"]controls['"]/);
    });

    it('provides a Show Video toggle that flips a class without restarting playback', () => {
        // Toggle adds/removes the `show-video` class on the picker view —
        // the iframe target stays mounted so playback is unaffected.
        expect(main).toMatch(/sheetShowVideoCheck\.addEventListener\(\s*['"]change['"]/);
        expect(main).toMatch(/sheetPicker\.classList\.toggle\(\s*['"]show-video['"]/);
        // CSS rule wires the class to a display swap on the player wrap —
        // no JS-driven detach / re-attach of the iframe.
        expect(css).toMatch(/\.sheetViewPicker\.show-video\s*\.sheetPlayerWrap\s*\{\s*display:\s*flex/);
    });

    it('closes EXPANDED on Escape with capture-phase priority over the drawer Escape handler', () => {
        // Capture-phase keydown handler that targets the expanded sheet.
        const blocks = main.match(/document\.addEventListener\(['"]keydown['"][\s\S]*?\}\s*,\s*true\s*\)\s*;/g) || [];
        const handler = blocks.find(function(b) {
            return /bottomSheet\.getAttribute\(\s*['"]data-state['"]\s*\) !== ['"]EXPANDED['"]/.test(b);
        });
        expect(handler).toBeTruthy();
        expect(handler).toMatch(/e\.preventDefault/);
        expect(handler).toMatch(/setSheetState/);
    });

    it('closes EXPANDED on backdrop tap, but picker-view backdrop returns to controls first', () => {
        // sheetBackdrop click handler routes through view-state check first.
        const handlerStart = main.indexOf("sheetBackdrop.addEventListener('click'");
        expect(handlerStart).toBeGreaterThan(-1);
        const handler = main.slice(handlerStart, handlerStart + 600);
        expect(handler).toMatch(/data-view['"]\s*\)\s*===\s*['"]picker['"]/);
        expect(handler).toMatch(/setAttribute\(\s*['"]data-view['"]\s*,\s*['"]controls['"]/);
        // After the picker check the handler falls through to dismiss.
        expect(handler).toMatch(/setSheetState/);
    });

    it('drag-down on the handle past 30% dismisses to the lower state', () => {
        // attachDragGesture is the unified pointer-event drag plumbing; the
        // dismiss intent uses the explicit 30% threshold from the spec.
        expect(main).toMatch(/function attachDragGesture\(/);
        expect(main).toMatch(/dy\s*\/\s*h\s*>\s*0\.3/);
        // Returns to PEEK if a utility is still active, IDLE otherwise.
        const block = main.match(/intent === ['"]dismiss['"]\s*&&\s*dy > 0[\s\S]{0,400}/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/active\.any\s*\?\s*['"]PEEK['"]\s*:\s*['"]IDLE['"]/);
    });

    it('drag-up on the nub or peek strip expands the sheet', () => {
        // The attachDragGesture calls below the function definition target
        // both the nub and the peek strip with the 'expand' intent.
        expect(main).toMatch(/attachDragGesture\(sheetNub,\s*['"]expand['"]\)/);
        expect(main).toMatch(/attachDragGesture\(sheetPeek,\s*['"]expand['"]\)/);
        expect(main).toMatch(/attachDragGesture\(sheetDragHandle,\s*['"]dismiss['"]\)/);
    });

    it('hides the sheet entirely when the mobile drawer is open or NO PROJECTS empty state is active', () => {
        expect(main).toMatch(/function refreshSheetVisibility\(/);
        expect(main).toMatch(/main1\.classList\.contains\(\s*['"]sidebar-open['"]\s*\)/);
        expect(main).toMatch(/document\.querySelector\(\s*['"]#emptyState\.emptyStateNoProjects['"]\s*\)/);
        // Drawer open/close hooks the refresh so the sheet hides immediately.
        expect(main).toMatch(/window\.bottomSheetRefreshVisibility/);
    });

    it('hides the sheet at desktop sizes via display:none default', () => {
        // Outside the mobile breakpoint #bottomSheet should not paint.
        expect(css).toMatch(/#bottomSheet\s*\{\s*display:\s*none/);
        // Inside the mobile breakpoint the sheet displays again.
        const mobileBlock = css.match(/@media \(max-width:\s*700px\)\s*\{[\s\S]*?#bottomSheet\s*\{\s*display:\s*block/);
        expect(mobileBlock).toBeTruthy();
    });

    it('IDLE nub touch target is at least 44px tall (accessibility floor)', () => {
        // The visible bar is small but the surrounding button is sized up.
        // The button element retains its 44px height in source so the
        // touch-target contract still holds at the desktop breakpoint;
        // only the mobile `display: none` rule below hides it visually.
        const nubBlock = css.match(/#bottomSheetNub\s*\{[^}]*\}/);
        expect(nubBlock).toBeTruthy();
        expect(nubBlock[0]).toMatch(/height:\s*44px/);
    });

    it('hides the IDLE nub chrome at the mobile breakpoint so no decoration floats above the tab bar', () => {
        // The bottom tab bar is the visual bottom-of-screen anchor on
        // mobile, and .sheetSwipeZone already covers the bottom-edge
        // swipe-up gesture, so the 56×4 nub bar is dropped from paint.
        const mobileBlock = css.match(/@media \(max-width:\s*700px\)\s*\{[\s\S]*?#bottomSheet\s+#bottomSheetNub\s*\{\s*display:\s*none/);
        expect(mobileBlock).toBeTruthy();
    });

    it('expanded sheet height is capped at min(50dvh, 320px) for iOS Safari 100dvh quirks', () => {
        const block = css.match(/#bottomSheetExpanded\s*\{[^}]*\}/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/height:\s*min\(\s*50dvh\s*,\s*320px\s*\)/);
    });

    // Belt-and-suspenders fix for an iOS Safari quirk where `transform:
    // translateY(100%)` on an absolutely-positioned child inside a
    // `height: 100dvh` container doesn't fully clip against the container's
    // overflow rectangle — the bottom slice of the translated panel leaks
    // past the dvh boundary into the home-indicator zone. A prior
    // visibility-based fix left the drag handle painting because
    // descendants can override `visibility: hidden`. The resting
    // (non-EXPANDED) state now hides the panel via `display: none` so the
    // panel and every descendant are removed from the render tree.
    it('hides the resting EXPANDED panel via display:none to block iOS Safari overflow bleed', () => {
        const block = css.match(/#bottomSheetExpanded\s*\{[^}]*\}/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/display:\s*none/);
        // The superseded visibility-based hide is removed from source.
        expect(block[0]).not.toMatch(/visibility:\s*hidden/);
    });

    it('reveals the EXPANDED panel on open with display:flex for the column layout', () => {
        const expandedBlock = css.match(/#bottomSheet\[data-state="EXPANDED"\]\s*#bottomSheetExpanded\s*\{[^}]*\}/);
        expect(expandedBlock).toBeTruthy();
        expect(expandedBlock[0]).toMatch(/display:\s*flex/);
        // The transform animates from translateY(100%) to translateY(0) so
        // the slide-UP open animation is preserved.
        expect(expandedBlock[0]).toMatch(/transform:\s*translateY\(0\)/);
    });

    it('uses position: absolute inside #outerContainer (respects existing overflow rules)', () => {
        const block = css.match(/@media \(max-width:\s*700px\)\s*\{[\s\S]*?#bottomSheet\s*\{[^}]*\}/);
        expect(block).toBeTruthy();
        expect(block[0]).toMatch(/position:\s*absolute/);
    });

    it('paste-form inputs use 16px+ font to avoid iOS Safari focus-zoom', () => {
        // Pin the !important pattern so a future stylesheet refactor
        // doesn't shave the rule and silently re-enable zoom.
        expect(css).toMatch(/\.sheetPasteName,\s*\.sheetPasteUrl\s*\{[^}]*font-size:\s*16px\s*!important/);
    });

    it('registers the expanded sheet with isAnyModalOrPopoverOpen so global shortcuts yield', () => {
        // The mobile drawer's Escape handler bails when any modal/popover is
        // open. Including the expanded sheet here means the sheet's own
        // Escape capture-phase handler owns the keystroke — no double-fire.
        expect(modals).toMatch(/#bottomSheet\[data-state="EXPANDED"\]/);
    });
});
