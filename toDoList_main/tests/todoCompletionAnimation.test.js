// Slide-out fade completion animation for todo row checkboxes.
//
// Pins the shape of the transient `.todoCompleting` class added on the
// unchecked → checked edge of a row checkbox, the CSS keyframes that
// drive it, the prefers-reduced-motion gate (both JS-side and CSS-side),
// and the wiring across the three surfaces that share the row markup:
// the projects view (#toDoChild rows in #mainList), the Today dashboard
// (.todayRow.todoRowCard rows), and the Calendar day-detail panel
// (same row markup, rendered through buildTodayRow).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Isolate the body of a named top-level function so assertions can't
// false-positive off unrelated code elsewhere in the file.
function isolateFunction(source, signaturePrefix) {
    const start = source.indexOf(signaturePrefix);
    if (start < 0) return '';
    let depth = 0;
    let braceStart = source.indexOf('{', start);
    if (braceStart < 0) return '';
    for (let i = braceStart; i < source.length; i++) {
        const c = source[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return source.slice(start, i + 1);
        }
    }
    return '';
}

describe('todo completion slide-out fade — CSS contract', () => {
    const css = read('style.css');

    it('defines @keyframes todoSlideOutFade animating transform and opacity', () => {
        // The keyframes name is the contract the JS-side animationend
        // filter and the test pins below all share. Translation must end
        // back at 0 (the row settles into its final position) and a
        // midpoint frame must reach a non-zero translation + reduced
        // opacity so the row visibly slides and fades before settling.
        expect(css).toMatch(/@keyframes\s+todoSlideOutFade\b/);
        const block = css.match(/@keyframes\s+todoSlideOutFade[\s\S]*?\n\s*\}\s*\n/);
        expect(block).not.toBeNull();
        const text = block[0];
        expect(text).toMatch(/transform:\s*translateX\(/);
        expect(text).toMatch(/opacity:\s*/);
        // Endpoints land back at the resting state.
        expect(text).toMatch(/0%\s*\{\s*transform:\s*translateX\(0\);\s*opacity:\s*1/);
        expect(text).toMatch(/100%\s*\{\s*transform:\s*translateX\(0\);\s*opacity:\s*1/);
    });

    it('the keyframes + selector rules live inside a prefers-reduced-motion: no-preference block', () => {
        // Wrapping the entire animation in `no-preference` means the rule
        // is simply absent from the active stylesheet when the user has
        // requested reduced motion — the row snaps to its done state with
        // no animation, matching how the existing companion / pomodoro
        // animations honor the same gate.
        const reducedBlocks = css.match(/@media\s+\(prefers-reduced-motion:\s*no-preference\)\s*\{[\s\S]*?\n\}\s*\n/g) || [];
        const matching = reducedBlocks.filter(function(block) {
            return /@keyframes\s+todoSlideOutFade\b/.test(block)
                && /\.todoCompleting/.test(block);
        });
        expect(matching.length).toBeGreaterThan(0);
    });

    it('applies the slide-out animation to projects-view rows via #toDoChild.todoCompleting', () => {
        expect(css).toMatch(/#toDoChild\.todoCompleting[\s\S]{0,200}animation:\s*todoSlideOutFade/);
    });

    it('applies the slide-out animation to Today + Calendar rows via .todayRow.todoRowCard.todoCompleting', () => {
        // Today dashboard and Calendar day-detail share the same row
        // markup; one rule covers both surfaces.
        expect(css).toMatch(/\.todayRow\.todoRowCard\.todoCompleting[\s\S]{0,200}animation:\s*todoSlideOutFade/);
    });
});

describe('todo completion slide-out fade — projects-view wiring (toDoRow.js)', () => {
    const src = read('toDoRow.js');
    const body = isolateFunction(src, 'function wireCheckbox(');

    it('wireCheckbox is the function being modified (sanity check on isolation)', () => {
        expect(body.length).toBeGreaterThan(0);
        // The change handler we annotate lives inside this function.
        expect(body).toMatch(/checkToDo\.addEventListener\(\s*['"]change['"]/);
    });

    it('adds the todoCompleting class on the open → done edge, gated by prefersReducedMotion()', () => {
        // The class is added inside the same gated branch that already
        // adds .just-completed — that branch is itself nested under the
        // `checkToDo.checked && !wasCompleted && item.tit` precondition
        // (unchecked → checked, committed row only), and inside a
        // `!prefersReducedMotion()` block.
        expect(body).toMatch(/!prefersReducedMotion\(\)/);
        expect(body).toMatch(/classList\.add\(\s*['"]todoCompleting['"]/);
    });

    it('the class addition is nested under the wasCompleted false-edge guard', () => {
        // Confirm the add-class call sits inside the open→done branch.
        // Find the `!wasCompleted` guard, then check the add call
        // appears after it in the body before the branch closes.
        const guardIdx = body.indexOf('!wasCompleted');
        const addIdx   = body.indexOf("classList.add('todoCompleting')") >= 0
            ? body.indexOf("classList.add('todoCompleting')")
            : body.indexOf('classList.add("todoCompleting")');
        expect(guardIdx).toBeGreaterThan(-1);
        expect(addIdx).toBeGreaterThan(guardIdx);
    });

    it('removes the class on animationend, filtered by animationName === "todoSlideOutFade"', () => {
        // Filter by animationName so the listener doesn't fire off
        // unrelated keyframes (todoCheckPulse, todoCheckDraw,
        // todoStrikeSweep, recurringFlashPulse) that share the same row
        // element. The cleanup also detaches the listener to avoid
        // leaking subscribers when the row gets reordered later.
        expect(body).toMatch(/addEventListener\(\s*['"]animationend['"]/);
        // Accept either `===` (positive match) or `!==` (early-return guard);
        // both express the same filter intent.
        expect(body).toMatch(/animationName\s*(?:===|!==)\s*['"]todoSlideOutFade['"]/);
        expect(body).toMatch(/classList\.remove\(\s*['"]todoCompleting['"]/);
        expect(body).toMatch(/removeEventListener\(\s*['"]animationend['"]/);
    });
});

describe('todo completion slide-out fade — Today + Calendar wiring (main.js)', () => {
    const src = read('main.js');
    const body = isolateFunction(src, 'function handleTodayCheckboxToggle(');

    it('main.js imports prefersReducedMotion from ./dragDrop.js', () => {
        expect(src).toMatch(/import\s*\{[^}]*prefersReducedMotion[^}]*\}\s*from\s*['"]\.\/dragDrop\.js['"]/);
    });

    it('handleTodayCheckboxToggle adds .todoCompleting on the open → done edge', () => {
        expect(body.length).toBeGreaterThan(0);
        expect(body).toMatch(/!prefersReducedMotion\(\)/);
        expect(body).toMatch(/classList\.add\(\s*['"]todoCompleting['"]/);
    });

    it('only fires the animation on unchecked → checked (no-op on done → open)', () => {
        // The same `checkbox.checked && !wasCompleted` precondition the
        // recurring branch uses also guards the slide-out fade — otherwise
        // un-completing a row by misclick would visibly dance backwards.
        expect(body).toMatch(/checkbox\.checked\s*&&\s*!wasCompleted/);
    });

    it('the data-layer toggle (item.completed = checkbox.checked) runs before the animation branch', () => {
        // Persisted state must stay in sync even if the user navigates
        // away mid-animation — the spec calls for the mutation to be
        // synchronous, not deferred inside the animationend callback.
        const mutateIdx = body.indexOf('item.completed = checkbox.checked');
        const animateIdx = body.search(/classList\.add\(\s*['"]todoCompleting['"]/);
        expect(mutateIdx).toBeGreaterThan(-1);
        expect(animateIdx).toBeGreaterThan(-1);
        expect(mutateIdx).toBeLessThan(animateIdx);
    });

    it('removes the class on animationend, filtered by animationName === "todoSlideOutFade"', () => {
        expect(body).toMatch(/addEventListener\(\s*['"]animationend['"]/);
        // Accept either `===` (positive match) or `!==` (early-return guard);
        // both express the same filter intent.
        expect(body).toMatch(/animationName\s*(?:===|!==)\s*['"]todoSlideOutFade['"]/);
        expect(body).toMatch(/classList\.remove\(\s*['"]todoCompleting['"]/);
        expect(body).toMatch(/removeEventListener\(\s*['"]animationend['"]/);
    });

    it('targets the row element via .closest(".todayRow.todoRowCard")', () => {
        // The selector covers both the Today dashboard rows and the
        // Calendar day-detail rows (both built via buildTodayRow) — same
        // markup, same selector, one wiring.
        expect(body).toMatch(/closest\(\s*['"]\.todayRow\.todoRowCard['"]/);
    });
});
