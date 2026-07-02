import { vi } from 'vitest';

// The Iterative direction board renderer in the Conceive view: a one-line North
// star plus three lanes (Now / Next / Later) where each non-empty line of a
// lane body renders as a card, Next/Later cards promote up one lane, every lane
// has an Edit affordance that swaps its cards for the raw stage-body textarea,
// and a quick-capture input appends to Later. These drive renderConceiveView
// against the real listLogic; only the Worker chat call is mocked.

vi.mock('../src/inject.js', () => ({
    chatWithWorker: vi.fn(() => Promise.resolve({ reply: '[]' })),
}));

vi.mock('../src/seedTasksModal.js', () => ({
    openSeedTasksModal: vi.fn(),
    resolveProjectRepo: vi.fn(() => null),
}));

import { listLogic } from '../src/listLogic.js';
import { renderConceiveView } from '../src/conceiveView.js';

function mountDom(projectName) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>' +
        '<div id="conceiveView"></div>';
}

function laneEl(label) {
    return document.querySelector('.conceiveLane[data-lane="' + label + '"]');
}
function cardTexts(label) {
    return [...laneEl(label).querySelectorAll('.conceiveCardText')].map((n) => n.textContent);
}
function stageId(project, label) {
    return listLogic.getProjectStages(project).find((s) => s.label === label).id;
}

beforeEach(() => {
    listLogic._reset();
    listLogic.addProject('Board');
    mountDom('Board');
});

describe('Conceive board — cards render one per non-empty line', () => {
    it('renders each non-empty line of a lane body as a card, skipping blanks', () => {
        const nextId = stageId('Board', 'Next');
        listLogic.setProjectStageBody('Board', nextId, 'first\n\n  \nsecond');
        renderConceiveView();

        expect(cardTexts('Next')).toEqual(['first', 'second']);
    });

    it('shows an empty state for a lane with no lines', () => {
        renderConceiveView();
        expect(laneEl('Now').querySelector('.conceiveLaneEmpty')).toBeTruthy();
        expect(laneEl('Now').querySelector('.conceiveCard')).toBeNull();
    });
});

describe('Conceive board — quick capture appends to Later', () => {
    it('pressing Enter appends the text as a new Later line and renders it as a card', () => {
        renderConceiveView();
        const input = document.querySelector('.conceiveQuickCaptureInput');
        input.value = 'a fresh idea';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        // Persisted onto the Later stage body...
        const later = listLogic.getProjectStages('Board').find((s) => s.label === 'Later');
        expect(later.body).toBe('a fresh idea');
        // ...and rendered immediately as a Later card.
        expect(cardTexts('Later')).toEqual(['a fresh idea']);
    });

    it('appends to an existing Later body on its own line', () => {
        const laterId = stageId('Board', 'Later');
        listLogic.setProjectStageBody('Board', laterId, 'idea one');
        renderConceiveView();

        const input = document.querySelector('.conceiveQuickCaptureInput');
        input.value = 'idea two';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(listLogic.getProjectStages('Board').find((s) => s.label === 'Later').body)
            .toBe('idea one\nidea two');
        expect(cardTexts('Later')).toEqual(['idea one', 'idea two']);
    });

    it('ignores an empty capture', () => {
        renderConceiveView();
        const input = document.querySelector('.conceiveQuickCaptureInput');
        input.value = '   ';
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(listLogic.getProjectStages('Board').find((s) => s.label === 'Later').body).toBe('');
    });
});

describe('Conceive board — promote moves a card up one lane', () => {
    it('promotes a Later card to Next', () => {
        const laterId = stageId('Board', 'Later');
        listLogic.setProjectStageBody('Board', laterId, 'x\ny');
        renderConceiveView();

        const secondCard = [...laneEl('Later').querySelectorAll('.conceiveCard')][1];
        secondCard.querySelector('.conceiveCardPromoteBtn').click();

        expect(cardTexts('Later')).toEqual(['x']);
        expect(cardTexts('Next')).toEqual(['y']);
    });

    it('promotes a Next card to Now', () => {
        const nextId = stageId('Board', 'Next');
        listLogic.setProjectStageBody('Board', nextId, 'ship');
        renderConceiveView();

        laneEl('Next').querySelector('.conceiveCardPromoteBtn').click();

        expect(cardTexts('Next')).toEqual([]);
        expect(cardTexts('Now')).toEqual(['ship']);
    });

    it('gives the Now lane no promote control (it is the top lane)', () => {
        const nowId = stageId('Board', 'Now');
        listLogic.setProjectStageBody('Board', nowId, 'top task');
        renderConceiveView();

        expect(laneEl('Now').querySelector('.conceiveCardPromoteBtn')).toBeNull();
    });
});

describe('Conceive board — lane edit affordance', () => {
    it('swaps the cards for the raw stage-body textarea and back', () => {
        const nextId = stageId('Board', 'Next');
        listLogic.setProjectStageBody('Board', nextId, 'line one');
        renderConceiveView();

        // Card view by default.
        expect(laneEl('Next').querySelector('.conceiveLaneCards')).toBeTruthy();
        expect(laneEl('Next').querySelector('.conceiveLaneEditor')).toBeNull();

        // Toggle into edit mode.
        laneEl('Next').querySelector('.conceiveLaneEditBtn').click();
        const editor = laneEl('Next').querySelector('.conceiveLaneEditor');
        expect(editor).toBeTruthy();
        expect(editor.querySelector('textarea').value).toBe('line one');
        expect(laneEl('Next').querySelector('.conceiveLaneCards')).toBeNull();

        // Toggle back out.
        laneEl('Next').querySelector('.conceiveLaneEditBtn').click();
        expect(laneEl('Next').querySelector('.conceiveLaneEditor')).toBeNull();
        expect(laneEl('Next').querySelector('.conceiveLaneCards')).toBeTruthy();
    });
});
