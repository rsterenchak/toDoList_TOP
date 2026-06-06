import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { updateEmptyState } from '../src/emptyState.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the STACK ≤1023px empty-state restyle: each of the three variants
// (NO PROJECTS / NO TODOS YET / ALL CAUGHT UP) renders a ghost mascot
// element with a variant-specific class, plus the welcome / sparkles /
// up-arrow flourishes called out in the STACK spec. The mascots are
// painted from committed SVG files under src/ via CSS background-image
// rules — no icon libraries, per CLAUDE.md.
describe('STACK mobile empty-state mascots', () => {

    function makeMainList() {
        document.body.innerHTML = '';
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        document.body.appendChild(mainList);
        return mainList;
    }

    function addCommittedRow(mainList, value, completed) {
        const row = document.createElement('div');
        row.id = 'toDoChild';
        if (completed) row.classList.add('completed');
        const input = document.createElement('input');
        input.id = 'toDoInput';
        input.value = value;
        row.appendChild(input);
        mainList.appendChild(row);
    }

    describe('NO PROJECTS variant', () => {

        it('renders a purple-ghost mascot element', () => {
            const mainList = makeMainList();
            updateEmptyState(mainList);

            const mascot = mainList.querySelector('.emptyStateMascot');
            expect(mascot).not.toBeNull();
            expect(mascot.classList.contains('emptyStateMascotPurple')).toBe(true);
            // Purely decorative — must be hidden from the accessibility tree
            // so screen readers don't read out an empty <div>.
            expect(mascot.getAttribute('aria-hidden')).toBe('true');
        });

        it('renders desktop and mobile title spans alongside the existing title', () => {
            const mainList = makeMainList();
            updateEmptyState(mainList);

            const desktop = mainList.querySelector('.emptyStateTitleDesktop');
            const mobile  = mainList.querySelector('.emptyStateTitleMobile');
            expect(desktop).not.toBeNull();
            expect(mobile).not.toBeNull();
            // Desktop keeps the existing copy so any reader inspecting the
            // DOM sees both — CSS picks one based on viewport width.
            expect(desktop.textContent).toBe('No projects yet');
            expect(mobile.textContent).toBe('Welcome.');
        });

        it('renders desktop and mobile CTA spans inside the create button', () => {
            const mainList = makeMainList();
            updateEmptyState(mainList);

            const btn = document.getElementById('emptyStateCreateBtn');
            expect(btn).not.toBeNull();
            // Existing test pins the button as a real <button> for native
            // Enter activation — mascot restyle keeps that contract.
            expect(btn.tagName).toBe('BUTTON');

            const desktopCta = btn.querySelector('.ctaTextDesktop');
            const mobileCta  = btn.querySelector('.ctaTextMobile');
            expect(desktopCta).not.toBeNull();
            expect(mobileCta).not.toBeNull();
            expect(desktopCta.textContent).toBe('CREATE YOUR FIRST PROJECT');
            expect(mobileCta.textContent).toBe('+ New project');
        });
    });

    describe('NO TODOS YET variant', () => {

        it('renders a gray-ghost mascot when the project has no committed todos', () => {
            const mainList = makeMainList();
            updateEmptyState(mainList);
            // Prior render had no rows → NO PROJECTS variant. Add a
            // placeholder (blank) row to flip into NO TODOS YET, then
            // re-render so the empty-state branch evaluates `done === 0`.
            addCommittedRow(mainList, '', false);
            updateEmptyState(mainList);

            const block = mainList.querySelector('#emptyState');
            expect(block).not.toBeNull();
            expect(block.classList.contains('emptyStateNoTodos')).toBe(true);

            const mascot = block.querySelector('.emptyStateMascot');
            expect(mascot).not.toBeNull();
            expect(mascot.classList.contains('emptyStateMascotGray')).toBe(true);
        });

        it('renders a dotted up-arrow pointing at the input', () => {
            const mainList = makeMainList();
            addCommittedRow(mainList, '', false);
            updateEmptyState(mainList);

            const arrow = mainList.querySelector('.emptyStateUpArrow');
            expect(arrow).not.toBeNull();
            expect(arrow.getAttribute('aria-hidden')).toBe('true');
        });
    });

    describe('ALL CAUGHT UP variant', () => {

        it('renders a green-ghost mascot when at least one todo is completed', () => {
            const mainList = makeMainList();
            addCommittedRow(mainList, 'finished task', true);
            addCommittedRow(mainList, '', false);
            updateEmptyState(mainList);

            const block = mainList.querySelector('#emptyState');
            expect(block).not.toBeNull();
            expect(block.classList.contains('emptyStateAllCaughtUp')).toBe(true);

            const mascot = block.querySelector('.emptyStateMascot');
            expect(mascot).not.toBeNull();
            expect(mascot.classList.contains('emptyStateMascotGreen')).toBe(true);
        });

        it('renders four sparkle glyphs around the green ghost', () => {
            const mainList = makeMainList();
            addCommittedRow(mainList, 'finished task', true);
            addCommittedRow(mainList, '', false);
            updateEmptyState(mainList);

            const sparkles = mainList.querySelectorAll('.emptyStateSparkle');
            // Four sparkles per the STACK spec (spread asymmetrically
            // around the mascot, animated in CSS).
            expect(sparkles.length).toBe(4);
        });
    });

    describe('mascot SVG asset wiring', () => {
        const css = read('style.css');

        it('references all three ghost SVGs from the mobile media block', () => {
            // SVGs live alongside other src/ assets per CLAUDE.md (no icon
            // libraries) and are referenced via background-image url().
            expect(css).toMatch(/url\(['"]\.\/ghost_purple\.svg['"]\)/);
            expect(css).toMatch(/url\(['"]\.\/ghost_gray\.svg['"]\)/);
            expect(css).toMatch(/url\(['"]\.\/ghost_green\.svg['"]\)/);
        });

        it('hides mascots, sparkles, and up-arrow on desktop by default', () => {
            // Without this, the mascot would paint in both layouts and
            // double up with the existing ✦/✓ glyph on desktop.
            expect(css).toMatch(/\.emptyStateMascot[^{]*,\s*[^{]*\.emptyStateSparkles[^{]*,\s*[^{]*\.emptyStateUpArrow\s*\{[\s\S]*?display:\s*none/);
        });
    });
});
