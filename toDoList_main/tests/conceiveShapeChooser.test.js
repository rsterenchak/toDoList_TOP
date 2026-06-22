import { vi } from 'vitest';

// The one-time Iterative | Spec shape chooser in the Conceive view. While a
// project's stages are still pristine (every stage body empty), a segmented
// Iterative | Spec control appears above the stages; tapping the inactive
// option reseeds the project's stages to that shape and sets its lifecycle.
// The moment any stage has text the chooser disappears and the shape is locked,
// so switching is non-destructive by construction.
//
// These tests exercise the real listLogic and the real Conceive view; only the
// Worker chat call is mocked so nothing reaches the network.

vi.mock('../src/inject.js', () => ({
    chatWithWorker: vi.fn(() => Promise.resolve({ reply: '[]' })),
}));

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { listLogic } from '../src/listLogic.js';
import { renderConceiveView } from '../src/conceiveView.js';

const here = dirname(fileURLToPath(import.meta.url));
const LIST_LOGIC_SRC = readFileSync(resolve(here, '../src/listLogic.js'), 'utf8');

// Pull the body of a top-level function declaration so a per-function
// assertion can inspect only that region. Mirrors the helper in
// listLogicSupabase.test.js — the Supabase layer is session-gated, so wiring
// is pinned at the source level rather than with a runtime spy.
function functionBody(src, name) {
    const declRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const match = declRe.exec(src);
    if (!match) return null;
    const openBrace = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = openBrace; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(openBrace + 1, i);
        }
    }
    return null;
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

// A legacy-shaped project persisted under the old 'SDLC' label.
function legacyEntry(name) {
    return {
        name: name,
        items: [],
        lifecycle: 'SDLC',
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

function chooser() {
    return document.querySelector('.conceiveShapeChooser');
}

function optionLabeled(label) {
    return [...document.querySelectorAll('.conceiveShapeOption')].find(
        (b) => b.textContent === label
    );
}

function stageLabels() {
    return [...document.querySelectorAll('.conceiveStageLabel')].map((s) => s.textContent);
}

beforeEach(() => {
    listLogic._reset();
});

describe('Conceive shape chooser — pristine detection', () => {
    it('renders the chooser when every stage body is empty', () => {
        listLogic.addProject('Fresh');
        mountDom('Fresh');
        renderConceiveView();

        expect(chooser()).toBeTruthy();
        expect(optionLabeled('Iterative')).toBeTruthy();
        expect(optionLabeled('Spec')).toBeTruthy();
    });

    it('hides the chooser the moment any stage body has text', () => {
        listLogic.addProject('Started');
        const nextUp = listLogic.getProjectStages('Started').find((s) => s.label === 'Next up');
        listLogic.setProjectStageBody('Started', nextUp.id, 'Ship the import flow.');

        mountDom('Started');
        renderConceiveView();

        expect(chooser()).toBeNull();
    });

    it('treats whitespace-only bodies as still pristine', () => {
        listLogic.addProject('Spaces');
        const why = listLogic.getProjectStages('Spaces').find((s) => s.label === 'Why');
        listLogic.setProjectStageBody('Spaces', why.id, '   \n  ');

        mountDom('Spaces');
        renderConceiveView();

        expect(chooser()).toBeTruthy();
    });
});

describe('Conceive shape chooser — active state reflects the shape', () => {
    it('shows Iterative active for a new (Iterative-default) project', () => {
        listLogic.addProject('Iter');
        mountDom('Iter');
        renderConceiveView();

        expect(optionLabeled('Iterative').classList.contains('active')).toBe(true);
        expect(optionLabeled('Spec').classList.contains('active')).toBe(false);
    });

    it('shows Spec active for a Spec-shaped project', () => {
        listLogic.replaceAllProjects([specEntry('Spec')]);
        mountDom('Spec');
        renderConceiveView();

        expect(optionLabeled('Spec').classList.contains('active')).toBe(true);
        expect(optionLabeled('Iterative').classList.contains('active')).toBe(false);
    });

    it('shows Spec active for a legacy "SDLC" project', () => {
        listLogic.replaceAllProjects([legacyEntry('Legacy')]);
        mountDom('Legacy');
        renderConceiveView();

        expect(chooser()).toBeTruthy();
        expect(optionLabeled('Spec').classList.contains('active')).toBe(true);
    });
});

describe('Conceive shape chooser — switching reseeds and persists', () => {
    it('switching to Spec replaces the stages with the Spec seed and sets lifecycle "spec"', () => {
        listLogic.addProject('Iter');
        mountDom('Iter');
        renderConceiveView();

        optionLabeled('Spec').click();

        expect(listLogic.getProjectLifecycle('Iter')).toBe('spec');
        expect(listLogic.getProjectStages('Iter').map((s) => s.label)).toEqual(SPEC);
        // The view re-rendered to the new shape and the chooser is still present
        // (still pristine), now with Spec active.
        expect(stageLabels()).toEqual(SPEC);
        expect(chooser()).toBeTruthy();
        expect(optionLabeled('Spec').classList.contains('active')).toBe(true);
    });

    it('switching back to Iterative restores the Iterative seed and lifecycle', () => {
        listLogic.replaceAllProjects([specEntry('Spec')]);
        mountDom('Spec');
        renderConceiveView();

        optionLabeled('Iterative').click();

        expect(listLogic.getProjectLifecycle('Spec')).toBe('iterative');
        expect(listLogic.getProjectStages('Spec').map((s) => s.label)).toEqual(ITERATIVE);
        expect(stageLabels()).toEqual(ITERATIVE);
    });

    it('tapping the already-active option does nothing (no reseed)', () => {
        listLogic.addProject('Iter');
        const stagesBefore = listLogic.getProjectStages('Iter').map((s) => s.id);
        mountDom('Iter');
        renderConceiveView();

        optionLabeled('Iterative').click();

        // Stage ids unchanged — the active option carries no click handler.
        expect(listLogic.getProjectStages('Iter').map((s) => s.id)).toEqual(stagesBefore);
        expect(listLogic.getProjectLifecycle('Iter')).toBe('iterative');
    });
});

describe('listLogic.setProjectShape', () => {
    it('replaces stages with fresh ids and empty bodies for the chosen shape', () => {
        listLogic.addProject('P');
        const idsBefore = listLogic.getProjectStages('P').map((s) => s.id);

        listLogic.setProjectShape('P', 'spec');

        const after = listLogic.getProjectStages('P');
        expect(after.map((s) => s.label)).toEqual(SPEC);
        expect(after.every((s) => s.body === '')).toBe(true);
        // Fresh ids — not reused from the previous shape's stages.
        expect(after.some((s) => idsBefore.includes(s.id))).toBe(false);
        expect(listLogic.getProjectLifecycle('P')).toBe('spec');
    });

    it('canonicalizes a legacy "SDLC" shape argument to "spec"', () => {
        listLogic.addProject('P');
        listLogic.setProjectShape('P', 'SDLC');
        expect(listLogic.getProjectLifecycle('P')).toBe('spec');
        expect(listLogic.getProjectStages('P').map((s) => s.label)).toEqual(SPEC);
    });

    it('is a no-op for an unknown project', () => {
        expect(listLogic.setProjectShape('Nope', 'spec')).toBeNull();
    });

    // Source-level pin (the Supabase layer is session-gated, so the mirror is
    // verified at the source the same way listLogicSupabase.test.js does):
    // the reseed routes through persistMutation against the projects row.
    it('mirrors the reseed to Supabase via a projects-row persistMutation update', () => {
        const body = functionBody(LIST_LOGIC_SRC, 'setProjectShape');
        expect(body, 'setProjectShape not found in listLogic.js').toBeTruthy();
        expect(body).toMatch(/persistMutation\s*\(/);
        expect(body).toMatch(/toProjectRowPayload\s*\(/);
        expect(body).toMatch(/saveToStorage\s*\(/);
    });
});
