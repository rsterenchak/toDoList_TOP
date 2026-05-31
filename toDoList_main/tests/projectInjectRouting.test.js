import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Source-inspection tests for the per-project inject routing feature:
// the Project routing section in the Inject settings modal, the
// expanded inject-button state machine (adds the "no-target" state),
// the per-project target_id on the data model, and the wired-through
// POST body shape that now carries repo + filePath alongside entry.
// Mirrors the pattern in injectToTodoMd.test.js / injectTargetsManagement.test.js
// since instantiating the full modal against jsdom + Supabase stub is
// out of scope here.

describe('project inject routing — listLogic data model', () => {

    const listLogic = read('listLogic.js');

    it('toProjectRowPayload carries target_id (defaulting to null) into the persistence payload', () => {
        expect(listLogic).toMatch(/target_id:\s*entry\.target_id\s*\|\|\s*null/);
    });

    it('exports getProjectTargetId, setProjectTargetId, and clearProjectTargetId from the listLogic IIFE', () => {
        expect(listLogic).toMatch(/getProjectTargetId\s*,/);
        expect(listLogic).toMatch(/setProjectTargetId\s*,/);
        expect(listLogic).toMatch(/clearProjectTargetId\s*,/);
        expect(listLogic).toMatch(/function\s+getProjectTargetId\s*\(/);
        expect(listLogic).toMatch(/function\s+setProjectTargetId\s*\(/);
        expect(listLogic).toMatch(/function\s+clearProjectTargetId\s*\(/);
    });

    it('setProjectTargetId persists via persistMutation update on projects', () => {
        // Must funnel through the same persistence path every other
        // project mutation uses — that's how the Supabase mirror, the
        // self-echo tracking, and the eventual offline queue all stay
        // consistent. Direct supabase calls here would skip the funnel.
        expect(listLogic).toMatch(
            /function\s+setProjectTargetId[\s\S]{0,1000}persistMutation\s*\(\s*\{[\s\S]{0,400}op:\s*['"]update['"][\s\S]{0,400}table:\s*['"]projects['"]/
        );
    });

    it('clearProjectTargetId walks every project and nulls matching target_id locally', () => {
        // The DB-side FK is ON DELETE SET NULL — this helper exists to
        // mirror that to the in-memory cache so dropdowns / inject
        // buttons reflect the unrouting without a page reload.
        expect(listLogic).toMatch(
            /function\s+clearProjectTargetId[\s\S]{0,400}entry\.target_id\s*===?\s*targetId[\s\S]{0,200}entry\.target_id\s*=\s*null/
        );
    });

    it('persistMutation insert + update for projects carry target_id', () => {
        // Both branches need it — insert covers project creation, update
        // covers every subsequent mutation (rename, color change,
        // routing change). One in each branch.
        const insertBlock = listLogic.match(/op === 'insert'[\s\S]{0,1200}target_id:\s*payload\.target_id/);
        const updateBlock = listLogic.match(/op === 'update'[\s\S]{0,1200}target_id:\s*payload\.target_id/);
        expect(insertBlock).toBeTruthy();
        expect(updateBlock).toBeTruthy();
    });

    it('hydrateFromSupabase reads target_id from remote project rows', () => {
        expect(listLogic).toMatch(/target_id:\s*p\.target_id\s*\|\|\s*null/);
    });

    it('handleProjectsRealtime mirrors target_id on INSERT / UPDATE', () => {
        expect(listLogic).toMatch(
            /existing\.target_id\s*=\s*evt\.new\.target_id\s*\|\|\s*null/
        );
    });
});

describe('project inject routing — inject button state machine', () => {

    const inject = read('inject.js');

    it('makeInjectButton accepts and stashes the project name from options', () => {
        expect(inject).toMatch(/btn\._injectProjectName\s*=/);
        expect(inject).toMatch(/opts\.projectName/);
    });

    it('refreshInjectButton accepts a third projectName argument and updates the cached value', () => {
        expect(inject).toMatch(
            /export\s+function\s+refreshInjectButton\s*\(\s*btn\s*,\s*item\s*,\s*projectName\s*\)/
        );
        expect(inject).toMatch(/btn\._injectProjectName\s*=\s*projectName/);
    });

    it('state precedence: unconfigured check runs before no-target check', () => {
        const unconf = inject.search(/!isInjectConfigured\(\)/);
        const noTarget = inject.search(/btn\.dataset\.state\s*=\s*['"]no-target['"]/);
        expect(unconf).toBeGreaterThan(-1);
        expect(noTarget).toBeGreaterThan(-1);
        expect(unconf).toBeLessThan(noTarget);
    });

    it('state precedence: no-target check runs before the empty-desc hide', () => {
        const noTarget = inject.search(/btn\.dataset\.state\s*=\s*['"]no-target['"]/);
        // The hide branch is the first place dataset.state is set to 'hidden'.
        const hide = inject.search(/btn\.dataset\.state\s*=\s*['"]hidden['"]/);
        expect(noTarget).toBeGreaterThan(-1);
        expect(hide).toBeGreaterThan(-1);
        expect(noTarget).toBeLessThan(hide);
    });

    it('no-target state surfaces the "Set inject target" label and stays visible', () => {
        expect(inject).toMatch(/Set inject target/);
        // The no-target branch must clear display: 'none' so the user
        // can see the call-to-action. Capture the whole if-block.
        expect(inject).toMatch(
            /if\s*\(\s*!targetId\s*\)\s*\{[\s\S]{0,400}btn\.style\.display\s*=\s*['"]['"][\s\S]{0,400}['"]no-target['"]/
        );
    });

    it('no-target click opens the settings modal scrolled to Project routing', () => {
        expect(inject).toMatch(
            /state\s*===\s*['"]no-target['"][\s\S]{0,200}showInjectSettingsModal\s*\(\s*\{[\s\S]{0,80}focusSection:\s*['"]projectRouting['"]/
        );
    });

    it('ready click resolves the project target and passes it into injectDescription', () => {
        // The ready branch must read the project's target_id, look it
        // up in cachedTargets, and forward the target so the POST body
        // can include repo + filePath.
        expect(inject).toMatch(
            /state\s*===\s*['"]ready['"][\s\S]{0,400}listLogic\.getProjectTargetId\s*\([\s\S]{0,200}findTargetById\s*\([\s\S]{0,200}injectDescription\s*\(\s*item\s*,\s*target\s*\)/
        );
    });
});

describe('project inject routing — POST body shape', () => {

    const inject = read('inject.js');

    it('injectDescription appends repo and filePath when a target is provided', () => {
        expect(inject).toMatch(/body\.repo\s*=\s*target\.repo/);
        expect(inject).toMatch(/body\.filePath\s*=\s*target\.file_path/);
    });

    it('injectDescription posts the assembled body via postToWorker', () => {
        expect(inject).toMatch(
            /async\s+function\s+injectDescription\s*\(\s*item\s*,\s*target\s*\)[\s\S]{0,1200}postToWorker\s*\(\s*body\s*\)/
        );
    });

    it('testConnection adds repo + filePath using the FIRST defined target when one exists', () => {
        expect(inject).toMatch(
            /async\s+function\s+testConnection[\s\S]{0,400}cachedTargets\[\s*0\s*\][\s\S]{0,200}body\.repo\s*=\s*first\.repo[\s\S]{0,200}body\.filePath\s*=\s*first\.file_path/
        );
    });

    it('testConnection omits repo/filePath when no targets are defined', () => {
        // The conditional that adds repo / filePath must gate on the
        // existence of the first target — without targets, the body
        // stays { test: true } and the Worker falls back to its default.
        expect(inject).toMatch(
            /async\s+function\s+testConnection[\s\S]{0,400}if\s*\(\s*first\s*\)[\s\S]{0,200}body\.repo/
        );
    });

    it('status pill surfaces "Connected (target: <nickname>)" on a successful test', () => {
        expect(inject).toMatch(/Connected \(target: ['"]\s*\+\s*first\.nickname/);
        expect(inject).toMatch(/Connected \(target: ['"]\s*\+\s*lt\.nickname/);
    });
});

describe('project inject routing — settings modal section', () => {

    const inject = read('inject.js');

    it('mounts a Project routing section in the modal', () => {
        expect(inject).toMatch(/['"]injectProjectRoutingSection['"]/);
        expect(inject).toMatch(/['"]injectProjectRoutingBody['"]/);
        expect(inject).toMatch(/['"]Project routing['"]/);
    });

    it('renders the empty-state copy when no targets are defined', () => {
        expect(inject).toMatch(/Define a target first to enable project routing/);
    });

    it('renders one row per project with a target dropdown bound to the project name', () => {
        expect(inject).toMatch(/listLogic\.listProjectsArray\s*\(\s*\)/);
        expect(inject).toMatch(/['"]injectProjectRoutingRow['"]/);
        expect(inject).toMatch(/['"]injectProjectRoutingSelect['"]/);
    });

    it('the dropdown preselects the project\'s current target_id', () => {
        expect(inject).toMatch(
            /listLogic\.getProjectTargetId\s*\(\s*projectName\s*\)/
        );
        expect(inject).toMatch(/select\.value\s*=\s*current/);
    });

    it('dropdown change autosaves via listLogic.setProjectTargetId — no Save button', () => {
        expect(inject).toMatch(
            /select\.addEventListener\(\s*['"]change['"][\s\S]{0,400}listLogic\.setProjectTargetId\s*\(\s*projectName\s*,\s*newId\s*\)/
        );
        // The section's render path must not stamp out a save button —
        // autosave is the only flow.
        expect(inject).not.toMatch(/['"]injectProjectRoutingSave['"]/);
    });

    it('the inline "Saved" confirmation fades after 1.5s', () => {
        expect(inject).toMatch(/['"]injectProjectRoutingSaved['"]/);
        expect(inject).toMatch(/savedNote\.textContent\s*=\s*['"]Saved['"]/);
        expect(inject).toMatch(/setTimeout\s*\([\s\S]{0,200}1500\s*\)/);
    });

    it('the autosave handler refreshes every inject button so demoted/promoted states sync immediately', () => {
        expect(inject).toMatch(
            /listLogic\.setProjectTargetId[\s\S]{0,800}refreshAllInjectButtons\s*\(/
        );
    });

    it('selects use 16px font-size to satisfy the iOS Safari auto-zoom rule', () => {
        const css = read('style.css');
        expect(css).toMatch(/\.injectProjectRoutingSelect[\s\S]{0,200}font-size:\s*16px/);
    });
});

describe('project inject routing — target delete clears local cache + refreshes UI', () => {

    const inject = read('inject.js');

    it('the trash-icon confirm handler calls listLogic.clearProjectTargetId(target.id)', () => {
        expect(inject).toMatch(
            /deleteInjectTarget\s*\(\s*target\.id\s*\)[\s\S]{0,1500}listLogic\.clearProjectTargetId\s*\(\s*target\.id/
        );
    });

    it('after deleting a target the Project routing table is re-rendered and inject buttons refreshed', () => {
        expect(inject).toMatch(
            /deleteInjectTarget\s*\(\s*target\.id\s*\)[\s\S]{0,1800}renderProjectRouting\s*\([\s\S]{0,300}refreshAllInjectButtons\s*\(/
        );
    });
});

describe('project inject routing — wiring into row + modal callers', () => {

    const toDoRow = read('toDoRow.js');
    const modals = read('modals.js');
    const main = read('main.js');

    it('toDoRow.js passes the project name into makeInjectButton', () => {
        expect(toDoRow).toMatch(
            /makeInjectButton\s*\(\s*item\s*,\s*\{\s*projectName:\s*toDoName\s*\}\s*\)/
        );
    });

    it('toDoRow.js forwards the project name through every refreshInjectButton call', () => {
        const calls = toDoRow.match(/refreshInjectButton\s*\([^)]*\)/g) || [];
        expect(calls.length).toBeGreaterThan(0);
        // Each call must carry three positional arguments (btn, item,
        // projectName-or-alias). The third one is named `toDoName` in
        // the row scope and `projectName` inside `wireDescToggle`'s
        // parameter list — both are valid forwarders of the same value.
        calls.forEach(function(c) {
            expect(c).toMatch(/toDoName|projectName/);
        });
    });

    it('modals.js threads opts.projectName through both makeInjectButton and refreshInjectButton', () => {
        expect(modals).toMatch(/makeInjectButton\s*\(\s*item\s*,\s*\{\s*projectName:\s*opts\.projectName/);
        expect(modals).toMatch(/refreshInjectButton\s*\(\s*injectBtn\s*,\s*item\s*,\s*opts\.projectName/);
    });

    it('main.js imports initInjectTargets and warms the cache after Supabase hydrate', () => {
        expect(main).toMatch(/import\s*\{[^}]*initInjectTargets[^}]*\}\s*from\s*['"]\.\/inject\.js['"]/);
        expect(main).toMatch(/listLogicHydrated[\s\S]{0,2000}initInjectTargets\s*\(/);
    });
});

describe('project inject routing — settings modal accepts focusSection option', () => {

    const inject = read('inject.js');

    it('showInjectSettingsModal takes an options argument and scrolls when focusSection === projectRouting', () => {
        expect(inject).toMatch(
            /export\s+function\s+showInjectSettingsModal\s*\(\s*options\s*\)/
        );
        expect(inject).toMatch(
            /openOpts\.focusSection\s*===\s*['"]projectRouting['"][\s\S]{0,400}scrollIntoView/
        );
    });
});
