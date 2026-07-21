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
// This entry delivers the fresh-run flow only (idle → running → done). Loading
// the last stored capture on mount and a re-run affordance are the next entry, so
// a completed run shows a read-only readout with no re-run button.

import { mintEntryId, getCachedTargets, dispatchCapture, subscribeRunOutputs } from './inject.js';
import { supabase } from './supabaseClient.js';

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

    const when = relativeTime(row && (row.updated_at || row.finished_at || row.created_at));
    if (when) {
        const footer = document.createElement('div');
        footer.className = 'captureCardFooter';
        footer.textContent = when;
        ctx.card.appendChild(footer);
    }
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

// ── Public entry ─────────────────────────────────────────────────────

// A container element rendered synchronously in the idle state. Hidden entirely
// when there's no repo (structureView already early-returns before this in that
// case, but the guard keeps the card inert if ever called without one).
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
    renderIdle(ctx);
    return card;
}
