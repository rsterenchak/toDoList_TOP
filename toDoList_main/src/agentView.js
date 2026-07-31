import { supabase } from './supabaseClient.js';
import { listLogic } from './listLogic.js';
import {
    mintEntryId,
    dispatchTriage,
    dispatchDerive,
    pollRunStatus,
    fetchActiveRuns,
    readAssignmentFromWorker,
    readRepoFile,
    findTargetById,
    showInjectToast,
    chatWithWorker,
    revertEntry,
} from './inject.js';
import { openChatWithSeed } from './claudeSheet.js';
import { showConfirmModal, showAssignmentEditorModal, wireModalDismiss } from './modals.js';
import { dispatchDraft, resolveDispatchTarget } from './dispatchDraft.js';
import {
    getQueueRows,
    getLoadedProjectName,
    setQueueRows,
    loadQueueRows,
    fetchQueueRows,
    pendingAnswers,
    isTriageInFlight,
    setTriageInFlight,
    startAgentQueueSubscription,
    onQueueChange,
    notifyQueueChange,
    setTriageDispatcher,
    kickDispatchReconciler,
    configureRunTrackers,
    startSweepTracking,
    stopSweepTracking,
    seedSweepState,
    isSweepActive,
    startDeriveTracking,
    stopDeriveTracking,
    setDeriveCorrelationId,
    isDeriveActive,
    clearWorkingWatchSweepSeed,
    pollAgentWorkingWatch,
    isAgentUnavailable,
    AGENT_UNAVAILABLE_MSG,
    stuckReasonText,
} from './agentQueueStore.js';
import { buildMockupSecondary, configureMockupFlow } from './mockupFlow.js';
import {
    buildAspectBadge,
    buildAssignmentCard,
    refreshAssignment,
    resetAssignmentCache,
    getAssignmentProject,
    configureAssignmentCoverage,
} from './assignmentCoverage.js';

// Wire the extracted mockup flow to the board-side callbacks it needs. These are
// hoisted function declarations, so they resolve here at module load even though
// they're defined further down. Importing them into mockupFlow.js directly would
// create a view → module → view cycle, so the board injects them instead.
configureMockupFlow({ getSelectedProjectName, refreshAgentQueue, paint });

// Wire the extracted assignment / coverage subsystem to the board-side callbacks
// it needs (same hoisting + cycle rationale as configureMockupFlow above). The
// subsystem reaches back for the selected project, a repaint, the read target,
// the Needs-you bucket collapse state, and the board-owned derive run state.
configureAssignmentCoverage({
    getSelectedProjectName,
    paint,
    resolveReadTarget,
    isBucketCollapsed,
    setBucketCollapsed,
    isDeriveActive,
    fireDeriveRun,
});

// Wire the triage-sweep and derive run trackers (relocated to agentQueueStore.js)
// to the board-side rendering callbacks and the Worker probes they need (the
// working-watch seed/clear/poll callbacks the trackers once needed moved into the
// store with the watch itself, so they're no longer injected from here). Same
// hoisting + acyclic rationale as configureAssignmentCoverage above: the
// store must not import this view or inject.js, so the board injects them. These are
// all hoisted function declarations (or top-level imports), so they resolve here at
// module load even though the board renderers are defined further down.
// The Worker-call deps are wrapped in thunks (rather than passed by reference) so
// the imported bindings are read at CALL time, not here at module load — some tests
// partially mock inject.js, and eagerly reading an absent export would throw on
// import even for a test that never fires a sweep or derive run.
configureRunTrackers({
    refreshStatusPill,
    paint,
    refreshAgentQueue,
    fetchActiveRuns: function (target, workflow) { return fetchActiveRuns(target, workflow); },
    pollRunStatus: function (opts) { return pollRunStatus(opts); },
    resolveDispatchTarget: function () { return resolveDispatchTarget(); },
    showInjectToast: function (msg, kind) { return showInjectToast(msg, kind); },
});

// The AGENT view: a per-project board of the autonomous-agent work queue. It
// replaces the old Conceive incubator surface. For the currently selected
// project it reads the `agent_queue` Supabase table (scoped by project_id) and
// renders the rows as grouped buckets — Needs you, Stuck, In progress, Shipped
// — matching the reviewed mockups, with a live realtime subscription so state
// changes stream in.
//
// This module is READ/RENDER ONLY. It never mutates the data model (those
// mutations route through listLogic.js) and it never writes to agent_queue.
// Interactive controls (answer inputs, buttons) render here as static, inert
// affordances — the flag toggle and follow-up interactions land in later
// entries. Like the other view modules it reaches the DOM at call time via
// getElementById / createElement and exports only renderAgentView plus a
// subscribe/unsubscribe pair; there is no back-edge into main.js.

// Bucket layout, top to bottom, matching the reviewed mockups. Each bucket
// groups one or more agent_queue `state` values. Empty buckets are omitted at
// render time; a full-empty state shows when the project has no rows at all.
const BUCKETS = [
    // Derive's freshly proposed rows surface at the top of the board so new
    // output is seen first. `'proposed'` is produced only by derive, so a
    // state-only filter is sufficient (no `source` check needed).
    { key: 'proposed', label: 'Proposed', states: ['proposed'] },
    { key: 'needs-you', label: 'Needs you', states: ['needs_words', 'needs_mockup'] },
    { key: 'stuck', label: 'Stuck', states: ['failed', 'no_change'] },
    { key: 'in-progress', label: 'In progress', states: ['triaging', 'drafted', 'dispatched', 'running'] },
    { key: 'shipped', label: 'Shipped', states: ['shipped'] },
];

// The in-progress states that render as thin, collapsible rows rather than full
// cards (queued/running work is low-signal until it needs you or ships).
const THIN_STATES = ['dispatched', 'running'];

// The non-thin post-triage states that get the hand-to-chat / hand-to-Claude
// block appended below their state content (buildPostTriageHandoff). needs_words
// is excluded — it renders the hand-off inline within its answer control — and so
// is needs_mockup, which has its own Copy/Open-Claude mockup flow.
const POST_TRIAGE_HANDOFF_STATES = ['drafted', 'shipped', 'failed', 'no_change', 'triaging'];

// The in-flight workflow states that drive the header's Working/Idle pill and
// the "N running" count: a row in any of these is actively moving through the
// pipeline (being triaged, queued for dispatch, or executing a run).
const IN_FLIGHT_STATES = ['triaging', 'dispatched', 'running'];

// Human-readable chip label per state.
const STATE_CHIP = {
    proposed: 'Proposed',
    needs_words: 'Needs words',
    needs_mockup: 'Needs mockup',
    failed: 'Stuck',
    triaging: 'Triaging',
    drafted: 'Drafted',
    dispatched: 'Queued',
    running: 'Running',
    shipped: 'Shipped',
    no_change: 'No change',
};

// The triage-sweep / derive-run poll cadence and windows live in
// agentQueueStore.js with the trackers. The persistent working watch — which
// mirrored that grace arc for the nav dot — has also moved into the store, so its
// state, constants, and the SWEEP_GRACE_MS / SWEEP_HARD_CAP_MS windows it read are
// no longer referenced here.

// ── module state ─────────────────────────────────────────────────────
// The project-scoped row cache, the realtime channel, the unsent-answer draft
// map, and the triage in-flight guard now live in agentQueueStore.js — shared
// with the task-row layer so the board and the rows read one store. `getQueueRows()`
// returns the cache; `loadQueueRows()` re-scopes and reloads it. Everything else
// here (paint, settle, pollers, pill tracking) stays view-local. The active
// project's assignment-context cache (`_assignment` / `_assignmentProject`) and
// the whole assignment / coverage subsystem now live in assignmentCoverage.js;
// the board resets and reads that cache through resetAssignmentCache() /
// getAssignmentProject().
// Row ids that have been handed off to the Claude chat via a needs_words card's
// "Discuss in chat" link. Module-level so the
// collapsed "Continue in chat" state survives realtime pushes and refreshAgentQueue
// re-renders within the session — buildSecondary/paint consult it on every render.
// Session-scoped only; resets on reload (acceptable per the task scope).
const _handedOffRows = new Set();
// Entries whose shipped change has been rolled back (merged revert) this session,
// keyed by entry_id — a Shipped card for such an entry hides its Revert control so
// it can never be triggered again. This is the double-revert guard: a second merged
// revert of the same PR re-applies the original change. `_pendingRevertPrUrls` tracks
// entries whose revert PR opened but didn't auto-merge, so the control switches to
// opening that PR rather than POSTing a duplicate revert. Both mirror the Runs-tab
// (`rec.reverted`/`rec.revertPrUrl`) and the TODO.md viewer; module-scoped so they
// survive realtime pushes and refreshAgentQueue re-renders. Session-scoped only;
// resets on reload, exactly like the viewer's guard.
const _revertedEntries = new Set();
const _pendingRevertPrUrls = new Map();
// In-progress, unsent needs_words answers, keyed by agent_queue row id → the
// current textarea text. A realtime push repaint (paint() rebuilds the whole
// board from _rows for ANY row change) tears down the answer textarea and builds
// a fresh empty one, silently dropping whatever the user had typed but not yet
// sent. Mirroring _mockupVariants/_mockupPending, the draft is mirrored here on
// every keystroke and re-applied in buildSecondary after a repaint, so an unsent
// answer survives the rebuild. The focused input's caret is separately preserved
// across the rebuild in paint(). Cleared on a successful send. The map itself now
// lives in agentQueueStore.js (imported as `pendingAnswers`) so the task-row
// answer control and the board share one draft store.
//
// The triage in-flight guard (`isTriageInFlight`/`setTriageInFlight`) also lives
// in the store now, shared by the header Run button, the board answer auto-fire,
// and the task-row answer auto-fire, so a rapid double-tap or a quick succession
// of answers across either surface doesn't fire redundant sweeps in the same tick.
// The triage-sweep and derive run trackers — the pill-driving state, pollers,
// deadline windows, and the derive correlation-id retention — now live in
// agentQueueStore.js beside the dispatch reconciler, so they track a run whether or
// not the board is mounted. The board wires their rendering callbacks via
// configureRunTrackers (above) and reads their signal through isSweepActive() /
// isDeriveActive(); fireTriageSweep / fireDeriveRun below still dispatch and start
// them, and unsubscribeAgentView stops them on tab exit.

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// Minimal inline toast for a non-blocking notice (e.g. an auto-fired triage
// sweep that couldn't dispatch). Appended to document.body so it survives the
// board repaint that moves the answered card out of Needs you, and auto-removed
// after a few seconds. Mirrors the self-contained toast pattern used elsewhere.
function showAgentToast(message) {
    const prior = document.getElementById('agentViewToast');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const toast = document.createElement('div');
    toast.id = 'agentViewToast';
    toast.className = 'agentViewToast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
}

// Dispatch a triage sweep for the named project, fire-and-forget. Triage is a
// read-only batch that writes verdicts back to agent_queue, so the realtime
// subscription surfaces results with no polling here. Guarded by the shared
// in-flight flag; returns null when the guard or a missing project id swallows
// the call, otherwise the dispatch result. Never throws.
function fireTriageSweep(projectName) {
    if (isTriageInFlight()) return Promise.resolve(null);
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) return Promise.resolve(null);
    setTriageInFlight(true);
    // Optimistically drive the header pill to Working the instant we dispatch,
    // and start the poller that tracks the real claude-triage.yml run to
    // completion (settling the pill back to Idle when GitHub reports it done).
    startSweepTracking(false);
    return Promise.resolve()
        .then(function () { return dispatchTriage(projectId, mintEntryId(), resolveDispatchTarget()); })
        .then(
            function (res) {
                setTriageInFlight(false);
                // If the dispatch itself failed, clear the optimistic Working
                // state so neither the pill nor the nav dot falsely reports a
                // sweep in flight (no run will ever register).
                if (res && res.ok === false) { stopSweepTracking(); clearWorkingWatchSweepSeed(); pollAgentWorkingWatch(); }
                return res;
            },
            function () {
                setTriageInFlight(false);
                stopSweepTracking();
                clearWorkingWatchSweepSeed();
                pollAgentWorkingWatch();
                return { ok: false };
            }
        );
}

// Register this board's triage-sweep dispatcher with the shared store so the
// task-row answer control can fire the exact same sweep (same pill, same guard)
// without importing this module. Runs at module load; agentView.js is always
// imported by main.js, so the dispatcher is available before any row answers.
setTriageDispatcher(fireTriageSweep);

// Update the header status pill in place to reflect the current Working/Idle
// state, WITHOUT a full paint(). A full repaint here would rebuild — and reset —
// the Run button while its click handler is mid-interaction, and would churn the
// whole board on a purely cosmetic pill flip. No-op when the pill isn't mounted
// (view not painted / not on the Agent tab). Uses the same predicate paint()
// does: Working when a sweep or a derive run is in flight OR any row is
// dispatched/running.
function refreshStatusPill() {
    const pill = document.getElementById('agentStatusPill');
    if (!pill) return;
    const rows = getQueueRows();
    const shipInFlight = rows.some(function (r) {
        return r && (r.state === 'dispatched' || r.state === 'running');
    });
    const working = isSweepActive() || isDeriveActive() || shipInFlight;
    pill.className = 'agentStatusPill' + (working ? ' agentStatusPill--working' : ' agentStatusPill--idle');
    const label = pill.querySelector('.agentStatusLabel');
    if (label) label.textContent = working ? 'Working' : 'Idle';
}

// Resolve the currently-selected project's name from the sidebar — the same
// source of truth the Projects and Conceive views used. Returns '' when
// nothing is selected, which drives the empty state.
function getSelectedProjectName() {
    const selected = document.querySelector('.selectedProject');
    if (!selected) return '';
    const input = selected.querySelector('#projInput');
    return input ? (input.value || '').trim() : '';
}

// Re-scope and reload the queue for the given project, then repaint. Delegates
// the cache + stale-guard to the shared store's loadQueueRows (only the most
// recent load for the still-selected project is applied, so a stale in-flight
// fetch from a since-abandoned project can't clobber the board), then notifies the
// shared store's onQueueChange listeners and — when `options.settle` is set —
// kicks the shared store's mount-independent dispatch reconciler
// (kickDispatchReconciler) so any dispatched/running row that already shipped on
// main settles promptly instead of waiting on the reconciler's own interval.
// Settle is set only on view mount and project switch, NOT on the realtime pushes
// / post-action refreshes, so a marker read is forced once per mount rather than
// on every board repaint.
//
// We notifyQueueChange() rather than paint() directly: the board's own paint is
// registered as an onQueueChange listener (ensureBoardQueueListener), so it still
// repaints — exactly once, not twice — while the row layer's detail-pane sync
// (refreshDescStatusDots, also an onQueueChange listener) now re-runs too. That is
// what lets an open desktop detail pane re-sync after a board-side mutation (e.g.
// the mockup flow's "use this" saving a drafted entry) instead of hanging on the
// pre-mutation view until the row is closed and reopened. The guard keeps the
// notify scoped to the still-selected project so a stale in-flight fetch from a
// since-abandoned project can't drive a repaint against the wrong rows.
function refreshAgentQueue(projectName, options) {
    const settle = !!(options && options.settle);
    return loadQueueRows(projectName).then(function () {
        if (getSelectedProjectName() === getLoadedProjectName()) {
            notifyQueueChange();
            if (settle) kickDispatchReconciler();
        }
    });
}

// A state chip: a small pill labelling the row's queue state.
function buildChip(state) {
    const chip = document.createElement('span');
    chip.className = 'agentChip agentChip--' + (state || 'unknown');
    chip.textContent = STATE_CHIP[state] || state || 'Unknown';
    return chip;
}

// The shipped-state header glyph, replacing the redundant "SHIPPED" text chip
// (shipped cards already sit under the "Shipped" section header). Mirrors
// toDoRow.js's RUN_STATUS_SHIPPED_SVG (filled disc + knocked-out check) and
// differs in exactly one thing: the check stroke is `var(--bg-surface)` — the
// card's own background — rather than `var(--bg-row)`, so the notch reads clean
// on the card surface. Kept local (not imported) because of that knockout-token
// difference; if the task-row glyph changes, update this to match.
const SHIPPED_GLYPH_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor"/><path d="M4.8 8.3l2.1 2.1 4.3-4.7" fill="none" stroke="var(--bg-surface)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function buildShippedGlyph() {
    const glyph = document.createElement('span');
    glyph.className = 'agentShippedGlyph';
    glyph.title = 'Shipped';
    glyph.setAttribute('aria-label', 'Shipped');
    glyph.innerHTML = SHIPPED_GLYPH_SVG;
    return glyph;
}

// State-appropriate secondary content under a card's title: the pending
// question for needs_words, the failure reason for a stuck row, PR/queued
// status for in-progress work. Returns null when there's nothing to show.
function buildSecondary(row) {
    const state = row.state;
    if (state === 'needs_words') {
        // Already handed off to chat this session: collapse the answer control to
        // a single re-entry that re-opens the same seeded conversation.
        if (_handedOffRows.has(row.id)) {
            return buildHandedOffSecondary(row);
        }
        const q = (row.question || '').trim();
        // A live answer control: the user types a reply and sends it, which
        // appends to the row's thread and re-queues the task (state ->
        // triaging) for a re-triage that now carries the answer. The realtime
        // subscription then moves the card out of Needs you on its own. The
        // 16px font-size avoids iOS Safari's focus auto-zoom.
        const wrap = document.createElement('div');
        wrap.className = 'agentSecondary';
        if (q) {
            const preview = document.createElement('p');
            preview.className = 'agentQuestion';
            preview.textContent = q;
            wrap.appendChild(preview);
        }
        const input = document.createElement('textarea');
        input.className = 'agentAnswerInput';
        input.rows = 2;
        input.placeholder = 'Answer to continue…';
        input.setAttribute('aria-label', 'Answer');
        // Tag the row so paint() can find this exact input again to restore the
        // caret after a realtime-push rebuild.
        input.setAttribute('data-answer-row', String(row.id));
        // Re-apply any unsent draft the user typed before an intervening repaint
        // tore the old textarea down, and keep the cache in step on every keystroke.
        if (pendingAnswers.has(row.id)) {
            input.value = pendingAnswers.get(row.id);
        }
        input.addEventListener('input', function () {
            pendingAnswers.set(row.id, input.value);
        });
        wrap.appendChild(input);

        const actions = document.createElement('div');
        actions.className = 'agentAnswerActions';

        const errorEl = document.createElement('p');
        errorEl.className = 'agentAnswerError';
        errorEl.setAttribute('role', 'alert');
        errorEl.hidden = true;
        actions.appendChild(errorEl);

        // A lightweight hand-off to the in-app Claude chat, sitting left of Send.
        // For tasks that need real back-and-forth, re-firing a full triage sweep
        // per answer is too heavy; this instead seeds a chat with the task context
        // and leaves the conversation to the user. It never writes to the data
        // model and never re-triages (no answerAgentTask / fireTriageSweep).
        actions.appendChild(buildDiscussLink(row));

        const send = document.createElement('button');
        send.type = 'button';
        send.className = 'agentAnswerSend';
        send.textContent = 'Send';
        actions.appendChild(send);
        wrap.appendChild(actions);

        // Submit the trimmed answer. Empty/whitespace-only input is ignored
        // (no write). While the write is in flight the input and button are
        // disabled; on success the board refreshes (the row leaves Needs you);
        // on failure the controls re-enable and a non-blocking error shows.
        function submitAnswer() {
            if (send.disabled) return;
            const text = (input.value || '').trim();
            if (!text) return;
            errorEl.hidden = true;
            errorEl.textContent = '';
            send.disabled = true;
            input.disabled = true;
            send.classList.add('is-pending');
            send.textContent = 'Sending…';
            Promise.resolve(listLogic.answerAgentTask(row.id, text, row.thread)).then(function (res) {
                if (res && res.ok) {
                    input.value = '';
                    pendingAnswers.delete(row.id);
                    // The realtime subscription re-renders as the state flips;
                    // refresh explicitly too so the card leaves Needs you even
                    // where realtime isn't observed (e.g. offline stubs).
                    refreshAgentQueue(getSelectedProjectName());
                    // Hands-off follow-up: auto-fire a triage sweep now that the
                    // row is back in triaging. The answer is already saved, so a
                    // failed dispatch only means they may need to Run manually —
                    // surfaced as a non-blocking toast, never blocking the send.
                    Promise.resolve(fireTriageSweep(getSelectedProjectName())).then(function (tr) {
                        if (tr && tr.ok === false) {
                            showAgentToast('Answer saved, but triage didn’t start — tap Run to sweep.');
                        }
                    });
                    return;
                }
                send.disabled = false;
                input.disabled = false;
                send.classList.remove('is-pending');
                send.textContent = 'Send';
                errorEl.textContent = (res && res.error) || 'Could not send. Try again.';
                errorEl.hidden = false;
            }).catch(function () {
                send.disabled = false;
                input.disabled = false;
                send.classList.remove('is-pending');
                send.textContent = 'Send';
                errorEl.textContent = 'Could not send. Try again.';
                errorEl.hidden = false;
            });
        }

        // Enter (without Shift) submits; Shift+Enter inserts a newline.
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitAnswer();
            }
        });
        send.addEventListener('click', submitAnswer);

        // A tucked, fire-and-forget external hand-off below the answer actions:
        // copy the task context to paste into claude.ai, or open Claude in a new
        // tab. Decoupled from the in-app Discuss-in-chat / Send path above, which
        // stays fully usable — this never touches the data model, re-triages, or
        // marks the row handed off.
        wrap.appendChild(buildPasteToClaudeRow(row));
        return wrap;
    }
    if (state === 'needs_mockup') {
        return buildMockupSecondary(row);
    }
    // Stuck bucket: a genuinely failed run, or a completed run that merged
    // nothing (no_change). Both surface the row's summary via failure_reason,
    // plus a Retry action (removal is the header × control).
    if (state === 'failed' || state === 'no_change') {
        return buildStuckSecondary(row);
    }
    if (state === 'shipped') {
        return buildShippedSecondary(row);
    }
    if (state === 'drafted') {
        return buildDraftedSecondary(row);
    }
    // A derive-proposed card: an Accept action that ships the proposal's draft
    // through the same drafted-dispatch flow (inject + dispatch a run). Dismiss
    // stays the header × remove control.
    if (state === 'proposed') {
        return buildProposedSecondary(row);
    }
    // In-progress triaging: a short status line.
    if (state === 'triaging') {
        const p = document.createElement('p');
        p.className = 'agentSecondary agentSecondaryMuted';
        p.textContent = 'Triaging the request…';
        return p;
    }
    return null;
}

// Secondary content for a `shipped` card: the merged-PR label/link plus a Revert
// control (mockup Option A — the two sit in one row). The PR label links the
// merged PR when its URL is known, else falls back to a static "PR #N" / "Shipped"
// line. The Revert control rolls the shipped change back through the Worker
// `revert` route; it's hidden once this entry's change has already been reverted
// this session (the double-revert guard — a second merged revert re-applies the
// original change) and needs the row's `entry_id` to act at all.
function buildShippedSecondary(row) {
    const rowEl = document.createElement('div');
    rowEl.className = 'agentShippedRow';

    const label = row.pr_number ? ('PR #' + row.pr_number) : 'View PR';
    if (row.pr_url) {
        const a = document.createElement('a');
        a.className = 'agentSecondary agentSecondaryMuted agentShippedLink';
        a.href = row.pr_url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = label;
        rowEl.appendChild(a);
    } else {
        const p = document.createElement('p');
        p.className = 'agentSecondary agentSecondaryMuted';
        p.textContent = row.pr_number ? label : 'Shipped';
        rowEl.appendChild(p);
    }

    // A shipped change can be rolled back. Rendered only when the row carries an
    // entry_id (the revert call needs it) and this entry hasn't already been
    // reverted this session.
    if (row.entry_id && !_revertedEntries.has(row.entry_id)) {
        rowEl.appendChild(buildAgentRevertControl(row));
    }
    return rowEl;
}

// Build the per-card Revert control shown on a Shipped card, mirroring
// buildRevertControl in the Runs tab. When this entry already carries a revert PR
// that didn't auto-merge (_pendingRevertPrUrls), the control opens that existing PR
// rather than POSTing a fresh revert — a second merged revert of the same PR would
// re-apply the original change, so we never create a duplicate revert PR.
function buildAgentRevertControl(row) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'claudeRunRevertBtn';
    const pendingPr = _pendingRevertPrUrls.has(row.entry_id);
    btn.setAttribute('aria-label', pendingPr ? 'Open the revert pull request' : 'Revert this change');
    btn.title = pendingPr ? 'Open the revert pull request' : 'Revert this change';
    // Quiet counter-clockwise / undo arrow — the same glyph the other Revert
    // surfaces use so all three read identically.
    btn.innerHTML =
        '<svg class="claudeRunRevertIcon" width="14" height="14" viewBox="0 0 24 24" ' +
        'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" ' +
        'stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<polyline points="1 4 1 10 7 10"></polyline>' +
        '<path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>';
    btn.addEventListener('click', function (event) {
        // Stop propagation so a click never also opens the card (Shipped cards
        // aren't clickable today, but this keeps the control inert to any future
        // card-level handler).
        event.stopPropagation();
        const pendingUrl = _pendingRevertPrUrls.get(row.entry_id);
        if (pendingUrl) {
            try { window.open(pendingUrl, '_blank', 'noopener'); } catch (e) { /* popup blocked */ }
            return;
        }
        confirmAndRevertAgentRun(row, btn);
    });
    return btn;
}

// Confirm the rollback, then ship it. The confirm names the card and states a new
// build will deploy; Cancel does nothing.
function confirmAndRevertAgentRun(row, btn) {
    const title = (row.context && row.context.title) || row.title || 'this change';
    showConfirmModal({
        message: 'Revert “' + title + '”? This ships a rollback — a new build will deploy.',
        confirmLabel: 'Revert',
        onConfirm: function () { performAgentRevert(row, btn); },
    });
}

// Roll a shipped card's change back through the Worker `revert` route, mirroring
// performRevertRun in the Runs tab and performRevert in the TODO.md viewer. The
// revert targets the same dispatch target the run shipped to (resolveDispatchTarget,
// null in v1 → the Worker's default repo). On a merged rollback the entry is marked
// reverted so the control disappears; on a revert PR that didn't auto-merge the PR
// URL is remembered so the control switches to opening it; on failure the control
// re-enables so it can retry.
async function performAgentRevert(row, btn) {
    btn.disabled = true;
    btn.classList.add('claudeRunRevertBtn--loading');
    const target = resolveDispatchTarget();
    const res = await revertEntry(row.entry_id, target);
    if (res && res.ok && res.merged === true) {
        showInjectToast('Reverted — new build shipping');
        _revertedEntries.add(row.entry_id);
        refreshAgentQueue(getSelectedProjectName());
        return;
    }
    if (res && res.ok && res.merged === false) {
        if (res.revert_pr_url) _pendingRevertPrUrls.set(row.entry_id, res.revert_pr_url);
        showInjectToast(res.reason
            ? ('Revert needs attention: ' + res.reason)
            : 'Revert PR opened — finish it in GitHub');
        refreshAgentQueue(getSelectedProjectName());
        return;
    }
    // ok === false → surface the error and restore the control so it can retry.
    showInjectToast((res && res.reason) ? ('Revert failed: ' + res.reason) : 'Revert failed');
    btn.disabled = false;
    btn.classList.remove('claudeRunRevertBtn--loading');
}

// Secondary content for a `drafted` card: the agent's draft in a read-only,
// scrollable block plus a Dispatch button — the manual review gate. Tapping
// Dispatch ships the draft through the run pipeline (inject → dispatch → poll)
// via listLogic writes; the view never writes to Supabase directly. The button
// disables during the in-flight inject/dispatch sequence; on failure it
// re-enables and a non-blocking error is surfaced beneath it, and the row stays
// `drafted`.
function buildDraftedSecondary(row) {
    const wrap = document.createElement('div');
    wrap.className = 'agentSecondary agentDraft';

    const draftText = (row.draft || '').trim();
    const block = document.createElement('pre');
    block.className = 'agentDraftBlock';
    block.setAttribute('tabindex', '0');
    block.setAttribute('aria-label', 'Draft entry');
    block.textContent = draftText || 'No draft text available.';
    wrap.appendChild(block);

    const actions = document.createElement('div');
    actions.className = 'agentDraftActions';

    const errorEl = document.createElement('p');
    errorEl.className = 'agentDraftError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    actions.appendChild(errorEl);

    const dispatch = document.createElement('button');
    dispatch.type = 'button';
    dispatch.className = 'agentDispatchButton';
    dispatch.textContent = 'Dispatch';
    actions.appendChild(dispatch);
    wrap.appendChild(actions);

    function fail(message) {
        dispatch.disabled = false;
        dispatch.classList.remove('is-pending');
        dispatch.textContent = 'Dispatch';
        errorEl.textContent = message || 'Could not dispatch. Try again.';
        errorEl.hidden = false;
    }

    dispatch.addEventListener('click', function () {
        if (dispatch.disabled) return;
        if (!draftText) { fail('No draft to dispatch.'); return; }
        errorEl.hidden = true;
        errorEl.textContent = '';
        dispatch.disabled = true;
        dispatch.classList.add('is-pending');
        dispatch.textContent = 'Dispatching…';
        dispatchDraft(row, draftText, row.entry_id, boardDispatchTail).then(function (res) {
            if (res && res.ok) {
                // The realtime subscription (plus the explicit refresh started
                // by the board tail) moves the card into In progress; nothing to
                // do here on success.
                return;
            }
            fail(res && res.error);
        }).catch(function () {
            fail('Could not dispatch. Try again.');
        });
    });

    return wrap;
}

// Secondary content for a `proposed` card (derive output): an optional preview of
// the proposal's description plus an Accept button that ships the proposal's draft
// through the run pipeline. Accept reuses the drafted-dispatch flow
// (dispatchDraft → shipEntryForTodo → inject → dispatch → poll): the proposal's
// `draft` is the full TODO.md entry derive wrote, and `entry_id` is null on a
// fresh proposal, so shipEntryForTodo mints one and — since todo_id is null —
// injects and dispatches without stamping a source todo, leaving `aspect` intact.
// The row transitions proposed → dispatched and leaves the Proposed bucket for
// In progress. Dismiss is the header × remove control (unchanged). The button
// disables during the in-flight inject/dispatch sequence (double-accept guard);
// on failure it re-enables and a non-blocking error is surfaced beneath it.
function buildProposedSecondary(row) {
    const wrap = document.createElement('div');
    wrap.className = 'agentSecondary agentProposed';

    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const description = (ctx.description || '').trim();
    if (description) {
        const preview = document.createElement('p');
        preview.className = 'agentSecondaryMuted agentProposedPreview';
        preview.textContent = description;
        wrap.appendChild(preview);
    }

    const actions = document.createElement('div');
    actions.className = 'agentProposedActions';

    const errorEl = document.createElement('p');
    errorEl.className = 'agentProposedError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    actions.appendChild(errorEl);

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'agentAcceptButton';
    accept.textContent = 'Accept';
    actions.appendChild(accept);
    wrap.appendChild(actions);

    const draftText = (row.draft || '').trim();

    function fail(message) {
        accept.disabled = false;
        accept.classList.remove('is-pending');
        accept.textContent = 'Accept';
        errorEl.textContent = message || 'Could not accept. Try again.';
        errorEl.hidden = false;
    }

    accept.addEventListener('click', function () {
        if (accept.disabled) return;
        if (!draftText) { fail('No proposal to accept.'); return; }
        errorEl.hidden = true;
        errorEl.textContent = '';
        accept.disabled = true;
        accept.classList.add('is-pending');
        accept.textContent = 'Accepting…';
        dispatchDraft(row, draftText, row.entry_id, boardDispatchTail).then(function (res) {
            if (res && res.ok) {
                // The realtime subscription (plus the explicit refresh started by
                // the board tail) moves the card into In progress; nothing to do
                // here on success.
                return;
            }
            fail(res && res.error);
        }).catch(function () {
            fail('Could not accept. Try again.');
        });
    });

    return wrap;
}

// Secondary content for a Stuck card (`failed` / `no_change`): the run's reason
// paragraph plus a "Retry" action (re-dispatch the task's existing entry through
// the run pipeline, reusing its stored entry_id so the marker is dedup-skipped
// and no duplicate lands in TODO.md). Removal is handled by the header "×"
// control (buildRemoveControl), which replaced the former "Shelve + unflag"
// button. Retry goes through dispatchDraft; the view never writes to Supabase
// directly. The button disables while its action is in flight and re-enables
// with a non-blocking error on failure. Retry is disabled when the row has
// neither an entry_id nor a draft (nothing to re-dispatch).
function buildStuckSecondary(row) {
    const wrap = document.createElement('div');
    wrap.className = 'agentSecondary agentStuck';

    const p = document.createElement('p');
    p.className = 'agentFailure';
    p.textContent = stuckReasonText(row);
    wrap.appendChild(p);

    const actions = document.createElement('div');
    actions.className = 'agentStuckActions';

    const errorEl = document.createElement('p');
    errorEl.className = 'agentStuckError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    actions.appendChild(errorEl);

    const draftText = (row.draft || '').trim();
    const canRetry = !!(row.entry_id || draftText);
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'agentStuckRetry';
    retry.textContent = 'Retry';
    retry.disabled = !canRetry;
    actions.appendChild(retry);

    wrap.appendChild(actions);

    // Restore Retry to its idle state and surface a non-blocking error.
    function fail(message) {
        retry.disabled = !canRetry;
        retry.classList.remove('is-pending');
        retry.textContent = 'Retry';
        errorEl.textContent = message || 'Something went wrong. Try again.';
        errorEl.hidden = false;
    }

    // Disable Retry before the action fires.
    function beginAction() {
        errorEl.hidden = true;
        errorEl.textContent = '';
        retry.disabled = true;
    }

    retry.addEventListener('click', function () {
        if (retry.disabled) return;
        if (!canRetry) return;
        beginAction();
        retry.classList.add('is-pending');
        retry.textContent = 'Retrying…';
        // Reuse the row's existing entry id so injectEntry dedup-skips the
        // already-present marker rather than appending a duplicate entry.
        dispatchDraft(row, draftText, row.entry_id, boardDispatchTail).then(function (res) {
            if (res && res.ok) {
                // The shared dispatch persists `dispatched` and the board tail
                // refreshes; the card moves into In progress on its own. Nothing
                // to do here.
                return;
            }
            fail(res && res.error);
        }).catch(function () {
            fail('Could not retry. Try again.');
        });
    });

    return wrap;
}

// The Agent board's dispatch tail, passed to the shared dispatchDraft by every
// board Dispatch / Retry / Accept. After the shared core ships the entry and
// persists the `dispatched` state, this kicks the shared store's dispatch
// reconciler (so the card settles to shipped / failed / no_change even where
// realtime isn't observed) and repaints the board so the card leaves Drafted. The
// row-layer Dispatch/Retry pass no tail — the store's app-lifetime realtime
// subscription arms the same reconciler for them, so nothing surface-specific
// polls. (dispatchDraft + resolveDispatchTarget now live in dispatchDraft.js so the
// board and the row layer share one implementation and cannot drift.)
const boardDispatchTail = {
    onDispatched: function (rowId, entryId, correlationId, target) {
        kickDispatchReconciler();
        // Refresh so the card leaves Drafted even where realtime isn't observed.
        refreshAgentQueue(getSelectedProjectName());
    },
};

// The read target (repo/filePath) for the active project. Mirrors the TODO.md
// viewer's resolution — the project's configured inject target — so the assignment
// read hits the same repo the runs land in. Returns null when the project has no
// routing (the assignment card then resolves to absent).
function resolveReadTarget() {
    const projectName = getSelectedProjectName();
    if (!projectName) return null;
    const targetId = listLogic.getProjectTargetId(projectName);
    return targetId ? findTargetById(targetId) : null;
}

// One card for a single queue row: title, a state chip, and state-appropriate
// secondary content. Rows in the thin states (queued / running) render as a
// compact single-line row instead of a full card.
function buildCard(row) {
    const thin = THIN_STATES.indexOf(row.state) !== -1;
    const card = document.createElement('div');
    card.className = 'agentCard' + (thin ? ' agentCard--thin' : '');
    card.setAttribute('data-state', row.state || '');
    // Stamp the linked todo id so the tasks-surface `⌁ MOCKUP` badge can jump the
    // board to this exact card (see anchorAgentCardForTodo). Triage-derived rows
    // carry a todo_id; rows without one (e.g. a raw proposal) simply aren't
    // anchor targets and the attribute is omitted.
    if (row.todo_id != null && row.todo_id !== '') {
        card.setAttribute('data-todo-id', String(row.todo_id));
    }

    const head = document.createElement('div');
    head.className = 'agentCardHead';

    const title = document.createElement('span');
    title.className = 'agentCardTitle';
    // The title lives inside the `context` JSONB (`context.title`, written at
    // flag time), not in a top-level column. Read it from there, guarding for a
    // missing or non-object context, and never call a string method on the raw
    // object (which would throw and blank the whole board).
    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const text = (ctx.title || row.title || '').trim() || 'Untitled entry';
    title.textContent = text;
    title.title = text;
    head.appendChild(title);

    // Derive-generated rows (proposed and needs_words alike) carry an `aspect`
    // tag (e.g. "A1"); render it as a small mono badge near the chip. Triage
    // rows have no aspect and render unchanged.
    const aspectBadge = buildAspectBadge(row);
    if (aspectBadge) head.appendChild(aspectBadge);

    head.appendChild(row.state === 'shipped' ? buildShippedGlyph() : buildChip(row.state));
    // Every card except the in-flight thin states (dispatched/running) gets a
    // compact "×" remove control next to the chip. Thin rows have a run in
    // flight, so they're left to settle to Shipped/Stuck before they can be
    // removed.
    if (!thin) head.appendChild(buildRemoveControl(row));
    card.appendChild(head);

    if (!thin) {
        const secondary = buildSecondary(row);
        if (secondary) card.appendChild(secondary);
        // Append the hand-to-chat / hand-to-Claude block below the state content
        // on the post-triage states, so a drafted/shipped/failed/no_change/
        // triaging card can be discussed or handed off without re-triaging.
        if (POST_TRIAGE_HANDOFF_STATES.indexOf(row.state) !== -1) {
            card.appendChild(buildPostTriageHandoff(row));
        }
    } else {
        // Thin in-flight cards (dispatched/running) skip the full secondary but
        // still get a compact icon-only hand-off row.
        card.appendChild(buildThinActions(row));
    }
    return card;
}

// A compact "×" remove control for a card header. Tapping it deletes the row's
// agent_queue entry via listLogic.unflagAgentTask, then refreshes the board:
// an unshipped task's todo reappears in Not-assigned and a shipped card is
// simply dismissed. Delete is immediate (no confirm), matching the former
// "Shelve + unflag" behavior it replaces. Only rendered off the in-flight thin
// states (dispatched/running); see buildCard. On failure the button re-enables
// so the removal can be retried.
function buildRemoveControl(row) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agentCardRemove';
    btn.setAttribute('aria-label', 'Remove from board');
    btn.title = 'Remove from board';
    btn.textContent = '×';
    btn.addEventListener('click', function () {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('is-pending');
        Promise.resolve(listLogic.unflagAgentTask(row.id)).then(function (res) {
            if (res && res.ok) {
                // The row is gone; refresh so the card leaves even where
                // realtime isn't observed (e.g. offline stubs).
                refreshAgentQueue(getSelectedProjectName());
                return;
            }
            btn.disabled = false;
            btn.classList.remove('is-pending');
        }).catch(function () {
            btn.disabled = false;
            btn.classList.remove('is-pending');
        });
    });
    return btn;
}

// Assemble the chat seed for a needs_words hand-off: the task title and
// description (from the row's `context`) plus triage's pending question, framed
// as an opening turn. The user still sends it — this only pre-fills the composer.
function buildDiscussSeed(row) {
    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const val = function (v) { return (v == null) ? '' : String(v).trim(); };
    const title = val(ctx.title) || val(row.title);
    const description = val(ctx.description);
    const question = val(row.question);

    const lines = ["I'd like to discuss this task and work out the details together."];
    if (title) { lines.push('', 'Task: ' + title); }
    if (description) { lines.push(description); }
    if (question) { lines.push('', 'The agent asked: ' + question); }
    return lines.join('\n');
}

// Copy the task's discuss seed to the clipboard for pasting into claude.ai,
// surfacing a non-blocking toast either way. Shared by the needs_words "Copy
// context" button and the thin in-flight cards' compact 📎 affordance; a rejected
// or unavailable clipboard falls into the error toast rather than throwing.
function copyTaskContextForClaude(row) {
    let copied;
    try {
        copied = navigator.clipboard.writeText(buildDiscussSeed(row));
    } catch (e) {
        copied = Promise.reject(e);
    }
    return Promise.resolve(copied).then(function () {
        showInjectToast('Task context copied — paste it into Claude.');
    }, function () {
        showInjectToast('Couldn’t copy the task context — try again.', 'error');
    });
}

// The copy/paste-to-Claude hand-off for a needs_words card: a tucked row of two
// compact buttons beneath the answer actions. "Copy context" writes the same
// task + question seed the in-app Discuss-in-chat uses to the clipboard, and
// "Open Claude" opens claude.ai in a new tab — mirroring the needs_mockup card's
// Copy / Open Claude Design pair. The two are deliberately decoupled (separate
// taps, no combined action) so there's no clipboard/tab-focus race between them.
// This is fire-and-forget: unlike Discuss-in-chat it never touches the data
// model, re-triages, or marks the row handed off, so Send and answer-with-words
// stay available. The muted "plan" tag distinguishes it from the API-backed
// Discuss-in-chat above.
function buildPasteToClaudeRow(row) {
    const wrap = document.createElement('div');
    wrap.className = 'agentPasteHandoff';

    const tag = document.createElement('span');
    tag.className = 'agentPasteTag';
    tag.textContent = 'plan';
    wrap.appendChild(tag);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'agentPasteCopy';
    copyBtn.textContent = 'Copy context';
    copyBtn.addEventListener('click', function () {
        copyTaskContextForClaude(row);
    });
    wrap.appendChild(copyBtn);

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'agentPasteOpen';
    openBtn.textContent = 'Open Claude';
    openBtn.addEventListener('click', function () {
        try { window.open('https://claude.ai/new', '_blank'); } catch (e) { /* popup blocked */ }
    });
    wrap.appendChild(openBtn);

    return wrap;
}

// The "Discuss in chat" hand-off link. Tapping it seeds the Claude chat with the
// task context (openChatWithSeed) — WITHOUT touching the data model or
// re-triaging. On a needs_words card it also marks the row handed off so its
// answer control collapses to a re-entry, repainting from the cache (no refetch)
// so the collapse is immediate. The post-triage states (drafted/shipped/failed/
// no_change/triaging) reuse this link with `{ markHandoff: false }` — they have no
// answer box to collapse, so seeding the chat is the whole effect and the
// handed-off set (consulted only for needs_words) must stay untouched, otherwise
// a queue row that later becomes needs_words would render pre-collapsed.
function buildDiscussLink(row, opts) {
    const markHandoff = !opts || opts.markHandoff !== false;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agentDiscussLink';
    btn.appendChild(buildMessagesIcon());
    const label = document.createElement('span');
    label.textContent = 'Discuss in chat';
    btn.appendChild(label);
    btn.addEventListener('click', function () {
        // Link the chat session to this row ONLY when it's a real needs_words
        // hand-off (markHandoff). Post-triage discuss links reuse this control
        // with markHandoff:false — they're fire-and-forget, so they must not
        // link the row (passing no id also clears any prior hand-off link).
        openChatWithSeed(buildDiscussSeed(row), markHandoff ? row.id : undefined);
        if (markHandoff) {
            _handedOffRows.add(row.id);
            paint();
        }
    });
    return btn;
}

// The collapsed secondary shown once a needs_words card has been handed off to
// chat this session: a "Continue in chat →" re-entry that re-opens the same
// seeded conversation, plus an "answer with words" toggle that restores the
// answer box. Both paths stay one tap away — the chat session is untouched
// either way, and re-opening words never discards it.
function buildHandedOffSecondary(row) {
    const wrap = document.createElement('div');
    wrap.className = 'agentSecondary agentHandedOff';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agentContinueChat';
    btn.textContent = 'Continue in chat →';
    btn.addEventListener('click', function () {
        // Re-entry to the same needs_words hand-off: re-link the row so a ship
        // from the resumed session still settles it.
        openChatWithSeed(buildDiscussSeed(row), row.id);
    });
    wrap.appendChild(btn);

    wrap.appendChild(buildAnswerWithWordsLink(row));
    return wrap;
}

// The "answer with words" toggle on a handed-off card. Removes the row from
// _handedOffRows and repaints from the cache (no refetch) so buildSecondary
// returns the full question + textarea + Discuss-in-chat link + Send again. The
// row was never re-triaged and the data model was never touched, so nothing else
// needs undoing; the chat session is unaffected.
function buildAnswerWithWordsLink(row) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agentAnswerWithWords';
    btn.appendChild(buildPencilIcon());
    const label = document.createElement('span');
    label.textContent = 'answer with words';
    btn.appendChild(label);
    btn.addEventListener('click', function () {
        _handedOffRows.delete(row.id);
        paint();
    });
    return btn;
}

// The post-triage hand-off block appended below a non-thin card's state content
// on the drafted/shipped/failed/no_change/triaging states (see
// POST_TRIAGE_HANDOFF_STATES). Matches the mockup's Option A layout — a hairline
// divider, then the Discuss-in-chat link, then the Copy/Open-Claude paste row —
// reusing the same needs_words hand-off pieces so a user can iterate on any
// post-triage card without re-triaging. The Discuss link opts out of the
// handed-off collapse (there's no answer box on these states).
function buildPostTriageHandoff(row) {
    const wrap = document.createElement('div');
    const divider = document.createElement('div');
    divider.className = 'divider';
    wrap.appendChild(divider);
    wrap.appendChild(buildDiscussLink(row, { markHandoff: false }));
    wrap.appendChild(buildPasteToClaudeRow(row));
    return wrap;
}

// The compact icon-only hand-off row for the thin in-flight cards
// (dispatched/running), which skip buildSecondary entirely. Rather than promoting
// them off the thin layout, it offers a 💬 chat hand-off (openChatWithSeed) and a
// 📎 copy-for-Claude button (copyTaskContextForClaude) — the same handlers the
// full cards use. Clicks stop propagation so they never reach a future card-level
// handler.
function buildThinActions(row) {
    const wrap = document.createElement('div');
    wrap.className = 'thinActions';

    const chat = document.createElement('button');
    chat.type = 'button';
    chat.className = 'iconBtn';
    chat.setAttribute('aria-label', 'Discuss in chat');
    chat.title = 'Discuss in chat';
    chat.textContent = '💬';
    chat.addEventListener('click', function (event) {
        event.stopPropagation();
        openChatWithSeed(buildDiscussSeed(row));
    });
    wrap.appendChild(chat);

    const paste = document.createElement('button');
    paste.type = 'button';
    paste.className = 'iconBtn';
    paste.setAttribute('aria-label', 'Copy task context for Claude');
    paste.title = 'Copy task context for Claude';
    paste.textContent = '📎';
    paste.addEventListener('click', function (event) {
        event.stopPropagation();
        copyTaskContextForClaude(row);
    });
    wrap.appendChild(paste);

    return wrap;
}

// A small inline pencil/edit glyph for the "answer with words" toggle. DOM-built
// like buildMessagesIcon() — no new asset, no icon library — and theme-correct
// via currentColor so it tracks the muted link colour.
function buildPencilIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'agentAnswerWithWordsIcon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    [
        ['path', { d: 'M4 20h4l10.5 -10.5a1.5 1.5 0 0 0 0 -2.12l-1.88 -1.88a1.5 1.5 0 0 0 -2.12 0l-10.5 10.5v4z' }],
        ['path', { d: 'M13.5 6.5l4 4' }],
    ].forEach(function (spec) {
        const el = document.createElementNS(ns, spec[0]);
        Object.keys(spec[1]).forEach(function (k) { el.setAttribute(k, spec[1][k]); });
        svg.appendChild(el);
    });
    return svg;
}

// A small inline "messages" glyph for the Discuss-in-chat link. DOM-built like
// buildBoltIcon()/buildLinkOffIcon() — no new asset, no icon library — and
// theme-correct via currentColor so it tracks the link's accent colour.
function buildMessagesIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'agentDiscussIcon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    [
        ['path', { d: 'M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10' }],
        ['path', { d: 'M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2' }],
    ].forEach(function (spec) {
        const el = document.createElementNS(ns, spec[0]);
        Object.keys(spec[1]).forEach(function (k) { el.setAttribute(k, spec[1][k]); });
        svg.appendChild(el);
    });
    return svg;
}

// A small inline bolt glyph for the "Give to agent" pill. Built via the DOM
// (no new asset file) and inherits the pill's colour through currentColor so
// it stays theme-correct in both dark and light modes.
function buildBoltIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'agentGiveBolt');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M13 2 4 14h6l-1 8 9-12h-6z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
}

// A larger link-off glyph for the no-routed-repo empty state, mirroring the
// STRUCTURE tab's no-linked-repo glyph exactly so the two non-configured views
// read identically. DOM-built like buildBoltIcon() — no new asset, no icon
// library — and theme-correct via currentColor (muted through .agentEmptyGlyph).
function buildLinkOffIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '40');
    svg.setAttribute('height', '40');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    [
        ['path', { d: 'M9 17H7A5 5 0 0 1 7 7h2' }],
        ['path', { d: 'M15 7h2a5 5 0 0 1 4 8' }],
        ['line', { x1: '8', y1: '12', x2: '12', y2: '12' }],
        ['line', { x1: '2', y1: '2', x2: '22', y2: '22' }],
    ].forEach(function (spec) {
        const el = document.createElementNS(ns, spec[0]);
        Object.keys(spec[1]).forEach(function (k) { el.setAttribute(k, spec[1][k]); });
        svg.appendChild(el);
    });
    return svg;
}

// Dispatch a derive run for the active project, fire-and-forget, with a brief
// local disable on the triggering button so a double-tap can't fire two runs.
// Mirrors fireTriageSweep's dispatch call (resolve the project id, mint an entry
// id, resolve the linked target) but sends dispatch_derive. Never throws.
function fireDeriveRun(btn) {
    if (btn && btn.disabled) return;
    if (isDeriveActive()) return;
    const projectName = getSelectedProjectName();
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) return;
    // Instant local feedback so a double-tap can't fire two runs before the
    // first paint; the durable disabled/"Drafting…" state now comes from
    // `isDeriveActive()` on every subsequent repaint.
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Drafting…';
    }
    // Optimistically flip the pill to Working and start tracking the real
    // claude-derive.yml run to completion (settling to Idle when GitHub reports
    // it done), mirroring fireTriageSweep's dispatch handling.
    startDeriveTracking();
    // Retain the run's correlation id in the tracker so its conclusion can be
    // looked up on completion. stopDeriveTracking clears it on any failure/teardown.
    const correlationId = mintEntryId();
    setDeriveCorrelationId(correlationId);
    Promise.resolve(dispatchDerive(projectId, correlationId, resolveDispatchTarget()))
        .then(
            function (res) {
                // If the dispatch itself failed, clear the optimistic Working
                // state so the pill doesn't falsely report a run that never
                // registers (and re-enable the Draft button).
                if (res && res.ok === false) stopDeriveTracking();
            },
            function () { stopDeriveTracking(); }
        );
}

// Header count segments derived from the loaded queue rows. flagged = every
// queue row for the project; running = rows in an in-flight workflow state;
// shippedToday = shipped rows whose `updated_at` falls on today's local date.
// Recomputed on each paint() so realtime pushes keep the subline live.
function computeQueueCounts(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const today = new Date().toDateString();
    let running = 0;
    let shippedToday = 0;
    list.forEach(function (r) {
        if (!r) return;
        if (IN_FLIGHT_STATES.indexOf(r.state) !== -1) running += 1;
        if (r.state === 'shipped' && r.updated_at) {
            const d = new Date(r.updated_at);
            if (!isNaN(d.getTime()) && d.toDateString() === today) shippedToday += 1;
        }
    });
    return { flagged: list.length, running: running, shippedToday: shippedToday };
}

// The active project's todos that are NOT yet present in the loaded
// agent_queue rows (matched by todo_id). Blank placeholder rows (empty title)
// are render artifacts, not real tasks, so they're excluded. Returns a fresh
// array — the live items array is never mutated.
function computeNotAssigned(projectName, rows) {
    const items = listLogic.listItems(projectName);
    if (!Array.isArray(items) || !items.length) return [];
    const queued = new Set();
    (rows || []).forEach(function (r) {
        if (r && r.todo_id != null) queued.add(r.todo_id);
    });
    const filtered = items.filter(function (it) {
        return it && typeof it.tit === 'string' && it.tit.trim() !== '' && !it.completed && !queued.has(it.id);
    });
    // Float in-progress tasks to the top; the sort is stable so every other
    // task keeps its existing relative order.
    return filtered.sort(function (a, b) {
        const ap = a.status === 'in_progress' ? 0 : 1;
        const bp = b.status === 'in_progress' ? 0 : 1;
        return ap - bp;
    });
}

// One "Not assigned" card: the task title plus a real "Give to agent" pill.
// Tapping the pill flags the task for the autonomous agent via listLogic
// (agent_queue insert); the view never writes directly. The button shows a
// brief pending state and disables while the insert is in flight; on success
// the realtime subscription (plus an explicit refresh) moves the task into the
// In progress bucket; on failure the button re-enables and a non-blocking
// error is surfaced beneath it.
function buildGiveToAgentCard(item) {
    const card = document.createElement('div');
    const inProgress = !!(item && item.status === 'in_progress');
    card.className = 'agentCard agentCard--unassigned' + (inProgress ? ' agentCard--in-progress' : '');
    card.setAttribute('data-todo-id', item.id || '');

    // Left rail mirroring the in_progress todo-row stripe: purple when the task
    // is in progress (via CSS), transparent otherwise. First child so it anchors
    // to the card's left edge.
    const stripe = document.createElement('span');
    stripe.className = 'stripe';
    card.appendChild(stripe);

    const head = document.createElement('div');
    head.className = 'agentCardHead';

    const title = document.createElement('span');
    title.className = 'agentCardTitle';
    const text = (item.tit || '').trim() || 'Untitled task';
    title.textContent = text;
    title.title = text;
    head.appendChild(title);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agentGiveButton';
    btn.setAttribute('aria-label', 'Give "' + text + '" to agent');
    btn.appendChild(buildBoltIcon());
    const btnLabel = document.createElement('span');
    btnLabel.className = 'agentGiveButtonLabel';
    btnLabel.textContent = 'Give to agent';
    btn.appendChild(btnLabel);
    head.appendChild(btn);
    card.appendChild(head);

    // "In progress" pill beneath the title, in a body wrapper — only when the
    // task is in progress.
    if (inProgress) {
        const cardBody = document.createElement('div');
        cardBody.className = 'agentCardBody';
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = 'In progress';
        cardBody.appendChild(pill);
        card.appendChild(cardBody);
    }

    const errorEl = document.createElement('p');
    errorEl.className = 'agentGiveError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    card.appendChild(errorEl);

    btn.addEventListener('click', function () {
        if (btn.disabled) return;
        errorEl.hidden = true;
        errorEl.textContent = '';
        btn.disabled = true;
        btn.classList.add('is-pending');
        btnLabel.textContent = 'Adding…';
        Promise.resolve(listLogic.flagTaskForAgent(item.id)).then(function (res) {
            if (res && res.ok) {
                // The realtime subscription re-renders as the new row lands;
                // refresh explicitly too so the card leaves Not-assigned even
                // where realtime isn't observed (e.g. offline stubs).
                refreshAgentQueue(getSelectedProjectName());
                return;
            }
            btn.disabled = false;
            btn.classList.remove('is-pending');
            btnLabel.textContent = 'Give to agent';
            errorEl.textContent = (res && res.error) || 'Could not flag this task. Try again.';
            errorEl.hidden = false;
        }).catch(function () {
            btn.disabled = false;
            btn.classList.remove('is-pending');
            btnLabel.textContent = 'Give to agent';
            errorEl.textContent = 'Could not flag this task. Try again.';
            errorEl.hidden = false;
        });
    });

    return card;
}

// ── bucket fold/open state ───────────────────────────────────────────
// Each bucket header carries a caret that folds/opens its card list. The
// collapsed flag is persisted per bucket key so the layout survives a reload.
const BUCKET_COLLAPSE_KEY = 'todoapp_agentBucketCollapsed';

// Read the persisted collapsed-state map ({ [bucketKey]: boolean }). Defensive:
// a missing key, malformed JSON, or a non-object value all yield an empty map so
// the per-key defaults apply. Never throws.
function readBucketCollapseState() {
    try {
        const raw = localStorage.getItem(BUCKET_COLLAPSE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return (parsed && typeof parsed === 'object') ? parsed : {};
    } catch (e) {
        return {};
    }
}

// Whether a bucket should render collapsed. A stored boolean for the key wins;
// absent any stored value (first load), every bucket defaults open except
// Shipped, which defaults collapsed.
function isBucketCollapsed(key) {
    const state = readBucketCollapseState();
    if (Object.prototype.hasOwnProperty.call(state, key)) return !!state[key];
    return key === 'shipped';
}

// Persist one bucket's collapsed flag, merging into the stored map so the other
// buckets' saved states are preserved. Never throws (storage may be unavailable).
function setBucketCollapsed(key, collapsed) {
    try {
        const state = readBucketCollapseState();
        state[key] = !!collapsed;
        localStorage.setItem(BUCKET_COLLAPSE_KEY, JSON.stringify(state));
    } catch (e) {
        /* storage unavailable — the fold just won't persist this session */
    }
}

// Build a bucket header (caret + label + count) and wire its fold/open toggle.
// The caret sits before the label (order:-1 via CSS) and toggles a `.collapsed`
// class on `section`, which hides the section's `.agentBucketList`. The whole
// header is clickable; the caret is an ARIA button (role/tabindex) that also
// toggles on Enter/Space, with an aria-label reflecting the expand/collapse
// state. The persisted (or default) collapsed state is applied to `section` up
// front so the board paints in the saved layout.
function buildBucketHeader(section, key, labelText, countText) {
    const header = document.createElement('div');
    header.className = 'agentBucketHeader';

    const caret = document.createElement('span');
    caret.className = 'agentBucketCaret';
    caret.setAttribute('role', 'button');
    caret.setAttribute('tabindex', '0');
    header.appendChild(caret);

    const label = document.createElement('span');
    label.className = 'agentBucketLabel';
    label.textContent = labelText;
    header.appendChild(label);

    const count = document.createElement('span');
    count.className = 'agentBucketCount';
    count.textContent = countText;
    header.appendChild(count);

    let collapsed = isBucketCollapsed(key);

    function apply() {
        section.classList.toggle('collapsed', collapsed);
        caret.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        caret.setAttribute('aria-label', (collapsed ? 'Expand ' : 'Collapse ') + labelText + ' section');
    }
    apply();

    function toggle() {
        collapsed = !collapsed;
        setBucketCollapsed(key, collapsed);
        apply();
    }

    // The whole header toggles on click (a click on the caret bubbles up here,
    // so it toggles once); the caret handles keyboard activation itself.
    header.addEventListener('click', toggle);
    caret.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            toggle();
        }
    });

    return header;
}

// The Not-assigned bucket: a header (label + count) and one Give-to-agent card
// per unqueued task. Rendered at the bottom of the board, below Shipped.
function buildNotAssignedBucket(items) {
    const section = document.createElement('div');
    section.className = 'agentBucket agentBucket--not-assigned';
    section.appendChild(buildBucketHeader(section, 'not-assigned', 'Not assigned', String(items.length)));

    const list = document.createElement('div');
    list.className = 'agentBucketList';
    items.forEach(function (item) { list.appendChild(buildGiveToAgentCard(item)); });
    section.appendChild(list);

    return section;
}

// One bucket section: a header (label + count) and its cards.
function buildBucket(bucket, rows) {
    const section = document.createElement('div');
    section.className = 'agentBucket agentBucket--' + bucket.key;
    section.appendChild(buildBucketHeader(section, bucket.key, bucket.label, String(rows.length)));

    const list = document.createElement('div');
    list.className = 'agentBucketList';
    rows.forEach(function (row) { list.appendChild(buildCard(row)); });
    section.appendChild(list);

    return section;
}

// Paint the board from the cached rows for the currently selected project.
// Pure render — never fetches — so realtime pushes and re-renders stay cheap
// and loop-free. A missing #agentView (before component() builds the shell)
// short-circuits.
// ── OPEN-AND-ANCHOR (tasks-surface ⌁ MOCKUP badge → board card) ──
// A task row's `⌁ MOCKUP` badge routes here (via a handler main.js registers on
// todoStatus.js, which switches to the Agent view first) to jump the board to
// this task's card. The board rebuilds its whole DOM on every paint(), so when
// this is called right after the view switch the target card may not exist yet —
// renderAgentView repaints synchronously only when the queue is already loaded
// for the project, and asynchronously (after a fetch) otherwise. Mirror the
// viewer's entry-anchor: try to scroll now, and if the card isn't rendered yet,
// stash the todo id so the next paint() flushes it once the card exists. The
// match is by exact todo id, so a stale pending id can never scroll to the wrong
// card — at worst it waits harmlessly for its own card to reappear.
let _pendingAnchorTodoId = null;

function findAgentCardForTodo(view, todoId) {
    const cards = view.querySelectorAll('.agentCard[data-todo-id]');
    for (let i = 0; i < cards.length; i++) {
        if (cards[i].getAttribute('data-todo-id') === String(todoId)) return cards[i];
    }
    return null;
}

// Re-fire a short highlight on a card. Removes the class and forces a reflow
// before re-adding it so re-anchoring the SAME card restarts the animation, and
// self-clears on animationend. Mirrors the viewer's flashAnchorRow; the CSS drops
// the animation under prefers-reduced-motion while the scroll (below) stays.
function flashAgentCard(card) {
    const CLS = 'agentCard--anchorFlash';
    card.classList.remove(CLS);
    void card.offsetWidth;
    card.classList.add(CLS);
    card.addEventListener('animationend', function onEnd() {
        card.classList.remove(CLS);
        card.removeEventListener('animationend', onEnd);
    });
}

function scrollToAgentCard(todoId) {
    if (typeof document === 'undefined') return false;
    const view = document.getElementById('agentView');
    if (!view) return false;
    const card = findAgentCardForTodo(view, todoId);
    if (!card) return false;
    // The test environment stubs scrollIntoView; guard the capability so a missing
    // implementation degrades to no scroll rather than throwing.
    if (typeof card.scrollIntoView === 'function') {
        try { card.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        catch (e) { try { card.scrollIntoView(); } catch (_) { /* ignore */ } }
    }
    flashAgentCard(card);
    return true;
}

function flushPendingAnchor() {
    if (_pendingAnchorTodoId == null) return;
    if (scrollToAgentCard(_pendingAnchorTodoId)) _pendingAnchorTodoId = null;
}

// Public entry point: scroll the Agent board to the card for `todoId` and pulse
// it. Called after main.js switches to the Agent view; if the card isn't painted
// yet, the id is held and the next paint() flushes it.
export function anchorAgentCardForTodo(todoId) {
    if (todoId == null || todoId === '') return;
    if (!scrollToAgentCard(todoId)) _pendingAnchorTodoId = String(todoId);
}


function paint() {
    const view = document.getElementById('agentView');
    if (!view) return;

    // Preserve the focused needs_words answer input's caret across the rebuild.
    // The draft text itself is mirrored into _pendingAnswers on each keystroke and
    // re-applied in buildSecondary, but clear(view) drops focus and selection, so
    // capture the focused input's row + caret here and restore them after the new
    // board is in the document below.
    let focusedAnswer = null;
    const activeEl = document.activeElement;
    if (activeEl && activeEl.classList
        && activeEl.classList.contains('agentAnswerInput')
        && view.contains(activeEl)) {
        focusedAnswer = {
            rowId: activeEl.getAttribute('data-answer-row'),
            start: activeEl.selectionStart,
            end: activeEl.selectionEnd,
        };
    }

    clear(view);

    const projectName = getSelectedProjectName();
    if (!projectName) {
        const empty = document.createElement('div');
        empty.className = 'agentEmptyState';
        empty.textContent = 'Select a project to see its agent queue.';
        view.appendChild(empty);
        return;
    }

    // No routed repo for this project: the tab is now tappable, so opening it
    // lands here — render the unavailable message in place of the header/board
    // rather than a live queue there's nowhere to ship from.
    if (isAgentUnavailable()) {
        const empty = document.createElement('div');
        empty.className = 'agentEmptyState';
        // Centered link-off glyph above the message, matching the STRUCTURE tab's
        // no-linked-repo empty state so both non-configured views read identically.
        // Scoped to this branch only — the other agent empty states stay text-only.
        const glyph = document.createElement('span');
        glyph.className = 'agentEmptyGlyph';
        glyph.setAttribute('aria-hidden', 'true');
        glyph.appendChild(buildLinkOffIcon());
        empty.appendChild(glyph);
        const msg = document.createElement('span');
        msg.textContent = AGENT_UNAVAILABLE_MSG;
        empty.appendChild(msg);
        view.appendChild(empty);
        return;
    }

    const rows = getQueueRows();
    const counts = computeQueueCounts(rows);

    const header = document.createElement('div');
    header.className = 'agentViewHeader';

    // Agent identity block: a rounded bolt-icon badge + "Agent" label. Replaces
    // the old project-name heading and "Agent queue" chip — the project name is
    // already shown in the top project switcher/tabs.
    const identity = document.createElement('div');
    identity.className = 'agentIdentity';
    const badge = document.createElement('span');
    badge.className = 'agentIdentityBadge';
    badge.appendChild(buildBoltIcon());
    identity.appendChild(badge);
    const idLabel = document.createElement('span');
    idLabel.className = 'agentIdentityLabel';
    idLabel.textContent = 'Agent';
    identity.appendChild(idLabel);
    header.appendChild(identity);

    // Right-side group: a lightweight Working/Idle status pill followed by the
    // Run button. The pill is an indicator, not a control — "Working" (green
    // dot) when a triage sweep OR a derive run is in flight (each tracked live
    // via the Worker's workflow-scoped active_runs probe) OR any row is running
    // a ship run (dispatched/running), else muted "Idle". Sweeps and derive runs
    // aren't captured by any lasting row state, so isSweepActive()/isDeriveActive()
    // — not the row counts — carry those signals.
    const controls = document.createElement('div');
    controls.className = 'agentHeaderControls';

    const shipInFlight = rows.some(function (r) {
        return r && (r.state === 'dispatched' || r.state === 'running');
    });
    const working = isSweepActive() || isDeriveActive() || shipInFlight;
    const statusPill = document.createElement('span');
    statusPill.id = 'agentStatusPill';
    statusPill.className = 'agentStatusPill' + (working ? ' agentStatusPill--working' : ' agentStatusPill--idle');
    const statusDot = document.createElement('span');
    statusDot.className = 'agentStatusDot';
    statusPill.appendChild(statusDot);
    const statusLabel = document.createElement('span');
    statusLabel.className = 'agentStatusLabel';
    statusLabel.textContent = working ? 'Working' : 'Idle';
    statusPill.appendChild(statusLabel);
    controls.appendChild(statusPill);

    // Run button: dispatches a triage sweep for the active project. Fire-and-
    // forget — it shows a brief "queued" acknowledgment and neither blocks nor
    // polls; rows update live as triage writes verdicts via realtime.
    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'agentRunBtn';
    runBtn.textContent = 'Run';
    runBtn.setAttribute('aria-label', 'Run a triage sweep for this project');
    runBtn.addEventListener('click', function () {
        if (runBtn.disabled) return;
        runBtn.disabled = true;
        runBtn.textContent = 'Queued…';
        Promise.resolve(fireTriageSweep(projectName)).then(function (res) {
            runBtn.textContent = (res && res.ok === false) ? 'Try again' : 'Queued';
            // Re-enable shortly so the user can fire again; the real guard against
            // redundant sweeps is the module-level in-flight flag, not this button.
            setTimeout(function () {
                runBtn.disabled = false;
                runBtn.textContent = 'Run';
            }, 1500);
        });
    });
    controls.appendChild(runBtn);
    header.appendChild(controls);
    view.appendChild(header);

    // Assignment-context card, mounted directly under the header and rendered
    // from the `_assignment` cache (never re-fetched here). Absent → no card.
    const assignmentCard = buildAssignmentCard();
    if (assignmentCard) view.appendChild(assignmentCard);

    // Counts subline: "N flagged · N running · N shipped today" (mono). All three
    // segments show even at 0. Recomputed from _rows each paint(), so realtime
    // pushes keep it live.
    const countsLine = document.createElement('div');
    countsLine.className = 'agentCounts';
    countsLine.textContent =
        counts.flagged + ' flagged · ' + counts.running + ' running · ' + counts.shippedToday + ' shipped today';
    view.appendChild(countsLine);

    // Dispatched/running rows are settled by the shared store's mount-independent
    // reconciler (started at app init), not by a board-local poller — so a run
    // settles whether or not this board is on screen, and there is nothing to arm
    // or tear down here.
    const board = document.createElement('div');
    board.className = 'agentBoard';
    let rendered = false;
    BUCKETS.forEach(function (bucket) {
        const bucketRows = rows.filter(function (r) {
            return r && bucket.states.indexOf(r.state) !== -1;
        });
        if (!bucketRows.length) return;
        board.appendChild(buildBucket(bucket, bucketRows));
        rendered = true;
    });

    // Not-assigned bucket at the bottom: the project's tasks not yet in the
    // queue, each with a live "Give to agent" control. Omitted when every task
    // is already queued (or the project has no tasks).
    const notAssigned = computeNotAssigned(projectName, rows);
    if (notAssigned.length) {
        board.appendChild(buildNotAssignedBucket(notAssigned));
        rendered = true;
    }

    if (!rendered) {
        const empty = document.createElement('div');
        empty.className = 'agentEmptyState';
        empty.textContent = 'No agent work yet for this project.';
        view.appendChild(empty);
        return;
    }
    view.appendChild(board);

    // Restore focus + caret to the answer input that had them before the rebuild.
    // Scan by data-answer-row rather than a selector so an arbitrary row id can't
    // break the lookup; the draft value is already back in place from buildSecondary.
    if (focusedAnswer && focusedAnswer.rowId != null) {
        const inputs = view.querySelectorAll('.agentAnswerInput');
        for (let i = 0; i < inputs.length; i++) {
            if (inputs[i].getAttribute('data-answer-row') === focusedAnswer.rowId) {
                inputs[i].focus();
                try {
                    inputs[i].setSelectionRange(focusedAnswer.start, focusedAnswer.end);
                } catch (e) { /* selection API unavailable — focus alone suffices */ }
                break;
            }
        }
    }

    // A ⌁ MOCKUP badge tap may have requested an anchor to a card that wasn't
    // rendered yet (the view switch triggered an async queue load). Now the board
    // is in the document, flush any pending anchor so the target card scrolls into
    // view and pulses. No-op when nothing is pending or the card still isn't here.
    flushPendingAnchor();
}

// ── AGENT-VIEW AVAILABILITY GATE ──
// The gate (syncAgentAvailabilityForProject / isAgentUnavailable /
// AGENT_UNAVAILABLE_MSG) now lives in agentQueueStore.js so it survives the
// board's deletion; the board still consults isAgentUnavailable() /
// AGENT_UNAVAILABLE_MSG in paint() (imported at the top of this module) to render
// its in-view unavailable message. The persistent working watch the gate pokes to
// recompute the nav dot on a project switch now lives in the store too, so that is
// a local call there rather than a board-injected callback.

// Render the AGENT view for the currently selected project. Safe to call
// before component() has built the shell (a missing #agentView short-circuits
// inside paint()). Repaints from the cached rows immediately, and — when the
// selected project has changed since the last load — kicks off a fresh
// project-scoped fetch that repaints again on resolve.
export function renderAgentView() {
    const projectName = getSelectedProjectName();
    if (projectName !== getLoadedProjectName()) {
        setQueueRows([]);
        // Reset the assignment cache alongside the rows and re-read it for the new
        // project (fetches once; a no-target project resolves to absent).
        resetAssignmentCache();
        refreshAssignment(resolveReadTarget());
        // Project switch: settle any dispatched/running rows against main once
        // the new project's queue loads (a run may have shipped while away).
        refreshAgentQueue(projectName, { settle: true });
        return;
    }
    paint();
}

// Ensure the board repaints on a shared-store realtime push. The store fetches
// once per push and notifies; this listener just repaints from cache (paint()
// no-ops when the board isn't mounted). Registered once — module-level state, so
// a second subscribeAgentView call doesn't stack a second listener.
let _boardQueueListenerRegistered = false;
function ensureBoardQueueListener() {
    if (_boardQueueListenerRegistered) return;
    _boardQueueListenerRegistered = true;
    onQueueChange(paint);
}

// Open the shared realtime subscription on agent_queue and load the current
// project's rows. The store owns the channel now (app-lifetime, shared with the
// task-row badges), so this just ensures it's open and registers the board's
// repaint listener. Idempotent.
export function subscribeAgentView() {
    startAgentQueueSubscription();
    ensureBoardQueueListener();
    // Mount: load the queue and settle any dispatched/running rows that already
    // shipped on main while the tab was closed (resume-poll the rest via paint).
    refreshAgentQueue(getSelectedProjectName(), { settle: true });
    // Read the assignment card once for this project unless renderAgentView's
    // project-switch path already fetched it (guarded so we don't double-read).
    if (getAssignmentProject() !== getSelectedProjectName()) {
        refreshAssignment(resolveReadTarget());
    }
    // Seed the status pill from the real triage-run state: a one-shot check so a
    // sweep already running (e.g. started on another device) shows Working here.
    seedSweepState();
}

// Board-exit teardown. The agent_queue realtime channel now lives in the shared
// store and stays open app-lifetime (the task-row badges depend on it on the list
// view), so it is deliberately NOT torn down here — only the board's own pill
// trackers are. The dispatch reconciler likewise lives in the store and runs
// app-lifetime, so a backgrounded board keeps settling its runs — there is no
// board-local dispatch poller to stop. The board's repaint listener is left
// registered too: paint() no-ops off-tab, so an idle push is cheap. Idempotent.
export function unsubscribeAgentView() {
    // Stop the triage-sweep poller; a reopen re-seeds it via seedSweepState.
    stopSweepTracking();
    // Stop the derive-run poller silently — no settle paint, since the board is
    // being torn down. Unlike the sweep, derive tracking is local dispatch only (no
    // cross-device mount seed), so a backgrounded board simply drops the in-flight
    // derive signal rather than re-seeding on reopen.
    stopDeriveTracking(true);
}
