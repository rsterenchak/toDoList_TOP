// Manual export / import of all projects + todos as a JSON file.
//
// Vanilla, no backend, no new dependencies. The on-disk file is purely a
// snapshot; localStorage stays the live store.
//
// The validate → confirm → overwrite flow is shared between the legacy
// file picker (drag-and-drop) and the Drive import path. Validation lives
// here, not in listLogic.js — once the file is accepted, the data is handed
// off to listLogic.replaceAllProjects which wipes and rewrites the tree in
// one pass (no partial-overwrite states).

import { listLogic } from './listLogic.js';
import { showConfirmModal } from './modals.js';

const EXPORT_VERSION = 1;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_MONTH = 30 * MS_PER_DAY;
const MS_PER_YEAR = 365 * MS_PER_DAY;


// ── EXPORT PAYLOAD ──

// Local-date YYYY-MM-DD (not UTC). Filename anchors on whatever day the
// user is on, which is the intuitive label for a "backup taken today".
function localDateStamp(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

// Pure, side-effect-free date-stamped name used by the Drive upload path so
// repeated same-day exports land on the same base filename. Drive assigns
// its own ids so a same-day collision suffix isn't needed.
export function buildBaseExportFilename(date) {
    return 'todos-' + localDateStamp(date) + '.json';
}

export function buildExportPayload(now) {
    return {
        version: EXPORT_VERSION,
        exportedAt: (now || new Date()).toISOString(),
        projects: listLogic.snapshotProjects(),
    };
}


// ── RELATIVE-TIME LABEL ──
//
// Surfaces a stored ISO timestamp as a "Synced X ago" string. Reused by
// the ghost menu DRIVE export row's state pill so the user sees how stale
// their last Drive sync is at the moment of action.

export function formatRelativeExportedAt(iso, now) {
    if (!iso) return 'Never synced';
    const t = Date.parse(iso);
    if (isNaN(t)) return 'Never synced';

    const ref = (now ? now.getTime() : Date.now());
    const diff = ref - t;

    // Clock skew or a future-stamped file — treat as fresh.
    if (diff < MS_PER_MINUTE) return 'Synced just now';

    function plural(n, unit) {
        return 'Synced ' + n + ' ' + unit + (n === 1 ? '' : 's') + ' ago';
    }

    if (diff < MS_PER_HOUR) return plural(Math.floor(diff / MS_PER_MINUTE), 'minute');
    if (diff < MS_PER_DAY)  return plural(Math.floor(diff / MS_PER_HOUR), 'hour');
    if (diff < MS_PER_MONTH) return plural(Math.floor(diff / MS_PER_DAY), 'day');
    if (diff < MS_PER_YEAR)  return plural(Math.floor(diff / MS_PER_MONTH), 'month');
    return plural(Math.floor(diff / MS_PER_YEAR), 'year');
}


// ── IMPORT VALIDATION ──

// Accept either the array shape produced by snapshotProjects or, for
// forgiveness, the legacy `{ name: { items, color } }` object shape.
// Normalises both to the array shape replaceAllProjects expects.
function normaliseProjectsField(projects) {
    if (Array.isArray(projects)) return projects;
    if (projects && typeof projects === 'object') {
        return Object.keys(projects).map(function(name) {
            const entry = projects[name];
            if (Array.isArray(entry)) return { name: name, items: entry, color: null };
            if (entry && typeof entry === 'object') {
                return {
                    name: name,
                    items: Array.isArray(entry.items) ? entry.items : [],
                    color: typeof entry.color === 'string' ? entry.color : null,
                };
            }
            return { name: name, items: [], color: null };
        });
    }
    return null;
}

export function parseAndValidateExport(rawText) {

    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (e) {
        return { ok: false, error: "Couldn't read that file — expected a todos export." };
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: "Couldn't read that file — expected a todos export." };
    }

    if (typeof parsed.version !== 'number') {
        return { ok: false, error: "Couldn't read that file — expected a todos export." };
    }

    if (parsed.version !== EXPORT_VERSION) {
        return {
            ok: false,
            error: 'This file is from a different version (' + parsed.version
                + '). Only version ' + EXPORT_VERSION + ' is supported.',
        };
    }

    const projects = normaliseProjectsField(parsed.projects);
    if (!projects) {
        return { ok: false, error: "Couldn't read that file — expected a todos export." };
    }

    return { ok: true, projects: projects };
}


// Count current todos and projects for the destructive-overwrite confirm
// message. Excludes blank placeholder rows from the todo total — the user
// thinks of those as the empty input, not real items.
function describeCurrentState() {
    const projects = listLogic.listProjectsArray();
    let todoCount = 0;
    projects.forEach(function(name) {
        const items = listLogic.listItems(name) || [];
        items.forEach(function(item) {
            if (item && item.tit) todoCount++;
        });
    });
    return { projectCount: projects.length, todoCount: todoCount };
}


// ── IMPORT ENTRY POINTS ──

// Show a transient inline error near the import controls. We render it as a
// small toast under the nav bar so the failure is visible without stealing
// focus or blocking the rest of the UI.
function showImportError(message) {
    const prior = document.getElementById('importErrorToast');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const toast = document.createElement('div');
    toast.id = 'importErrorToast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
}


function handleValidatedImport(projects, onAfterReplace, sourceLabel, flowOpts) {

    const before = describeCurrentState();
    const projectWord = before.projectCount === 1 ? 'project' : 'projects';
    const todoWord = before.todoCount === 1 ? 'todo' : 'todos';
    const prefix = sourceLabel ? sourceLabel + '\n\n' : '';
    const msg = prefix
        + 'Replace all current todos with this file? Your existing '
        + before.todoCount + ' ' + todoWord + ' across '
        + before.projectCount + ' ' + projectWord + ' will be permanently overwritten.';

    const opts = flowOpts || {};

    showConfirmModal({
        message: msg,
        confirmLabel: 'Replace',
        danger: true,
        onConfirm: function() {
            // onBeforeReplace runs after the user confirms but BEFORE
            // replaceAllProjects dispatches the driveSyncStateChanged
            // recompute. The Drive import path uses this hook to write
            // lastDriveSyncedAt first so the live recompute reads a
            // consistent state where the sync marker reflects the file
            // the data was just sourced from, not the previous sync.
            if (typeof opts.onBeforeReplace === 'function') opts.onBeforeReplace();
            const replaceOpts = opts.fromSync === true ? { fromSync: true } : undefined;
            listLogic.replaceAllProjects(projects, replaceOpts);
            if (typeof onAfterReplace === 'function') onAfterReplace();
        },
    });
}


// Shared parse → validate → confirm → apply pipeline. Both the drag-and-drop
// file picker (importFromFile) and the Drive import path route their raw
// JSON strings through here so the same validation, confirmation prompt,
// and state-replacement behavior apply to both surfaces. Callers may pass
// `options.sourceLabel` to prepend a "this is the backup you're about to
// restore" line to the confirm prompt (Drive uses this to show the
// discovered filename + modifiedTime); the local file picker leaves it
// blank.
//
// Errors are reported via the existing inline error toast unless the
// caller opts out with `options.silentError: true`, in which case the
// returned descriptor lets the caller surface the message in its own
// toast (Drive uses this so the failure lands in the unified Drive
// toast alongside the success message styling).
//
// `options.fromSync: true` and `options.onBeforeReplace` are threaded
// through to the confirm handler so sync-initiated callers (Drive
// import) can both suppress the lastLocalMutationAt bump and write
// lastDriveSyncedAt before the replace dispatches its recompute event.
// Both only fire after the user confirms the destructive overwrite, so
// a cancelled import leaves every marker untouched.
export function importTodosFromString(jsonString, onAfterReplace, options) {
    const opts = options || {};
    const result = parseAndValidateExport(jsonString);
    if (!result.ok) {
        if (!opts.silentError) showImportError(result.error);
        return { ok: false, error: result.error };
    }
    handleValidatedImport(result.projects, onAfterReplace, opts.sourceLabel, {
        fromSync: opts.fromSync === true,
        onBeforeReplace: opts.onBeforeReplace,
    });
    return { ok: true };
}


export function importFromFile(file, onAfterReplace) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function() {
        const text = typeof reader.result === 'string' ? reader.result : '';
        importTodosFromString(text, onAfterReplace);
    };
    reader.onerror = function() {
        showImportError("Couldn't read that file — expected a todos export.");
    };
    reader.readAsText(file);
}


// ── DRAG-AND-DROP IMPORT ──
//
// Dropping a .json file anywhere on the window is equivalent to using the
// file picker. Pointer-coarse devices skip the listeners entirely — touch
// browsers don't fire dragover/drop reliably and the file-picker path
// already covers them.

export function attachDragDropImport(onAfterReplace) {

    if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
        return;
    }

    let dragDepth = 0;
    let overlay = null;

    function showOverlay() {
        if (overlay) return;
        overlay = document.createElement('div');
        overlay.id = 'importDropOverlay';
        const inner = document.createElement('div');
        inner.id = 'importDropOverlayInner';
        inner.textContent = 'Drop to import';
        overlay.appendChild(inner);
        document.body.appendChild(overlay);
    }

    function hideOverlay() {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        overlay = null;
        dragDepth = 0;
    }

    function eventCarriesFile(event) {
        if (!event.dataTransfer) return false;
        const types = event.dataTransfer.types;
        if (!types) return false;
        for (let i = 0; i < types.length; i++) {
            if (types[i] === 'Files') return true;
        }
        return false;
    }

    window.addEventListener('dragenter', function(event) {
        if (!eventCarriesFile(event)) return;
        dragDepth++;
        showOverlay();
    });

    window.addEventListener('dragover', function(event) {
        if (!eventCarriesFile(event)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    });

    window.addEventListener('dragleave', function(event) {
        if (!eventCarriesFile(event)) return;
        dragDepth--;
        if (dragDepth <= 0) hideOverlay();
    });

    window.addEventListener('drop', function(event) {
        if (!eventCarriesFile(event)) return;
        event.preventDefault();
        hideOverlay();
        const files = event.dataTransfer && event.dataTransfer.files;
        if (!files || files.length === 0) return;
        const file = files[0];
        if (file.type && file.type !== 'application/json' && !/\.json$/i.test(file.name)) {
            showImportError("Couldn't read that file — expected a todos export.");
            return;
        }
        importFromFile(file, onAfterReplace);
    });
}
