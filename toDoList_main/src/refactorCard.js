// NEXT REFACTOR card — the Structure tab's top-of-view suggestion of the single
// cheapest extraction-refactor candidate for the selected project's repo.
//
// `renderRefactorCard(repo)` returns a container element synchronously and fills
// it asynchronously, so structureView can mount it as a persistent sibling of the
// tree (a lens repaint, which only clears the tree, never wipes it). The fill
// path resolves the repo's last stored scan, asks the Worker's `scan` route for
// the next candidate (passing the stored blob sha so an unchanged file
// short-circuits for free), persists a fresh scan when new bytes are found, and
// renders the top not-yet-dismissed candidate. A "Skip" control dismisses the
// shown candidate and advances to the next; a "Push entry" control turns the
// shown candidate into a real todo and hands it to the agent loop (via
// listLogic.flagTaskForAgent), then dismisses it and advances.
//
// A scan costs ~100k input tokens, so concurrent scans for the same repo are
// deduped through a module-scoped in-flight map keyed by repo: a render that
// lands while a scan is already running reuses the pending promise rather than
// starting a second one.

import { scanRefactor, getCachedTargets } from './inject.js';
import { listLogic } from './listLogic.js';
import { addToDos_restore, addAllToDo_DOM } from './toDoRow.js';

// repo -> Promise resolving to a normalized render descriptor. Cleared when the
// scan settles, so a later render (after the file rolled over, say) can scan
// again — while an in-flight render reuses the pending promise.
const _inFlight = new Map();

// How long the "Pushed — triaging" confirmation lingers before the card
// re-renders to the next candidate.
const PUSHED_ADVANCE_MS = 2000;

function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// Resolve the full inject target (repo + file_path) for a repo string so the
// scan POST carries the same shape fetchPagesStatus uses. Falls back to a
// repo-only target when the cache has no match (the Worker resolves the rest).
function resolveTarget(repo) {
    const targets = getCachedTargets();
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] && targets[i].repo === repo) return targets[i];
    }
    return { repo: repo };
}

// "just now" / "Xm ago" / "Xh ago" / "Xd ago" from an ISO timestamp.
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

function basename(path) {
    if (!path) return '';
    const parts = String(path).split('/');
    return parts[parts.length - 1] || String(path);
}

// The scan reports paths repo-relative (e.g. `src/agentView.js`); todos and
// triage expect the full `toDoList_main/src/…` path, so normalize to that.
function srcPath(path) {
    const s = String(path || '');
    if (!s) return '';
    if (s.indexOf('toDoList_main/') === 0) return s;
    return 'toDoList_main/' + s.replace(/^\/+/, '');
}

// An imperative extraction instruction for the pushed candidate's todo title.
function buildPushTitle(cand, row) {
    const from = basename(row.target_file) || 'the source file';
    const into = cand.suggested_module || 'a new module';
    return 'Extract ' + (cand.name || 'the function') + ' from ' + from + ' into ' + into;
}

// The pushed candidate's todo description — everything triage needs without
// re-deriving it from the scan.
function buildPushDescription(cand, row) {
    const lines = [];
    lines.push('Mechanical, behaviour-preserving extraction only — no logic may change.');
    lines.push('');
    let span = '';
    if (cand.start_line != null && cand.end_line != null) {
        span = ' The scan located it around lines ' + cand.start_line + '–' + cand.end_line
            + '; that span is from the scan and may have drifted, so locate the function by'
            + ' name and treat the span as a hint only.';
    }
    lines.push('Extract the function `' + (cand.name || '') + '` from `' + srcPath(row.target_file)
        + '` into a new module `' + srcPath(cand.suggested_module) + '`.' + span);
    if (cand.rationale) {
        lines.push('');
        lines.push('Rationale: ' + cand.rationale);
    }
    if (Array.isArray(cand.cluster_with) && cand.cluster_with.length) {
        lines.push('');
        lines.push('Move these sibling functions in the same entry so the file isn’t touched by'
            + ' two runs: ' + cand.cluster_with.join(', ') + '.');
    }
    return lines.join('\n');
}

// Rebuild #mainList so the Projects view isn't stale when the user returns from
// the Structure tab after a push. Mirrors seedTasksModal's post-add rebuild —
// but never switches views (the user stays on Structure).
function rebuildMainList(projectName) {
    const mainList = document.getElementById('mainList');
    if (!mainList) return;
    clearEl(mainList);
    const items = listLogic.listItems(projectName);
    const hasRealItems = items && items.some(function (i) { return i.tit !== ''; });
    if (hasRealItems) {
        addToDos_restore(items, projectName);
    } else if (items) {
        addAllToDo_DOM(items, projectName);
    }
}

// The top candidate whose `name` isn't in the row's `dismissed` array, keeping
// the Worker's cheapest-first order.
function activeCandidate(row) {
    const candidates = (row && Array.isArray(row.candidates)) ? row.candidates : [];
    const dismissed = (row && Array.isArray(row.dismissed)) ? row.dismissed : [];
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        if (c && dismissed.indexOf(c.name) === -1) return c;
    }
    return null;
}

// ── Render helpers ───────────────────────────────────────────────────

function buildEyebrow(rightText, rightMuted) {
    const eyebrow = document.createElement('div');
    eyebrow.className = 'refactorCardEyebrow';
    const label = document.createElement('span');
    label.className = 'refactorCardEyebrowLabel';
    label.textContent = 'NEXT REFACTOR';
    eyebrow.appendChild(label);
    if (rightText) {
        const right = document.createElement('span');
        right.className = 'refactorCardEyebrowMeta';
        right.textContent = rightText;
        eyebrow.appendChild(right);
    }
    return eyebrow;
}

function renderScanning(card) {
    clearEl(card);
    // A scan takes ~30s, so surface a "scanning…" label in place of the
    // timestamp rather than an empty header that could read as hung.
    card.appendChild(buildEyebrow('scanning…'));
}

function renderNote(card, text) {
    clearEl(card);
    card.appendChild(buildEyebrow(''));
    const note = document.createElement('div');
    note.className = 'refactorCardNote';
    note.textContent = text;
    card.appendChild(note);
}

function renderError(card, reason) {
    clearEl(card);
    card.appendChild(buildEyebrow(''));
    const err = document.createElement('div');
    err.className = 'refactorCardError';
    err.textContent = reason
        ? ('Couldn’t scan for a refactor — ' + reason)
        : 'Couldn’t scan for a refactor.';
    card.appendChild(err);
}

function buildChip(text, extraClass) {
    const chip = document.createElement('span');
    chip.className = 'refactorCardChip' + (extraClass ? ' ' + extraClass : '');
    chip.textContent = text;
    return chip;
}

// Show a quiet inline error inside the candidate card (reusing the card's error
// treatment) without disturbing the rest of the candidate content.
function showPushError(card, reason) {
    const existing = card.querySelector('.refactorCardPushError');
    if (existing) existing.remove();
    const err = document.createElement('div');
    err.className = 'refactorCardError refactorCardPushError';
    err.textContent = reason || 'Couldn’t hand the task to the agent.';
    const actions = card.querySelector('.refactorCardActions');
    if (actions) card.insertBefore(err, actions);
    else card.appendChild(err);
}

// Create the shown candidate as a real todo, backfill its description, and hand
// it to the agent loop via flagTaskForAgent. On success, dismiss the candidate,
// rebuild the Projects list, confirm briefly, then advance to the next.
async function pushCandidate(card, repo, row, cand, projectName, pushBtn, skipBtn) {
    const title = buildPushTitle(cand, row);
    const desc = buildPushDescription(cand, row);
    // The add path takes only a title, so create then backfill the description
    // through the existing edit path — mirroring the proven seed hand-off.
    listLogic.addToDo(projectName, title);
    const items = listLogic.listItems(projectName) || [];
    const created = items.filter(function (it) { return it && it.tit === title; }).pop();
    if (created) {
        created.desc = desc;
        listLogic.editToDoItem(projectName, created);
    }
    let flagRes = { ok: false, error: 'Couldn’t create the task.' };
    if (created) {
        flagRes = await Promise.resolve(listLogic.flagTaskForAgent(created.id));
    }
    if (!flagRes || flagRes.ok === false) {
        // The todo was already created; only the hand-off to the agent failed —
        // don't dismiss the candidate, and re-enable so the user can retry.
        pushBtn.disabled = false;
        skipBtn.disabled = false;
        showPushError(card, (flagRes && flagRes.error)
            ? ('Couldn’t hand the task to the agent — ' + flagRes.error)
            : 'Couldn’t hand the task to the agent.');
        return;
    }
    // A pushed candidate is no longer a suggestion — dismiss it (reusing the
    // `dismissed` array, so no schema change). Persist in the background.
    Promise.resolve(
        listLogic.dismissRefactorCandidate(repo, row.target_file, cand.name)
    ).catch(function () { /* background write; the card already advanced */ });
    const dismissed = Array.isArray(row.dismissed) ? row.dismissed : [];
    if (dismissed.indexOf(cand.name) === -1) dismissed.push(cand.name);
    row.dismissed = dismissed;
    // A new todo landed while Structure is showing — rebuild the Projects list
    // so it isn't stale, but stay on Structure (no view switch).
    rebuildMainList(projectName);
    // Confirm, then advance to the next candidate.
    const actions = card.querySelector('.refactorCardActions');
    const pushed = document.createElement('div');
    pushed.className = 'refactorCardPushed';
    pushed.textContent = 'Pushed — triaging';
    if (actions) actions.replaceWith(pushed);
    else card.appendChild(pushed);
    setTimeout(function () {
        renderCandidate(card, repo, row, projectName);
    }, PUSHED_ADVANCE_MS);
}

// Render the active candidate (or a terminal "all skipped" note). Re-callable
// with the same `row` so "Skip" advances without another scan.
function renderCandidate(card, repo, row, projectName) {
    clearEl(card);
    const cand = activeCandidate(row);
    if (!cand) {
        card.appendChild(buildEyebrow(''));
        const note = document.createElement('div');
        note.className = 'refactorCardNote';
        note.textContent = 'No more candidates — every suggestion skipped.';
        card.appendChild(note);
        return;
    }

    card.appendChild(buildEyebrow(relativeTime(row.scanned_at) ? 'scanned ' + relativeTime(row.scanned_at) : ''));

    const title = document.createElement('div');
    title.className = 'refactorCardTitle';
    title.textContent = cand.name || '';
    card.appendChild(title);

    const chips = document.createElement('div');
    chips.className = 'refactorCardChips';
    const lines = (cand.lines != null) ? cand.lines : 0;
    chips.appendChild(buildChip(lines + ' lines'));
    const refCount = Array.isArray(cand.closure_refs) ? cand.closure_refs.length : 0;
    // Zero closure refs is the clean case — flag it in the warning colour so a
    // trivially-extractable candidate reads at a glance.
    chips.appendChild(buildChip(refCount + ' refs', refCount === 0 ? 'refactorCardChip--clean' : ''));
    chips.appendChild(buildChip('−' + lines + ' from ' + basename(row.target_file)));
    card.appendChild(chips);

    if (cand.suggested_module) {
        const mod = document.createElement('div');
        mod.className = 'refactorCardModule';
        mod.textContent = 'Suggested module: ' + cand.suggested_module;
        card.appendChild(mod);
    }

    if (Array.isArray(cand.cluster_with) && cand.cluster_with.length) {
        const cluster = document.createElement('div');
        cluster.className = 'refactorCardCluster';
        cluster.textContent = 'Move with: ' + cand.cluster_with.join(', ');
        card.appendChild(cluster);
    }

    if (cand.rationale) {
        const rationale = document.createElement('div');
        rationale.className = 'refactorCardRationale';
        rationale.textContent = cand.rationale;
        card.appendChild(rationale);
    }

    const actions = document.createElement('div');
    actions.className = 'refactorCardActions';

    // Push entry — the primary action: turn the shown candidate into a real
    // todo and hand it to the agent loop. Disabled when no project is linked.
    const push = document.createElement('button');
    push.type = 'button';
    push.className = 'refactorCardPush';
    push.textContent = 'Push entry';
    if (!projectName) {
        push.disabled = true;
        push.title = 'No project linked to this repo.';
    }

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.className = 'refactorCardSkip';
    skip.textContent = 'Skip';
    skip.addEventListener('click', function () {
        // Optimistic: hide this candidate locally and advance, then persist the
        // dismissal in the background (quiet — Skip has no failure surface).
        const dismissed = Array.isArray(row.dismissed) ? row.dismissed : [];
        if (dismissed.indexOf(cand.name) === -1) dismissed.push(cand.name);
        row.dismissed = dismissed;
        renderCandidate(card, repo, row, projectName);
        Promise.resolve(
            listLogic.dismissRefactorCandidate(repo, row.target_file, cand.name)
        ).catch(function () { /* background write; card already advanced */ });
    });

    push.addEventListener('click', function () {
        if (push.disabled || !projectName) return;
        // Disable both so a double-tap can't create two todos.
        push.disabled = true;
        skip.disabled = true;
        const prevErr = card.querySelector('.refactorCardPushError');
        if (prevErr) prevErr.remove();
        pushCandidate(card, repo, row, cand, projectName, push, skip);
    });

    actions.appendChild(push);
    actions.appendChild(skip);
    card.appendChild(actions);
}

// ── Scan orchestration ───────────────────────────────────────────────

// Resolve the repo's last scan, probe the Worker, persist on new bytes, and
// return a normalized descriptor the renderer consumes. Deduped per repo.
function runScan(repo) {
    if (_inFlight.has(repo)) return _inFlight.get(repo);
    const p = (async function () {
        const target = resolveTarget(repo);
        const loaded = await listLogic.loadLatestRefactorScan(repo);
        const storedRow = (loaded && loaded.ok) ? (loaded.row || null) : null;
        const storedSha = storedRow ? storedRow.target_sha : undefined;
        const res = await scanRefactor(target, storedSha);
        if (!res || res.ok === false) {
            return { kind: 'error', reason: (res && res.reason) || '' };
        }
        // Same file at the same sha — render the stored row untouched (no write).
        if (res.unchanged) {
            if (storedRow) return { kind: 'candidate', row: storedRow };
            // Worker says unchanged but we have nothing stored — treat as terminal.
            return { kind: 'note', text: 'No refactor candidate yet.' };
        }
        // New bytes — persist and render the returned candidates.
        if (res.found) {
            const candidates = Array.isArray(res.candidates) ? res.candidates : [];
            await listLogic.saveRefactorScan({
                repo: repo,
                target_file: res.target_file,
                target_sha: res.target_sha,
                candidates: candidates,
            });
            // Preserve prior skips only when the target file is the same one.
            const dismissed = (storedRow
                && storedRow.target_file === res.target_file
                && Array.isArray(storedRow.dismissed))
                ? storedRow.dismissed.slice()
                : [];
            return {
                kind: 'candidate',
                row: {
                    repo: repo,
                    target_file: res.target_file,
                    target_sha: res.target_sha,
                    candidates: candidates,
                    dismissed: dismissed,
                    scanned_at: new Date().toISOString(),
                },
            };
        }
        // Terminal: nothing over budget anywhere.
        if (res.all_under_budget) {
            return { kind: 'note', text: 'Every file is under budget — nothing to extract.' };
        }
        // Defensive: an unrecognized response reads as the terminal state.
        return { kind: 'note', text: 'No refactor candidate right now.' };
    })();
    _inFlight.set(repo, p);
    p.then(function () { _inFlight.delete(repo); }, function () { _inFlight.delete(repo); });
    return p;
}

async function fillCard(card, repo, projectName) {
    let desc;
    try {
        desc = await runScan(repo);
    } catch (e) {
        renderError(card, (e && e.message) || '');
        return;
    }
    if (!desc) { renderError(card, ''); return; }
    if (desc.kind === 'candidate') {
        renderCandidate(card, repo, desc.row, projectName);
    } else if (desc.kind === 'note') {
        renderNote(card, desc.text);
    } else {
        renderError(card, desc.reason);
    }
}

// Public entry: a container element filled asynchronously. Hidden entirely when
// there's no repo (structureView already early-returns before this in that case,
// but the guard keeps the card inert if ever called without one).
export function renderRefactorCard(repo, projectName) {
    const card = document.createElement('div');
    card.className = 'refactorCard';
    if (!repo) {
        card.style.display = 'none';
        return card;
    }
    renderScanning(card);
    fillCard(card, repo, projectName);
    return card;
}

// Test-only reset of the in-flight dedup map.
export function _resetRefactorCard() {
    _inFlight.clear();
}
