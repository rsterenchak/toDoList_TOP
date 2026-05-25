// Manual export / import of all projects + todos as a JSON file.
//
// Vanilla, no backend, no new dependencies. The on-disk file is purely a
// snapshot; localStorage stays the live store.
//
// Validation lives here, not in listLogic.js — once the file is accepted,
// the data is handed off to listLogic.replaceAllProjects which wipes and
// rewrites the tree in one pass (no partial-overwrite states).

import { listLogic } from './listLogic.js';
import { showConfirmModal } from './modals.js';

const EXPORT_VERSION = 1;


// ── EXPORT PAYLOAD ──

export function buildExportPayload(now) {
    return {
        version: EXPORT_VERSION,
        exportedAt: (now || new Date()).toISOString(),
        projects: listLogic.snapshotProjects(),
    };
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

    const opts = flowOpts || {};

    // Shared apply path — the confirmation modal and the silent branch
    // both land here.
    const applyReplace = function() {
        if (typeof opts.onBeforeReplace === 'function') opts.onBeforeReplace();
        const replaceOpts = opts.fromSync === true ? { fromSync: true } : undefined;
        listLogic.replaceAllProjects(projects, replaceOpts);
        if (typeof onAfterReplace === 'function') onAfterReplace();
    };

    if (opts.silent === true) {
        applyReplace();
        return;
    }

    const before = describeCurrentState();
    const projectWord = before.projectCount === 1 ? 'project' : 'projects';
    const todoWord = before.todoCount === 1 ? 'todo' : 'todos';
    const prefix = sourceLabel ? sourceLabel + '\n\n' : '';
    const msg = prefix
        + 'Replace all current todos with this file? Your existing '
        + before.todoCount + ' ' + todoWord + ' across '
        + before.projectCount + ' ' + projectWord + ' will be permanently overwritten.';

    showConfirmModal({
        message: msg,
        confirmLabel: 'Replace',
        danger: true,
        onConfirm: applyReplace,
    });
}


// Shared parse → validate → confirm → apply pipeline used by the drag-and-
// drop file picker (importFromFile). Callers may pass
// `options.sourceLabel` to prepend a "this is the backup you're about to
// restore" line to the confirm prompt; the local file picker leaves it
// blank.
//
// Errors are reported via the existing inline error toast unless the
// caller opts out with `options.silentError: true`, in which case the
// returned descriptor lets the caller surface the message in its own
// toast.
//
// `options.fromSync: true` and `options.onBeforeReplace` are threaded
// through to the confirm handler so reconciliation-initiated callers can
// run pre-replace bookkeeping before replaceAllProjects fires its
// dataChanged event.
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
        silent: opts.silent === true,
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

        // The inset perimeter that carries the dashed border + glow. Sized
        // via inset:18px in CSS so the dash sits a hair inside the window
        // edge rather than flush against it.
        const inner = document.createElement('div');
        inner.id = 'importDropOverlayInner';

        // Inline SVG file-with-upload-arrow glyph (Tabler-style). Kept
        // inline so it inherits currentColor from the parent and so no
        // icon-font dependency is needed. aria-hidden because the label
        // beneath it conveys the action verbally.
        inner.insertAdjacentHTML('beforeend',
            '<svg id="importDropOverlayIcon" xmlns="http://www.w3.org/2000/svg"'
            + ' width="44" height="44" viewBox="0 0 24 24" fill="none"'
            + ' stroke="currentColor" stroke-width="1.5" stroke-linecap="round"'
            + ' stroke-linejoin="round" aria-hidden="true">'
            + '<path d="M14 3v4a1 1 0 0 0 1 1h4"/>'
            + '<path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/>'
            + '<path d="M12 11v6"/>'
            + '<path d="M9.5 13.5 12 11l2.5 2.5"/>'
            + '</svg>'
        );

        const label = document.createElement('div');
        label.id = 'importDropOverlayLabel';
        label.textContent = 'DROP JSON TO IMPORT';
        inner.appendChild(label);

        const subline = document.createElement('div');
        subline.id = 'importDropOverlaySubline';
        subline.textContent = 'Replaces all current projects & todos';
        inner.appendChild(subline);

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
