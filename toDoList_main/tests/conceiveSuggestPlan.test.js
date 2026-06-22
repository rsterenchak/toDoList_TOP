import { vi } from 'vitest';

// The "Suggest plan" action on the Conceive view's Build-plan stage drafts the
// Build-plan body from the project's upstream stages (Why / Concept /
// Requirements / Design) via the in-app Claude chat path, writing the result
// inline. These tests drive renderConceiveView against a jsdom DOM with the
// collaborators mocked:
//   • chatWithWorker (inject.js) — captured so we can assert the outbound
//     prompt + deep flag and feed back a canned plan reply.
//   • listLogic (listLogic.js) — stubbed to supply stages and to spy on the
//     setProjectStageBody write path.
//   • seedTasksModal (seedTasksModal.js) — stubbed; the "Generate tasks"
//     sibling button is out of scope here.
const { state } = vi.hoisted(() => ({
    state: {
        reply: '1. Step one\n2. Step two',
        lastMessages: null,
        lastCall: null,
        stages: [],
        bodyWrites: [],
        repo: null,
    },
}));

vi.mock('../src/inject.js', () => ({
    chatWithWorker: vi.fn(function (messages, entryId, attach, repo, suggested, deep) {
        state.lastMessages = messages;
        state.lastCall = { messages, entryId, attach, repo, suggested, deep };
        return Promise.resolve({ reply: state.reply });
    }),
}));

vi.mock('../src/seedTasksModal.js', () => ({
    openSeedTasksModal: vi.fn(),
    // Suggest plan grounds its call in the project's linked repo via this
    // resolver; stub it to the canned repo for the active fixture.
    resolveProjectRepo: vi.fn(function () { return state.repo; }),
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

const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush(n = 4) {
    for (let i = 0; i < n; i++) await tick();
}

function makeStage(label, body) {
    return { id: 'id-' + label, label: label, body: body };
}

// Build the page scaffolding renderConceiveView reads: a selected-project
// sidebar row carrying #projInput, plus the #conceiveView container.
function mountDom(projectName) {
    document.body.innerHTML =
        '<div class="selectedProject"><input id="projInput" value="' + projectName + '"></div>' +
        '<div id="conceiveView"></div>';
}

const buildInput = () =>
    document.querySelector('[data-stage-id="id-Build plan"] .conceiveStageInput');
const suggestBtn = () => document.querySelector('.conceiveSuggestPlanBtn');

beforeEach(() => {
    state.reply = '1. Step one\n2. Step two';
    state.lastMessages = null;
    state.lastCall = null;
    state.bodyWrites = [];
    state.repo = null;
    state.stages = [
        makeStage('Why', 'To ship faster.'),
        makeStage('Concept', 'A focused planner.'),
        makeStage('Requirements', ''),
        makeStage('Design', ''),
        makeStage('Build plan', ''),
    ];
    chatWithWorker.mockClear();
    listLogic.setProjectStageBody.mockClear();
    mountDom('Proj');
});

describe('Suggest plan — enablement', () => {
    it('enables the button when at least one upstream stage has content', () => {
        renderConceiveView();
        expect(suggestBtn().disabled).toBe(false);
    });

    it('disables the button with a hint when all upstream stages are empty', () => {
        state.stages = [
            makeStage('Why', ''),
            makeStage('Concept', ''),
            makeStage('Requirements', ''),
            makeStage('Design', ''),
            makeStage('Build plan', ''),
        ];
        renderConceiveView();
        expect(suggestBtn().disabled).toBe(true);
        expect(suggestBtn().title).toMatch(/Fill in a stage/i);
    });
});

describe('Suggest plan — outbound prompt', () => {
    it('sends the non-empty upstream stages, the build-plan instruction, and the deep flag', async () => {
        renderConceiveView();
        suggestBtn().click();
        await flush();

        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        const prompt = state.lastMessages[0].content;

        // Non-empty upstream stages ride along; empty ones do not.
        expect(prompt).toContain('To ship faster.');
        expect(prompt).toContain('A focused planner.');
        expect(prompt).not.toMatch(/###\s+Requirements/);
        expect(prompt).not.toMatch(/###\s+Design/);
        // It asks for a concrete build plan as a numbered list.
        expect(prompt).toMatch(/build plan/i);
        expect(prompt).toMatch(/numbered list/i);

        // Never touches the live chat: undefined entryId, null repo. Synthesis
        // runs on the heavier model — the trailing deep flag is true.
        expect(state.lastCall.entryId).toBeUndefined();
        expect(state.lastCall.repo).toBeNull();
        expect(state.lastCall.deep).toBe(true);
    });

    it('passes the project linked repo as the repo arg when the project is linked', async () => {
        state.repo = 'owner/some-app';
        renderConceiveView();
        suggestBtn().click();
        await flush();

        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        expect(state.lastCall.repo).toBe('owner/some-app');
        expect(state.lastCall.deep).toBe(true);
    });
});

describe('Suggest plan — writes the reply into the Build-plan stage', () => {
    it('writes the parsed plan text via setProjectStageBody and shows the drafted footer', async () => {
        renderConceiveView();
        suggestBtn().click();
        await flush();

        expect(listLogic.setProjectStageBody).toHaveBeenCalledWith(
            'Proj', 'id-Build plan', '1. Step one\n2. Step two'
        );
        expect(buildInput().value).toBe('1. Step one\n2. Step two');
        expect(document.querySelector('.conceiveSuggestFooter')).toBeTruthy();
    });

    it('strips code fences the Worker may wrap around the plan', async () => {
        state.reply = '```\n1. Alpha\n2. Beta\n```';
        renderConceiveView();
        suggestBtn().click();
        await flush();

        expect(buildInput().value).toBe('1. Alpha\n2. Beta');
    });

    it('shows an inline error and leaves the body untouched on an empty reply', async () => {
        state.reply = '';
        renderConceiveView();
        suggestBtn().click();
        await flush();

        expect(document.querySelector('.conceiveSuggestError')).toBeTruthy();
        expect(listLogic.setProjectStageBody).not.toHaveBeenCalled();
        expect(buildInput().value).toBe('');
    });
});

describe('Suggest plan — overwrite confirm', () => {
    it('confirms before replacing a non-empty Build-plan body', async () => {
        state.stages[4].body = 'OLD plan';
        renderConceiveView();
        expect(buildInput().value).toBe('OLD plan');

        suggestBtn().click();
        await flush();

        // The call is gated behind the confirm.
        expect(document.querySelector('.conceiveSuggestConfirm')).toBeTruthy();
        expect(chatWithWorker).not.toHaveBeenCalled();

        // Confirming "Replace" fires the draft call.
        const replaceBtn = [...document.querySelectorAll('.conceiveSuggestLink')]
            .find((b) => b.textContent === 'Replace');
        replaceBtn.click();
        await flush();

        expect(chatWithWorker).toHaveBeenCalledTimes(1);
        expect(buildInput().value).toBe('1. Step one\n2. Step two');
    });

    it('Cancel on the confirm leaves the body untouched and makes no call', async () => {
        state.stages[4].body = 'OLD plan';
        renderConceiveView();
        suggestBtn().click();
        await flush();

        const cancelBtn = [...document.querySelectorAll('.conceiveSuggestLink')]
            .find((b) => b.textContent === 'Cancel');
        cancelBtn.click();
        await flush();

        expect(chatWithWorker).not.toHaveBeenCalled();
        expect(buildInput().value).toBe('OLD plan');
        expect(document.querySelector('.conceiveSuggestConfirm')).toBeNull();
    });
});

describe('Suggest plan — undo', () => {
    it('Undo restores the pre-suggestion body in one step', async () => {
        state.stages[4].body = 'OLD plan';
        renderConceiveView();

        suggestBtn().click();
        await flush();
        // Confirm the overwrite.
        [...document.querySelectorAll('.conceiveSuggestLink')]
            .find((b) => b.textContent === 'Replace').click();
        await flush();
        expect(buildInput().value).toBe('1. Step one\n2. Step two');

        // Undo restores the captured prior text via setProjectStageBody.
        listLogic.setProjectStageBody.mockClear();
        [...document.querySelectorAll('.conceiveSuggestLink')]
            .find((b) => b.textContent === 'Undo').click();

        expect(listLogic.setProjectStageBody).toHaveBeenCalledWith(
            'Proj', 'id-Build plan', 'OLD plan'
        );
        expect(buildInput().value).toBe('OLD plan');
        // Footer clears after undo.
        expect(document.querySelector('.conceiveSuggestFooter')).toBeNull();
    });
});
