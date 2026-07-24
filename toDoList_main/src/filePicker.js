// Shared File:-path picker — one implementation driving both the mobile
// description-editor modal (modals.js) and the desktop in-row description panel
// (#descSibling, built in toDoRow.js).
//
// The picker is a ⌖ target chip that lists the active project's source files
// and, on selection, writes the chosen path into the entry's `File:` line —
// removing the one authoring step that depended on holding repo paths in your
// head. The chip is present whenever the active project has a routing target
// (a linked repo); whether that repo has any files is no longer knowable before
// opening, so the manifest is loaded ON DEMAND the first time the picker opens
// (a brief loading state, then the files), and re-served instantly from the
// per-repo cache on every subsequent open. Only a project with no linked repo
// hides the chip entirely.
//
// This module owns the search filter, the row cap, the `File:`-line insertion
// logic, and the on-demand manifest load. The two hosts differ only in where
// the chip and panel mount and what side effects run after a pick (persist +
// refresh) or after the list (re)renders (recompute layout) — passed in via
// options — so the two surfaces can never diverge, including their empty and
// loading states.

import { listLogic } from './listLogic.js';
import { findTargetById } from './inject.js';
// claudeSheet.js owns the async load-and-cache (loadManifest) and the
// synchronous cache read (getCachedManifest). The picker reads the cache to
// render instantly when the manifest is already in hand, and loads on demand —
// through loadManifest, which caches per repo — when it is not. No second cache,
// no second fetch, and no structureView import (which would pull in the canvas).
import { getCachedManifest, loadManifest } from './claudeSheet.js';
// The manifest lists files RELATIVE to its `srcRoot`; joinSrcRootPath prefixes
// that root so the picker shows, filters, dedups, and inserts full repo-relative
// paths (the same joiner structureView.js uses for its blob links).
import { joinSrcRootPath } from './srcPath.js';

// Cap the rendered rows so a several-hundred-file manifest never mounts in full
// (on a phone, or in the desktop panel); when the filter still matches more than
// the cap, show a "keep typing to narrow" hint instead of the overflow.
const TARGET_PICK_CAP = 60;

// In-flight manifest loads keyed by repo, so opening and closing the picker
// quickly — or two hosts opening the same repo's picker at once — never fires a
// duplicate fetch; a concurrent open reuses the pending promise. Mirrors the
// shippedMarkersInFlight guard in inject.js. loadManifest itself caches the
// resolved result per repo, so this map only needs to dedup the window while a
// single load is still outstanding.
const manifestLoadsInFlight = new Map();

// Load a repo's manifest exactly once per outstanding request: serve the cached
// result synchronously when it exists, otherwise reuse an in-flight load or
// start one. Resolves to the { ok, files, ... } manifest result (or null when
// there is no repo). Never rejects — loadManifest already degrades a failed
// fetch to { ok: false, files: [] }.
function loadManifestOnce(repo) {
    if (!repo) return Promise.resolve(null);
    const cached = getCachedManifest(repo);
    if (cached) return Promise.resolve(cached);
    const inFlight = manifestLoadsInFlight.get(repo);
    if (inFlight) return inFlight;
    // Call loadManifest synchronously so the in-flight entry is registered
    // before this function returns — a second open in the same tick reuses it.
    const p = loadManifest(repo).then(function (result) {
        manifestLoadsInFlight.delete(repo);
        return result;
    }, function () {
        manifestLoadsInFlight.delete(repo);
        return { ok: false, files: [] };
    });
    manifestLoadsInFlight.set(repo, p);
    return p;
}

// The file list carried by a manifest result, or [] when absent/failed. The
// manifest names files relative to its `srcRoot`, so the root is joined onto
// each name HERE — once, where the result becomes the list — so the rendered
// label, the filter text, the dedup comparison, and the inserted string are all
// the same full repo-relative path. An absent or empty `srcRoot` (older
// manifests, and the C# / repo-root-relative shape) leaves the name unchanged.
function filesFromManifest(result) {
    if (!(result && result.ok && Array.isArray(result.files))) return [];
    const srcRoot = result.srcRoot;
    return result.files.map(function (file) { return joinSrcRootPath(srcRoot, file); });
}

// Split a `File:` line value on commas and report whether `path` is already one
// of its comma-separated tokens once backticks and surrounding whitespace are
// stripped. Used to make re-selecting an already-listed path a no-op.
function filePathPresent(fileValue, path) {
    return String(fileValue || '').split(',').some(function (token) {
        return token.replace(/`/g, '').trim() === path;
    });
}

// Detect the indentation used by the entry's sub-bullets so a freshly-inserted
// `- File:` line matches them. Entries arrive from several sources (hand-typed,
// pasted from chat, generated by triage) with two-space-indented sub-bullets by
// convention; fall back to two spaces when no indented bullet is found.
function detectSubBulletIndent(lines) {
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\s+)-\s/);
        if (m) return m[1];
    }
    return '  ';
}

// Insert a repo-relative source `path` into a TODO.md-style entry's `File:`
// line, backtick-wrapped, and return the updated entry text. If a `- File:`
// line already exists (matched tolerantly of leading whitespace and case), the
// path is appended to it comma-separated — unless it is already listed, in
// which case the text is returned unchanged (no duplicate). If there is no
// `File:` line, a new one is inserted immediately before the `- Completed:`
// line (matching its indent), or at the end of the entry when no Completed line
// is present. The body is never reformatted — only the one line changes.
export function insertFilePathIntoEntry(text, path) {
    const raw = String(path || '').trim();
    const source = String(text || '');
    if (!raw) return source;
    const wrapped = '`' + raw + '`';
    const lines = source.split('\n');

    // Tolerant File: matcher — leading whitespace, `- File:`, case-insensitive.
    const fileLineRe = /^(\s*)-\s*File:\s*(.*)$/i;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(fileLineRe);
        if (!m) continue;
        if (filePathPresent(m[2], raw)) return source;
        const trimmedEnd = lines[i].replace(/\s+$/, '');
        // An empty `File:` line (no value yet) takes the path directly; an
        // existing value gets it appended comma-separated.
        lines[i] = /:\s*$/.test(trimmedEnd)
            ? trimmedEnd + ' ' + wrapped
            : trimmedEnd + ', ' + wrapped;
        return lines.join('\n');
    }

    // No File: line — insert one immediately before `- Completed:` if present.
    const completedRe = /^(\s*)-\s*Completed:/i;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(completedRe);
        if (!m) continue;
        lines.splice(i, 0, (m[1] || '') + '- File: ' + wrapped);
        return lines.join('\n');
    }

    // No Completed line — append inside the block, past any trailing blank lines,
    // matching the sibling sub-bullets' indent.
    const indent = detectSubBulletIndent(lines);
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === '') end--;
    lines.splice(end, 0, indent + '- File: ' + wrapped);
    return lines.join('\n');
}

// Resolve a project's linked repo (the same getProjectTargetId → findTargetById
// path the inject button uses) so the picker can read that repo's cached
// manifest. Returns null when the project has no routing target, in which case
// the picker stays hidden.
function resolveProjectRepo(projectName) {
    if (!projectName) return null;
    const targetId = listLogic.getProjectTargetId(projectName);
    if (!targetId) return null;
    const target = findTargetById(targetId);
    return target && target.repo ? target.repo : null;
}

// Read the active project's manifest file list synchronously from the cache.
// Returns [] when there is no linked repo or the manifest was never loaded.
// Retained as a no-fetch convenience for callers that only want what is already
// in hand; createFilePicker now loads on demand rather than relying on it.
export function resolveManifestFilesForProject(projectName) {
    const repo = resolveProjectRepo(projectName || '');
    return filesFromManifest(getCachedManifest(repo));
}

// Build the shared File:-path picker (trigger chip + searchable panel) and wire
// it, returning the two mount points plus an `available` flag reporting whether
// the project has a routing target. The trigger self-hides only when there is no
// linked repo; when a repo IS linked, the chip is always present and the file
// list loads on demand the first time the panel opens.
//
// Options:
//   projectName  — the active project, for resolving the repo + manifest.
//   textarea     — the entry textarea the pick is written into (required).
//   onInsert     — host side effects after a pick lands in the textarea
//                  (persist, refresh inject button, recompute layout). The
//                  picker has already set textarea.value and dispatched `input`.
//   onRender     — host side effect after the list (re)paints — used by the
//                  desktop panel to recompute the viewer height, since the
//                  loading state and the populated list are different heights.
//   triggerId    — optional id for the trigger element (kept for the modal's
//                  existing hooks; the shared class carries all styling).
//   panelId      — optional id for the panel element.
export function createFilePicker(options) {
    const opts = options || {};
    const projectName = opts.projectName || '';
    const textarea = opts.textarea;
    const onInsert = typeof opts.onInsert === 'function' ? opts.onInsert : function () {};
    const onRender = typeof opts.onRender === 'function' ? opts.onRender : function () {};
    const repo = resolveProjectRepo(projectName);

    // Load state, so renderList knows which surface to paint:
    //   'idle'    — never opened; manifest not yet requested.
    //   'loading' — a fetch is in flight; show the loading line.
    //   'loaded'  — files (or a known-empty result) are in hand.
    // A warm cache (manifest already loaded this session) starts us at 'loaded'
    // so a re-open renders instantly with no async hop. `loadOk` distinguishes a
    // genuinely empty manifest (ok: true) from a failed fetch (ok: false) so the
    // empty message can say which case it is.
    const primed = getCachedManifest(repo);
    let manifestFiles = filesFromManifest(primed);
    let loadStatus = primed ? 'loaded' : 'idle';
    let loadOk = primed ? !!primed.ok : true;

    const trigger = document.createElement('button');
    trigger.className = 'filePickTrigger';
    trigger.type = 'button';
    trigger.textContent = '⌖';
    trigger.setAttribute('aria-label', 'Pick a file path from the project');
    trigger.setAttribute('aria-expanded', 'false');
    if (opts.triggerId) trigger.id = opts.triggerId;
    // Hidden entirely only when the project has no routing target — whether the
    // repo actually has files is no longer knowable before opening.
    if (!repo) trigger.style.display = 'none';

    const panel = document.createElement('div');
    panel.className = 'filePickPanel';
    panel.hidden = true;
    if (opts.panelId) panel.id = opts.panelId;

    const search = document.createElement('input');
    search.className = 'filePickSearch';
    search.type = 'text';
    search.setAttribute('aria-label', 'Filter files');
    search.placeholder = 'Filter files…';
    search.autocomplete = 'off';
    search.spellcheck = false;

    const list = document.createElement('div');
    list.className = 'filePickList';
    list.setAttribute('role', 'listbox');

    panel.appendChild(search);
    panel.appendChild(list);

    function applyFilePick(path) {
        if (!textarea) return;
        textarea.value = insertFilePathIntoEntry(textarea.value, path);
        // Route the change through the textarea's own input listener (auto-grow,
        // and on the modal the item.desc + inject-button re-sync), then let the
        // host persist + refresh through its own listLogic path.
        textarea.dispatchEvent(new Event('input'));
        onInsert();
        closePanel();
    }

    function appendMessage(text) {
        const p = document.createElement('p');
        p.className = 'filePickEmpty';
        p.textContent = text;
        list.appendChild(p);
    }

    function renderList() {
        list.innerHTML = '';
        if (loadStatus === 'loading') {
            const loading = document.createElement('p');
            loading.className = 'filePickEmpty filePickLoading';
            loading.textContent = 'Loading files…';
            list.appendChild(loading);
            return;
        }
        // Loaded but the manifest carried no files — distinguish a genuinely
        // empty manifest from a fetch failure so the message reads correctly
        // (a bare "no files match" hid both cases before).
        if (!manifestFiles.length) {
            appendMessage(loadOk
                ? 'No source files in this project’s manifest.'
                : 'Couldn’t load the file list — a temporary problem fetching the manifest.');
            return;
        }
        const q = (search.value || '').trim().toLowerCase();
        const matches = q
            ? manifestFiles.filter(function (p) { return p.toLowerCase().indexOf(q) !== -1; })
            : manifestFiles;
        if (!matches.length) {
            appendMessage('No files match');
            return;
        }
        matches.slice(0, TARGET_PICK_CAP).forEach(function (path) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'filePickRow';
            row.setAttribute('role', 'option');
            row.textContent = path;
            row.addEventListener('click', function () { applyFilePick(path); });
            list.appendChild(row);
        });
        if (matches.length > TARGET_PICK_CAP) {
            appendMessage('Keep typing to narrow ' + matches.length + ' matches');
        }
    }

    function openPanel() {
        panel.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        // Cold cache: show the loading line, then load on demand. The panel can
        // be closed (or rebuilt by the host) before the load resolves, so guard
        // the repaint against a detached node — resolve, then confirm the list
        // is still in the document before painting or recomputing layout.
        if (loadStatus === 'idle') {
            loadStatus = 'loading';
            renderList();
            onRender();
            loadManifestOnce(repo).then(function (result) {
                if (!list.isConnected) return;
                loadStatus = 'loaded';
                loadOk = !!(result && result.ok);
                manifestFiles = filesFromManifest(result);
                renderList();
                onRender();
            });
        } else {
            renderList();
            onRender();
        }
        try { search.focus(); } catch (e) { /* defensive */ }
    }
    function closePanel() {
        panel.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', function () {
        if (panel.hidden) openPanel();
        else closePanel();
    });
    search.addEventListener('input', renderList);

    return { trigger, panel, available: !!repo };
}
