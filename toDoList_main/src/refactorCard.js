// NEXT REFACTOR card — the Structure tab's top-of-view suggestion of the single
// cheapest extraction-refactor candidate for the selected project's repo.
//
// The card is a pure reader. The Worker owns the scan entirely: after each
// merged run `claude-run.yml` calls the Worker's scan route, which reads the
// stored `refactor_scans` row, does the sha check server-side, and writes the
// result with the service_role key (owner taken from `inject_targets.user_id`).
// So the browser never scans — it only reads the repo's last stored scan
// (`loadLatestRefactorScan`) and renders the top not-yet-dismissed candidate.
// This matters on mobile Safari, which dropped the ~90s scan request every time
// the browser held that connection open.
//
// `renderRefactorCard(repo)` returns a container element synchronously and fills
// it asynchronously (a sub-second Supabase read), so structureView can mount it
// as a persistent sibling of the tree (a lens repaint, which only clears the
// tree, never wipes it). A "Skip" control dismisses the shown candidate and
// advances to the next; a "Push entry" control turns the shown candidate into a
// real todo, ships its entry and dispatches a run directly (via shipEntryForTodo),
// then dismisses it and advances.

import { getCachedTargets, fetchActiveRuns } from './inject.js';
import { shipEntryForTodo } from './shipEntry.js';
import { listLogic } from './listLogic.js';
import { addToDos_restore, addAllToDo_DOM } from './toDoRow.js';

// How long the "Entry shipped — run dispatched" confirmation lingers before the
// card re-renders to the next candidate.
const PUSHED_ADVANCE_MS = 2000;

function clearEl(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// Resolve the full inject target (repo + file_path) for a repo string so the
// "Push entry" ship and its in-flight-run probe carry the same shape the other
// Worker calls use. Falls back to a repo-only target when the cache has no match
// (the Worker resolves the rest).
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

// Bytes → KB at one decimal, dropping a trailing ".0" so a round value reads
// "60KB" rather than "60.0KB". Used for both the largest-file and budget sizes
// on the clean-scan chip row.
function formatKB(bytes) {
    const kb = (Number(bytes) || 0) / 1024;
    let s = kb.toFixed(1);
    if (s.slice(-2) === '.0') s = s.slice(0, -2);
    return s + 'KB';
}

// The scan reports paths repo-relative (e.g. `src/agentView.js`); todos and
// triage expect the full `toDoList_main/src/…` path, so normalize to that.
function srcPath(path) {
    const s = String(path || '');
    if (!s) return '';
    if (s.indexOf('toDoList_main/') === 0) return s;
    return 'toDoList_main/' + s.replace(/^\/+/, '');
}

// Resolve the destination module path for a pushed candidate. The scan reports
// `suggested_module` as a bare filename (e.g. `dismissable.js`), so passing it
// through srcPath alone would join it straight onto `toDoList_main/` and drop
// the `src/` segment — landing the module one directory above every other
// source file, outside webpack's tree. Instead resolve it against the directory
// of the (normalized) target file, which IS the repo's src prefix by
// construction — so it stays correct for any repo whose registry row carries a
// different `src_prefix`. `basename()` first so a bare filename, a repo-relative
// `src/dismissable.js`, and an already-full path all normalize identically.
// Falls back to srcPath's behaviour when the target file has no directory part.
function destModulePath(targetFile, suggestedModule) {
    const src = srcPath(targetFile);
    const slash = src.lastIndexOf('/');
    if (slash === -1) return srcPath(suggestedModule);
    return src.slice(0, slash + 1) + basename(suggestedModule);
}

// An imperative extraction instruction for the pushed candidate's todo title.
function buildPushTitle(cand, row) {
    const from = basename(row.target_file) || 'the source file';
    const into = cand.suggested_module || 'a new module';
    return 'Extract ' + (cand.name || 'the function') + ' from ' + from + ' into ' + into;
}

// The pushed candidate's todo description — a complete, single TODO.md entry in
// the repo's exact existing format, because a todo's description IS its TODO.md
// entry: injectDescription posts item.desc verbatim (wrapped only by
// embedEntryMarker), so free prose here would land unparseable in TODO.md. The
// entry uses `Type: feature` because the routine only accepts `bug` or `feature`
// (routine-base.md's <todo_format>) — any other value renders the entry
// ineligible and silently unrunnable. An extraction isn't fixing broken
// behaviour, so `feature` (not `bug`) is correct; it maps to the changelog's
// `added` category, but a behaviour-preserving extraction has no user-visible
// effect, so the routine's own skip clause fires and no changelog bullet is
// written. No id marker is embedded — injectDescription mints the id and calls
// embedEntryMarker itself.
function buildPushDescription(cand, row) {
    const srcFile = srcPath(row.target_file);
    const destFile = destModulePath(row.target_file, cand.suggested_module);

    // The Description body must be a single line: a TODO.md sub-bullet can't
    // carry embedded newlines without breaking the entry's list structure, so
    // the sentences are space-joined rather than paragraph-separated.
    const body = [];
    body.push('Mechanical, behaviour-preserving extraction only — no logic may change.');
    let span = '';
    if (cand.start_line != null && cand.end_line != null) {
        span = ' The scan located it around lines ' + cand.start_line + '–' + cand.end_line
            + '; that span is from the scan and may have drifted, so locate the function by'
            + ' name and treat the span as a hint only.';
    }
    body.push('Extract the function `' + (cand.name || '') + '` from `' + srcFile
        + '` into a new module `' + destFile + '`.' + span);
    // An extraction that doesn't say this invites a rewrite — state that the new
    // module is imported back and that every call site is left unchanged.
    body.push('Import the extracted module back into `' + srcFile
        + '` and keep every call site unchanged.');
    if (cand.rationale) {
        body.push('Rationale: ' + cand.rationale);
    }
    if (Array.isArray(cand.cluster_with) && cand.cluster_with.length) {
        body.push('Move these sibling functions in the same entry so the file isn’t touched by'
            + ' two runs: ' + cand.cluster_with.join(', ') + '.');
    }

    const lines = [];
    lines.push('- [ ] **[MEDIUM]** ' + buildPushTitle(cand, row));
    lines.push('  - Type: feature');
    lines.push('  - Description: ' + body.join(' '));
    lines.push('  - File: `' + srcFile + '`, `' + destFile + '`');
    lines.push('  - Completed: YYYY-MM-DD (PR #<number>)');
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
        ? ('Couldn’t load the latest refactor scan — ' + reason)
        : 'Couldn’t load the latest refactor scan.';
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

// Create the shown candidate as a real todo, backfill its description, then ship
// its entry and dispatch a run via shipEntryForTodo. Gated first by an in-flight
// run probe that fails CLOSED, so a refusal leaves no orphaned todo behind. On
// success, dismiss the candidate, rebuild the Projects list, confirm briefly,
// then advance to the next.
async function pushCandidate(card, repo, row, cand, projectName, pushBtn, skipBtn) {
    // Resolve the ship target BEFORE anything is created, so the entry lands in
    // the right repo's TODO.md and the run dispatches against that same repo.
    const target = resolveTarget(repo);

    // Safety gate: every refactor candidate extracts from the same source file,
    // so two concurrent runs would edit it simultaneously. Probe claude-run.yml
    // (no workflow arg) for any in-flight run and fail CLOSED — unlike the
    // ambient callers of fetchActiveRuns, an ok:false here blocks the push
    // rather than reading as "not active". This runs BEFORE addToDo so a refusal
    // leaves no orphaned todo behind, which is what makes the one-tap push safe.
    const active = await fetchActiveRuns(target);
    if (!active || active.ok === false) {
        pushBtn.disabled = false;
        skipBtn.disabled = false;
        showPushError(card, 'Couldn’t check for an in-flight run — the push was not attempted. Try again in a moment.');
        return;
    }
    if (active.active) {
        pushBtn.disabled = false;
        skipBtn.disabled = false;
        showPushError(card, 'A run is already in flight — try again once it lands.');
        return;
    }

    const title = buildPushTitle(cand, row);
    const desc = buildPushDescription(cand, row);
    // The add path takes only a title, so create then backfill the description
    // through the existing edit path — mirroring the proven seed hand-off.
    listLogic.addToDo(projectName, title);
    const items = listLogic.listItems(projectName) || [];
    const created = items.filter(function (it) { return it && it.tit === title; }).pop();
    if (!created) {
        pushBtn.disabled = false;
        skipBtn.disabled = false;
        showPushError(card, 'Couldn’t create the task.');
        return;
    }
    created.desc = desc;
    listLogic.editToDoItem(projectName, created);

    // Ship the entry and dispatch a run for it. shipEntryForTodo mints the id
    // and embeds the marker itself, so don't call embedEntryMarker here; omit
    // existingEntryId so a fresh id is minted.
    const shipRes = await shipEntryForTodo({
        todoId: created.id,
        entryText: created.desc,
        target: target,
    });
    if (!shipRes || shipRes.ok === false) {
        // The todo was already created and carries the entry — only the ship
        // failed. Don't dismiss the candidate; the user can retry from the row's
        // own Inject button. Re-enable both buttons and word this as a ship
        // failure, not a push failure.
        pushBtn.disabled = false;
        skipBtn.disabled = false;
        showPushError(card, (shipRes && shipRes.error)
            ? ('Couldn’t ship the entry — ' + shipRes.error)
            : 'Couldn’t ship the entry.');
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
    pushed.textContent = 'Entry shipped — run dispatched';
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

// The scan looked and found nothing over budget. Show the "clean" note plus a
// three-chip summary of the biggest file it saw against the budget. Defensive:
// if `largest_file` is null (nothing measured), render the note alone rather
// than a chip row of "null".
function renderClean(card, row) {
    clearEl(card);
    card.appendChild(buildEyebrow(relativeTime(row.scanned_at) ? 'scanned ' + relativeTime(row.scanned_at) : ''));
    const note = document.createElement('div');
    note.className = 'refactorCardNote';
    note.textContent = 'Nothing over budget — this repo is clean.';
    card.appendChild(note);
    if (row.largest_file == null) return;
    const chips = document.createElement('div');
    chips.className = 'refactorCardChips';
    chips.appendChild(buildChip(basename(row.largest_file), 'refactorCardChip--clean'));
    chips.appendChild(buildChip(formatKB(row.largest_bytes) + ' of ' + formatKB(row.budget_bytes)));
    const count = (row.eligible_count != null) ? row.eligible_count : 0;
    chips.appendChild(buildChip(count + (count === 1 ? ' file' : ' files')));
    card.appendChild(chips);
}

// The scan found no files it can read (it only analyses JS/TS). Note only, no
// chips — there's nothing measured to summarise.
function renderUnreadable(card, row) {
    clearEl(card);
    card.appendChild(buildEyebrow(relativeTime(row.scanned_at) ? 'scanned ' + relativeTime(row.scanned_at) : ''));
    const note = document.createElement('div');
    note.className = 'refactorCardNote';
    note.textContent = 'No files here the scan can read — it only analyses JavaScript and TypeScript.';
    card.appendChild(note);
}

// ── Reader ───────────────────────────────────────────────────────────

// Read the repo's last stored scan and render the top not-yet-dismissed
// candidate. The Worker owns the scan and the sha check now, so the client never
// posts anything — it just reads the row it wrote. A failed read shows a quiet
// inline error; a repo with no row yet shows the no-scan-yet note (the first
// scan runs after the next shipped run). The `unchanged`, `all_under_budget`,
// and cold-scan states no longer exist client-side: the sha check is server-side
// (the client never sees "unchanged"), and a Worker that writes no row because
// everything is under budget is indistinguishable from a cold start — both
// collapse into the no-row note.
async function fillCard(card, repo, projectName) {
    let loaded;
    try {
        loaded = await listLogic.loadLatestRefactorScan(repo);
    } catch (e) {
        renderError(card, (e && e.message) || '');
        return;
    }
    if (!loaded || loaded.ok === false) {
        renderError(card, (loaded && loaded.error) || '');
        return;
    }
    const row = loaded.row || null;
    if (!row) {
        renderNote(card, 'No refactor scan yet — one runs automatically after the next shipped run.');
        return;
    }
    // The Worker now writes rows for the states where it looked and found
    // nothing. Branch on `status` so each reads truthfully; `candidates` and any
    // missing/unrecognised status (a legacy row) fall through to renderCandidate.
    if (row.status === 'clean') {
        renderClean(card, row);
        return;
    }
    if (row.status === 'unreadable') {
        renderUnreadable(card, row);
        return;
    }
    renderCandidate(card, repo, row, projectName);
}

// Public entry: a container element filled asynchronously. Hidden entirely when
// there's no repo (structureView already early-returns before this in that case,
// but the guard keeps the card inert if ever called without one). Renders
// nothing until the stored row resolves — the read is sub-second, so a loading
// state would only flash.
export function renderRefactorCard(repo, projectName) {
    const card = document.createElement('div');
    card.className = 'refactorCard';
    if (!repo) {
        card.style.display = 'none';
        return card;
    }
    fillCard(card, repo, projectName);
    return card;
}
