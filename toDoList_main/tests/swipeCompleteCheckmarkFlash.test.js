import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the contract for the mobile swipe-to-complete center-screen
// checkmark flash. The animation is a short-lived DOM-node-insert-then-
// remove that confirms the user just completed a todo via touch swipe.
// Source-inspection only — mirrors mobileCheckboxHidden.test.js: the
// CSS rules, the dispatch wiring in toDoRow.js, and the listener in
// main.js are all easier to pin against the text of the source than
// to drive through a full jsdom mount.

describe('Swipe-to-complete center-screen checkmark flash', () => {

    describe('CSS contract', () => {
        const css = read('style.css');

        it('defines a .swipeCompleteFlash overlay that is fixed, centered, and ignores pointer events', () => {
            const idx = css.indexOf('.swipeCompleteFlash {');
            expect(idx).toBeGreaterThan(-1);
            const body = css.slice(idx, css.indexOf('}', idx));
            expect(body).toMatch(/position:\s*fixed/);
            expect(body).toMatch(/pointer-events:\s*none/);
            // Centered via top/left + translate(-50%, -50%).
            expect(body).toMatch(/top:\s*50%/);
            expect(body).toMatch(/left:\s*50%/);
            expect(body).toMatch(/translate\(-50%,\s*-50%\)/);
        });

        it('uses the accent purple (#6C5DF5) for both the checkmark glyph and the ripple ring', () => {
            const checkIdx = css.indexOf('.swipeCompleteFlashCheck {');
            const rippleIdx = css.indexOf('.swipeCompleteFlashRipple {');
            expect(checkIdx).toBeGreaterThan(-1);
            expect(rippleIdx).toBeGreaterThan(-1);
            const checkBody = css.slice(checkIdx, css.indexOf('}', checkIdx));
            const rippleBody = css.slice(rippleIdx, css.indexOf('}', rippleIdx));
            expect(checkBody).toMatch(/color:\s*#6C5DF5/i);
            expect(rippleBody).toMatch(/border:[^;]*#6C5DF5/i);
        });

        it('pop keyframes scale 0.3 → overshoot to 1.2 → settle at 1.0 → fade out', () => {
            const idx = css.indexOf('@keyframes swipeCompleteFlashPop');
            expect(idx).toBeGreaterThan(-1);
            const end = css.indexOf('}\n}', idx);
            const block = css.slice(idx, end + 3);
            expect(block).toMatch(/scale\(0\.3\)/);
            expect(block).toMatch(/scale\(1\.2\)/);
            expect(block).toMatch(/scale\(1\.0\)/);
            expect(block).toMatch(/opacity:\s*0/);
        });

        it('ripple keyframes expand outward and fade to transparent', () => {
            const idx = css.indexOf('@keyframes swipeCompleteFlashRipple');
            expect(idx).toBeGreaterThan(-1);
            const end = css.indexOf('}\n}', idx);
            const block = css.slice(idx, end + 3);
            // Starts small/visible and ends large/transparent.
            expect(block).toMatch(/scale\(0\.4\)/);
            expect(block).toMatch(/scale\(2\.6\)/);
            expect(block).toMatch(/opacity:\s*0/);
        });

        it('hides the flash entirely under prefers-reduced-motion: reduce', () => {
            const reduceIdx = css.indexOf('@media (prefers-reduced-motion: reduce)');
            expect(reduceIdx).toBeGreaterThan(-1);
            // There are multiple such blocks in the file; assert that AT LEAST
            // one of them contains the .swipeCompleteFlash hide rule.
            const flashHide = /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[^}]*\.swipeCompleteFlash[^}]*display:\s*none/;
            expect(flashHide.test(css)).toBe(true);
        });
    });

    describe('Dispatch wiring (toDoRow.js)', () => {
        const toDoRow = read('toDoRow.js');
        const swipeOnRight = toDoRow.match(/onRight:\s*function\s*\(\)\s*\{([\s\S]*?)^\s{8}\}/m);

        it('captures the pre-toggle checked state in a willComplete flag', () => {
            expect(swipeOnRight).toBeTruthy();
            expect(swipeOnRight[1]).toMatch(/const\s+willComplete\s*=\s*!cb\.checked/);
        });

        it('only dispatches todoSwipeRightComplete when willComplete is true', () => {
            expect(swipeOnRight).toBeTruthy();
            // The dispatch is gated on the willComplete flag so swipe-right
            // on an already-completed row to UN-complete it stays silent.
            const body = swipeOnRight[1];
            expect(body).toMatch(/if\s*\(\s*willComplete\s*\)[\s\S]*?dispatchEvent\(new CustomEvent\(['"]todoSwipeRightComplete['"]\)\)/);
        });

        it('still dispatches the checkbox change event so persistence and recurring-task advancement are unchanged', () => {
            // Regression guard mirroring mobileCheckboxHidden.test.js:
            // the flash hook must not bypass the existing change-event
            // path that owns persistence on mobile.
            expect(swipeOnRight).toBeTruthy();
            expect(swipeOnRight[1]).toMatch(/cb\.dispatchEvent\(new Event\(['"]change['"]\)\)/);
        });
    });

    describe('Listener and overlay lifecycle (main.js)', () => {
        const main = read('main.js');

        it('registers a single document-level listener for todoSwipeRightComplete', () => {
            // The single-entry webpack bundle evaluates main.js once at boot,
            // so the listener registers a single time without the former
            // window.__swipeCompleteFlashListenerRegistered double-eval guard.
            expect(main).not.toMatch(/window\.__swipeCompleteFlashListenerRegistered/);
            expect(main).toMatch(/document\.addEventListener\(\s*['"]todoSwipeRightComplete['"]\s*,\s*playSwipeCompleteCheckmark\s*\)/);
        });

        it('playSwipeCompleteCheckmark bails out early when prefers-reduced-motion is set', () => {
            const fn = main.match(/function\s+playSwipeCompleteCheckmark\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
            expect(fn).toBeTruthy();
            // First substantive line should consult prefersReducedMotion and return.
            expect(fn[1]).toMatch(/if\s*\(\s*prefersReducedMotion\(\)\s*\)\s*return/);
        });

        it('overlay is appended to document.body and scheduled for removal so no long-lived element leaks', () => {
            const fn = main.match(/function\s+playSwipeCompleteCheckmark\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
            expect(fn).toBeTruthy();
            expect(fn[1]).toMatch(/document\.body\.appendChild\(flash\)/);
            // setTimeout removal — duration just needs to outlast the 1.1s animation.
            expect(fn[1]).toMatch(/setTimeout\([\s\S]*flash\.parentNode\.removeChild\(flash\)[\s\S]*?,\s*\d{3,4}\)/);
        });

        it('builds the overlay with the .swipeCompleteFlash, ripple, and check children', () => {
            const fn = main.match(/function\s+playSwipeCompleteCheckmark\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
            expect(fn).toBeTruthy();
            expect(fn[1]).toMatch(/className\s*=\s*['"]swipeCompleteFlash['"]/);
            expect(fn[1]).toMatch(/className\s*=\s*['"]swipeCompleteFlashRipple['"]/);
            expect(fn[1]).toMatch(/className\s*=\s*['"]swipeCompleteFlashCheck['"]/);
        });
    });
});
