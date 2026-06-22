import { vi } from 'vitest';

// The per-project lifecycle SHAPE feature: new projects seed the Iterative
// stage set (Why / Concept / Next up / Iterations) and record
// `lifecycle: 'iterative'`, while the Spec set (Why / Concept / Requirements /
// Design / Build plan) stays available under `lifecycle: 'spec'`. A shared
// resolver maps a shape to its actionable "task source" stage — 'Next up' for
// Iterative, 'Build plan' for Spec — and the Conceive view + the Generate-tasks
// modal both target that stage instead of assuming 'Build plan'.
//
// These tests exercise the real listLogic, the real conceiveShapes resolver,
// and the real Conceive view / seed-tasks modal; only the Worker chat call is
// mocked so nothing reaches the network.

vi.mock('../src/inject.js', () => ({
    chatWithWorker: vi.fn(() => Promise.resolve({ reply: '[]' })),
}));

import { listLogic } from '../src/listLogic.js';
import {
    actionableStageLabel,
    ITERATIVE_ACTIONABLE_LABEL,
    SPEC_ACTIONABLE_LABEL,
} from '../src/conceiveShapes.js';
import { renderConceiveView } from '../src/conceiveView.js';
import { openSeedTasksModal } from '../src/seedTasksModal.js';
import { chatWithWorker } from '../src/inject.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick();
}

const ITERATIVE = ['Why', 'Concept', 'Next up', 'Iterations'];
const SPEC = ['Why', 'Concept', 'Requirements', 'Design', 'Build plan'];

// A Spec-shaped project entry for replaceAllProjects — addProject only ever
// seeds the Iterative default, so the Spec shape is constructed explicitly.
function specEntry(name) {
    return {
        name: name,
        items: [],
        lifecycle: 'spec',
        stages: SPEC.map(function (label, i) {
            return { id: name + '-st-' + i, label: label, body: '' };
        }),
    };
}

function mountDom(projectName) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>' +
        '<div id="conceiveView"></div>';
}

// The label of the stage that owns the Generate-tasks / Suggest-plan actions.
function actionableStageLabelInDom() {
    const btn = document.querySelector('.conceiveGenerateTasksBtn');
    if (!btn) return null;
    const section = btn.closest('.conceiveStage');
    return section.querySelector('.conceiveStageLabel').textContent;
}

beforeEach(() => {
    listLogic._reset();
    chatWithWorker.mockClear();
});

describe('conceiveShapes — actionable stage resolver', () => {
    it('resolves Iterative projects to "Next up"', () => {
        expect(actionableStageLabel('iterative')).toBe('Next up');
        expect(ITERATIVE_ACTIONABLE_LABEL).toBe('Next up');
    });

    it('resolves Spec projects to "Build plan"', () => {
        expect(actionableStageLabel('spec')).toBe('Build plan');
        expect(SPEC_ACTIONABLE_LABEL).toBe('Build plan');
    });

    it('treats the legacy "SDLC" label as Spec, so existing projects still resolve "Build plan"', () => {
        expect(actionableStageLabel('SDLC')).toBe('Build plan');
    });

    it('defaults to the Iterative "Next up" for an unset or unknown shape', () => {
        expect(actionableStageLabel(undefined)).toBe('Next up');
        expect(actionableStageLabel(null)).toBe('Next up');
        expect(actionableStageLabel('something-else')).toBe('Next up');
    });
});

describe('listLogic — new projects default to the Iterative shape', () => {
    it('seeds the four Iterative stages plus lifecycle "iterative"', () => {
        listLogic.addProject('Fresh');
        expect(listLogic.getProjectStages('Fresh').map((s) => s.label)).toEqual(ITERATIVE);
        expect(listLogic.getProjectLifecycle('Fresh')).toBe('iterative');
    });

    it('keeps an existing Spec-shaped project intact (no reseed, no migration)', () => {
        listLogic.replaceAllProjects([specEntry('Legacy')]);
        expect(listLogic.getProjectStages('Legacy').map((s) => s.label)).toEqual(SPEC);
        expect(listLogic.getProjectLifecycle('Legacy')).toBe('spec');
    });
});

describe('Conceive view — actionable stage is shape-aware', () => {
    it('puts the Generate-tasks / Suggest-plan actions on "Next up" for an Iterative project', () => {
        listLogic.addProject('Iter');
        mountDom('Iter');
        renderConceiveView();

        expect(actionableStageLabelInDom()).toBe('Next up');
        expect(document.querySelector('.conceiveSuggestPlanBtn')).toBeTruthy();
    });

    it('puts the actions on "Build plan" for a Spec project', () => {
        listLogic.replaceAllProjects([specEntry('Spec')]);
        mountDom('Spec');
        renderConceiveView();

        expect(actionableStageLabelInDom()).toBe('Build plan');
        expect(document.querySelector('.conceiveSuggestPlanBtn')).toBeTruthy();
    });
});

describe('Conceive view — hints for the Iterative stages', () => {
    it('renders guidance under "Next up" and "Iterations"', () => {
        listLogic.addProject('Iter');
        mountDom('Iter');
        renderConceiveView();

        const hintFor = (label) => {
            const sections = [...document.querySelectorAll('.conceiveStage')];
            const section = sections.find(
                (s) => s.querySelector('.conceiveStageLabel').textContent === label
            );
            return section ? section.querySelector('.conceiveStageHint') : null;
        };

        expect(hintFor('Next up')).not.toBeNull();
        expect(hintFor('Next up').textContent).toMatch(/each line becomes a task/i);
        expect(hintFor('Iterations')).not.toBeNull();
        expect(hintFor('Iterations').textContent).toMatch(/added, removed/i);
    });
});

describe('Generate tasks — decomposes the shape-correct stage', () => {
    it('targets "Next up" as the task source for an Iterative project', async () => {
        listLogic.addProject('Iter');
        const nextUp = listLogic.getProjectStages('Iter').find((s) => s.label === 'Next up');
        listLogic.setProjectStageBody('Iter', nextUp.id, 'Ship the import flow.');

        openSeedTasksModal('Iter');
        await flush();

        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        const prompt = chatWithWorker.mock.calls[0][0][0].content;
        expect(prompt).toContain('Ship the import flow.');
        expect(prompt).toContain('Next up (the ONLY source of tasks)');
        expect(prompt).toMatch(/ONLY from the Next up/i);
    });

    it('targets "Build plan" as the task source for a Spec project', async () => {
        listLogic.replaceAllProjects([specEntry('Spec')]);
        const buildPlan = listLogic.getProjectStages('Spec').find((s) => s.label === 'Build plan');
        listLogic.setProjectStageBody('Spec', buildPlan.id, 'Wire up the API.');

        openSeedTasksModal('Spec');
        await flush();

        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        const prompt = chatWithWorker.mock.calls[0][0][0].content;
        expect(prompt).toContain('Wire up the API.');
        expect(prompt).toContain('Build plan (the ONLY source of tasks)');
        expect(prompt).toMatch(/ONLY from the Build plan/i);
    });
});
