import { vi } from 'vitest';

// The per-project lifecycle SHAPE feature: new projects seed the Iterative
// board stage set (North star / Now / Next / Later) and record
// `lifecycle: 'iterative'`, while the Spec set (Why / Concept / Requirements /
// Design / Build plan) stays available under `lifecycle: 'spec'`. A shared
// resolver maps the stages to their actionable "task source" stage — 'Now' for
// the Iterative board, 'Build plan' for Spec, and 'Next up' for legacy
// Iterative projects — and the Conceive view + the Generate-tasks modal both
// target that stage instead of assuming 'Build plan'.
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
    actionableStageLabelForStages,
    BOARD_ACTIONABLE_LABEL,
    ITERATIVE_ACTIONABLE_LABEL,
    SPEC_ACTIONABLE_LABEL,
} from '../src/conceiveShapes.js';
import { openSeedTasksModal } from '../src/seedTasksModal.js';
import { chatWithWorker } from '../src/inject.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick();
}

const BOARD = ['North star', 'Now', 'Next', 'Later'];
const LEGACY_ITERATIVE = ['Why', 'Concept', 'Next up', 'Iterations'];
const SPEC = ['Why', 'Concept', 'Requirements', 'Design', 'Build plan'];

// A Spec-shaped project entry for replaceAllProjects — addProject only ever
// seeds the Iterative board default, so the Spec shape is constructed
// explicitly.
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

// A legacy Iterative project persisted with the old Why / Concept / Next up /
// Iterations stages (never reseeded to the board).
function legacyIterativeEntry(name) {
    return {
        name: name,
        items: [],
        lifecycle: 'iterative',
        stages: LEGACY_ITERATIVE.map(function (label, i) {
            return { id: name + '-st-' + i, label: label, body: '' };
        }),
    };
}

beforeEach(() => {
    listLogic._reset();
    chatWithWorker.mockClear();
});

describe('conceiveShapes — actionable stage resolver', () => {
    it('resolves the Iterative board lifecycle to "Now"', () => {
        expect(actionableStageLabel('iterative')).toBe('Now');
        expect(BOARD_ACTIONABLE_LABEL).toBe('Now');
    });

    it('resolves Spec projects to "Build plan"', () => {
        expect(actionableStageLabel('spec')).toBe('Build plan');
        expect(SPEC_ACTIONABLE_LABEL).toBe('Build plan');
    });

    it('treats the legacy "SDLC" label as Spec, so existing projects still resolve "Build plan"', () => {
        expect(actionableStageLabel('SDLC')).toBe('Build plan');
    });

    it('defaults to the Iterative board "Now" for an unset or unknown shape', () => {
        expect(actionableStageLabel(undefined)).toBe('Now');
        expect(actionableStageLabel(null)).toBe('Now');
        expect(actionableStageLabel('something-else')).toBe('Now');
    });

    it('resolves by the labels present: board → "Now", legacy → "Next up", spec → "Build plan"', () => {
        const board = BOARD.map((l) => ({ label: l }));
        const legacy = LEGACY_ITERATIVE.map((l) => ({ label: l }));
        const spec = SPEC.map((l) => ({ label: l }));
        expect(actionableStageLabelForStages(board, 'iterative')).toBe('Now');
        expect(actionableStageLabelForStages(legacy, 'iterative')).toBe('Next up');
        expect(actionableStageLabelForStages(spec, 'spec')).toBe('Build plan');
        expect(ITERATIVE_ACTIONABLE_LABEL).toBe('Next up');
    });

    it('falls back to the lifecycle map when no known actionable label is present', () => {
        const custom = [{ label: 'Alpha' }, { label: 'Beta' }];
        expect(actionableStageLabelForStages(custom, 'spec')).toBe('Build plan');
        expect(actionableStageLabelForStages(custom, 'iterative')).toBe('Now');
    });
});

describe('listLogic — new projects default to the Iterative board shape', () => {
    it('seeds the four Iterative board stages plus lifecycle "iterative"', () => {
        listLogic.addProject('Fresh');
        expect(listLogic.getProjectStages('Fresh').map((s) => s.label)).toEqual(BOARD);
        expect(listLogic.getProjectLifecycle('Fresh')).toBe('iterative');
    });

    it('keeps an existing Spec-shaped project intact (no reseed, no migration)', () => {
        listLogic.replaceAllProjects([specEntry('Legacy')]);
        expect(listLogic.getProjectStages('Legacy').map((s) => s.label)).toEqual(SPEC);
        expect(listLogic.getProjectLifecycle('Legacy')).toBe('spec');
    });

    it('keeps a legacy Iterative project intact (no reseed to the board)', () => {
        listLogic.replaceAllProjects([legacyIterativeEntry('OldIter')]);
        expect(listLogic.getProjectStages('OldIter').map((s) => s.label)).toEqual(LEGACY_ITERATIVE);
        expect(listLogic.getProjectLifecycle('OldIter')).toBe('iterative');
    });
});

describe('Generate tasks — decomposes the shape-correct stage', () => {
    it('targets "Now" as the task source for an Iterative board project', async () => {
        listLogic.addProject('Iter');
        const now = listLogic.getProjectStages('Iter').find((s) => s.label === 'Now');
        listLogic.setProjectStageBody('Iter', now.id, 'Ship the import flow.');

        openSeedTasksModal('Iter');
        await flush();

        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        const prompt = chatWithWorker.mock.calls[0][0][0].content;
        expect(prompt).toContain('Ship the import flow.');
        expect(prompt).toContain('Now (the ONLY source of tasks)');
        expect(prompt).toMatch(/ONLY from the Now/i);
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
