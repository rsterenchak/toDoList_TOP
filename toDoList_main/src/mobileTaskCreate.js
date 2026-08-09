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
import { showInjectToast } from './inject.js';
import { parsePastedEntry } from './entryParse.js';
import { refreshViewerExpandedHeight } from './todoMdViewer.js';

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
