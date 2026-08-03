import { listLogic } from './listLogic.js';
import {
    fetchActiveRuns,
    pollRunStatus,
    showInjectToast,
    mintEntryId,
    dispatchDerive,
    dispatchTriage,
    findTargetById,
} from './inject.js';
import { resolveDispatchTarget } from './dispatchDraft.js';
import {
    loadQueueRows,
    notifyQueueChange,
    getLoadedProjectName,
    configureRunTrackers,
    isDeriveActive,
    startDeriveTracking,
    stopDeriveTracking,
    setDeriveCorrelationId,
    setTriageDispatcher,
    isTriageInFlight,
    setTriageInFlight,
    startSweepTracking,
    stopSweepTracking,
    clearWorkingWatchSweepSeed,
    pollAgentWorkingWatch,
} from './agentQueueStore.js';
import { configureMockupFlow } from './mockupFlow.js';
import { configureAssignmentCoverage } from './assignmentCoverage.js';
import { openChatWithSeed } from './claudeSheet.js';

// Boot-time wiring for the extracted agent subsystems.
//
// The mockup flow (mockupFlow.js), the assignment / coverage subsystem
// (assignmentCoverage.js), and the triage-sweep / derive run trackers
// (agentQueueStore.js) each deliberately avoid importing their board-side
// callbacks directly — doing so would form a view → module → view cycle — so
// those callbacks are injected once, at load, through the modules' configure*
// entry points. Historically the Agent board (agentView.js) did that injection
// as a module-load side effect. When main.js was severed from the board, the
// board module stopped loading in the app, so none of the three configure* calls
// ran and the extracted subsystems were left unconfigured: the Coverage tab could
// not resolve its read target or fire Derive, and the run trackers never probed.
//
// This module re-homes that wiring to a leaf that main.js DOES import on boot, so
// the subsystems are configured whether or not the board ever mounts. The board's
// own repaint callbacks (paint / refreshStatusPill / bucket collapse state) are
// deliberately NOT re-supplied — no board is mounted in the running app, so they
// are genuinely dead. Every live callback is sourced acyclically: the Worker
// probes come straight from inject.js / dispatchDraft.js (neither is a view), and
// the two small view-local helpers the board used to own — the selected-project
// reader and the read-target resolver — are reproduced here.
//
// For the same reason this module also re-homes the board's TRIAGE-SWEEP dispatcher
// (setTriageDispatcher). The board registered it at its module load so the task-row
// Generate button and the ASKING answer path could fire a sweep through the store
// without importing the view; with the board no longer loading, that registration
// stopped running, leaving fireTriageSweep a null-dispatcher no-op — flagging a task
// queued a `triaging` row but never launched claude-triage.yml. The boardless
// dispatcher below (fireTriageSweep) restores it, sourced acyclically the same way.

// The currently-selected project's name, read from the sidebar — the same source
// of truth agentView.js and the row layer read. Returns '' when nothing is
// selected. Mirrors agentView's getSelectedProjectName (and dispatchDraft's /
// the store's own copies); a shared DOM read with no cross-module state.
function getSelectedProjectName() {
    if (typeof document === 'undefined') return '';
    const selected = document.querySelector('.selectedProject');
    if (!selected) return '';
    const input = selected.querySelector('#projInput');
    return input ? (input.value || '').trim() : '';
}

// Resolve the selected project's routed inject-target (project name → target id →
// target object), or null when nothing is selected or the project has no linked
// repo. Reproduces agentView's resolveReadTarget verbatim.
function resolveReadTarget() {
    const projectName = getSelectedProjectName();
    if (!projectName) return null;
    const targetId = listLogic.getProjectTargetId(projectName);
    return targetId ? findTargetById(targetId) : null;
}

// Reload the queue for the given project and notify listeners, so newly written
// rows (a drafted mockup entry, a freshly proposed derive row) land promptly even
// if the realtime push lags. Reproduces the non-settle path of agentView's
// refreshAgentQueue using the store's own primitives — the store cannot call these
// through the injected board callback any more, so the wiring supplies the reload.
function refreshAgentQueue(projectName) {
    return loadQueueRows(projectName).then(function () {
        if (getSelectedProjectName() === getLoadedProjectName()) notifyQueueChange();
    });
}

// Dispatch a derive run for the selected project and track it to completion.
// Reproduces agentView's fireDeriveRun verbatim; the Coverage tab's Draft button
// calls this through the injected binding. All of its dependencies resolve
// acyclically (inject.js / dispatchDraft.js / the store), so it lives here rather
// than in the view.
function fireDeriveRun(btn) {
    if (btn && btn.disabled) return;
    if (isDeriveActive()) return;
    const projectName = getSelectedProjectName();
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) return;
    // Instant local feedback so a double-tap can't fire two runs before the first
    // repaint; the durable disabled/"Drafting…" state comes from isDeriveActive().
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Drafting…';
    }
    // Optimistically flip the pill to Working and track the real claude-derive.yml
    // run to completion (settling to Idle when GitHub reports it done).
    startDeriveTracking();
    const correlationId = mintEntryId();
    setDeriveCorrelationId(correlationId);
    Promise.resolve(dispatchDerive(projectId, correlationId, resolveDispatchTarget()))
        .then(
            function (res) {
                // If the dispatch itself failed, clear the optimistic Working state.
                if (res && res.ok === false) stopDeriveTracking();
            },
            function () { stopDeriveTracking(); }
        );
}

// Dispatch a triage sweep for the named project, fire-and-forget, and track the
// real claude-triage.yml run to completion. Reproduces agentView's fireTriageSweep
// verbatim: the board used to own this and register it via setTriageDispatcher at
// its module load, but the board no longer loads in the app, so fireTriageSweep in
// the store resolved to a null dispatcher and flagging a task never launched a run
// (and the nav dot never lit). Re-homing the registration here — a leaf main.js
// imports on boot — restores the wiring whether or not the board ever mounts. All
// dependencies resolve acyclically: dispatchTriage / mintEntryId from inject.js,
// resolveDispatchTarget from dispatchDraft.js, and the sweep tracker + in-flight
// guard from the store. Guarded by the shared in-flight flag; returns null when the
// guard or a missing project id swallows the call, otherwise the dispatch result.
// Never throws.
function fireTriageSweep(projectName) {
    if (isTriageInFlight()) return Promise.resolve(null);
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) return Promise.resolve(null);
    setTriageInFlight(true);
    // Optimistically drive the pill/nav dot to Working the instant we dispatch, and
    // start the poller that tracks the real claude-triage.yml run to completion
    // (settling back to Idle when GitHub reports it done).
    startSweepTracking(false);
    return Promise.resolve()
        .then(function () { return dispatchTriage(projectId, mintEntryId(), resolveDispatchTarget()); })
        .then(
            function (res) {
                setTriageInFlight(false);
                // If the dispatch itself failed, clear the optimistic Working state
                // so neither the pill nor the nav dot falsely reports a sweep in
                // flight (no run will ever register).
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

// Register the boardless triage dispatcher with the store so the row layer's
// Generate button and the ASKING answer path (which call fireTriageSweep through
// the store, never importing this module) fire a real sweep. agentView.js still
// self-registers its own copy when a test mounts the board; the app loads THIS
// module, not the board, so this registration is the one the running app uses.
setTriageDispatcher(fireTriageSweep);

// Wire the mockup flow. Only the live callback (the selected-project reader, used
// to resolve the routed repo for mockup prompts) is supplied; the board repaint
// callbacks it also accepts (paint / refreshAgentQueue) are omitted — dead with no
// board — and configureMockupFlow merges per key, so the omitted ones keep their
// no-op defaults.
configureMockupFlow({ getSelectedProjectName });

// Wire the assignment / coverage subsystem. Supplies the live callbacks it needs
// (selected project, read-target resolver, derive dispatch, and the chat hand-off
// the coverage modal's blocked answer lane routes "Discuss in chat" through);
// omits the dead board-render callback (paint), which configure* merges per key so
// it stays a no-op. The derive tracker itself is imported directly by
// assignmentCoverage.js from the store.
//
// openChatWithSeed comes from claudeSheet.js, which already imports
// assignmentCoverage.js — so the coverage module must NOT import it back. This
// wiring module is a leaf nothing imports (only main.js, after claudeSheet), so
// injecting it from here is acyclic. Wrapped in a thunk for the same reason the
// run-tracker deps below are: the binding is read at CALL time, so a test that
// partially mocks claudeSheet.js doesn't throw on import.
configureAssignmentCoverage({
    getSelectedProjectName,
    resolveReadTarget,
    fireDeriveRun,
    openChatWithSeed: function (seed, rowId) { return openChatWithSeed(seed, rowId); },
});

// Wire the triage-sweep and derive run trackers. Supplies the live queue reload
// and the Worker probes; omits the board-only pill/repaint callbacks
// (refreshStatusPill / paint), which the store guards at each call site. The
// Worker-call deps are wrapped in thunks so the imported bindings are read at CALL
// time — some tests partially mock inject.js, and eagerly reading an absent export
// would throw on import even for a test that never fires a run.
configureRunTrackers({
    refreshAgentQueue,
    fetchActiveRuns: function (target, workflow) { return fetchActiveRuns(target, workflow); },
    pollRunStatus: function (opts) { return pollRunStatus(opts); },
    resolveDispatchTarget: function () { return resolveDispatchTarget(); },
    showInjectToast: function (msg, kind) { return showInjectToast(msg, kind); },
});
