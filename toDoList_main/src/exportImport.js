// Manual export / import of all projects + todos as a JSON file.
//
// Vanilla, no backend, no new dependencies — Blob + object URL + hidden
// <a download> for export; <input type="file" accept=".json"> + the
// dragover/drop events for import. The on-disk file is purely a snapshot;
// localStorage stays the live store.
//
// The validate → confirm → overwrite flow is shared between the file
// picker and the drag-and-drop path. Validation lives here, not in
// listLogic.js — once the file is accepted, the data is handed off to
// listLogic.replaceAllProjects which wipes and rewrites the tree in one
// pass (no partial-overwrite states).

import { listLogic } from './listLogic.js';
import { showConfirmModal } from './modals.js';
import {
    readLastExportedAt,
    writeLastExportedAt,
} from './prefs.js';

const EXPORT_VERSION = 1;
const STALE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Track per-session same-day filename collisions so a quick second export
// becomes `todos-YYYY-MM-DD-2.json` rather than overwriting the first.
// Browsers won't actually let one download overwrite another, but the
// numbered suffix keeps the user's downloads folder readable.
const sessionFilenameCounts = Object.create(null);


// ── EXPORT ──

// Local-date YYYY-MM-DD (not UTC). Filename anchors on whatever day the
// user is on, which is the intuitive label for a "backup taken today".
function localDateStamp(date) {
    const d = date || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

function buildExportFilename(date) {
    const stamp = localDateStamp(date);
    const seen = sessionFilenameCounts[stamp] || 0;
    sessionFilenameCounts[stamp] = seen + 1;
    return seen === 0
        ? 'todos-' + stamp + '.json'
        : 'todos-' + stamp + '-' + (seen + 1) + '.json';
}

export function buildExportPayload(now) {
    return {
        version: EXPORT_VERSION,
        exportedAt: (now || new Date()).toISOString(),
        projects: listLogic.snapshotProjects(),
    };
}

export function exportTodosToFile() {

    const now = new Date();
    const payload = buildExportPayload(now);
    const json = JSON.stringify(payload, null, 2);
    const filename = buildExportFilename(now);

    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Revoke on the next tick — Safari needs the URL alive long enough for
    // the click() handler to enqueue the download.
    setTimeout(function() { URL.revokeObjectURL(url); }, 0);

    writeLastExportedAt(now.toISOString());
    refreshStaleHint();
    return filename;
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


function handleValidatedImport(projects, onAfterReplace) {

    const before = describeCurrentState();
    const projectWord = before.projectCount === 1 ? 'project' : 'projects';
    const todoWord = before.todoCount === 1 ? 'todo' : 'todos';
    const msg = 'Replace all current todos with this file? Your existing '
        + before.todoCount + ' ' + todoWord + ' across '
        + before.projectCount + ' ' + projectWord + ' will be permanently overwritten.';

    showConfirmModal({
        message: msg,
        confirmLabel: 'Replace',
        danger: true,
        onConfirm: function() {
            listLogic.replaceAllProjects(projects);
            if (typeof onAfterReplace === 'function') onAfterReplace();
        },
    });
}


export function importFromFile(file, onAfterReplace) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function() {
        const text = typeof reader.result === 'string' ? reader.result : '';
        const result = parseAndValidateExport(text);
        if (!result.ok) {
            showImportError(result.error);
            return;
        }
        handleValidatedImport(result.projects, onAfterReplace);
    };
    reader.onerror = function() {
        showImportError("Couldn't read that file — expected a todos export.");
    };
    reader.readAsText(file);
}


// ── UI WIRING ──
//
// createExportImportControls builds a small icon group ("download" + "upload")
// for the nav bar. The reload-after-import callback comes from main.js so
// this module doesn't have to know about restoreFromStorage / DOM rebuild.

const DOWNLOAD_SVG =
    '<svg viewBox="0 0 7 7" width="14" height="14" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">' +
    '<rect x="3" y="0" width="1" height="4"/>' +
    '<rect x="2" y="3" width="1" height="1"/>' +
    '<rect x="4" y="3" width="1" height="1"/>' +
    '<rect x="1" y="2" width="1" height="2"/>' +
    '<rect x="5" y="2" width="1" height="2"/>' +
    '<rect x="0" y="5" width="7" height="1"/>' +
    '</svg>';

const UPLOAD_SVG =
    '<svg viewBox="0 0 7 7" width="14" height="14" fill="currentColor" shape-rendering="crispEdges" aria-hidden="true">' +
    '<rect x="3" y="2" width="1" height="4"/>' +
    '<rect x="2" y="2" width="1" height="1"/>' +
    '<rect x="4" y="2" width="1" height="1"/>' +
    '<rect x="1" y="3" width="1" height="2"/>' +
    '<rect x="5" y="3" width="1" height="2"/>' +
    '<rect x="0" y="0" width="7" height="1"/>' +
    '</svg>';

export function createExportImportControls(options) {

    const wrapper = document.createElement('div');
    wrapper.id = 'exportImportControls';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.id = 'exportTodosBtn';
    exportBtn.className = 'navIconBtn';
    exportBtn.title = 'Export todos';
    exportBtn.setAttribute('aria-label', 'Export todos');
    exportBtn.innerHTML = DOWNLOAD_SVG;
    exportBtn.addEventListener('click', function() { exportTodosToFile(); });

    const importBtn = document.createElement('button');
    importBtn.type = 'button';
    importBtn.id = 'importTodosBtn';
    importBtn.className = 'navIconBtn';
    importBtn.title = 'Import todos';
    importBtn.setAttribute('aria-label', 'Import todos');
    importBtn.innerHTML = UPLOAD_SVG;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json';
    fileInput.id = 'importTodosInput';
    fileInput.style.display = 'none';

    importBtn.addEventListener('click', function() { fileInput.click(); });
    fileInput.addEventListener('change', function() {
        const file = fileInput.files && fileInput.files[0];
        if (!file) return;
        importFromFile(file, options && options.onAfterReplace);
        // Reset so re-selecting the same file fires the change event again.
        fileInput.value = '';
    });

    wrapper.appendChild(exportBtn);
    wrapper.appendChild(importBtn);
    wrapper.appendChild(fileInput);

    return wrapper;
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


// ── STALE-EXPORT FOOTER HINT ──

let staleHintDismissedThisSession = false;

function hasAnyTodos() {
    const projects = listLogic.listProjectsArray();
    for (let i = 0; i < projects.length; i++) {
        const items = listLogic.listItems(projects[i]) || [];
        for (let j = 0; j < items.length; j++) {
            if (items[j] && items[j].tit) return true;
        }
    }
    return false;
}

function daysSinceIso(iso) {
    if (!iso) return Infinity;
    const t = Date.parse(iso);
    if (isNaN(t)) return Infinity;
    return Math.floor((Date.now() - t) / MS_PER_DAY);
}

export function refreshStaleHint() {
    const hint = document.getElementById('staleExportHint');
    if (!hint) return;

    if (staleHintDismissedThisSession) {
        hint.style.display = 'none';
        return;
    }

    const days = daysSinceIso(readLastExportedAt());
    const stale = days >= STALE_DAYS;
    if (!stale || !hasAnyTodos()) {
        hint.style.display = 'none';
        return;
    }

    const label = hint.querySelector('.staleExportHintLabel');
    if (label) {
        if (days === Infinity) {
            label.textContent = 'No backup yet — export?';
        } else {
            label.textContent = 'Last backup: ' + days
                + (days === 1 ? ' day ago — export?' : ' days ago — export?');
        }
    }
    hint.style.display = 'inline-flex';
}

export function createStaleExportHint() {

    const hint = document.createElement('span');
    hint.id = 'staleExportHint';
    hint.setAttribute('role', 'status');
    hint.style.display = 'none';

    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'staleExportHintLabel';
    link.textContent = 'Last backup: — export?';
    link.addEventListener('click', function() { exportTodosToFile(); });

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'staleExportHintDismiss';
    dismiss.setAttribute('aria-label', 'Dismiss backup reminder');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', function() {
        staleHintDismissedThisSession = true;
        hint.style.display = 'none';
    });

    hint.appendChild(link);
    hint.appendChild(dismiss);
    return hint;
}
