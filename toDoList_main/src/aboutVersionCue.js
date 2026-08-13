import { applyPendingUpdate, hasPendingUpdate } from './modals.js';

// The collateral reload runs main.js's `requestAppReload` (a splash-wrapped
// full-page reload). It is registered here at bootstrap rather than imported,
// so this leaf module never has to import the heavy main.js entry — which would
// form a cycle and pull main's bootstrap into every test that mounts the
// Settings modal in isolation. Mirrors structureCanvas.js's setLocateTabSwitch.
// Unset until main.js registers it; the pill then just no-ops.
let appReloader = null;
export function setAppReloader(fn) {
    appReloader = typeof fn === 'function' ? fn : null;
}

// Set once a SIBLING tab applied the service-worker update. index.js dispatches
// `appUpdateAppliedElsewhere` on any controllerchange this tab did not initiate
// (see the initiator baton in modals.js), which leaves this tab running the
// bundle it loaded at boot while the new worker is already in control. Nothing
// is broken by that, but the tab is a build behind, so the Version row stops
// offering "tap to apply" — the waiting worker it would message is gone — and
// offers a plain reload instead.
let updateAppliedElsewhere = false;
// The Version row most recently painted, so the event can repaint a Settings
// modal that is already open. The isConnected check below covers the closed
// case: a detached row is left alone and the next open paints from scratch.
let cueRow = null;

// Paint the service-worker update cue on the About → Version row.
// When a new worker is waiting (hasPendingUpdate()), the muted value
// pill is replaced by a tappable accent-colored "Update available"
// pill that calls applyPendingUpdate (skipWaiting + reload — the
// same flow the desktop footer's #footVersion runs). When another tab
// already applied the update, the same pill becomes a plain
// "Reload to finish" instead. When no update is pending the row reverts
// to its read-only state. Idempotent — safe to call from both the
// initial render and the event handlers while the modal is open.
export function paintAboutVersionUpdateCue(versionRow) {
    if (!versionRow) return;
    cueRow = versionRow;
    const existingPill = versionRow.querySelector('.settingsAboutUpdatePill');
    if (updateAppliedElsewhere) {
        versionRow.classList.add('hasUpdate');
        // Replace rather than re-text any existing pill: the "Update available"
        // pill's click posts SKIP_WAITING to a worker that has already
        // activated, so that handler is dead and must not survive the swap.
        if (existingPill && existingPill.parentNode) {
            existingPill.parentNode.removeChild(existingPill);
        }
        const reloadPill = document.createElement('button');
        reloadPill.type = 'button';
        reloadPill.className = 'settingsAboutUpdatePill';
        reloadPill.textContent = 'Reload to finish';
        reloadPill.setAttribute('aria-label', 'Update applied in another tab — tap to reload');
        reloadPill.addEventListener('click', function(event) {
            // Same reason as the tap-to-apply pill: the Version row itself
            // taps to open the changelog, so keep this click off it.
            event.stopPropagation();
            // A plain (splash-wrapped) reload, NOT applyPendingUpdate: the new
            // worker is already active, so there is no waiting worker left to
            // send skipWaiting to — this tab only needs to boot into the build
            // it is already being served.
            if (appReloader) appReloader();
        });
        versionRow.appendChild(reloadPill);
        return;
    }
    if (hasPendingUpdate()) {
        versionRow.classList.add('hasUpdate');
        if (existingPill) return;
        const updatePill = document.createElement('button');
        updatePill.type = 'button';
        updatePill.className = 'settingsAboutUpdatePill';
        updatePill.textContent = 'Update available';
        updatePill.setAttribute('aria-label', 'Update available — tap to reload');
        updatePill.addEventListener('click', function(event) {
            // The Version row itself taps to open the changelog; stop the
            // pill's click bubbling so an "Update available" tap applies
            // the update instead of also opening the changelog sheet.
            event.stopPropagation();
            applyPendingUpdate();
        });
        versionRow.appendChild(updatePill);
    } else {
        versionRow.classList.remove('hasUpdate');
        if (existingPill && existingPill.parentNode) {
            existingPill.parentNode.removeChild(existingPill);
        }
    }
}

// Module-scope subscription rather than a per-modal one: the takeover can
// happen while the Settings modal is closed, and the flag has to be latched
// whenever it lands so the next open paints the right state.
document.addEventListener('appUpdateAppliedElsewhere', function() {
    updateAppliedElsewhere = true;
    if (cueRow && cueRow.isConnected) paintAboutVersionUpdateCue(cueRow);
});
