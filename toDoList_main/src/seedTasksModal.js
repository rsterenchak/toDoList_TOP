// "Generate tasks" review modal for the Conceive view's actionable stage.
//
// The Conceive view lets a user draft a project's lifecycle thinking across
// its shape's stages — Spec (Why / Concept / Requirements / Design / Build
// plan) or Iterative (Why / Concept / Next up / Iterations). This modal turns
// the project's actionable stage (the task source — 'Build plan' for Spec,
// 'Next up' for Iterative; resolved via conceiveShapes) into real todos: it
// sends that stage's text as the task source — plus the other non-empty stages
// as background context — to the in-app Claude (the existing `chatWithWorker`
// chat path), asking it to decompose the plan into short, well-scoped tasks.
// Each proposed task carries a short imperative title (for the row + dup-skip)
// AND a TODO.md-format backlog entry (the project's standard entry shape), so
// every generated todo is a pipeline-ready first draft. The reply opens here as
// a checklist (all checked by default) with compact title rows; rows whose task
// carries an entry get a per-row "Details" toggle that reveals the entry
// preformatted. The user unchecks any they don't want and confirms, which
// creates the checked tasks as committed todos in the selected project through
// the normal add-todo path — each with its entry sitting in the todo's
// description.
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
import { actionableStageLabelForStages } from './conceiveShapes.js';
import { addToDos_restore, addAllToDo_DOM } from './toDoRow.js';

// Hard ceiling on proposed tasks so a runaway reply can't flood the list. The
// title-only paths (string array / line-split fallback) allow more rows; the
// object path (title + full TODO.md entry) caps lower since each entry is long.
const MAX_TASKS = 20;
const MAX_ENTRY_TASKS = 10;

// Resolve a Conceive project's linked repo so Generate tasks and Suggest plan
// ground their generation in that app's real code instead of the Worker's
// default target. Reads the project's target_id (the same inject_targets
// routing the inject/run path uses) and resolves it to a repo string via the
// targets cache. Degrades to null — no target_id, deleted target, or unwarmed
// cache — in which case the caller passes null and the Worker falls back to
// its default repo (the prior behavior). inject_targets repos are validated
// against the Worker's allowlist at save time, so a resolved repo is always
// allowlisted. Shared by the Generate tasks / Suggest plan tools and the
// Structure view.
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
// from that stage and to return ONLY a JSON array of {title, entry} objects,
// where each entry is a TODO.md backlog entry in the core shape — so each
// generated todo is a pipeline-ready first draft.
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
        'Decompose the ' + actionableLabel + ' above into a set of short, ' +
        'well-scoped tasks for a todo list. Derive tasks ONLY from the ' +
        actionableLabel + '; treat the project context sections above as background ' +
        'for scope and phrasing, never as a source of tasks.'
    );
    lines.push('');
    lines.push(
        'Return ONLY a JSON array of objects — no prose, no code fences, no ' +
        'numbering. Each object has exactly two string fields:'
    );
    lines.push('  { "title": "<short imperative task title>", "entry": "<a TODO.md backlog entry for this task>" }');
    lines.push('');
    lines.push(
        'The "entry" value is a single string holding a TODO.md backlog entry in ' +
        'this exact core shape (literal newlines, two-space-indented sub-bullets):'
    );
    lines.push('- [ ] **[PRIORITY]** <imperative title>');
    lines.push('  - Type: bug | feature');
    lines.push('  - Description: 1-3 concrete sentences');
    lines.push('  - Behavior: the expected result');
    lines.push('  - File: <repo-relative path(s)>');
    lines.push('');
    lines.push(
        'PRIORITY is one of [HIGH], [MEDIUM], or [LOW]; Type is exactly "bug" or ' +
        '"feature". Use real file paths from the project\'s source manifest when ' +
        'available. The "title" should match the entry\'s title.'
    );
    return lines.join('\n');
}

// Parse the Worker reply into an ordered list of proposed tasks, each
// `{ title, entry }`. Strips any ```json code fences and tries JSON.parse
// first:
//   • An array of objects → the title + entry path: use each object's `title`
//     and `entry`, defaulting `entry` to '' when missing/non-string, and
//     skipping objects without a usable title. Capped at MAX_ENTRY_TASKS since
//     entries are long.
//   • An array of strings → titles only: each becomes `{ title, entry: '' }`,
//     capped at MAX_TASKS.
// If parsing fails (or yields a non-array), fall back to splitting the reply
// into non-empty lines with leading `-` / `*` / `1.` markers stripped — titles
// only, `{ title, entry: '' }` — which also absorbs any stray prose the
// Worker's system prompt adds. Capped at MAX_TASKS.
export function parseTasks(reply) {
    if (typeof reply !== 'string') return [];
    const text = reply.replace(/```(?:json)?/gi, '').trim();
    if (!text) return [];

    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) {
            const hasObject = parsed.some(function (t) {
                return t && typeof t === 'object' && !Array.isArray(t);
            });
            if (hasObject) {
                return parsed
                    .filter(function (t) {
                        return t && typeof t === 'object' && typeof t.title === 'string';
                    })
                    .map(function (t) {
                        return {
                            title: t.title.trim(),
                            entry: typeof t.entry === 'string' ? t.entry.trim() : '',
                        };
                    })
                    .filter(function (t) { return t.title; })
                    .slice(0, MAX_ENTRY_TASKS);
            }
            return parsed
                .filter(function (t) { return typeof t === 'string'; })
                .map(function (t) { return { title: t.trim(), entry: '' }; })
                .filter(function (t) { return t.title; })
                .slice(0, MAX_TASKS);
        }
    } catch (e) {
        /* fall through to line-splitting */
    }

    return text
        .split('\n')
        .map(function (line) { return line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim(); })
        .filter(Boolean)
        .map(function (t) { return { title: t, entry: '' }; })
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
    // 'Build plan' for Spec projects, 'Now' for the Iterative board, and 'Next
    // up' for legacy Iterative projects. Resolved by the labels present on the
    // stages so each shape maps correctly regardless of the stored lifecycle.
    const actionableLabel = actionableStageLabelForStages(
        listLogic.getProjectStages(projectName),
        listLogic.getProjectLifecycle(projectName)
    );

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
    // Each row record holds its checkbox plus the proposed task's title and
    // entry markdown, so confirm can recover the entry without re-parsing.
    // Tracks the live count of checked, non-duplicate rows and reflects it on
    // the footer button (label + disabled).
    let rows = [];
    function refreshCount() {
        let n = 0;
        rows.forEach(function (r) {
            if (!r.cb.disabled && r.cb.checked) n += 1;
        });
        addBtn.textContent = 'Add ' + n + ' task' + (n === 1 ? '' : 's');
        addBtn.disabled = n === 0;
    }

    function renderChecklist(tasks) {
        clear(body);
        rows = [];

        if (!tasks.length) {
            renderError('No tasks could be generated from the ' + actionableLabel + '.');
            return;
        }

        const existing = existingTitleSet();
        const seenInList = new Set();
        const list = document.createElement('div');
        list.className = 'seedTasksModalList';

        tasks.forEach(function (task, i) {
            const titleVal = (task.title || '').trim();
            if (!titleVal) return;
            const entryVal = typeof task.entry === 'string' ? task.entry : '';
            const key = titleVal.toLowerCase();
            // Treat a duplicate within the proposed list itself the same as an
            // existing-task dup so the same title can't be added twice.
            const isDup = existing.has(key) || seenInList.has(key);
            seenInList.add(key);

            // Each task is one item: the compact row, plus an optional
            // collapsible entry panel beneath it.
            const item = document.createElement('div');
            item.className = 'seedTasksModalItem';

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
                // Dup rows stay greyed with the "in tasks" tag and no toggle.
                const tag = document.createElement('span');
                tag.className = 'seedTasksModalDupTag';
                tag.textContent = 'in tasks';
                row.appendChild(tag);
                item.appendChild(row);
            } else if (entryVal) {
                // Non-duplicate task with an entry: a per-row Details toggle
                // reveals the entry preformatted (monospace, preserved line
                // breaks), collapsed by default and independent per row.
                const details = document.createElement('pre');
                details.className = 'seedTasksModalDetails';
                details.textContent = entryVal;
                details.hidden = true;

                const toggle = document.createElement('button');
                toggle.type = 'button';
                toggle.className = 'seedTasksModalDetailsToggle';
                toggle.textContent = 'Details ▾';
                toggle.setAttribute('aria-expanded', 'false');
                toggle.addEventListener('click', function (event) {
                    // Prevent the surrounding <label> from toggling the checkbox.
                    event.preventDefault();
                    const willOpen = details.hidden;
                    details.hidden = !willOpen;
                    toggle.textContent = willOpen ? 'Details ▴' : 'Details ▾';
                    toggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
                });

                row.appendChild(toggle);
                item.appendChild(row);
                item.appendChild(details);
            } else {
                // Non-duplicate task with no entry: no toggle.
                item.appendChild(row);
            }

            rows.push({ cb: cb, title: titleVal, entry: entryVal });
            list.appendChild(item);
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
                const tasks = parseTasks(reply);
                if (!tasks.length) {
                    renderError('Couldn’t read any tasks from the reply. Please try again.');
                    return;
                }
                renderChecklist(tasks);
            })
            .catch(function (e) {
                if (closed) return;
                const reason = e && e.reason ? e.reason : 'Something went wrong.';
                renderError('Couldn’t generate tasks: ' + reason);
            });
    }

    // Confirm: create each checked, non-duplicate task as a committed todo in
    // the selected project through the existing add-todo path (saveToStorage +
    // Supabase insert), in list order. When the task carries a TODO.md entry,
    // set it as the todo's description right after create via the existing
    // description-update path (editToDoItem) so the mirror carries it — the
    // add path takes only a title. Then close and switch to Projects so the
    // new tasks are immediately visible.
    addBtn.addEventListener('click', function () {
        const toAdd = rows.filter(function (r) { return !r.cb.disabled && r.cb.checked; });
        if (!toAdd.length) return;
        toAdd.forEach(function (r) {
            listLogic.addToDo(projectName, r.title);
            if (r.entry) {
                const items = listLogic.listItems(projectName) || [];
                // The title is non-duplicate within the project (dups are
                // skipped above), so exactly one item carries it — the one
                // just added. Backfill its description and mirror the update.
                const created = items.filter(function (it) {
                    return it && it.tit === r.title;
                }).pop();
                if (created) {
                    created.desc = r.entry;
                    listLogic.editToDoItem(projectName, created);
                }
            }
        });
        close();
        // Switch to the Projects view via its pill so the wiring stays in
        // main.js (the modal keeps no back-edge into the view switcher).
        const projectsPill = document.getElementById('viewPillProjects');
        if (projectsPill) projectsPill.click();
        // Re-render the seeded project's #mainList once, after the whole
        // batch. The view switch above only flips the visible surface; the
        // list still holds the stale pre-seed rows until a project switch
        // rebuilds it from data, so the new todos wouldn't appear without
        // this. Mirror the project-selection render: clear #mainList, then
        // render the project's items. Post-add the project always has real
        // items (the ones just created), so addToDos_restore renders; the
        // addAllToDo_DOM branch mirrors selection's empty-project case for
        // parity. Done once here — not per row — to avoid render churn.
        const mainList = document.getElementById('mainList');
        if (mainList) {
            clear(mainList);
            const items = listLogic.listItems(projectName);
            const hasRealItems = items && items.some(function (i) { return i.tit !== ''; });
            if (hasRealItems) {
                addToDos_restore(items, projectName);
            } else if (items) {
                addAllToDo_DOM(items, projectName);
            }
        }
    });

    run();
}
