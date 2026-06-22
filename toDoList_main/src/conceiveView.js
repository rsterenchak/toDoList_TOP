import { listLogic } from './listLogic.js';
import { openSeedTasksModal } from './seedTasksModal.js';

// The SDLC stage that seeds tasks — its header gets the "Generate tasks"
// action. Kept in sync with the label seeded by listLogic.seedStages.
const BUILD_PLAN_LABEL = 'Build plan';

// The CONCEIVE view: a per-project lifecycle surface. It renders the
// *currently selected* project's ordered lifecycle stages (seeded with the
// SDLC set) as collapsible sections with a filled/empty status dot and an
// editable multi-line body that autosaves. Projects and Conceive are two
// lenses on the same selected project: its tasks (Projects view) and its
// lifecycle thinking (here).
//
// Like inboxView.js this module reaches the DOM via getElementById /
// createElement at call time and only exports renderConceiveView — there is
// no back-edge into main.js. All persistence routes through listLogic.js;
// this module never touches localStorage. The selected project is resolved
// the same way the Projects view does: the `.selectedProject` sidebar row
// and its `#projInput` value.

// Track which stage sections are expanded, keyed by stage id, so a re-render
// (after a save, or after the selected project changes) preserves the
// open/closed state the user set. Stage ids are unique per project, so the
// set never collides across projects.
let expandedStageIds = new Set();

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// Resolve the currently-selected project's name from the sidebar — the same
// source of truth the Projects view uses. Returns '' when nothing is
// selected (or the row has no input), which drives the empty state.
function getSelectedProjectName() {
    const selected = document.querySelector('.selectedProject');
    if (!selected) return '';
    const input = selected.querySelector('#projInput');
    return input ? (input.value || '').trim() : '';
}

// One collapsible stage section: a header with a filled/empty status dot and
// the stage label, plus a multi-line body that autosaves on input (debounced)
// and on blur. Both writes route through listLogic.setProjectStageBody; the
// status dot is refreshed in place so focus and caret position are preserved.
function buildStageSection(projectName, stage) {
    const section = document.createElement('div');
    section.className = 'conceiveStage';
    section.setAttribute('data-stage-id', stage.id);
    const expanded = expandedStageIds.has(stage.id);
    if (expanded) section.classList.add('expanded');

    const head = document.createElement('button');
    head.type = 'button';
    head.className = 'conceiveStageHeader';
    head.setAttribute('aria-expanded', expanded ? 'true' : 'false');

    const dot = document.createElement('span');
    dot.className = 'conceiveStageDot';
    const filled = !!(stage.body && stage.body.trim());
    if (filled) dot.classList.add('filled');
    dot.setAttribute('aria-hidden', 'true');
    head.appendChild(dot);

    const label = document.createElement('span');
    label.className = 'conceiveStageLabel';
    label.textContent = stage.label;
    head.appendChild(label);

    head.addEventListener('click', function () {
        if (expandedStageIds.has(stage.id)) expandedStageIds.delete(stage.id);
        else expandedStageIds.add(stage.id);
        const nowOpen = expandedStageIds.has(stage.id);
        section.classList.toggle('expanded', nowOpen);
        head.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
    });

    // The Build-plan stage gets a "Generate tasks" action in its header — it
    // decomposes the plan into todos via the in-app Claude. A nested <button>
    // inside the header <button> would be invalid markup, so the header lives
    // in a flex row alongside the action. Enabled only when the stage body is
    // non-empty; its disabled state tracks edits via persist() below.
    let genBtn = null;
    if (stage.label === BUILD_PLAN_LABEL) {
        const headerRow = document.createElement('div');
        headerRow.className = 'conceiveStageHeaderRow';
        headerRow.appendChild(head);

        genBtn = document.createElement('button');
        genBtn.type = 'button';
        genBtn.className = 'conceiveGenerateTasksBtn';
        genBtn.textContent = 'Generate tasks';
        genBtn.setAttribute('aria-label', 'Generate tasks from the Build plan');
        genBtn.disabled = !(stage.body && stage.body.trim());
        genBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            openSeedTasksModal(projectName);
        });
        headerRow.appendChild(genBtn);
        section.appendChild(headerRow);
    } else {
        section.appendChild(head);
    }

    const body = document.createElement('div');
    body.className = 'conceiveStageBody';

    const textarea = document.createElement('textarea');
    textarea.className = 'conceiveStageInput';
    textarea.value = stage.body || '';
    textarea.setAttribute('aria-label', stage.label + ' notes');
    textarea.rows = 4;

    let debounce = null;
    function persist() {
        listLogic.setProjectStageBody(projectName, stage.id, textarea.value);
        const nowFilled = !!(textarea.value && textarea.value.trim());
        dot.classList.toggle('filled', nowFilled);
        // Keep the Generate-tasks action's enabled state in lockstep with the
        // Build-plan body — it's only actionable with a non-empty plan.
        if (genBtn) genBtn.disabled = !nowFilled;
    }
    textarea.addEventListener('input', function () {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(persist, 400);
    });
    textarea.addEventListener('blur', function () {
        if (debounce) { clearTimeout(debounce); debounce = null; }
        persist();
    });
    body.appendChild(textarea);
    section.appendChild(body);

    return section;
}

// Render the CONCEIVE view for the currently selected project. Safe to call
// before component() has built the shell (a missing #conceiveView
// short-circuits). With no project selected (or none exist) it shows a gentle
// empty state and no editor.
export function renderConceiveView() {
    const view = document.getElementById('conceiveView');
    if (!view) return;
    clear(view);

    const projectName = getSelectedProjectName();
    if (!projectName) {
        const empty = document.createElement('div');
        empty.className = 'conceiveEmptyState';
        empty.textContent = 'Select a project to plan its stages.';
        view.appendChild(empty);
        return;
    }

    // Header: the project name plus its lifecycle chip.
    const header = document.createElement('div');
    header.className = 'conceiveEditorHeader';

    const titleRow = document.createElement('div');
    titleRow.className = 'conceiveEditorTitleRow';

    const name = document.createElement('h2');
    name.className = 'conceiveProjectName';
    name.textContent = projectName;
    titleRow.appendChild(name);

    const chip = document.createElement('span');
    chip.className = 'conceiveLifecycleChip';
    chip.textContent = listLogic.getProjectLifecycle(projectName);
    titleRow.appendChild(chip);

    header.appendChild(titleRow);
    view.appendChild(header);

    const stagesEl = document.createElement('div');
    stagesEl.className = 'conceiveStages';
    listLogic.getProjectStages(projectName).forEach(function (stage) {
        stagesEl.appendChild(buildStageSection(projectName, stage));
    });
    view.appendChild(stagesEl);
}
