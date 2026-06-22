import { listLogic } from './listLogic.js';
import { openSeedTasksModal } from './seedTasksModal.js';
import { chatWithWorker } from './inject.js';

// The SDLC stage that seeds tasks — its header gets the "Generate tasks"
// action. Kept in sync with the label seeded by listLogic.seedStages.
const BUILD_PLAN_LABEL = 'Build plan';

// Static guidance copy shown under each default stage's label — a muted
// one-line prompt describing what belongs in that stage. Keyed by the default
// SDLC stage labels; this is pure presentation, never stored on the stage
// objects, never persisted or synced, and never part of any text sent to
// Claude. A stage whose label isn't a key here renders no hint.
const STAGE_HINTS = {
    'Why': 'Who is it for, and what problem does it solve?',
    'Concept': 'In a sentence or two, what is it and how does it work?',
    'Requirements': "What must it do? Key capabilities, constraints, and what's out of scope.",
    'Design': 'How does it look and work — UI, data model, and tech choices?',
    'Build plan': 'The ordered steps to build it; each line becomes a task.',
};

// Build the "Suggest plan" prompt from the project's non-empty upstream stages
// (every stage except the Build plan). Each is labeled so the model can map
// intent to phase; the instruction asks for a concrete, ordered build plan as
// plain text — a short numbered list of implementation steps, one per line,
// with no surrounding prose — because the result is written straight into the
// Build-plan textarea (it is NOT JSON, unlike the seed-tasks decompose call).
function buildSuggestPlanPrompt(stages) {
    const upstream = stages.filter(function (s) {
        return s.label !== BUILD_PLAN_LABEL && s.body && s.body.trim();
    });

    const lines = [];
    lines.push('## Project context');
    upstream.forEach(function (s) {
        lines.push('### ' + s.label);
        lines.push(s.body.trim());
        lines.push('');
    });
    lines.push(
        'Draft a concrete build plan for this project from the context above. ' +
        'Return ONLY the plan as a short numbered list of implementation steps, ' +
        'one step per line, ordered from first to last. No preamble, no closing ' +
        'remarks, no surrounding prose — just the numbered steps.'
    );
    return lines.join('\n');
}

// Normalize the Worker reply into plain build-plan text for the textarea.
// Strips any stray ```/```text code fences the system prompt may add and
// trims surrounding whitespace. Returns '' for a missing/blank reply so the
// caller can treat it as an error and leave the body untouched.
function parsePlanText(reply) {
    if (typeof reply !== 'string') return '';
    return reply.replace(/```[a-z]*\n?/gi, '').trim();
}

// The CONCEIVE view: a per-project lifecycle surface. It renders the
// *currently selected* project's ordered lifecycle stages (seeded with the
// SDLC set) as collapsible sections with a filled/empty status dot and an
// editable multi-line body that autosaves. Projects and Conceive are two
// lenses on the same selected project: its tasks (Projects view) and its
// lifecycle thinking (here).
//
// Like the other view modules this module reaches the DOM via getElementById /
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
    let suggestBtn = null;
    if (stage.label === BUILD_PLAN_LABEL) {
        const headerRow = document.createElement('div');
        headerRow.className = 'conceiveStageHeaderRow';
        headerRow.appendChild(head);

        // "Suggest plan" drafts the Build-plan body from the upstream stages
        // via the in-app Claude. Enabled only when at least one upstream stage
        // (Why / Concept / Requirements / Design) has content — there's
        // nothing to synthesize from otherwise. Its click handler is wired
        // below, after the textarea + persist() it depends on are defined.
        suggestBtn = document.createElement('button');
        suggestBtn.type = 'button';
        suggestBtn.className = 'conceiveSuggestPlanBtn';
        suggestBtn.textContent = 'Suggest plan';
        suggestBtn.setAttribute('aria-label', 'Suggest a build plan from the upstream stages');
        const hasUpstream = listLogic.getProjectStages(projectName).some(function (s) {
            return s.label !== BUILD_PLAN_LABEL && s.body && s.body.trim();
        });
        suggestBtn.disabled = !hasUpstream;
        if (!hasUpstream) {
            suggestBtn.title = 'Fill in a stage above (Why / Concept / Requirements / Design) first';
        }
        headerRow.appendChild(suggestBtn);

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

    // Persistent, display-only guidance prompt under the stage label — a muted
    // one-liner describing what belongs in this stage. Rendered only for the
    // default stages in STAGE_HINTS; unknown labels render nothing. It is not
    // editable, not part of the stage body, and never persisted, synced, or
    // sent to Claude.
    const hintText = STAGE_HINTS[stage.label];
    if (hintText) {
        const hint = document.createElement('p');
        hint.className = 'conceiveStageHint';
        hint.textContent = hintText;
        section.appendChild(hint);
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

    // ── "Suggest plan" flow (Build-plan stage only) ──
    // Drafts the Build-plan body from the upstream stages via Claude and writes
    // it inline. A small status area below the body hosts the overwrite-confirm,
    // the error message, and the post-draft "Drafted by Claude · Undo ·
    // Regenerate" footer. All writes route through listLogic.setProjectStageBody
    // so they persist and mirror to Supabase like any manual edit.
    if (suggestBtn) {
        const status = document.createElement('div');
        status.className = 'conceiveSuggestStatus';
        section.appendChild(status);

        // Single-level undo: the body text captured just before the most recent
        // successful draft was written.
        let undoText = null;

        function clearStatus() {
            clear(status);
        }

        // Apply drafted text to the model + textarea and refresh dependent UI.
        function applyText(text) {
            listLogic.setProjectStageBody(projectName, stage.id, text);
            textarea.value = text;
            const nowFilled = !!(text && text.trim());
            dot.classList.toggle('filled', nowFilled);
            if (genBtn) genBtn.disabled = !nowFilled;
        }

        function showError(message) {
            clearStatus();
            const err = document.createElement('div');
            err.className = 'conceiveSuggestError';
            err.textContent = message;
            status.appendChild(err);
        }

        // The post-draft footer: a note plus single-level Undo and Regenerate.
        function showDraftedFooter() {
            clearStatus();
            const footer = document.createElement('div');
            footer.className = 'conceiveSuggestFooter';

            const note = document.createElement('span');
            note.className = 'conceiveSuggestNote';
            note.textContent = 'Drafted by Claude';
            footer.appendChild(note);

            const undoBtn = document.createElement('button');
            undoBtn.type = 'button';
            undoBtn.className = 'conceiveSuggestLink';
            undoBtn.textContent = 'Undo';
            undoBtn.addEventListener('click', function () {
                if (undoText === null) return;
                applyText(undoText);
                undoText = null;
                clearStatus();
            });
            footer.appendChild(undoBtn);

            const regenBtn = document.createElement('button');
            regenBtn.type = 'button';
            regenBtn.className = 'conceiveSuggestLink';
            regenBtn.textContent = 'Regenerate';
            // Regenerate replaces the current draft without re-confirming.
            regenBtn.addEventListener('click', function () { runSuggest(true); });
            footer.appendChild(regenBtn);

            status.appendChild(footer);
        }

        // Fire the draft call: loading on the button, write on success, inline
        // error (body untouched) on a failed/empty reply.
        function fetchPlan() {
            clearStatus();
            suggestBtn.disabled = true;
            const priorLabel = suggestBtn.textContent;
            suggestBtn.textContent = 'Suggesting…';

            const stages = listLogic.getProjectStages(projectName) || [];
            const prompt = buildSuggestPlanPrompt(stages);
            // One-off messages array so the live chat conversation is never
            // touched; repo is null (Worker default). The trailing `true` is
            // the deep flag — synthesis-from-context runs on the heavier model.
            chatWithWorker([{ role: 'user', content: prompt }], undefined, undefined, null, undefined, true)
                .then(function (res) {
                    suggestBtn.textContent = priorLabel;
                    suggestBtn.disabled = false;
                    const reply = res && typeof res.reply === 'string' ? res.reply : '';
                    const text = parsePlanText(reply);
                    if (!text) {
                        showError('Couldn’t draft a plan. Please try again.');
                        return;
                    }
                    undoText = textarea.value;
                    applyText(text);
                    showDraftedFooter();
                })
                .catch(function (e) {
                    suggestBtn.textContent = priorLabel;
                    suggestBtn.disabled = false;
                    const reason = e && e.reason ? e.reason : 'Something went wrong.';
                    showError('Couldn’t draft a plan: ' + reason);
                });
        }

        // Entry point. When the body already has content and we're not
        // regenerating, confirm before overwriting so nothing is lost.
        function runSuggest(skipConfirm) {
            if (!skipConfirm && textarea.value && textarea.value.trim()) {
                clearStatus();
                const confirmRow = document.createElement('div');
                confirmRow.className = 'conceiveSuggestConfirm';

                const msg = document.createElement('span');
                msg.className = 'conceiveSuggestConfirmMsg';
                msg.textContent = 'Replace the current build plan?';
                confirmRow.appendChild(msg);

                const replaceBtn = document.createElement('button');
                replaceBtn.type = 'button';
                replaceBtn.className = 'conceiveSuggestLink';
                replaceBtn.textContent = 'Replace';
                replaceBtn.addEventListener('click', function () { fetchPlan(); });
                confirmRow.appendChild(replaceBtn);

                const cancelBtn = document.createElement('button');
                cancelBtn.type = 'button';
                cancelBtn.className = 'conceiveSuggestLink';
                cancelBtn.textContent = 'Cancel';
                cancelBtn.addEventListener('click', clearStatus);
                confirmRow.appendChild(cancelBtn);

                status.appendChild(confirmRow);
                return;
            }
            fetchPlan();
        }

        suggestBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            if (suggestBtn.disabled) return;
            runSuggest(false);
        });
    }

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
