import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the slide-out fade completion animation (ANIM-D from the mockup
// round). On the open → done edge of a row's checkbox, a transient
// `.todoCompleting` class drives a CSS keyframes rule that animates the
// row's transform and opacity over ~280ms before settling back to its
// final position in the standard `.completed` appearance. The animation
// applies in three surfaces — the project view `#mainList` rows, the
// Today view `.todayRow.todoRowCard` rows, and the Calendar day-detail
// panel (which reuses the same Today row markup) — all covered by a
// single CSS rule. Done → open and prefers-reduced-motion users skip
// the animation entirely; the data mutation always fires synchronously.

describe('todo completion slide-out fade animation — CSS surface', () => {
    const css = read('style.css');

    it('defines a 280ms slide+fade keyframes rule named todoCompletingSlideFade', () => {
        expect(css).toMatch(/@keyframes\s+todoCompletingSlideFade/);
        // 0% / 100% sit at the resting position; the 50% midpoint is the
        // translate+fade peak. Pin the values so a future tweak that
        // breaks the round-trip can't slip through.
        expect(css).toMatch(/todoCompletingSlideFade[\s\S]*?0%[\s\S]*?translateX\(0\)/);
        expect(css).toMatch(/todoCompletingSlideFade[\s\S]*?50%[\s\S]*?translateX\(40px\)/);
        expect(css).toMatch(/todoCompletingSlideFade[\s\S]*?50%[\s\S]*?opacity:\s*0?\.4/);
        expect(css).toMatch(/todoCompletingSlideFade[\s\S]*?100%[\s\S]*?translateX\(0\)/);
    });

    it('binds the keyframes to .todoCompleting with a ~280ms duration', () => {
        // Both surfaces (the project view #toDoChild and the Today/Calendar
        // .todayRow.todoRowCard) share the same animation rule.
        expect(css).toMatch(/#toDoChild\.todoCompleting/);
        expect(css).toMatch(/\.todayRow\.todoRowCard\.todoCompleting/);
        expect(css).toMatch(/\.todoCompleting[\s\S]*?animation:\s*todoCompletingSlideFade\s+280ms/);
    });

    it('gates the animation behind @media (prefers-reduced-motion: no-preference)', () => {
        // Wrapping the keyframes+rule block in `no-preference` means the
        // animation never enters the active stylesheet for users who've
        // opted out — they get the instant snap-to-done behavior that
        // shipped before this change.
        const noPrefBlocks = css.match(/@media\s*\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?\n\}/g) || [];
        const matching = noPrefBlocks.filter(function(block) {
            return /\.todoCompleting/.test(block)
                && /@keyframes\s+todoCompletingSlideFade/.test(block);
        });
        expect(matching.length).toBeGreaterThan(0);
    });
});


describe('todo completion slide-out fade animation — project view wiring', () => {
    const toDoRow = read('toDoRow.js');

    // Isolate the wireCheckbox body so source-regex assertions can't
    // false-positive off unrelated code elsewhere in the file.
    function wireCheckboxBody() {
        const start = toDoRow.indexOf('function wireCheckbox(');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = -1;
        for (let i = toDoRow.indexOf('{', start); i < toDoRow.length; i++) {
            const c = toDoRow[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        expect(end).toBeGreaterThan(start);
        return toDoRow.slice(start, end);
    }

    it('adds the .todoCompleting class inside the unchecked → checked branch', () => {
        const body = wireCheckboxBody();
        // The class lives inside the existing `checkToDo.checked && !wasCompleted`
        // gate (same gate as the celebratory `just-completed` flash), so it
        // only fires on the open → done edge — never on done → open.
        expect(body).toMatch(/checkToDo\.checked\s*&&\s*!wasCompleted/);
        expect(body).toMatch(/classList\.add\(\s*['"]todoCompleting['"]\s*\)/);
    });

    it('removes the .todoCompleting class via an animationend listener (not a setTimeout)', () => {
        const body = wireCheckboxBody();
        // animationend cleans up reliably even if the animation duration
        // is tweaked. A setTimeout would silently drift out of sync.
        expect(body).toMatch(/addEventListener\(\s*['"]animationend['"]/);
        expect(body).toMatch(/animationName\s*[!=]==?\s*['"]todoCompletingSlideFade['"]/);
        expect(body).toMatch(/classList\.remove\(\s*['"]todoCompleting['"]\s*\)/);
    });

    it('gates the .todoCompleting add behind a prefers-reduced-motion check', () => {
        const body = wireCheckboxBody();
        // Wrapped in the same `!prefersReducedMotion()` block that gates
        // the `just-completed` flash — keeps the reduced-motion contract
        // identical to today.
        const idx = body.indexOf("'todoCompleting'");
        expect(idx).toBeGreaterThan(-1);
        const before = body.slice(0, idx);
        expect(before).toMatch(/!prefersReducedMotion\s*\(\s*\)/);
    });

    it('persists the toggled state synchronously, independent of the animation', () => {
        const body = wireCheckboxBody();
        // The item.completed assignment and the sortCompletedToBottom /
        // reorderToDoDOM persistence calls must fire on the same tick as
        // the checkbox change event — the animation is purely visual.
        expect(body).toMatch(/item\.completed\s*=\s*checkToDo\.checked/);
        expect(body).toMatch(/listLogic\.sortCompletedToBottom\(/);
    });
});


describe('todo completion slide-out fade animation — Today / Calendar wiring', () => {
    const main = read('main.js');

    function handleTodayCheckboxToggleBody() {
        const start = main.indexOf('function handleTodayCheckboxToggle(');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = -1;
        for (let i = main.indexOf('{', start); i < main.length; i++) {
            const c = main[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        expect(end).toBeGreaterThan(start);
        return main.slice(start, end);
    }

    it('imports prefersReducedMotion from dragDrop.js', () => {
        expect(main).toMatch(/import\s*\{\s*prefersReducedMotion\s*\}\s*from\s*['"]\.\/dragDrop\.js['"]/);
    });

    it('adds .todoCompleting to the row on the open → done edge', () => {
        const body = handleTodayCheckboxToggleBody();
        expect(body).toMatch(/checkbox\.checked\s*&&\s*!wasCompleted/);
        expect(body).toMatch(/classList\.add\(\s*['"]completed['"]\s*,\s*['"]todoCompleting['"]\s*\)/);
    });

    it('defers the view re-render until animationend so the row is not unmounted mid-animation', () => {
        const body = handleTodayCheckboxToggleBody();
        // The Today/Calendar surfaces rebuild their row list on every
        // toggle. Without deferring the re-render, the row carrying
        // .todoCompleting would be destroyed before the keyframes could
        // play and the user would see nothing.
        expect(body).toMatch(/addEventListener\(\s*['"]animationend['"]/);
        expect(body).toMatch(/animationName\s*[!=]==?\s*['"]todoCompletingSlideFade['"]/);
    });

    it('skips the animation under prefers-reduced-motion (re-renders immediately)', () => {
        const body = handleTodayCheckboxToggleBody();
        // The animate gate combines the open→done edge, a committed title,
        // and the reduced-motion check — same trio the project view uses.
        expect(body).toMatch(/!prefersReducedMotion\s*\(\s*\)/);
    });

    it('persists the toggled state on the same tick as the checkbox change', () => {
        const body = handleTodayCheckboxToggleBody();
        // The item.completed assignment and the sortCompletedToBottom
        // call sit ABOVE the animation branch, so they always run —
        // animation deferral never blocks persistence.
        const completedIdx = body.indexOf('item.completed = checkbox.checked');
        const animateIdx = body.indexOf("'todoCompleting'");
        expect(completedIdx).toBeGreaterThan(-1);
        expect(animateIdx).toBeGreaterThan(-1);
        expect(completedIdx).toBeLessThan(animateIdx);
        expect(body).toMatch(/listLogic\.sortCompletedToBottom\(\s*project\s*\)/);
    });
});


// Pins the recurring-task flash bug fix: same root cause as the slide-out
// fade above (a re-parenting reorder cancelled the in-flight CSS keyframe)
// but on a different class (`.recurring-flash`) and a different code path
// (the recurring branch inside `wireCheckbox`). The fix defers
// `sortCompletedToBottom` + `reorderToDoDOM` until the flash's setTimeout
// fires so the keyframe is allowed to play. Under prefers-reduced-motion
// there is no animation to protect and the reorder stays synchronous.
describe('recurring-task flash animation — reorder defer keeps the CSS animation alive', () => {
    const toDoRow = read('toDoRow.js');

    function wireCheckboxBody() {
        const start = toDoRow.indexOf('function wireCheckbox(');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = -1;
        for (let i = toDoRow.indexOf('{', start); i < toDoRow.length; i++) {
            const c = toDoRow[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        expect(end).toBeGreaterThan(start);
        return toDoRow.slice(start, end);
    }

    // Narrow to the `if (advanced) { ... }` block so assertions can't
    // false-positive off the standard completion path lower in the handler.
    function advancedBlock() {
        const body = wireCheckboxBody();
        const advancedIdx = body.indexOf('if (advanced)');
        expect(advancedIdx).toBeGreaterThan(-1);
        const braceStart = body.indexOf('{', advancedIdx);
        let depth = 0;
        let end = -1;
        for (let i = braceStart; i < body.length; i++) {
            const c = body[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        expect(end).toBeGreaterThan(braceStart);
        return body.slice(advancedIdx, end);
    }

    it('runs sortCompletedToBottom + reorderToDoDOM inside the recurring-flash setTimeout, not on the click tick', () => {
        // A synchronous reorderToDoDOM re-parents the row via appendChild,
        // which cancels the .recurring-flash keyframe before any frames
        // paint. The reorder has to live inside the same setTimeout that
        // strips the flash class and resets the checkbox.
        const block = advancedBlock();
        const flashIdx = block.indexOf("'recurring-flash'");
        expect(flashIdx).toBeGreaterThan(-1);
        const stMatch = block.slice(flashIdx).match(
            /setTimeout\(\s*function\s*\(\s*\)\s*\{([\s\S]*?)\}\s*,\s*250\s*\)/
        );
        expect(stMatch).not.toBeNull();
        const cbBody = stMatch[1];
        expect(cbBody).toMatch(/classList\.remove\(\s*['"]recurring-flash['"]\s*\)/);
        expect(cbBody).toMatch(/checkToDo\.checked\s*=\s*false/);
        expect(cbBody).toMatch(/listLogic\.sortCompletedToBottom\(\s*projectName\s*\)/);
        expect(cbBody).toMatch(/reorderToDoDOM\(\s*projectName\s*\)/);
    });

    it('reorders synchronously under prefers-reduced-motion (no flash to protect)', () => {
        // The reduced-motion branch skips the flash entirely, so there is
        // no in-flight animation a synchronous reorderToDoDOM could
        // cancel — the reorder fires on the same tick as the click.
        const block = advancedBlock();
        const reducedMatch = block.match(
            /if\s*\(\s*!\s*prefersReducedMotion\s*\(\s*\)\s*\)\s*\{[\s\S]*?\}\s*else\s*\{([\s\S]*?)\}/
        );
        expect(reducedMatch).not.toBeNull();
        const elseBody = reducedMatch[1];
        expect(elseBody).toMatch(/checkToDo\.checked\s*=\s*false/);
        expect(elseBody).toMatch(/listLogic\.sortCompletedToBottom\(\s*projectName\s*\)/);
        expect(elseBody).toMatch(/reorderToDoDOM\(\s*projectName\s*\)/);
    });

    it('does NOT call sortCompletedToBottom or reorderToDoDOM synchronously after applyDueUrgency in the recurring branch', () => {
        // Pin the regression: before this fix the calls sat between the
        // vibrate fallback and the trailing `return`, firing on the same
        // tick as the click and cancelling the flash. They must not exist
        // as bare statements at that position any more.
        const block = advancedBlock();
        const applyIdx = block.indexOf('applyDueUrgency(');
        expect(applyIdx).toBeGreaterThan(-1);
        const returnIdx = block.lastIndexOf('return;');
        expect(returnIdx).toBeGreaterThan(applyIdx);
        // Elide any setTimeout bodies in the tail before asserting, so a
        // future defer using a different setTimeout doesn't trip the pin.
        const tail = block.slice(applyIdx, returnIdx).replace(
            /setTimeout\(\s*function\s*\(\s*\)\s*\{[\s\S]*?\}\s*,\s*\d+\s*\)/g,
            'setTimeoutElided'
        );
        expect(tail).not.toMatch(/listLogic\.sortCompletedToBottom\(/);
        expect(tail).not.toMatch(/reorderToDoDOM\(/);
    });

    it('calls advanceRecurringTodo synchronously, before any recurring-flash setTimeout', () => {
        // The completed clone advanceRecurringTodo spawns is the persisted
        // record of the user's click. It must land on the data model on
        // the same tick as the click so a navigate-away or reload
        // mid-animation can't lose it. The advance call sits OUTSIDE the
        // flash setTimeout — pin its position relative to the flash class.
        const body = wireCheckboxBody();
        const advanceIdx = body.indexOf('listLogic.advanceRecurringTodo(');
        expect(advanceIdx).toBeGreaterThan(-1);
        const flashIdx = body.indexOf("'recurring-flash'");
        expect(flashIdx).toBeGreaterThan(advanceIdx);
    });
});


// Pins the slide-out fade animation reorder-defer bug fix (project view).
// Before this fix, after .todoCompleting was added to the row whose
// checkbox was just clicked, the handler called sortCompletedToBottom +
// reorderToDoDOM synchronously on the same tick. reorderToDoDOM re-parents
// each row via appendChild, which restarts an in-flight CSS animation
// from frame 0 in the new DOM slot — so the slide-fade visibly played at
// the bottom of the list on the row that had just been moved there, not
// on the row the user actually checked off. The fix defers the reorder
// until the slide-fade's animationend fires, matching the deferral
// pattern handleTodayCheckboxToggle uses on the Today / Calendar
// surfaces. Done → open, blank rows (no projectName), and reduced-motion
// users have no animation to protect and continue to reorder
// synchronously on the click tick.
describe('todo completion slide-out fade — project view defers reorder until animationend', () => {
    const toDoRow = read('toDoRow.js');

    function wireCheckboxBody() {
        const start = toDoRow.indexOf('function wireCheckbox(');
        expect(start).toBeGreaterThan(-1);
        let depth = 0;
        let end = -1;
        for (let i = toDoRow.indexOf('{', start); i < toDoRow.length; i++) {
            const c = toDoRow[i];
            if (c === '{') depth++;
            else if (c === '}') {
                depth--;
                if (depth === 0) { end = i + 1; break; }
            }
        }
        expect(end).toBeGreaterThan(start);
        return toDoRow.slice(start, end);
    }

    // Extract every `addEventListener('animationend', function … { … })`
    // callback body in the supplied source slice so assertions can scope
    // matches to "inside an animationend callback" vs "outside one".
    function animationEndCallbacks(body) {
        const re = /addEventListener\(\s*['"]animationend['"]\s*,\s*function\s*\w*\s*\([^)]*\)\s*\{/g;
        const out = [];
        let m;
        while ((m = re.exec(body)) !== null) {
            const braceStart = m.index + m[0].length - 1;
            let depth = 0;
            for (let i = braceStart; i < body.length; i++) {
                const c = body[i];
                if (c === '{') depth++;
                else if (c === '}') {
                    depth--;
                    if (depth === 0) {
                        out.push(body.slice(braceStart, i + 1));
                        break;
                    }
                }
            }
        }
        return out;
    }

    it('defers the reorder into an animationend callback whose name check is todoCompletingSlideFade', () => {
        // The reorder lives behind a local commitReorder helper so the
        // animationend callback and the synchronous fallback share one
        // body. The reorder is "deferred" iff at least one animationend
        // callback gated on todoCompletingSlideFade either calls
        // commitReorder() directly OR inlines reorderToDoDOM(projectName).
        const body = wireCheckboxBody();
        const callbacks = animationEndCallbacks(body);
        const matching = callbacks.filter(function(cb) {
            if (!/animationName\s*[!=]==?\s*['"]todoCompletingSlideFade['"]/.test(cb)) return false;
            return /reorderToDoDOM\(\s*projectName\s*\)/.test(cb)
                || /\bcommitReorder\s*\(\s*\)/.test(cb);
        });
        expect(matching.length).toBeGreaterThan(0);
    });

    it('defines a commitReorder helper that calls sortCompletedToBottom AND reorderToDoDOM so the partition and reorder cannot drift apart', () => {
        // Extracting both calls into a single helper is what lets the
        // animationend callback and the synchronous-fallback branch share
        // one definition without either side forgetting one of the calls.
        const body = wireCheckboxBody();
        const fnMatch = body.match(/function\s+commitReorder\s*\(\s*\)\s*\{([\s\S]*?)\n\s*\}/);
        expect(fnMatch).not.toBeNull();
        const fnBody = fnMatch[1];
        expect(fnBody).toMatch(/listLogic\.sortCompletedToBottom\(\s*projectName\s*\)/);
        expect(fnBody).toMatch(/reorderToDoDOM\(\s*projectName\s*\)/);
    });

    it('keeps a synchronous reorderToDoDOM(projectName) path for callers that did not add the slide-fade (done→open, reduced-motion, recurring fallthrough)', () => {
        // After removing every animationend callback body, a
        // reorderToDoDOM(projectName) call must still remain in the
        // handler — otherwise reduced-motion users and the done→open
        // edge would never reorder. The call lives inside a local helper
        // (or its bare-statement equivalent) outside any animationend
        // listener.
        const body = wireCheckboxBody();
        const callbacks = animationEndCallbacks(body);
        let outside = body;
        callbacks.forEach(function(cb) {
            outside = outside.split(cb).join('');
        });
        expect(outside).toMatch(/reorderToDoDOM\(\s*projectName\s*\)/);
        expect(outside).toMatch(/listLogic\.sortCompletedToBottom\(\s*projectName\s*\)/);
    });

    it('keeps item.completed = checkToDo.checked above the standard-completion reorder branch so persistence never blocks on animation timing', () => {
        // The "reorder branch" here is the trailing standard-completion
        // reorder — NOT the recurring branch's reorder, which lives
        // earlier in the body and is already covered by the recurring-
        // flash describe above. Slice the body to everything AFTER the
        // item.completed assignment so the search ignores the recurring
        // branch entirely.
        const body = wireCheckboxBody();
        const completedIdx = body.indexOf('item.completed = checkToDo.checked');
        expect(completedIdx).toBeGreaterThan(-1);
        const tail = body.slice(completedIdx);
        expect(tail).toMatch(/reorderToDoDOM\(\s*projectName\s*\)/);
    });
});
