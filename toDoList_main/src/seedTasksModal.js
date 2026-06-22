// "Generate tasks" review modal for the Conceive view's actionable stage.
//
// The Conceive view lets a user draft a project's lifecycle thinking across
// its shape's stages — Spec (Why / Concept / Requirements / Design / Build
// plan) or Iterative (Why / Concept / Next up / Iterations). This modal turns
// the project's actionable stage (the task source — 'Build plan' for Spec,
// 'Next up' for Iterative; resolved via conceiveShapes) into real todos: it
// sends that stage's text as the task source — plus the other non-empty stages
// as background context — to the in-app Claude (the existing `chatWithWorker`
// chat path), asking it to decompose the plan into short, well-scoped task
// titles. The reply opens here as a checklist (all checked by default); the
// user unchecks any they don't want and confirms, which creates the checked
// tasks as committed todos in the selected project through the normal add-todo
// path.
//
// Pure client: it reuses the exported chat call and needs no Worker change.
// Tasks are derived ONLY from the actionable stage — the other stages inform
// scope and phrasing only, never invent tasks of their own. Titles that already
// exist in the project (trimmed, case-insensitive) are auto-skipped: rendered
// greyed with an "in tasks" tag, unchecked, and excluded from the count, so
// re-running can't spawn duplicates.
//
// Self-mounts to the DOM on open the way showDescEditorModal does, and closes
// three ways (close button, backdrop, Escape) per the modal convention in
// CLAUDE.md. All persistence routes through listLogic.js.

import { listLogic } from './listLogic.js';
import { chatWithWorker, findTargetById } from './inject.js';
import { actionableStageLabel } from './conceiveShapes.js';

// Hard ceiling on proposed tasks so a runaway reply can't flood the list.
const MAX_TASKS = 20;

// Resolve a Conceive project's linked repo so Generate tasks and Suggest plan
// ground their generation in that app's real code instead of the Worker's
// default target. Reads the project's target_id (the same inject_targets
// routing the inject/run path uses) and resolves it to a repo string via the
// targets cache. Degrades to null — no target_id, deleted target, or unwarmed
// cache — in which case the caller passes null and the Worker falls back to
// its default repo (the prior behavior). inject_targets repos are validated
// against the Worker's allowlist at save time, so a resolved repo is always
// allowlisted. Shared by both Conceive tools (imported into conceiveView.js).
export function resolveProjectRepo(projectName) {
    const targetId = listLogic.getProjectTargetId(projectName);
    if (!targetId) return null;
    const target = findTargetById(targetId);
    return target && target.repo ? target.repo : null;
}

// Build the decompose prompt from the project's ordered stages: a labeled
// context block listing each non-empty non-actionable stage first, then the
// actionable stage (the task source — 'Build plan' for Spec projects, 'Next
// up' for Iterative ones), with an explicit instruction to derive tasks ONLY
// from that stage and to return ONLY a JSON array of short, imperative
// task-title strings.
function buildPrompt(stages, actionableLabel) {
    const sourceStage = stages.find(function (s) { return s.label === actionableLabel; });
    const sourceBody = sourceStage && sourceStage.body ? sourceStage.body.trim() : '';

    const contextStages = stages.filter(function (s) {
        return s.label !== actionableLabel && s.body && s.body.trim();
    });

    const lines = [];
    if (contextStages.length) {
        lines.push('## Project context (background only — do NOT derive tasks from these)');
        contextStages.forEach(function (s) {
            lines.push('### ' + s.label);
            lines.push(s.body.trim());
            lines.push('');
        });
    }
    lines.push('## ' + actionableLabel + ' (the ONLY source of tasks)');
    lines.push(sourceBody);
    lines.push('');
    lines.push(
        'Decompose the ' + actionableLabel + ' above into short, well-scoped, ' +
        'imperative task titles for a todo list. Derive tasks ONLY from the ' +
        actionableLabel + '; treat the project context sections above as background ' +
        'for scope and phrasing, never as a source of tasks. Return ONLY a JSON ' +
        'array of task-title strings — no prose, no code fences, no numbering.'
    );
    return lines.join('\n');
}

// Parse the Worker reply into an ordered list of task titles. Strips any
// ```json code fences and tries JSON.parse first; a string array is used
// directly. If parsing fails (or yields a non-array), fall back to splitting
// the reply into non-empty lines with leading `-` / `*` / `1.` markers
// stripped — this also absorbs any stray prose the Worker's system prompt
// adds. Capped at MAX_TASKS either way.
export function parseTaskTitles(reply) {
    if (typeof reply !== 'string') return [];
    const text = reply.replace(/```(?:json)?/gi, '').trim();
    if (!text) return [];

    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            return parsed
                .filter(function (t) { return typeof t === 'string'; })
                .map(function (t) { return t.trim(); })
                .filter(Boolean)
                .slice(0, MAX_TASKS);
        }
    } catch (e) {
        /* fall through to line-splitting */
    }

    return text
        .split('\n')
        .map(function (line) { return line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim(); })
        .filter(Boolean)
        .slice(0, MAX_TASKS);
}

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// Open the review modal for the named project. Opens in a loading state,
// requests a decomposition from Claude, then renders the proposed titles as a
// checklist. On a failed/empty/unparseable reply it shows an error with a
// retry. Confirming creates the checked, non-duplicate tasks as committed
// todos and switches the app to the Projects view.
export function openSeedTasksModal(projectName) {
    if (!projectName) return;

    // The actionable stage (task source) depends on the project's shape:
    // 'Build plan' for Spec projects, 'Next up' for Iterative ones.
    const actionableLabel = actionableStageLabel(listLogic.getProjectLifecycle(projectName));

    const prior = document.getElementById('seedTasksModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'seedTasksModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'seedTasksModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'seedTasksModalTitle');

    const header = document.createElement('div');
    header.id = 'seedTasksModalHeader';

    const title = document.createElement('h2');
    title.id = 'seedTasksModalTitle';
    title.textContent = 'Generate tasks';

    const closeX = document.createElement('button');
    closeX.id = 'seedTasksModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close generate tasks');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'seedTasksModalBody';

    const footer = document.createElement('div');
    footer.id = 'seedTasksModalFooter';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'seedTasksModalCancel';
    cancelBtn.type = 'button';
    cancelBtn.className = 'seedTasksModalBtn';
    cancelBtn.textContent = 'Cancel';

    const addBtn = document.createElement('button');
    addBtn.id = 'seedTasksModalAdd';
    addBtn.type = 'button';
    addBtn.className = 'seedTasksModalBtn seedTasksModalBtnPrimary';
    addBtn.textContent = 'Add 0 tasks';
    addBtn.disabled = true;

    footer.appendChild(cancelBtn);
    footer.appendChild(addBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const previouslyFocused = document.activeElement;

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (previouslyFocused &&
            typeof previouslyFocused.focus === 'function' &&
            document.contains(previouslyFocused)) {
            try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
        }
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    }

    closeX.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function (event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);

    // The set of existing todo titles for duplicate detection — trimmed,
    // lower-cased, blank placeholder excluded.
    function existingTitleSet() {
        const items = listLogic.listItems(projectName) || [];
        const set = new Set();
        items.forEach(function (it) {
            if (it && typeof it.tit === 'string' && it.tit.trim()) {
                set.add(it.tit.trim().toLowerCase());
            }
        });
        return set;
    }

    // ── loading state ──
    function renderLoading() {
        clear(body);
        addBtn.textContent = 'Add 0 tasks';
        addBtn.disabled = true;
        const loading = document.createElement('div');
        loading.className = 'seedTasksModalLoading';
        loading.textContent = 'Decomposing your ' + actionableLabel + ' into tasks…';
        body.appendChild(loading);
    }

    // ── error state with retry ──
    function renderError(message) {
        clear(body);
        addBtn.disabled = true;
        const err = document.createElement('div');
        err.className = 'seedTasksModalError';
        const msg = document.createElement('p');
        msg.className = 'seedTasksModalErrorMsg';
        msg.textContent = message || 'Couldn’t generate tasks. Please try again.';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'seedTasksModalBtn';
        retry.textContent = 'Retry';
        retry.addEventListener('click', run);
        err.appendChild(msg);
        err.appendChild(retry);
        body.appendChild(err);
    }

    // ── checklist state ──
    // Tracks the live count of checked, non-duplicate rows and reflects it on
    // the footer button (label + disabled).
    let checkboxes = [];
    function refreshCount() {
        let n = 0;
        checkboxes.forEach(function (cb) {
            if (!cb.disabled && cb.checked) n += 1;
        });
        addBtn.textContent = 'Add ' + n + ' task' + (n === 1 ? '' : 's');
        addBtn.disabled = n === 0;
    }

    function renderChecklist(titles) {
        clear(body);
        checkboxes = [];

        if (!titles.length) {
            renderError('No tasks could be generated from the ' + actionableLabel + '.');
            return;
        }

        const existing = existingTitleSet();
        const seenInList = new Set();
        const list = document.createElement('div');
        list.className = 'seedTasksModalList';

        titles.forEach(function (rawTitle, i) {
            const titleVal = rawTitle.trim();
            if (!titleVal) return;
            const key = titleVal.toLowerCase();
            // Treat a duplicate within the proposed list itself the same as an
            // existing-task dup so the same title can't be added twice.
            const isDup = existing.has(key) || seenInList.has(key);
            seenInList.add(key);

            const row = document.createElement('label');
            row.className = 'seedTasksModalRow';
            if (isDup) row.classList.add('seedTasksModalRowDup');

            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'seedTasksModalCheckbox';
            cb.checked = !isDup;
            cb.disabled = isDup;
            cb.value = titleVal;
            cb.addEventListener('change', refreshCount);

            const text = document.createElement('span');
            text.className = 'seedTasksModalRowTitle';
            text.textContent = titleVal;

            row.appendChild(cb);
            row.appendChild(text);

            if (isDup) {
                const tag = document.createElement('span');
                tag.className = 'seedTasksModalDupTag';
                tag.textContent = 'in tasks';
                row.appendChild(tag);
            }

            checkboxes.push(cb);
            list.appendChild(row);
        });

        body.appendChild(list);
        refreshCount();
    }

    // Fire the decompose call and route the reply through the parser. A
    // failed, empty, or unparseable reply lands on the error state (with a
    // retry) rather than silently closing.
    function run() {
        renderLoading();
        const stages = listLogic.getProjectStages(projectName) || [];
        const prompt = buildPrompt(stages, actionableLabel);
        // One-off messages array so the live chat-pane conversation is never
        // touched; repo is the project's linked repo (or null → Worker default
        // when the project has no link), so the decomposition is grounded in
        // that app's actual code. The trailing `true` is the deep flag: task
        // decomposition routes through the Worker's heavier model (deep_think),
        // unlike ordinary chat turns which stay on the fast default.
        chatWithWorker([{ role: 'user', content: prompt }], undefined, undefined, resolveProjectRepo(projectName), undefined, true)
            .then(function (res) {
                if (closed) return;
                const reply = res && typeof res.reply === 'string' ? res.reply : '';
                const titles = parseTaskTitles(reply);
                if (!titles.length) {
                    renderError('Couldn’t read any tasks from the reply. Please try again.');
                    return;
                }
                renderChecklist(titles);
            })
            .catch(function (e) {
                if (closed) return;
                const reason = e && e.reason ? e.reason : 'Something went wrong.';
                renderError('Couldn’t generate tasks: ' + reason);
            });
    }

    // Confirm: create each checked, non-duplicate task as a committed todo in
    // the selected project through the existing add-todo path (saveToStorage +
    // Supabase insert), in list order. Then close and switch to Projects so
    // the new tasks are immediately visible.
    addBtn.addEventListener('click', function () {
        const toAdd = checkboxes
            .filter(function (cb) { return !cb.disabled && cb.checked; })
            .map(function (cb) { return cb.value; });
        if (!toAdd.length) return;
        toAdd.forEach(function (titleVal) {
            listLogic.addToDo(projectName, titleVal);
        });
        close();
        // Switch to the Projects view via its pill so the wiring stays in
        // main.js (the modal keeps no back-edge into the view switcher).
        const projectsPill = document.getElementById('viewPillProjects');
        if (projectsPill) projectsPill.click();
    });

    run();
}
