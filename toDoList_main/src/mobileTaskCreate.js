// STACK mobile inline-expand task creation — chip row + session-scoped
// state shared across chained commits within a single project visit.
//
// The dashed `+ Add a task…` placeholder row at the top of every project
// expands inline on focus at the ≤1023px breakpoint to reveal a chip row
// (Today / Tomorrow / calendar / `+ ¶` description toggle). The user's
// last picked date chip persists across chained Return-commits so the
// next blank placeholder lands with the same preference, but a project
// switch or page load resets the selection to Today — per the STACK
// spec, "Today" must not survive a reload, which is why this state lives
// here in a module-level variable rather than in localStorage.
//
// `applyChosenDueToItem` is the single write-through path the row-commit
// handler in toDoRow.js calls; the chip handlers themselves only update
// the session state + visual highlight so the user can re-pick before
// committing.

import { setRowDateOffset, showDueDatePopover } from './dueDate.js';
import { showInjectToast, extractTasksFromWorker, getCachedTargets } from './inject.js';
import { parsePastedEntry } from './entryParse.js';
import { refreshViewerExpandedHeight } from './todoMdViewer.js';
import { mountMicButton, isDictating, stopDictation } from './voiceInput.js';
import { listLogic } from './listLogic.js';
import { activeProjectNameForViewer } from './runState.js';

// Re-exported so existing importers (and tests) can keep reaching the parser
// through this module; the single implementation now lives in entryParse.js,
// shared with the chat reply "Create task" action.
export { parsePastedEntry };

// Monochrome clipboard glyph for the paste-entry trigger. Mirrors the mic's
// build (voiceInput.js) — same 24×24 viewBox, fill:none, stroke:currentColor,
// 2px round strokes — so the two controls read as one icon set. No width/height
// baked in: the .addTaskPasteChip CSS sizes it to match the mic. Because it
// inherits currentColor, the chip's hover / focus / open-state (createChipSelected)
// treatments carry to the glyph for free.
const PASTE_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true">' +
    '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>' +
    '<rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect></svg>';

// Monochrome calendar glyph for the "pick a date" chip. Same 24×24 viewBox,
// fill:none, stroke:currentColor, 2px round strokes as PASTE_SVG and the mic,
// so the chip recolors with the theme and the accent-filled selected state
// instead of the flat-color 📅 emoji it replaces. width/height baked in at
// 18 so the glyph sits centered in the .calChip touch target.
const CAL_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>' +
    '<line x1="16" y1="2" x2="16" y2="6"></line>' +
    '<line x1="8" y1="2" x2="8" y2="6"></line>' +
    '<line x1="3" y1="10" x2="21" y2="10"></line></svg>';


// "today" | "tomorrow" | "custom" — the user's last chip pick within the
// current project visit. Reset by resetMobileCreateSession on every
// project switch and on app launch (module is freshly loaded on boot).
let chosenDueChip = 'today';

// True once the user has committed at least one todo on mobile in the
// current project session. Drives the "Type the next…" placeholder swap
// on subsequent blank placeholders built after the first commit.
let chainingActive = false;


export function resetMobileCreateSession() {
    chosenDueChip = 'today';
    chainingActive = false;
}


export function markChainingActive() {
    chainingActive = true;
}


export function isChainingActive() {
    return chainingActive;
}


export function getChosenDueChip() {
    return chosenDueChip;
}


// Stamp the item's due date based on the current session chip, when the
// item doesn't already carry one. 'today' → today, 'tomorrow' → today+1.
// 'custom' is a no-op here — the user either picked a date via the
// popover (in which case item.due is already set) or dismissed it
// without selection (in which case the caller's existing fallback runs).
export function applyChosenDueToItem(item, row) {
    if (!item || !row) return;
    if (chosenDueChip === 'today') {
        setRowDateOffset(item, row, 0);
    } else if (chosenDueChip === 'tomorrow') {
        setRowDateOffset(item, row, 1);
    }
}


function isMobileViewport() {
    return typeof window !== 'undefined' && window.innerWidth < 1024;
}


// Parse the collected text and commit a task through the same Enter path a
// typed title uses — so the committed row gets its status badge, a fresh blank
// placeholder, and persistence. The title input carries the parsed headline;
// item.desc carries the full entry (the commit handler reads the title from the
// input and never touches desc, so the value set here survives). Returns true
// when a task was committed. A carried marker still surfaces the existing toast.
function commitParsedEntry(toDoChild, item, raw) {
    const parsed = parsePastedEntry(raw);
    if (!parsed.title) return false;
    const toDoInput = toDoChild.querySelector('#toDoInput');
    item.desc = parsed.description;
    // A pasted / drafted entry describes work already under way, so it lands
    // in_progress rather than the toDo() factory's 'active' default. Mirrors
    // commitEntryToActiveProject in entryParse.js — both paste-commit surfaces
    // must agree on the committed status.
    item.status = 'in_progress';
    if (toDoInput) {
        toDoInput.value = parsed.title;
        toDoInput.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', bubbles: true,
        }));
    }
    if (parsed.hasMarker) {
        showInjectToast('Pasted — this entry already exists in TODO.md.');
    }
    return true;
}


// Locate the paste-entry panel mounted for a row, or null. It sits as the
// placeholder's sibling directly after the chip row (mirroring #descSibling),
// so walk past the chip row to reach it.
function pastePanelFor(toDoChild) {
    let node = toDoChild.nextSibling;
    while (node && node.id === 'createChipRow') node = node.nextSibling;
    return (node && node.id === 'pasteEntryPanel') ? node : null;
}


// Remove the paste-entry panel and clear the chip's pressed state. Falls back
// to a global lookup because the commit path removes the chip row from between
// the panel and the row, which the sibling walk above no longer traverses.
function closePastePanel(toDoChild, pasteChip) {
    let panel = pastePanelFor(toDoChild);
    if (!panel && typeof document !== 'undefined') {
        panel = document.getElementById('pasteEntryPanel');
    }
    if (panel) panel.remove();
    if (toDoChild) toDoChild.removeAttribute('data-paste-open');
    if (pasteChip) pasteChip.classList.remove('createChipSelected');
    refreshViewerExpandedHeight();
}


// Open an inline panel below the compose row holding a labelled textarea and
// PARSE & ADD / CANCEL actions, so a drafted TODO.md entry is visible and
// editable before it becomes a task — and pasting still works when the
// clipboard API is unavailable or blocked (frequent on iOS Safari). Mounts the
// panel as the placeholder's SIBLING (the row is `overflow: clip` at a fixed
// height, so a child would be cropped), directly after the chip row and before
// an open #descSibling. Idempotent: any existing panel is removed first.
function openPastePanel(toDoChild, item, pasteChip) {
    const existing = pastePanelFor(toDoChild);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'pasteEntryPanel';
    panel.className = 'pasteEntryPanel';
    panel.setAttribute('aria-label', 'Paste a TODO.md entry');

    const label = document.createElement('div');
    label.className = 'pasteEntryLabel';
    label.textContent = 'PASTE A TODO.md ENTRY';

    const textarea = document.createElement('textarea');
    textarea.className = 'pasteEntryInput';
    textarea.setAttribute('placeholder',
        '- [ ] **[MEDIUM]** Title\n  - Type: feature\n  - Description: …');
    // Disable smart substitutions so pasted markdown isn't mangled (16px+ font
    // to avoid iOS focus auto-zoom lives on the CSS rule) — descInput sets the
    // same for the same reason.
    textarea.spellcheck = false;
    textarea.setAttribute('autocapitalize', 'off');
    textarea.setAttribute('autocorrect', 'off');

    const actions = document.createElement('div');
    actions.className = 'pasteEntryActions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'pasteEntryBtn pasteEntryCancel';
    cancelBtn.textContent = 'CANCEL';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'pasteEntryBtn pasteEntryAdd';
    addBtn.textContent = 'PARSE & ADD';

    // Keep focus stable: a mousedown on a button must not blur the textarea
    // before the click lands.
    [cancelBtn, addBtn].forEach(function(b) {
        b.addEventListener('mousedown', function(e) { e.preventDefault(); });
    });

    cancelBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        closePastePanel(toDoChild, pasteChip);
    });

    addBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Inert on empty — the panel stays open so the user can paste.
        if (!textarea.value.trim()) return;
        commitParsedEntry(toDoChild, item, textarea.value);
        closePastePanel(toDoChild, pasteChip);
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(addBtn);
    panel.appendChild(label);
    panel.appendChild(textarea);
    panel.appendChild(actions);

    const parent = toDoChild.parentNode;
    if (parent) {
        const anchor = (toDoChild.nextSibling && toDoChild.nextSibling.id === 'createChipRow')
            ? toDoChild.nextSibling
            : toDoChild;
        parent.insertBefore(panel, anchor.nextSibling);
    }

    // Keep the chip row (and the pressed chip) visible while the panel is open:
    // the mobile/desktop reveal is otherwise gated on the row being
    // focus-within, which moving focus into the sibling textarea breaks.
    toDoChild.setAttribute('data-paste-open', 'true');
    pasteChip.classList.add('createChipSelected');

    // The panel changes the stack height below it — an expanded viewer card
    // caches its body height, so nudge it to re-measure.
    refreshViewerExpandedHeight();

    // Focus so a manual paste works immediately; the clipboard pre-fill is
    // best-effort and must not block opening. A denied or unavailable read is a
    // normal path here, not a fallback, so it surfaces no toast.
    textarea.focus();
    let read;
    try {
        read = navigator.clipboard.readText();
    } catch (e) {
        read = Promise.reject(e);
    }
    Promise.resolve(read).then(function(text) {
        const raw = String(text || '');
        // Only pre-fill if the panel is still open and the user hasn't typed.
        if (raw && typeof document !== 'undefined'
            && document.body.contains(textarea) && textarea.value === '') {
            textarea.value = raw;
        }
    }, function() { /* denied / unavailable — leave the textarea empty and focused */ });
}


// ── Mobile quick-capture ─────────────────────────────────────────────────────
// One spoken (or typed) paragraph in, several discrete tasks out. Neither
// existing affordance covers that: the add-task row's mic commits exactly one
// todo per dictation, and the paste panel above expects an already-formatted
// TODO.md entry. The capture chip opens a panel built exactly the way
// openPastePanel builds its own — the placeholder's SIBLING, since the row is
// `overflow: clip` — holding two stages in one shell: COMPOSE (a project
// select plus a dictatable textarea) and REVIEW (a checklist of the tasks the
// Worker extracted). BACK returns to compose with the transcript intact so it
// can be edited and re-extracted.

// Monochrome "one paragraph, many tasks" glyph — three list rules under a
// sparkle. Same 24×24 viewBox, fill:none, stroke:currentColor, 2px round
// strokes as CAL_SVG and the mic, so the chip recolors with the theme and
// flips to white under .createChipSelected for free.
const CAPTURE_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="3" y1="7" x2="13" y2="7"></line>' +
    '<line x1="3" y1="12" x2="11" y2="12"></line>' +
    '<line x1="3" y1="17" x2="9" y2="17"></line>' +
    '<path d="M18 3l1.1 2.9L22 7l-2.9 1.1L18 11l-1.1-2.9L14 7l2.9-1.1z"></path></svg>';


// Locate the quick-capture panel mounted for a row, or null. Same sibling walk
// pastePanelFor uses, but it also steps over an open paste panel — both can be
// mounted at once, and the capture panel always lands last.
function capturePanelFor(toDoChild) {
    if (!toDoChild) return null;
    let node = toDoChild.nextSibling;
    while (node && (node.id === 'createChipRow' || node.id === 'pasteEntryPanel')) {
        node = node.nextSibling;
    }
    return (node && node.id === 'captureEntryPanel') ? node : null;
}


// Remove the quick-capture panel and clear the chip's pressed state. Mirrors
// closePastePanel, including the global-lookup fallback for the commit path
// (which strips the chip row the sibling walk traverses), and additionally ends
// any dictation the panel started — a closed surface must not leave a session
// running against a textarea that no longer exists.
function closeCapturePanel(toDoChild, captureChip) {
    let panel = capturePanelFor(toDoChild);
    if (!panel && typeof document !== 'undefined') {
        panel = document.getElementById('captureEntryPanel');
    }
    if (isDictating()) stopDictation();
    if (panel) panel.remove();
    if (toDoChild) toDoChild.removeAttribute('data-capture-open');
    if (captureChip) captureChip.classList.remove('createChipSelected');
    refreshViewerExpandedHeight();
}


// The repo the chosen project injects into, or null when it routes nowhere.
// Resolved out of the already-warmed targets cache the way resolveTarget in
// captureCard.js does; `repo` is optional on the Worker's extract route, so a
// project with no target simply sends none.
function captureRepoForProject(projectName) {
    const targetId = listLogic.getProjectTargetId(projectName);
    if (!targetId) return null;
    const targets = getCachedTargets();
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].id === targetId) return targets[i].repo || null;
    }
    return null;
}


// The chosen project's still-open task titles, which the Worker matches a
// candidate against to flag it as a duplicate. Blank titles (the pinned
// placeholder) and completed items are excluded — neither is work still open.
function openTitlesForProject(projectName) {
    const items = listLogic.listItems(projectName) || [];
    const titles = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!item || item.completed) continue;
        const title = (item.tit || '').trim();
        if (title) titles.push(title);
    }
    return titles;
}


// Open the quick-capture panel below the blank placeholder. Idempotent: any
// existing panel is removed first. Mobile-only — the chip that opens it is
// gated the same way, and this second guard keeps a stray programmatic call
// from mounting the panel on desktop.
function openCapturePanel(toDoChild, item, captureChip) {
    if (!isMobileViewport()) return;

    const existing = capturePanelFor(toDoChild);
    if (existing) existing.remove();

    const panel = document.createElement('div');
    panel.id = 'captureEntryPanel';
    panel.className = 'captureEntryPanel';
    panel.setAttribute('aria-label', 'Capture several tasks at once');

    const label = document.createElement('div');
    label.className = 'pasteEntryLabel';
    label.textContent = 'CAPTURE SEVERAL TASKS';

    // Where the extracted tasks land. Seeded to the project the user is looking
    // at, but committing to a different one never switches the viewed project —
    // this is a capture surface, not a navigation one.
    const select = document.createElement('select');
    select.className = 'captureEntryProject';
    select.setAttribute('aria-label', 'Project for the captured tasks');
    const projects = listLogic.listProjectsArray() || [];
    for (let i = 0; i < projects.length; i++) {
        const opt = document.createElement('option');
        opt.value = projects[i];
        opt.textContent = projects[i];
        select.appendChild(opt);
    }
    const active = activeProjectNameForViewer();
    if (active && projects.indexOf(active) !== -1) select.value = active;

    const body = document.createElement('div');
    body.className = 'captureEntryBody';

    const actions = document.createElement('div');
    actions.className = 'pasteEntryActions';

    // Worker failures surface here, below the actions, and never clear the
    // transcript — a failed extract must be retryable without re-dictating.
    const errorEl = document.createElement('div');
    errorEl.className = 'captureEntryError';
    errorEl.hidden = true;

    // The transcript outlives the compose → review → BACK round trip, so it
    // lives in the closure rather than on the textarea (which review tears down).
    let transcript = '';
    let stage = 'compose';

    function clearChildren(el) {
        while (el.firstChild) el.removeChild(el.firstChild);
    }

    function showError(message) {
        errorEl.textContent = message;
        errorEl.hidden = false;
    }

    function clearError() {
        errorEl.textContent = '';
        errorEl.hidden = true;
    }

    // Keep focus stable: a mousedown on a button must not blur the textarea
    // before the click lands (the paste panel guards its buttons the same way).
    // Without it, tapping EXTRACT mid-dictation drops the field out from under
    // the session.
    function makeBtn(className, text) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'pasteEntryBtn ' + className;
        btn.textContent = text;
        btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        return btn;
    }

    function renderCompose() {
        stage = 'compose';
        clearError();
        clearChildren(body);
        clearChildren(actions);

        const field = document.createElement('div');
        field.className = 'captureEntryField';

        const textarea = document.createElement('textarea');
        textarea.className = 'pasteEntryInput captureEntryInput';
        textarea.setAttribute('placeholder',
            'Say or type everything on your mind — one paragraph, several things.');
        // Same substitution/zoom treatment the paste textarea carries (the 16px
        // floor that keeps iOS from auto-zooming lives on the CSS rule).
        textarea.spellcheck = false;
        textarea.setAttribute('autocapitalize', 'off');
        textarea.setAttribute('autocorrect', 'off');
        textarea.value = transcript;
        textarea.addEventListener('input', function() { transcript = textarea.value; });
        field.appendChild(textarea);

        // Review-only mic: no onFinal, so dictation lands in the field for the
        // user to edit rather than committing a todo outright. Continuous
        // regardless — capture is a paragraph, and a pause between thoughts must
        // not end the session (it also arms the runaway watchdog, so the overlay
        // can never be the only way out). Null when the platform exposes no
        // SpeechRecognition, in which case the panel is simply type-only.
        const mic = mountMicButton(textarea, {
            className: 'micButton captureEntryMic',
            ariaLabel: 'Dictate tasks',
            overlay: true,
            focusTarget: true,
            stopPropagation: true,
            continuous: true,
        });
        if (mic) field.appendChild(mic);

        body.appendChild(field);

        const cancelBtn = makeBtn('pasteEntryCancel', 'CANCEL');
        cancelBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            closeCapturePanel(toDoChild, captureChip);
        });

        const extractBtn = makeBtn('pasteEntryAdd captureEntryExtract', 'EXTRACT');
        extractBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // A live session still holds the tail of what was said; stopping it
            // leaves the committed text in the field, which is what we send.
            if (isDictating()) stopDictation();
            transcript = textarea.value;
            // Inert on empty — the panel stays open so the user can keep talking.
            if (!transcript.trim()) return;
            runExtract(extractBtn);
        });

        actions.appendChild(cancelBtn);
        actions.appendChild(extractBtn);
        return textarea;
    }

    function runExtract(extractBtn) {
        clearError();
        extractBtn.disabled = true;
        extractBtn.textContent = 'EXTRACTING…';
        const projectName = select.value;
        function restore() {
            extractBtn.disabled = false;
            extractBtn.textContent = 'EXTRACT';
        }
        Promise.resolve(extractTasksFromWorker(
            projectName,
            captureRepoForProject(projectName),
            transcript,
            openTitlesForProject(projectName)
        )).then(function(res) {
            // The panel can be closed (or re-rendered) while the call is in
            // flight; a late reply must not resurrect a dead surface.
            if (!panel.isConnected) return;
            const tasks = (res && Array.isArray(res.tasks)) ? res.tasks : [];
            if (!tasks.length) {
                restore();
                showError('No tasks found in that — try adding more detail.');
                return;
            }
            renderReview(tasks);
        }, function(err) {
            if (!panel.isConnected) return;
            restore();
            showError((err && err.message) || 'Extract failed.');
        });
    }

    function renderReview(tasks) {
        stage = 'review';
        clearError();
        clearChildren(body);
        clearChildren(actions);

        const list = document.createElement('div');
        list.className = 'captureReviewList';
        const rows = [];

        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            const row = document.createElement('div');
            row.className = 'captureReviewRow';

            const check = document.createElement('input');
            check.type = 'checkbox';
            check.className = 'captureReviewCheck';
            // Everything is checked by default EXCEPT a task the Worker matched
            // against open work: a dupe is opt-in, so re-describing something
            // already on the list never silently doubles it.
            check.checked = !task.similar_to;
            check.addEventListener('change', updateAddLabel);

            const text = document.createElement('div');
            text.className = 'captureReviewText';

            // The title is an <input> rather than a span so it is tappable and
            // editable in place with no swap step — whatever the user leaves in
            // the field is what ADD commits.
            const title = document.createElement('input');
            title.type = 'text';
            title.className = 'captureReviewTitle';
            title.value = task.title;
            title.setAttribute('aria-label', 'Task title');
            text.appendChild(title);

            if (task.description) {
                const desc = document.createElement('div');
                desc.className = 'captureReviewDesc';
                desc.textContent = task.description;
                text.appendChild(desc);
            }
            if (task.similar_to) {
                row.setAttribute('data-dupe', 'true');
                const hint = document.createElement('div');
                hint.className = 'captureReviewHint';
                hint.textContent = 'Similar to “' + task.similar_to + '”';
                text.appendChild(hint);
            }

            row.appendChild(check);
            row.appendChild(text);
            list.appendChild(row);
            rows.push({ check: check, title: title, description: task.description || '' });
        }

        body.appendChild(list);

        const backBtn = makeBtn('pasteEntryCancel captureEntryBack', 'BACK');
        backBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // `transcript` is untouched by review, so compose comes back with
            // the text ready to edit and re-extract.
            renderCompose();
        });

        const addBtn = makeBtn('pasteEntryAdd captureEntryAdd', '');
        addBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            const projectName = select.value;
            const chosen = rows.filter(function(r) {
                return r.check.checked && r.title.value.trim();
            });
            // Inert with nothing ticked — the panel stays open.
            if (!chosen.length) return;
            for (let i = 0; i < chosen.length; i++) {
                // ONE insert per task carrying its final shape. Deliberately not
                // commitEntryToActiveProject (which drives the single blank
                // placeholder) and deliberately no follow-up priority/status
                // update — see addEntryTodo's header on why that would race.
                listLogic.addEntryTodo(
                    projectName,
                    chosen[i].title.value.trim(),
                    chosen[i].description
                );
            }
            closeCapturePanel(toDoChild, captureChip);
        });

        function updateAddLabel() {
            let n = 0;
            for (let i = 0; i < rows.length; i++) {
                if (rows[i].check.checked) n++;
            }
            addBtn.textContent = 'ADD ' + n + (n === 1 ? ' TASK' : ' TASKS');
        }
        updateAddLabel();

        actions.appendChild(backBtn);
        actions.appendChild(addBtn);
    }

    // The dupe hints are computed against the TARGET project's open titles, so
    // switching projects mid-review would leave hints describing the project the
    // user just left. Re-extract instead, which re-derives repo and open_titles
    // from the new selection.
    select.addEventListener('change', function() {
        if (stage !== 'review') return;
        renderCompose();
        const extractBtn = actions.querySelector('.captureEntryExtract');
        if (extractBtn && transcript.trim()) runExtract(extractBtn);
    });

    panel.appendChild(label);
    panel.appendChild(select);
    panel.appendChild(body);
    panel.appendChild(actions);
    panel.appendChild(errorEl);

    const textarea = renderCompose();

    // Mount after the chip row and after an open paste panel, so the two inline
    // panels stack in the order they were opened rather than overlapping.
    const parent = toDoChild.parentNode;
    if (parent) {
        let anchor = toDoChild;
        while (anchor.nextSibling
            && (anchor.nextSibling.id === 'createChipRow'
                || anchor.nextSibling.id === 'pasteEntryPanel')) {
            anchor = anchor.nextSibling;
        }
        parent.insertBefore(panel, anchor.nextSibling);
    }

    // Keep the chip row (and the pressed chip) visible while the panel is open —
    // the reveal is otherwise gated on the row being focus-within, which moving
    // focus into the sibling panel breaks. Own attribute rather than the paste
    // panel's, so closing one panel never un-pins the row for the other.
    toDoChild.setAttribute('data-capture-open', 'true');
    captureChip.classList.add('createChipSelected');

    // The panel changes the stack height below it — an expanded viewer card
    // caches its body height, so nudge it to re-measure.
    refreshViewerExpandedHeight();

    textarea.focus();
}


// Build and wire the quick-capture chip for the create strip. Mobile-only: the
// panel it opens is a touch/dictation surface, and openCapturePanel enforces the
// same breakpoint independently.
function createCaptureChip(toDoChild, item) {
    const captureChip = document.createElement('button');
    captureChip.type = 'button';
    captureChip.id = 'createCaptureChip';
    captureChip.className = 'createChip captureChip';
    captureChip.setAttribute('aria-label', 'Capture several tasks at once');
    captureChip.innerHTML = CAPTURE_SVG;
    // Stop mousedown from stealing focus off the title input before the click
    // lands (mirrors the strip's other chips and the mic).
    captureChip.addEventListener('mousedown', function(e) { e.preventDefault(); });
    captureChip.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (capturePanelFor(toDoChild)) {
            closeCapturePanel(toDoChild, captureChip);
        } else {
            openCapturePanel(toDoChild, item, captureChip);
        }
    });
    return captureChip;
}


// Build and wire the 📋 paste-entry trigger for a blank placeholder. The
// button lives in the row's input line (mounted by buildToDoRow immediately
// left of the voice mic), NOT in the date-chip strip — so it surfaces at every
// width without waiting on focus. Only the trigger's location differs from
// before; the inline panel it toggles (openPastePanel / closePastePanel, mounted
// as the row's sibling) is unchanged. Tapping toggles the panel; the pressed
// state mirrors the strip's via the shared .createChipSelected fill.
export function createPasteChipTrigger(toDoChild, item) {
    const pasteChip = document.createElement('button');
    pasteChip.type = 'button';
    pasteChip.id = 'createPasteChip';
    // Reuses .micButton so it is pixel-identical to the mic beside it (a
    // fixed 36×36 circle that fits the overflow:clip input row); addTaskPasteChip
    // sizes the glyph and carries the open-state fill.
    pasteChip.className = 'micButton addTaskPasteChip';
    pasteChip.setAttribute('aria-label', 'Paste entry as a new task');
    // Inline SVG clipboard (not an emoji) so the glyph inherits the button's
    // currentColor and matches the mic's monochrome icon set.
    pasteChip.innerHTML = PASTE_SVG;
    // Stop mousedown from stealing focus off the title input before the click
    // lands (mirrors the strip chips and the mic).
    pasteChip.addEventListener('mousedown', function(e) { e.preventDefault(); });
    pasteChip.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (pastePanelFor(toDoChild)) {
            closePastePanel(toDoChild, pasteChip);
        } else {
            openPastePanel(toDoChild, item, pasteChip);
        }
    });
    return pasteChip;
}


// Build and wire the chip row for a blank placeholder. Mounts the chip
// row as the placeholder's NEXT SIBLING in #mainList — its own grid row
// directly beneath the row, mirroring how #descSibling attaches — so CSS
// at ≤1023px can reveal it via the adjacent-sibling combinator when the
// row is focus-within. As a child it was cropped by the row's
// `overflow: clip` and undersized grid track when it wrapped to a second
// line; as a sibling panel it gets a real measured height and is never
// clipped or overlapping the task below.
// No-op on committed rows — the chip row only makes sense for the
// always-pinned blank placeholder at the top of each project list.
export function attachMobileCreateChips(toDoChild, item) {
    if (!toDoChild || !item || item.tit) return;

    // Mark the row so CSS can target only the blank placeholder for the
    // flex-wrap + expanded-height behavior without grabbing committed rows.
    toDoChild.setAttribute('data-blank-placeholder', 'true');

    const chips = document.createElement('div');
    chips.id = 'createChipRow';
    chips.setAttribute('aria-label', 'Quick options for new task');

    function makeChip(chipId, label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'createChip';
        btn.setAttribute('data-chip', chipId);
        btn.textContent = label;
        if (chipId === chosenDueChip) {
            btn.classList.add('createChipSelected');
        }
        // Stop touchstart/mousedown from stealing focus away from the
        // title input — without this, tapping a chip blurs the input,
        // collapses the expanded row, and the chip click never lands.
        btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        return btn;
    }

    const todayChip    = makeChip('today',    'Today');
    const tomorrowChip = makeChip('tomorrow', 'Tomorrow');
    const calChip      = makeChip('custom',   '');
    calChip.classList.add('calChip');
    calChip.innerHTML = CAL_SVG;
    calChip.setAttribute('aria-label', 'Pick a date');

    // NOTE: the 📋 paste-entry trigger no longer lives in this strip — it is
    // built by createPasteChipTrigger and mounted into the row's input line
    // (left of the mic) by buildToDoRow. The panel it opens is unchanged.

    const descChip = document.createElement('button');
    descChip.type = 'button';
    descChip.id = 'createDescChip';
    descChip.className = 'createChip createDescChip';
    descChip.setAttribute('aria-label', 'Toggle description');
    descChip.textContent = '+ ¶';
    descChip.addEventListener('mousedown', function(e) { e.preventDefault(); });

    function refreshDueSelection() {
        [todayChip, tomorrowChip, calChip].forEach(function(c) {
            if (c.getAttribute('data-chip') === chosenDueChip) {
                c.classList.add('createChipSelected');
            } else {
                c.classList.remove('createChipSelected');
            }
        });
    }

    todayChip.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        chosenDueChip = 'today';
        // Clear any earlier custom-picked due so the on-commit stamp uses
        // the chip preference instead of a stale popover selection.
        item.due = '';
        refreshDueSelection();
    });

    tomorrowChip.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        chosenDueChip = 'tomorrow';
        item.due = '';
        refreshDueSelection();
    });

    calChip.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        chosenDueChip = 'custom';
        refreshDueSelection();
        // Anchor the popover on the chip itself so it lands directly
        // beside the user's tap point. The popover writes through
        // setItemDue, so a confirmed selection lands on item.due before
        // commit and the on-commit stamp becomes a no-op.
        showDueDatePopover(calChip, item, toDoChild);
    });

    descChip.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        // Reuse the row's existing descToggle — its click handler owns
        // the insert/remove of #descSibling, save/restore semantics, and
        // the `.open` class that drives CSS state. Mirror the open state
        // on the chip so the user can see their selection visually.
        const descToggle = toDoChild.querySelector('#descToggle');
        if (!descToggle) return;
        descToggle.click();
        if (descToggle.classList.contains('open')) {
            descChip.classList.add('createChipSelected');
        } else {
            descChip.classList.remove('createChipSelected');
        }
    });

    chips.appendChild(todayChip);
    chips.appendChild(tomorrowChip);
    chips.appendChild(calChip);
    // Quick-capture sits before the description toggle so the toggle keeps the
    // strip's trailing edge (.createDescChip has margin-left: auto). Mobile
    // only — the panel behind it is a dictation surface, gated the same way.
    if (isMobileViewport()) {
        chips.appendChild(createCaptureChip(toDoChild, item));
    }
    chips.appendChild(descChip);

    // Mount the chips as the placeholder's next sibling rather than a child.
    // buildToDoRow calls this before the row is appended to #mainList, so the
    // row usually has no parent yet: insert immediately when it does (the
    // reorder-rebuild path and tests mount the row first), otherwise defer to
    // the row's first focus, by which point it's mounted and the chips are
    // about to be revealed anyway. `once` keeps a committed row — whose chip
    // sibling is stripped on commit — from re-inserting it on a later focus.
    function mountChips() {
        if (chips.parentNode) return;
        const parent = toDoChild.parentNode;
        if (parent) parent.insertBefore(chips, toDoChild.nextSibling);
    }
    if (toDoChild.parentNode) {
        mountChips();
    } else {
        toDoChild.addEventListener('focusin', mountChips, { once: true });
    }

    // Only show the chip row inside the actual mobile viewport. CSS hides
    // it on desktop regardless, but adding a class here keeps the DOM
    // intent explicit and lets tests assert against a single source of
    // truth rather than chasing media-query state.
    if (isMobileViewport()) {
        toDoChild.classList.add('mobile-create-row');
    }
}
