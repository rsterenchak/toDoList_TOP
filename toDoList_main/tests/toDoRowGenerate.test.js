import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// buildToDoRow and the mobile modal are too heavily wired to instantiate
// end-to-end in jsdom (see the same caveat across the row-layer test files),
// so the "Generate with triage" surface is pinned at the source level: a
// Generate action beside Inject in a task's description panel that flags the
// task for the agent, fires the SAME batch triage sweep the Agent board uses,
// and lands the finished draft back into the task's description for review —
// without ever injecting. State is derived from the linked agent_queue row, not
// a separate store.

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

const toDoRow = read('toDoRow.js');
const modals = read('modals.js');
const css = read('style.css');

describe('Generate-with-triage — toDoRow.js control', () => {
    it('exports the shared factory + sync so both hosts drive one code path', () => {
        expect(toDoRow).toMatch(/export\s+function\s+makeGenerateButton\s*\(/);
        expect(toDoRow).toMatch(/export\s+function\s+syncGenerateControl\s*\(/);
    });

    it('reads the linked queue row from the shared store, never agentView', () => {
        expect(toDoRow).toMatch(/getQueueRowForTodo\(item\.id\)/);
        expect(toDoRow).not.toMatch(/from '\.\/agentView\.js'/);
    });

    it('flags the task through listLogic and fires the shared triage sweep', () => {
        expect(toDoRow).toMatch(/listLogic\.flagTaskForAgent\(item\.id\)/);
        expect(toDoRow).toMatch(/fireTriageSweep\(projectName\)/);
    });

    it('reloads the store after flagging so the row shows triaging without realtime', () => {
        expect(toDoRow).toMatch(/loadQueueRows\(projectName\)\)\.then\(refreshDescStatusDots\)/);
    });

    it('treats triaging as the generating state (spinner + read-only + inject disabled)', () => {
        expect(toDoRow).toMatch(/state\s*===\s*'triaging'/);
        // textarea read-only ONLY while generating
        expect(toDoRow).toMatch(/textarea\.readOnly\s*=\s*generating/);
        // inject disabled while generating, restored on leaving it
        expect(toDoRow).toMatch(/injectBtn\.classList\.add\('injectBtn--generating'\)/);
        expect(toDoRow).toMatch(/refreshInjectButton\(injectBtn,\s*item,\s*projectName\)/);
    });

    it('lands the drafted row text into the description through listLogic, exactly once', () => {
        expect(toDoRow).toMatch(/state\s*===\s*'drafted'/);
        expect(toDoRow).toMatch(/landedGenerateDrafts/);
        // landing writes item.desc via the same persistence path descInput uses
        expect(toDoRow).toMatch(/row\.draft/);
        expect(toDoRow).toMatch(/item\.desc\s*=\s*draft/);
        expect(toDoRow).toMatch(/listLogic\.editToDoItem\(projectName,\s*item\)/);
    });

    it('does NOT stand up a second derive pipeline (no fetchRunResult / dispatchRun)', () => {
        expect(toDoRow).not.toMatch(/fetchRunResult/);
        expect(toDoRow).not.toMatch(/dispatchRun/);
    });

    it('surfaces a dismissible failure notice for failed / no_change rows', () => {
        expect(toDoRow).toMatch(/state\s*===\s*'failed'\s*\|\|\s*state\s*===\s*'no_change'/);
        expect(toDoRow).toMatch(/function\s+showGenerateFailure\(/);
        expect(toDoRow).toMatch(/generateFailureDismiss/);
    });

    it('never auto-injects — the click path only flags + sweeps', () => {
        // The generate click handler must not call the inject path.
        const clickStart = toDoRow.indexOf('function onGenerateClick');
        const clickEnd = toDoRow.indexOf('function makeGenerateButton');
        const clickBody = toDoRow.slice(clickStart, clickEnd);
        expect(clickBody).not.toMatch(/injectDescription|injectEntry/);
    });

    it('mounts + syncs the Generate button when the description panel opens (committed rows)', () => {
        expect(toDoRow).toMatch(/if\s*\(generateBtn\s*&&\s*item\.id\)/);
        expect(toDoRow).toMatch(/syncGenerateControl\(generateBtn\)/);
    });

    it('re-syncs every Generate button on a store push (live triaging -> drafted / failed)', () => {
        expect(toDoRow).toMatch(/function\s+syncAllGenerateControls\(/);
        expect(toDoRow).toMatch(/querySelectorAll\('\.generateBtn'\)/);
    });

    it('hides Generate when the project has no resolved inject target', () => {
        expect(toDoRow).toMatch(/listLogic\.getProjectTargetId\(projectName\)/);
        expect(toDoRow).toMatch(/setGenerateVisual\(btn,\s*'hidden'\)/);
    });
});

describe('Generate-with-triage — mobile description-editor modal (modals.js)', () => {
    it('imports the shared factory + sync from the row layer', () => {
        expect(modals).toMatch(/makeGenerateButton/);
        expect(modals).toMatch(/syncGenerateControl/);
        expect(modals).toMatch(/from '\.\/toDoRow\.js'/);
    });

    it('mounts the Generate button into #descEditorModalActions and syncs it', () => {
        expect(modals).toMatch(/makeGenerateButton\(item,\s*\{/);
        expect(modals).toMatch(/actions\.appendChild\(generateBtn\)/);
        expect(modals).toMatch(/syncGenerateControl\(generateBtn\)/);
    });

    it('lands drafts through the modal textarea so item.desc + inject re-sync', () => {
        expect(modals).toMatch(/textarea\.value\s*=\s*draft/);
        expect(modals).toMatch(/textarea\.dispatchEvent\(new Event\('input'\)\)/);
    });
});

describe('Generate-with-triage — style.css', () => {
    it('styles Generate as a sibling of .injectBtn spanning the descSibling grid row', () => {
        expect(css).toMatch(/\.generateBtn\s*\{/);
        expect(css).toMatch(/#descSibling\s+\.generateBtn\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/);
    });

    it('dims the disabled inject button during generation', () => {
        expect(css).toMatch(/\.injectBtn--generating\s*\{/);
    });

    it('places Generate on its own full-width row in the mobile modal actions', () => {
        expect(css).toMatch(/#descEditorModalActions\s+\.generateBtn\s*\{[^}]*flex:\s*0\s+0\s+100%/);
    });
});
