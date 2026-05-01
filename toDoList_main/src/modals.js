// Confirm + changelog modals and the service-worker update cue.
//
// Per CLAUDE.md, destructive actions need a confirmation step (handled by
// showConfirmModal — an async, themed replacement for window.confirm), and
// modals must close on close-button, backdrop click, and Escape. Both modals
// here implement all three affordances.
//
// The footer version label opens showChangelogModal, which lists the entries
// from changelog.js. The footer also hosts a "new entries available" dot
// (#changelogDot) whose visibility is controlled by updateChangelogDot —
// driven by the changelog last-seen marker in prefs.js, plus an override for
// pending service-worker updates so the same visual cue surfaces both
// "new release notes" and "reload to apply update".

import { changelog, getNewestChangelogDate } from './changelog.js';
import { readChangelogLastSeen, writeChangelogLastSeen } from './prefs.js';


// ── CONFIRM MODAL ──
// Async, themed replacement for window.confirm. Destructive actions (delete
// project, delete todo) require a confirmation step per CLAUDE.md; the native
// dialog breaks visual continuity and can't be styled. Closes on Cancel,
// backdrop click, or Escape — matching the modal conventions in CLAUDE.md.
export function showConfirmModal(options) {

    // Defensive: remove any stray prior modal so we never stack two.
    const prior = document.getElementById('confirmModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'confirmModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'confirmModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const msg = document.createElement('div');
    msg.id = 'confirmModalMessage';
    msg.textContent = options.message || '';

    const actions = document.createElement('div');
    actions.id = 'confirmModalActions';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'confirmModalCancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.id = 'confirmModalConfirm';
    confirmBtn.type = 'button';
    if (options.danger !== false) confirmBtn.classList.add('danger');
    confirmBtn.textContent = options.confirmLabel || 'Delete';

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    dialog.appendChild(msg);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Focus the confirm button so keyboard users can Enter-to-confirm
    // immediately and Escape-to-cancel works without a tab first.
    confirmBtn.focus();

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    }

    cancelBtn.addEventListener('click', close);
    confirmBtn.addEventListener('click', function() {
        close();
        if (typeof options.onConfirm === 'function') options.onConfirm();
    });
    // Only backdrop clicks should dismiss — clicks inside the dialog should not.
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);
}


// ── CHANGELOG MODAL ──
// Footer version label opens this: a dismissible dialog listing version
// history from changelog.js. Mirrors showConfirmModal's backdrop + Escape +
// backdrop-click dismissal, but swaps the confirm/cancel footer for a single
// Close button and adds an explicit corner X.
//
// The last-seen marker key/getters/setters live in prefs.js.

// ISO YYYY-MM-DD strings sort lexicographically, so string compare suffices.
function hasUnseenChangelog() {
    const newest = getNewestChangelogDate();
    if (!newest) return false;
    const lastSeen = readChangelogLastSeen();
    if (!lastSeen) return true;
    return newest > lastSeen;
}

export function updateChangelogDot() {
    const dot = document.getElementById('changelogDot');
    if (!dot) return;
    // When a pending service-worker update exists, the dot is forced on to
    // surface the reload cue regardless of changelog-seen state.
    const show = hasUnseenChangelog() || pendingUpdateRegistration !== null;
    dot.style.display = show ? 'inline-block' : 'none';
}

// ── SERVICE WORKER UPDATE CUE ──
// index.js registers the service worker and calls notifyUpdateAvailable()
// once a new worker reaches the `waiting` state. The footer version label
// reuses the #changelogDot visual vocabulary to signal the update, and its
// click handler switches from "open changelog" to "skipWaiting + reload".
let pendingUpdateRegistration = null;

export function notifyUpdateAvailable(registration) {
    pendingUpdateRegistration = registration || null;
    const footVersion = document.getElementById('footVersion');
    if (footVersion) {
        footVersion.classList.add('hasUpdate');
        footVersion.setAttribute('title', 'Update available — reload to apply');
        footVersion.setAttribute('aria-label', 'Update available — reload to apply');
    }
    updateChangelogDot();
}

export function applyPendingUpdate() {
    const registration = pendingUpdateRegistration;
    if (!registration) return false;
    const worker = registration.waiting || registration.installing;
    if (worker && typeof worker.postMessage === 'function') {
        worker.postMessage({ type: 'SKIP_WAITING' });
    } else {
        // Fallback — nothing to message, just reload so the user sees the cue clear.
        window.location.reload();
    }
    return true;
}

export function showChangelogModal() {
    const prior = document.getElementById('changelogModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'changelogModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'changelogModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'changelogModalTitle');

    const header = document.createElement('div');
    header.id = 'changelogModalHeader';

    const title = document.createElement('div');
    title.id = 'changelogModalTitle';
    title.textContent = 'Changelog';

    const closeX = document.createElement('button');
    closeX.id = 'changelogModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close changelog');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'changelogModalBody';

    changelog.forEach(function(entry) {
        const block = document.createElement('section');
        block.className = 'changelogEntry';

        const heading = document.createElement('div');
        heading.className = 'changelogEntryHeading';

        const ver = document.createElement('span');
        ver.className = 'changelogEntryVersion';
        ver.textContent = 'v' + entry.version;

        const date = document.createElement('span');
        date.className = 'changelogEntryDate';
        date.textContent = entry.date;

        heading.appendChild(ver);
        heading.appendChild(date);
        block.appendChild(heading);

        [
            ['Added',   entry.added],
            ['Changed', entry.changed],
            ['Fixed',   entry.fixed]
        ].forEach(function(pair) {
            const label = pair[0];
            const bullets = pair[1];
            if (!bullets || !bullets.length) return;

            const groupLabel = document.createElement('div');
            groupLabel.className = 'changelogGroupLabel';
            groupLabel.textContent = label;

            const list = document.createElement('ul');
            list.className = 'changelogBullets';
            bullets.forEach(function(text) {
                const li = document.createElement('li');
                li.textContent = text;
                list.appendChild(li);
            });

            block.appendChild(groupLabel);
            block.appendChild(list);
        });

        body.appendChild(block);
    });

    const actions = document.createElement('div');
    actions.id = 'changelogModalActions';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'changelogModalCloseBtn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';

    actions.appendChild(closeBtn);
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    closeBtn.focus();

    // Mark the newest entry as seen the moment the modal opens. Drop the dot
    // immediately so returning from the modal shows its new baseline state.
    const newest = getNewestChangelogDate();
    if (newest) writeChangelogLastSeen(newest);
    updateChangelogDot();

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    }

    closeX.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);
}


// ── SHORTCUTS MODAL ──
// Opens from the floating `?` help button (bottom-right of the viewport) and
// from the global `?` keydown. Mirrors showChangelogModal for close-on-X,
// close-on-backdrop, and close-on-Escape. The shortcut catalogue is grouped
// by category (Navigation, Editing, Global) — when a future task adds new
// bindings, append entries here so the modal stays the single source of truth
// for what the keyboard does.
const SHORTCUT_GROUPS = [
    {
        category: 'Navigation',
        items: [
            { keys: ['N'],      description: 'Jump to the new-task input' },
            { keys: ['↑'],      description: 'Move focus to the previous todo row' },
            { keys: ['↓'],      description: 'Move focus to the next todo row' },
        ],
    },
    {
        category: 'Editing',
        items: [
            { keys: ['Enter'],  description: 'Commit the current title or description, or edit the focused row' },
            { keys: ['Delete'], description: 'Delete the focused todo row (with confirmation)' },
        ],
    },
    {
        category: 'Global',
        items: [
            { keys: ['?'],      description: 'Open this keyboard shortcuts list' },
            { keys: ['Esc'],    description: 'Close the open modal, popover, or context menu' },
        ],
    },
];

export function showShortcutsModal() {
    const prior = document.getElementById('shortcutsModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'shortcutsModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'shortcutsModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'shortcutsModalTitle');

    const header = document.createElement('div');
    header.id = 'shortcutsModalHeader';

    const title = document.createElement('div');
    title.id = 'shortcutsModalTitle';
    title.textContent = 'Keyboard Shortcuts';

    const closeX = document.createElement('button');
    closeX.id = 'shortcutsModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close keyboard shortcuts');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'shortcutsModalBody';

    SHORTCUT_GROUPS.forEach(function(group) {
        const block = document.createElement('section');
        block.className = 'shortcutsGroup';

        const groupLabel = document.createElement('div');
        groupLabel.className = 'shortcutsGroupLabel';
        groupLabel.textContent = group.category;
        block.appendChild(groupLabel);

        const list = document.createElement('ul');
        list.className = 'shortcutsList';

        group.items.forEach(function(item) {
            const row = document.createElement('li');
            row.className = 'shortcutsRow';

            const keys = document.createElement('span');
            keys.className = 'shortcutsKeys';
            item.keys.forEach(function(k, i) {
                if (i > 0) {
                    const plus = document.createElement('span');
                    plus.className = 'shortcutsKeySep';
                    plus.textContent = '+';
                    keys.appendChild(plus);
                }
                const kbd = document.createElement('kbd');
                kbd.className = 'shortcutsKey';
                kbd.textContent = k;
                keys.appendChild(kbd);
            });

            const desc = document.createElement('span');
            desc.className = 'shortcutsDesc';
            desc.textContent = item.description;

            row.appendChild(keys);
            row.appendChild(desc);
            list.appendChild(row);
        });

        block.appendChild(list);
        body.appendChild(block);
    });

    const actions = document.createElement('div');
    actions.id = 'shortcutsModalActions';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'shortcutsModalCloseBtn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';

    actions.appendChild(closeBtn);
    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    closeBtn.focus();

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    }

    closeX.addEventListener('click', close);
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);
}


// ── SHORTCUTS HELP FAB ──
// The floating circular `?` button sits at the bottom-right of the viewport
// on desktop and pointer-fine devices. CSS handles both visibility rules:
// the `pointer: coarse` media query hides it on touch viewports (where the
// shortcuts don't apply), and `body:has(...)` hides it whenever any modal,
// popover, or context menu is in the DOM so it never overlaps one. JS just
// creates the element and the `?` click handler — no visibility bookkeeping.
//
// The matching guard for the global `?` keydown lives in main.js and uses
// isAnyModalOrPopoverOpen so the shortcut is suppressed under the same
// conditions the FAB hides.
export function isAnyModalOrPopoverOpen() {
    return !!(
        document.getElementById('confirmModalBackdrop')   ||
        document.getElementById('changelogModalBackdrop') ||
        document.getElementById('shortcutsModalBackdrop') ||
        document.getElementById('dueDatePopover')         ||
        document.getElementById('projContextMenu')
    );
}

export function createShortcutsHelpFab() {
    const fab = document.createElement('button');
    fab.id = 'shortcutsHelpFab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Open keyboard shortcuts');
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.title = 'Keyboard shortcuts (?)';
    fab.textContent = '?';
    fab.addEventListener('click', function() {
        showShortcutsModal();
    });
    return fab;
}
