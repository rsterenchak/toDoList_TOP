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
    readTodoMdFromWorker,
    findTargetById,
    showInjectToast,
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
    return Promise.resolve()
        .then(function () { return dispatchTriage(projectId, mintEntryId()); })
        .then(
            function (res) { _triageInFlight = false; return res; },
            function () { _triageInFlight = false; return { ok: false }; }
        );
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
    // nothing (no_change). Both surface the row's summary via failure_reason.
    if (state === 'failed' || state === 'no_change') {
        const reason = (row.failure_reason || '').trim();
        const p = document.createElement('p');
        p.className = 'agentSecondary agentFailure';
        p.textContent = reason || (state === 'no_change'
            ? 'The run finished without merging any changes.'
            : 'The run failed. Retry from the queue.');
        return p;
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
        dispatchDraft(row, draftText).then(function (res) {
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
// routes visual tasks here; this surfaces the context bundle it captured
// (Region / Tokens / Change, only the fields that are present), an "Open
// mockup" button that copies a ready-to-paste mockup prompt and opens Claude,
// and a paste-back field that takes the finished TODO.md entry, writes it to
// the row's `draft`, and flips the row to `drafted` — where the Dispatch card
// already ships it. The round-trip is deliberately manual: this is a launcher,
// not an in-app mockup renderer. The view never writes to Supabase directly
// (the save routes through listLogic.setAgentRunState).
function buildMockupSecondary(row) {
    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const wrap = document.createElement('div');
    wrap.className = 'agentSecondary agentMockup';

    // Context bundle in a read-only block, reusing the drafted-card styling.
    // Only the fields triage actually filled are rendered.
    const bundleFields = [
        { label: 'Region', value: ctx.region },
        { label: 'Tokens', value: ctx.tokens },
        { label: 'Change', value: ctx.change },
    ].filter(function (f) { return f.value != null && String(f.value).trim() !== ''; });
    if (bundleFields.length) {
        const bundle = document.createElement('div');
        bundle.className = 'agentDraftBlock agentMockupBundle';
        bundle.setAttribute('tabindex', '0');
        bundle.setAttribute('aria-label', 'Mockup context bundle');
        bundleFields.forEach(function (f) {
            const line = document.createElement('div');
            line.className = 'agentMockupBundleLine';
            const key = document.createElement('span');
            key.className = 'agentMockupBundleKey';
            key.textContent = f.label + ': ';
            line.appendChild(key);
            line.appendChild(document.createTextNode(String(f.value).trim()));
            bundle.appendChild(line);
        });
        wrap.appendChild(bundle);
    }

    // Open mockup: copy the prompt to the clipboard and open Claude in a new
    // tab. GitHub Pages is a secure context and the click is a user gesture, so
    // the clipboard API is available; a copy failure degrades to an error toast
    // (the user can still paste the prompt from Claude Design manually).
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'agentMockupOpen';
    openBtn.textContent = 'Open mockup';
    openBtn.addEventListener('click', function () {
        const prompt = buildMockupPrompt(ctx);
        let copied;
        try {
            copied = navigator.clipboard.writeText(prompt);
        } catch (e) {
            copied = Promise.reject(e);
        }
        Promise.resolve(copied).then(function () {
            showInjectToast('Mockup prompt copied — paste it into Claude or Claude Design.');
        }, function () {
            showInjectToast('Couldn’t copy the prompt — copy it into Claude manually.', 'error');
        });
        try { window.open('https://claude.ai/new', '_blank'); } catch (e) { /* popup blocked */ }
    });
    wrap.appendChild(openBtn);

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
async function dispatchDraft(row, draftText) {
    const rowId = row.id;
    const target = resolveDispatchTarget();
    const entryId = mintEntryId();
    const entry = embedEntryMarker(draftText, entryId);

    const injectResult = await injectEntry({ entry: entry, id: entryId, target: target });
    if (!injectResult || !injectResult.ok) {
        return { ok: false, error: 'Inject failed — ' + ((injectResult && injectResult.reason) || 'error') };
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
    card.appendChild(head);

    if (!thin) {
        const secondary = buildSecondary(row);
        if (secondary) card.appendChild(secondary);
    }
    return card;
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

    const header = document.createElement('div');
    header.className = 'agentViewHeader';
    const name = document.createElement('h2');
    name.className = 'agentProjectName';
    name.textContent = projectName;
    header.appendChild(name);
    const chip = document.createElement('span');
    chip.className = 'agentViewChip';
    chip.textContent = 'Agent queue';
    header.appendChild(chip);

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
    header.appendChild(runBtn);
    view.appendChild(header);

    const rows = Array.isArray(_rows) ? _rows : [];
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
}
