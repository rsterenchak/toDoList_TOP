// ── Recurring-task stats surface: render + re-render + full-screen modal ──
// Extracted verbatim from toDoRow.js's `wireStatsToggle` closure. These three
// functions share the same mutable window/surface state and a handful of
// build helpers that still live in toDoRow.js, so the factory below takes a
// context bundle: the row element, the item, the chart-icon toggle, a shared
// mutable `state` object ({ currentWindow, openMode, modalBody }) that the
// caller's click handler also reads and writes, and a `deps` bundle of the
// toDoRow-local builders. Behaviour is identical to the inline version — the
// only change is that closure variables became `state.*` and the toDoRow-local
// helpers arrive as params.
import { listLogic } from './listLogic.js';
import { showMissedDatesModal } from './modals.js';

export function createStatsDrawer({ statsToggle, toDoChild, item, state, deps }) {
    const {
        buildContributionsGrid,
        buildFallbackStrip,
        buildInfoGlyph,
        formatShortDate,
        formatCadenceSubtitle,
        MISS_PILL_THRESHOLD,
    } = deps;

    function renderStatsContent(forModal) {
        const projectName = toDoChild.dataset.value;
        if (!projectName || !item.recurrence) return null;

        const container = document.createElement('div');
        if (forModal) {
            container.className = 'statsModalContent';
        } else {
            container.id = 'statsSibling';
        }

        const stats = listLogic.getRecurringTaskStats(projectName, item, state.currentWindow);

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
        container.appendChild(strip);

        // Approximate-dates note for completion-basis recurrences — the
        // expected sequence is reconstructed from `nextDueDate`, not from
        // authoritative per-occurrence records.
        if (item.recurrence.basis === 'completionDate') {
            const note = document.createElement('div');
            note.className = 'statsApproximateNote';
            note.textContent = 'completion-based — dates approximate';
            container.appendChild(note);
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
            btn.className = 'statsWindowBtn' + (w.key === state.currentWindow ? ' selected' : '');
            btn.textContent = w.label;
            btn.setAttribute('aria-pressed', w.key === state.currentWindow ? 'true' : 'false');
            btn.addEventListener('click', function(ev) {
                ev.stopPropagation();
                if (state.currentWindow === w.key) return;
                state.currentWindow = w.key;
                replaceContentInPlace();
            });
            toggleRow.appendChild(btn);
        });
        container.appendChild(toggleRow);

        // Grid (or fallback strip for month/year cadences). The modal always
        // renders the full contributions grid — its full-window layout gives
        // the grid room to breathe regardless of viewport, which is the whole
        // reason this path exists.
        const useFallback =
            item.recurrence.pattern === 'monthly' ||
            item.recurrence.pattern === 'yearly' ||
            item.recurrence.intervalUnit === 'month' ||
            item.recurrence.intervalUnit === 'year';
        container.appendChild(
            useFallback
                ? buildFallbackStrip(stats)
                : buildContributionsGrid(stats)
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
            container.appendChild(callout);
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

            container.appendChild(missed);
        }

        return container;
    }

    // Re-render the stats payload after a window-toggle click. Picks the
    // right container based on whichever surface (inline drawer or
    // full-screen modal) is currently open.
    function replaceContentInPlace() {
        if (state.openMode === 'drawer') {
            const mainList = toDoChild.parentElement;
            if (!mainList) return;
            let existing = toDoChild.nextSibling;
            while (existing && existing.id !== 'statsSibling') existing = existing.nextSibling;
            if (!existing) return;
            const fresh = renderStatsContent(false);
            if (!fresh) return;
            mainList.replaceChild(fresh, existing);
            return;
        }
        if (state.openMode === 'modal' && state.modalBody) {
            const fresh = renderStatsContent(true);
            if (!fresh) return;
            state.modalBody.innerHTML = '';
            state.modalBody.appendChild(fresh);
        }
    }

    // Full-screen stats modal — mobile-only surface that sidesteps the
    // #mainList grid track sizing fight by rendering the full stats
    // payload (cards, window toggle, contributions grid, miss callout,
    // missed pills) outside the row entirely. Closes via X / backdrop /
    // Escape per CLAUDE.md. The chart-icon button's open/aria state is
    // cleared on close so a second tap re-opens cleanly.
    function openStatsModal() {
        // Defensive: tear down any prior instance so we never stack two
        // stats modals (e.g. on a rapid double-tap).
        const prior = document.getElementById('statsModalBackdrop');
        if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

        state.currentWindow = '30d';

        const backdrop = document.createElement('div');
        backdrop.id = 'statsModalBackdrop';

        const dialog = document.createElement('div');
        dialog.id = 'statsModal';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'statsModalTitle');

        const header = document.createElement('div');
        header.id = 'statsModalHeader';

        const titleWrap = document.createElement('div');
        titleWrap.id = 'statsModalTitleWrap';

        const titleEl = document.createElement('div');
        titleEl.id = 'statsModalTitle';
        titleEl.textContent = item.tit || '';

        const subtitleEl = document.createElement('div');
        subtitleEl.id = 'statsModalSubtitle';
        subtitleEl.textContent = formatCadenceSubtitle(item.recurrence);

        titleWrap.appendChild(titleEl);
        titleWrap.appendChild(subtitleEl);

        const closeX = document.createElement('button');
        closeX.id = 'statsModalClose';
        closeX.type = 'button';
        closeX.setAttribute('aria-label', 'Close stats');
        closeX.textContent = '×';

        header.appendChild(titleWrap);
        header.appendChild(closeX);

        const body = document.createElement('div');
        body.id = 'statsModalBody';
        state.modalBody = body;

        state.openMode = 'modal';
        const content = renderStatsContent(true);
        if (content) body.appendChild(content);

        dialog.appendChild(header);
        dialog.appendChild(body);
        backdrop.appendChild(dialog);
        document.body.appendChild(backdrop);

        const previouslyFocused = document.activeElement;
        closeX.focus();

        statsToggle.classList.add('open');
        statsToggle.setAttribute('aria-expanded', 'true');
        statsToggle.setAttribute('aria-label', 'Hide stats');

        let closed = false;
        function close() {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeydown, true);
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            state.openMode = null;
            state.modalBody = null;
            statsToggle.classList.remove('open');
            statsToggle.setAttribute('aria-expanded', 'false');
            statsToggle.setAttribute('aria-label', 'Show stats');
            if (previouslyFocused &&
                typeof previouslyFocused.focus === 'function' &&
                document.contains(previouslyFocused)) {
                previouslyFocused.focus();
            }
        }

        function onKeydown(event) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                close();
            }
        }

        closeX.addEventListener('click', close);
        backdrop.addEventListener('click', function(event) {
            if (event.target === backdrop) close();
        });
        document.addEventListener('keydown', onKeydown, true);
    }

    return { renderStatsContent, replaceContentInPlace, openStatsModal };
}
