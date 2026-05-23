// Todo-row construction layer + the row-lifecycle helpers that used to live
// in main.js. After the carve-out completes, this module owns everything
// "todo-row-shaped":
//
//   buildToDoRow(item, toDoName)         — construct + wire a single row
//   addAllToDo_DOM(items, name)          — render a project from scratch
//   addToDos_restore(items, name)        — sort-then-render path used by restoreFromStorage
//   reorderToDoDOM(projectName)          — re-append rows to match the data-model order
//   attachToDoDrag(row, input, project,  — wire mouse + touch drag/swipe on a row
//                  swipeTargets)
//   appendNewToDoRow(toDoName)           — pin a fresh blank placeholder + focus it
//   focusBlankToDoInput()                — focus the existing blank placeholder's input
//   focusBlankToDoInputIfDesktop()       — desktop-only variant; deferred to next tick
//
// Function declarations are hoisted, so the order of definitions inside this
// file is purely for readability — every helper can call the others without
// regard to their position. The ghost-companion singleton is reached through
// `ensureCompanion()` from companion.js (no deps bag involved).

import { listLogic } from './listLogic.js';
import { setupRowDrag, isCoarsePointer, prefersReducedMotion } from './dragDrop.js';
import {
    applyDueUrgency,
    parseItemDue,
    updateDuePillLabel,
    showDueDatePopover,
    hideDueDatePopover,
    updateRecurringGlyph,
} from './dueDate.js';
import { showConfirmModal, showMissedDatesModal } from './modals.js';
import { showUndoToast } from './undoToast.js';
import { updateCompletedSection } from './emptyState.js';
import { ensureCompanion } from './companion.js';
import {
    attachMobileCreateChips,
    applyChosenDueToItem,
    markChainingActive,
    isChainingActive,
} from './mobileTaskCreate.js';


// Default due-date offset used when a row is committed without a user-chosen
// date. Matches the legacy placeholder behavior (today + 7 days).
const DEFAULT_DUE_OFFSET_DAYS = 7;

function defaultDueParts() {
    const future = new Date();
    future.setDate(future.getDate() + DEFAULT_DUE_OFFSET_DAYS);
    return { m: future.getMonth() + 1, d: future.getDate(), y: future.getFullYear() };
}


// Tabler-style copy SVG and a matching checkmark SVG used to telegraph
// "copied" feedback on the mobile per-row copy-title button. currentColor
// lets the purple accent on the button paint the strokes; the checkmark
// reuses the same dimensions so swapping innerHTML doesn't reflow the row.
const COPY_GLYPH_SVG = '<svg class="copyTitleIcon" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.25" y="3.25" width="7.5" height="9" rx="1.25"/><path d="M5.75 3.25V2.25a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7"/></svg>';
const CHECK_GLYPH_SVG = '<svg class="copyTitleIcon copyTitleIcon-done" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.75 7.25L5.75 10.25L11.5 4.25"/></svg>';

// How long the checkmark stays after a successful copy before the button
// reverts to the copy glyph. Matched to the ~1s the task brief calls for.
const COPY_FEEDBACK_MS = 1000;

// Swap the copy-title button between its idle (copy glyph) and confirmed
// (checkmark) states. Centralized so the click path, the timeout restore,
// and any future re-render reset all reach for the same SVG strings.
function setCopyBtnGlyph(copyBtn, done) {
    copyBtn.innerHTML = done ? CHECK_GLYPH_SVG : COPY_GLYPH_SVG;
    if (done) {
        copyBtn.setAttribute('data-copied', 'true');
    } else {
        copyBtn.removeAttribute('data-copied');
    }
}

// Click handler for the mobile per-row copy-title button. Writes the row's
// title to the clipboard, flips the icon to the checkmark, then restores
// the copy glyph after COPY_FEEDBACK_MS. The clipboard write goes through
// navigator.clipboard.writeText when available — the only path that works
// from a button activation on mobile Safari. The legacy execCommand path
// is preserved as a fallback for environments without the async API
// (jsdom in particular). A clipboard-write failure leaves the icon on the
// idle copy glyph so the user can retry without a stale checkmark sitting.
function copyTitleToClipboard(item, copyBtn) {
    const text = (item && typeof item.tit === 'string') ? item.tit : '';
    if (!text) return;

    function showCopied() {
        setCopyBtnGlyph(copyBtn, true);
        // Stash the timer on the button so a fresh click within the window
        // resets the countdown rather than racing two pending restores.
        if (copyBtn.__copyResetTimer) {
            clearTimeout(copyBtn.__copyResetTimer);
        }
        copyBtn.__copyResetTimer = setTimeout(function() {
            setCopyBtnGlyph(copyBtn, false);
            copyBtn.__copyResetTimer = null;
        }, COPY_FEEDBACK_MS);
    }

    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(showCopied).catch(function() {});
        return;
    }

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.pointerEvents = 'none';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) showCopied();
    } catch (e) { /* swallow — no feedback flip, button stays on copy glyph */ }
}


// Mirror `item.desc` onto `data-has-desc` on the row so CSS can surface a
// small "¶" pilcrow next to the date pill when a collapsed row carries a
// non-empty description. The data-attribute drives the indicator instead
// of a JS-managed child element so descSibling edits / restores can keep
// state in sync with a single attribute write per change.
function updateDescIndicator(toDoChild, item) {
    if (!toDoChild) return;
    const has = !!(item && typeof item.desc === 'string' && item.desc.trim().length > 0);
    if (has) {
        toDoChild.setAttribute('data-has-desc', 'true');
    } else {
        toDoChild.removeAttribute('data-has-desc');
    }
}


// ── HELPER: install Backspace-as-exit on a todo-row sub-control ──
// Keyboard users who Tab into a row's sub-controls (checkbox, due pill,
// expand caret, stats caret, delete X) get a one-key way to back out of the
// row's inner chrome and return to row-level nav mode. The next ArrowUp /
// ArrowDown then resolves "current row = this row" via the focus-based
// path in the global keydown handler, so the user transitions cleanly from
// sub-control focus → row nav mode → arrow-key traversal — without ever
// dropping into title-editing mode. Mirrors the Backspace-closes-popover
// convention shared by the due-date, pomodoro, and music popovers.
// Modified Backspace (Ctrl / Cmd / Alt / Shift) falls through so the global
// Ctrl+Backspace sidebar shortcut still works from a focused sub-control.
function wireSubControlBackspaceExit(subControl, toDoChild) {
    // Blank placeholder rows hide every sub-control via display:none until
    // the row commits, so the listener could never fire there — skip the
    // wire-up entirely. The Enter commit path rebuilds the row on the next
    // render, at which point the marker is gone and the listener attaches.
    if (toDoChild.dataset.originalBlank === 'true') return;

    subControl.addEventListener('keydown', function(event) {
        if (event.key !== 'Backspace') return;
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        // Belt-and-suspenders: the popover's capture-phase keydown handler
        // calls stopPropagation on Backspace, so this bubble-phase listener
        // never sees the keystroke while the popover is open. Re-check the
        // popover element here so a future change in listener ordering can't
        // bounce focus away while the user is still inside the calendar.
        if (subControl.id === 'duePill' && document.getElementById('dueDatePopover')) return;
        event.preventDefault();
        // Clear .todo-active from any other row first so the arrow-nav
        // handler's .todo-active fallback can't resolve to a stale row.
        // Mirrors the cleanup pattern in main.js's arrow-nav handler and
        // wireCloseButton's post-deletion focus logic.
        const mainList = toDoChild.parentElement;
        if (mainList) {
            mainList.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                if (el !== toDoChild) el.classList.remove('todo-active');
            });
        }
        toDoChild.classList.add('todo-active');
        // toDoChild carries tabindex="-1" specifically so it can receive
        // programmatic focus for row nav mode — the user is now between
        // rows, ready for ArrowUp/ArrowDown, not inside the title input.
        toDoChild.focus();
    });
}


// ── HELPER: build and wire the check-off checkbox for a todo row ──
// Inserts the checkbox as the left-most child of toDoChild, reflects the item's
// stored completed state, and persists changes. Blank placeholder rows pass the
// row through untouched — callers reveal the checkbox after a title is committed.
function wireCheckbox(toDoChild, toDoInput, item) {

    const checkToDo = document.createElement("input");
    checkToDo.type = "checkbox";
    checkToDo.id   = "checkToDo";
    checkToDo.checked = !!item.completed;

    toDoChild.insertBefore(checkToDo, toDoInput);

    if (!item.tit || item.tit === "") {
        checkToDo.style.display = "none";
    }

    if (item.completed) {
        toDoChild.classList.add("completed");
    }

    checkToDo.addEventListener("change", function() {
        const wasCompleted = !!item.completed;
        const projectName = toDoChild.dataset.value;

        // Recurring branch: when the user checks a recurring todo, do NOT
        // mark it complete. Advance its due date to the next occurrence
        // and flash the checkbox so the user gets feedback that the
        // action registered. If advanceRecurringTodo returns false (no
        // recurrence, or the next due exceeds endDate), fall through to
        // the standard completion path so the task terminates cleanly.
        if (checkToDo.checked && !wasCompleted && item.tit && item.recurrence && projectName) {
            const advanced = listLogic.advanceRecurringTodo(projectName, item, new Date());
            if (advanced) {
                // reorderToDoDOM re-parents each row via appendChild, which
                // cancels any in-flight CSS animation on it. Defer the
                // reorder inside the flash's setTimeout so the keyframe
                // gets to play; under reduced-motion there's no animation
                // to protect and the reorder fires synchronously.
                if (!prefersReducedMotion()) {
                    toDoChild.classList.add('recurring-flash');
                    setTimeout(function() {
                        toDoChild.classList.remove('recurring-flash');
                        checkToDo.checked = false;
                        listLogic.sortCompletedToBottom(projectName);
                        reorderToDoDOM(projectName);
                    }, 250);
                } else {
                    checkToDo.checked = false;
                    listLogic.sortCompletedToBottom(projectName);
                    reorderToDoDOM(projectName);
                }
                applyDueUrgency(toDoChild, item);
                const pill = toDoChild.querySelector('#duePill');
                if (pill) updateDuePillLabel(pill, item);
                if (isCoarsePointer() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                    try { navigator.vibrate(10); } catch (_) { /* noop */ }
                }
                return;
            }
        }

        item.completed = checkToDo.checked;
        if (checkToDo.checked) {
            toDoChild.classList.add("completed");
        } else {
            toDoChild.classList.remove("completed");
        }

        // Snapshot whether the slide-fade was kicked off on this tick.
        // The reorder below must be deferred until its animationend fires
        // — reorderToDoDOM re-parents the row via appendChild, which
        // restarts an in-flight CSS animation from frame 0 in the new DOM
        // slot, so the user would see the slide-fade play at the bottom
        // of the list on a row that had just been moved there instead of
        // on the row they actually clicked.
        let didAddSlideFade = false;

        // Celebratory micro-interaction — only on the unchecked → checked
        // edge, and only on committed rows (blank placeholders hide the
        // checkbox via CSS but guard here too for robustness).
        if (checkToDo.checked && !wasCompleted && item.tit) {
            if (isCoarsePointer() && typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                try { navigator.vibrate(10); } catch (_) { /* noop */ }
            }
            if (!prefersReducedMotion()) {
                toDoChild.classList.add('just-completed');
                setTimeout(function() {
                    toDoChild.classList.remove('just-completed');
                }, 300);
            }
            // Desktop ghost companion — cheer on every item completion. The
            // "big" variant fires when this toggle leaves zero open items in
            // the project, i.e. the project just became fully done.
            const companionInstance = ensureCompanion();
            if (companionInstance) {
                const projectForCount = toDoChild.dataset.value;
                const items = projectForCount ? (listLogic.listItems(projectForCount) || []) : [];
                const remainingOpen = items.filter(function(i) {
                    return i && i.tit && !i.completed;
                }).length;
                companionInstance.cheer(remainingOpen === 0);
            }
            if (!prefersReducedMotion()) {
                toDoChild.classList.add('todoCompleting');
                didAddSlideFade = true;
                toDoChild.addEventListener('animationend', function onSlideEnd(e) {
                    if (e.animationName !== 'todoCompletingSlideFade') return;
                    toDoChild.classList.remove('todoCompleting');
                    toDoChild.removeEventListener('animationend', onSlideEnd);
                });
            }
        }

        applyDueUrgency(toDoChild, item);

        // Partition completed entries to the bottom of this project's list,
        // then slide the row (plus any open description panel) into its new
        // slot in-place so listeners stay attached.
        function commitReorder() {
            if (projectName) {
                listLogic.sortCompletedToBottom(projectName);
                reorderToDoDOM(projectName);
            } else {
                listLogic.saveToStorage();
            }
        }

        if (didAddSlideFade) {
            toDoChild.addEventListener('animationend', function onSlideEndReorder(e) {
                if (e.animationName !== 'todoCompletingSlideFade') return;
                toDoChild.removeEventListener('animationend', onSlideEndReorder);
                commitReorder();
            });
        } else {
            commitReorder();
        }
    });

    return checkToDo;
}


// ── HELPER: wire click-to-activate then click-to-edit on a todo row ──
// First click on a committed row marks it todo-active (enabling pointer-events on
// the input). Second click on the input then focuses it for editing.
// Blank placeholder rows skip straight to focus on first click.
//
// Mobile (≤700px) replaces the desktop one-tap-to-edit with a two-stage
// tap-to-view / tap-to-edit flow on committed rows: the first tap on a
// collapsed row programmatically opens the description panel via the
// existing descToggle (so descSibling appears below) and marks the row
// `data-mobile-read="true"` WITHOUT focusing the input — the user can read
// the description without summoning the soft keyboard. A second tap on the
// title input area falls through to the focus path below and enters edit
// mode. The auto-opened state is auto-collapsed when the user taps outside
// the row+descSibling unit (handled in main.js's document click listener).
function wireToDoRowClick(toDoChild, toDoInput, descToggle) {
    toDoChild.addEventListener('click', function(e) {
        // Let dedicated controls handle their own clicks without interference
        if (e.target.id === 'checkToDo'      ||
            e.target.id === 'closeButtonToDo' ||
            e.target.id === 'descToggle'      ||
            e.target.closest('#statsToggle')  ||
            e.target.closest('#duePill')      ||
            e.target.closest('.copyTitleBtn') ||
            e.target.closest('#dueDatePopover') ||
            e.target.closest('#descSibling')  ||
            e.target.closest('#statsSibling')) return;

        // Blank rows: focus immediately (user intends to type a new item)
        if (!toDoInput.value.trim()) {
            toDoInput.focus();
            return;
        }

        const isMobile = typeof window !== 'undefined' && window.innerWidth <= 700;
        const descOpen = !!(descToggle && descToggle.classList.contains('open'));

        // Mobile tap-to-view: first tap on a collapsed committed row enters
        // read mode (descSibling appears below) without summoning the
        // keyboard. Subsequent taps on the title area fall through to the
        // focus path so the user can edit.
        if (isMobile && !descOpen && descToggle) {
            // Only one row stays in mobile-read at a time — collapse any
            // other rows that were auto-expanded by a previous tap.
            document.querySelectorAll('#toDoChild[data-mobile-read="true"]').forEach(function(other) {
                if (other === toDoChild) return;
                const otherToggle = other.querySelector('#descToggle');
                if (otherToggle && otherToggle.classList.contains('open')) {
                    otherToggle.click();
                }
            });
            descToggle.click();
            toDoChild.setAttribute('data-mobile-read', 'true');
            // Mark .todo-active so the input is interactive on the next tap
            // (matches the existing committed-row activation rule), but do
            // NOT call .focus() — that would summon the soft keyboard.
            document.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                if (el !== toDoChild) el.classList.remove('todo-active');
            });
            toDoChild.classList.add('todo-active');
            return;
        }

        // Committed rows: activate this row, deactivate all others
        document.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
            if (el !== toDoChild) el.classList.remove('todo-active');
        });
        toDoChild.classList.add('todo-active');

        // one-click editing — focus with caret at end rather than selecting text
        if (document.activeElement !== toDoInput) {
            const end = toDoInput.value.length;
            toDoInput.focus();
            toDoInput.setSelectionRange(end, end);
        }
    });

    // Whenever the description panel closes — manually via descToggle or
    // programmatically via the outside-tap collapse — clear the
    // mobile-read marker so the row's state stays in sync with what the
    // user can actually see. Without this the next tap would skip the
    // open-and-stay-in-read step and jump straight to focus.
    if (descToggle) {
        descToggle.addEventListener('click', function() {
            if (!descToggle.classList.contains('open')) {
                toDoChild.removeAttribute('data-mobile-read');
            }
        });
    }
}


// Number of missed dates a recurring task may accumulate inside the
// stats window before the drawer swaps the inline pill list for a
// 5-pill preview + a `+ N more` chip that opens the full-list modal.
// One-line tunable so the cutoff can be revisited without hunting the
// render logic. The pattern callout above the list always renders,
// regardless of count.
const MISS_PILL_THRESHOLD = 7;

// ── HELPER: wire the chart-icon toggle that opens/closes the recurring-task stats drawer ──
// Parallels wireDescToggle in behavior: opens a new `#statsSibling` panel
// directly beneath the row (after `#descSibling` if that one is also open),
// closes on a second click, and supports Enter activation when focused.
// The drawer renders a stat-card strip, a window selector (14d / 30d / 90d
// / All — default 30d), a contributions grid (or a fallback strip for
// month-/year-cadence recurrences), and a missed-dates pill list.
function wireStatsToggle(statsToggle, toDoChild, item) {

    let currentWindow = '30d';

    function renderDrawer() {
        const projectName = toDoChild.dataset.value;
        if (!projectName || !item.recurrence) return null;

        const drawer = document.createElement('div');
        drawer.id = 'statsSibling';

        const stats = listLogic.getRecurringTaskStats(projectName, item, currentWindow);

        // Stat-card strip: streak / hit rate / best / completions in window.
        const strip = document.createElement('div');
        strip.className = 'statsCardStrip';
        const cards = [
            { label: 'Streak',      value: stats.currentStreak + '' },
            { label: 'Hit rate',    value: Math.round(stats.hitRate * 100) + '%' },
            { label: 'Best',        value: stats.bestStreak + '' },
            { label: 'Done',        value: stats.completedCount + '' },
        ];
        cards.forEach(function(c) {
            const card = document.createElement('div');
            card.className = 'statsCard';
            const v = document.createElement('div');
            v.className = 'statsCardValue';
            v.textContent = c.value;
            const l = document.createElement('div');
            l.className = 'statsCardLabel';
            l.textContent = c.label;
            card.appendChild(v);
            card.appendChild(l);
            strip.appendChild(card);
        });
        drawer.appendChild(strip);

        // Approximate-dates note for completion-basis recurrences — the
        // expected sequence is reconstructed from `nextDueDate`, not from
        // authoritative per-occurrence records.
        if (item.recurrence.basis === 'completionDate') {
            const note = document.createElement('div');
            note.className = 'statsApproximateNote';
            note.textContent = 'completion-based — dates approximate';
            drawer.appendChild(note);
        }

        // Window toggle row.
        const toggleRow = document.createElement('div');
        toggleRow.className = 'statsWindowToggle';
        const windows = [
            { key: '14d', label: '14d' },
            { key: '30d', label: '30d' },
            { key: '90d', label: '90d' },
            { key: 'all', label: 'All' },
        ];
        windows.forEach(function(w) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'statsWindowBtn' + (w.key === currentWindow ? ' selected' : '');
            btn.textContent = w.label;
            btn.setAttribute('aria-pressed', w.key === currentWindow ? 'true' : 'false');
            btn.addEventListener('click', function(ev) {
                ev.stopPropagation();
                if (currentWindow === w.key) return;
                currentWindow = w.key;
                replaceDrawerInPlace();
            });
            toggleRow.appendChild(btn);
        });
        drawer.appendChild(toggleRow);

        // Grid (or fallback strip for month/year cadences).
        const useFallback =
            item.recurrence.pattern === 'monthly' ||
            item.recurrence.pattern === 'yearly' ||
            item.recurrence.intervalUnit === 'month' ||
            item.recurrence.intervalUnit === 'year';
        drawer.appendChild(
            useFallback ? buildFallbackStrip(stats) : buildContributionsGrid(stats)
        );

        // Pattern callout — a one-sentence summary of the miss set,
        // priority-ordered (abandoned → weekday → recentSlip →
        // fallback) so a long pile of dates collapses into one signal
        // the user can act on. Always renders when there are misses,
        // regardless of count.
        const summary = listLogic.summarizeRecurringMissPattern(stats);
        if (summary && summary.text) {
            const callout = document.createElement('div');
            callout.className = 'statsMissCallout';
            callout.setAttribute('data-kind', summary.kind);

            const icon = buildInfoGlyph();
            const text = document.createElement('span');
            text.className = 'statsMissCalloutText';
            text.textContent = summary.text;

            callout.appendChild(icon);
            callout.appendChild(text);
            drawer.appendChild(callout);
        }

        // Missed-dates list. Up to MISS_PILL_THRESHOLD misses render
        // inline — the user can scan every date without taking a
        // second action. Beyond the threshold the inline list shrinks
        // to the 5 newest dates plus a `+ N more` chip that opens the
        // full-history modal, so the drawer stays compact even after a
        // long abandonment.
        if (stats.misses.length > 0) {
            const missed = document.createElement('div');
            missed.className = 'statsMissedList';

            const newestFirst = stats.misses.slice().sort(function(a, b) {
                return b.getTime() - a.getTime();
            });

            if (stats.misses.length <= MISS_PILL_THRESHOLD) {
                const label = document.createElement('span');
                label.className = 'statsMissedLabel';
                label.textContent = 'Missed:';
                missed.appendChild(label);
                // Preserve the prior chronological order when the inline
                // list is short enough to scan — the existing
                // expected-order rendering reads naturally for ≤ 7.
                stats.misses.forEach(function(d) {
                    const pill = document.createElement('span');
                    pill.className = 'statsMissedPill';
                    pill.textContent = formatShortDate(d);
                    missed.appendChild(pill);
                });
            } else {
                const label = document.createElement('span');
                label.className = 'statsMissedLabel';
                label.textContent = 'Most recent misses:';
                missed.appendChild(label);
                newestFirst.slice(0, 5).forEach(function(d) {
                    const pill = document.createElement('span');
                    pill.className = 'statsMissedPill';
                    pill.textContent = formatShortDate(d);
                    missed.appendChild(pill);
                });
                const remaining = stats.misses.length - 5;
                const moreBtn = document.createElement('button');
                moreBtn.type = 'button';
                moreBtn.className = 'statsMissedMoreBtn';
                moreBtn.textContent = '+ ' + remaining + ' more';
                moreBtn.setAttribute('aria-label',
                    'Show all ' + stats.misses.length + ' missed dates');
                moreBtn.addEventListener('click', function(ev) {
                    ev.stopPropagation();
                    showMissedDatesModal(item.tit, newestFirst);
                });
                missed.appendChild(moreBtn);
            }

            drawer.appendChild(missed);
        }

        return drawer;
    }

    // Replace the open drawer in place without closing the description
    // panel — used by the window-toggle buttons so a click on `14d` /
    // `30d` etc. re-derives stats and re-renders the grid while leaving
    // the drawer (and any sibling descSibling) intact.
    function replaceDrawerInPlace() {
        const mainList = toDoChild.parentElement;
        if (!mainList) return;
        let existing = toDoChild.nextSibling;
        while (existing && existing.id !== 'statsSibling') existing = existing.nextSibling;
        if (!existing) return;
        const fresh = renderDrawer();
        if (!fresh) return;
        mainList.replaceChild(fresh, existing);
    }

    statsToggle.addEventListener('click', function(event) {
        event.stopPropagation();
        // Defensive: button is CSS-hidden when no recurrence, but if a
        // keyboard activation slips through, no-op rather than render an
        // empty drawer.
        if (!item.recurrence) return;
        const mainList = toDoChild.parentElement;
        if (!mainList) return;

        // Check if a stats drawer for this row is already open. The
        // drawer lives directly after the row OR after descSibling if
        // both are open.
        let existing = toDoChild.nextSibling;
        while (existing && existing.id !== 'statsSibling') {
            if (existing.id !== 'descSibling') {
                existing = null;
                break;
            }
            existing = existing.nextSibling;
        }

        if (existing && existing.id === 'statsSibling') {
            mainList.removeChild(existing);
            statsToggle.classList.remove('open');
            statsToggle.setAttribute('aria-expanded', 'false');
            statsToggle.setAttribute('aria-label', 'Show stats');
            return;
        }

        const drawer = renderDrawer();
        if (!drawer) return;
        // Slot after descSibling when it's open so both panels stack
        // beneath the row in a deterministic order. Otherwise slot
        // directly under the row.
        const descBelow = (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling')
            ? toDoChild.nextSibling
            : null;
        const anchor = descBelow || toDoChild;
        mainList.insertBefore(drawer, anchor.nextSibling);
        statsToggle.classList.add('open');
        statsToggle.setAttribute('aria-expanded', 'true');
        statsToggle.setAttribute('aria-label', 'Hide stats');
    });

    statsToggle.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        statsToggle.click();
    });
}


// Build the contributions-grid SVG for daily / weekdays / weekly /
// custom-day / custom-week recurrences. Layout is weeks-as-columns,
// weekday-as-rows (Sun..Sat). Cells are 14×14 with 4px gaps. Only
// expected-occurrence dates are filled — non-expected days in the window
// remain blank so the grid surfaces the cadence visually.
function buildContributionsGrid(stats) {
    const wrapper = document.createElement('div');
    wrapper.className = 'statsGridWrapper';

    const cellSize = 14;
    const gap = 4;
    // Gutters host weekday letters down the left edge and month
    // abbreviations along the top. Cells are shifted by these offsets so
    // they visually align under their column's month label and beside
    // their row's weekday letter.
    const labelGutterX = 14;
    const labelGutterY = 14;
    // Right gutter gives a month label that starts at the last column room
    // to extend past the last cell's right edge; without it, a single-column
    // grid clips "May"/"Sept"/etc. to one or two letters.
    const labelGutterRight = 24;
    const expected = stats.expectedDates;
    if (expected.length === 0) {
        wrapper.classList.add('statsGridEmpty');
        wrapper.textContent = 'No expected occurrences in this window yet.';
        return wrapper;
    }

    // Back-align the first expected date to Sunday so weekday rows stay
    // visually consistent across windows.
    const first = expected[0];
    const dowOffset = first.getDay();
    const alignedStart = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    alignedStart.setDate(alignedStart.getDate() - dowOffset);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = isoKey(today);

    // Total columns = weeks from alignedStart through today inclusive.
    const msPerDay = 24 * 60 * 60 * 1000;
    const daysSpan = Math.floor((today.getTime() - alignedStart.getTime()) / msPerDay) + 1;
    const totalCols = Math.max(1, Math.ceil(daysSpan / 7));

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    const gridWidth  = totalCols * cellSize + (totalCols - 1) * gap;
    const gridHeight = 7 * cellSize + 6 * gap;
    const width  = labelGutterX + gridWidth + labelGutterRight;
    const height = labelGutterY + gridHeight;
    svg.setAttribute('width',  width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'statsGrid');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Recurring task hit grid');

    // Weekday letters down the left gutter, Sunday-first to match the
    // `row = d.getDay()` math used for cell placement.
    const weekdayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
    for (let row = 0; row < 7; row++) {
        const label = document.createElementNS(svgNS, 'text');
        label.setAttribute('x', 0);
        label.setAttribute('y', labelGutterY + row * (cellSize + gap) + cellSize / 2);
        label.setAttribute('dominant-baseline', 'middle');
        label.setAttribute('class', 'statsGridLabel');
        label.textContent = weekdayLetters[row];
        svg.appendChild(label);
    }

    // Month abbreviations along the top gutter. First column is always
    // labeled; subsequent columns are labeled only when their first
    // day-of-week falls in a different calendar month than the previous
    // column's, so consecutive same-month columns don't repeat.
    let lastLabeledMonth = -1;
    for (let col = 0; col < totalCols; col++) {
        const colStart = new Date(alignedStart.getTime() + col * 7 * msPerDay);
        const monthIdx = colStart.getMonth();
        if (col === 0 || monthIdx !== lastLabeledMonth) {
            const label = document.createElementNS(svgNS, 'text');
            label.setAttribute('x', labelGutterX + col * (cellSize + gap));
            label.setAttribute('y', 10);
            label.setAttribute('class', 'statsGridLabel');
            label.textContent = colStart.toLocaleString(undefined, { month: 'short' });
            svg.appendChild(label);
            lastLabeledMonth = monthIdx;
        }
    }

    expected.forEach(function(d) {
        const dayIdx = Math.floor((d.getTime() - alignedStart.getTime()) / msPerDay);
        const col = Math.floor(dayIdx / 7);
        const row = d.getDay();
        const x = labelGutterX + col * (cellSize + gap);
        const y = labelGutterY + row * (cellSize + gap);

        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', cellSize);
        rect.setAttribute('height', cellSize);
        rect.setAttribute('rx', 2);
        rect.setAttribute('ry', 2);

        const key = isoKey(d);
        rect.setAttribute('class', cellClasses(key, d, today, todayKey, stats));

        const titleEl = document.createElementNS(svgNS, 'title');
        titleEl.textContent = formatShortDate(d) +
            ' — ' + cellTitleLabel(key, d, today, stats);
        rect.appendChild(titleEl);
        svg.appendChild(rect);
    });

    wrapper.appendChild(svg);
    return wrapper;
}

// Fallback horizontal strip for monthly / yearly / custom-month /
// custom-year cadences — a weekday grid would be too sparse to read at
// those intervals, so the last 12 expected occurrences are rendered as
// a single row of 18×18 cells.
function buildFallbackStrip(stats) {
    const wrapper = document.createElement('div');
    wrapper.className = 'statsGridWrapper statsFallbackStrip';

    const cellSize = 18;
    const gap = 4;
    const expected = stats.expectedDates.slice(-12);
    if (expected.length === 0) {
        wrapper.classList.add('statsGridEmpty');
        wrapper.textContent = 'No expected occurrences in this window yet.';
        return wrapper;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = isoKey(today);

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    const width  = expected.length * cellSize + (expected.length - 1) * gap;
    const height = cellSize;
    svg.setAttribute('width',  width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'statsGrid');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Recurring task occurrence strip');

    expected.forEach(function(d, idx) {
        const x = idx * (cellSize + gap);
        const rect = document.createElementNS(svgNS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', 0);
        rect.setAttribute('width', cellSize);
        rect.setAttribute('height', cellSize);
        rect.setAttribute('rx', 2);
        rect.setAttribute('ry', 2);

        const key = isoKey(d);
        rect.setAttribute('class', cellClasses(key, d, today, todayKey, stats));

        const titleEl = document.createElementNS(svgNS, 'title');
        titleEl.textContent = formatShortDate(d) +
            ' — ' + cellTitleLabel(key, d, today, stats);
        rect.appendChild(titleEl);
        svg.appendChild(rect);
    });

    wrapper.appendChild(svg);
    return wrapper;
}

// Class string for a grid cell. Today's cell gets the hit fill AND the
// today stroke when a clone for today exists in the project's items — so
// the user can see "I did the thing today" as a filled cell with the
// today ring overlaid on top. When today has no matching clone yet, the
// cell falls back to the ring-only treatment.
function cellClasses(key, d, today, todayKey, stats) {
    let cls = 'statsCell';
    if (key === todayKey) {
        if (stats.hits.has(key)) cls += ' statsCellHit statsCellTodayHit';
        else cls += ' statsCellToday';
    } else if (d.getTime() > today.getTime()) {
        cls += ' statsCellFuture';
    } else if (stats.hits.has(key)) {
        cls += ' statsCellHit';
    } else {
        cls += ' statsCellMiss';
    }
    return cls;
}

// Tooltip label for a grid cell — read aloud via title text on hover.
function cellTitleLabel(key, d, today, stats) {
    if (key === isoKey(today)) {
        return stats.hits.has(key) ? 'today, completed' : 'today';
    }
    if (d.getTime() > today.getTime()) return 'upcoming';
    if (stats.hits.has(key)) return 'hit';
    return 'missed';
}

// Local-time ISO key (YYYY-MM-DD). Mirrors listLogic.formatCalendarKey
// so cell hits compare against the same keys produced by the stats
// helper, without an import cycle through the module's internal helper.
function isoKey(date) {
    const y = date.getFullYear();
    const m = date.getMonth() + 1;
    const d = date.getDate();
    return y + '-' + (m < 10 ? '0' + m : '' + m) + '-' + (d < 10 ? '0' + d : '' + d);
}

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatShortDate(d) {
    return MONTH_SHORT[d.getMonth()] + ' ' + d.getDate();
}

// Inline-SVG info glyph (circle with a dot above a vertical line) for
// the miss-pattern callout. Sized 14×14 to match the stroke / size
// rhythm of `.recurringGlyph` in style.css so the meta strip and the
// drawer's accent visuals read as the same family.
function buildInfoGlyph() {
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'statsMissCalloutIcon');
    svg.setAttribute('width', 14);
    svg.setAttribute('height', 14);
    svg.setAttribute('viewBox', '0 0 14 14');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');

    const circle = document.createElementNS(svgNS, 'circle');
    circle.setAttribute('cx', 7);
    circle.setAttribute('cy', 7);
    circle.setAttribute('r', 6);
    circle.setAttribute('fill', 'none');
    circle.setAttribute('stroke', 'currentColor');
    circle.setAttribute('stroke-width', 1.2);
    svg.appendChild(circle);

    const dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', 7);
    dot.setAttribute('cy', 4);
    dot.setAttribute('r', 0.9);
    dot.setAttribute('fill', 'currentColor');
    svg.appendChild(dot);

    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', 7);
    line.setAttribute('y1', 6.2);
    line.setAttribute('x2', 7);
    line.setAttribute('y2', 10.5);
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', 1.2);
    line.setAttribute('stroke-linecap', 'round');
    svg.appendChild(line);

    return svg;
}


// ── HELPER: wire the dropdown toggle button that opens/closes a row's description ──
// Replaces the old behaviour where clicking anywhere on the todo row expanded the description.
function wireDescToggle(descToggle, toDoChild, descSibling, descSpacer1, descInput, descSpacer2, item) {

    let switcher = 0;

    descToggle.addEventListener("click", function(event) {
        event.stopPropagation();

        const mainList = toDoChild.parentElement;
        if (!mainList) return;

        if (switcher === 0) {
            mainList.insertBefore(descSibling, toDoChild.nextSibling);
            descSibling.appendChild(descSpacer1);
            descSibling.appendChild(descInput);
            descSibling.appendChild(descSpacer2);
            descInput.value = item["desc"] || "";
            descToggle.classList.add("open");
            switcher = 1;
        } else {
            if (toDoChild.nextSibling && toDoChild.nextSibling.id === 'descSibling') {
                mainList.removeChild(toDoChild.nextSibling);
            }
            descToggle.classList.remove("open");
            switcher = 0;
        }
    });

    // Enter on the focused expand caret routes through the same click handler
    // so keyboard activation toggles the description panel identically to a
    // mouse click. Focus stays on the caret either way: on expand, Tab steps
    // naturally into the new description input; on collapse, the caret keeps
    // focus so the user can re-open with Enter again.
    descToggle.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        descToggle.click();
    });
}


// Factory function — builds and fully wires a single todo row for the given
// item and project name. Does NOT append to mainList — that's the caller's job.
export function buildToDoRow(item, toDoName) {

    // create elements
    const toDoChild       = document.createElement("div");
    const toDoInput       = document.createElement("input");
    const copyBtn         = document.createElement("button");
    const duePill         = document.createElement("button");
    const closeButtonToDo = document.createElement("div");
    const descToggle      = document.createElement("div");
    const statsToggle     = document.createElement("div");
    const spacer          = document.createElement("div");
    const descSibling     = document.createElement("div");
    const descSpacer1     = document.createElement("div");
    const descInput       = document.createElement("input");
    const descSpacer2     = document.createElement("div");

    // set IDs and initial styles
    toDoChild.id           = "toDoChild";
    // tabindex="-1" lets the global Up/Down arrow handler programmatically
    // focus the row in keyboard-navigation mode (without putting it in the
    // tab order). Enter on a focused row hands focus to the input.
    toDoChild.setAttribute("tabindex", "-1");

    // Marker for rows built as blank placeholders. The keyup persistence
    // block consults this flag so typing into a blank doesn't bake a
    // partial title into the data model — a project switch before Enter
    // would otherwise leave the typed text behind and reveal the row's
    // chrome as though it were a committed todo. The Enter commit handler
    // strips the marker once the row becomes a real item.
    if (!item.tit) {
        toDoChild.dataset.originalBlank = "true";
    }

    duePill.id       = "duePill";
    duePill.type     = "button";
    duePill.setAttribute('aria-haspopup', 'dialog');
    duePill.setAttribute('aria-expanded', 'false');

    spacer.id = "spacer";

    toDoInput.type        = "text";
    toDoInput.autocomplete = "off";
    toDoInput.id          = "toDoInput";
    toDoInput.placeholder = "Add a task — press Enter";
    // Blank placeholders built after the user's first mobile commit in
    // this project session switch to the "Type the next…" copy so the
    // chained-entry flow reads as a continuous stream. The desktop
    // affordance string above remains the default; only chained mobile
    // blanks override it.
    if (!item.tit && isChainingActive()) {
        toDoInput.placeholder = "Type the next…";
    }
    toDoInput.style.fontSize = "14px";
    toDoInput.value       = item.tit || "";
    toDoInput.style.border = "none";
    // Mirror the full title onto the native browser tooltip so compact-titles
    // mode can rely on hover to reveal text that the ellipsis would clip.
    toDoInput.title       = item.tit || "";

    // Affordance cue only on the blank placeholder row: a leading purple `+`
    // glyph. Decorative (aria-hidden, pointer-events: none in CSS) so click-
    // anywhere on the row still falls through to wireToDoRowClick → focus the
    // input.
    const addGlyph = !item.tit ? document.createElement("span") : null;
    if (addGlyph) {
        addGlyph.id = "addGlyph";
        addGlyph.setAttribute('aria-hidden', 'true');
        addGlyph.textContent = "+";
    }

    closeButtonToDo.id = "closeButtonToDo";
    // Hide delete on blank placeholder rows — deleting the only available
    // input slot would leave the user with no way to create new items.
    if (!item.tit) closeButtonToDo.style.display = "none";
    // tabindex + role mirror the descToggle treatment so keyboard users can
    // tab to the delete button and press Enter to fire the same confirm-delete
    // flow the mouse path uses. Hidden placeholder rows skip it via display:none.
    closeButtonToDo.setAttribute("tabindex", "0");
    closeButtonToDo.setAttribute("role", "button");
    closeButtonToDo.setAttribute("aria-label", "Delete todo");

    // Blank placeholder rows hide the due-date pill for the same reason the
    // checkbox / toggle / close button hide above: there's no committed item
    // yet, so the "Set date" trigger would be visual noise. Revealed on commit.
    if (!item.tit) {
        duePill.style.display = "none";
    }

    // COPY-TITLE BUTTON — mobile-only chrome that lets the user tap to copy
    // the todo's title to the clipboard. The button is in the DOM for every
    // committed row but only paints at ≤700px via CSS; desktop rows never
    // surface it. Blank placeholder rows skip it entirely (display:none)
    // because there's no title to copy yet. On click the SVG swaps from the
    // Tabler copy glyph to a checkmark for ~1s as feedback, then restores.
    copyBtn.id = "copyTitleBtn";
    copyBtn.type = "button";
    copyBtn.className = "copyTitleBtn";
    copyBtn.setAttribute("aria-label", "Copy todo title");
    copyBtn.setAttribute("tabindex", "0");
    copyBtn.title = "Copy todo title";
    if (!item.tit) copyBtn.style.display = "none";
    setCopyBtnGlyph(copyBtn, false);

    descToggle.id            = "descToggle";
    descToggle.style.display = item.tit ? "flex" : "none";
    // tabindex makes the non-button caret focusable so keyboard users can
    // reach it in tab order. Hidden placeholder rows (display:none) skip it
    // naturally, and committing the row reveals it without a re-wire.
    descToggle.setAttribute("tabindex", "0");
    descToggle.setAttribute("role", "button");
    descToggle.setAttribute("aria-label", "Toggle description");

    // Stats toggle — chart-icon button that opens the recurring-task
    // stats drawer. Always present in the DOM but CSS-hidden unless the
    // row carries `data-has-recurrence` (set by updateRecurringGlyph), so
    // non-recurring rows never surface the icon.
    statsToggle.id = "statsToggle";
    statsToggle.className = "statsToggle";
    statsToggle.setAttribute("tabindex", "0");
    statsToggle.setAttribute("role", "button");
    statsToggle.setAttribute("aria-label", "Show stats");
    statsToggle.setAttribute("aria-expanded", "false");
    statsToggle.title = "Show recurring-task stats";
    statsToggle.innerHTML = '<svg viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="2" y1="12" x2="12" y2="12"/><rect x="3" y="7" width="1.8" height="4"/><rect x="6.1" y="4" width="1.8" height="7"/><rect x="9.2" y="2" width="1.8" height="9"/></svg>';

    descSibling.id  = "descSibling";
    descSpacer1.id  = "descSpacer1";
    descInput.id    = "descInput";
    descSpacer2.id  = "descSpacer2";
    descInput.type  = "text";
    descInput.autocomplete = "off";
    descInput.placeholder = "Type description here...";
    descInput.style.fontSize = "12px";
    descInput.value = "";
    descInput.style.border = "none";

    // Swipe action panes — absolute-positioned fills revealed behind the row
    // on touch horizontal swipe. Kept as the first children so a default
    // stacking context places them below the row content. Styling lives in
    // style.css; visibility is driven by `--swipe-dx` / `--swipe-progress`
    // CSS variables set on the row while a swipe gesture is active.
    const swipePaneLeft  = document.createElement('div');
    swipePaneLeft.className = 'swipeActionPane swipeActionLeft';
    swipePaneLeft.setAttribute('aria-hidden', 'true');
    const swipeGlyphLeft = document.createElement('span');
    swipeGlyphLeft.className = 'swipeActionGlyph';
    swipeGlyphLeft.textContent = '✓';
    swipePaneLeft.appendChild(swipeGlyphLeft);

    const swipePaneRight = document.createElement('div');
    swipePaneRight.className = 'swipeActionPane swipeActionRight';
    swipePaneRight.setAttribute('aria-hidden', 'true');
    const swipeGlyphRight = document.createElement('span');
    swipeGlyphRight.className = 'swipeActionGlyph';
    swipeGlyphRight.textContent = '✕';
    swipePaneRight.appendChild(swipeGlyphRight);

    // assemble DOM tree
    toDoChild.appendChild(swipePaneLeft);
    toDoChild.appendChild(swipePaneRight);
    if (addGlyph) toDoChild.appendChild(addGlyph);
    toDoChild.appendChild(toDoInput);
    toDoChild.appendChild(copyBtn);
    toDoChild.appendChild(duePill);
    toDoChild.appendChild(spacer);
    toDoChild.appendChild(statsToggle);
    toDoChild.appendChild(descToggle);
    toDoChild.appendChild(closeButtonToDo);

    updateDuePillLabel(duePill, item);
    applyDueUrgency(toDoChild, item);
    updateRecurringGlyph(toDoChild, item);
    updateDescIndicator(toDoChild, item);

    // STACK mobile inline-expand chips — only the blank placeholder gets
    // the chip row, since it's the only row the chip controls (Today /
    // Tomorrow / calendar / description toggle) make sense on. The chip
    // row is visually surfaced via CSS at the ≤700px breakpoint when the
    // row is focus-within.
    attachMobileCreateChips(toDoChild, item);

    duePill.addEventListener('click', function(event) {
        event.stopPropagation();
        if (document.getElementById('dueDatePopover')) {
            hideDueDatePopover();
        } else {
            showDueDatePopover(duePill, item, toDoChild);
        }
    });
    wireSubControlBackspaceExit(duePill, toDoChild);

    // Copy-title button: writes item.tit to the clipboard and briefly swaps
    // the icon to a checkmark as confirmation. stopPropagation prevents the
    // row's click-anywhere-to-focus-input handler from stealing focus when
    // the user taps the icon.
    copyBtn.addEventListener('click', function(event) {
        event.stopPropagation();
        event.preventDefault();
        copyTitleToClipboard(item, copyBtn);
    });
    wireSubControlBackspaceExit(copyBtn, toDoChild);

    // wire helpers
    wireDescToggle(descToggle, toDoChild, descSibling, descSpacer1, descInput, descSpacer2, item);
    wireSubControlBackspaceExit(descToggle, toDoChild);
    wireStatsToggle(statsToggle, toDoChild, item);
    wireSubControlBackspaceExit(statsToggle, toDoChild);
    const checkToDo = wireCheckbox(toDoChild, toDoInput, item);
    attachToDoDrag(toDoChild, toDoInput, toDoName, {
        checkToDo: checkToDo,
        closeButtonToDo: closeButtonToDo,
        item: item
    });
    wireToDoRowClick(toDoChild, toDoInput, descToggle);

    // Browsers natively toggle a checkbox on Space but NOT on Enter. Adding
    // Enter→toggle here keeps the keyboard contract uniform with the row's
    // other sub-controls (title, due pill, expand caret, delete X, description),
    // each of which activates on Enter when focused.
    checkToDo.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        checkToDo.checked = !checkToDo.checked;
        checkToDo.dispatchEvent(new Event("change"));
    });
    wireSubControlBackspaceExit(checkToDo, toDoChild);

    toDoChild.setAttribute("data-value", toDoName);
    // Anchor the DOM row to its data-model item so reorderToDoDOM can match
    // rows to items even when titles collide (e.g. a newly committed row
    // whose title matches an existing completed item).
    toDoChild.__item = item;

    // toDoInput keydown — Enter to commit title
    toDoInput.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        const val = toDoInput.value.trim();
        if (!val) return;

        // First-commit means the project has no blank placeholder above this
        // row — so Enter must spawn one. Check the data model directly rather
        // than savedTitle: the keyup handler mutates this row's item.tit as
        // the user types, so after a blur-and-return, savedTitle is captured
        // non-empty on the second focus and the old savedTitle === "" gate
        // would miss the missing-blank case.
        const siblingItems = (listLogic.listItems(toDoName) || []).filter(function(i) { return i !== item; });
        const hasBlankPlaceholder = siblingItems.some(function(i) { return !i.tit; });
        const isFirstCommit = !hasBlankPlaceholder;

        toDoInput.value = val;
        toDoInput.title = val;
        item.tit = val;
        item.pri = 2;
        // Row is no longer a blank placeholder — clear the marker so the
        // keyup persistence block resumes saving keystroke edits to this
        // now-committed row's title.
        delete toDoChild.dataset.originalBlank;
        // STACK mobile inline-expand: if the user picked Today / Tomorrow
        // from the chip row (or left the default Today), stamp that date
        // before the desktop fallback. The chip module no-ops on Custom
        // chip selection — the popover already wrote item.due in that
        // path, so parseItemDue catches it below and the fallback skips.
        if (window.innerWidth <= 700 && !parseItemDue(item)) {
            applyChosenDueToItem(item, toDoChild);
        }
        // If no due date is set yet, default to today + 7 days so the urgency
        // classes and footer counter have something meaningful to key off.
        if (!parseItemDue(item)) {
            const fallback = defaultDueParts();
            item.due = fallback.m + "-" + fallback.d + "-" + fallback.y;
        }

        listLogic.saveToStorage();
        applyDueUrgency(toDoChild, item);
        updateDuePillLabel(duePill, item);

        // Idempotent — no-op when already visible; safely covers first-commit reveal.
        descToggle.style.display      = "flex";
        checkToDo.style.display       = "";
        closeButtonToDo.style.display = "";
        duePill.style.display         = "";
        copyBtn.style.display         = "";
        // Strip the blank-row affordance cue — once committed, this row is a
        // real todo and the leading `+` glyph would be misleading.
        if (addGlyph && addGlyph.parentElement) addGlyph.remove();

        // STACK mobile commit accent — 700ms fading purple left-edge so the
        // user sees their just-committed task land. Also flips the session
        // into "chaining" mode so the next blank placeholder built by
        // appendNewToDoRow uses the "Type the next…" copy instead of the
        // initial dashed-row hint.
        if (window.innerWidth <= 700) {
            // Strip the blank-placeholder marker now that this row is a
            // real todo; the chip row CSS rules key off the attribute.
            toDoChild.removeAttribute('data-blank-placeholder');
            toDoChild.classList.remove('mobile-create-row');
            const chipRow = toDoChild.querySelector('#mobileCreateChips');
            if (chipRow) chipRow.remove();

            if (!prefersReducedMotion()) {
                toDoChild.classList.add('justCommittedMobile');
                setTimeout(function() {
                    toDoChild.classList.remove('justCommittedMobile');
                }, 700);
            }
            markChainingActive();
        }

        toDoInput.blur();
        if (isFirstCommit) {
            appendNewToDoRow(toDoName);
        } else {
            focusBlankToDoInput();
        }
    });

    // toDoInput keyup — save on every keystroke. Skip the persistence write
    // entirely for rows still flagged as blank placeholders: a partial title
    // baked into item.tit would re-render as a committed row (chrome and all)
    // after a project switch, since buildToDoRow keys its placeholder branches
    // off `!item.tit`. The Enter commit handler clears the flag, so chained
    // edits after commit keystroke-save like any other committed row.
    toDoInput.addEventListener("keyup", function() {
        if (toDoChild.dataset.originalBlank === "true") return;
        const val = toDoInput.value.trim();
        if (val.length > 0) {
            item.tit = val;
            toDoInput.title = val;
            listLogic.saveToStorage();
        }
    });

    // snap-back: restore last title if field is cleared and blurred
    let savedTitle = item.tit || "";
    toDoInput.addEventListener("focus", function() {
        savedTitle = item.tit || toDoInput.value.trim();
    });
    toDoInput.addEventListener("blur", function() {
        if (toDoInput.value.trim().length === 0 && savedTitle.length > 0) {
            toDoInput.value = savedTitle;
            item.tit = savedTitle;
            listLogic.saveToStorage();
        }
        toDoInput.title = item.tit || "";
    });

    // Escape on the title cancels the in-progress edit by restoring the
    // value captured on the last focus, then blurs so the user can move on.
    // Mirrors the standard inline-edit cancel pattern used by other apps.
    toDoInput.addEventListener("keydown", function(event) {
        if (event.key !== "Escape") return;
        toDoInput.value = savedTitle;
        item.tit = savedTitle;
        listLogic.saveToStorage();
        toDoInput.title = savedTitle;
        toDoInput.blur();
        event.preventDefault();
    });

    // descInput keydown — Enter to save (empty is a valid cleared state)
    descInput.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        const val = descInput.value.trim();
        descInput.value = val;
        item.desc = val;
        listLogic.saveToStorage();
        descInput.style.border = "none";
        updateDescIndicator(toDoChild, item);
        descInput.blur();
    });

    // descInput keyup — save on every keystroke (empty saves too)
    descInput.addEventListener("keyup", function() {
        item.desc = descInput.value.trim();
        listLogic.saveToStorage();
        updateDescIndicator(toDoChild, item);
    });

    // descInput blur — persist on click-away so cleared values aren't lost
    descInput.addEventListener("blur", function() {
        item.desc = descInput.value.trim();
        listLogic.saveToStorage();
        updateDescIndicator(toDoChild, item);
    });

    // Escape on the description cancels the in-progress edit by restoring
    // the value captured on the last focus, then blurs. Matches the title's
    // Escape semantics so both inline-edit surfaces feel the same.
    let savedDesc = item.desc || "";
    descInput.addEventListener("focus", function() {
        savedDesc = item.desc || "";
    });
    descInput.addEventListener("keydown", function(event) {
        if (event.key !== "Escape") return;
        descInput.value = savedDesc;
        item.desc = savedDesc;
        listLogic.saveToStorage();
        descInput.blur();
        event.preventDefault();
    });

    // closeButtonToDo click — confirm, then remove this todo item and re-render.
    // Deletes by item reference so duplicate titles or a cleared input value
    // can't misroute the splice onto a different row.
    closeButtonToDo.addEventListener("click", function() {
        const label = (item.tit || "").trim() || "this todo";
        showConfirmModal({
            message: 'Delete "' + label + '"? This cannot be undone.',
            onConfirm: function() {
                // Capture the deleted row's slot among `#toDoChild` siblings
                // before splicing it out, so after re-render we can shift
                // `.todo-active` to whatever row now occupies that slot —
                // keeping a visible anchor for arrow-key nav instead of
                // leaving the list with no active row.
                const mainDiv = document.getElementById('mainList');
                const priorRows = mainDiv
                    ? Array.prototype.slice.call(mainDiv.querySelectorAll('#toDoChild'))
                    : [];
                const deletedIdx = priorRows.indexOf(toDoChild);

                listLogic.removeToDoByItem(toDoName, item);

                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }

                addAllToDo_DOM(listLogic.listItems(toDoName), toDoName);

                if (deletedIdx >= 0) {
                    const newRows = Array.prototype.slice.call(
                        mainDiv.querySelectorAll('#toDoChild')
                    );
                    // Prefer the row that now occupies the deleted slot
                    // (a neighbor below). If the deleted row was the last
                    // one, fall back to the previous row. If the only
                    // remaining row is the blank placeholder — i.e. the
                    // user just deleted the last committed todo — let it
                    // receive `.todo-active` so the list still has a
                    // visible anchor for arrow-key nav.
                    const target = newRows[deletedIdx] || newRows[newRows.length - 1];
                    if (target) {
                        // Defer to the next task so the modal's confirm-
                        // click finishes bubbling before we mark the row.
                        // The document-level listener in main.js strips
                        // `.todo-active` from every row on any click that
                        // isn't inside a `#toDoChild` — including the
                        // modal button — so adding the class synchronously
                        // here would be wiped out a moment later.
                        setTimeout(function() {
                            mainDiv.querySelectorAll('#toDoChild.todo-active').forEach(function(el) {
                                if (el !== target) el.classList.remove('todo-active');
                            });
                            target.classList.add('todo-active');
                            // Focus the row itself (tabindex="-1") so the
                            // `:focus-within` highlight kicks in — the
                            // visible outline that the user expects after
                            // deletion comes from focus, not the class.
                            // Mirrors the arrow-nav handler in main.js.
                            target.focus();
                        }, 0);
                    }
                }
            }
        });
    });

    // Enter on the focused delete button routes through the same click
    // handler so keyboard users get the same confirm-then-delete modal flow
    // as a mouse click — the row is never deleted without confirmation.
    closeButtonToDo.addEventListener("keydown", function(event) {
        if (event.key !== "Enter") return;
        event.preventDefault();
        closeButtonToDo.click();
    });
    wireSubControlBackspaceExit(closeButtonToDo, toDoChild);

    closeButtonToDo.addEventListener("mouseenter", function() {
        this.style.boxShadow = "0 4px 8px rgba(0, 0, 0, 0.2)";
        this.style.border = "0.05px solid black";
    });
    closeButtonToDo.addEventListener("mouseleave", function() {
        this.style.boxShadow = "none";
        this.style.border = "none";
    });

    return toDoChild;
}


// ── ROW LIFECYCLE HELPERS ──
// These were threaded through `toDoRowDeps` and `projectRowDeps` while they
// lived in main.js. With the carve-out complete they import directly from
// here; the deps bags are gone.


// Render every persisted item for `name` into #mainList. Used on the bulk
// add path (project switch from a fresh project, post-delete re-render).
// `items` is the array returned by listLogic.listItems(name).
export function addAllToDo_DOM(items, name) {
    if (!items) return;
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    items.forEach(function(item) {
        mainListDiv.appendChild(buildToDoRow(item, name));
    });
    updateCompletedSection(mainListDiv);
}


// Re-render a project's rows from persisted data. Re-sorts first so the
// blank placeholder is pinned to the top of the list, then renders every
// item — including the blank — so the user always has a ready-to-type
// slot at the top of the list. Used by the restoreFromStorage path on boot
// and by selectProject when a previously visited project becomes active.
//
// `opts.fromSync: true` forwards onto listLogic.sortCompletedToBottom so
// the post-Drive-import rebuild — which re-sorts every project on the way
// through — doesn't bump the local mutation marker past the just-written
// lastDriveSyncedAt and leave the sync indicator stuck on 'ahead'. The
// user-triggered callers (project select, post-rename re-render, app boot)
// keep their existing behaviour by omitting opts.
export function addToDos_restore(toDoArray, toDoName, opts) {
    if (!toDoArray || toDoArray.length === 0) return;
    listLogic.sortCompletedToBottom(toDoName, opts);
    const items = listLogic.listItems(toDoName);
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    items.forEach(function(item) {
        mainListDiv.appendChild(buildToDoRow(item, toDoName));
    });
    updateCompletedSection(mainListDiv);
}


// Walk the persisted project order and re-append each `#toDoChild` row in
// that sequence. Any open `#descSibling` panel directly after a row is moved
// with it. Uses `appendChild` on existing DOM nodes so event listeners stay
// attached — mirrors the in-place move pattern in `attachToDoDrag`.
// Keyed by the row's attached data-item reference rather than its title so
// that a newly committed title colliding with an existing completed item
// still maps 1:1 to its own DOM row.
export function reorderToDoDOM(projectName) {
    const mainDiv = document.getElementById('mainList');
    if (!mainDiv) return;
    const items = listLogic.listItems(projectName);
    if (!items) return;

    const rowsByItem = new Map();
    const rows = mainDiv.querySelectorAll('#toDoChild');
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].__item) rowsByItem.set(rows[i].__item, rows[i]);
    }

    items.forEach(function(item) {
        let row = rowsByItem.get(item);
        if (!row) row = buildToDoRow(item, projectName);
        // Collect any auxiliary panels that belong to this row (the
        // description panel and the recurring-task stats drawer can both
        // be open). They sit as consecutive siblings beneath the row.
        const auxiliary = [];
        let next = row.nextSibling;
        while (next && (next.id === 'descSibling' || next.id === 'statsSibling')) {
            auxiliary.push(next);
            next = next.nextSibling;
        }
        mainDiv.appendChild(row);
        auxiliary.forEach(function(node) { mainDiv.appendChild(node); });
    });

    updateCompletedSection(mainDiv);
}


// Wire drag reordering on a todo row. Keeps `row.draggable` in sync with
// the title state so blank placeholder rows never participate in reorder
// math, and text selection inside the title input isn't hijacked by the
// browser's drag handler during editing.
// `swipeTargets` (optional) wires horizontal swipe-to-complete / swipe-to-delete
// on touch devices. Swipe-right reuses the existing checkbox change path so
// persistence is identical. Swipe-left commits the delete immediately (no
// confirm modal — the mobile flow uses a 5s UNDO toast for recovery per
// the STACK mobile task-interactions spec) and surfaces an undo affordance
// the user can tap to restore the row at its original position.
export function attachToDoDrag(toDoChild, toDoInput, project, swipeTargets) {

    const swipeCfg = swipeTargets ? {
        onRight: function() {
            const cb = swipeTargets.checkToDo;
            if (!cb || cb.style.display === 'none') return;
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
        },
        onLeft: function() {
            const btn = swipeTargets.closeButtonToDo;
            if (!btn || btn.style.display === 'none') return;
            const item = swipeTargets.item;
            // Resolve the live project name from the row — the closed-over
            // `project` value may be stale if the user navigated away and
            // back, but the row's data-value is kept in sync by selectProject.
            const projectName = toDoChild.dataset && toDoChild.dataset.value
                ? toDoChild.dataset.value
                : project;
            if (!item || !projectName) {
                // Fall back to the existing confirm-modal path when we can't
                // identify the item — keeps the safety net intact for any
                // unexpected wiring instead of silently dropping the action.
                btn.click();
                return;
            }
            const items = listLogic.listItems(projectName) || [];
            const originalIndex = items.indexOf(item);
            if (originalIndex === -1) return;

            const label = (item.tit || '').trim() || 'todo';

            listLogic.removeToDoByItem(projectName, item);

            const mainDiv = document.getElementById('mainList');
            if (mainDiv) {
                while (mainDiv.firstChild) { mainDiv.removeChild(mainDiv.firstChild); }
                addAllToDo_DOM(listLogic.listItems(projectName), projectName);
            }

            showUndoToast({
                label: 'Deleted "' + label + '"',
                onUndo: function() {
                    listLogic.insertToDoAt(projectName, item, originalIndex);
                    const md = document.getElementById('mainList');
                    if (md) {
                        while (md.firstChild) { md.removeChild(md.firstChild); }
                        addAllToDo_DOM(listLogic.listItems(projectName), projectName);
                    }
                }
            });
        }
    } : null;

    setupRowDrag(toDoChild, {
        container: document.getElementById('mainList'),
        itemSelector: '#toDoChild',
        isDraggable: function() {
            return !!(toDoInput && toDoInput.value && toDoInput.value.trim().length > 0);
        },
        onReorder: function(fromIdx, toIdx) {
            const mainDiv = document.getElementById('mainList');
            // Read current project from DOM — the closed-over `project` may be
            // stale if the user switched projects after this listener was wired.
            const anyRow = mainDiv.querySelector('[data-value]');
            const activeProject = anyRow ? anyRow.dataset.value : project;
            listLogic.reorderToDo(activeProject, fromIdx, toIdx);
            // Re-render from the model. reorderToDo re-partitions completed
            // items to the bottom, so the user's drop position may be
            // clamped — the DOM must reflect the model rather than where
            // the user released. Existing rows are moved (not recreated),
            // so listeners and any open description panels are preserved.
            reorderToDoDOM(activeProject);
        },
        swipe: swipeCfg
    });

    function syncDraggable() {
        toDoChild.setAttribute(
            'draggable',
            toDoInput.value.trim().length > 0 ? 'true' : 'false'
        );
    }
    syncDraggable();
    toDoInput.addEventListener('keyup', syncDraggable);
    toDoInput.addEventListener('blur',  syncDraggable);
    // disable drag while typing so mouse-drag text selection inside the
    // input still works; re-enabled on blur
    toDoInput.addEventListener('focus', function() {
        toDoChild.setAttribute('draggable', 'false');
    });
}


// appendNewToDoRow — ensure a blank placeholder is pinned at the top of the
// project's list (creating one if the user just committed the previous blank)
// and focus it so the next todo can be typed immediately.
export function appendNewToDoRow(toDoName) {
    if (!toDoName || !listLogic.listItems(toDoName)) {
        console.error('appendNewToDoRow: invalid project —', toDoName);
        return;
    }

    // sortCompletedToBottom also re-creates the blank placeholder if one is
    // missing, so this single call both pins the placeholder to index 0 and
    // guarantees its existence before we sync the DOM.
    listLogic.sortCompletedToBottom(toDoName);
    reorderToDoDOM(toDoName);

    focusBlankToDoInput();
}


// focusBlankToDoInput — move focus to the existing blank placeholder row's
// input without touching the data model or DOM structure. Used on re-commit
// of an already-committed row, where rebuilding the list would be wasteful.
// Prefers the empty-state input when present (it absorbs the placeholder's
// affordance while the project has no open todos).
export function focusBlankToDoInput() {
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return;
    const esInput = mainListDiv.querySelector('#emptyStateInput');
    if (esInput) { esInput.focus(); return; }
    const inputs = mainListDiv.querySelectorAll('#toDoInput');
    for (let i = 0; i < inputs.length; i++) {
        if (inputs[i].value === '') { inputs[i].focus(); return; }
    }
}


// Auto-focus the empty input when a project is entered. On touch/mobile
// skips the focus call so the soft keyboard doesn't open uninvited — users
// on those devices tap the input directly when they're ready to type.
// Deferred to the next microtask so the call lands after any in-progress
// `.blur()` (from the project-row click handler) has fully settled.
export function focusBlankToDoInputIfDesktop() {
    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
    // Wait for the current event loop to flush pending blur/focus churn
    // before we place our focus. Rendering a list synchronously can cause
    // race conditions where an immediately-following blur wins.
    setTimeout(focusBlankToDoInput, 0);
}