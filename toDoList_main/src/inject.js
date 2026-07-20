// Inject to TODO.md — sends a todo's description to a user-configured
// Cloudflare Worker that appends it as a new entry to TODO.md in this repo.
//
// Worker URL and shared secret are per-device, stored in localStorage and
// configured via the Inject settings modal (opened from the ghost menu's
// "Configure inject" row). Once configured, each todo's expanded
// description panel renders an "Inject to TODO.md" button that POSTs the
// description verbatim, stamps `injectedAt` on the todo, and persists.

import { showConfirmModal } from './modals.js';
import { listLogic } from './listLogic.js';
import { supabase } from './supabaseClient.js';

const URL_KEY              = 'todoapp_injectWorkerUrl';
const SECRET_KEY           = 'todoapp_injectSharedSecret';
const LAST_TESTED_KEY      = 'todoapp_injectLastTestedAt';
const LAST_RESULT_KEY      = 'todoapp_injectLastTestResult';
const LAST_TESTED_NICK_KEY = 'todoapp_injectLastTestedNickname';

// Module-level cache populated on app boot via initInjectConfig.
let cachedUrl = '';
let cachedSecret = '';

// Targets cache populated while the settings modal is open. Re-fetched
// after any add/edit/delete so the list always reflects DB state. No
// realtime subscription — at this scale a refetch is cheap and avoids
// extra wiring.
let cachedTargets = [];

export function initInjectConfig() {
    try {
        cachedUrl    = localStorage.getItem(URL_KEY)    || '';
        cachedSecret = localStorage.getItem(SECRET_KEY) || '';
    } catch (e) { /* private mode */ }
}

export function isInjectConfigured() {
    return !!(cachedUrl && cachedSecret);
}

function saveInjectConfig(url, secret) {
    cachedUrl    = url    || '';
    cachedSecret = secret || '';
    try {
        if (cachedUrl)    localStorage.setItem(URL_KEY, cachedUrl);
        else              localStorage.removeItem(URL_KEY);
        if (cachedSecret) localStorage.setItem(SECRET_KEY, cachedSecret);
        else              localStorage.removeItem(SECRET_KEY);
    } catch (e) { /* private mode */ }
    // Let inject-dependent UI (e.g. the sidebar project-row thunderbolt
    // indicators) refresh live on save/clear without a page reload.
    try {
        document.dispatchEvent(new CustomEvent('injectConfigChanged'));
    } catch (e) { /* non-DOM context */ }
}

function readLastTest() {
    try {
        const ts = parseInt(localStorage.getItem(LAST_TESTED_KEY) || '0', 10);
        const result = localStorage.getItem(LAST_RESULT_KEY) || '';
        const nickname = localStorage.getItem(LAST_TESTED_NICK_KEY) || '';
        return {
            ts: isNaN(ts) ? 0 : ts,
            result: result,
            nickname: nickname,
        };
    } catch (e) { return { ts: 0, result: '', nickname: '' }; }
}

function writeLastTest(result, nickname) {
    try {
        localStorage.setItem(LAST_TESTED_KEY, String(Date.now()));
        localStorage.setItem(LAST_RESULT_KEY, result || '');
        if (nickname) {
            localStorage.setItem(LAST_TESTED_NICK_KEY, nickname);
        } else {
            localStorage.removeItem(LAST_TESTED_NICK_KEY);
        }
    } catch (e) { /* private mode */ }
}


// ── TOAST ──
// Self-contained mirror of the jsonImportExport.js pattern. A single toast
// node is reused — any prior one is yanked before the new one appears.
export function showInjectToast(message, variant) {
    const prior = document.getElementById('injectToast');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const toast = document.createElement('div');
    toast.id = 'injectToast';
    if (variant === 'error') toast.classList.add('injectToast--error');
    else                     toast.classList.add('injectToast--ok');
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
}


// ── WORKER CALLS ──
async function postToWorker(payload) {
    if (!isInjectConfigured()) {
        const e = new Error('Not configured');
        e.notConfigured = true;
        throw e;
    }
    let res;
    try {
        res = await fetch(cachedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + cachedSecret,
            },
            body: JSON.stringify(payload),
        });
    } catch (networkErr) {
        const e = new Error('Network error');
        e.network = true;
        throw e;
    }
    if (!res.ok) {
        const e = new Error('HTTP ' + res.status);
        e.status = res.status;
        throw e;
    }
    try { return await res.json(); } catch (e) { return null; }
}

function describeError(e) {
    if (!e) return 'Unknown error';
    if (e.notConfigured) return 'Not configured';
    if (e.status === 401) return '401 Unauthorized';
    if (e.status === 403) return '403 Forbidden';
    if (e.status && e.status >= 500) return 'Server error ' + e.status;
    if (e.status) return 'HTTP ' + e.status;
    if (e.network) return 'Network error';
    return e.message || 'Unknown error';
}

// Mint a stable entry id. Prefers crypto.randomUUID with a Date.now()+random
// fallback for environments without it. Shared by the inject button and the
// Claude sheet's author flow so both stamp ids the Worker's dedup-by-id and
// the routine's entry-mode lookup can rely on.
export function mintEntryId() {
    return (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
}

// Trail an entry's text with the `<!-- id: <id> -->` marker. Marker format is
// exactly one space each side of the id to match the Worker, the routine's
// entry-mode lookup, and TODO_MD_ID_MARKER_RE in main.js. The source text is
// never mutated — trailing whitespace is trimmed only on the returned copy.
export function embedEntryMarker(text, id) {
    return String(text || '').replace(/\s+$/, '') + '\n  <!-- id: ' + id + ' -->';
}

// ── TODO-ROW RUN-STATUS CORRELATION ──
// The run records the Claude sheet persists are the source of truth for whether
// an injected entry has actually shipped a run. The description-status dot on a
// todo row correlates `item.entryId` against those records. This key mirrors
// RUNS_KEY in claudeSheet.js (the documented-stable `todoapp_` key); it is kept
// here so the row layer can read run status without importing claudeSheet.js —
// that would form a toDoRow → claudeSheet → modals → toDoRow import cycle.
export const CLAUDE_RUNS_KEY = 'todoapp_claudeRuns';

// Document event fired whenever an injected entry's run status may have changed:
// a fresh inject stamps `injectedAt` (pending edge), and a run reconciling to
// SHIPPED promotes it (shipped edge). Row-level dot listeners re-evaluate on this
// event so the dot updates live without a full reload. The inject button
// dispatches the pending edge; claudeSheet's run-record persistence dispatches
// the shipped edge.
export const TODO_RUN_STATUS_EVENT = 'todoapp:todoRunStatusChange';

// Per-repo cache of TODO.md marker ids — the cross-device source of truth for
// the row status glyph. Keyed by `target.repo` → `{ present: Set<markerId>,
// shipped: Set<markerId>, fetchedAt: ms }`, populated by refreshShippedMarkers,
// which reads the routed target's TODO.md through the Worker and records, for
// every top-level entry, its `<!-- id -->` marker in `present` and — when that
// entry's checkbox is `[x]` — also in `shipped`. So a marker in `present` but
// not `shipped` is injected-but-unshipped; a marker absent from `present`
// altogether means the entry is no longer in TODO.md (never injected, or
// deleted/reverted). Every device that syncs the entry id agrees — unlike the
// old device-local todoapp_claudeRuns scan, whose freshly-minted ids never
// intersected a row's injected entry id.
const shippedMarkerCache = new Map();
const shippedMarkersInFlight = new Map();
const SHIPPED_MARKERS_TTL_MS = 60 * 1000;

// True once the entry's `<!-- id -->` marker has been seen on a CHECKED
// top-level TODO.md entry (i.e. its run merged). Reads the in-memory cache
// populated by refreshShippedMarkers — synchronous so the row render path and
// refreshDescStatusDots can call it directly without awaiting. Entry ids are
// globally-unique UUIDs, so a hit in any cached repo's set is authoritative;
// false when the cache is empty, the id is falsy, or the id isn't yet shipped.
export function hasShippedRunForEntry(entryId) {
    if (!entryId) return false;
    let shipped = false;
    shippedMarkerCache.forEach(function(entry) {
        if (entry && entry.shipped && entry.shipped.has(entryId)) shipped = true;
    });
    return shipped;
}

// Resolve an entry id to its three-way run state for the row status glyph:
//   'shipped' — the marker sits on a CHECKED top-level TODO.md entry
//   'pending' — the marker is present in TODO.md but its entry is unchecked
//   'none'    — the marker is absent from every cached TODO.md (never injected,
//               or deleted/reverted) — so the glyph clears instead of sticking
// Synchronous, reading the same cache hasShippedRunForEntry does. Entry ids are
// globally-unique UUIDs, so scanning across repos is safe: a `shipped` hit in
// any repo wins, else a `present` hit yields 'pending', else 'none'.
export function resolveEntryRunState(entryId) {
    if (!entryId) return 'none';
    let state = 'none';
    shippedMarkerCache.forEach(function(entry) {
        if (!entry) return;
        if (entry.shipped && entry.shipped.has(entryId)) {
            state = 'shipped';
        } else if (state !== 'shipped' && entry.present && entry.present.has(entryId)) {
            state = 'pending';
        }
    });
    return state;
}

// Optimistically record a just-injected entry's marker as present (unshipped)
// in the target repo's cache so the amber pending glyph appears immediately,
// before the next TODO.md read confirms it. Does NOT bump `fetchedAt`, so the
// next TTL/forced refresh still reconciles against the real file. Creates the
// per-repo cache entry if absent (with fetchedAt: 0 so it reads as stale).
export function markEntryPresentLocally(repo, entryId) {
    if (!repo || !entryId) return;
    let entry = shippedMarkerCache.get(repo);
    if (!entry) {
        entry = { present: new Set(), shipped: new Set(), fetchedAt: 0 };
        shippedMarkerCache.set(repo, entry);
    }
    if (!entry.present) entry.present = new Set();
    entry.present.add(entryId);
    emitTodoRunStatusChange();
}

// Optimistically drop an entry's marker from every cached repo's present and
// shipped sets so its row glyph clears immediately on a delete/revert, before
// the next TODO.md read confirms the removal. A forced refresh afterwards
// reconciles against the real file.
export function forgetEntryMarkerLocally(entryId) {
    if (!entryId) return;
    shippedMarkerCache.forEach(function(entry) {
        if (!entry) return;
        if (entry.present) entry.present.delete(entryId);
        if (entry.shipped) entry.shipped.delete(entryId);
    });
    emitTodoRunStatusChange();
}

// Dispatch TODO_RUN_STATUS_EVENT so row-level status dots re-evaluate. Safe in
// non-DOM environments (no-op when `document` is absent).
export function emitTodoRunStatusChange() {
    if (typeof document === 'undefined') return;
    try {
        document.dispatchEvent(new CustomEvent(TODO_RUN_STATUS_EVENT));
    } catch (e) { /* CustomEvent unsupported */ }
}

async function injectDescription(item, target) {
    if (!item || !item.desc) return { ok: false, reason: 'No description' };
    try {
        // Mint once and reuse on re-inject so the Worker's dedup-by-id makes
        // a repeat a no-op and the entry traces back to its merged PR.
        if (!item.entryId) item.entryId = mintEntryId();
        const body = {
            entry: embedEntryMarker(item.desc, item.entryId),
            id: item.entryId,
        };
        if (target) {
            body.repo = target.repo;
            body.filePath = target.file_path;
        }
        await postToWorker(body);
        item.injectedAt = Date.now();
        listLogic.saveToStorage();
        // Show the amber pending glyph immediately, then reconcile against the
        // real TODO.md (forced past the TTL so the just-injected entry lands).
        if (target && target.repo && item.entryId) {
            markEntryPresentLocally(target.repo, item.entryId);
            refreshShippedMarkers(target, true);
        }
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}

// Inject a ready-made TODO.md entry through the same Worker the inject button
// uses (same URL + Bearer secret). Unlike injectDescription, this takes a raw
// entry string and an id directly — the Claude sheet's author flow mints the
// id and embeds the marker via mintEntryId/embedEntryMarker, then hands the
// finished entry here. Posts `{ entry, id }` (plus repo/filePath when a target
// is supplied) and returns `{ ok: true, id }` on success or `{ ok: false,
// reason }` via describeError on failure.
export async function injectEntry(options) {
    const opts = options || {};
    if (!opts.entry) return { ok: false, reason: 'No entry' };
    const id = opts.id || mintEntryId();
    try {
        const body = { entry: opts.entry, id: id };
        if (opts.target) {
            body.repo = opts.target.repo;
            body.filePath = opts.target.file_path;
        }
        await postToWorker(body);
        return { ok: true, id: id };
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}

// Hold a chat turn with Claude through the same Worker the inject/dispatch
// flows use (same URL + Bearer secret). Mirrors postToWorker's wiring but
// POSTs `{ chat: true, messages }` — the running conversation history — and
// returns the assistant's reply text. Tolerates a couple of response shapes
// (`{ reply }`, `{ text }`, or a bare string). Lets postToWorker's error
// throw so the caller can surface it; the thrown error carries a `reason`
// from describeError matching the inject button's vocabulary, plus the HTTP
// `status` when one is available so callers can special-case it (e.g. the
// iterate flow treats a 404 as "nothing to iterate on yet").
//
// `entryId` is optional and only passed on the FIRST turn of an iterate
// session: it makes the Worker resolve the merged diff for that entry's
// marker and assemble the seed context. Every later turn omits it.
//
// `attachFiles` is an optional array of repo-relative source paths. When
// non-empty it rides along as `attach_files` so the Worker fetches each file
// and prepends its content to the system field — giving the assistant the
// actual source to reason over. The current attachment set is sent on every
// turn (per-conversation accumulation) so later turns retain that context.
//
// `repo` is the owner/name the conversation's workspace is anchored to. The
// Worker is multi-repo aware (validates against ALLOWED_TARGETS) and reframes
// its system prompt around this repo, so it rides on every turn — not just when
// files are attached. When attachments are present they come from this same
// repo, so the Worker knows where to fetch them.
//
// `suggestedAttachFiles` is an optional array of repo-relative paths the user
// accepted from a Worker file suggestion. It rides as `suggested_attach_files`
// so the Worker applies its tighter 20KB suggestion cap, separate from the
// manual `attach_files` budget.
//
// Returns `{ reply, suggestedFiles }`: `reply` is the assistant's text, and
// `suggestedFiles` is the array of paths the Worker proposed attaching this
// turn (empty when none).
export async function chatWithWorker(messages, entryId, attachFiles, repo, suggestedAttachFiles, deepThink) {
    try {
        const payload = { chat: true, messages: messages };
        if (entryId) payload.entry_id = entryId;
        if (repo) payload.repo = repo;
        // Per-message "deep think" flag: the Deep send button sets this so the
        // Worker routes just this turn to a heavier model. Omitted entirely on
        // Fast turns, so an un-updated Worker simply never sees the field.
        if (deepThink) payload.deep_think = true;
        if (Array.isArray(attachFiles) && attachFiles.length) {
            payload.attach_files = attachFiles.slice();
        }
        // Worker-suggested files ("Lever 4") ride a separate field so the Worker
        // applies its tighter 20KB suggestion cap to them, never co-mingling
        // them with the 40KB manual-attach budget.
        if (Array.isArray(suggestedAttachFiles) && suggestedAttachFiles.length) {
            payload.suggested_attach_files = suggestedAttachFiles.slice();
        }
        const res = await postToWorker(payload);
        const suggestedFiles = res && Array.isArray(res.suggested_files)
            ? res.suggested_files.slice()
            : [];
        let reply = '';
        if (res && typeof res.reply === 'string') reply = res.reply;
        else if (res && typeof res.text === 'string') reply = res.text;
        else if (typeof res === 'string') reply = res;
        return { reply: reply, suggestedFiles: suggestedFiles };
    } catch (e) {
        const err = new Error(describeError(e));
        err.reason = describeError(e);
        if (e && typeof e.status === 'number') err.status = e.status;
        throw err;
    }
}

// Read a file from the configured Worker. Mirrors postToWorker's wiring
// (same URL, same Bearer secret, same `Content-Type: application/json`)
// but sends `{ read: true, repo, filePath }` so the Worker fetches the
// file through GitHub and echoes its contents back. Returns
// `{ ok: true, content, sha }` on success, or `{ ok: false, reason }`
// on any failure. Used by the read-only TODO.md viewer card in main.js;
// callers pass the resolved inject_targets row so the repo/filePath
// match the project's routing.
export async function readTodoMdFromWorker(target) {
    if (!target || !target.repo || !target.file_path) {
        return { ok: false, reason: 'No target' };
    }
    try {
        const res = await postToWorker({
            read: true,
            repo: target.repo,
            filePath: target.file_path,
        });
        if (!res || typeof res.content !== 'string') {
            return { ok: false, reason: 'Empty response' };
        }
        return { ok: true, content: res.content, sha: res.sha };
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}

// Read the `assignment.md` sibling of the routed repo's TODO.md through the
// Worker. Mirrors readTodoMdFromWorker's wiring exactly (same `{ read: true,
// repo, filePath }` shape, same `{ ok, content, sha }` return), differing only
// in the path: it derives the sibling of `target.file_path` — the directory
// portion of the registry's TODO.md path with `assignment.md` appended — rather
// than reusing `target.file_path`, which is why readTodoMdFromWorker can't be
// reused. Assumes the Worker's read handler serves an arbitrary repo-relative
// path; until an `assignment.md` exists in a routed repo this returns not-ok,
// which the AGENT view renders as the absent (no-card) state.
export async function readAssignmentFromWorker(target) {
    if (!target || !target.repo || !target.file_path) {
        return { ok: false, reason: 'No target' };
    }
    const fp = target.file_path;
    const slash = fp.lastIndexOf('/');
    const dir = slash === -1 ? '' : fp.slice(0, slash + 1);
    const assignmentPath = dir + 'assignment.md';
    try {
        const res = await postToWorker({
            read: true,
            repo: target.repo,
            filePath: assignmentPath,
        });
        if (!res || typeof res.content !== 'string') {
            return { ok: false, reason: 'Empty response' };
        }
        return { ok: true, content: res.content, sha: res.sha };
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Exact form of the entry-id marker the inject Worker stamps onto each entry.
// Replicated here (rather than imported from todoMdViewer.js) so the row layer's
// toDoRow → inject dependency stays acyclic — importing todoMdViewer would form
// a toDoRow → todoMdViewer → inject cycle.
const SHIPPED_MARKER_RE = /<!-- id: (\S+) -->/;

// Parse a TODO.md body for top-level entry markers, returning `{ present,
// shipped }` — `present` holds every top-level entry's `<!-- id -->` marker,
// `shipped` only those whose checkbox is `[x]`. Mirrors the viewer's
// entry→marker association (todoMdViewer.js parseTodoMdChecklist): a top-level
// (unindented) `- [ ]`/`- [x]` line starts an entry block, and the entry's
// marker may sit on that line or on any following line of the block up to the
// next top-level checkbox or heading — so we track the current entry and attach
// the first marker found in its block. A non-string body yields two empty sets.
// Deliberately NOT a same-line regex.
function parseTodoMdMarkers(text) {
    const present = new Set();
    const shipped = new Set();
    if (typeof text !== 'string') return { present: present, shipped: shipped };
    let current = null; // { checked, id } for the current top-level entry block
    function flush() {
        if (current && current.id) {
            present.add(current.id);
            if (current.checked) shipped.add(current.id);
        }
    }
    text.split('\n').forEach(function(raw) {
        if (/^#{1,6}\s+/.test(raw)) {
            // A heading bounds the previous entry's block.
            flush();
            current = null;
            return;
        }
        const cb = raw.match(/^- \[( |x|X)\]\s?(.*)$/); // unindented = top-level
        if (cb) {
            flush();
            current = { checked: cb[1].toLowerCase() === 'x', id: null };
            const inline = raw.match(SHIPPED_MARKER_RE);
            if (inline) current.id = inline[1];
            return;
        }
        if (current && !current.id) {
            const m = raw.match(SHIPPED_MARKER_RE);
            if (m) current.id = m[1];
        }
    });
    flush();
    return { present: present, shipped: shipped };
}

// Read the routed target's TODO.md through the Worker and record every top-level
// entry's marker id (present) plus the CHECKED subset (shipped) into the
// per-repo marker cache. This is the cross-device source of truth for the row
// status glyph. Cached with a ~60s TTL keyed by `target.repo` (a fresh call
// inside the window is a no-op unless `force` is set) and coalesced so
// overlapping callers share one read. Pass `force` after an inject/delete so the
// real file reconciles promptly instead of waiting out the TTL. On a resolved
// read it dispatches TODO_RUN_STATUS_EVENT so rendered glyphs re-evaluate; a
// missing/malformed read stores two empty sets (no glyph) and never throws.
// Returns a promise that settles when the cache is up to date.
export function refreshShippedMarkers(target, force) {
    if (!target || !target.repo || !target.file_path) return Promise.resolve();
    const repo = target.repo;
    const cached = shippedMarkerCache.get(repo);
    if (!force && cached && (Date.now() - cached.fetchedAt) < SHIPPED_MARKERS_TTL_MS) {
        return Promise.resolve();
    }
    const inFlight = shippedMarkersInFlight.get(repo);
    if (inFlight) return inFlight;
    const p = readTodoMdFromWorker(target).then(function(res) {
        const markers = (res && res.ok && typeof res.content === 'string')
            ? parseTodoMdMarkers(res.content)
            : { present: new Set(), shipped: new Set() };
        shippedMarkerCache.set(repo, {
            present: markers.present,
            shipped: markers.shipped,
            fetchedAt: Date.now(),
        });
        emitTodoRunStatusChange();
    }).catch(function() {
        shippedMarkerCache.set(repo, {
            present: new Set(),
            shipped: new Set(),
            fetchedAt: Date.now(),
        });
    }).then(function() {
        shippedMarkersInFlight.delete(repo);
    });
    shippedMarkersInFlight.set(repo, p);
    return p;
}

// Resolve a project's routed inject target (via the same
// getProjectTargetId → findTargetById path the inject button uses) and refresh
// its shipped-marker cache. A no-op when inject isn't configured or the project
// has no linked target. Lets the row layer kick a refresh with only a project
// name in hand, without importing the target-cache internals. Pass `force` to
// bypass the TTL so a just-shipped run reconciles the row glyph immediately.
export function refreshShippedMarkersForProject(projectName, force) {
    if (!projectName || !isInjectConfigured()) return Promise.resolve();
    const targetId = listLogic.getProjectTargetId(projectName);
    if (!targetId) return Promise.resolve();
    const target = findTargetById(targetId);
    if (!target) return Promise.resolve();
    return refreshShippedMarkers(target, force);
}


// Mutate the target repo's TODO.md through the Worker's `rewrite` branch.
// Mirrors readTodoMdFromWorker's wiring (same URL + Bearer secret) but POSTs
// `{ rewrite: true, op, id, repo, filePath }`. `op` is one of `delete_entry`
// (removes the single entry whose `<!-- id: … -->` marker matches `id`),
// `clear_completed` (drops every completed `[x]` entry), or `clear_all` (wipes
// the whole backlog); `id` is only meaningful for `delete_entry`. The whole
// Worker payload is spread onto the result so callers can read a `skipped`
// flag (nothing matched). Returns `{ ok: false, reason }` via describeError on
// any failure, matching the inject button's error vocabulary.
export async function rewriteTodoMd(target, op, id) {
    if (!target || !target.repo || !target.file_path) {
        return { ok: false, reason: 'No target' };
    }
    try {
        const res = await postToWorker({
            rewrite: true,
            op: op,
            id: id,
            repo: target.repo,
            filePath: target.file_path,
        });
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Dispatch a Claude Code automation run through the same Worker the inject
// and read flows already use (same URL, same Bearer secret). Sends
// `{ dispatch: true, mode, entry_id, correlation_id, repo, filePath }` so the
// Worker triggers the routine in the requested mode. `backlog` mode lets the
// routine pick the next eligible task; `entry` mode targets a specific TODO.md
// entry by id. The Worker's dispatch branch returns `{ ok: true, dispatched:
// true, ... }` on success — that whole payload is spread onto the result so
// callers can surface an Actions-run link when the Worker provides one.
// Returns `{ ok: false, reason }` via describeError on any failure, matching
// the inject button's error vocabulary.
export async function dispatchRun(options) {
    const opts = options || {};
    const target = opts.target || null;
    try {
        const res = await postToWorker({
            dispatch: true,
            mode: opts.mode,
            entry_id: opts.entryId || '',
            correlation_id: opts.correlationId,
            repo: target ? target.repo : undefined,
            filePath: target ? target.file_path : undefined,
        });
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Fire the triage sweep for one project through the same Worker the dispatch
// and status flows already use (same URL + Bearer secret). POSTs
// `{ dispatch_triage: true, project_id, correlation_id, repo, filePath }` so the
// Worker dispatches claude-triage.yml against the project's linked repo (or its
// default when `target` is null). Triage is a batch, read-only sweep, so this is
// fire-and-forget — the Agent board reflects the verdicts live via the
// agent_queue realtime subscription and there is nothing to poll here. The
// correlation_id is optional (used only for the run name) and carries no UI
// meaning; `project_id` scopes the Supabase sweep and is orthogonal to the repo.
// The Worker payload is spread onto `{ ok: true }` on success; on any failure it
// returns `{ ok: false, reason }` via describeError, matching dispatchRun's
// error vocabulary.
export async function dispatchTriage(projectId, correlationId, target) {
    try {
        const res = await postToWorker({
            dispatch_triage: true,
            project_id: projectId,
            correlation_id: correlationId,
            repo: target ? target.repo : undefined,
            filePath: target ? target.file_path : undefined,
        });
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Poll a dispatched run's status through the same Worker the dispatch and
// read flows already use (same URL, same Bearer secret). Sends
// `{ status: true, correlation_id, repo, filePath }` so the Worker matches
// the run by correlation id and echoes back its lifecycle. The parsed
// response — `{ found, status, conclusion, runUrl, runId }` — is spread onto
// an `{ ok: true }` envelope so the viewer header pill can map it to a state.
// Returns `{ ok: false, reason }` via describeError on any failure, matching
// the vocabulary dispatchRun and the inject button already use. The
// correlation_id is internal plumbing for this call only — it is never shown
// in the UI.
export async function pollRunStatus(options) {
    const opts = options || {};
    const target = opts.target || null;
    try {
        const res = await postToWorker({
            status: true,
            correlation_id: opts.correlationId,
            repo: target ? target.repo : undefined,
            filePath: target ? target.file_path : undefined,
        });
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Ambient, fire-and-forget probe of whether the target repo has ANY run in
// flight right now, through the same Worker the dispatch and status flows
// already use (same URL, same Bearer secret). POSTs
// `{ active_runs: true, repo, filePath }` so the Worker reports repo-level
// in-flight state. When `workflow` is passed (e.g. `'triage'`), it is included
// in the body so the Worker scopes the probe to that workflow's runs
// (`claude-triage.yml`) rather than the default ship workflow (`claude-run.yml`);
// existing callers pass just `target`, so the field is omitted and behavior is
// unchanged. The parsed response — `{ active, count, newest }` — is spread onto
// an `{ ok: true }` envelope, mirroring pollRunStatus. Returns
// `{ ok: false, reason }` via describeError on any failure; callers treat
// `ok:false` as "not active" and never raise an error toast, since this is a
// background liveness probe (cross-device "is something running?") rather than
// a user-initiated action.
export async function fetchActiveRuns(target, workflow) {
    const t = target || null;
    try {
        const res = await postToWorker({
            active_runs: true,
            repo: t ? t.repo : undefined,
            filePath: t ? t.file_path : undefined,
            workflow: workflow || undefined,
        });
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Ambient, fire-and-forget probe of the target repo's latest GitHub Pages
// deployment, through the same Worker the dispatch and status flows already use
// (same URL, same Bearer secret). POSTs `{ pages_status: true, repo, filePath }`
// so the Worker reports the newest "pages build and deployment" run. The parsed
// response — `{ status, conclusion, ... }` — is spread onto an `{ ok: true }`
// envelope, mirroring fetchActiveRuns: `status !== 'completed'` means a publish
// is in flight, and on a completed run `conclusion` is `success` / `failure`.
// Returns `{ ok: false, reason }` via describeError on any failure; callers
// treat `ok:false` as "leave the current state" and never raise an error toast,
// since this is a background health probe rather than a user-initiated action.
export async function fetchPagesStatus(target) {
    const t = target || null;
    try {
        const res = await postToWorker({
            pages_status: true,
            repo: t ? t.repo : undefined,
            filePath: t ? t.file_path : undefined,
        });
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Kick off a fresh GitHub Pages publish for the target repo through the same
// Worker every other call here uses (same URL + Bearer secret). POSTs
// `{ pages_rebuild: true, repo, filePath }` so the Worker re-triggers the
// "pages build and deployment" that occasionally fails and leaves the live site
// stale. The parsed response is spread onto an `{ ok: true }` envelope, mirroring
// fetchActiveRuns; callers flip the Redeploy pill to its optimistic "Deploying"
// state on `ok:true` and then poll fetchPagesStatus to settle it. Returns
// `{ ok: false, reason }` via describeError on any failure, matching the
// vocabulary the other Worker calls already use.
export async function requestPagesRebuild(target) {
    const t = target || null;
    try {
        const res = await postToWorker({
            pages_rebuild: true,
            repo: t ? t.repo : undefined,
            filePath: t ? t.file_path : undefined,
        });
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Fetch the closing summary a completed run left behind — the agent's verdict on
// why it merged nothing — through the same Worker the dispatch and status flows
// use (same URL + Bearer secret). POSTs `{ run_result: true, run_id, repo,
// filePath }`; the Worker resolves the run's result and echoes `{ result }` (the
// summary text). The run is keyed by `run_id` (the numeric GitHub Actions run id
// persisted at reconcile); older records that predate that field fall back to
// their correlation id, which the caller passes in `runId`'s place — the Worker
// resolves either. The parsed response is spread onto an `{ ok: true }` envelope,
// mirroring pollRunStatus. Returns `{ ok: false, reason }` via describeError on
// any failure; callers treat a missing/empty `result` as "couldn't read the
// summary" and degrade to the full-log link rather than raising an error toast.
export async function fetchRunResult(runId, target) {
    const t = target || null;
    try {
        const payload = { run_result: true };
        if (runId) payload.run_id = runId;
        if (t) {
            payload.repo = t.repo;
            payload.filePath = t.file_path;
        }
        const res = await postToWorker(payload);
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Cross-check whether an entry's marker is present in a merged PR through the
// same Worker the dispatch and status flows already use (same URL, same Bearer
// secret). Sends `{ resolve: true, entry_id }` so the Worker searches merged PR
// bodies for the entry's `<!-- id: entry_id -->` marker and echoes back
// `{ found, pr_number, merge_commit_sha }`. A `found:true` carrying a
// `merge_commit_sha` is positive proof the entry shipped — used to retroactively
// promote a run record that was over-asserted as FAILED back to SHIPPED.
// Returns `{ ok: false, reason }` via describeError on any failure, matching the
// vocabulary dispatchRun and pollRunStatus already use.
export async function resolveEntryByMarker(entryId) {
    if (!entryId) return { ok: false, reason: 'No entry id' };
    try {
        const res = await postToWorker({ resolve: true, entry_id: entryId });
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Roll back an entry's shipped change through the Worker's already-deployed
// full-auto `revert` route (same URL + Bearer secret as every other call here).
// POSTs `{ revert: true, entry_id }` — plus `repo` + `filePath` from `target`
// when supplied, so a run shipped to a non-default workspace reverts against the
// correct repo, mirroring pollRunStatus. The Worker resolves the marker to its
// merged PR, opens a revert PR via GraphQL, and auto-merges it so deploy.yml
// ships the rollback. The parsed response — `{ merged, reason, revert_pr_url }`
// — is spread onto an `{ ok: true }` envelope: `merged:true` is a completed
// rollback, `merged:false` carries a `reason` and `revert_pr_url` for the user
// to finish in GitHub. Returns `{ ok: false, reason }` via describeError on any
// failure (404 nothing-to-revert, 409 already-a-revert, 5xx), matching the
// vocabulary the other Worker calls already use.
export async function revertEntry(entryId, target) {
    if (!entryId) return { ok: false, reason: 'No entry id' };
    try {
        const payload = { revert: true, entry_id: entryId };
        if (target) {
            payload.repo = target.repo;
            payload.filePath = target.file_path;
        }
        const res = await postToWorker(payload);
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}


// Fetch the Worker's allowlist of repos the chat workspace can target. Mirrors
// postToWorker's wiring (same URL + Bearer secret) but POSTs `{ repos: true }`,
// to which the Worker replies `{ ok: true, default, repos: [{ repo, srcPrefix }] }`.
// Returns the parsed `{ default, repos }` object on success, or null on any
// failure so the caller can fall back to a hardcoded default and degrade
// gracefully without surfacing an error.
export async function fetchAllowedRepos() {
    try {
        const res = await postToWorker({ repos: true });
        if (!res || !Array.isArray(res.repos)) return null;
        return { default: res.default, repos: res.repos };
    } catch (e) {
        return null;
    }
}


// Test connection sends `{ test: true }` plus repo/filePath when at least
// one target is defined — the Worker exercises the same route a real
// inject would take. With no targets defined, the request omits repo/
// filePath entirely so the Worker falls back to its default target;
// keeps "Test connection" usable before the user has set up any targets.
async function testConnection() {
    const first = (cachedTargets && cachedTargets.length > 0) ? cachedTargets[0] : null;
    try {
        const body = { test: true };
        if (first) {
            body.repo = first.repo;
            body.filePath = first.file_path;
        }
        await postToWorker(body);
        writeLastTest('ok', first ? first.nickname : '');
        const label = first
            ? 'Connected (target: ' + first.nickname + ')'
            : 'Connected';
        return { ok: true, label: label };
    } catch (e) {
        const label = describeError(e);
        writeLastTest(label, '');
        return { ok: false, label: label };
    }
}


// ── INJECT BUTTON FACTORY ──
// Builds a single inject button used in both the desktop descSibling panel
// and the mobile edit modal. Returns the button element. State is computed
// from `item` via refreshInjectButton — callers should re-refresh when the
// description changes (becomes empty / non-empty) or after a successful
// inject.
//
// `options.onInjected(item)` fires after a successful POST so callers can
// re-sync any other UI they own (e.g., the mobile edit modal can swap its
// own copy of the button alongside the row's). The handler stashes the
// item on the button so refreshAllInjectButtons can re-render every visible
// button after a config change without each caller re-registering.
export function makeInjectButton(item, options) {
    const opts = options || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'injectBtn';
    btn._injectItem = item;
    btn._injectProjectName = typeof opts.projectName === 'string'
        ? opts.projectName
        : '';

    // Inline SVG icons — upload arrow for ready/unconfigured, checkmark for
    // injected. Matching the inline-SVG approach used elsewhere in the app
    // (toDoRow.js, modals.js) instead of importing icon assets.
    btn.innerHTML = injectBtnInnerHTML('ready');

    refreshInjectButton(btn, item);

    btn.addEventListener('click', async function(event) {
        event.stopPropagation();
        if (btn.disabled) return;
        const state = btn.dataset.state || '';

        if (state === 'unconfigured') {
            showInjectSettingsModal();
            return;
        }
        if (state === 'no-target') {
            showInjectSettingsModal({ focusSection: 'projectRouting' });
            return;
        }
        if (state === 'injected') return;
        if (state === 'ready') {
            // Disable immediately to block double-clicks during the in-
            // flight request (acceptance criteria: double-click must not
            // produce two commits).
            btn.disabled = true;
            const targetId = listLogic.getProjectTargetId(btn._injectProjectName || '');
            const target = findTargetById(targetId);
            const result = await injectDescription(item, target);
            if (result.ok) {
                showInjectToast('Injected to TODO.md');
                refreshInjectButton(btn, item);
                // injectDescription just stamped item.injectedAt — surface the
                // amber pending dot on this row's description indicator now.
                emitTodoRunStatusChange();
                if (typeof opts.onInjected === 'function') opts.onInjected(item);
            } else {
                showInjectToast('Inject failed — ' + result.reason, 'error');
                btn.disabled = false;
            }
        }
    });

    return btn;
}

function injectBtnInnerHTML(state) {
    if (state === 'injected') {
        return '<svg class="injectBtnIcon" viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 7.5 6 10.5 11 4.5"/></svg>'
             + '<span class="injectBtnLabel">Injected</span>';
    }
    return '<svg class="injectBtnIcon" viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="11.5" x2="7" y2="3"/><polyline points="3.5 6.5 7 3 10.5 6.5"/><line x1="3" y1="13" x2="11" y2="13"/></svg>'
         + '<span class="injectBtnLabel"></span>';
}

// State precedence (top wins):
//   1. unconfigured  — no Worker URL / shared secret on this device
//   2. no-target     — project has no inject_targets row mapped
//   3. hidden        — description text is empty
//   4. injected      — item.injectedAt already set
//   5. ready         — terminal happy-path state
// (1) and (2) are visible-but-dimmed call-to-action states that override
// the empty-desc hide so the user always has a place to fix the missing
// pre-requisite. Once both are satisfied, the button reverts to the
// "hides on empty desc" rhythm the description editor depends on.
export function refreshInjectButton(btn, item, projectName) {
    if (!btn || !item) return;
    btn._injectItem = item;
    if (typeof projectName === 'string') {
        btn._injectProjectName = projectName;
    }
    const project = btn._injectProjectName || '';

    if (!isInjectConfigured()) {
        btn.style.display = '';
        btn.dataset.state = 'unconfigured';
        btn.disabled = false;
        btn.classList.add('injectBtn--unconfigured');
        btn.classList.remove('injectBtn--no-target');
        btn.classList.remove('injectBtn--injected');
        btn.innerHTML = injectBtnInnerHTML('unconfigured');
        const label = btn.querySelector('.injectBtnLabel');
        if (label) label.textContent = 'Inject';
        btn.setAttribute('aria-label', 'Open inject settings');
        btn.title = 'Inject is not configured — open settings';
        return;
    }

    const targetId = project ? listLogic.getProjectTargetId(project) : null;
    if (!targetId) {
        btn.style.display = '';
        btn.dataset.state = 'no-target';
        btn.disabled = false;
        btn.classList.add('injectBtn--no-target');
        btn.classList.remove('injectBtn--unconfigured');
        btn.classList.remove('injectBtn--injected');
        btn.innerHTML = injectBtnInnerHTML('no-target');
        const noTargetLabel = btn.querySelector('.injectBtnLabel');
        if (noTargetLabel) noTargetLabel.textContent = 'Set inject target';
        btn.setAttribute('aria-label', 'Set inject target for this project');
        btn.title = "This project doesn't have an inject target — open settings";
        return;
    }

    const hasDesc = !!(item.desc && item.desc.trim().length > 0);
    if (!hasDesc) {
        btn.style.display = 'none';
        btn.disabled = true;
        btn.dataset.state = 'hidden';
        return;
    }
    btn.style.display = '';

    if (item.injectedAt) {
        btn.dataset.state = 'injected';
        btn.disabled = true;
        btn.classList.remove('injectBtn--unconfigured');
        btn.classList.remove('injectBtn--no-target');
        btn.classList.add('injectBtn--injected');
        btn.innerHTML = injectBtnInnerHTML('injected');
        btn.setAttribute('aria-label', 'Already injected to TODO.md');
        btn.title = 'This description was already sent to TODO.md';
        return;
    }

    btn.dataset.state = 'ready';
    btn.disabled = false;
    btn.classList.remove('injectBtn--unconfigured');
    btn.classList.remove('injectBtn--no-target');
    btn.classList.remove('injectBtn--injected');
    btn.innerHTML = injectBtnInnerHTML('ready');
    const label = btn.querySelector('.injectBtnLabel');
    if (label) label.textContent = 'Inject to TODO.md';
    btn.setAttribute('aria-label', 'Inject description to TODO.md');
    btn.title = 'Send this description to TODO.md';
}

// Look up a target by id in the module-level cache populated by
// loadInjectTargets. Returns null when the id doesn't match or the cache
// is empty (e.g. before initInjectTargets has run). Exported so the click
// handler can resolve the active project's target_id into a row without
// re-fetching from Supabase on every inject.
export function findTargetById(id) {
    if (!id || !Array.isArray(cachedTargets)) return null;
    for (let i = 0; i < cachedTargets.length; i++) {
        if (cachedTargets[i] && cachedTargets[i].id === id) return cachedTargets[i];
    }
    return null;
}

// Warm the targets cache at app boot so inject buttons rendering before
// the settings modal opens can already resolve their project's
// target_id. Called from main.js after the Supabase session is ready.
export async function initInjectTargets() {
    await loadInjectTargets();
    refreshAllInjectButtons();
}

function refreshAllInjectButtons() {
    const buttons = document.querySelectorAll('.injectBtn');
    buttons.forEach(function(btn) {
        const item = btn._injectItem;
        if (item) refreshInjectButton(btn, item);
    });
    // Inject-cache state changed (targets loaded, routing toggled,
    // config saved/cleared) — give the read-only TODO.md viewer card
    // in main.js a chance to re-evaluate against the new state. Reusing
    // the existing mainListRendered event keeps the viewer's wiring to
    // a single listener.
    try {
        document.dispatchEvent(new CustomEvent('mainListRendered'));
    } catch (e) { /* defensive */ }
}


// ── INJECT TARGETS ──
// Targets are stored in the `inject_targets` Supabase table, scoped per-
// user via RLS. The settings modal lists them; an add/edit sub-modal
// writes through here. The inject button itself does NOT consume these
// yet — per-project routing lands in a follow-up entry.

export async function loadInjectTargets() {
    try {
        const res = await supabase
            .from('inject_targets')
            .select()
            .order('created_at');
        if (res && res.error) {
            cachedTargets = [];
            return cachedTargets;
        }
        cachedTargets = (res && res.data) || [];
        return cachedTargets;
    } catch (e) {
        cachedTargets = [];
        return cachedTargets;
    }
}

// Read-only snapshot of the inject-targets cache populated by loadInjectTargets.
// The chat workspace menu projects this list (mapped to each row's `repo`) as
// its single source of truth, so the menu and Inject settings never drift.
// Returns a shallow copy so callers can't mutate the cache in place.
export function getCachedTargets() {
    return Array.isArray(cachedTargets) ? cachedTargets.slice() : [];
}

// Tell any listener (the chat workspace menu) that the inject-targets set
// changed on a successful Supabase write, so it can re-project its repo list
// without a page reload. Coalesce a burst of mutations into a single event via
// a microtask hop — rapid add/edit/deletes repaint once rather than per write.
let injectTargetsChangedPending = false;
function notifyInjectTargetsChanged() {
    if (injectTargetsChangedPending) return;
    injectTargetsChangedPending = true;
    Promise.resolve().then(function() {
        injectTargetsChangedPending = false;
        try {
            document.dispatchEvent(new CustomEvent('injectTargetsChanged'));
        } catch (e) { /* defensive: non-DOM environment */ }
    });
}

async function insertInjectTarget(values) {
    try {
        const sessionResult = await supabase.auth.getSession();
        const session = sessionResult
            && sessionResult.data
            && sessionResult.data.session;
        if (!session) return { ok: false, reason: 'Not signed in' };
        const row = {
            user_id: session.user.id,
            nickname: values.nickname,
            repo: values.repo,
            file_path: values.file_path,
        };
        const res = await supabase.from('inject_targets').insert(row);
        if (res && res.error) return classifyTargetError(res.error);
        notifyInjectTargetsChanged();
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: 'Save failed' };
    }
}

async function updateInjectTarget(id, values) {
    try {
        const res = await supabase
            .from('inject_targets')
            .update({
                nickname: values.nickname,
                repo: values.repo,
                file_path: values.file_path,
            })
            .eq('id', id);
        if (res && res.error) return classifyTargetError(res.error);
        notifyInjectTargetsChanged();
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: 'Save failed' };
    }
}

// Persist ONLY the `enabled` flag for a target. Kept separate from
// updateInjectTarget so the enable/disable toggle never touches the
// nickname/repo/file_path columns (and never sends user_id — the table's
// RLS gates on user_id = auth.uid() and the update must not overwrite it).
async function setInjectTargetEnabled(id, enabled) {
    try {
        const res = await supabase
            .from('inject_targets')
            .update({ enabled: enabled })
            .eq('id', id);
        if (res && res.error) return { ok: false, reason: 'Save failed' };
        notifyInjectTargetsChanged();
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: 'Save failed' };
    }
}

async function deleteInjectTarget(id) {
    try {
        const res = await supabase
            .from('inject_targets')
            .delete()
            .eq('id', id);
        if (res && res.error) return { ok: false, reason: 'Delete failed' };
        notifyInjectTargetsChanged();
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: 'Delete failed' };
    }
}

// Map a Supabase error into either a nickname-collision (so the sub-modal
// can surface it inline against the offending field) or a generic save
// failure. The unique constraint on (user_id, nickname) is the source of
// truth for duplicate detection — we just translate its error shape.
function classifyTargetError(err) {
    const code = err && err.code;
    const msg  = (err && err.message) || '';
    if (code === '23505' || /duplicate|unique/i.test(msg)) {
        return { ok: false, reason: 'duplicate-nickname' };
    }
    return { ok: false, reason: 'Save failed' };
}

function validateTargetForm(values) {
    const errors = {};
    if (!values.nickname) errors.nickname = 'Nickname is required';
    if (!values.repo) {
        errors.repo = 'Repo is required';
    } else if (!/^[^\s/]+\/[^\s/]+$/.test(values.repo)) {
        errors.repo = 'Use the format owner/repository';
    }
    if (!values.file_path) errors.file_path = 'File path is required';
    return errors;
}


// ── TARGET SUB-MODAL ──
// Add / edit sub-modal mounted on top of the settings modal. Escape only
// closes this sub-modal — the parent settings modal stays open. Closes
// the same 3 ways as the parent (X / backdrop / Escape).
function showInjectTargetSubModal(options) {
    const opts = options || {};
    const existing = opts.target || null;
    const isEdit = !!existing;

    const prior = document.getElementById('injectTargetSubBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'injectTargetSubBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'injectTargetSubModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'injectTargetSubTitle');

    const header = document.createElement('div');
    header.id = 'injectTargetSubHeader';
    const title = document.createElement('div');
    title.id = 'injectTargetSubTitle';
    title.textContent = isEdit ? 'Edit inject target' : 'Add inject target';
    const closeX = document.createElement('button');
    closeX.id = 'injectTargetSubClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close target editor');
    closeX.textContent = '×';
    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'injectTargetSubBody';

    function makeField(labelText, inputId, placeholder, initial) {
        const wrap = document.createElement('label');
        wrap.className = 'injectFieldLabel';
        wrap.textContent = labelText;
        const input = document.createElement('input');
        input.id = inputId;
        input.className = 'injectTargetSubInput';
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        if (placeholder) input.placeholder = placeholder;
        input.value = initial || '';
        const err = document.createElement('div');
        err.className = 'injectTargetSubError';
        err.id = inputId + 'Error';
        err.setAttribute('aria-live', 'polite');
        wrap.appendChild(input);
        wrap.appendChild(err);
        body.appendChild(wrap);
        return { input: input, err: err };
    }

    const nicknameField = makeField(
        'Nickname',
        'injectTargetNicknameInput',
        '',
        existing ? existing.nickname : ''
    );
    const repoField = makeField(
        'Repo',
        'injectTargetRepoInput',
        'owner/repository',
        existing ? existing.repo : ''
    );
    const filePathField = makeField(
        'File path',
        'injectTargetFilePathInput',
        '',
        existing ? existing.file_path : 'TODO.md'
    );

    const actions = document.createElement('div');
    actions.id = 'injectTargetSubActions';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'injectTargetSubCancel';
    cancelBtn.type = 'button';
    cancelBtn.className = 'injectSettingsBtn';
    cancelBtn.textContent = 'Cancel';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'injectTargetSubSave';
    saveBtn.type = 'button';
    saveBtn.className = 'injectSettingsBtn injectSettingsBtn--primary';
    saveBtn.textContent = 'Save';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    function clearErrors() {
        nicknameField.err.textContent = '';
        repoField.err.textContent = '';
        filePathField.err.textContent = '';
    }

    function setError(field, msg) {
        field.err.textContent = msg || '';
    }

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    // Capture-phase keydown so Escape closes only the sub-modal and the
    // parent settings modal's Escape handler never fires for the same
    // event. stopPropagation prevents the bubble-phase parent handler.
    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            close();
        }
    }

    closeX.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);

    async function onSave() {
        clearErrors();
        const values = {
            nickname: nicknameField.input.value.trim(),
            repo: repoField.input.value.trim(),
            file_path: filePathField.input.value.trim(),
        };
        const errors = validateTargetForm(values);
        if (errors.nickname || errors.repo || errors.file_path) {
            if (errors.nickname) setError(nicknameField, errors.nickname);
            if (errors.repo) setError(repoField, errors.repo);
            if (errors.file_path) setError(filePathField, errors.file_path);
            return;
        }
        saveBtn.disabled = true;
        // Save-time allowlist gate: a repo not in the Worker's
        // ALLOWED_TARGETS saves cleanly but then silently fails at
        // inject/dispatch time. Block the write when the allowlist
        // resolves without this repo. If the fetch is null/throws
        // (Worker unreachable), fall through and allow the save —
        // graceful degradation over blocking on a transient failure.
        const allowed = await fetchAllowedRepos();
        if (allowed && !allowed.repos.some(r => r.repo === values.repo)) {
            saveBtn.disabled = false;
            setError(repoField, 'Not in the Worker allowlist — add it to ALLOWED_TARGETS first');
            return;
        }
        const result = isEdit
            ? await updateInjectTarget(existing.id, values)
            : await insertInjectTarget(values);
        saveBtn.disabled = false;
        if (!result.ok) {
            if (result.reason === 'duplicate-nickname') {
                setError(nicknameField, 'A target with this nickname already exists');
            } else {
                setError(nicknameField, result.reason || 'Save failed');
            }
            return;
        }
        close();
        if (typeof opts.onSaved === 'function') opts.onSaved();
    }

    saveBtn.addEventListener('click', onSave);

    setTimeout(function() {
        try { nicknameField.input.focus(); } catch (e) { /* defensive */ }
    }, 0);
}


// ── ONBOARD A NEW REPO ──
// In-flight onboarding requests keyed by lowercased repo. Each value is
// `{ repo, startedAt, failed }`. renderTargets renders a transient pending
// (or failed) placeholder row for any repo here that isn't yet a real
// target; the completion poll clears it once the server-side registry row
// appears. Module-level so it survives the settings modal closing and
// reopening mid-flight.
const pendingOnboards = new Map();

// Set by showInjectSettingsModal to its refreshTargets closure while the
// panel is mounted, cleared on close. The completion poll calls it (through
// refreshOnboardPanel) to swap a pending placeholder for the real row
// without reaching into the modal closure.
let onboardRefreshHook = null;

const ONBOARD_POLL_INTERVAL_MS = 4000;
const ONBOARD_POLL_MAX_ATTEMPTS = 15; // ~60s total

// Rocket glyph reused by the onboard card and the Onboard button. Inline SVG
// (no icon library, per CLAUDE.md) drawn to match the sub-modal's stroke look.
function onboardRocketSvg() {
    return '<svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 1.5c2.2 1.3 3.3 3.6 3.3 6.2 0 1.4-.4 2.7-1 3.8H5.7c-.6-1.1-1-2.4-1-3.8 0-2.6 1.1-4.9 3.3-6.2z"/><circle cx="8" cy="6.4" r="1.2"/><path d="M5.7 11.5l-1.8 1.1.6-2.7M10.3 11.5l1.8 1.1-.6-2.7M6.9 11.5v2.2M9.1 11.5v2.2"/></svg>';
}

// Normalize a repo string for case-insensitive comparison against the
// registry (`cachedTargets[i].repo`) and the pendingOnboards keys.
function normalizeOnboardRepo(repo) {
    return String(repo || '').trim().toLowerCase();
}

// Fire the Worker's onboard route for a new repo. Mirrors dispatchRun exactly:
// gates on isInjectConfigured() via postToWorker (Bearer-secret POST), spreads
// the Worker payload onto `{ ok: true }` on success — the onboard branch
// returns `{ ok: true, dispatched: true, ... }` — and returns `{ ok: false,
// reason }` via describeError on any failure, matching the inject button's
// error vocabulary. `shape` defaults to 'auto' (Worker auto-detects the repo
// shape) when omitted.
export async function onboardRepo(targetRepo, shape) {
    try {
        const res = await postToWorker({
            onboard: true,
            target_repo: targetRepo,
            shape: shape || 'auto',
        });
        return Object.assign({ ok: true }, res || {});
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}

// Re-render the settings panel's target rows if it's still mounted, so a
// resolved/failed onboard placeholder is replaced without reaching into the
// modal closure. No-op when the panel is closed — pendingOnboards still holds
// the state, so reopening the panel re-renders the in-flight row.
function refreshOnboardPanel() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('injectTargetsBody')) return;
    if (typeof onboardRefreshHook === 'function') onboardRefreshHook();
}

// After a successful onboard dispatch, poll the inject-targets registry until
// the server-side row for `repo` appears. onboard.sh inserts that row in CI
// (Supabase), so the client's injectTargetsChanged event never fires and the
// row won't show on its own — hence the poll. On appearance, drop the pending
// entry and refresh the panel so the real row replaces the placeholder; on
// timeout (~60s), flip the pending entry to a failed state. Updates module
// state regardless of panel visibility; only touches the DOM through
// refreshOnboardPanel when the targets body is still mounted.
function startOnboardPoll(repo) {
    const key = normalizeOnboardRepo(repo);
    let attempts = 0;
    async function tick() {
        // Stop if the pending entry was dismissed/cleared meanwhile.
        if (!pendingOnboards.has(key)) return;
        attempts += 1;
        const targets = await loadInjectTargets();
        const present = Array.isArray(targets) && targets.some(function(t) {
            return t && normalizeOnboardRepo(t.repo) === key;
        });
        if (present) {
            pendingOnboards.delete(key);
            refreshOnboardPanel();
            return;
        }
        if (attempts >= ONBOARD_POLL_MAX_ATTEMPTS) {
            const entry = pendingOnboards.get(key);
            if (entry) entry.failed = true;
            refreshOnboardPanel();
            return;
        }
        setTimeout(tick, ONBOARD_POLL_INTERVAL_MS);
    }
    setTimeout(tick, ONBOARD_POLL_INTERVAL_MS);
}


// ── ONBOARD SUB-MODAL ──
// Sub-modal for onboarding a new repo into the pipeline, mounted on top of the
// settings modal. Structurally modeled on showInjectTargetSubModal: same
// backdrop/dialog/header-with-×/body/footer, and the same three close
// affordances (× / backdrop / capture-phase Escape) so Escape closes only this
// sub-modal, not the parent settings modal. `options.onDispatched` is invoked
// after a successful dispatch so the caller can render the pending placeholder.
function showOnboardModal(options) {
    const opts = options || {};

    const prior = document.getElementById('injectOnboardBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'injectOnboardBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'injectOnboardModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'injectOnboardTitle');

    const header = document.createElement('div');
    header.id = 'injectOnboardHeader';
    const title = document.createElement('div');
    title.id = 'injectOnboardTitle';
    title.textContent = 'Onboard a new repo';
    const closeX = document.createElement('button');
    closeX.id = 'injectOnboardClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close onboard dialog');
    closeX.textContent = '×';
    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'injectOnboardBody';

    // Repo field (required).
    const repoWrap = document.createElement('label');
    repoWrap.className = 'injectFieldLabel';
    repoWrap.textContent = 'Repository (owner/name)';
    const repoInput = document.createElement('input');
    repoInput.id = 'injectOnboardRepoInput';
    repoInput.className = 'injectTargetSubInput';
    repoInput.type = 'text';
    repoInput.autocomplete = 'off';
    repoInput.spellcheck = false;
    repoInput.placeholder = 'rsterenchak/my-repo';
    const repoErr = document.createElement('div');
    repoErr.className = 'injectTargetSubError';
    repoErr.id = 'injectOnboardRepoError';
    repoErr.setAttribute('aria-live', 'polite');
    repoWrap.appendChild(repoInput);
    repoWrap.appendChild(repoErr);
    body.appendChild(repoWrap);

    // Shape field (optional — auto-detected).
    const shapeWrap = document.createElement('label');
    shapeWrap.className = 'injectFieldLabel';
    shapeWrap.textContent = 'Shape (optional — auto-detected)';
    const shapeSelect = document.createElement('select');
    shapeSelect.id = 'injectOnboardShapeSelect';
    shapeSelect.className = 'injectOnboardShapeSelect';
    ['auto', 'build', 'served', 'console', 'desktop', 'maui', 'sql', 'repo']
        .forEach(function(value) {
            const opt = document.createElement('option');
            opt.value = value;
            opt.textContent = value;
            shapeSelect.appendChild(opt);
        });
    shapeSelect.value = 'auto';
    shapeWrap.appendChild(shapeSelect);
    body.appendChild(shapeWrap);

    const actions = document.createElement('div');
    actions.id = 'injectOnboardActions';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'injectOnboardCancel';
    cancelBtn.type = 'button';
    cancelBtn.className = 'injectSettingsBtn';
    cancelBtn.textContent = 'Cancel';

    const onboardBtn = document.createElement('button');
    onboardBtn.id = 'injectOnboardSubmit';
    onboardBtn.type = 'button';
    onboardBtn.className = 'injectSettingsBtn injectSettingsBtn--primary';
    onboardBtn.innerHTML = onboardRocketSvg() + '<span>Onboard</span>';

    actions.appendChild(cancelBtn);
    actions.appendChild(onboardBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    // Capture-phase Escape so it closes only this sub-modal — the parent
    // settings modal's handler never fires for the same event.
    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            close();
        }
    }

    closeX.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);

    // Validate → dispatch. Trim, strip a trailing `.git`, require `owner/name`
    // (one slash, no spaces). On invalid, show the inline error and don't
    // dispatch.
    async function onSubmit() {
        repoErr.textContent = '';
        const repo = repoInput.value.trim().replace(/\.git$/i, '');
        if (!repo) {
            repoErr.textContent = 'Repository is required';
            return;
        }
        if (!/^[^\s/]+\/[^\s/]+$/.test(repo)) {
            repoErr.textContent = 'Use the format owner/name';
            return;
        }
        onboardBtn.disabled = true;
        const res = await onboardRepo(repo, shapeSelect.value);
        if (res && res.ok && res.dispatched) {
            close();
            showInjectToast("Onboarding started — it'll appear here when ready (~30s).");
            const key = normalizeOnboardRepo(repo);
            pendingOnboards.set(key, { repo: repo, startedAt: Date.now(), failed: false });
            startOnboardPoll(repo);
            if (typeof opts.onDispatched === 'function') opts.onDispatched();
            return;
        }
        onboardBtn.disabled = false;
        showInjectToast((res && res.reason) || 'Onboarding failed', 'error');
    }

    onboardBtn.addEventListener('click', onSubmit);

    setTimeout(function() {
        try { repoInput.focus(); } catch (e) { /* defensive */ }
    }, 0);
}


// ── SETTINGS MODAL ──
// Opens the per-device Inject settings dialog. Reads / writes the four
// localStorage keys above; Save and Clear both refresh every visible
// inject button so the row UI reflects new config immediately.
//
// `options.focusSection: 'projectRouting'` scrolls the Project routing
// section into view after the modal mounts. The inject button's
// no-target state passes this so a user clicking "Set inject target"
// lands directly on the row table they need to edit.
export function showInjectSettingsModal(options) {
    const openOpts = options || {};
    const prior = document.getElementById('injectSettingsBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'injectSettingsBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'injectSettingsModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'injectSettingsTitle');

    // Header
    const header = document.createElement('div');
    header.id = 'injectSettingsHeader';
    const title = document.createElement('div');
    title.id = 'injectSettingsTitle';
    title.textContent = 'Inject settings';
    const closeX = document.createElement('button');
    closeX.id = 'injectSettingsClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close inject settings');
    closeX.textContent = '×';
    header.appendChild(title);
    header.appendChild(closeX);

    // ── Connection section (collapsible) ──
    // A single status pill lives in the section header alongside an edit
    // (pencil) icon. When the section is collapsed, the inputs + action
    // row are hidden behind that one-line summary; when expanded, both
    // appear below. Auto-expanded when not configured or when the last
    // test wasn't OK — the user shouldn't have to hunt for the edit icon
    // to fix a broken connection.
    const connSection = document.createElement('div');
    connSection.id = 'injectConnectionSection';
    connSection.className = 'injectSettingsSection';

    const connHeader = document.createElement('div');
    connHeader.className = 'injectSettingsSectionHeader';

    const connTitle = document.createElement('div');
    connTitle.className = 'injectSettingsSectionTitle';
    connTitle.textContent = 'Connection (this device)';

    const statusRow = document.createElement('div');
    statusRow.id = 'injectSettingsStatusRow';

    const editBtn = document.createElement('button');
    editBtn.id = 'injectConnectionEditBtn';
    editBtn.type = 'button';
    editBtn.className = 'injectSectionEditBtn';
    editBtn.setAttribute('aria-label', 'Edit connection');
    editBtn.title = 'Edit connection';
    editBtn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 2.5l2 2-7 7-2.5.5.5-2.5 7-7z"/></svg>';

    connHeader.appendChild(connTitle);
    connHeader.appendChild(statusRow);
    connHeader.appendChild(editBtn);

    function renderStatus() {
        statusRow.innerHTML = '';
        const pill = document.createElement('span');
        pill.className = 'injectStatusPill';
        if (!isInjectConfigured()) {
            pill.textContent = 'Not configured';
            pill.classList.add('injectStatusPill--unconfigured');
        } else {
            const lt = readLastTest();
            if (!lt.ts) {
                pill.textContent = 'Configured · never tested';
                pill.classList.add('injectStatusPill--idle');
            } else if (lt.result === 'ok') {
                const head = lt.nickname
                    ? 'Connected (target: ' + lt.nickname + ')'
                    : 'Connected';
                pill.textContent = head + ' · last tested ' + relativeTime(lt.ts);
                pill.classList.add('injectStatusPill--ok');
            } else {
                pill.textContent = lt.result + ' · ' + relativeTime(lt.ts);
                pill.classList.add('injectStatusPill--err');
            }
        }
        statusRow.appendChild(pill);
    }

    // Body — inputs
    const body = document.createElement('div');
    body.id = 'injectSettingsBody';

    const urlLabel = document.createElement('label');
    urlLabel.className = 'injectFieldLabel';
    urlLabel.textContent = 'Worker URL';
    const urlInput = document.createElement('input');
    urlInput.id = 'injectWorkerUrlInput';
    urlInput.type = 'url';
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;
    urlInput.placeholder = 'https://your-worker.example.workers.dev';
    urlInput.value = cachedUrl;
    urlLabel.appendChild(urlInput);

    const secretLabel = document.createElement('label');
    secretLabel.className = 'injectFieldLabel';
    secretLabel.textContent = 'Shared secret';
    const secretWrap = document.createElement('div');
    secretWrap.className = 'injectSecretWrap';
    const secretInput = document.createElement('input');
    secretInput.id = 'injectSharedSecretInput';
    secretInput.type = 'password';
    secretInput.autocomplete = 'off';
    secretInput.spellcheck = false;
    secretInput.placeholder = '••••••••';
    secretInput.value = cachedSecret;
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.className = 'injectEyeBtn';
    eyeBtn.setAttribute('aria-label', 'Show secret');
    eyeBtn.title = 'Show / hide secret';
    eyeBtn.textContent = '👁';
    eyeBtn.addEventListener('click', function() {
        if (secretInput.type === 'password') {
            secretInput.type = 'text';
            eyeBtn.setAttribute('aria-label', 'Hide secret');
        } else {
            secretInput.type = 'password';
            eyeBtn.setAttribute('aria-label', 'Show secret');
        }
    });
    secretWrap.appendChild(secretInput);
    secretWrap.appendChild(eyeBtn);
    secretLabel.appendChild(secretWrap);

    body.appendChild(urlLabel);
    body.appendChild(secretLabel);

    // Action row — Save, Test connection, Clear (Clear pushed right and
    // visually separated as a destructive action).
    const actions = document.createElement('div');
    actions.id = 'injectSettingsActions';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'injectSettingsSave';
    saveBtn.type = 'button';
    saveBtn.className = 'injectSettingsBtn injectSettingsBtn--primary';
    saveBtn.textContent = 'Save';

    const testBtn = document.createElement('button');
    testBtn.id = 'injectSettingsTest';
    testBtn.type = 'button';
    testBtn.className = 'injectSettingsBtn';
    testBtn.textContent = 'Test connection';

    const spacer = document.createElement('div');
    spacer.className = 'injectSettingsActionsSpacer';

    const clearBtn = document.createElement('button');
    clearBtn.id = 'injectSettingsClear';
    clearBtn.type = 'button';
    clearBtn.className = 'injectSettingsBtn injectSettingsBtn--danger';
    clearBtn.textContent = 'Clear';

    actions.appendChild(saveBtn);
    actions.appendChild(testBtn);
    actions.appendChild(spacer);
    actions.appendChild(clearBtn);

    // The collapsible inner — body + actions hide together.
    const connBodyWrap = document.createElement('div');
    connBodyWrap.className = 'injectSettingsSectionBody';
    connBodyWrap.appendChild(body);
    connBodyWrap.appendChild(actions);

    connSection.appendChild(connHeader);
    connSection.appendChild(connBodyWrap);

    function setConnectionCollapsed(collapsed) {
        if (collapsed) {
            connSection.classList.add('injectSettingsSection--collapsed');
            editBtn.style.display = '';
        } else {
            connSection.classList.remove('injectSettingsSection--collapsed');
            editBtn.style.display = 'none';
        }
    }

    function shouldAutoCollapse() {
        if (!isInjectConfigured()) return false;
        const lt = readLastTest();
        return lt.ts > 0 && lt.result === 'ok';
    }

    editBtn.addEventListener('click', function() {
        setConnectionCollapsed(false);
        setTimeout(function() {
            try { urlInput.focus(); } catch (e) { /* defensive */ }
        }, 0);
    });

    // ── Inject targets section ──
    const targetsSection = document.createElement('div');
    targetsSection.id = 'injectTargetsSection';
    targetsSection.className = 'injectSettingsSection';

    const targetsHeader = document.createElement('div');
    targetsHeader.className = 'injectSettingsSectionHeader';
    const targetsTitle = document.createElement('div');
    targetsTitle.className = 'injectSettingsSectionTitle';
    targetsTitle.textContent = 'Inject targets';
    targetsHeader.appendChild(targetsTitle);

    const targetsBody = document.createElement('div');
    targetsBody.id = 'injectTargetsBody';
    targetsBody.className = 'injectSettingsSectionBody';

    targetsSection.appendChild(targetsHeader);
    targetsSection.appendChild(targetsBody);

    // Transient pending / failed onboard placeholder row, built from a
    // pendingOnboards entry. Rendered only for repos not yet in the registry
    // (a real row always wins). Failed rows carry a dismiss (×) that clears
    // the entry from pendingOnboards.
    function buildOnboardPlaceholderRow(entry, key) {
        const row = document.createElement('div');
        row.className = 'injectTargetRow injectTargetRow--pending';
        row.dataset.onboardRepo = entry.repo;

        const marker = document.createElement('span');
        if (entry.failed) {
            row.classList.add('injectTargetRow--onboard-failed');
            marker.className = 'injectOnboardFailGlyph';
            marker.setAttribute('aria-hidden', 'true');
            marker.textContent = '!';
        } else {
            marker.className = 'injectOnboardSpinner';
            marker.setAttribute('aria-hidden', 'true');
        }
        row.appendChild(marker);

        const info = document.createElement('div');
        info.className = 'injectTargetInfo';
        const nick = document.createElement('div');
        nick.className = 'injectTargetNickname';
        const detail = document.createElement('div');
        detail.className = 'injectTargetDetail';
        if (entry.failed) {
            nick.textContent = 'Onboarding didn’t complete — check the Actions run';
            detail.textContent = entry.repo;
        } else {
            nick.textContent = 'Onboarding ' + entry.repo + '…';
            detail.textContent = 'scaffolding + configuring · ~30s';
        }
        info.appendChild(nick);
        info.appendChild(detail);
        row.appendChild(info);

        if (entry.failed) {
            const dismiss = document.createElement('button');
            dismiss.type = 'button';
            dismiss.className = 'injectTargetIconBtn';
            dismiss.setAttribute('aria-label', 'Dismiss onboarding for ' + entry.repo);
            dismiss.title = 'Dismiss';
            dismiss.textContent = '×';
            dismiss.addEventListener('click', function() {
                pendingOnboards.delete(key);
                renderTargets();
            });
            row.appendChild(dismiss);
        }
        return row;
    }

    function renderTargets() {
        targetsBody.innerHTML = '';
        if (!cachedTargets || cachedTargets.length === 0) {
            const empty = document.createElement('div');
            empty.id = 'injectTargetsEmpty';
            empty.className = 'injectTargetsEmpty';
            empty.textContent = 'No targets defined yet — add one to start routing';
            targetsBody.appendChild(empty);
        } else {
            const list = document.createElement('div');
            list.id = 'injectTargetsList';
            list.className = 'injectTargetsList';
            cachedTargets.forEach(function(target) {
                list.appendChild(renderTargetRow(target));
            });
            targetsBody.appendChild(list);
        }
        // Pending / failed onboard placeholders, after the real rows and before
        // the Add button + onboard card. Skip any repo that's already a real
        // target (the registry row won the race).
        const presentRepos = new Set();
        (cachedTargets || []).forEach(function(t) {
            if (t && t.repo) presentRepos.add(normalizeOnboardRepo(t.repo));
        });
        pendingOnboards.forEach(function(entry, key) {
            if (presentRepos.has(key)) return;
            targetsBody.appendChild(buildOnboardPlaceholderRow(entry, key));
        });
        const addBtn = document.createElement('button');
        addBtn.id = 'injectAddTargetBtn';
        addBtn.type = 'button';
        addBtn.className = 'injectSettingsBtn injectSettingsBtn--primary';
        addBtn.textContent = '+ Add target';
        addBtn.addEventListener('click', function() {
            showInjectTargetSubModal({
                target: null,
                onSaved: refreshTargets,
            });
        });
        targetsBody.appendChild(addBtn);

        // Distinct, heavier onboard action — scaffolds, configures & registers
        // a brand-new repo through the Worker's onboard route, versus the
        // instant "+ Add target" row insert.
        const onboardCard = document.createElement('button');
        onboardCard.id = 'injectOnboardCard';
        onboardCard.type = 'button';
        onboardCard.className = 'injectOnboardCard';
        const cardIcon = document.createElement('span');
        cardIcon.className = 'injectOnboardCardIcon';
        cardIcon.setAttribute('aria-hidden', 'true');
        cardIcon.innerHTML = onboardRocketSvg();
        const cardText = document.createElement('span');
        cardText.className = 'injectOnboardCardText';
        const cardTitle = document.createElement('span');
        cardTitle.className = 'injectOnboardCardTitle';
        cardTitle.textContent = 'Onboard a new repo';
        const cardSub = document.createElement('span');
        cardSub.className = 'injectOnboardCardSub';
        cardSub.textContent = 'scaffold, configure & register — one tap';
        cardText.appendChild(cardTitle);
        cardText.appendChild(cardSub);
        onboardCard.appendChild(cardIcon);
        onboardCard.appendChild(cardText);
        onboardCard.addEventListener('click', function() {
            showOnboardModal({ onDispatched: renderTargets });
        });
        targetsBody.appendChild(onboardCard);
    }

    function renderTargetRow(target) {
        const row = document.createElement('div');
        row.className = 'injectTargetRow';
        row.dataset.targetId = target.id;

        // Leading enable/disable switch. `target.enabled` comes straight
        // off the fetched row (the panel selects all columns); dim the
        // whole row when off so dormant targets read as inactive.
        let enabled = target.enabled !== false;
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'injectTargetToggle';
        toggle.setAttribute('role', 'switch');
        const knob = document.createElement('span');
        knob.className = 'injectTargetToggleKnob';
        toggle.appendChild(knob);

        function reflectEnabled() {
            toggle.classList.toggle('on', enabled);
            toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
            toggle.setAttribute('aria-label',
                (enabled ? 'Disable' : 'Enable') + ' target ' + target.nickname);
            toggle.title = enabled ? 'Enabled' : 'Disabled';
            row.classList.toggle('injectTargetRow--disabled', !enabled);
        }
        reflectEnabled();

        toggle.addEventListener('click', async function() {
            if (toggle.disabled) return;
            const next = !enabled;
            // Optimistically flip both the switch and the dimmed state,
            // then persist; revert the flip on failure.
            enabled = next;
            target.enabled = next;
            reflectEnabled();
            toggle.disabled = true;
            const r = await setInjectTargetEnabled(target.id, next);
            toggle.disabled = false;
            if (!r.ok) {
                enabled = !next;
                target.enabled = !next;
                reflectEnabled();
                showInjectToast('Could not update target', 'error');
            }
        });

        const info = document.createElement('div');
        info.className = 'injectTargetInfo';
        const nick = document.createElement('div');
        nick.className = 'injectTargetNickname';
        nick.textContent = target.nickname;
        const detail = document.createElement('div');
        detail.className = 'injectTargetDetail';
        detail.textContent = target.repo + ' · ' + target.file_path;
        info.appendChild(nick);
        info.appendChild(detail);

        const editIcon = document.createElement('button');
        editIcon.type = 'button';
        editIcon.className = 'injectTargetIconBtn';
        editIcon.setAttribute('aria-label', 'Edit target ' + target.nickname);
        editIcon.title = 'Edit';
        editIcon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.5 2.5l2 2-7 7-2.5.5.5-2.5 7-7z"/></svg>';
        editIcon.addEventListener('click', function() {
            showInjectTargetSubModal({
                target: target,
                onSaved: refreshTargets,
            });
        });

        const trashIcon = document.createElement('button');
        trashIcon.type = 'button';
        trashIcon.className = 'injectTargetIconBtn injectTargetIconBtn--danger';
        trashIcon.setAttribute('aria-label', 'Delete target ' + target.nickname);
        trashIcon.title = 'Delete';
        trashIcon.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 4 13 4"/><path d="M5 4v-1a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M4.5 4l.7 9a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-9"/></svg>';
        trashIcon.addEventListener('click', function() {
            showConfirmModal({
                message: 'Delete target `' + target.nickname + '`? Projects routing to it will become unrouted.',
                confirmLabel: 'Delete',
                onConfirm: async function() {
                    const r = await deleteInjectTarget(target.id);
                    if (!r.ok) {
                        showInjectToast(r.reason || 'Delete failed', 'error');
                        return;
                    }
                    // The DB-side FK is ON DELETE SET NULL, but the client
                    // cache still holds the now-orphan target_id on every
                    // project that pointed here — clear them locally so
                    // the routing dropdowns flip to "None" without
                    // waiting for the next page reload, and refresh the
                    // inject buttons so any "Ready" rows demote to
                    // "Set inject target".
                    // Pass fromSync so the local cache update doesn't
                    // also fire a redundant per-project Supabase update —
                    // the FK ON DELETE SET NULL has already nulled the
                    // target_id on the server side.
                    listLogic.clearProjectTargetId(target.id, { fromSync: true });
                    showInjectToast('Target deleted');
                    refreshTargets();
                    renderProjectRouting();
                    refreshAllInjectButtons();
                },
            });
        });

        row.appendChild(toggle);
        row.appendChild(info);
        row.appendChild(editIcon);
        row.appendChild(trashIcon);
        return row;
    }

    async function refreshTargets() {
        await loadInjectTargets();
        renderTargets();
        renderProjectRouting();
    }

    // Expose this panel's refresh to the module-level onboard completion poll
    // while the modal is mounted; cleared in close() so a late poll tick after
    // the panel closes only updates module state, never a stale DOM.
    onboardRefreshHook = refreshTargets;

    // ── Project routing section ──
    // One row per project the user owns; each row shows the project name
    // and a target dropdown ("None" + every defined target by nickname).
    // Dropdown change autosaves to Supabase via listLogic.setProjectTargetId
    // and shows a brief inline "Saved" confirmation. When no targets exist,
    // the section collapses to a one-line empty state directing the user
    // to define a target first.
    const routingSection = document.createElement('div');
    routingSection.id = 'injectProjectRoutingSection';
    routingSection.className = 'injectSettingsSection';

    const routingHeader = document.createElement('div');
    routingHeader.className = 'injectSettingsSectionHeader';
    const routingTitle = document.createElement('div');
    routingTitle.id = 'injectProjectRoutingTitle';
    routingTitle.className = 'injectSettingsSectionTitle';
    routingTitle.textContent = 'Project routing';
    routingHeader.appendChild(routingTitle);

    const routingBody = document.createElement('div');
    routingBody.id = 'injectProjectRoutingBody';
    routingBody.className = 'injectSettingsSectionBody';

    routingSection.appendChild(routingHeader);
    routingSection.appendChild(routingBody);

    function renderProjectRouting() {
        routingBody.innerHTML = '';
        if (!cachedTargets || cachedTargets.length === 0) {
            const empty = document.createElement('div');
            empty.id = 'injectProjectRoutingEmpty';
            empty.className = 'injectProjectRoutingEmpty';
            empty.textContent = 'Define a target first to enable project routing';
            routingBody.appendChild(empty);
            return;
        }
        const projectNames = listLogic.listProjectsArray();
        if (!projectNames || projectNames.length === 0) {
            const empty = document.createElement('div');
            empty.id = 'injectProjectRoutingEmpty';
            empty.className = 'injectProjectRoutingEmpty';
            empty.textContent = 'No projects yet — add one in the sidebar to route it';
            routingBody.appendChild(empty);
            return;
        }
        const table = document.createElement('div');
        table.id = 'injectProjectRoutingTable';
        table.className = 'injectProjectRoutingTable';
        projectNames.forEach(function(name) {
            table.appendChild(renderRoutingRow(name));
        });
        routingBody.appendChild(table);
    }

    function renderRoutingRow(projectName) {
        const row = document.createElement('div');
        row.className = 'injectProjectRoutingRow';
        row.dataset.projectName = projectName;

        const nameCell = document.createElement('div');
        nameCell.className = 'injectProjectRoutingName';
        nameCell.textContent = projectName;
        nameCell.title = projectName;

        const select = document.createElement('select');
        select.className = 'injectProjectRoutingSelect';
        select.setAttribute('aria-label', 'Inject target for project ' + projectName);

        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = 'None';
        select.appendChild(noneOpt);
        cachedTargets.forEach(function(t) {
            const opt = document.createElement('option');
            opt.value = t.id;
            opt.textContent = t.nickname;
            select.appendChild(opt);
        });
        const current = listLogic.getProjectTargetId(projectName) || '';
        select.value = current;

        const savedNote = document.createElement('span');
        savedNote.className = 'injectProjectRoutingSaved';
        savedNote.setAttribute('aria-live', 'polite');
        savedNote.textContent = '';

        let savedTimer = null;
        select.addEventListener('change', function() {
            const newId = select.value || null;
            listLogic.setProjectTargetId(projectName, newId);
            // Inline "Saved" confirmation per the autosave UX — fades after
            // 1.5s so a fast operator routing several projects doesn't see
            // an accumulating wall of confirmations.
            savedNote.textContent = 'Saved';
            savedNote.classList.add('is-visible');
            if (savedTimer) clearTimeout(savedTimer);
            savedTimer = setTimeout(function() {
                savedNote.classList.remove('is-visible');
                savedNote.textContent = '';
            }, 1500);
            refreshAllInjectButtons();
            // Let the sidebar project-row thunderbolt indicators re-evaluate
            // their per-project target so a freshly routed (or unrouted)
            // project gains/loses its bolt without a reload.
            notifyInjectTargetsChanged();
        });

        row.appendChild(nameCell);
        row.appendChild(select);
        row.appendChild(savedNote);
        return row;
    }

    // The three stacked sections can exceed viewport height on phones —
    // wrap them in a scroll container so the modal caps at max-height and
    // the body scrolls instead of clipping the bottom rows.
    const scrollBody = document.createElement('div');
    scrollBody.id = 'injectSettingsScroll';
    scrollBody.appendChild(connSection);
    scrollBody.appendChild(targetsSection);
    scrollBody.appendChild(routingSection);

    dialog.appendChild(header);
    dialog.appendChild(scrollBody);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    renderStatus();
    setConnectionCollapsed(shouldAutoCollapse());
    renderTargets();
    renderProjectRouting();
    refreshTargets();

    if (openOpts.focusSection === 'projectRouting') {
        // Defer so the section is laid out before scrolling. The modal
        // body is the scroll container — scrollIntoView on the section
        // heading lands the user on the table row they came to edit.
        setTimeout(function() {
            try { routingTitle.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
            catch (e) { /* defensive */ }
        }, 0);
    }

    const previouslyFocused = document.activeElement;
    let closed = false;

    function close() {
        if (closed) return;
        closed = true;
        onboardRefreshHook = null;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (previouslyFocused &&
            typeof previouslyFocused.focus === 'function' &&
            document.contains(previouslyFocused)) {
            try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
        }
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    }

    closeX.addEventListener('click', close);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);

    saveBtn.addEventListener('click', function() {
        saveInjectConfig(urlInput.value.trim(), secretInput.value);
        renderStatus();
        refreshAllInjectButtons();
        showInjectToast('Inject settings saved');
    });

    testBtn.addEventListener('click', async function() {
        // Test what's currently in the form, not necessarily what's saved —
        // intuitive for a user editing and verifying in one pass. Persists
        // the form values so the test result reflects the same config the
        // user will keep when they close the modal.
        const formUrl    = urlInput.value.trim();
        const formSecret = secretInput.value;
        if (!formUrl || !formSecret) {
            showInjectToast('Enter URL and secret first', 'error');
            return;
        }
        saveInjectConfig(formUrl, formSecret);
        testBtn.disabled = true;
        const orig = testBtn.textContent;
        testBtn.textContent = 'Testing…';
        const r = await testConnection();
        testBtn.disabled = false;
        testBtn.textContent = orig;
        renderStatus();
        if (r.ok) {
            showInjectToast('Connection ok');
            setConnectionCollapsed(true);
        } else {
            showInjectToast('Test failed — ' + r.label, 'error');
        }
    });

    clearBtn.addEventListener('click', function() {
        if (!isInjectConfigured() && !urlInput.value && !secretInput.value) {
            showInjectToast('Nothing to clear');
            return;
        }
        showConfirmModal({
            message: 'Clear inject config? Both URL and shared secret will be erased from this device.',
            confirmLabel: 'Clear',
            onConfirm: function() {
                saveInjectConfig('', '');
                try {
                    localStorage.removeItem(LAST_TESTED_KEY);
                    localStorage.removeItem(LAST_RESULT_KEY);
                    localStorage.removeItem(LAST_TESTED_NICK_KEY);
                } catch (e) { /* private mode */ }
                urlInput.value = '';
                secretInput.value = '';
                renderStatus();
                setConnectionCollapsed(false);
                refreshAllInjectButtons();
                showInjectToast('Inject config cleared');
            }
        });
    });

    setTimeout(function() {
        try { urlInput.focus(); } catch (e) { /* defensive */ }
    }, 0);
}


function relativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 0) return 'just now';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const d = Math.floor(hr / 24);
    return d + 'd ago';
}
