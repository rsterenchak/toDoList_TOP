// Offline backup nudge — a quiet one-line reminder above the task list that an
// offline (no-account) device keeps its tasks in this browser only.
//
// Shown in local mode when there is at least one todo and the device has never
// exported, or last exported more than 7 days ago. Its Export action runs the
// local export (which stamps `todoapp_lastExportAt`); × stamps
// `todoapp_backupNudgeDismissedAt` and keeps it away for 7 days. It never
// renders on a signed-in device.
//
// #mainList is wiped and rebuilt on every project switch and re-render, so the
// row is re-placed by a MutationObserver rather than once at mount. The
// observer is attached on every boot (a signed-in shell just never shows the
// row) because the gate's offline door switches mode without rebuilding.

import { listLogic } from './listLogic.js';
import { hasAccount } from './accessMode.js';
import { exportToJson, LAST_EXPORT_KEY } from './jsonImportExport.js';

export const BACKUP_NUDGE_DISMISSED_KEY = 'todoapp_backupNudgeDismissedAt';
export const BACKUP_NUDGE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function readStamp(key) {
    try {
        const n = parseInt(localStorage.getItem(key), 10);
        return isNaN(n) ? null : n;
    } catch (_) { return null; }
}

function writeStamp(key, now) {
    try { localStorage.setItem(key, String(now)); } catch (_) { /* storage denied */ }
}

function isLocalShell() {
    if (hasAccount()) return false;
    return typeof document !== 'undefined'
        && document.documentElement.dataset.access === 'local';
}

function hasAnyTodo() {
    return listLogic.listProjectsArray().some(function(name) {
        const items = listLogic.listItems(name) || [];
        return items.some(function(item) { return item && item.tit; });
    });
}

export function shouldShowBackupNudge(now) {
    if (!isLocalShell()) return false;
    const t = typeof now === 'number' ? now : Date.now();
    const exportedAt = readStamp(LAST_EXPORT_KEY);
    if (exportedAt !== null && t - exportedAt < BACKUP_NUDGE_INTERVAL_MS) return false;
    const dismissedAt = readStamp(BACKUP_NUDGE_DISMISSED_KEY);
    if (dismissedAt !== null && t - dismissedAt < BACKUP_NUDGE_INTERVAL_MS) return false;
    return hasAnyTodo();
}

function buildBackupNudge(onDone) {
    const row = document.createElement('div');
    row.id = 'backupNudge';
    row.setAttribute('role', 'status');

    const chip = document.createElement('span');
    chip.className = 'backupNudgeChip';
    chip.textContent = 'Offline';

    const text = document.createElement('span');
    text.className = 'backupNudgeText';
    text.textContent = ' · your tasks live in this browser. Export a backup.';

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'backupNudgeExport';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', function() {
        exportToJson();
        onDone();
    });

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'backupNudgeDismiss';
    dismissBtn.setAttribute('aria-label', 'Dismiss backup reminder');
    dismissBtn.textContent = '×';
    dismissBtn.addEventListener('click', function() {
        writeStamp(BACKUP_NUDGE_DISMISSED_KEY, Date.now());
        onDone();
    });

    row.appendChild(chip);
    row.appendChild(text);
    row.appendChild(exportBtn);
    row.appendChild(dismissBtn);
    return row;
}

// Place or remove the row to match shouldShowBackupNudge. Idempotent.
export function refreshBackupNudge(mainList) {
    const list = mainList || document.getElementById('mainList');
    if (!list) return;
    const existing = list.querySelector('#backupNudge');
    if (!shouldShowBackupNudge()) {
        if (existing) existing.remove();
        return;
    }
    if (existing) return;
    list.insertBefore(buildBackupNudge(function() { refreshBackupNudge(list); }), list.firstChild);
}

export function mountBackupNudge(mainList) {
    if (!mainList) return;
    refreshBackupNudge(mainList);
    if (typeof MutationObserver === 'undefined') return;
    new MutationObserver(function() {
        refreshBackupNudge(mainList);
    }).observe(mainList, { childList: true });
}
