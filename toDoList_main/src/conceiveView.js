import { listLogic } from './listLogic.js';
import { openSeedTasksModal, resolveProjectRepo } from './seedTasksModal.js';
import { chatWithWorker } from './inject.js';
import { actionableStageLabelForStages } from './conceiveShapes.js';

// Static guidance copy shown under each default stage's label — a muted
// one-line prompt describing what belongs in that stage. Keyed by the default
// stage labels across both shapes (Spec: Why / Concept / Requirements / Design
// / Build plan; Iterative: Why / Concept / Next up / Iterations). This is pure
// presentation, never stored on the stage objects, never persisted or synced,
// and never part of any text sent to Claude. A stage whose label isn't a key
// here renders no hint.
const STAGE_HINTS = {
    'Why': 'Who is it for, and what problem does it solve?',
    'Concept': 'In a sentence or two, what is it and how does it work?',
    'Requirements': "What must it do? Key capabilities, constraints, and what's out of scope.",
    'Design': 'How does it look and work — UI, data model, and tech choices?',
    'Build plan': 'The ordered steps to build it; each line becomes a task.',
    'Next up': "The slice you're building right now; each line becomes a task.",
    'Iterations': 'A running log of what you’ve added, removed, and why.',
    // Iterative board labels. The board renderer draws its own lanes rather than
    // stage sections, but these keep the hints in one place (and cover the
    // fallback stage renderer for any board stage rendered outside the board).
    'North star': 'One sentence: what is it, and who is it for?',
    'Now': "What you're building right now; each line becomes a task.",
    'Next': 'What comes after Now.',
    'Later': 'Ideas and someday-maybes; capture them here.',
};

// The Iterative board's three lanes, top to bottom, and the promote target for
// each card: a Later card moves up to Next, a Next card up to Now. The Now lane
// is the actionable task source and has no promote target.
const BOARD_LANE_LABELS = ['Now', 'Next', 'Later'];
const LANE_PROMOTE_TARGET = { 'Next': 'Now', 'Later': 'Next' };

// The auto-managed board log stage (see listLogic.appendConceiveLogEntry). It is
// display-only here — never rendered as a lane, excluded from pristine detection
// and the lane renderers — and its records are read via listLogic.getConceiveLog.
const SHIPPED_STAGE_LABEL = 'Shipped';

// Per-project localStorage key for the Shipped section's collapse state, under
// the app's `todoapp_` prefix and mirroring the TODO.md viewer's expand key.
// This is pure UI state (not the data model), so it lives here rather than in
// listLogic — the only localStorage this view touches.
const SHIPPED_OPEN_PREFIX = 'todoapp_conceiveShippedOpen_';

function shippedOpenKey(projectName) {
    return SHIPPED_OPEN_PREFIX + encodeURIComponent(projectName || '');
}
function readShippedOpen(projectName) {
    try {
        return localStorage.getItem(shippedOpenKey(projectName)) === '1';
    } catch (e) { return false; }
}
function writeShippedOpen(projectName, open) {
    try {
        localStorage.setItem(shippedOpenKey(projectName), open ? '1' : '0');
    } catch (e) { /* private mode — collapse state falls back to default */ }
}

// Build the "Suggest plan" prompt from the project's non-empty upstream stages
// (every stage except the actionable one). Each is labeled so the model can map
// intent to phase; the instruction asks for a concrete, ordered build plan as
// plain text — a short numbered list of implementation steps, one per line,
// with no surrounding prose — because the result is written straight into the
// actionable stage's textarea (it is NOT JSON, unlike the seed-tasks decompose
// call).
function buildSuggestPlanPrompt(stages, actionableLabel) {
    const upstream = stages.filter(function (s) {
        return s.label !== actionableLabel && s.body && s.body.trim();
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
// no back-edge into main.js. All data-model persistence routes through
// listLogic.js; the only localStorage this module touches is the Shipped
// section's per-project collapse flag (pure UI state). The selected project is resolved
// the same way the Projects view does: the `.selectedProject` sidebar row
// and its `#projInput` value.

// Track which stage sections are expanded, keyed by stage id, so a re-render
// (after a save, or after the selected project changes) preserves the
// open/closed state the user set. Stage ids are unique per project, so the
// set never collides across projects.
let expandedStageIds = new Set();

// Track which board lanes are in raw-edit mode (the escape hatch that swaps the
// card view for the stage-body textarea), keyed by stage id. Module-level so it
// survives the full re-render each board mutation triggers. Stage ids are unique
// per project, so the set never collides across projects.
let editingStageIds = new Set();

// Track which Shipped-log records have their summary panel expanded, keyed by
// record id. Module-level so it survives the full re-render each board mutation
// triggers, but ephemeral by design (not persisted) — it resets on reload, as
// the spec requires. Record ids are the run entry markers, unique per run.
let expandedShippedIds = new Set();

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// A project is "pristine" while every one of its stage bodies is still empty
// (after trimming). Pristine is COMPUTED from the live stages on each render —
// never stored — so it naturally covers brand-new projects and any untouched
// existing one, and naturally excludes anything with written content. The
// shape chooser is offered only while pristine, which is what makes switching
// shapes non-destructive: there is never written text to lose.
function isProjectPristine(stages) {
    if (!Array.isArray(stages) || stages.length === 0) return false;
    // The auto-managed Shipped stage is never user content, so a populated log
    // must not make a project read as non-pristine (nor an empty one count as a
    // stage). Exclude it from the check entirely.
    return stages
        .filter(function (s) { return s && s.label !== SHIPPED_STAGE_LABEL; })
        .every(function (s) { return !(s.body && s.body.trim()); });
}

// The one-time Iterative | Spec shape chooser, rendered above the stages while
// the project is pristine. A segmented control reflects the project's current
// shape; tapping the inactive option reseeds the project's stages to that shape
// (via listLogic.setProjectShape) and re-renders. Legacy 'SDLC' projects show
// Spec active. The chooser disappears the moment any stage body has text.
function buildShapeChooser(projectName, lifecycle) {
    const wrap = document.createElement('div');
    wrap.className = 'conceiveShapeChooser';

    const seg = document.createElement('div');
    seg.className = 'conceiveShapeSegment';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Conceive stage shape');

    // 'spec' and the legacy 'SDLC' alias map to the Spec option; everything
    // else (including 'iterative' and any unset value) maps to Iterative.
    const isSpec = (lifecycle === 'spec' || lifecycle === 'SDLC');
    const options = [
        { shape: 'iterative', label: 'Iterative', active: !isSpec },
        { shape: 'spec', label: 'Spec', active: isSpec },
    ];
    options.forEach(function (opt) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'conceiveShapeOption';
        if (opt.active) btn.classList.add('active');
        btn.textContent = opt.label;
        btn.setAttribute('aria-pressed', opt.active ? 'true' : 'false');
        if (!opt.active) {
            btn.addEventListener('click', function () {
                listLogic.setProjectShape(projectName, opt.shape);
                renderConceiveView();
            });
        }
        seg.appendChild(btn);
    });
    wrap.appendChild(seg);

    const hint = document.createElement('p');
    hint.className = 'conceiveShapeHint';
    hint.textContent = 'Switches the stages — pick before you start; disappears once you write anything.';
    wrap.appendChild(hint);

    return wrap;
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
function buildStageSection(projectName, stage, actionableLabel) {
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

    // The actionable stage (Build plan for Spec projects, Next up for
    // Iterative ones) gets a "Generate tasks" action in its header — it
    // decomposes the plan into todos via the in-app Claude. A nested <button>
    // inside the header <button> would be invalid markup, so the header lives
    // in a flex row alongside the action. Enabled only when the stage body is
    // non-empty; its disabled state tracks edits via persist() below.
    let genBtn = null;
    let suggestBtn = null;
    if (stage.label === actionableLabel) {
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
        suggestBtn.setAttribute('aria-label', 'Suggest a plan from the other stages');
        const hasUpstream = listLogic.getProjectStages(projectName).some(function (s) {
            return s.label !== actionableLabel && s.body && s.body.trim();
        });
        suggestBtn.disabled = !hasUpstream;
        if (!hasUpstream) {
            suggestBtn.title = 'Fill in a stage above first';
        }
        headerRow.appendChild(suggestBtn);

        genBtn = document.createElement('button');
        genBtn.type = 'button';
        genBtn.className = 'conceiveGenerateTasksBtn';
        genBtn.textContent = 'Generate tasks';
        genBtn.setAttribute('aria-label', 'Generate tasks from this stage');
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
            const prompt = buildSuggestPlanPrompt(stages, actionableLabel);
            // One-off messages array so the live chat conversation is never
            // touched; repo is the project's linked repo (or null → Worker
            // default when unlinked), grounding the plan draft in that app's
            // actual code. The trailing `true` is the deep flag — synthesis-
            // from-context runs on the heavier model.
            chatWithWorker([{ role: 'user', content: prompt }], undefined, undefined, resolveProjectRepo(projectName), undefined, true)
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

// ── ITERATIVE DIRECTION BOARD ────────────────────────────────────────
// A board-shaped renderer for Iterative projects (any project whose stages
// include a "Now" lane). It replaces the collapsible stage sections with a
// one-line North star plus three lanes (Now / Next / Later) whose bodies stay
// plain text in the existing stage data model — each non-empty line of a lane's
// body renders as one card. Cards in Next and Later carry a promote control
// (up one lane); every lane has an Edit affordance that swaps the cards for the
// raw stage-body textarea (the escape hatch for reordering, demoting, deleting).
// A quick-capture input at the bottom appends to Later. All writes route
// through listLogic — setProjectStageBody for edits/capture, promoteStageLine
// for card promotion — exactly like the stage renderer.

// Split a lane body into its non-empty lines, each tagged with its raw index in
// the body (so promotion targets the exact line even with duplicates).
function laneCardLines(body) {
    const cards = [];
    (body || '').split('\n').forEach(function (line, index) {
        if (line && line.trim()) cards.push({ index: index, text: line.trim() });
    });
    return cards;
}

// The one-line North star: a single editable sentence under the header,
// autosaving through the same setProjectStageBody path stage bodies use.
function buildNorthStar(projectName, stage) {
    const wrap = document.createElement('div');
    wrap.className = 'conceiveNorthStar';
    wrap.setAttribute('data-stage-id', stage.id);

    const label = document.createElement('label');
    label.className = 'conceiveNorthStarLabel';
    label.textContent = 'North star';
    label.setAttribute('for', 'conceiveNorthStarInput');
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'conceiveNorthStarInput';
    input.className = 'conceiveNorthStarInput';
    input.value = stage.body || '';
    input.placeholder = STAGE_HINTS['North star'] || '';
    input.setAttribute('aria-label', 'North star');

    let debounce = null;
    function persist() {
        listLogic.setProjectStageBody(projectName, stage.id, input.value);
    }
    input.addEventListener('input', function () {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(persist, 400);
    });
    input.addEventListener('blur', function () {
        if (debounce) { clearTimeout(debounce); debounce = null; }
        persist();
    });
    wrap.appendChild(input);
    return wrap;
}

// The raw stage-body editor shown inside a lane while it's in edit mode — the
// same autosaving textarea the stage renderer uses, so it's the escape hatch
// for reordering / demoting / deleting lines the cards can't do.
function buildLaneEditor(projectName, stage) {
    const editor = document.createElement('div');
    editor.className = 'conceiveLaneEditor';

    const textarea = document.createElement('textarea');
    textarea.className = 'conceiveStageInput';
    textarea.value = stage.body || '';
    textarea.setAttribute('aria-label', stage.label + ' lines');
    textarea.rows = 5;

    let debounce = null;
    function persist() {
        listLogic.setProjectStageBody(projectName, stage.id, textarea.value);
    }
    textarea.addEventListener('input', function () {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(persist, 400);
    });
    textarea.addEventListener('blur', function () {
        if (debounce) { clearTimeout(debounce); debounce = null; }
        persist();
    });
    editor.appendChild(textarea);
    return editor;
}

// The card view of a lane: one card per non-empty line. Cards in Next/Later get
// a promote button that relocates the exact line up one lane in a single
// listLogic mutation, then re-renders so the card lands in its new lane.
function buildLaneCards(projectName, stage) {
    const list = document.createElement('div');
    list.className = 'conceiveLaneCards';

    const lines = laneCardLines(stage.body);
    if (lines.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'conceiveLaneEmpty';
        empty.textContent = 'Nothing here yet.';
        list.appendChild(empty);
        return list;
    }

    const targetLabel = LANE_PROMOTE_TARGET[stage.label];
    lines.forEach(function (line) {
        const card = document.createElement('div');
        card.className = 'conceiveCard';

        const text = document.createElement('span');
        text.className = 'conceiveCardText';
        text.textContent = line.text;
        card.appendChild(text);

        if (targetLabel) {
            const promote = document.createElement('button');
            promote.type = 'button';
            promote.className = 'conceiveCardPromoteBtn';
            promote.textContent = '↑ ' + targetLabel;
            promote.setAttribute('aria-label', 'Promote to ' + targetLabel);
            promote.title = 'Move to ' + targetLabel;
            promote.addEventListener('click', function (event) {
                event.stopPropagation();
                const target = listLogic.getProjectStages(projectName).find(function (s) {
                    return s.label === targetLabel;
                });
                if (!target) return;
                listLogic.promoteStageLine(projectName, stage.id, target.id, line.index);
                renderConceiveView();
            });
            card.appendChild(promote);
        }
        list.appendChild(card);
    });
    return list;
}

// Wire the Now lane's "Suggest plan" button: drafts the Now body from the
// upstream stages (North star / Next / Later) via Claude and, on success,
// writes it through setProjectStageBody and re-renders so the drafted lines land
// as cards. The lane's Edit mode is the undo/adjust escape hatch, so this keeps
// a lean inline status (overwrite-confirm + error) rather than the stage
// renderer's undo/regenerate footer.
function attachBoardSuggest(projectName, stage, actionableLabel, suggestBtn, statusEl) {
    function clearStatus() { clear(statusEl); }

    function showError(message) {
        clearStatus();
        const err = document.createElement('div');
        err.className = 'conceiveSuggestError';
        err.textContent = message;
        statusEl.appendChild(err);
    }

    function currentBody() {
        const s = listLogic.getProjectStages(projectName).find(function (x) {
            return x.id === stage.id;
        });
        return s ? (s.body || '') : '';
    }

    function fetchPlan() {
        clearStatus();
        suggestBtn.disabled = true;
        const priorLabel = suggestBtn.textContent;
        suggestBtn.textContent = 'Suggesting…';

        const stages = listLogic.getProjectStages(projectName) || [];
        const prompt = buildSuggestPlanPrompt(stages, actionableLabel);
        chatWithWorker([{ role: 'user', content: prompt }], undefined, undefined, resolveProjectRepo(projectName), undefined, true)
            .then(function (res) {
                const reply = res && typeof res.reply === 'string' ? res.reply : '';
                const text = parsePlanText(reply);
                if (!text) {
                    suggestBtn.textContent = priorLabel;
                    suggestBtn.disabled = false;
                    showError('Couldn’t draft a plan. Please try again.');
                    return;
                }
                // Re-render paints the drafted lines as Now cards; no need to
                // restore the button (the node is replaced).
                listLogic.setProjectStageBody(projectName, stage.id, text);
                renderConceiveView();
            })
            .catch(function (e) {
                suggestBtn.textContent = priorLabel;
                suggestBtn.disabled = false;
                const reason = e && e.reason ? e.reason : 'Something went wrong.';
                showError('Couldn’t draft a plan: ' + reason);
            });
    }

    function runSuggest() {
        const cur = currentBody();
        if (cur && cur.trim()) {
            clearStatus();
            const confirmRow = document.createElement('div');
            confirmRow.className = 'conceiveSuggestConfirm';

            const msg = document.createElement('span');
            msg.className = 'conceiveSuggestConfirmMsg';
            msg.textContent = 'Replace the current Now plan?';
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

            statusEl.appendChild(confirmRow);
            return;
        }
        fetchPlan();
    }

    suggestBtn.addEventListener('click', function (event) {
        event.stopPropagation();
        if (suggestBtn.disabled) return;
        runSuggest();
    });
}

// One lane: header (label + actions), the Now lane's suggest status, then either
// the cards or the raw editor depending on edit mode. The Now lane (the
// actionable task source) additionally carries the Suggest plan and Generate
// tasks actions, targeting the Now stage.
function buildLane(projectName, stage, actionableLabel) {
    const lane = document.createElement('div');
    lane.className = 'conceiveLane';
    lane.setAttribute('data-stage-id', stage.id);
    lane.setAttribute('data-lane', stage.label);
    const isNow = stage.label === actionableLabel;
    if (isNow) lane.classList.add('conceiveLane--now');

    const header = document.createElement('div');
    header.className = 'conceiveLaneHeader';

    const label = document.createElement('span');
    label.className = 'conceiveLaneLabel';
    label.textContent = stage.label;
    header.appendChild(label);

    const actions = document.createElement('div');
    actions.className = 'conceiveLaneActions';

    let suggestBtn = null;
    if (isNow) {
        suggestBtn = document.createElement('button');
        suggestBtn.type = 'button';
        suggestBtn.className = 'conceiveSuggestPlanBtn';
        suggestBtn.textContent = 'Suggest plan';
        suggestBtn.setAttribute('aria-label', 'Suggest a plan from the other stages');
        const hasUpstream = listLogic.getProjectStages(projectName).some(function (s) {
            return s.label !== actionableLabel && s.body && s.body.trim();
        });
        suggestBtn.disabled = !hasUpstream;
        if (!hasUpstream) suggestBtn.title = 'Fill in another stage first';
        actions.appendChild(suggestBtn);

        const genBtn = document.createElement('button');
        genBtn.type = 'button';
        genBtn.className = 'conceiveGenerateTasksBtn';
        genBtn.textContent = 'Generate tasks';
        genBtn.setAttribute('aria-label', 'Generate tasks from this stage');
        genBtn.disabled = !(stage.body && stage.body.trim());
        genBtn.addEventListener('click', function (event) {
            event.stopPropagation();
            openSeedTasksModal(projectName);
        });
        actions.appendChild(genBtn);
    }

    const editing = editingStageIds.has(stage.id);
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'conceiveLaneEditBtn';
    editBtn.textContent = editing ? 'Done' : 'Edit';
    editBtn.setAttribute('aria-pressed', editing ? 'true' : 'false');
    editBtn.addEventListener('click', function () {
        if (editingStageIds.has(stage.id)) editingStageIds.delete(stage.id);
        else editingStageIds.add(stage.id);
        renderConceiveView();
    });
    actions.appendChild(editBtn);

    header.appendChild(actions);
    lane.appendChild(header);

    let statusEl = null;
    if (isNow) {
        statusEl = document.createElement('div');
        statusEl.className = 'conceiveSuggestStatus';
        lane.appendChild(statusEl);
    }

    lane.appendChild(
        editing ? buildLaneEditor(projectName, stage) : buildLaneCards(projectName, stage)
    );

    if (isNow && suggestBtn) {
        attachBoardSuggest(projectName, stage, actionableLabel, suggestBtn, statusEl);
    }
    return lane;
}

// The quick-capture input pinned at the bottom of the board: pressing Enter
// appends the text as a new line on the Later stage body (the normal stage-edit
// path) and re-renders so it shows immediately as a Later card.
function buildQuickCapture(projectName, laterStage) {
    const wrap = document.createElement('div');
    wrap.className = 'conceiveQuickCapture';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'conceiveQuickCaptureInput';
    input.placeholder = 'Capture an idea → Later';
    input.setAttribute('aria-label', 'Quick capture to Later');

    input.addEventListener('keydown', function (event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const text = (input.value || '').trim();
        if (!text) return;
        const stage = listLogic.getProjectStages(projectName).find(function (s) {
            return s.id === laterStage.id;
        });
        const cur = stage ? (stage.body || '') : '';
        const next = (cur && cur.trim())
            ? cur.replace(/\s*$/, '') + '\n' + text
            : text;
        listLogic.setProjectStageBody(projectName, laterStage.id, next);
        renderConceiveView();
        const fresh = document.querySelector('.conceiveQuickCaptureInput');
        if (fresh) fresh.focus();
    });

    wrap.appendChild(input);
    return wrap;
}

// One record row inside the Shipped section: a header (title + date) with a
// verdict-colored left border, and a per-row summary panel that expands inline
// on tap — the same accordion vocabulary as the Runs tab. Display-only: no
// promote, edit, or delete. Summary-expand state is ephemeral (module set).
function buildShippedRow(record) {
    const row = document.createElement('div');
    const verdict = record.verdict === 'nochange' ? 'nochange' : 'shipped';
    row.className = 'conceiveShippedRow conceiveShippedRow--' + verdict;

    const head = document.createElement('div');
    head.className = 'conceiveShippedRowHead';

    const title = document.createElement('span');
    title.className = 'conceiveShippedRowTitle';
    title.textContent = record.title || 'Untitled entry';
    title.title = record.title || '';
    head.appendChild(title);

    if (record.date) {
        const date = document.createElement('span');
        date.className = 'conceiveShippedRowDate';
        date.textContent = record.date;
        head.appendChild(date);
    }
    row.appendChild(head);

    const summary = document.createElement('div');
    summary.className = 'conceiveShippedSummary';
    summary.textContent = (record.summary && record.summary.trim())
        ? record.summary.trim()
        : 'No run summary was recorded.';

    const hasId = !!record.id;
    let expanded = hasId && expandedShippedIds.has(record.id);
    summary.hidden = !expanded;
    row.appendChild(summary);

    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-expanded', String(expanded));
    const toggle = function () {
        expanded = !expanded;
        summary.hidden = !expanded;
        row.setAttribute('aria-expanded', String(expanded));
        row.classList.toggle('conceiveShippedRow--expanded', expanded);
        if (hasId) {
            if (expanded) expandedShippedIds.add(record.id);
            else expandedShippedIds.delete(record.id);
        }
    };
    row.classList.toggle('conceiveShippedRow--expanded', expanded);
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
        }
    });
    return row;
}

// The auto-managed, collapsed-by-default "Shipped" section pinned at the bottom
// of the board. A header row (mono label + count + chevron) toggles a
// newest-first list of run log records. Returns null when the project has no
// logged runs — an empty section is noise. The section-collapse state persists
// per-project; per-record summary expand is ephemeral.
function buildShippedSection(projectName) {
    const records = listLogic.getConceiveLog(projectName);
    if (!records.length) return null;

    const section = document.createElement('div');
    section.className = 'conceiveShipped';

    let open = readShippedOpen(projectName);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'conceiveShippedHeader';
    header.setAttribute('aria-expanded', String(open));

    const chevron = document.createElement('span');
    chevron.className = 'conceiveShippedChevron';
    chevron.textContent = open ? '▾' : '▸';
    chevron.setAttribute('aria-hidden', 'true');
    header.appendChild(chevron);

    const label = document.createElement('span');
    label.className = 'conceiveShippedLabel';
    label.textContent = 'Shipped';
    header.appendChild(label);

    const count = document.createElement('span');
    count.className = 'conceiveShippedCount';
    count.textContent = String(records.length);
    header.appendChild(count);

    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'conceiveShippedList';
    list.hidden = !open;
    records.forEach(function (record) {
        list.appendChild(buildShippedRow(record));
    });
    section.appendChild(list);

    header.addEventListener('click', function () {
        open = !open;
        list.hidden = !open;
        chevron.textContent = open ? '▾' : '▸';
        header.setAttribute('aria-expanded', String(open));
        writeShippedOpen(projectName, open);
    });

    return section;
}

// Assemble the whole board for an Iterative project: North star, the three
// lanes in order, quick-capture, then the auto-managed Shipped log (when the
// project has logged runs). Falls back gracefully if a lane stage is somehow
// absent.
function buildBoardView(projectName, stages, actionableLabel) {
    const board = document.createElement('div');
    board.className = 'conceiveBoard';

    const northStar = stages.find(function (s) { return s.label === 'North star'; });
    if (northStar) board.appendChild(buildNorthStar(projectName, northStar));

    BOARD_LANE_LABELS.forEach(function (laneLabel) {
        const stage = stages.find(function (s) { return s.label === laneLabel; });
        if (stage) board.appendChild(buildLane(projectName, stage, actionableLabel));
    });

    const later = stages.find(function (s) { return s.label === 'Later'; });
    if (later) board.appendChild(buildQuickCapture(projectName, later));

    const shipped = buildShippedSection(projectName);
    if (shipped) board.appendChild(shipped);

    return board;
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

    const stages = listLogic.getProjectStages(projectName);

    // The actionable stage (the task source) depends on the project's shape —
    // 'Now' for the Iterative board, 'Build plan' for Spec, 'Next up' for legacy
    // Iterative projects. Resolve it by the labels present so every stage/lane
    // knows whether it owns the Generate-tasks / Suggest-plan actions.
    const actionableLabel = actionableStageLabelForStages(
        stages,
        listLogic.getProjectLifecycle(projectName)
    );

    // While the project is pristine (no stage written yet), offer the one-time
    // shape chooser above the stages. Once any stage has text it disappears and
    // the shape is locked — switching is non-destructive by construction.
    if (isProjectPristine(stages)) {
        view.appendChild(
            buildShapeChooser(projectName, listLogic.getProjectLifecycle(projectName))
        );
    }

    // Iterative projects render as a direction board (any project whose stages
    // include a "Now" lane); every other shape — Spec and legacy Iterative —
    // falls back to the collapsible stage sections.
    const isBoard = stages.some(function (s) { return s.label === 'Now'; });
    if (isBoard) {
        view.appendChild(buildBoardView(projectName, stages, actionableLabel));
        return;
    }

    const stagesEl = document.createElement('div');
    stagesEl.className = 'conceiveStages';
    stages.forEach(function (stage) {
        stagesEl.appendChild(buildStageSection(projectName, stage, actionableLabel));
    });
    view.appendChild(stagesEl);
}
