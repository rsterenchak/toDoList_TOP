import { supabase } from './supabaseClient.js';
import { listLogic } from './listLogic.js';
import {
    mintEntryId,
    dispatchTriage,
    pollRunStatus,
    resolveEntryByMarker,
    fetchRunResult,
    fetchActiveRuns,
    readTodoMdFromWorker,
    readAssignmentFromWorker,
    findTargetById,
    showInjectToast,
    isInjectConfigured,
    chatWithWorker,
    revertEntry,
} from './inject.js';
import { openChatWithSeed } from './claudeSheet.js';
import { showConfirmModal } from './modals.js';
import { shipEntryForTodo } from './shipEntry.js';

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

// Workflow conclusions that positively mean the run failed. Mirrors the
// Runs-tab FAILURE_CONCLUSIONS list: only these flip a completed run to
// `failed`; any other completed conclusion (neutral, skipped, no conclusion)
// keeps the row in-progress rather than asserting failure.
const FAILURE_CONCLUSIONS = ['failure', 'cancelled', 'timed_out'];

// Dispatch-poll cadence and give-up window, matching the Runs-tab poller's
// shape. The poll runs while the tab is open; if the tab closes mid-run the row
// stalls at dispatched/running until reopened (paint() re-arms the poller for
// any dispatched/running row that still carries its correlation + entry ids).
const DISPATCH_POLL_MS = 5000;
const DISPATCH_GIVE_UP_MS = 15 * 60 * 1000;

// Triage-sweep tracking cadence and windows. Tapping Run fires a
// `claude-triage.yml` sweep — a GitHub Actions workflow that isn't represented
// by any lasting agent_queue row state — so the header pill is driven from the
// real run via the Worker's triage-scoped `active_runs` probe instead. The poll
// runs every SWEEP_POLL_MS; if the run hasn't registered yet the pill stays
// optimistically "Working" up to SWEEP_GRACE_MS (registration lag), and a hard
// SWEEP_HARD_CAP_MS ceiling force-stops the poller regardless.
const SWEEP_POLL_MS = 5000;
const SWEEP_GRACE_MS = 30 * 1000;
const SWEEP_HARD_CAP_MS = 5 * 60 * 1000;

// ── module state ─────────────────────────────────────────────────────
// The rows last loaded for the active project, the project they belong to,
// and the live realtime channel. Module-level so a re-render (project switch,
// realtime push) paints from the cache without a synchronous refetch, and so
// the channel survives across re-renders and tears down cleanly on view exit.
let _rows = [];
let _loadedProjectName = null;
let _channel = null;
// The active project's assignment-context state — the classified result of
// reading `assignment.md` (the sibling of the routed repo's TODO.md). Shaped
// `{ state: 'absent' | 'unfilled' | 'filled', ... }` (filled also carries the
// summary title + word/section counts), or null before the first read resolves.
// Module-level (mirroring _rows) so a realtime-push repaint renders the card
// from cache — paint() must NOT re-fetch. `_assignmentProject` records which
// project the cache belongs to so mount/project-switch fetch exactly once.
let _assignment = null;
let _assignmentProject = null;
// Active dispatch-status pollers, keyed by agent_queue row id → interval handle.
// Module-level so a poller survives re-renders (a realtime push repaints the
// board without tearing down an in-flight poll) and so paint() can re-arm one
// for a dispatched/running row after a tab reopen.
const _dispatchPollers = {};
// Row ids that have been handed off to the Claude chat via a needs_words card's
// "Discuss in chat" link. Module-level (mirroring _dispatchPollers) so the
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
// Generated A/B/C mockup variants, keyed by agent_queue row id → the parsed
// { A, B, C } variant object. Mockup previews are otherwise transient DOM state
// on the needs_mockup card, so a realtime push repaint (paint() rebuilds the
// whole board from _rows for ANY row change in the project) would wipe the
// just-generated previews out from under the user. Caching here (mirroring
// _handedOffRows/_dispatchPollers/_revertedEntries) lets buildMockupSecondary
// repaint them immediately instead of an empty "Generate mockups" button.
// Session-scoped only; resets on reload.
const _mockupVariants = new Map();
// Row ids with a mockup generation currently in flight, keyed by agent_queue row
// id. Mirrors _mockupVariants: a realtime push repaint (paint() rebuilds the whole
// board from _rows for ANY row change) tears down the just-clicked "Generating…"
// button and rebuilds a fresh idle one, so the original request finishes against a
// detached node and the user sees an inert "Generate mockups" they must click
// again. Recording the in-flight row here (set on click, cleared in both the
// success and failure paths) lets buildMockupSecondary re-render the button as
// disabled/"Generating…" after a repaint instead of resetting it to idle.
// Session-scoped only; resets on reload.
const _mockupPending = new Set();
// In-progress, unsent needs_words answers, keyed by agent_queue row id → the
// current textarea text. A realtime push repaint (paint() rebuilds the whole
// board from _rows for ANY row change) tears down the answer textarea and builds
// a fresh empty one, silently dropping whatever the user had typed but not yet
// sent. Mirroring _mockupVariants/_mockupPending, the draft is mirrored here on
// every keystroke and re-applied in buildSecondary after a repaint, so an unsent
// answer survives the rebuild. The focused input's caret is separately preserved
// across the rebuild in paint(). Cleared on a successful send. Session-scoped only.
const _pendingAnswers = new Map();
// Short in-flight guard shared by the header Run button and the answer-submit
// auto-fire, so a rapid double-tap or a quick succession of answers doesn't fire
// redundant triage sweeps in the same tick. The workflow's concurrency group and
// batch-all-`triaging` design coalesce anything that overlaps anyway, so at worst
// this drops a truly redundant call. Cleared once the dispatch settles.
let _triageInFlight = false;
// Triage-sweep tracking state that drives the header's Working/Idle pill from
// the real claude-triage.yml run (via the Worker's triage-scoped active_runs
// probe), not just from agent_queue row states. `_sweepActive` is what the pill
// reads; `_sweepPoller` is the interval handle; `_sweepSeenActive` records
// whether a poll has ever confirmed the run in flight (so registration lag is
// distinguished from a finished run); the deadlines bound the grace window and
// the hard cap. Cross-device, since GitHub is the source of truth.
let _sweepActive = false;
let _sweepPoller = null;
let _sweepSeenActive = false;
let _sweepGraceDeadline = 0;
let _sweepHardDeadline = 0;
// The project whose sweep is being tracked, captured when tracking starts. A
// sweep is scoped to one project's agent_queue rows, and the user may switch
// projects while it runs, so the post-finish reconcile targets THIS project's
// rows rather than whatever board is on screen when the sweep settles.
let _sweepProjectName = null;

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
    if (_triageInFlight) return Promise.resolve(null);
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) return Promise.resolve(null);
    _triageInFlight = true;
    // Optimistically drive the header pill to Working the instant we dispatch,
    // and start the poller that tracks the real claude-triage.yml run to
    // completion (settling the pill back to Idle when GitHub reports it done).
    startSweepTracking(false);
    return Promise.resolve()
        .then(function () { return dispatchTriage(projectId, mintEntryId(), resolveDispatchTarget()); })
        .then(
            function (res) {
                _triageInFlight = false;
                // If the dispatch itself failed, clear the optimistic Working
                // state so neither the pill nor the nav dot falsely reports a
                // sweep in flight (no run will ever register).
                if (res && res.ok === false) { stopSweepTracking(); clearWorkingWatchSweepSeed(); pollAgentWorkingWatch(); }
                return res;
            },
            function () {
                _triageInFlight = false;
                stopSweepTracking();
                clearWorkingWatchSweepSeed();
                pollAgentWorkingWatch();
                return { ok: false };
            }
        );
}

// ── triage-sweep tracking ────────────────────────────────────────────
// Drive the header pill from the real claude-triage.yml run. A sweep is a
// batch GitHub Actions workflow with no lasting agent_queue row state, so the
// pill can't be computed from rows alone — instead we poll the Worker's
// triage-scoped `active_runs` probe and flip the pill Working → Idle from what
// GitHub actually reports. Cross-device: a sweep started on another device is
// picked up by the mount-time seed (seedSweepState).

// Begin (or refresh) tracking a triage sweep. Sets the pill optimistically to
// Working immediately, (re)arms the poller, and kicks a one-shot poll so an
// already-completed run settles at once. `alreadyConfirmed` is true only for
// the mount-time seed, where the seed fetch has already observed the run in
// flight — otherwise we start unconfirmed so the grace window covers the
// registration lag before the run appears. This is also the single chokepoint
// that seeds the persistent working watch (both local dispatch via
// fireTriageSweep and the cross-device mount seed via seedSweepState), so the
// nav "● Agent" dot lights the instant a sweep dispatches instead of waiting on
// the watch's slow remote probe to observe the run once it registers.
function startSweepTracking(alreadyConfirmed) {
    const now = Date.now();
    _sweepActive = true;
    _sweepSeenActive = !!alreadyConfirmed;
    _sweepProjectName = getSelectedProjectName();
    _sweepGraceDeadline = now + SWEEP_GRACE_MS;
    _sweepHardDeadline = now + SWEEP_HARD_CAP_MS;
    if (!_sweepPoller) {
        _sweepPoller = setInterval(pollSweepOnce, SWEEP_POLL_MS);
    }
    // Seed the mount-independent working watch so the nav dot lights now, not
    // 30-45s later when the probe finally observes the registered run.
    seedWorkingWatchSweep(alreadyConfirmed);
    refreshStatusPill();
    pollSweepOnce();
}

// Stop tracking and settle the pill to Idle. Idempotent; refreshes the pill only
// when it was actually showing Working, so a no-op stop (e.g. on view exit with
// no sweep) doesn't touch the DOM.
function stopSweepTracking() {
    if (_sweepPoller) {
        clearInterval(_sweepPoller);
        _sweepPoller = null;
    }
    const wasActive = _sweepActive;
    _sweepActive = false;
    _sweepSeenActive = false;
    if (wasActive) refreshStatusPill();
}

// One poll tick: ask the Worker whether claude-triage.yml has an in-flight run.
// `active:true` confirms the sweep (and keeps the pill Working); `active:false`
// after a confirmation means it finished → settle to Idle. Before any
// confirmation, `active:false` is registration lag: stay Working until the grace
// window elapses. A transient failure (`ok:false`) is ignored and retried. A
// hard cap force-stops regardless so a wedged run can't pin the pill forever.
function pollSweepOnce() {
    if (Date.now() >= _sweepHardDeadline) {
        finishSweep();
        return;
    }
    Promise.resolve(fetchActiveRuns(resolveDispatchTarget(), 'triage')).then(function (res) {
        if (!_sweepPoller && !_sweepActive) return; // torn down mid-flight
        if (!res || res.ok === false) return; // transient — retry next tick
        if (res.active) {
            _sweepSeenActive = true;
            if (!_sweepActive) { _sweepActive = true; refreshStatusPill(); }
            return;
        }
        // active === false
        if (_sweepSeenActive || Date.now() >= _sweepGraceDeadline) {
            // Either the confirmed run has finished, or the grace window for a
            // run that never registered has elapsed — settle to Idle.
            finishSweep();
        }
    });
}

// A tracked sweep has reached a terminal point — the probe confirmed its run
// finished, the grace window for a never-registered run elapsed, or the hard cap
// force-stopped a wedged run. Settle the pill to Idle, then reconcile any row the
// sweep left stuck at 'triaging'. Only reconcile when a sweep was genuinely being
// tracked (`wasActive`), so a stray poll while idle is a pure no-op. This is
// deliberately NOT folded into stopSweepTracking(): that also fires on plain
// teardown (view exit, or a dispatch that never launched a run), where the sweep
// may still be running and its rows must be left untouched.
function finishSweep() {
    const projectName = _sweepProjectName;
    const wasActive = _sweepActive;
    stopSweepTracking();
    if (wasActive) reconcileStuckTriaging(projectName);
}

// Reconcile rows a finished triage sweep left behind. A flagged todo's
// agent_queue row is set to 'triaging' at flag time (and again on re-triage after
// an answer), before any run exists, and nothing ever revisits that row from the
// client: dispatchTriage is fire-and-forget and the sweep poller only drives the
// header pill. So if claude-triage.yml errors, times out, or exhausts its turns
// before writing a verdict for a given row, that row is left at 'triaging'
// indefinitely — sitting silently in the In-progress bucket with the pill back at
// Idle and no way to tell the sweep failed. Once the tracked run is confirmed
// finished, flip each still-'triaging' row for the swept project to a visible
// 'failed' state (surfaced in the Stuck bucket) with an explanatory reason, so
// the user can remove it and flag the task again rather than stall unseen. This
// mirrors the settleInFlightRows / pollDispatchOnce reconcile pattern used for
// in-flight ship rows. The queue is read fresh (not the possibly-stale render
// cache) so a row the sweep DID resolve is never clobbered, and the board
// repaints only when the swept project is still the one on screen.
async function reconcileStuckTriaging(projectName) {
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) return;
    const rows = await fetchQueueRows(projectId);
    const stuck = (Array.isArray(rows) ? rows : []).filter(function (r) {
        return r && r.state === 'triaging';
    });
    if (!stuck.length) return;
    let changedAny = false;
    for (let i = 0; i < stuck.length; i++) {
        const res = await listLogic.setAgentRunState(stuck[i].id, {
            state: 'failed',
            failure_reason: 'The triage sweep didn’t finish for this task. Remove it and flag the task again to retry.',
        });
        if (res && res.ok) changedAny = true;
    }
    if (changedAny && getSelectedProjectName() === projectName) {
        refreshAgentQueue(projectName);
    }
}

// Update the header status pill in place to reflect the current Working/Idle
// state, WITHOUT a full paint(). A full repaint here would rebuild — and reset —
// the Run button while its click handler is mid-interaction, and would churn the
// whole board on a purely cosmetic pill flip. No-op when the pill isn't mounted
// (view not painted / not on the Agent tab). Uses the same predicate paint()
// does: Working when a sweep is in flight OR any row is dispatched/running.
function refreshStatusPill() {
    const pill = document.getElementById('agentStatusPill');
    if (!pill) return;
    const rows = Array.isArray(_rows) ? _rows : [];
    const shipInFlight = rows.some(function (r) {
        return r && (r.state === 'dispatched' || r.state === 'running');
    });
    const working = _sweepActive || shipInFlight;
    pill.className = 'agentStatusPill' + (working ? ' agentStatusPill--working' : ' agentStatusPill--idle');
    const label = pill.querySelector('.agentStatusLabel');
    if (label) label.textContent = working ? 'Working' : 'Idle';
}

// Mount-time seed: a one-shot triage active_runs check so a sweep already
// running (possibly started on another device) shows Working here too and is
// tracked to completion. Fire-and-forget; a miss or transient error leaves the
// pill as the row states dictate.
function seedSweepState() {
    Promise.resolve(fetchActiveRuns(resolveDispatchTarget(), 'triage')).then(function (res) {
        if (res && res.ok !== false && res.active) {
            startSweepTracking(true);
        }
    });
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

// Query agent_queue for one project's rows. Written to survive both the live
// Supabase client (a chainable, awaitable query builder) and the test/stub
// client (whose .select() resolves immediately and has no .eq); a synchronous
// throw from the incompatible chain is caught and treated as "no rows", so the
// view degrades to an empty board rather than crashing.
function fetchQueueRows(projectId) {
    return new Promise(function (resolve) {
        try {
            Promise.resolve(
                supabase.from('agent_queue').select('*').eq('project_id', projectId)
            ).then(function (res) {
                if (res && res.error) { resolve([]); return; }
                resolve((res && res.data) || []);
            }).catch(function () { resolve([]); });
        } catch (e) {
            resolve([]);
        }
    });
}

// Re-scope and reload the queue for the given project, then repaint. Only the
// most recent load for the still-selected project is applied, so a stale
// in-flight fetch from a since-abandoned project can't clobber the board.
// `options.settle` runs the mount-time reconcile pass (settleInFlightRows) after
// the repaint — set only on view mount and project switch, NOT on the realtime
// pushes / post-action refreshes that also call through here, so TODO.md is read
// once per mount rather than on every board repaint.
function refreshAgentQueue(projectName, options) {
    const settle = !!(options && options.settle);
    _loadedProjectName = projectName;
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) {
        _rows = [];
        paint();
        return;
    }
    fetchQueueRows(projectId).then(function (rows) {
        if (getSelectedProjectName() === _loadedProjectName) {
            _rows = Array.isArray(rows) ? rows : [];
            paint();
            if (settle) settleInFlightRows(_rows);
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
        if (_pendingAnswers.has(row.id)) {
            input.value = _pendingAnswers.get(row.id);
        }
        input.addEventListener('input', function () {
            _pendingAnswers.set(row.id, input.value);
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
                    _pendingAnswers.delete(row.id);
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
        dispatchDraft(row, draftText, row.entry_id).then(function (res) {
            if (res && res.ok) {
                // The realtime subscription (plus the explicit refresh started
                // by dispatchDraft) moves the card into In progress; nothing to
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
    const state = row.state;
    const wrap = document.createElement('div');
    wrap.className = 'agentSecondary agentStuck';

    const reason = (row.failure_reason || '').trim();
    const p = document.createElement('p');
    p.className = 'agentFailure';
    p.textContent = reason || (state === 'no_change'
        ? 'The run finished without merging any changes.'
        : 'The run failed. Retry from the queue.');
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
        dispatchDraft(row, draftText, row.entry_id).then(function (res) {
            if (res && res.ok) {
                // dispatchDraft persists `dispatched` and refreshes; the card
                // moves into In progress on its own. Nothing to do here.
                return;
            }
            fail(res && res.error);
        }).catch(function () {
            fail('Could not retry. Try again.');
        });
    });

    return wrap;
}

// How a mockup prompt names the repo it targets. The three prompt builders no
// longer hardcode `toDoList_TOP` / `toDoList_main/src/`: given the active
// project's linked inject-target repo (owner/name, from mockupChatRepo) they
// name that repo and use neutral "repo-relative paths" wording, so a prompt for
// a linked repo (e.g. matchingGame-test) points at the right source tree. When
// no target is routed (repo null/empty), they fall back to the original
// toDoList_TOP PWA wording and its `toDoList_main/src/` path pin.
function mockupRepoLabel(repo) {
    const slug = (repo == null) ? '' : String(repo).trim();
    return slug ? ('`' + slug + '` repo') : 'toDoList_TOP PWA';
}
function mockupPathHint(repo) {
    const slug = (repo == null) ? '' : String(repo).trim();
    return slug ? 'full repo-relative paths' : 'full repo-relative paths under `toDoList_main/src/`';
}

// Build the ready-to-paste mockup prompt from the task + captured context
// bundle. Any Context line whose field is empty is omitted; when no bundle
// field is present the whole Context block is dropped rather than leaving a
// bare "Context:" header. The trailing format instruction pins the entry shape
// the user should paste back (matching the routine's TODO.md conventions).
function buildMockupPrompt(ctx, repo) {
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const val = function (v) { return (v == null) ? '' : String(v).trim(); };
    const title = val(c.title);
    const description = val(c.description);

    const contextLines = [];
    if (val(c.region)) contextLines.push('- Region: ' + val(c.region));
    if (val(c.tokens)) contextLines.push('- Tokens: ' + val(c.tokens));
    if (val(c.change)) contextLines.push('- Change: ' + val(c.change));
    const contextBlock = contextLines.length ? ('\n\nContext:\n' + contextLines.join('\n')) : '';

    // Raw source slices of the target region, added by triage so the mockup is
    // grounded in the real UI from the first message rather than reconstructed
    // from the hand-summarized `tokens`. Fenced verbatim; omitted (conditional,
    // like the Context lines) on older rows that predate these fields.
    const markup = val(c.markup);
    const css = val(c.css);
    const markupBlock = markup ? ('\n\nCurrent markup:\n```\n' + markup + '\n```') : '';
    const cssBlock = css ? ('\n\nCurrent CSS:\n```css\n' + css + '\n```') : '';

    return "I'm working on my " + mockupRepoLabel(repo) + ' and need mockups for a UI change, then a finished TODO.md entry.\n\n'
        + 'Task: ' + title + '\n' + description
        + contextBlock
        + markupBlock
        + cssBlock
        + '\n\nShow me 2-3 mockup options (A/B/C), let me pick one, then produce a single TODO.md entry '
        + 'in this format: `- [ ] **[PRIORITY]** <title>` with `- Type:` / `- Description:` / `- File:` / '
        + '`- Completed:` sub-bullets, priority in literal brackets, ' + mockupPathHint(repo) + ', no id marker.';
}

// The machine-parseable sibling of buildMockupPrompt: same grounded context
// (region/tokens/change/markup/css) but asking for three self-contained HTML
// documents — variants A/B/C — returned as a single JSON object and nothing
// else, so the reply can be parsed and rendered as live previews right on the
// card. Deliberately carries NO TODO.md-entry instruction: the finished entry
// stays with the fallback hand-off (buildMockupPrompt), so a Generate call is
// mockups-only.
function buildMockupGenPrompt(ctx, repo) {
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const val = function (v) { return (v == null) ? '' : String(v).trim(); };
    const title = val(c.title);
    const description = val(c.description);

    const contextLines = [];
    if (val(c.region)) contextLines.push('- Region: ' + val(c.region));
    if (val(c.tokens)) contextLines.push('- Tokens: ' + val(c.tokens));
    if (val(c.change)) contextLines.push('- Change: ' + val(c.change));
    const contextBlock = contextLines.length ? ('\n\nContext:\n' + contextLines.join('\n')) : '';

    const markup = val(c.markup);
    const css = val(c.css);
    const markupBlock = markup ? ('\n\nCurrent markup:\n```\n' + markup + '\n```') : '';
    const cssBlock = css ? ('\n\nCurrent CSS:\n```css\n' + css + '\n```') : '';

    return 'I need three UI mockup variants (A, B, C) for a change to my ' + mockupRepoLabel(repo) + ', '
        + 'to preview inline. Do NOT write a TODO.md entry — mockups only.\n\n'
        + 'Task: ' + title + '\n' + description
        + contextBlock
        + markupBlock
        + cssBlock
        + '\n\nProduce three distinct, self-contained HTML documents — one per variant — that '
        + 'render the proposed change. Each must be a complete standalone document styled with an '
        + 'inline <style> block, using the app CSS variables (var(--accent), var(--bg-base), '
        + 'var(--text-primary), etc.) so it matches the real theme; no external assets and no scripts.'
        + '\n\nReturn the three complete documents as RAW HTML — no JSON, no escaping, no code '
        + 'fences. Precede each document with its own marker line, alone on its own line, exactly:\n'
        + '===VARIANT A===\n<full html document for A>\n===VARIANT B===\n<full html document for B>\n'
        + '===VARIANT C===\n<full html document for C>\n'
        + 'Output nothing before ===VARIANT A=== and nothing after the C document.';
}

// Parse a mockup-generation reply into { A, B, C } HTML strings, defensively.
// The reply is raw HTML — each variant document preceded by a sentinel marker
// line (===VARIANT A=== / B / C) — NOT JSON: embedding full HTML documents as
// JSON string values proved too fragile (every quote and newline needs
// escaping), so the contract is marker-delimited raw HTML with no escaping.
// Splits on the markers (tolerating surrounding prose or a ```html fence around
// each document) and returns { A, B, C }. Returns null if it can't recover at
// least one variant — the caller surfaces that as a non-blocking error and
// leaves the fallback hand-off usable. Never throws.
function parseMockupVariants(reply) {
    if (!reply || typeof reply !== 'string') return null;
    const text = reply;
    // Locate every "===VARIANT X===" marker, tolerating spacing and case.
    const markerRe = /={2,}\s*VARIANT\s+([ABC])\s*={2,}/gi;
    const markers = [];
    let m;
    while ((m = markerRe.exec(text)) !== null) {
        markers.push({ key: m[1].toUpperCase(), start: m.index, contentStart: markerRe.lastIndex });
    }
    if (!markers.length) return null;
    const out = {};
    let any = false;
    for (let i = 0; i < markers.length; i++) {
        const end = (i + 1 < markers.length) ? markers[i + 1].start : text.length;
        let slice = text.slice(markers[i].contentStart, end).trim();
        // Peel a ```html … ``` (or bare ```) fence wrapping the document.
        const fence = slice.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
        if (fence) slice = fence[1].trim();
        // First writer wins if a marker somehow repeats.
        if (slice && !out[markers[i].key]) { out[markers[i].key] = slice; any = true; }
    }
    return any ? out : null;
}

// Build the prompt that turns a chosen A/B/C variant into a finished TODO.md
// entry. Carries the same grounded context buildMockupGenPrompt uses
// (title/description/region/tokens/change/markup/css) plus the selected
// variant's HTML, and asks for ONLY the finished entry in the exact shape the
// fallback prompt pins — so the reply can be written straight to the row's
// draft after a single fence strip.
function buildMockupEntryPrompt(ctx, key, html, repo) {
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const val = function (v) { return (v == null) ? '' : String(v).trim(); };
    const title = val(c.title);
    const description = val(c.description);

    const contextLines = [];
    if (val(c.region)) contextLines.push('- Region: ' + val(c.region));
    if (val(c.tokens)) contextLines.push('- Tokens: ' + val(c.tokens));
    if (val(c.change)) contextLines.push('- Change: ' + val(c.change));
    const contextBlock = contextLines.length ? ('\n\nContext:\n' + contextLines.join('\n')) : '';

    const markup = val(c.markup);
    const css = val(c.css);
    const markupBlock = markup ? ('\n\nCurrent markup:\n```\n' + markup + '\n```') : '';
    const cssBlock = css ? ('\n\nCurrent CSS:\n```css\n' + css + '\n```') : '';

    const variantHtml = String(html == null ? '' : html);
    const variantBlock = '\n\nChosen mockup (variant ' + String(key) + '):\n```html\n' + variantHtml + '\n```';

    return 'I picked a mockup for a UI change to my ' + mockupRepoLabel(repo) + '. Turn it into a single '
        + 'finished TODO.md entry — nothing else.\n\n'
        + 'Task: ' + title + '\n' + description
        + contextBlock
        + markupBlock
        + cssBlock
        + variantBlock
        + '\n\nReturn ONLY the finished entry in exactly this format: '
        + '`- [ ] **[PRIORITY]** <title>` with `- Type:` / `- Description:` / `- File:` / '
        + '`- Completed:` sub-bullets, priority in literal brackets, ' + mockupPathHint(repo)
        + ', no id marker. No prose, no explanation, no code fences.';
}

// Strip a single wrapping ```…``` (or ```markdown …```) code fence from a reply
// and trim, so a fenced entry pastes cleanly into the row's draft. A reply with
// no fence is returned trimmed as-is. Never throws.
function stripEntryFence(reply) {
    let s = String(reply == null ? '' : reply).trim();
    const fence = s.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
    if (fence) s = fence[1].trim();
    return s;
}

// The app's Void design tokens (the dark-theme :root defaults from style.css),
// injected into every preview iframe so a variant's HTML renders against the
// real cascade rather than an approximation. Kept in sync with style.css by
// token name; buildPreviewCss() overrides any token whose live computed value
// is readable at render time, so an active light theme is honored too.
const PREVIEW_TOKENS = [
    ['--bg-base', '#0e0f14'],
    ['--bg-elevated', '#14151b'],
    ['--bg-raised', '#1c1e27'],
    ['--bg-surface', '#191a22'],
    ['--bg-row', '#1b1c25'],
    ['--bg-hover', '#1f2130'],
    ['--bg-active', '#1a1c29'],
    ['--border-dim', '#1d1e26'],
    ['--border-mid', '#23242e'],
    ['--border-bright', '#2d2f3d'],
    ['--accent', '#8b7bff'],
    ['--accent-dim', 'rgba(139, 123, 255, 0.12)'],
    ['--accent-text', '#8b7bff'],
    ['--accent-glow', 'rgba(139, 123, 255, 0.55)'],
    ['--text-primary', '#e6e7ee'],
    ['--text-secondary', '#8a8d9c'],
    ['--text-muted', '#5a5d6b'],
    ['--text-danger', '#e06a7a'],
    ['--text-warning', '#d9b86a'],
    ['--text-urgent', '#e06a7a'],
    ['--type-feature', '#9ad0a8'],
    ['--type-bug', '#e48a96'],
    ['--type-modify', '#d9b88a'],
    ['--radius-sm', '4px'],
    ['--radius-md', '6px'],
];

// Build the <style> body injected into each preview document: the resolved
// Void tokens on :root plus a base reset and the app font stack, so a variant
// inherits the real theme + typography. Reads live token values off the root
// element when available (honoring the active theme), falling back to the dark
// defaults when they can't be read (e.g. under a headless test).
function buildPreviewCss() {
    let live = null;
    try { live = window.getComputedStyle(document.documentElement); } catch (e) { live = null; }
    const decls = PREVIEW_TOKENS.map(function (pair) {
        let value = pair[1];
        if (live) {
            const v = live.getPropertyValue(pair[0]);
            if (v && v.trim()) value = v.trim();
        }
        return '  ' + pair[0] + ': ' + value + ';';
    }).join('\n');
    return ':root {\n' + decls + '\n}\n'
        + 'html, body { margin: 0; }\n'
        + 'body { padding: 12px; background: var(--bg-base); color: var(--text-primary);'
        + " font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,"
        + ' Helvetica, Arial, sans-serif; }\n'
        + "code, pre, kbd { font-family: 'SpaceMono', ui-monospace, SFMono-Regular, Consolas, monospace; }";
}

// Inject the preview <style> into a variant's HTML so it renders against the
// app cascade. Splices into an existing <head> when the variant is a full
// document, opens one inside a bare <html>, or wraps a fragment in a minimal
// document — so both full documents and fragments preview correctly.
function injectPreviewStyle(html) {
    const styleTag = '<style>' + buildPreviewCss() + '</style>';
    const h = String(html == null ? '' : html);
    if (/<head[^>]*>/i.test(h)) {
        return h.replace(/<head[^>]*>/i, function (m) { return m + styleTag; });
    }
    if (/<html[^>]*>/i.test(h)) {
        return h.replace(/<html[^>]*>/i, function (m) { return m + '<head>' + styleTag + '</head>'; });
    }
    return '<!doctype html><html><head>' + styleTag + '</head><body>' + h + '</body></html>';
}

// The repo to point a mockup-generation chat turn at: the active project's
// linked inject target repo (the same routing the inject/run path uses), or
// null when the project has no target — in which case the Worker falls back to
// its default repo. Mirrors resolveProjectRepo without pulling that module's
// import graph into this view.
function mockupChatRepo(projectName) {
    const targetId = listLogic.getProjectTargetId(projectName);
    if (!targetId) return null;
    const target = findTargetById(targetId);
    return target && target.repo ? target.repo : null;
}

// Render the A/B/C variants into the previews container as stacked tiles, each
// a sandboxed <iframe> (scripts OFF via an empty `sandbox`, so pure-CSS motion
// still runs) whose srcdoc is the variant HTML with the app cascade injected.
// Replaces any prior tiles.
//
// When `row` is supplied, each tile also carries a "use this" control: tapping
// it turns that variant into a finished TODO.md entry (buildMockupEntryPrompt →
// chat Worker) and writes it to the row's draft, flipping the row to `drafted`
// at the existing Dispatch gate. The row is omitted only by view-only callers
// (older/test call sites), keeping the tiles inert there.
function renderMockupPreviews(container, variants, row) {
    container.textContent = '';
    const useButtons = [];
    ['A', 'B', 'C'].forEach(function (k) {
        if (!variants[k]) return;
        const tile = document.createElement('div');
        tile.className = 'agentMockupTile';

        const label = document.createElement('span');
        label.className = 'agentMockupTileLabel';
        label.textContent = 'Option ' + k;
        tile.appendChild(label);

        const frame = document.createElement('iframe');
        frame.className = 'agentMockupFrame';
        // Empty sandbox = maximum restriction: scripts, forms, and same-origin
        // are all off. Pure-CSS animation is unaffected.
        frame.setAttribute('sandbox', '');
        frame.setAttribute('title', 'Mockup option ' + k);
        frame.setAttribute('loading', 'lazy');
        frame.srcdoc = injectPreviewStyle(variants[k]);
        tile.appendChild(frame);

        if (row) {
            const useRow = document.createElement('div');
            useRow.className = 'agentMockupUseRow';

            const useErr = document.createElement('p');
            useErr.className = 'agentMockupUseError';
            useErr.setAttribute('role', 'alert');
            useErr.hidden = true;

            const useBtn = document.createElement('button');
            useBtn.type = 'button';
            useBtn.className = 'agentMockupUse';
            useBtn.textContent = 'use this';
            useButtons.push(useBtn);

            function useFail(message) {
                tile.classList.remove('is-selected');
                useButtons.forEach(function (b) { b.disabled = false; });
                useBtn.classList.remove('is-pending');
                useBtn.textContent = 'use this';
                useErr.textContent = message || 'Couldn’t create the entry. Try again.';
                useErr.hidden = false;
            }

            useBtn.addEventListener('click', function () {
                if (useBtn.disabled) return;
                useErr.hidden = true;
                useErr.textContent = '';
                // Enter pending: ring this tile, disable every "use this" while
                // the entry is generated.
                container.querySelectorAll('.agentMockupTile.is-selected').forEach(function (t) {
                    t.classList.remove('is-selected');
                });
                tile.classList.add('is-selected');
                useButtons.forEach(function (b) { b.disabled = true; });
                useBtn.classList.add('is-pending');
                useBtn.textContent = 'Creating entry…';

                const repo = mockupChatRepo(getSelectedProjectName());
                Promise.resolve().then(function () {
                    return chatWithWorker(
                        [{ role: 'user', content: buildMockupEntryPrompt(row.context, k, variants[k], repo) }],
                        null, null, repo,
                    );
                }).then(function (res) {
                    const draft = stripEntryFence((res && typeof res.reply === 'string') ? res.reply : '');
                    if (!draft) {
                        useFail('The reply was empty — try again.');
                        return null;
                    }
                    return Promise.resolve(listLogic.setAgentRunState(row.id, { draft: draft, state: 'drafted' }))
                        .then(function (saved) {
                            if (saved && saved.ok) {
                                // Realtime moves the card to In progress; force a
                                // refresh so the drafted row lands promptly.
                                refreshAgentQueue(getSelectedProjectName());
                                return;
                            }
                            useFail(saved && saved.error);
                        });
                }).catch(function () {
                    useFail('Couldn’t create the entry. Try again.');
                });
            });

            useRow.appendChild(useBtn);
            useRow.appendChild(useErr);
            tile.appendChild(useRow);
        }

        container.appendChild(tile);
    });
}

// Secondary content for a `needs_mockup` card. Two paths stacked top-to-bottom:
//
//   1. In-app A/B/C generation — a Generate / Regenerate control that calls the
//      chat Worker with a machine-parseable prompt, parses the reply, and
//      renders the three variants as sandboxed preview iframes right on the
//      card. This is the primary path.
//   2. A tucked "Not quite right?" fallback — the original manual hand-off,
//      unchanged: an "Open mockup" button that expands a read-only block showing
//      the *actual full prompt* to paste into Claude, with a Copy button and a
//      separate "Open Claude Design" control, plus a paste-back field that takes
//      the finished TODO.md entry, writes it to the row's `draft`, and flips the
//      row to `drafted` — where the Dispatch card already ships it.
//
// The view never writes to Supabase directly (the save routes through
// listLogic.setAgentRunState) and generation reuses the existing chat proxy
// (no Worker change). Each preview tile also carries a "use this" control that
// turns the chosen variant into the finished entry and flips the row to
// `drafted`; the fallback paste-back stays as the manual escape hatch.
function buildMockupSecondary(row) {
    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const wrap = document.createElement('div');
    wrap.className = 'agentSecondary agentMockup';

    // ── In-app A/B/C generation ──
    // Generate calls the chat Worker with buildMockupGenPrompt, parses the reply
    // into three variants, and renders them as sandboxed preview iframes.
    // Regenerate re-runs and replaces the tiles. A generation or parse failure
    // shows a non-blocking error and leaves the fallback hand-off fully usable.
    const gen = document.createElement('div');
    gen.className = 'agentMockupGen';

    const previews = document.createElement('div');
    previews.className = 'agentMockupPreviews';

    const genError = document.createElement('p');
    genError.className = 'agentMockupGenError';
    genError.setAttribute('role', 'alert');
    genError.hidden = true;

    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'agentMockupGenerate';
    genBtn.textContent = 'Generate mockups';

    // Previously-generated variants survive a realtime repaint: repaint them
    // immediately from the module-level cache and offer a Regenerate rather than
    // a bare "Generate mockups" button, so a background board change doesn't wipe
    // the user's mockups.
    const cachedVariants = _mockupVariants.get(row.id);
    if (cachedVariants) {
        renderMockupPreviews(previews, cachedVariants, row);
        genBtn.textContent = 'Regenerate';
    }

    // A generation kicked off before this render is still in flight (a realtime
    // repaint tore down the button that started it). Re-render as the disabled
    // "Generating…" state rather than a bare idle button so the user doesn't
    // click again and fire a redundant generation against a detached node.
    if (_mockupPending.has(row.id)) {
        genBtn.disabled = true;
        genBtn.classList.add('is-pending');
        genBtn.textContent = 'Generating…';
    }

    function genFail(message) {
        _mockupPending.delete(row.id);
        // A repaint detached this card while the request was in flight; the
        // visible button is a fresh node still showing "Generating…". Repaint so
        // it leaves that state (the error surfaces on the next attempt).
        if (!genBtn.isConnected) {
            paint();
            return;
        }
        genBtn.disabled = false;
        genBtn.classList.remove('is-pending');
        genBtn.textContent = previews.childNodes.length ? 'Regenerate' : 'Generate mockups';
        genError.textContent = message || 'Couldn’t generate mockups. Try again.';
        genError.hidden = false;
    }

    genBtn.addEventListener('click', function () {
        if (genBtn.disabled) return;
        genError.hidden = true;
        genError.textContent = '';
        genBtn.disabled = true;
        genBtn.classList.add('is-pending');
        genBtn.textContent = 'Generating…';
        _mockupPending.add(row.id);
        const repo = mockupChatRepo(getSelectedProjectName());
        Promise.resolve().then(function () {
            return chatWithWorker([{ role: 'user', content: buildMockupGenPrompt(ctx, repo) }], null, null, repo);
        }).then(function (res) {
            const reply = (res && typeof res.reply === 'string') ? res.reply : '';
            const variants = parseMockupVariants(reply);
            if (!variants) {
                genFail('Couldn’t read the mockups from the reply — try Regenerate, or use the fallback below.');
                return;
            }
            // Cache the parsed variants so a realtime repaint restores them.
            _mockupVariants.set(row.id, variants);
            _mockupPending.delete(row.id);
            // If a repaint detached this card mid-flight, its button is elsewhere
            // stuck on "Generating…"; repaint so the visible card renders the new
            // previews from cache. Otherwise update this (still-connected) node.
            if (!genBtn.isConnected) {
                paint();
                return;
            }
            renderMockupPreviews(previews, variants, row);
            genBtn.disabled = false;
            genBtn.classList.remove('is-pending');
            genBtn.textContent = 'Regenerate';
        }).catch(function () {
            genFail('Couldn’t generate mockups — try again, or use the fallback below.');
        });
    });

    gen.appendChild(genBtn);
    gen.appendChild(genError);
    gen.appendChild(previews);
    wrap.appendChild(gen);

    // ── Fallback hand-off ──
    // The full manual path, tucked beneath the previews as a collapsible
    // "Not quite right?" section. Nothing here changed — it just no longer sits
    // at the top of the card.
    const fallback = document.createElement('details');
    fallback.className = 'agentMockupFallback';
    const fallbackSummary = document.createElement('summary');
    fallbackSummary.className = 'agentMockupFallbackSummary';
    fallbackSummary.textContent = 'Not quite right? Hand off to Claude';
    fallback.appendChild(fallbackSummary);

    // The full assembled prompt — the same string the user pastes into Claude.
    // Built once (the context bundle is folded into it), shown verbatim in the
    // toggled block so what the user sees is exactly what they copy. Grounded at
    // the active project's linked repo so a linked repo isn't mislabeled as
    // toDoList_TOP.
    const prompt = buildMockupPrompt(ctx, mockupChatRepo(getSelectedProjectName()));

    // Open mockup: toggles the read-only prompt block open/closed. No clipboard
    // write or tab-open here — those live on the Copy button and the Open Claude
    // Design control inside the block, kept separate to avoid a focus race.
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'agentMockupOpen';
    openBtn.textContent = 'Open mockup';
    openBtn.setAttribute('aria-expanded', 'false');
    fallback.appendChild(openBtn);

    const promptWrap = document.createElement('div');
    promptWrap.className = 'agentMockupPrompt';
    promptWrap.hidden = true;

    const promptBlock = document.createElement('pre');
    promptBlock.className = 'agentDraftBlock agentMockupPromptBlock';
    promptBlock.setAttribute('tabindex', '0');
    promptBlock.setAttribute('aria-label', 'Mockup prompt');
    promptBlock.textContent = prompt;
    promptWrap.appendChild(promptBlock);

    const promptActions = document.createElement('div');
    promptActions.className = 'agentMockupPromptActions';

    // Copy: write the prompt to the clipboard and confirm via toast; a failure
    // says so rather than swallowing it. The block stays visible regardless, so
    // the user can also select-and-copy manually.
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'agentMockupCopy';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', function () {
        let copied;
        try {
            copied = navigator.clipboard.writeText(prompt);
        } catch (e) {
            copied = Promise.reject(e);
        }
        Promise.resolve(copied).then(function () {
            showInjectToast('Mockup prompt copied — paste it into Claude or Claude Design.');
        }, function () {
            showInjectToast('Couldn’t copy the prompt — select and copy it manually.', 'error');
        });
    });
    promptActions.appendChild(copyBtn);

    // Open Claude Design: a separate, deliberate tap that opens Claude in a new
    // tab — decoupled from Copy so there's no focus race between the two.
    const designBtn = document.createElement('button');
    designBtn.type = 'button';
    designBtn.className = 'agentMockupDesignLink';
    designBtn.textContent = 'Open Claude Design';
    designBtn.addEventListener('click', function () {
        try { window.open('https://claude.ai/new', '_blank'); } catch (e) { /* popup blocked */ }
    });
    promptActions.appendChild(designBtn);

    promptWrap.appendChild(promptActions);
    fallback.appendChild(promptWrap);

    openBtn.addEventListener('click', function () {
        const open = promptWrap.hidden;
        promptWrap.hidden = !open;
        openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Paste-back field: the finished TODO.md entry. Saving writes it to the
    // row's `draft` and flips the row to `drafted`. Multi-line by nature, so
    // Enter inserts newlines (no Enter-to-submit). 16px avoids iOS focus zoom.
    const input = document.createElement('textarea');
    input.className = 'agentMockupPaste';
    input.rows = 4;
    input.placeholder = 'Paste the finished TODO.md entry…';
    input.setAttribute('aria-label', 'Finished entry');
    fallback.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'agentMockupActions';

    const errorEl = document.createElement('p');
    errorEl.className = 'agentMockupError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    actions.appendChild(errorEl);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'agentMockupSave';
    save.textContent = 'Save draft';
    actions.appendChild(save);
    fallback.appendChild(actions);

    function fail(message) {
        save.disabled = false;
        input.disabled = false;
        save.classList.remove('is-pending');
        save.textContent = 'Save draft';
        errorEl.textContent = message || 'Could not save. Try again.';
        errorEl.hidden = false;
    }

    // Save the pasted entry: empty/whitespace-only input is ignored (no write).
    // While the write is in flight the input and button are disabled; on success
    // the board refreshes (the realtime subscription moves the card to In
    // progress / drafted); on failure the controls re-enable and an error shows.
    save.addEventListener('click', function () {
        if (save.disabled) return;
        const text = (input.value || '').trim();
        if (!text) return;
        errorEl.hidden = true;
        errorEl.textContent = '';
        save.disabled = true;
        input.disabled = true;
        save.classList.add('is-pending');
        save.textContent = 'Saving…';
        Promise.resolve(listLogic.setAgentRunState(row.id, { draft: text, state: 'drafted' })).then(function (res) {
            if (res && res.ok) {
                refreshAgentQueue(getSelectedProjectName());
                return;
            }
            fail(res && res.error);
        }).catch(function () {
            fail('Could not save. Try again.');
        });
    });

    wrap.appendChild(fallback);
    return wrap;
}

// The dispatch target (repo/filePath) for the active project's runs: the active
// project's linked inject target (the same routing the inject/run path uses), or
// null when the project has no target — in which case the Worker falls back to
// its default repo. Mirrors resolveReadTarget so triage, dispatch, poller
// resume, and revert all route to the project's linked repo.
function resolveDispatchTarget() {
    const projectName = getSelectedProjectName();
    if (!projectName) return null;
    const targetId = listLogic.getProjectTargetId(projectName);
    return targetId ? findTargetById(targetId) : null;
}

// The state of the cached row with this id (or null when absent). Used by the
// poller to avoid re-writing a state that hasn't actually changed on every tick.
function currentRowState(rowId) {
    const rows = Array.isArray(_rows) ? _rows : [];
    const r = rows.find(function (x) { return x && x.id === rowId; });
    return r ? r.state : null;
}

// Ship a drafted row's entry through the run pipeline: mint an id, embed the
// marker, inject the entry into TODO.md, then dispatch claude-run.yml in entry
// mode against that id. On success persists the ids + `dispatched` state (so the
// realtime subscription moves the card and a reopen can resume polling) and
// starts a status poller. Returns { ok } / { ok:false, error } so the button can
// re-enable and surface a non-blocking failure, leaving the row `drafted`.
//
// `existingEntryId` powers the Stuck-card Retry: passing the row's stored
// entry_id reuses the marker already in TODO.md, so injectEntry dedup-skips
// instead of appending a second copy of the entry. When omitted (the normal
// Dispatch path) a fresh id is minted.
async function dispatchDraft(row, draftText, existingEntryId) {
    const rowId = row.id;
    const target = resolveDispatchTarget();

    const res = await shipEntryForTodo({
        todoId: row.todo_id,
        entryText: draftText,
        target: target,
        existingEntryId: existingEntryId,
    });
    if (!res || !res.ok) {
        return { ok: false, error: res.error };
    }

    const patch = {
        state: 'dispatched',
        entry_id: res.entryId,
        correlation_id: res.correlationId,
    };
    if (res.runId != null) patch.run_id = res.runId;
    await listLogic.setAgentRunState(rowId, patch);

    startDispatchPoller(rowId, res.entryId, res.correlationId, target);
    // Refresh so the card leaves Drafted even where realtime isn't observed.
    refreshAgentQueue(getSelectedProjectName());
    return { ok: true };
}

// Fetch a completed run's closing summary (the agent's verdict) to surface on a
// no_change / failed card. Degrades to '' on any failure so the card falls back
// to a friendly default line. The run is keyed by run id when known, else the
// correlation id (the Worker resolves either), mirroring the Runs tab.
async function fetchClosingSummary(runId, correlationId, target) {
    const key = (runId != null && runId !== '') ? runId : correlationId;
    try {
        const res = await fetchRunResult(key, target || null);
        if (res && res.ok && typeof res.result === 'string') return res.result.trim();
    } catch (e) { /* degrade to no summary */ }
    return '';
}

// The read target (repo/filePath) for the active project's TODO.md. Mirrors the
// TODO.md viewer's resolution — the project's configured inject target — so the
// checkbox read hits the same repo the runs land in. Returns null when the
// project has no routing, which degrades the checkbox settle to poll-only.
function resolveReadTarget() {
    const projectName = getSelectedProjectName();
    if (!projectName) return null;
    const targetId = listLogic.getProjectTargetId(projectName);
    return targetId ? findTargetById(targetId) : null;
}

// Return the raw text under the first top-level `## Requirements` header, up to
// the next `## ` header or EOF, or null when there's no such header. Level-3+
// sub-headers (`### …`) inside the section are kept (the `^## ` boundary only
// matches level-2 headers). Used to classify assignment.md content.
function extractRequirementsSection(content) {
    const lines = content.split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^##\s+requirements\s*$/i.test(lines[i].trim())) { start = i + 1; break; }
    }
    if (start === -1) return null;
    const out = [];
    for (let i = start; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) break;
        out.push(lines[i]);
    }
    return out.join('\n');
}

// Classify assignment.md content into the card's three states:
//   'absent'   — no file / empty content: render no card.
//   'unfilled' — no `## Requirements` header, or the section holds only HTML
//                comments / whitespace (the seeded hint): render the invite.
//   'filled'   — `## Requirements` has real content: render the summary.
function classifyAssignment(content) {
    if (typeof content !== 'string' || !content.trim()) return 'absent';
    const req = extractRequirementsSection(content);
    if (req === null) return 'unfilled';
    const stripped = req.replace(/<!--[\s\S]*?-->/g, '').trim();
    return stripped ? 'filled' : 'unfilled';
}

// Build the assignment descriptor the card renders from: `{ state }` for absent
// / unfilled, and for filled the summary — the first non-comment requirement
// line as the title, plus a word count over the comment-stripped document and a
// section count of its `## ` headers.
function describeAssignment(content) {
    const state = classifyAssignment(content);
    if (state !== 'filled') return { state: state };
    const req = extractRequirementsSection(content) || '';
    const firstLine = req.replace(/<!--[\s\S]*?-->/g, '')
        .split('\n').map(function (l) { return l.trim(); })
        .find(function (l) { return l.length > 0; }) || 'Assignment';
    const cleaned = content.replace(/<!--[\s\S]*?-->/g, '');
    const words = (cleaned.match(/\S+/g) || []).length;
    const sections = cleaned.split('\n').filter(function (l) {
        return /^##\s+/.test(l);
    }).length;
    return { state: 'filled', title: firstLine, words: words, sections: sections };
}

// Fetch the active project's assignment.md once and repaint the board with the
// classified result. Records `_assignmentProject` so mount + project switch
// don't double-fetch (see subscribeAgentView / renderAgentView). A no-target
// project resolves synchronously to absent (no card) without a Worker call.
function refreshAssignment(target) {
    const projectName = getSelectedProjectName();
    _assignmentProject = projectName;
    if (!target) {
        _assignment = { state: 'absent' };
        return;
    }
    readAssignmentFromWorker(target).then(function (res) {
        // Guard against a project switch mid-fetch: only the still-selected
        // project's read may populate the cache and repaint.
        if (getSelectedProjectName() !== projectName) return;
        _assignment = describeAssignment(res && res.ok ? res.content : null);
        paint();
    });
}

// The entry's checkbox state within a TODO.md body, keyed off its id marker:
// 'checked' when the task line is `- [x]`, 'unchecked' when `- [ ]`, or null
// when the marker isn't present. Mirrors the block walk extractEntryBlock (and
// the Worker's fetchEntryFromTodoMd) use: find the marker line, walk back to the
// nearest preceding checkbox line, and read its box.
function entryCheckboxState(content, entryId) {
    if (typeof content !== 'string' || !entryId) return null;
    const lines = content.split('\n');
    const checkboxRe = /^\s*- \[[ xX]\]/;
    let markerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('<!-- id: ' + entryId) !== -1) { markerIdx = i; break; }
    }
    if (markerIdx === -1) return null;
    let start = markerIdx;
    while (start >= 0 && !checkboxRe.test(lines[start])) start--;
    if (start < 0) return null;
    return /^\s*- \[[xX]\]/.test(lines[start]) ? 'checked' : 'unchecked';
}

// Whether a completed dispatched run actually shipped. The primary, lag-free
// signal is the entry's checkbox on main: the routine marks its TODO.md entry
// `- [x]` in the same merge that lands the change, so a checked box is positive
// proof it shipped where GitHub's closed-PR index (resolveEntryByMarker) still
// lags a fresh merge. Only when TODO.md can't be read — or its marker is gone —
// do we fall back to the merged-PR marker search, so a transient read failure
// never mislabels a real ship as no_change.
async function didEntryShip(entryId) {
    try {
        const read = await readTodoMdFromWorker(resolveReadTarget());
        if (read && read.ok !== false && typeof read.content === 'string') {
            const box = entryCheckboxState(read.content, entryId);
            if (box === 'checked') return true;
            if (box === 'unchecked') return false;
        }
    } catch (e) { /* fall through to the PR-marker search */ }
    try {
        const resolved = await resolveEntryByMarker(entryId);
        return !!(resolved && resolved.ok && resolved.found === true && resolved.merge_commit_sha);
    } catch (e) {
        return false;
    }
}

// Best-effort PR link for a shipped entry. Resolving the marker to a closed PR
// lags GitHub's index, so this is only for the Shipped card's link — never gate
// the shipped transition on it; the link fills in on a later poll if it's not
// ready yet. Returns { pr_url, pr_number } with empty/undefined fields on miss.
async function bestEffortPrLink(entryId) {
    try {
        const resolved = await resolveEntryByMarker(entryId);
        if (resolved && resolved.ok && resolved.found === true) {
            return {
                pr_url: resolved.pr_url || resolved.html_url || '',
                pr_number: resolved.pr_number != null ? resolved.pr_number : undefined,
            };
        }
    } catch (e) { /* link fills in on a later poll */ }
    return { pr_url: '', pr_number: undefined };
}

// Persist a row to `shipped`, attaching the run id and a best-effort PR link.
// The link is resolved without blocking the ship: a missing link still ships.
async function settleShipped(rowId, entryId, runId) {
    const patch = { state: 'shipped' };
    if (runId != null) patch.run_id = runId;
    const link = await bestEffortPrLink(entryId);
    if (link.pr_url) patch.pr_url = link.pr_url;
    if (link.pr_number != null) patch.pr_number = link.pr_number;
    await listLogic.setAgentRunState(rowId, patch);
}

// Reconcile a completed run into a terminal state. A green conclusion alone
// isn't proof of a ship — the routine can exit clean having merged nothing — so
// consult the entry's checkbox on main (didEntryShip): checked → shipped + a
// best-effort PR link; still unchecked → a no-change run whose closing summary
// we surface (→ Stuck).
async function reconcileShipped(rowId, entryId, correlationId, runId, target) {
    if (await didEntryShip(entryId)) {
        await settleShipped(rowId, entryId, runId);
    } else {
        const summary = await fetchClosingSummary(runId, correlationId, target);
        await listLogic.setAgentRunState(rowId, {
            state: 'no_change',
            failure_reason: summary || 'The run finished without merging any changes.',
            run_id: runId,
        });
    }
    refreshAgentQueue(getSelectedProjectName());
}

// One poll tick for a dispatched run. Mirrors the Runs-tab poller: in-progress
// reflects queued/running; completed reconciles success against the merged-PR
// proof, flips only a recognized failure conclusion to failed, and leaves any
// other completed conclusion in-progress rather than asserting failure. Past the
// give-up window it stops watching and leaves the last-known state.
async function pollDispatchOnce(rowId, entryId, correlationId, target, startedAt) {
    if (Date.now() - startedAt >= DISPATCH_GIVE_UP_MS) {
        stopDispatchPoller(rowId);
        return;
    }
    const res = await pollRunStatus({ correlationId: correlationId, target: target || null });
    if (!res || res.ok === false) return; // transient — keep polling
    if (res.found === false) return; // run not surfaced yet — stay dispatched
    if (res.status === 'completed') {
        if (res.conclusion === 'success') {
            stopDispatchPoller(rowId);
            await reconcileShipped(rowId, entryId, correlationId, res.runId, target);
            return;
        }
        if (FAILURE_CONCLUSIONS.indexOf(res.conclusion) !== -1) {
            stopDispatchPoller(rowId);
            const summary = await fetchClosingSummary(res.runId, correlationId, target);
            await listLogic.setAgentRunState(rowId, {
                state: 'failed',
                failure_reason: summary || 'The run failed.',
                run_id: res.runId,
            });
            refreshAgentQueue(getSelectedProjectName());
            return;
        }
        // Neutral / skipped / no conclusion: not a positive failure — keep
        // polling; the row stays in-progress.
        return;
    }
    const desired = res.status === 'queued' ? 'dispatched' : 'running';
    if (currentRowState(rowId) !== desired) {
        await listLogic.setAgentRunState(rowId, { state: desired });
        refreshAgentQueue(getSelectedProjectName());
    }
}

// Start (or no-op if already running) a status poller for a dispatched row.
// Fires an immediate tick, then on the poll cadence, until a terminal outcome
// or the give-up window. Keyed by row id so a re-render never double-arms it.
function startDispatchPoller(rowId, entryId, correlationId, target) {
    if (!rowId || !entryId || !correlationId) return;
    if (_dispatchPollers[rowId]) return;
    const startedAt = Date.now();
    _dispatchPollers[rowId] = setInterval(function () {
        pollDispatchOnce(rowId, entryId, correlationId, target, startedAt);
    }, DISPATCH_POLL_MS);
    pollDispatchOnce(rowId, entryId, correlationId, target, startedAt);
}

// Stop and forget a row's poller. Idempotent.
function stopDispatchPoller(rowId) {
    if (_dispatchPollers[rowId]) {
        clearInterval(_dispatchPollers[rowId]);
        delete _dispatchPollers[rowId];
    }
}

// Terminal states a dispatched row can settle into — once a row reaches one of
// these there is nothing left to poll.
const TERMINAL_STATES = ['shipped', 'failed', 'no_change'];

// Reconcile the live poller set against the currently rendered rows: stop any
// poller whose row has reached a terminal state (or vanished), and arm one for
// each dispatched/running row that still carries its correlation + entry ids
// (so a tab reopen resumes polling a run dispatched earlier). A row that reads
// transiently as `drafted` while its dispatch write propagates does NOT stop an
// already-running poller — only a terminal/absent row does — so the poll started
// at dispatch time isn't torn down by a stale read a beat later. Called from
// paint.
function syncDispatchPollers(rows) {
    const active = Array.isArray(rows) ? rows : [];
    const byId = {};
    active.forEach(function (r) { if (r && r.id) byId[r.id] = r; });
    Object.keys(_dispatchPollers).forEach(function (rowId) {
        const r = byId[rowId];
        if (!r || TERMINAL_STATES.indexOf(r.state) !== -1) {
            stopDispatchPoller(rowId);
        }
    });
    active.forEach(function (r) {
        if (!r || (r.state !== 'dispatched' && r.state !== 'running')) return;
        if (r.correlation_id && r.entry_id) {
            startDispatchPoller(r.id, r.entry_id, r.correlation_id, resolveDispatchTarget());
        }
    });
}

// Mount-time reconcile: settle any dispatched/running row whose entry is already
// checked off on main. A run that completed while the tab was closed — possibly
// after ageing out of the status window, so its poller can never observe the
// completion — still settles to shipped here from the lag-free checkbox signal,
// with no poll required. Rows still unchecked are left to their pollers (armed
// by syncDispatchPollers in paint), since an unchecked in-flight row may simply
// still be running — only a *completed* poll may flip it to no_change. Reads
// TODO.md once for the whole batch, and no-ops entirely when nothing is
// in-flight, so it's cheap on the common (nothing-dispatched) mount.
async function settleInFlightRows(rows) {
    const inFlight = (Array.isArray(rows) ? rows : []).filter(function (r) {
        return r && (r.state === 'dispatched' || r.state === 'running') && r.entry_id;
    });
    if (!inFlight.length) return;

    let content = null;
    try {
        const read = await readTodoMdFromWorker(resolveReadTarget());
        if (read && read.ok !== false && typeof read.content === 'string') content = read.content;
    } catch (e) { /* no read → leave every row to its poller */ }
    if (content == null) return;

    let settledAny = false;
    for (let i = 0; i < inFlight.length; i++) {
        const r = inFlight[i];
        // A poller may have settled this row in the interim — never re-settle a
        // row that's already reached a terminal state.
        if (TERMINAL_STATES.indexOf(currentRowState(r.id)) !== -1) continue;
        if (entryCheckboxState(content, r.entry_id) === 'checked') {
            stopDispatchPoller(r.id);
            await settleShipped(r.id, r.entry_id, r.run_id);
            settledAny = true;
        }
    }
    if (settledAny) refreshAgentQueue(getSelectedProjectName());
}

// One card for a single queue row: title, a state chip, and state-appropriate
// secondary content. Rows in the thin states (queued / running) render as a
// compact single-line row instead of a full card.
function buildCard(row) {
    const thin = THIN_STATES.indexOf(row.state) !== -1;
    const card = document.createElement('div');
    card.className = 'agentCard' + (thin ? ' agentCard--thin' : '');
    card.setAttribute('data-state', row.state || '');

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

// A file-text glyph for the assignment card. DOM-built like the other glyphs
// (no new asset, no icon library) and theme-correct via currentColor.
function buildFileTextIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    [
        ['path', { d: 'M14 3H7a2 2 0 0 0 -2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2V8z' }],
        ['path', { d: 'M14 3v5h5' }],
        ['line', { x1: '9', y1: '13', x2: '15', y2: '13' }],
        ['line', { x1: '9', y1: '17', x2: '13', y2: '17' }],
    ].forEach(function (spec) {
        const el = document.createElementNS(ns, spec[0]);
        Object.keys(spec[1]).forEach(function (k) { el.setAttribute(k, spec[1][k]); });
        svg.appendChild(el);
    });
    return svg;
}

// The assignment-context card mounted at the top of the AGENT board, rendered
// from the `_assignment` cache. Display-only in this slice — no click handlers,
// no tap-to-edit. Returns null for the absent state (no file / empty), so the
// caller appends nothing; the unfilled state renders an amber "add assignment
// context" invite, and the filled state renders a one-line summary with word +
// section counts.
function buildAssignmentCard() {
    const a = _assignment;
    if (!a || a.state === 'absent') return null;

    const card = document.createElement('div');
    card.className = 'agentAssignmentCard agentAssignmentCard--' + a.state;

    const glyph = document.createElement('span');
    glyph.className = 'agentAssignmentGlyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.appendChild(buildFileTextIcon());
    card.appendChild(glyph);

    const body = document.createElement('div');
    body.className = 'agentAssignmentBody';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'agentAssignmentEyebrow';
    eyebrow.textContent = 'ASSIGNMENT';
    body.appendChild(eyebrow);

    const title = document.createElement('div');
    title.className = 'agentAssignmentTitle';
    title.textContent = a.state === 'filled'
        ? a.title
        : 'No spec — add assignment context';
    body.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'agentAssignmentMeta';
    meta.textContent = a.state === 'filled'
        ? a.words + ' words · ' + a.sections + ' sections'
        : 'Tap to add';
    body.appendChild(meta);

    card.appendChild(body);
    return card;
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

    const rows = Array.isArray(_rows) ? _rows : [];
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
    // dot) when a triage sweep is in flight (tracked live via the Worker's
    // triage active_runs probe) OR any row is running a ship run
    // (dispatched/running), else muted "Idle". Triage sweeps aren't captured by
    // any lasting row state, so `_sweepActive` — not the row counts — carries
    // that signal.
    const controls = document.createElement('div');
    controls.className = 'agentHeaderControls';

    const shipInFlight = rows.some(function (r) {
        return r && (r.state === 'dispatched' || r.state === 'running');
    });
    const working = _sweepActive || shipInFlight;
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

    // Keep the dispatch pollers in step with what's on the board: stop pollers
    // for rows that have left the in-flight states and resume one for any
    // dispatched/running row carrying its ids (e.g. after a tab reopen).
    syncDispatchPollers(rows);
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
}

// ── AGENT-TAB AVAILABILITY GATE ──
// A project with no routed repo can't draft, dispatch, or ship agent work —
// there's nowhere to inject the TODO.md entry. The two AGENT tab entry points
// (desktop pill #viewPillAgent, mobile tab #mobileTabAgent) stay fully tappable on
// such a project, but carry a small hollow "no-repo" marker; opening the tab
// renders an in-view unavailable message instead of a live board. A single
// `agentUnavailable` body flag — toggled from the same project-switch hook points
// that call syncClaudeSheetForProject — drives the marker's CSS and the paint()
// branch. The flag clears the moment a repo-backed project becomes active. The
// gate is the SAME one the sidebar thunderbolt uses: inject configured globally
// AND this project carries a routed inject target.
export const AGENT_UNAVAILABLE_MSG =
    'Agent unavailable here — no repo configured for this project';

function applyAgentAvailability(hasRepo) {
    // Just toggle the body flag — the CSS keys the hollow "no-repo" marker on both
    // AGENT entry points off it. The tab stays fully tappable (no aria-disabled,
    // no swapped title); opening it renders the unavailable message in-view.
    document.body.classList.toggle('agentUnavailable', !hasRepo);
}

// Recompute the AGENT tab's availability for the given project and apply it to
// both entry points. Called from main.js's project-switch hooks alongside
// syncClaudeSheetForProject so both gates derive from one source of truth and
// clear together. Returns hasRepo so the caller can bail off a now-dead board.
export function syncAgentAvailabilityForProject(projectName) {
    const hasRepo = isInjectConfigured()
        && !!listLogic.getProjectTargetId(projectName);
    applyAgentAvailability(hasRepo);
    // Recompute the nav "agent working" dot for the newly selected project right
    // now. The working signal pollAgentWorkingWatch() computes is scoped to the
    // selected project, but the watch otherwise only ticks on its 15s interval or
    // an agent_queue realtime push — never on a project switch. Without this call
    // the dot hangs on the previous project's state for up to WORKING_WATCH_POLL_MS
    // after switching. This is the documented project-switch hook, so recompute here.
    pollAgentWorkingWatch();
    return hasRepo;
}

// True while the AGENT tab is gated off for the active project. paint() consults
// this to render the in-view unavailable message instead of the queue board.
export function isAgentUnavailable() {
    return document.body.classList.contains('agentUnavailable');
}

// Render the AGENT view for the currently selected project. Safe to call
// before component() has built the shell (a missing #agentView short-circuits
// inside paint()). Repaints from the cached rows immediately, and — when the
// selected project has changed since the last load — kicks off a fresh
// project-scoped fetch that repaints again on resolve.
export function renderAgentView() {
    const projectName = getSelectedProjectName();
    if (projectName !== _loadedProjectName) {
        _rows = [];
        // Reset the assignment cache alongside _rows and re-read it for the new
        // project (fetches once; a no-target project resolves to absent).
        _assignment = null;
        refreshAssignment(resolveReadTarget());
        // Project switch: settle any dispatched/running rows against main once
        // the new project's queue loads (a run may have shipped while away).
        refreshAgentQueue(projectName, { settle: true });
        return;
    }
    paint();
}

// Open the realtime subscription on agent_queue and load the current project's
// rows. The channel is user-scoped (RLS narrows it to the signed-in user's
// rows); each push simply re-scopes and reloads the active project's rows.
// Idempotent — a second call while a channel is live only refreshes.
export function subscribeAgentView() {
    if (!_channel && supabase && typeof supabase.channel === 'function') {
        try {
            _channel = supabase
                .channel('public:agent_queue')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'agent_queue' },
                    function () { refreshAgentQueue(getSelectedProjectName()); })
                .subscribe();
        } catch (e) {
            _channel = null;
        }
    }
    // Mount: load the queue and settle any dispatched/running rows that already
    // shipped on main while the tab was closed (resume-poll the rest via paint).
    refreshAgentQueue(getSelectedProjectName(), { settle: true });
    // Read the assignment card once for this project unless renderAgentView's
    // project-switch path already fetched it (guarded so we don't double-read).
    if (_assignmentProject !== getSelectedProjectName()) {
        refreshAssignment(resolveReadTarget());
    }
    // Seed the status pill from the real triage-run state: a one-shot check so a
    // sweep already running (e.g. started on another device) shows Working here.
    seedSweepState();
}

// Tear down the realtime subscription on view exit so a backgrounded board
// doesn't hold an open channel. Idempotent and safe to call when no channel
// is open.
export function unsubscribeAgentView() {
    if (_channel && supabase && typeof supabase.removeChannel === 'function') {
        try { supabase.removeChannel(_channel); } catch (e) { /* ignore */ }
    }
    _channel = null;
    // Stop every in-flight dispatch poller — a backgrounded board shouldn't keep
    // polling. A reopen re-arms them from paint() via syncDispatchPollers.
    Object.keys(_dispatchPollers).forEach(stopDispatchPoller);
    // Stop the triage-sweep poller too; a reopen re-seeds it via seedSweepState.
    stopSweepTracking();
}

// ── PERSISTENT AGENT-WORKING WATCH ──
// A lightweight, mount-INDEPENDENT watch on whether the agent is actively
// working — a triage sweep in flight, or a ship run dispatched/running for the
// selected project. The board subscription above is torn down by
// unsubscribeAgentView() on tab-exit (a backgrounded board holds no open
// socket), which also clears `_rows` and forces `_sweepActive` false via
// stopSweepTracking — so the header pill's working signal goes dark the instant
// you leave the Agent tab, exactly the context the nav "working" dot exists to
// serve. This watch is therefore started once at app init and NEVER torn down.
// It carries ONLY the working signal: its own minimal agent_queue realtime
// subscription (separate from the board channel, to catch dispatched/running
// transitions) plus a slow triage active-runs probe. It deliberately does NOT
// keep the board subscription or the dispatch pollers alive off-tab, and never
// rebuilds the board — it only toggles a `body.agentWorking` class the nav CSS
// keys the dot off, mirroring the `agentUnavailable` body-flag pattern.
let _workingWatchStarted = false;
let _workingWatchChannel = null;
let _workingWatchPoller = null;
let _workingWatchState = false;
// The watch's own view of a locally-seeded triage sweep, independent of the
// mounted board's `_sweepActive`/`_sweepSeenActive` (which are cleared on tab
// exit). Seeded by startSweepTracking the instant a sweep dispatches so the nav
// dot lights synchronously, then settled by the watch's poll: held true through
// the registration window, and cleared once the probe has confirmed the run in
// flight and then seen it gone (seen-active-then-gone), or once the grace / hard
// cap elapses — mirroring pollSweepOnce's grace semantics so the optimistic seed
// doesn't flicker off on the first pre-registration tick.
let _workingWatchSweepSeeded = false;
let _workingWatchSweepSeenActive = false;
let _workingWatchSweepGraceDeadline = 0;
let _workingWatchSweepHardDeadline = 0;

// Background probe cadence for the persistent working watch. Slower than the
// mounted sweep poller (SWEEP_POLL_MS) — this only drives a cosmetic nav dot, so
// a gentle tick keeps Worker load low while still catching a triage sweep or a
// project switch that no realtime push covers.
const WORKING_WATCH_POLL_MS = 15000;

// Toggle body.agentWorking to reflect the computed working signal, but only when
// it actually changes so the class isn't churned every tick. No-op before
// document.body exists.
function setAgentWorkingClass(working) {
    working = !!working;
    if (working === _workingWatchState) return;
    _workingWatchState = working;
    if (document.body) document.body.classList.toggle('agentWorking', working);
}

// Seed the watch with a just-dispatched triage sweep: arm the grace / hard-cap
// deadlines and light the nav dot immediately, so it lights from dispatch time
// rather than from the first probe that observes the registered run. Called from
// startSweepTracking (the shared chokepoint for local dispatch and the
// cross-device mount seed). `alreadyConfirmed` marks the mount seed, whose fetch
// already saw the run in flight, so the seen-active-then-gone settle applies at
// once instead of waiting out the grace window.
function seedWorkingWatchSweep(alreadyConfirmed) {
    const now = Date.now();
    _workingWatchSweepSeeded = true;
    _workingWatchSweepSeenActive = !!alreadyConfirmed;
    _workingWatchSweepGraceDeadline = now + SWEEP_GRACE_MS;
    _workingWatchSweepHardDeadline = now + SWEEP_HARD_CAP_MS;
    setAgentWorkingClass(true);
}

// Drop the watch's seeded-sweep state. Called when a dispatch fails (no run will
// register) so the seed can't hold the dot lit through the grace window, and
// from the watch's own settle logic once a sweep is confirmed finished.
function clearWorkingWatchSweepSeed() {
    _workingWatchSweepSeeded = false;
    _workingWatchSweepSeenActive = false;
    _workingWatchSweepGraceDeadline = 0;
    _workingWatchSweepHardDeadline = 0;
}

// Resolve the sweep component of the working signal from the latest probe result
// plus any local seed. A live probe (`active:true`) always means Working and
// promotes a seed to seen-active. With the probe quiet, a seed still holds the
// dot lit through the registration window and settles it only once the run has
// been seen active and then gone, or the grace / hard cap elapses — the same
// arc pollSweepOnce uses for the mounted pill. Without a seed the probe alone
// decides (e.g. a sweep started on another device that this client never seeded).
function resolveWatchSweepWorking(probeActive) {
    if (probeActive) {
        if (_workingWatchSweepSeeded) _workingWatchSweepSeenActive = true;
        return true;
    }
    if (!_workingWatchSweepSeeded) return false;
    const now = Date.now();
    if (now >= _workingWatchSweepHardDeadline) { clearWorkingWatchSweepSeed(); return false; }
    // Confirmed in flight and now gone → finished.
    if (_workingWatchSweepSeenActive) { clearWorkingWatchSweepSeed(); return false; }
    // Never registered within the grace window → give up.
    if (now >= _workingWatchSweepGraceDeadline) { clearWorkingWatchSweepSeed(); return false; }
    // Still inside the registration window → hold the dot lit.
    return true;
}

// One watch tick: compute `working` = a triage sweep in flight for the selected
// project OR any dispatched/running row for the selected project — the same
// predicate the header pill uses (refreshStatusPill), but resolved independently
// so it holds off-tab where `_rows` / `_sweepActive` are cleared. Both halves are
// scoped to the selected project: the ship half reads its dispatched/running
// rows, and the sweep half gates the repo-wide triage active-runs probe on the
// project actually owning an in-flight 'triaging' row (see sweepProbe). The sweep
// component then folds the raw probe with any local seed via
// resolveWatchSweepWorking, so a just-dispatched sweep stays lit through the
// registration window instead of blinking dark until the probe first observes
// the registered run. Both probes degrade to false on any error, and skip
// entirely when there is no selected project or no routed target, so a pre-auth
// or repo-less state is a cheap no-op (a local seed is still honored — the probe
// simply resolves false).
function pollAgentWorkingWatch() {
    const projectName = getSelectedProjectName();
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    const target = resolveDispatchTarget();

    const shipProbe = projectId
        ? fetchQueueRows(projectId).then(function (rows) {
            return (Array.isArray(rows) ? rows : []).some(function (r) {
                return r && (r.state === 'dispatched' || r.state === 'running');
            });
        }).catch(function () { return false; })
        : Promise.resolve(false);

    // Scope the sweep half to the selected project the same way shipProbe scopes
    // the ship half. The repo-wide triage active-runs probe only reports whether
    // the TARGET REPO has a claude-triage.yml run in flight, with no project
    // attribution — on its own it lights the dot for every project sharing that
    // repo (or the null default target). Gate it on the project owning an
    // in-flight 'triaging' agent_queue row (the state flagTaskForAgent writes and
    // reconcileStuckTriaging later clears), so the dot lights only while THIS
    // project has a sweep actually processing its flagged tasks.
    const sweepProbe = (target && projectId)
        ? Promise.all([
            Promise.resolve(fetchActiveRuns(target, 'triage')),
            fetchQueueRows(projectId),
        ]).then(function (parts) {
            const repoActive = !!(parts[0] && parts[0].ok !== false && parts[0].active);
            const projectTriaging = (Array.isArray(parts[1]) ? parts[1] : []).some(function (r) {
                return r && r.state === 'triaging';
            });
            return repoActive && projectTriaging;
        }).catch(function () { return false; })
        : Promise.resolve(false);

    return Promise.all([shipProbe, sweepProbe]).then(function (parts) {
        const sweepWorking = resolveWatchSweepWorking(parts[1]);
        setAgentWorkingClass(parts[0] || sweepWorking);
    });
}

// Start the persistent working watch. Idempotent — guarded against double-init
// (app-init code can evaluate more than once), so a second call is a no-op
// rather than a second channel plus a second poller. Opens its own agent_queue
// realtime channel (each push re-evaluates the working signal) and a slow
// background poller, then kicks one immediate tick.
export function startAgentWorkingWatch() {
    if (_workingWatchStarted) return;
    _workingWatchStarted = true;
    if (!_workingWatchChannel && supabase && typeof supabase.channel === 'function') {
        try {
            _workingWatchChannel = supabase
                .channel('agent-working-watch:agent_queue')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'agent_queue' },
                    function () { pollAgentWorkingWatch(); })
                .subscribe();
        } catch (e) {
            _workingWatchChannel = null;
        }
    }
    if (!_workingWatchPoller) {
        _workingWatchPoller = setInterval(pollAgentWorkingWatch, WORKING_WATCH_POLL_MS);
    }
    pollAgentWorkingWatch();
}
