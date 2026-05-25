// Phase 6 — first-login migration of localStorage data to Supabase
// + sign-out localStorage wipe.
//
// MIGRATION
//   On the first sign-in for a given user on a given device, this module
//   checks whether the user's Supabase account already holds data. If
//   cloud is empty and localStorage still carries projects from a pre-
//   auth session, the cache is uploaded to Supabase before the normal
//   hydration path runs (sequence: migrate → hydrate → render). A per-
//   user marker (`migrated_user_<userId>`) is written to localStorage so
//   subsequent sign-ins on the same device skip the cloud-count probe
//   and head straight into hydration.
//
//   Conflict policy on the diverged case (cloud has data AND local has
//   data): cloud wins. The local copy is silently discarded by the
//   subsequent hydration step; only the marker is set here.
//
// SIGN-OUT WIPE
//   `wipeLocalUserDataOnSignOut` is called from the desktop ghost-menu
//   Sign-out row and the mobile Settings modal Sign-out row right before
//   `supabase.auth.signOut()`. It removes the user-data keys (the
//   `allProjects` cache and the migration marker for the signed-in user)
//   so the next user on the same browser starts with a clean slate.
//   Device-scoped UI prefs (theme, sidebar width, etc.) are intentionally
//   preserved — they're not user data.

import { supabase } from './supabaseClient.js';
import { listLogic } from './listLogic.js';

const MIGRATION_MARKER_PREFIX = 'migrated_user_';
const ALL_PROJECTS_KEY = 'allProjects';

function markerKey(userId) {
    return MIGRATION_MARKER_PREFIX + userId;
}

// UUID generator with a manual v4 fallback for the rare runtime where
// crypto.randomUUID isn't available (very old browsers). Mirrors the
// defensive shape called out in the Phase 6 acceptance criteria.
function generateUUID() {
    if (typeof globalThis !== 'undefined'
        && globalThis.crypto
        && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    if (typeof globalThis !== 'undefined'
        && globalThis.crypto
        && typeof globalThis.crypto.getRandomValues === 'function') {
        const bytes = new Uint8Array(16);
        globalThis.crypto.getRandomValues(bytes);
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [];
        for (let i = 0; i < 16; i++) {
            hex.push((bytes[i] + 0x100).toString(16).slice(1));
        }
        return hex.slice(0, 4).join('')
            + '-' + hex.slice(4, 6).join('')
            + '-' + hex.slice(6, 8).join('')
            + '-' + hex.slice(8, 10).join('')
            + '-' + hex.slice(10, 16).join('');
    }
    return null;
}

// In-memory date format ("M-D-YYYY") → Postgres ISO ("YYYY-MM-DD").
// Duplicated from listLogic.js intentionally so this module can build
// payloads independently of the listLogic IIFE evaluation order.
function dueStringToISO(due) {
    if (!due || typeof due !== 'string') return null;
    if (due === '' || due === '--' || due === 'X-X-XXXX') return null;
    const parts = due.split('-');
    if (parts.length !== 3) return null;
    const m = parseInt(parts[0], 10);
    const d = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
    const mm = m < 10 ? '0' + m : '' + m;
    const dd = d < 10 ? '0' + d : '' + d;
    return y + '-' + mm + '-' + dd;
}

function readLocalProjects() {
    let raw;
    try {
        raw = localStorage.getItem(ALL_PROJECTS_KEY);
    } catch (_) {
        return null;
    }
    if (!raw) return null;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch (_) {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
}


// Run the one-shot per-user migration. Safe to call on every sign-in:
// the marker check short-circuits when the migration has already run
// for this user on this device.
//
// Sequence:
//   1. If marker set → return (already migrated).
//   2. Probe Supabase for any project owned by this user.
//   3. If cloud has data → set marker, return (cloud wins; hydration
//      will overwrite local).
//   4. If cloud empty but local empty → set marker, return.
//   5. If cloud empty AND local has projects → upload each project +
//      todo via persistMutation; set marker only after every insert
//      either succeeded or hit a duplicate-key conflict (23505). Any
//      other insert failure leaves the marker unset so the next sign-
//      in retries the upload.
export async function maybeMigrateLocalToSupabase(userId) {
    if (!userId) return;

    let markerSet = false;
    try {
        markerSet = localStorage.getItem(markerKey(userId)) === 'true';
    } catch (_) { /* ignore */ }
    if (markerSet) return;

    let probe;
    try {
        probe = await supabase
            .from('projects')
            .select('id')
            .eq('user_id', userId)
            .limit(1);
    } catch (e) {
        console.warn('[migration] cloud probe threw:', e);
        return;
    }
    if (probe && probe.error) {
        console.warn('[migration] cloud probe error:', probe.error);
        return;
    }
    const cloudHasData = !!(probe && Array.isArray(probe.data) && probe.data.length > 0);

    const localProjects = readLocalProjects();
    const localNames = localProjects ? Object.keys(localProjects) : [];

    if (!cloudHasData && localNames.length > 0) {
        const ok = await uploadLocalToCloud(localProjects, localNames);
        if (!ok) return;
    }

    try {
        localStorage.setItem(markerKey(userId), 'true');
    } catch (_) { /* ignore */ }
}


async function uploadLocalToCloud(localProjects, names) {
    let allOk = true;
    for (let i = 0; i < names.length; i++) {
        const name = names[i];
        const entry = localProjects[name];
        if (!entry || typeof entry !== 'object') continue;

        if (typeof entry.id !== 'string' || entry.id.length === 0) {
            const fresh = generateUUID();
            if (!fresh) {
                console.warn('[migration] no UUID source; cannot upload project:', name);
                allOk = false;
                continue;
            }
            console.warn('[migration] project missing id; generated UUID for:', name);
            entry.id = fresh;
        }

        const projOk = await runInsert({
            op: 'insert',
            table: 'projects',
            payload: {
                id: entry.id,
                name: name,
                color: entry.color || null,
                position: i,
            },
        });
        if (!projOk) {
            allOk = false;
            continue;
        }

        const items = Array.isArray(entry.items) ? entry.items : [];
        for (let j = 0; j < items.length; j++) {
            const item = items[j];
            if (!item || typeof item !== 'object') continue;
            // Blank-placeholder rows live at index 0 of every project
            // and are render artifacts only — persistMutation already
            // filters them at the boundary; the same guard here keeps
            // the no-op cost out of the round-trip.
            if (!item.tit || item.tit === '') continue;

            if (typeof item.id !== 'string' || item.id.length === 0) {
                const fresh = generateUUID();
                if (!fresh) {
                    console.warn('[migration] no UUID source; cannot upload todo in project:', name);
                    allOk = false;
                    continue;
                }
                console.warn('[migration] todo missing id; generated UUID in project:', name);
                item.id = fresh;
            }

            const todoOk = await runInsert({
                op: 'insert',
                table: 'todos',
                payload: {
                    id: item.id,
                    project_id: entry.id,
                    title: item.tit,
                    description: item.desc || null,
                    due_date: dueStringToISO(item.due),
                    priority: item.pri == null ? null : String(item.pri),
                    position: item.pos == null ? j : item.pos,
                    completed: !!item.completed,
                    recurrence: item.recurrence || null,
                },
            });
            if (!todoOk) allOk = false;
        }
    }
    return allOk;
}


// Fire a persistMutation insert and treat a duplicate-key conflict
// (Postgres 23505) as a success — the row is already on the server,
// which is exactly "cloud wins" for the partial-retry case. Any other
// error is propagated so the caller can decide whether to set the
// marker.
async function runInsert(req) {
    let result;
    try {
        result = await listLogic.persistMutation(req);
    } catch (e) {
        console.warn('[migration] persistMutation threw:', e);
        return false;
    }
    if (!result) return true; // session lost / blank-title skip / no-op
    if (result.error) {
        if (result.error.code === '23505') return true;
        return false;
    }
    return true;
}


// Sign-out helper: remove user-data localStorage keys for the signed-
// in user. Called immediately before supabase.auth.signOut() so the
// session is still available for reading the userId. UI prefs (theme,
// sidebar width, etc.) are intentionally left in place — those are
// device-scoped, not user-scoped.
export async function wipeLocalUserDataOnSignOut() {
    let userId = null;
    try {
        const sessionResult = await supabase.auth.getSession();
        const session = sessionResult
            && sessionResult.data
            && sessionResult.data.session;
        userId = session && session.user && session.user.id;
    } catch (_) { /* ignore */ }

    try { localStorage.removeItem(ALL_PROJECTS_KEY); } catch (_) { /* ignore */ }
    if (userId) {
        try { localStorage.removeItem(markerKey(userId)); } catch (_) { /* ignore */ }
    }
}
