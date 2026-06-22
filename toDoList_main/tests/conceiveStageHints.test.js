import { vi } from 'vitest';

// The Conceive view renders a persistent, display-only guidance prompt under
// each default SDLC stage's label (Why / Concept / Requirements / Design /
// Build plan). These tests drive renderConceiveView against a jsdom DOM with
// the collaborators mocked, and assert that:
//   • each default stage renders its mapped prompt text under the label,
//   • a stage whose label has no mapping renders no hint,
//   • the prompt text is purely presentational — not written to the stage
//     body, not sent through setProjectStageBody, and not sent to Claude.
const { state } = vi.hoisted(() => ({
    state: {
        stages: [],
        bodyWrites: [],
    },
}));

vi.mock('../src/inject.js', () => ({
    chatWithWorker: vi.fn(() => Promise.resolve({ reply: '' })),
}));

vi.mock('../src/seedTasksModal.js', () => ({
    openSeedTasksModal: vi.fn(),
}));

vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        getProjectStages: function () { return state.stages; },
        getProjectLifecycle: function () { return 'SDLC'; },
        setProjectStageBody: vi.fn(function (project, stageId, text) {
            state.bodyWrites.push({ stageId, text });
            const stage = state.stages.find(function (s) { return s.id === stageId; });
            if (stage) stage.body = text;
        }),
    },
}));

import { renderConceiveView } from '../src/conceiveView.js';
import { chatWithWorker } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

function makeStage(label, body) {
    return { id: 'id-' + label, label: label, body: body || '' };
}

function mountDom(projectName) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>' +
        '<div id="conceiveView"></div>';
}

const hintFor = (label) =>
    document.querySelector('[data-stage-id="id-' + label + '"] .conceiveStageHint');

const EXPECTED = {
    'Why': 'Who is it for, and what problem does it solve?',
    'Concept': 'In a sentence or two, what is it and how does it work?',
    'Requirements': "What must it do? Key capabilities, constraints, and what's out of scope.",
    'Design': 'How does it look and work — UI, data model, and tech choices?',
    'Build plan': 'The ordered steps to build it; each line becomes a task.',
};

beforeEach(() => {
    state.bodyWrites = [];
    state.stages = [
        makeStage('Why', ''),
        makeStage('Concept', 'A focused planner.'),
        makeStage('Requirements', ''),
        makeStage('Design', ''),
        makeStage('Build plan', ''),
    ];
    chatWithWorker.mockClear();
    listLogic.setProjectStageBody.mockClear();
    mountDom('Proj');
});

describe('Conceive stage hints', () => {
    it('renders the mapped prompt text under each default stage label', () => {
        renderConceiveView();
        Object.keys(EXPECTED).forEach(function (label) {
            const hint = hintFor(label);
            expect(hint, 'hint for ' + label).not.toBeNull();
            expect(hint.textContent).toBe(EXPECTED[label]);
        });
    });

    it('shows the prompt whether the field is empty or has content', () => {
        // "Concept" has content in the fixture; "Why" is empty. Both still show.
        renderConceiveView();
        expect(hintFor('Why')).not.toBeNull();
        expect(hintFor('Concept')).not.toBeNull();
    });

    it('renders no hint for a stage whose label is not in the map', () => {
        state.stages = [
            makeStage('Why', ''),
            makeStage('Custom phase', ''),
        ];
        mountDom('Proj');
        renderConceiveView();
        expect(hintFor('Why')).not.toBeNull();
        expect(hintFor('Custom phase')).toBeNull();
    });

    it('is purely presentational — never written to the stage body or synced', () => {
        renderConceiveView();
        // Rendering hints triggers no model writes...
        expect(listLogic.setProjectStageBody).not.toHaveBeenCalled();
        expect(state.bodyWrites).toEqual([]);
        // ...and no stage body contains the guidance copy.
        state.stages.forEach(function (s) {
            const hintText = EXPECTED[s.label];
            if (hintText) expect(s.body).not.toContain(hintText);
        });
    });

    it('never sends the guidance copy to Claude', () => {
        renderConceiveView();
        // No chat turn fires on render; the hints are static markup only.
        expect(chatWithWorker).not.toHaveBeenCalled();
    });
});
