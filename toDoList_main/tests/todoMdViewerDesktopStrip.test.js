import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
    placeViewerCard,
    dismissDesktopTodoViewer,
    refreshViewerExpandedHeight,
} from '../src/todoMdViewer.js';

// Desktop TODO.md viewer: at ≥1024px (with a detail pane host present) the card
// body relocates into #descDetailPane and a compact strip pins at the top of the
// queue rail (#mainBar, above #taskFilterBar). Below the breakpoint — or with no
// detail pane — the card mounts in-list before #projectsGhostSpacer exactly as
// before. These tests exercise placeViewerCard's placement branch and the
// expand → close cycle that must restore the previously open task.

const realInnerWidth = window.innerWidth;
function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

// A stand-in for the real viewer card carrying only the structure the desktop
// placement path reads: the meta group with the relocatable action controls, the
// collapse chevron that stays behind, the pane close control, and a body.
function makeCard() {
    const card = document.createElement('div');
    card.id = 'todoMdViewerCard';
    card.className = 'todoMdViewerCard';
    card.dataset.projectName = 'proj';

    const header = document.createElement('div');
    header.className = 'todoMdViewerHeader';
    const meta = document.createElement('div');
    meta.className = 'todoMdViewerMeta';
    ['todoMdViewerSynced', 'todoMdViewerRunBtn', 'todoMdViewerDeployPill',
     'todoMdViewerSyncBtn', 'todoMdViewerOverflowWrap'].forEach(function(cls) {
        const el = document.createElement('span');
        el.className = cls;
        meta.appendChild(el);
    });
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'todoMdViewerCollapseBtn';
    meta.appendChild(collapseBtn);
    header.appendChild(meta);

    const closeBtn = document.createElement('button');
    closeBtn.className = 'todoMdViewerPaneCloseBtn';
    header.appendChild(closeBtn);

    const body = document.createElement('div');
    body.className = 'todoMdViewerBody';

    card.appendChild(header);
    card.appendChild(body);
    return card;
}

// The desktop queue rail: #mainBar with the filter pills and mainList inside.
function mountDesktopShell() {
    const mainBar = document.createElement('div');
    mainBar.id = 'mainBar';
    const filterBar = document.createElement('div');
    filterBar.id = 'taskFilterBar';
    const mainList = document.createElement('div');
    mainList.id = 'mainList';
    const spacer = document.createElement('div');
    spacer.id = 'projectsGhostSpacer';
    mainList.appendChild(spacer);
    mainBar.appendChild(filterBar);
    mainBar.appendChild(mainList);

    const pane = document.createElement('div');
    pane.id = 'descDetailPane';
    const empty = document.createElement('div');
    empty.className = 'descDetailEmpty';
    pane.appendChild(empty);

    document.body.appendChild(mainBar);
    document.body.appendChild(pane);
    return { mainBar, filterBar, mainList, spacer, pane, empty };
}

// A stand-in for an open task's panel already occupying the detail pane, carrying
// the __ownerRow.__item back-pointer the real pane header/derivation read.
function mountOpenTask(pane, id) {
    const panel = document.createElement('div');
    panel.id = 'descSibling';
    panel.__ownerRow = { __item: { id, tit: 'Task ' + id } };
    pane.appendChild(panel);
    return panel;
}

describe('TODO.md viewer — desktop rail strip placement', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        setWidth(1280);
        // Reset the module-level expanded flag between tests.
        dismissDesktopTodoViewer();
    });
    afterEach(() => {
        dismissDesktopTodoViewer();
        setWidth(realInnerWidth);
        document.body.innerHTML = '';
    });

    it('above the breakpoint pins the strip in the rail and relocates the card into the pane', () => {
        const { mainBar, filterBar, pane, mainList } = mountDesktopShell();
        const card = makeCard();

        placeViewerCard(card, mainList);

        const strip = document.getElementById('todoMdViewerStrip');
        expect(strip).toBeTruthy();
        // Strip sits in the rail, directly above the filter pills.
        expect(strip.parentNode).toBe(mainBar);
        expect(strip.nextSibling).toBe(filterBar);
        // Card body lives in the detail pane, not the list.
        expect(card.parentNode).toBe(pane);
        expect(mainList.querySelector('#todoMdViewerCard')).toBeNull();
        // Collapsed by default — the card yields the pane until expanded.
        expect(card.hidden).toBe(true);
        // The action controls moved into the strip; the collapse chevron stayed.
        const actions = strip.querySelector('.todoMdViewerStripActions');
        expect(actions.querySelector('.todoMdViewerRunBtn')).toBeTruthy();
        expect(actions.querySelector('.todoMdViewerSyncBtn')).toBeTruthy();
        expect(actions.querySelector('.todoMdViewerOverflowWrap')).toBeTruthy();
        expect(card.querySelector('.todoMdViewerMeta .todoMdViewerRunBtn')).toBeNull();
        expect(card.querySelector('.todoMdViewerMeta .todoMdViewerCollapseBtn')).toBeTruthy();
    });

    it('below the breakpoint mounts the card in-list before the ghost spacer, no strip', () => {
        const { mainList, spacer } = mountDesktopShell();
        setWidth(800);
        const card = makeCard();

        placeViewerCard(card, mainList);

        expect(document.getElementById('todoMdViewerStrip')).toBeNull();
        expect(card.parentNode).toBe(mainList);
        expect(card.nextSibling).toBe(spacer);
    });

    it('with no detail pane host, stays in-list even at desktop width', () => {
        // No #descDetailPane → isViewerDesktopMode() is false, mirroring the
        // pane-presence gate that keeps bare unit DOM on the in-list path.
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        const spacer = document.createElement('div');
        spacer.id = 'projectsGhostSpacer';
        mainList.appendChild(spacer);
        document.body.appendChild(mainList);
        const card = makeCard();

        placeViewerCard(card, mainList);

        expect(document.getElementById('todoMdViewerStrip')).toBeNull();
        expect(card.parentNode).toBe(mainList);
    });

    it('expanding stashes the open task, and closing restores the previously open task id', () => {
        const { pane, mainList } = mountDesktopShell();
        const openPanel = mountOpenTask(pane, 'task-42');
        const card = makeCard();

        placeViewerCard(card, mainList);
        expect(card.hidden).toBe(true);
        // The open task is visible before expansion.
        expect(openPanel.style.display).not.toBe('none');

        // Expand via the strip's name toggle.
        const nameBtn = document.querySelector('.todoMdViewerStripName');
        nameBtn.click();
        expect(card.hidden).toBe(false);
        // The previously open task is stashed (hidden, not unmounted).
        expect(openPanel.parentNode).toBe(pane);
        expect(openPanel.style.display).toBe('none');
        expect(nameBtn.getAttribute('aria-expanded')).toBe('true');

        // Close via the same toggle — the previously open task returns intact.
        nameBtn.click();
        expect(card.hidden).toBe(true);
        expect(openPanel.style.display).toBe('');
        expect(openPanel.__ownerRow.__item.id).toBe('task-42');
        expect(nameBtn.getAttribute('aria-expanded')).toBe('false');
    });

    it('dismissDesktopTodoViewer collapses an expanded viewer and restores the task', () => {
        const { pane, mainList } = mountDesktopShell();
        const openPanel = mountOpenTask(pane, 'task-7');
        const card = makeCard();
        placeViewerCard(card, mainList);
        document.querySelector('.todoMdViewerStripName').click();
        expect(card.hidden).toBe(false);
        expect(openPanel.style.display).toBe('none');

        dismissDesktopTodoViewer();

        expect(card.hidden).toBe(true);
        expect(openPanel.style.display).toBe('');
    });

    it('expanding into the pane clears a stale in-list body height', () => {
        const { mainList } = mountDesktopShell();
        const card = makeCard();
        placeViewerCard(card, mainList);
        const body = card.querySelector('.todoMdViewerBody');
        // Simulate the in-list expand path having stamped a #mainList-relative
        // pixel height on the body before the card relocated into the pane.
        body.style.height = '240px';

        // Expand via the strip's name toggle → the card takes the pane.
        document.querySelector('.todoMdViewerStripName').click();

        expect(card.hidden).toBe(false);
        // The stale rail-sized height is cleared so the pane's own flex sizing
        // fills the body rather than pinning it short with dead space below.
        expect(body.style.height).toBe('');
    });

    it('refreshViewerExpandedHeight is a no-op while the card lives in the pane', () => {
        const { mainList } = mountDesktopShell();
        const card = makeCard();
        placeViewerCard(card, mainList);
        // Card is in the pane; the list-relative height computation must not run
        // (and must not throw when there is no expanded in-list card).
        expect(() => refreshViewerExpandedHeight()).not.toThrow();
        expect(card.querySelector('.todoMdViewerBody').style.height).toBe('');
    });
});
