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

// Re-exported so existing importers (and tests) can keep reaching the parser
// through this module; the single implementation now lives in entryParse.js,
// shared with the chat reply "Create task" action.
export { parsePastedEntry };


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


// Read the clipboard, parse a pasted entry, and commit a task through the same
// Enter path a typed title uses — so the committed row gets its status badge,
// a fresh blank placeholder, and persistence. The title input carries the
// parsed headline; item.desc carries the full entry (the commit handler reads
// the title from the input and never touches desc, so the value set here
// survives). Clipboard reads need a user gesture and can reject, so both the
// throw and the rejected-promise paths surface a toast; a denied read also
// focuses the title input so the user can paste by hand rather than fail
// silently. Mirrors copyTaskContextForClaude's dual-path clipboard handling.
function handleEntryPaste(toDoChild, item) {
    const toDoInput = toDoChild.querySelector('#toDoInput');
    let read;
    try {
        read = navigator.clipboard.readText();
    } catch (e) {
        read = Promise.reject(e);
    }
    Promise.resolve(read).then(function(text) {
        const raw = String(text || '');
        if (!raw.trim()) {
            showInjectToast('Clipboard is empty — nothing to paste.', 'error');
            return;
        }
        const parsed = parsePastedEntry(raw);
        if (!parsed.title) {
            showInjectToast('Couldn’t read a task from the clipboard.', 'error');
            return;
        }
        item.desc = parsed.description;
        if (toDoInput) {
            toDoInput.value = parsed.title;
            toDoInput.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Enter', bubbles: true,
            }));
        }
        if (parsed.hasMarker) {
            showInjectToast('Pasted — this entry already exists in TODO.md.');
        }
    }, function() {
        showInjectToast('Couldn’t read the clipboard — paste into the title instead.', 'error');
        if (toDoInput) toDoInput.focus();
    });
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
    chips.id = 'mobileCreateChips';
    chips.setAttribute('aria-label', 'Quick options for new task');

    function makeChip(chipId, label) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mobileCreateChip';
        btn.setAttribute('data-chip', chipId);
        btn.textContent = label;
        if (chipId === chosenDueChip) {
            btn.classList.add('mobileCreateChipSelected');
        }
        // Stop touchstart/mousedown from stealing focus away from the
        // title input — without this, tapping a chip blurs the input,
        // collapses the expanded row, and the chip click never lands.
        btn.addEventListener('mousedown', function(e) { e.preventDefault(); });
        return btn;
    }

    const todayChip    = makeChip('today',    'Today');
    const tomorrowChip = makeChip('tomorrow', 'Tomorrow');
    const calChip      = makeChip('custom',   '📅');
    calChip.setAttribute('aria-label', 'Pick a date');

    // Paste a full TODO.md entry (drafted in the Claude app) straight into a
    // committed task — headline becomes the title, whole entry the description.
    const pasteChip = document.createElement('button');
    pasteChip.type = 'button';
    pasteChip.id = 'mobileCreatePasteChip';
    pasteChip.className = 'mobileCreateChip mobileCreatePasteChip';
    pasteChip.setAttribute('aria-label', 'Paste entry as a new task');
    pasteChip.textContent = '📋';
    pasteChip.addEventListener('mousedown', function(e) { e.preventDefault(); });
    pasteChip.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        handleEntryPaste(toDoChild, item);
    });

    const descChip = document.createElement('button');
    descChip.type = 'button';
    descChip.id = 'mobileCreateDescChip';
    descChip.className = 'mobileCreateChip mobileCreateDescChip';
    descChip.setAttribute('aria-label', 'Toggle description');
    descChip.textContent = '+ ¶';
    descChip.addEventListener('mousedown', function(e) { e.preventDefault(); });

    function refreshDueSelection() {
        [todayChip, tomorrowChip, calChip].forEach(function(c) {
            if (c.getAttribute('data-chip') === chosenDueChip) {
                c.classList.add('mobileCreateChipSelected');
            } else {
                c.classList.remove('mobileCreateChipSelected');
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
            descChip.classList.add('mobileCreateChipSelected');
        } else {
            descChip.classList.remove('mobileCreateChipSelected');
        }
    });

    chips.appendChild(todayChip);
    chips.appendChild(tomorrowChip);
    chips.appendChild(calChip);
    chips.appendChild(pasteChip);
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
