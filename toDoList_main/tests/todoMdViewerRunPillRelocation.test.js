import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { placeViewerCard, dismissDesktopTodoViewer } from '../src/todoMdViewer.js';

// While a run is QUEUED/RUNNING the viewer swaps the Run backlog button out for
// the `.todoMdViewerRunPill` status pill, which then occupies that button's slot
// in the card meta. The pill therefore has to ride the same mobile↔desktop
// relocation the other action controls do: mobile→desktop moves it into the rail
// strip (the in-list card is hidden right after), and desktop→mobile moves it
// back into the meta before the strip is removed. Miss either direction and an
// in-flight run loses its only status indicator until the run settles.

const realInnerWidth = window.innerWidth;
function setWidth(w) {
    Object.defineProperty(window, 'innerWidth', { value: w, configurable: true, writable: true });
}

// A stand-in viewer card carrying the run pill in the Run backlog button's slot,
// mirroring the post-dispatch DOM (the button is detached by the swap, so only
// one of the two is ever mounted).
function makeCardWithRunPill() {
    const card = document.createElement('div');
    card.id = 'todoMdViewerCard';
    card.className = 'todoMdViewerCard';
    card.dataset.projectName = 'proj';

    const header = document.createElement('div');
    header.className = 'todoMdViewerHeader';
    const meta = document.createElement('div');
    meta.className = 'todoMdViewerMeta';
    ['todoMdViewerSynced', 'todoMdViewerRunPill', 'todoMdViewerDeployPill',
     'todoMdViewerSyncBtn', 'todoMdViewerOverflowWrap'].forEach(function(cls) {
        const el = document.createElement('span');
        el.className = cls;
        meta.appendChild(el);
    });
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'todoMdViewerCollapseBtn';
    meta.appendChild(collapseBtn);
    header.appendChild(meta);

    const body = document.createElement('div');
    body.className = 'todoMdViewerBody';

    card.appendChild(header);
    card.appendChild(body);
    return card;
}

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

    document.body.appendChild(mainBar);
    document.body.appendChild(pane);
    return { mainBar, mainList, pane };
}

describe('TODO.md viewer — run pill survives the mobile↔desktop relocation', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        setWidth(1280);
        dismissDesktopTodoViewer();
    });
    afterEach(() => {
        dismissDesktopTodoViewer();
        setWidth(realInnerWidth);
        document.body.innerHTML = '';
    });

    it('mobile→desktop moves the run pill into the rail strip, not the hidden card', () => {
        const { mainList } = mountDesktopShell();
        const card = makeCardWithRunPill();
        const pill = card.querySelector('.todoMdViewerRunPill');

        placeViewerCard(card, mainList);

        const strip = document.getElementById('todoMdViewerStrip');
        const actions = strip.querySelector('.todoMdViewerStripActions');
        expect(actions.querySelector('.todoMdViewerRunPill')).toBe(pill);
        // Same element, not a rebuild — the poll timer and click handler close
        // over this node.
        expect(card.querySelector('.todoMdViewerMeta .todoMdViewerRunPill')).toBeNull();
        // The card is hidden on desktop, so a stranded pill would be invisible.
        expect(card.hidden).toBe(true);
    });

    it('desktop→mobile returns the run pill to the card meta before the strip is dropped', () => {
        const { mainList } = mountDesktopShell();
        const card = makeCardWithRunPill();
        const pill = card.querySelector('.todoMdViewerRunPill');

        placeViewerCard(card, mainList);
        setWidth(800);
        placeViewerCard(card, mainList);

        expect(document.getElementById('todoMdViewerStrip')).toBeNull();
        const meta = card.querySelector('.todoMdViewerMeta');
        expect(meta.querySelector('.todoMdViewerRunPill')).toBe(pill);
        // Restored ahead of the collapse chevron, matching the original meta order.
        expect(pill.nextSibling.className).toBe('todoMdViewerDeployPill');
        expect(card.hidden).toBe(false);
    });
});
