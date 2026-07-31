import { listLogic } from './listLogic.js';
import {
    fetchActiveRuns,
    pollRunStatus,
    showInjectToast,
    mintEntryId,
    dispatchDerive,
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
} from './agentQueueStore.js';
import { configureMockupFlow } from './mockupFlow.js';
import { configureAssignmentCoverage } from './assignmentCoverage.js';

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

// Wire the mockup flow. Only the live callback (the selected-project reader, used
// to resolve the routed repo for mockup prompts) is supplied; the board repaint
// callbacks it also accepts (paint / refreshAgentQueue) are omitted — dead with no
// board — and configureMockupFlow merges per key, so the omitted ones keep their
// no-op defaults.
configureMockupFlow({ getSelectedProjectName });

// Wire the assignment / coverage subsystem. Supplies the live callbacks it needs
// (selected project, read-target resolver, derive dispatch); omits the dead
// board-render callbacks (paint / bucket collapse state), which configure* merges
// per key so they stay no-ops. The derive tracker itself is imported directly by
// assignmentCoverage.js from the store.
configureAssignmentCoverage({
    getSelectedProjectName,
    resolveReadTarget,
    fireDeriveRun,
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
