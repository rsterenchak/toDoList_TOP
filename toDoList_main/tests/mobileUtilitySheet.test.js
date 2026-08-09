import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createMobileUtilitySheet } from '../src/mobileUtilitySheet.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the bottom-sheet gate: createMobileUtilitySheet() still builds
// #mobileTabBar exactly as before, but the pomodoro/music sheet side of the
// module — #bottomSheet, its IDLE nub / PEEK strip / EXPANDED panel, and the
// .sheetSwipeZone bottom-edge gesture catcher — is no longer mounted. Unlike
// the source-inspection suites that cover the sheet's internals
// (stackBottomSheet.test.js et al., which still describe the code retained
// behind the gate), these tests mount the factory for real so they assert the
// DOM the app actually gets, and that every sheet-facing entry point no-ops
// against the absent element rather than throwing.
describe('mobile utility sheet — bottom sheet gated off, tab bar kept', () => {
    let base;
    let main1;
    let mainList;
    let routedViews;
    let pomodoroCalls;
    let musicCalls;

    function mount() {
        return createMobileUtilitySheet({
            base,
            main1,
            mainList,
            applyActiveView(viewKey) { routedViews.push(viewKey); },
            getPomodoroController() { pomodoroCalls++; return null; },
            getMusicController() { musicCalls++; return null; },
        });
    }

    // The factory's controller subscriptions and its visibility MutationObserver
    // both run off setTimeout(…, 0), so drain the macrotask queue before
    // asserting on anything they would touch.
    function flushTimers() {
        return new Promise(function(done) { setTimeout(done, 0); });
    }

    beforeEach(() => {
        document.body.innerHTML = '';
        document.documentElement.className = '';
        base = document.createElement('div');
        base.id = 'outerContainer';
        main1 = document.createElement('div');
        mainList = document.createElement('div');
        mainList.id = 'mainList';
        main1.appendChild(mainList);
        document.body.appendChild(base);
        document.body.appendChild(main1);
        routedViews = [];
        pomodoroCalls = 0;
        musicCalls = 0;
        delete window.bottomSheetRefreshVisibility;
        delete window.mobileTabBarRefreshVisibility;
    });

    describe('the sheet is absent from the DOM', () => {
        it('mounts neither #bottomSheet nor .sheetSwipeZone', async () => {
            mount();
            await flushTimers();
            expect(document.querySelector('#bottomSheet')).toBeNull();
            expect(document.querySelector('.sheetSwipeZone')).toBeNull();
        });

        it('mounts none of the sheet chrome a swipe-up would have revealed', async () => {
            mount();
            await flushTimers();
            ['#bottomSheetNub', '#bottomSheetPeek', '#bottomSheetExpanded',
             '#bottomSheetBackdrop', '#bottomSheetMusicPlayerTarget'].forEach(function(sel) {
                expect(document.querySelector(sel)).toBeNull();
            });
        });

        it('returns a null bottomSheet handle', async () => {
            const api = mount();
            await flushTimers();
            expect(api.bottomSheet).toBeNull();
        });

        it('never subscribes to the pomodoro or music controllers', async () => {
            mount();
            await flushTimers();
            // The accessors are only reached from the sheet's subscription and
            // state plumbing, so a gated-off sheet must not touch them at all —
            // starting a pomodoro or playing music simply produces no sheet.
            expect(pomodoroCalls).toBe(0);
            expect(musicCalls).toBe(0);
        });
    });

    describe('the sheet-facing entry points no-op', () => {
        it('setSheetState accepts every state without throwing or painting', async () => {
            const api = mount();
            await flushTimers();
            ['IDLE', 'PEEK', 'EXPANDED', 'bogus'].forEach(function(state) {
                expect(() => api.setSheetState(state)).not.toThrow();
            });
            expect(document.querySelector('#bottomSheet')).toBeNull();
            expect(
                document.documentElement.classList.contains('bottom-sheet-expanded')
            ).toBe(false);
        });

        it('refreshSheetVisibility still runs and still drives the tab bar', async () => {
            const api = mount();
            await flushTimers();
            main1.classList.add('sidebar-open');
            expect(() => api.refreshSheetVisibility()).not.toThrow();
            expect(api.mobileTabBar.classList.contains('hidden-by-drawer')).toBe(true);
            main1.classList.remove('sidebar-open');
            api.refreshSheetVisibility();
            expect(api.mobileTabBar.classList.contains('hidden-by-drawer')).toBe(false);
        });

        it('keeps window.bottomSheetRefreshVisibility installed for the drawer hooks', async () => {
            const api = mount();
            await flushTimers();
            // sidebarDrawer.js and main.js's openMobileDrawer() both reach for
            // this global; it stays the single visibility entry point.
            expect(typeof window.bottomSheetRefreshVisibility).toBe('function');
            main1.classList.add('sidebar-open');
            window.bottomSheetRefreshVisibility();
            expect(api.mobileTabBar.classList.contains('hidden-by-drawer')).toBe(true);
        });
    });

    describe('#mobileTabBar is unaffected', () => {
        it('mounts the bar into base with both destinations', async () => {
            const api = mount();
            await flushTimers();
            const bar = base.querySelector('#mobileTabBar');
            expect(bar).not.toBeNull();
            expect(bar).toBe(api.mobileTabBar);
            expect(bar.getAttribute('role')).toBe('tablist');
            const tabs = Array.from(bar.querySelectorAll('.mobileTab'));
            expect(tabs.map((t) => t.dataset.view)).toEqual(['projects', 'structure']);
            expect(tabs.map((t) => t.getAttribute('aria-label')))
                .toEqual(['Projects', 'Structure']);
            expect(tabs[0].querySelector('.mobileTabLabel').textContent).toBe('Stream');
        });

        it('keeps the STREAM working dot and the STRUCTURE no-repo marker', async () => {
            mount();
            await flushTimers();
            expect(
                document.querySelector('#mobileTabProjects .agentWorkingMarker')
            ).not.toBeNull();
            expect(
                document.querySelector('#mobileTabStructure .agentNoRepoMarker')
            ).not.toBeNull();
        });

        it('routes a tab tap through applyActiveView', async () => {
            mount();
            await flushTimers();
            document.querySelector('#mobileTabStructure').click();
            document.querySelector('#mobileTabProjects').click();
            expect(routedViews).toEqual(['structure', 'projects']);
        });

        it('hides on the NO PROJECTS empty state and reveals again when it clears', async () => {
            const api = mount();
            await flushTimers();
            const empty = document.createElement('div');
            empty.id = 'emptyState';
            empty.className = 'emptyStateNoProjects';
            document.body.appendChild(empty);
            api.refreshTabBarVisibility();
            expect(api.mobileTabBar.classList.contains('hidden-by-empty')).toBe(true);
            empty.remove();
            api.refreshTabBarVisibility();
            expect(api.mobileTabBar.classList.contains('hidden-by-empty')).toBe(false);
        });

        it('installs window.mobileTabBarRefreshVisibility as before', async () => {
            mount();
            await flushTimers();
            expect(typeof window.mobileTabBarRefreshVisibility).toBe('function');
        });
    });

    describe('gate shape', () => {
        const src = read('mobileUtilitySheet.js');

        it('builds the sheet only through the MOUNT_BOTTOM_SHEET gate', () => {
            expect(src).toMatch(/const MOUNT_BOTTOM_SHEET\s*=\s*false\s*;/);
            expect(src).toMatch(
                /const sheet\s*=\s*MOUNT_BOTTOM_SHEET\s*\?\s*buildBottomSheet\(deps\)\s*:\s*null/
            );
            // The gate is the ONLY call site — nothing else may build the
            // sheet. Comment lines are stripped so prose naming the builder
            // doesn't read as a call.
            const code = src.replace(/^\s*\/\/.*$/gm, '');
            const calls = code.match(/(?<!function )buildBottomSheet\(/g) || [];
            expect(calls).toHaveLength(1);
        });

        it('keeps the sheet subsystem intact behind the gate rather than deleting it', () => {
            // The entry that gated the sheet put removing its code out of
            // scope, so the builder stays whole and revivable.
            expect(src).toMatch(/function buildBottomSheet\(deps\)/);
            expect(src).toMatch(/bottomSheet\.id\s*=\s*['"]bottomSheet['"]/);
            expect(src).toMatch(/sheetSwipeZone\.className\s*=\s*['"]sheetSwipeZone['"]/);
        });
    });
});
