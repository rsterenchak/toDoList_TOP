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

// The UI regions carried by a manifest result, GROUPED BY OWNING FILE, or []
// when absent/failed. A region maps a human-readable on-screen label to its
// owning source file; the picker leads each row with the file (the thing
// actually inserted into the `- File:` line) and lists that file's region
// labels beneath as supporting detail, so a file with several regions reads as
// one entry rather than several near-identical lookalikes. `regions` is
// `undefined` for older manifests that predate the build-time UI index; the
// parse in claudeSheet.js already keeps only entries with a string `selector`,
// but an entry may still lack `label` or `file`. Skip any region with no `file`
// — it cannot produce a `File:` line — and fall back to the selector as the
// display label when `label` is missing. The owning file needs the same
// `srcRoot` prefix as a plain file, so it is joined HERE, once, and grouping is
// keyed on that resolved path so grouping, filtering, dedup, and insertion all
// agree on file identity. Each returned group is { path, labels } with labels
// deduped and sorted for stable ordering. First-seen file order is preserved.
function regionsFromManifest(result) {
    if (!(result && result.ok && Array.isArray(result.regions))) return [];
    const srcRoot = result.srcRoot;
    const byPath = new Map();
    const order = [];
    result.regions.forEach(function (r) {
        if (!(r && typeof r.file === 'string' && r.file)) return;
        const path = joinSrcRootPath(srcRoot, r.file);
        const label = (typeof r.label === 'string' && r.label) ? r.label : r.selector;
        let group = byPath.get(path);
        if (!group) {
            group = { path: path, labels: [] };
            byPath.set(path, group);
            order.push(group);
        }
        if (label && group.labels.indexOf(label) === -1) group.labels.push(label);
    });
    order.forEach(function (group) { group.labels.sort(); });
    return order;
}

// How many of a file's region labels to spell out on the secondary line before
// collapsing the rest into a "+N more" suffix, so the line never grows unbounded
// while ALL labels stay in the filter-match text (see the filter in renderList).
const REGION_LABEL_DISPLAY_CAP = 4;

// Render a grouped row's labels as the comma-separated secondary line, capping
// the visible count with a "+N more" suffix.
function formatRegionLabels(labels) {
    if (!labels.length) return '';
    if (labels.length <= REGION_LABEL_DISPLAY_CAP) return labels.join(', ');
    return labels.slice(0, REGION_LABEL_DISPLAY_CAP).join(', ')
        + ' +' + (labels.length - REGION_LABEL_DISPLAY_CAP) + ' more';
}

// Tolerant `- File:` line matcher — leading whitespace, `- File:`,
// case-insensitive. Capture group 1 is the leading indent, group 2 the value.
// The SINGLE source of truth for what a File: line looks like: both the
// insertion logic (insertFilePathIntoEntry) and the read-only readout
// (parseFilePathsFromEntry) match with it, so a readout can never disagree with
// what a pick writes.
const FILE_LINE_RE = /^(\s*)-\s*File:\s*(.*)$/i;

// Split a `File:` line value into its comma-separated paths, backticks and
// surrounding whitespace stripped, empty tokens dropped.
function splitFileTokens(fileValue) {
    return String(fileValue || '').split(',')
        .map(function (token) { return token.replace(/`/g, '').trim(); })
        .filter(function (token) { return token.length > 0; });
}

// Report whether `path` is already one of a `File:` line value's comma-separated
// tokens. Used to make re-selecting an already-listed path a no-op.
function filePathPresent(fileValue, path) {
    return splitFileTokens(fileValue).some(function (token) {
        return token === path;
    });
}

// Parse the repo-relative paths from an entry's `- File:` line, using the SAME
// matcher and token-splitting insertFilePathIntoEntry inserts with. Returns the
// paths of the first `File:` line found, or [] when the entry has no File: line
// or the line names none. Read-only: never mutates the entry.
export function parseFilePathsFromEntry(text) {
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(FILE_LINE_RE);
        if (m) return splitFileTokens(m[2]);
    }
    return [];
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

    // Tolerant File: matcher — shared with the read-only readout so the two
    // can never disagree about what the entry's File: line contains.
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(FILE_LINE_RE);
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
    let manifestRegions = regionsFromManifest(primed);
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

    // A muted section heading separating the UI-region rows from the plain file
    // list. Only emitted when regions exist, so a manifest with none renders as a
    // bare file list exactly as it did before this feature.
    function appendSectionLabel(text) {
        const p = document.createElement('p');
        p.className = 'filePickSectionLabel';
        p.textContent = text;
        list.appendChild(p);
    }

    // A one-line file row: the full repo-relative path, inserted on click.
    function appendFileRow(path) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'filePickRow';
        row.setAttribute('role', 'option');
        row.textContent = path;
        row.addEventListener('click', function () { applyFilePick(path); });
        list.appendChild(row);
    }

    // A two-line region row grouped by owning file: the file path leads as the
    // row's primary text, with its region labels beneath at reduced emphasis as a
    // comma-separated secondary line. Selecting it inserts the owning file exactly
    // as a plain file row does — same dedup, same insertion position, same
    // backtick wrap — so a grouped row inserts one path even when it folds several
    // regions.
    function appendRegionRow(group) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'filePickRegionRow';
        row.setAttribute('role', 'option');
        const file = document.createElement('span');
        file.className = 'filePickRegionFile';
        file.textContent = group.path;
        const label = document.createElement('span');
        label.className = 'filePickRegionLabel';
        label.textContent = formatRegionLabels(group.labels);
        row.appendChild(file);
        row.appendChild(label);
        row.addEventListener('click', function () { applyFilePick(group.path); });
        list.appendChild(row);
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
        // Loaded but the manifest carried neither files nor regions — distinguish
        // a genuinely empty manifest from a fetch failure so the message reads
        // correctly (a bare "no files match" hid both cases before).
        if (!manifestFiles.length && !manifestRegions.length) {
            appendMessage(loadOk
                ? 'No source files in this project’s manifest.'
                : 'Couldn’t load the file list — a temporary problem fetching the manifest.');
            return;
        }
        const q = (search.value || '').trim().toLowerCase();
        // Filtering matches a grouped row's owning file path and EVERY label
        // folded under it — including labels the "+N more" cap hides from the
        // secondary line — as well as plain file paths, so typing "sort" surfaces
        // both a "Filter & sort strip" region's file and any file whose path
        // contains it.
        const regionMatches = q
            ? manifestRegions.filter(function (g) {
                return g.path.toLowerCase().indexOf(q) !== -1
                    || g.labels.some(function (l) { return l.toLowerCase().indexOf(q) !== -1; });
            })
            : manifestRegions;
        const fileMatches = q
            ? manifestFiles.filter(function (p) { return p.toLowerCase().indexOf(q) !== -1; })
            : manifestFiles;
        if (!regionMatches.length && !fileMatches.length) {
            appendMessage('No files match');
            return;
        }
        // Regions and files share the ONE row cap — regions come first, then
        // whatever remains of the cap goes to files — so the "keep typing to
        // narrow" hint reflects the true combined match count.
        const shownRegions = regionMatches.slice(0, TARGET_PICK_CAP);
        const fileRoom = TARGET_PICK_CAP - shownRegions.length;
        const shownFiles = fileRoom > 0 ? fileMatches.slice(0, fileRoom) : [];

        if (shownRegions.length) {
            appendSectionLabel('UI regions');
            shownRegions.forEach(appendRegionRow);
        }
        if (shownFiles.length) {
            // The separating label only precedes the files when regions were
            // shown above them; with no regions the list is a bare file list.
            if (shownRegions.length) appendSectionLabel('Files');
            shownFiles.forEach(appendFileRow);
        }

        const totalMatches = regionMatches.length + fileMatches.length;
        const totalShown = shownRegions.length + shownFiles.length;
        if (totalMatches > totalShown) {
            appendMessage('Keep typing to narrow ' + totalMatches + ' matches');
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
                manifestRegions = regionsFromManifest(result);
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
