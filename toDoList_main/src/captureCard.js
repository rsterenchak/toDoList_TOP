// RUN & CAPTURE card — the Structure tab's on-demand runner for a repo's console
// app. Built on inject.js's `dispatchCapture` (a workflow_dispatch against
// run-capture.yml) and `subscribeRunOutputs` (a per-capture realtime channel on
// the `run_outputs` row). The card owns the live view end-to-end: Run mints a
// correlation id, opens the channel, dispatches, and renders optimistically; each
// realtime row re-renders the card (running → done/failed), and the terminal row
// tears the channel down.
//
// `renderCaptureCard(repo)` returns a container element synchronously — exactly
// like `renderRefactorCard` in refactorCard.js — so structureView can mount it as
// a persistent sibling of the tree (a lens repaint, which only clears the tree,
// never wipes it). Hidden entirely when there is no repo (the one inline-style
// write refactorCard also uses).
//
// On mount the card fills asynchronously from the repo's last stored capture
// (`listLogic.loadLatestCapture`, the way refactorCard's fillCard does): a
// terminal row renders its read-only readout, a still-running row re-subscribes
// and settles live, and no row (or a failed read) stays quietly idle. The done
// state carries a ⟳ re-run control that re-fires the same run, and the card
// exposes `card._captureTeardown` so a project switch can dispose a mid-run
// realtime channel before the Structure view is rebuilt.

import { mintEntryId, getCachedTargets, dispatchCapture, subscribeRunOutputs } from './inject.js';
import { supabase } from './supabaseClient.js';
import { listLogic } from './listLogic.js';

function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// Resolve the full inject target (repo + file_path) for a repo string so the
// capture dispatch carries the same shape the other Worker calls use. Falls back
// to a repo-only target when the cache has no match (the Worker resolves the
// rest). Copied file-local from refactorCard.js — it isn't exported there.
function resolveTarget(repo) {
    const targets = getCachedTargets();
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].repo === repo) return targets[i];
    }
    return { repo: repo };
}

// "just now" / "Xm ago" / "Xh ago" / "Xd ago" from an ISO timestamp. Copied
// file-local from refactorCard.js so the two cards read timestamps identically.
function relativeTime(iso) {
    if (!iso) return '';
    const then = Date.parse(iso);
    if (isNaN(then)) return '';
    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
    if (secs < 45) return 'just now';
    const mins = Math.round(secs / 60);
    if (mins < 60) return mins + 'm ago';
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + 'h ago';
    const days = Math.round(hrs / 24);
    return days + 'd ago';
}

// Recover the args a stored capture ran with from its resolved `command`, so a
// loaded row (and a re-run of it) reflects the prior args in the idle input. The
// dispatched command puts the user's args after a ` -- ` separator
// (`python3 main.py -- 95 88 72`), so the substring past that is the args;
// returns '' when there is no separator (nothing to recover).
function argsFromCommand(command) {
    const s = String(command || '');
    const idx = s.indexOf(' -- ');
    if (idx === -1) return '';
    return s.slice(idx + 4).trim();
}

// ── Render helpers ───────────────────────────────────────────────────

// The eyebrow: a constant "RUN & CAPTURE" label with an optional right-hand node
// (a running pill while in flight, an exit badge once done). Mirrors
// refactorCard's buildEyebrow so the two cards read as a set.
function buildEyebrow(rightNode) {
    const eyebrow = document.createElement('div');
    eyebrow.className = 'captureCardEyebrow';
    const label = document.createElement('span');
    label.className = 'captureCardEyebrowLabel';
    label.textContent = 'RUN & CAPTURE';
    eyebrow.appendChild(label);
    if (rightNode) eyebrow.appendChild(rightNode);
    return eyebrow;
}

// The controls row: a monospace args input (flexing to fill) beside the accent
// Run button. Shared by the idle and running states so their layout can't drift;
// `disabled` renders the running state's inert copy.
function buildControls(ctx, disabled) {
    const controls = document.createElement('div');
    controls.className = 'captureCardControls';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'captureCardArgs';
    input.placeholder = 'args — e.g. 95 88 72';
    input.value = ctx.lastArgs || '';
    if (disabled) input.disabled = true;
    controls.appendChild(input);

    const run = document.createElement('button');
    run.type = 'button';
    run.className = 'captureCardRun';
    run.textContent = 'Run';
    if (disabled) {
        run.disabled = true;
    } else {
        run.addEventListener('click', function () {
            if (ctx.inFlight) return;
            startCapture(ctx, input.value);
        });
    }
    controls.appendChild(run);

    return { controls: controls, input: input, run: run };
}

// Idle (lean): the eyebrow label, the args input + Run button, and a thin muted
// hint — no terminal block at rest, so the card sits at about the refactor card's
// weight. `lastArgs` is preserved across re-renders so a failed run keeps the
// user's typed args.
function renderIdle(ctx) {
    clearEl(ctx.card);
    ctx.card.appendChild(buildEyebrow(null));
    ctx.card.appendChild(buildControls(ctx, false).controls);
    const hint = document.createElement('div');
    hint.className = 'captureCardHint';
    hint.textContent = 'output appears here';
    ctx.card.appendChild(hint);
}

// Running: the eyebrow gains a spinner "running" pill, the Run button disables,
// and a terminal block shows a muted "running…" line.
function renderRunning(ctx) {
    clearEl(ctx.card);

    const pill = document.createElement('span');
    pill.className = 'captureCardRunning';
    const spinner = document.createElement('span');
    spinner.className = 'captureCardSpinner';
    spinner.setAttribute('aria-hidden', 'true');
    pill.appendChild(spinner);
    const pillText = document.createElement('span');
    pillText.textContent = 'running';
    pill.appendChild(pillText);
    ctx.card.appendChild(buildEyebrow(pill));

    ctx.card.appendChild(buildControls(ctx, true).controls);

    const term = document.createElement('div');
    term.className = 'captureCardTerm';
    const line = document.createElement('div');
    line.className = 'captureCardTermMuted';
    line.textContent = 'running…';
    term.appendChild(line);
    ctx.card.appendChild(term);
}

// Done: the eyebrow shows an exit badge — green `exit 0` on a clean exit,
// danger-red `exit N` otherwise; the resolved command renders in dim monospace;
// the terminal block shows stdout; and when stderr is non-empty a stderr view
// renders below it in danger-red-tinted monospace (omitted entirely when stderr
// is empty). A footer shows the relative time.
function renderDone(ctx, row) {
    clearEl(ctx.card);

    const exit = Number(row && row.exit_code);
    const ok = exit === 0;
    const badge = document.createElement('span');
    badge.className = 'captureCardExit ' + (ok ? 'captureCardExit--ok' : 'captureCardExit--fail');
    badge.textContent = 'exit ' + (Number.isFinite(exit) ? exit : '—');
    ctx.card.appendChild(buildEyebrow(badge));

    const command = row && row.command ? String(row.command) : '';
    if (command) {
        const cmd = document.createElement('div');
        cmd.className = 'captureCardCommand';
        cmd.textContent = command;
        ctx.card.appendChild(cmd);
    }

    const term = document.createElement('div');
    term.className = 'captureCardTerm';
    term.textContent = row && row.stdout ? String(row.stdout) : '';
    ctx.card.appendChild(term);

    const stderr = row && row.stderr ? String(row.stderr) : '';
    if (stderr) {
        const err = document.createElement('div');
        err.className = 'captureCardStderr';
        err.textContent = stderr;
        ctx.card.appendChild(err);
    }

    // Footer: a space-between row with the relative time on the left and a ⟳
    // re-run button on the right. The button re-fires the same run via
    // startCapture (already inFlight-guarded), and works for both a just-finished
    // run and a row loaded from storage on mount.
    const footer = document.createElement('div');
    footer.className = 'captureCardFooter';

    const when = relativeTime(row && (row.updated_at || row.finished_at || row.created_at));
    const time = document.createElement('span');
    time.className = 'captureCardFooterTime';
    time.textContent = when || '';
    footer.appendChild(time);

    const rerun = document.createElement('button');
    rerun.type = 'button';
    rerun.className = 'captureCardRerun';
    rerun.textContent = '⟳';
    rerun.setAttribute('aria-label', 'Re-run this capture');
    rerun.addEventListener('click', function () {
        if (ctx.inFlight) return;
        startCapture(ctx, ctx.lastArgs);
    });
    footer.appendChild(rerun);

    ctx.card.appendChild(footer);
}

// A quiet inline error (mirroring refactorCard's renderError/showPushError): fall
// back to the idle state — re-enabling Run so the user can retry — and append the
// error line beneath it.
function renderError(ctx, reason) {
    renderIdle(ctx);
    const err = document.createElement('div');
    err.className = 'captureCardError';
    err.textContent = reason
        ? ('Couldn’t start the run — ' + reason)
        : 'Couldn’t start the run.';
    ctx.card.appendChild(err);
}

// ── Orchestration ────────────────────────────────────────────────────

// Tear the realtime channel down (terminal status or a dispatch failure), the way
// unsubscribeAgentView does. Best-effort: a missing client or a throw is ignored.
function teardownChannel(ctx) {
    if (!ctx.channel) return;
    try {
        if (supabase && typeof supabase.removeChannel === 'function') {
            supabase.removeChannel(ctx.channel);
        }
    } catch (e) { /* best-effort teardown */ }
    ctx.channel = null;
}

// Re-render the card from a live `run_outputs` row. `running` holds the running
// state; a terminal `done`/`failed` renders the readout and tears the channel
// down. An empty/unknown row is ignored so a spurious event can't blank the card.
function onCaptureRow(ctx, row) {
    if (!row) return;
    const status = row.status;
    if (status === 'running') {
        renderRunning(ctx);
        return;
    }
    if (status === 'done' || status === 'failed') {
        teardownChannel(ctx);
        ctx.inFlight = false;
        renderDone(ctx, row);
    }
}

// Run: mint a correlation id, resolve the repo's target, open the realtime
// channel, then dispatch. The running state is rendered optimistically and the
// first live row re-renders from real data. `inFlight` guards against a double-tap
// firing two dispatches; a dispatch failure tears the channel down, clears the
// guard, and surfaces a quiet inline error with Run re-enabled.
async function startCapture(ctx, argsValue) {
    if (ctx.inFlight) return;
    ctx.inFlight = true;
    ctx.lastArgs = argsValue;

    const correlationId = mintEntryId();
    const target = resolveTarget(ctx.repo);
    // Open the channel BEFORE dispatch so the Worker's insert of the `running`
    // row can't fire before we're listening.
    ctx.channel = subscribeRunOutputs(correlationId, function (row) {
        onCaptureRow(ctx, row);
    });
    renderRunning(ctx);

    const res = await dispatchCapture({
        target: target,
        correlationId: correlationId,
        args: argsValue,
        project: '',
    });
    if (!res || res.ok === false) {
        teardownChannel(ctx);
        ctx.inFlight = false;
        renderError(ctx, res && res.reason);
    }
}

// Fill the card from the repo's last stored capture after the synchronous idle
// render — the way refactorCard's fillCard does. A terminal `done`/`failed` row
// renders the read-only done readout; a `running` row re-subscribes on its
// correlation id and renders running (resuming an in-flight capture, including
// one started on another device), which `onCaptureRow`'s terminal branch then
// settles live; no row (or a failed read) stays quietly idle — a background read
// has no error surface. Guarded so a Run tapped before this sub-second load
// resolves is never clobbered by the load's re-render.
async function fillFromLatest(ctx) {
    let loaded;
    try {
        loaded = await listLogic.loadLatestCapture(ctx.repo);
    } catch (e) {
        return; // background read — stay idle, never surface an error
    }
    if (!loaded || loaded.ok === false) return;
    const row = loaded.row;
    if (!row) return;
    // A Run fired before the load resolved owns the card now — don't overwrite it.
    if (ctx.inFlight || ctx.channel) return;

    const status = row.status;
    if (status === 'done' || status === 'failed') {
        ctx.lastArgs = argsFromCommand(row.command);
        renderDone(ctx, row);
        return;
    }
    if (status === 'running') {
        ctx.lastArgs = argsFromCommand(row.command);
        ctx.inFlight = true;
        ctx.channel = subscribeRunOutputs(row.correlation_id, function (r) {
            onCaptureRow(ctx, r);
        });
        renderRunning(ctx);
    }
    // Any other status: leave the idle render in place.
}

// ── Public entry ─────────────────────────────────────────────────────

// A container element rendered synchronously in the idle state, then filled
// asynchronously from the last stored capture. Hidden entirely when there's no
// repo (structureView already early-returns before this in that case, but the
// guard keeps the card inert if ever called without one).
export function renderCaptureCard(repo) {
    const card = document.createElement('div');
    card.className = 'captureCard';
    if (!repo) {
        card.style.display = 'none';
        return card;
    }
    // Per-card mutable state closed over by the render/orchestration functions:
    // the in-flight guard, the owned realtime channel, and the last typed args.
    const ctx = { card: card, repo: repo, inFlight: false, channel: null, lastArgs: '' };
    // Expose a teardown hook so a project switch (structureView rebuild) can
    // dispose a mid-run realtime channel before the card is discarded — a lens
    // repaint never calls this (it only clears the tree, leaving the card mounted).
    card._captureTeardown = function () { teardownChannel(ctx); };
    renderIdle(ctx);
    fillFromLatest(ctx);
    return card;
}
