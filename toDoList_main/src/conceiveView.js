import {
    getAllConcepts,
    getConcept,
    createConcept,
    renameConcept,
    deleteConcept,
    setStageBody,
} from './conceptsLogic.js';
import { showConfirmModal } from './modals.js';

// The CONCEIVE view: a place to incubate a project idea before it becomes a
// real project, walking it through lifecycle stages. The view has two surfaces
// toggled by an internal mode (NOT a new top-level view): a concept index
// (list + "+ New concept" + empty state) and a single-concept editor (the
// concept's ordered stages as collapsible sections with a filled/empty status
// dot and an editable multi-line body).
//
// Like inboxView.js / calendarView.js this cluster reaches the DOM via
// getElementById/createElement at call time and only exports renderConceiveView
// — there is no back-edge into main.js. All persistence routes through
// conceptsLogic.js; this module never touches localStorage.

// Which concept's editor is open. null → render the index. Module-level so the
// index↔editor swap survives re-renders; a tab switch away and back resets to
// the index (renderConceiveView starts here and only opens the editor when a
// concept row is tapped), which is acceptable per the entry's scope.
let openConceptId = null;

// Track which stage sections are expanded in the editor, keyed by stage id, so
// a re-render (e.g. after a save) preserves the open/closed state the user set.
let expandedStageIds = new Set();

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// ── Concept index ──
// Saved concepts newest-first (conceptsLogic orders by pos, new at top), a
// "+ New concept" action, and an empty state when there are none. Each row
// opens the editor on tap and carries rename + delete affordances (delete is
// confirmation-gated per the destructive-action convention).
function renderIndex(view) {
    const header = document.createElement('div');
    header.className = 'conceiveIndexHeader';

    const heading = document.createElement('h2');
    heading.className = 'conceiveIndexTitle';
    heading.textContent = 'Conceive';
    header.appendChild(heading);

    const newBtn = document.createElement('button');
    newBtn.type = 'button';
    newBtn.className = 'conceiveNewBtn';
    newBtn.textContent = '+ New concept';
    newBtn.addEventListener('click', function () {
        const concept = createConcept('');
        openConceptId = concept.id;
        expandedStageIds = new Set();
        renderConceiveView();
    });
    header.appendChild(newBtn);
    view.appendChild(header);

    const concepts = getAllConcepts();

    if (!concepts.length) {
        const empty = document.createElement('div');
        empty.className = 'conceiveEmptyState';
        empty.textContent =
            'No concepts yet. Start one to incubate an idea through its lifecycle before it becomes a project.';
        view.appendChild(empty);
        return;
    }

    const list = document.createElement('div');
    list.className = 'conceiveList';
    concepts.forEach(function (concept) {
        list.appendChild(buildConceptRow(concept));
    });
    view.appendChild(list);
}

function buildConceptRow(concept) {
    const row = document.createElement('div');
    row.className = 'conceiveRow';
    row.setAttribute('data-concept-id', concept.id);

    // The tappable body (title + lifecycle chip) opens the editor. Exposed as
    // a button so keyboard / assistive-tech users get the same affordance.
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'conceiveRowOpen';
    open.setAttribute('aria-label', 'Open concept: ' + (concept.title || 'Untitled concept'));

    const title = document.createElement('span');
    title.className = 'conceiveRowTitle';
    title.textContent = concept.title || 'Untitled concept';
    open.appendChild(title);

    const chip = document.createElement('span');
    chip.className = 'conceiveLifecycleChip';
    chip.textContent = concept.lifecycle || 'SDLC';
    open.appendChild(chip);

    open.addEventListener('click', function () {
        openConceptId = concept.id;
        expandedStageIds = new Set();
        renderConceiveView();
    });
    row.appendChild(open);

    const actions = document.createElement('div');
    actions.className = 'conceiveRowActions';

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'conceiveRowRename';
    renameBtn.textContent = 'Rename';
    renameBtn.setAttribute('aria-label', 'Rename concept');
    renameBtn.addEventListener('click', function () {
        startInlineRename(row, concept);
    });
    actions.appendChild(renameBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'conceiveRowDelete';
    deleteBtn.textContent = 'Delete';
    deleteBtn.setAttribute('aria-label', 'Delete concept');
    deleteBtn.addEventListener('click', function () {
        showConfirmModal({
            message: 'Delete "' + (concept.title || 'Untitled concept') +
                '"? The concept and all of its stage content will be lost.',
            confirmLabel: 'Delete',
            onConfirm: function () {
                deleteConcept(concept.id);
                if (openConceptId === concept.id) openConceptId = null;
                renderConceiveView();
            },
        });
    });
    actions.appendChild(deleteBtn);

    row.appendChild(actions);
    return row;
}

// Swap a concept row's title for a single-line input; Enter or blur commits
// through renameConcept, Escape reverts. Lives in the index so a concept can
// be renamed without opening its editor.
function startInlineRename(row, concept) {
    const open = row.querySelector('.conceiveRowOpen');
    if (!open) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'conceiveRenameInput';
    input.value = concept.title || '';
    input.setAttribute('aria-label', 'Concept title');

    let done = false;
    function commit(save) {
        if (done) return;
        done = true;
        if (save) renameConcept(concept.id, input.value.trim());
        renderConceiveView();
    }
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
    });
    input.addEventListener('blur', function () { commit(true); });

    row.replaceChild(input, open);
    input.focus();
    input.select();
}

// ── Concept editor ──
// The concept's stages rendered in stored order as collapsible sections, each
// with a filled/empty status dot and a multi-line body that autosaves on
// change (debounced) and on blur. The lifecycle label shows as a chip beside
// the title; a back affordance returns to the index.
function renderEditor(view, concept) {
    const header = document.createElement('div');
    header.className = 'conceiveEditorHeader';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'conceiveBackBtn';
    back.textContent = '‹ Concepts';
    back.setAttribute('aria-label', 'Back to concepts');
    back.addEventListener('click', function () {
        openConceptId = null;
        renderConceiveView();
    });
    header.appendChild(back);

    const titleRow = document.createElement('div');
    titleRow.className = 'conceiveEditorTitleRow';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'conceiveEditorTitle';
    titleInput.value = concept.title || '';
    titleInput.placeholder = 'Untitled concept';
    titleInput.setAttribute('aria-label', 'Concept title');
    titleInput.addEventListener('change', function () {
        renameConcept(concept.id, titleInput.value.trim());
    });
    titleInput.addEventListener('blur', function () {
        renameConcept(concept.id, titleInput.value.trim());
    });
    titleRow.appendChild(titleInput);

    const chip = document.createElement('span');
    chip.className = 'conceiveLifecycleChip';
    chip.textContent = concept.lifecycle || 'SDLC';
    titleRow.appendChild(chip);

    header.appendChild(titleRow);
    view.appendChild(header);

    const stages = document.createElement('div');
    stages.className = 'conceiveStages';
    (concept.stages || []).forEach(function (stage) {
        stages.appendChild(buildStageSection(concept, stage));
    });
    view.appendChild(stages);
}

function buildStageSection(concept, stage) {
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
    section.appendChild(head);

    const body = document.createElement('div');
    body.className = 'conceiveStageBody';

    const textarea = document.createElement('textarea');
    textarea.className = 'conceiveStageInput';
    textarea.value = stage.body || '';
    textarea.setAttribute('aria-label', stage.label + ' notes');
    textarea.rows = 4;

    // Autosave: debounce on input so rapid typing isn't a write per keystroke,
    // and commit immediately on blur. Both route through setStageBody; the
    // status dot is refreshed in place without a full re-render so focus and
    // the textarea's caret position are preserved.
    let debounce = null;
    function persist() {
        setStageBody(concept.id, stage.id, textarea.value);
        const nowFilled = !!(textarea.value && textarea.value.trim());
        dot.classList.toggle('filled', nowFilled);
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

// Render the CONCEIVE view: the index when no concept is open, otherwise the
// single-concept editor. Safe to call before component() has built the shell
// (a missing #conceiveView short-circuits). If the open concept was deleted
// out from under us, fall back to the index.
export function renderConceiveView() {
    const view = document.getElementById('conceiveView');
    if (!view) return;
    clear(view);

    const concept = openConceptId ? getConcept(openConceptId) : null;
    if (concept) {
        renderEditor(view, concept);
    } else {
        openConceptId = null;
        renderIndex(view);
    }
}
