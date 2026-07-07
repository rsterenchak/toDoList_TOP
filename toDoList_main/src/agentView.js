import { supabase } from './supabaseClient.js';
import { listLogic } from './listLogic.js';
import {
    mintEntryId,
    embedEntryMarker,
    injectEntry,
    dispatchRun,
    dispatchTriage,
    pollRunStatus,
    resolveEntryByMarker,
    fetchRunResult,
    fetchActiveRuns,
    readTodoMdFromWorker,
    findTargetById,
    showInjectToast,
    isInjectConfigured,
} from './inject.js';

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

// Before dispatching a freshly-injected entry we make a best-effort confirmation
// that it's visible on main: GitHub's workflow_dispatch can resolve `main` to a
// tip that predates the inject commit (dispatch-after-push race), so a run fired
// the instant inject returns can check out a stale TODO.md, miss the marker, and
// no-op. Poll the on-main read for the entry's id marker with a short backoff —
// up to ~8 attempts ~1s apart — as a head start, dispatching immediately once
// the marker appears. This is NOT a gate: GitHub's write→read propagation is
// variable and can lag past the window even though inject committed, and the
// run's own runner-boot latency (tens of seconds) reliably exceeds propagation,
// so if the marker doesn't surface in time we dispatch anyway rather than block
// a legitimate run. A rare genuine race then no-changes and self-heals on Retry.
const ENTRY_VISIBLE_ATTEMPTS = 8;
const ENTRY_VISIBLE_DELAY_MS = 1000;

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
// Active dispatch-status pollers, keyed by agent_queue row id → interval handle.
// Module-level so a poller survives re-renders (a realtime push repaints the
// board without tearing down an in-flight poll) and so paint() can re-arm one
// for a dispatched/running row after a tab reopen.
const _dispatchPollers = {};
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
        .then(function () { return dispatchTriage(projectId, mintEntryId()); })
        .then(
            function (res) {
                _triageInFlight = false;
                // If the dispatch itself failed, clear the optimistic Working
                // state so the pill doesn't falsely report a sweep in flight.
                if (res && res.ok === false) stopSweepTracking();
                return res;
            },
            function () { _triageInFlight = false; stopSweepTracking(); return { ok: false }; }
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
// registration lag before the run appears.
function startSweepTracking(alreadyConfirmed) {
    const now = Date.now();
    _sweepActive = true;
    _sweepSeenActive = !!alreadyConfirmed;
    _sweepGraceDeadline = now + SWEEP_GRACE_MS;
    _sweepHardDeadline = now + SWEEP_HARD_CAP_MS;
    if (!_sweepPoller) {
        _sweepPoller = setInterval(pollSweepOnce, SWEEP_POLL_MS);
    }
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
        stopSweepTracking();
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
            stopSweepTracking();
        }
    });
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

// State-appropriate secondary content under a card's title: the pending
// question for needs_words, the failure reason for a stuck row, PR/queued
// status for in-progress work. Returns null when there's nothing to show.
function buildSecondary(row) {
    const state = row.state;
    if (state === 'needs_words') {
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
        wrap.appendChild(input);

        const actions = document.createElement('div');
        actions.className = 'agentAnswerActions';

        const errorEl = document.createElement('p');
        errorEl.className = 'agentAnswerError';
        errorEl.setAttribute('role', 'alert');
        errorEl.hidden = true;
        actions.appendChild(errorEl);

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
        const label = row.pr_number ? ('PR #' + row.pr_number) : 'View PR';
        // Link the merged PR when its URL is known; otherwise fall back to a
        // static "PR #N" / "Shipped" line.
        if (row.pr_url) {
            const a = document.createElement('a');
            a.className = 'agentSecondary agentSecondaryMuted agentShippedLink';
            a.href = row.pr_url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = label;
            return a;
        }
        const p = document.createElement('p');
        p.className = 'agentSecondary agentSecondaryMuted';
        p.textContent = row.pr_number ? label : 'Shipped';
        return p;
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

// Build the ready-to-paste mockup prompt from the task + captured context
// bundle. Any Context line whose field is empty is omitted; when no bundle
// field is present the whole Context block is dropped rather than leaving a
// bare "Context:" header. The trailing format instruction pins the entry shape
// the user should paste back (matching the routine's TODO.md conventions).
function buildMockupPrompt(ctx) {
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const val = function (v) { return (v == null) ? '' : String(v).trim(); };
    const title = val(c.title);
    const description = val(c.description);

    const contextLines = [];
    if (val(c.region)) contextLines.push('- Region: ' + val(c.region));
    if (val(c.tokens)) contextLines.push('- Tokens: ' + val(c.tokens));
    if (val(c.change)) contextLines.push('- Change: ' + val(c.change));
    const contextBlock = contextLines.length ? ('\n\nContext:\n' + contextLines.join('\n')) : '';

    return "I'm working on my toDoList_TOP PWA and need mockups for a UI change, then a finished TODO.md entry.\n\n"
        + 'Task: ' + title + '\n' + description
        + contextBlock
        + '\n\nShow me 2-3 mockup options (A/B/C), let me pick one, then produce a single TODO.md entry '
        + 'in this format: `- [ ] **[PRIORITY]** <title>` with `- Type:` / `- Description:` / `- File:` / '
        + '`- Completed:` sub-bullets, priority in literal brackets, full repo-relative paths under '
        + '`toDoList_main/src/`, no id marker.';
}

// Secondary content for a `needs_mockup` card: the launcher hand-off. Triage
// routes visual tasks here; this surfaces an "Open mockup" button that expands
// a read-only block showing the *actual full prompt* to paste into Claude —
// with a Copy button and a separate "Open Claude Design" control beside it —
// and a paste-back field that takes the finished TODO.md entry, writes it to
// the row's `draft`, and flips the row to `drafted` — where the Dispatch card
// already ships it. Showing the exact prompt (rather than the raw context
// bundle) removes the ambiguity about what to paste; copying and opening Claude
// are separate deliberate taps so there's no focus race between them. The
// round-trip is deliberately manual: this is a launcher, not an in-app mockup
// renderer. The view never writes to Supabase directly (the save routes through
// listLogic.setAgentRunState).
function buildMockupSecondary(row) {
    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const wrap = document.createElement('div');
    wrap.className = 'agentSecondary agentMockup';

    // The full assembled prompt — the same string the user pastes into Claude.
    // Built once (the context bundle is folded into it), shown verbatim in the
    // toggled block so what the user sees is exactly what they copy.
    const prompt = buildMockupPrompt(ctx);

    // Open mockup: toggles the read-only prompt block open/closed. No clipboard
    // write or tab-open here — those live on the Copy button and the Open Claude
    // Design control inside the block, kept separate to avoid a focus race.
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'agentMockupOpen';
    openBtn.textContent = 'Open mockup';
    openBtn.setAttribute('aria-expanded', 'false');
    wrap.appendChild(openBtn);

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
    wrap.appendChild(promptWrap);

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
    wrap.appendChild(input);

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
    wrap.appendChild(actions);

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

    return wrap;
}

// The dispatch target (repo/filePath) for the active project's runs. v1 ships
// against the Worker's default target (the toDoList project), so an omitted
// target is correct here; multi-repo resolution is a follow-on.
function resolveDispatchTarget() {
    return null;
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
    const entryId = existingEntryId || mintEntryId();
    const entry = embedEntryMarker(draftText, entryId);

    const injectResult = await injectEntry({ entry: entry, id: entryId, target: target });
    if (!injectResult || !injectResult.ok) {
        return { ok: false, error: 'Inject failed — ' + ((injectResult && injectResult.reason) || 'error') };
    }

    // Best-effort head start: poll the same on-main read the reconcile path uses
    // for the entry's id marker, dispatching immediately once it appears so a run
    // doesn't race ahead of the push and no-op against a stale TODO.md. A
    // transient read error counts as a miss and is retried until the attempt
    // budget is spent. This is a head start, not a gate — if the marker never
    // surfaces we dispatch anyway below rather than block a legitimate run.
    const marker = '<!-- id: ' + entryId + ' -->';
    let visible = false;
    for (let i = 0; i < ENTRY_VISIBLE_ATTEMPTS; i++) {
        let read = null;
        try {
            read = await readTodoMdFromWorker(target);
        } catch (e) { read = null; }
        if (read && read.ok !== false && typeof read.content === 'string'
            && read.content.indexOf(marker) !== -1) {
            visible = true;
            break;
        }
        if (i < ENTRY_VISIBLE_ATTEMPTS - 1) {
            await new Promise(function (res) { setTimeout(res, ENTRY_VISIBLE_DELAY_MS); });
        }
    }
    if (!visible) {
        // The entry was injected (marker appended) but hasn't propagated to the
        // on-main read within the window. Don't block: the run's boot latency
        // covers the remaining propagation, so dispatch anyway. A rare genuine
        // race then no-changes and self-heals on Retry, which reuses this
        // entry_id (persisted below alongside the dispatched state).
        console.warn('dispatchDraft: entry ' + entryId
            + ' not confirmed on main within the visibility window; dispatching anyway');
    }

    const correlationId = mintEntryId();
    const dispatchResult = await dispatchRun({
        mode: 'entry',
        entryId: entryId,
        correlationId: correlationId,
        target: target,
    });
    if (!dispatchResult || !dispatchResult.ok) {
        return { ok: false, error: 'Run failed — ' + ((dispatchResult && dispatchResult.reason) || 'error') };
    }

    const patch = {
        state: 'dispatched',
        entry_id: entryId,
        correlation_id: correlationId,
    };
    if (dispatchResult.runId != null) patch.run_id = dispatchResult.runId;
    await listLogic.setAgentRunState(rowId, patch);

    startDispatchPoller(rowId, entryId, correlationId, target);
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

    head.appendChild(buildChip(row.state));
    // Every card except the in-flight thin states (dispatched/running) gets a
    // compact "×" remove control next to the chip. Thin rows have a run in
    // flight, so they're left to settle to Shipped/Stuck before they can be
    // removed.
    if (!thin) head.appendChild(buildRemoveControl(row));
    card.appendChild(head);

    if (!thin) {
        const secondary = buildSecondary(row);
        if (secondary) card.appendChild(secondary);
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
    return items.filter(function (it) {
        return it && typeof it.tit === 'string' && it.tit.trim() !== '' && !it.completed && !queued.has(it.id);
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
    card.className = 'agentCard agentCard--unassigned';
    card.setAttribute('data-todo-id', item.id || '');

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

// The Not-assigned bucket: a header (label + count) and one Give-to-agent card
// per unqueued task. Rendered at the bottom of the board, below Shipped.
function buildNotAssignedBucket(items) {
    const section = document.createElement('div');
    section.className = 'agentBucket agentBucket--not-assigned';

    const header = document.createElement('div');
    header.className = 'agentBucketHeader';

    const label = document.createElement('span');
    label.className = 'agentBucketLabel';
    label.textContent = 'Not assigned';
    header.appendChild(label);

    const count = document.createElement('span');
    count.className = 'agentBucketCount';
    count.textContent = String(items.length);
    header.appendChild(count);

    section.appendChild(header);

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

    const header = document.createElement('div');
    header.className = 'agentBucketHeader';

    const label = document.createElement('span');
    label.className = 'agentBucketLabel';
    label.textContent = bucket.label;
    header.appendChild(label);

    const count = document.createElement('span');
    count.className = 'agentBucketCount';
    count.textContent = String(rows.length);
    header.appendChild(count);

    section.appendChild(header);

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
