import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname } from 'node:path';

import { createMobileUtilitySheet } from '../src/mobileUtilitySheet.js';

// The retired mobile ghost perch.
//
// The perch was a second mobile door to the ghost: a swipe up on #mobileTabBar
// raised a sprite above the bar, and tapping it opened the possessed Claude
// sheet. Possession made it redundant — the ghost chip in the sheet is now the
// only mobile door — so the module, its CSS, its gesture layer and its
// visibility preference are gone.
//
// Two things are worth pinning after a removal this wide. First, that nothing
// orphaned survived: a dangling import, an unreachable export, a rule block
// keyed off a class no code creates. Second — and this is the regression that
// would actually hurt — that the tab bar came back clean. The perch owned a
// touch layer on the app's primary mobile navigator, including a capture-phase
// click swallow, so the failure mode of a half-removal is tabs that stop
// navigating. These tests mount the real bar and drive it.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

// Every source file the app ships, so "no references anywhere in src" is
// checked against the tree rather than against a hand-listed set of files.
function sourceFiles(dir = srcDir, out = []) {
    readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) sourceFiles(full, out);
        else if (['.js', '.css', '.html'].includes(extname(entry.name))) out.push(full);
    });
    return out;
}

// jsdom has no TouchEvent constructor; dispatch plain Events carrying the
// `touches` array a gesture handler would read. If any listener survived the
// removal, these are what it would hear.
function fireTouch(el, type, point) {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    const list = point ? [point] : [];
    ev.touches = type === 'touchend' ? [] : list;
    ev.changedTouches = list;
    el.dispatchEvent(ev);
    return ev;
}

// A full vertical drag, start to finish, on one element — the exact shape that
// used to summon (up) or dismiss (down) the perch.
function swipe(el, fromY, toY, x = 60) {
    fireTouch(el, 'touchstart', { clientX: x, clientY: fromY });
    fireTouch(el, 'touchmove', { clientX: x, clientY: toY });
    fireTouch(el, 'touchend', { clientX: x, clientY: toY });
}

describe('mobile ghost perch — retired', () => {
    describe('nothing orphaned survives the removal', () => {
        it('deletes the module and its test file', () => {
            expect(existsSync(resolve(srcDir, 'mobileGhost.js'))).toBe(false);
            expect(existsSync(resolve(here, 'mobileGhost.test.js'))).toBe(false);
        });

        it('leaves no reference to mobileGhost anywhere in src', () => {
            const offenders = sourceFiles().filter((file) =>
                /mobileGhost/i.test(readFileSync(file, 'utf8'))
            );
            expect(offenders).toEqual([]);
        });

        it('drops the perch import and its boot call from main.js', () => {
            const js = read('main.js');
            expect(js).not.toMatch(/from\s*['"]\.\/mobileGhost\.js['"]/);
            expect(js).not.toMatch(/ensureMobileGhost/);
            // The neighbouring desktop mounts are untouched — the removal took
            // one call site, not the boot block around it.
            expect(js).toMatch(/setTimeout\(ensureCompanion,\s*0\)/);
            expect(js).toMatch(/setTimeout\(ensureGhostTalk,\s*0\)/);
        });

        it('drops the orphaned mobile gate from ghostTalk.js, keeping the desktop plumbing', () => {
            const js = read('ghostTalk.js');
            expect(js).not.toMatch(/supportsMobileGhostTalk/);
            // The perch was that gate's only consumer. Everything the desktop
            // skin and the possessed sheet share stays exported.
            ['askGhost', 'fetchGhostHistory', 'ensureGhostTalk', 'isGhostWireReady']
                .forEach((name) => {
                    expect(js).toMatch(new RegExp('export function ' + name + '\\b'));
                });
            expect(js).toMatch(/export const GHOST_PLACEHOLDER/);
        });

        it('removes the perch rule blocks and its bob keyframes from style.css', () => {
            const css = read('style.css');
            expect(css).not.toMatch(/\.mobileGhostPerch/);
            expect(css).not.toMatch(/\.mobileGhostSprite/);
            expect(css).not.toMatch(/@keyframes\s+mobileGhostBob/);
        });

        it('keeps the shared sprite property, still worn by the companion and the chip', () => {
            const css = read('style.css');
            expect(css).toMatch(/--ghost-sprite:\s*url\(/);
            // Both remaining consumers read the one property rather than the
            // asset path, which is the whole point of the property surviving.
            const chip = css.match(/\.claudeGhostChip\s*\{[^}]*\}/);
            expect(chip).not.toBeNull();
            expect(chip[0]).toMatch(/background-image:\s*var\(--ghost-sprite\)/);
            const companion = css.match(/\n\.companion\s*\{[^}]*\}/);
            expect(companion).not.toBeNull();
            expect(companion[0]).toMatch(/background-image:\s*var\(--ghost-sprite\)/);
        });

        it('drops the perch visibility preference from src', () => {
            const offenders = sourceFiles().filter((file) =>
                /todoapp_mobileGhostVisible/.test(readFileSync(file, 'utf8'))
            );
            expect(offenders).toEqual([]);
        });

        it('leaves no touch-action lock on #mobileTabBar', () => {
            // The bar's touch-action existed only to feed the perch's swipe
            // detection. Other touch-action declarations in the file belong to
            // resizers, strips and the title row — this assertion is scoped to
            // the bar's own rules so it can never police those.
            // Comments stripped first: the file mentions the bar in prose in
            // several places, and a prose hit would pair with whatever rule
            // happened to follow it.
            const css = read('style.css').replace(/\/\*[\s\S]*?\*\//g, '');
            const bodies = [];
            let idx = css.indexOf('#mobileTabBar');
            while (idx > -1) {
                const open = css.indexOf('{', idx);
                const close = css.indexOf('}', open);
                if (open > -1 && close > -1) bodies.push(css.slice(open, close));
                idx = css.indexOf('#mobileTabBar', idx + 1);
            }
            expect(bodies.length).toBeGreaterThan(0);
            bodies.forEach((body) => expect(body).not.toMatch(/touch-action/));
        });
    });

    // The bar the perch used to share. Built by the real factory so these are
    // the listeners the app actually ships, not a stand-in.
    describe('the tab bar with the gesture layer gone', () => {
        let base;
        let main1;
        let routedViews;

        function mountBar() {
            createMobileUtilitySheet({
                base,
                main1,
                mainList: main1.querySelector('#mainList'),
                applyActiveView(viewKey) { routedViews.push(viewKey); },
                getPomodoroController() { return null; },
                getMusicController() { return null; },
            });
            return document.getElementById('mobileTabBar');
        }

        beforeEach(() => {
            document.body.innerHTML = '';
            base = document.createElement('div');
            base.id = 'outerContainer';
            main1 = document.createElement('div');
            const mainList = document.createElement('div');
            mainList.id = 'mainList';
            main1.appendChild(mainList);
            document.body.appendChild(base);
            document.body.appendChild(main1);
            routedViews = [];
        });

        it('routes a plain tap on each tab through applyActiveView', () => {
            mountBar();
            document.getElementById('mobileTabProjects').click();
            document.getElementById('mobileTabStructure').click();
            expect(routedViews).toEqual(['projects', 'structure']);
        });

        it('summons nothing on an upward swipe and still navigates on the tap after it', () => {
            const bar = mountBar();
            // The old summon gesture: up past the 24px threshold.
            swipe(bar, 600, 540);
            expect(document.querySelector('#mobileGhostPerch')).toBeNull();
            expect(document.querySelector('[aria-label="Talk to the ghost"]')).toBeNull();
            // The perch swallowed the click that followed a committed swipe, in
            // the capture phase. With the layer gone the tap must land.
            document.getElementById('mobileTabProjects').click();
            expect(routedViews).toEqual(['projects']);
        });

        it('navigates on the tap after a downward swipe too', () => {
            const bar = mountBar();
            swipe(bar, 540, 600);
            document.getElementById('mobileTabStructure').click();
            expect(routedViews).toEqual(['structure']);
            expect(document.querySelector('#mobileGhostPerch')).toBeNull();
        });

        it('mounts no ghost element beside the bar at all', () => {
            mountBar();
            expect(document.body.querySelectorAll('[class*="mobileGhost"]').length).toBe(0);
        });
    });
});
