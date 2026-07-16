// NEXT REFACTOR card — the Structure tab's top-of-view suggestion of the single
// cheapest extraction-refactor candidate for the selected project's repo.
//
// `renderRefactorCard(repo)` returns a container element synchronously and fills
// it asynchronously, so structureView can mount it as a persistent sibling of the
// tree (a lens repaint, which only clears the tree, never wipes it). The fill
// path resolves the repo's last stored scan, asks the Worker's `scan` route for
// the next candidate (passing the stored blob sha so an unchanged file
// short-circuits for free), persists a fresh scan when new bytes are found, and
// renders the top not-yet-dismissed candidate. The card is read-only apart from a
// "Skip" control that dismisses the shown candidate and advances to the next.
//
// A scan costs ~100k input tokens, so concurrent scans for the same repo are
// deduped through a module-scoped in-flight map keyed by repo: a render that
// lands while a scan is already running reuses the pending promise rather than
// starting a second one.

import { scanRefactor, getCachedTargets } from './inject.js';
import { listLogic } from './listLogic.js';

// repo -> Promise resolving to a normalized render descriptor. Cleared when the
// scan settles, so a later render (after the file rolled over, say) can scan
// again — while an in-flight render reuses the pending promise.
const _inFlight = new Map();

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

// Render the active candidate (or a terminal "all skipped" note). Re-callable
// with the same `row` so "Skip" advances without another scan.
function renderCandidate(card, repo, row) {
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
        renderCandidate(card, repo, row);
        Promise.resolve(
            listLogic.dismissRefactorCandidate(repo, row.target_file, cand.name)
        ).catch(function () { /* background write; card already advanced */ });
    });
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

async function fillCard(card, repo) {
    let desc;
    try {
        desc = await runScan(repo);
    } catch (e) {
        renderError(card, (e && e.message) || '');
        return;
    }
    if (!desc) { renderError(card, ''); return; }
    if (desc.kind === 'candidate') {
        renderCandidate(card, repo, desc.row);
    } else if (desc.kind === 'note') {
        renderNote(card, desc.text);
    } else {
        renderError(card, desc.reason);
    }
}

// Public entry: a container element filled asynchronously. Hidden entirely when
// there's no repo (structureView already early-returns before this in that case,
// but the guard keeps the card inert if ever called without one).
export function renderRefactorCard(repo) {
    const card = document.createElement('div');
    card.className = 'refactorCard';
    if (!repo) {
        card.style.display = 'none';
        return card;
    }
    renderScanning(card);
    fillCard(card, repo);
    return card;
}

// Test-only reset of the in-flight dedup map.
export function _resetRefactorCard() {
    _inFlight.clear();
}
