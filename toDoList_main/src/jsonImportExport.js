// Direct-to-Supabase JSON export / import.
//
// Replaces the cut Drive sync feature with a manual escape hatch: one button
// downloads the user's entire dataset as a portable JSON file, another reads
// such a file back and replaces everything in Supabase with its contents.
//
// Unlike exportImport.js (which round-trips through listLogic's in-memory
// snapshot), this module reads and writes Supabase directly so the file
// reflects authoritative server state — important when local state has
// drifted from the cloud or when the user wants an off-app backup.

import { supabase } from './supabaseClient.js';
import { showConfirmModal } from './modals.js';
import { listLogic } from './listLogic.js';

const EXPORT_VERSION = 1;


// ── PURE HELPERS ──

// Build the v1 export envelope from raw Supabase rows. Kept pure so tests
// can exercise the shape without standing up a fake backend.
export function buildExportPayload(projects, todos, now) {
    return {
        version: EXPORT_VERSION,
        exportedAt: (now || new Date()).toISOString(),
        projects: Array.isArray(projects) ? projects : [],
        todos: Array.isArray(todos) ? todos : [],
    };
}

// Synchronous shape check for an already-parsed JSON object. Returns
// `{ valid: true }` on success or `{ valid: false, error: '...' }` with a
// user-facing message on failure. Validates the version field, that
// projects and todos are arrays, and that every row has the minimum
// fields the importer needs to write it back to Supabase.
export function validateImportShape(json) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return { valid: false, error: 'Invalid export file — could not parse' };
    }
    if (json.version !== EXPORT_VERSION) {
        return { valid: false, error: 'Unsupported export format' };
    }
    if (!Array.isArray(json.projects) || !Array.isArray(json.todos)) {
        return { valid: false, error: 'Invalid export file — could not parse' };
    }
    for (let i = 0; i < json.projects.length; i++) {
        const p = json.projects[i];
        if (!p || typeof p !== 'object' || !p.id || !p.name) {
            return { valid: false, error: 'Invalid export file — could not parse' };
        }
    }
    for (let i = 0; i < json.todos.length; i++) {
        const t = json.todos[i];
        if (!t || typeof t !== 'object' || !t.id || !t.project_id || !t.title) {
            return { valid: false, error: 'Invalid export file — could not parse' };
        }
    }
    return { valid: true };
}


// ── UI HELPERS ──

// Local toast — Drive's shared toast was cut along with the rest of the
// Drive UI, so a minimal inline helper keeps this module self-contained
// rather than reviving a generic toast module for a single caller.
function showToast(message) {
    const prior = document.getElementById('jsonImportExportToast');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const toast = document.createElement('div');
    toast.id = 'jsonImportExportToast';
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
}

function todayDateString(now) {
    const d = now || new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
}

// Trigger a browser download via a synthetic anchor element. Revoke the
// object URL on a short delay so the browser has time to start the
// download before the URL is invalidated.
function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    if (anchor.parentNode) anchor.parentNode.removeChild(anchor);
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
}


// ── EXPORT ──

// Read the user's projects + todos directly from Supabase and trigger a
// browser download of the JSON envelope. Returns a Promise that resolves
// once the download has been triggered (or rejected silently on failure
// — the toast carries the user-facing signal).
export async function exportToJson() {
    try {
        const sessionResult = await supabase.auth.getSession();
        const session = sessionResult
            && sessionResult.data
            && sessionResult.data.session;
        if (!session) {
            showToast('Export failed — try again');
            return;
        }
        const userId = session.user.id;

        const projRes = await supabase
            .from('projects')
            .select('*')
            .eq('user_id', userId);

        // DO NOT add user_id to todos queries — see
        // tests/listLogicSchema.test.js. The todos table has no user_id
        // column; per-user access is enforced by RLS via a sub-select
        // against the parent project.
        const todoRes = await supabase
            .from('todos')
            .select('*');

        if ((projRes && projRes.error) || (todoRes && todoRes.error)) {
            showToast('Export failed — try again');
            return;
        }

        const projects = (projRes && projRes.data) || [];
        const todos = (todoRes && todoRes.data) || [];

        const payload = buildExportPayload(projects, todos);
        const json = JSON.stringify(payload, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        triggerDownload(blob, 'todolist-export-' + todayDateString() + '.json');
    } catch (_e) {
        showToast('Export failed — try again');
    }
}


// ── IMPORT ──

// Read a File object's text, JSON.parse it, and run validateImportShape on
// the result. Returns a Promise that resolves with the parsed object on
// success or rejects with an Error carrying a user-facing message on
// failure.
export function readAndValidateFile(file) {
    return new Promise(function(resolve, reject) {
        if (!file) {
            reject(new Error('Invalid export file — could not parse'));
            return;
        }
        const reader = new FileReader();
        reader.onload = function() {
            const text = typeof reader.result === 'string' ? reader.result : '';
            let parsed;
            try {
                parsed = JSON.parse(text);
            } catch (_e) {
                reject(new Error('Invalid export file — could not parse'));
                return;
            }
            const validation = validateImportShape(parsed);
            if (!validation.valid) {
                reject(new Error(validation.error));
                return;
            }
            resolve(parsed);
        };
        reader.onerror = function() {
            reject(new Error('Invalid export file — could not parse'));
        };
        reader.readAsText(file);
    });
}

// Read + validate a chosen file, show the destructive confirm modal with
// the project/todo counts, and on confirm replace the user's Supabase
// data with the imported rows. After all inserts succeed, kick
// hydrateFromSupabase so the UI rebuilds against the freshly-imported
// state.
//
// Errors before deletion show "your data was not changed". Errors after
// deletion succeeds but inserts fail show a more aggressive message
// because the user is now in a half-imported state.
export async function importFromJson(file, onAfterImport) {
    let parsed;
    try {
        parsed = await readAndValidateFile(file);
    } catch (e) {
        showToast((e && e.message) || 'Invalid export file — could not parse');
        return;
    }

    const projectCount = parsed.projects.length;
    const todoCount = parsed.todos.length;
    const projectWord = projectCount === 1 ? 'project' : 'projects';
    const todoWord = todoCount === 1 ? 'todo' : 'todos';
    const message = 'Replace all your data with the contents of this file? '
        + 'Your current ' + projectCount + ' ' + projectWord + ' and '
        + todoCount + ' ' + todoWord
        + ' will be deleted and replaced.';

    showConfirmModal({
        message: message,
        confirmLabel: 'Replace',
        danger: true,
        onConfirm: function() {
            performImport(parsed, onAfterImport);
        },
    });
}

async function performImport(parsed, onAfterImport) {
    try {
        const sessionResult = await supabase.auth.getSession();
        const session = sessionResult
            && sessionResult.data
            && sessionResult.data.session;
        if (!session) {
            showToast('Import failed — your data was not changed');
            return;
        }
        const userId = session.user.id;

        // Delete all the user's projects — todos cascade via the FK's
        // ON DELETE CASCADE. If this fails the user's data is still
        // intact, so the softer error message applies.
        const delRes = await supabase
            .from('projects')
            .delete()
            .eq('user_id', userId);
        if (delRes && delRes.error) {
            showToast('Import failed — your data was not changed');
            return;
        }

        // Bulk-insert projects then todos. After this point a failure
        // leaves the user in a half-empty state, so the message escalates.
        if (parsed.projects.length > 0) {
            const projInsert = await supabase
                .from('projects')
                .insert(parsed.projects);
            if (projInsert && projInsert.error) {
                showToast('Import failed — your data may be in an inconsistent state. Try importing again or contact support.');
                return;
            }
        }

        if (parsed.todos.length > 0) {
            const todoInsert = await supabase
                .from('todos')
                .insert(parsed.todos);
            if (todoInsert && todoInsert.error) {
                showToast('Import failed — your data may be in an inconsistent state. Try importing again or contact support.');
                return;
            }
        }

        // Re-hydrate so the UI reflects the imported data. hydrateFromSupabase
        // dispatches listLogicHydrated which main.js's listener uses to
        // rebuild the sidebar + active project.
        await listLogic.hydrateFromSupabase();

        if (typeof onAfterImport === 'function') onAfterImport();
    } catch (_e) {
        showToast('Import failed — your data may be in an inconsistent state. Try importing again or contact support.');
    }
}


// Open a hidden native file picker filtered to .json files. On selection,
// hand the chosen file off to importFromJson.
export function openImportPicker(onAfterImport) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.addEventListener('change', function() {
        const file = input.files && input.files[0];
        if (input.parentNode) input.parentNode.removeChild(input);
        if (file) importFromJson(file, onAfterImport);
    });
    input.click();
}
