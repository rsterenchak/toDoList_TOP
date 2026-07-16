import { applyPendingUpdate, hasPendingUpdate } from './modals.js';

// Paint the service-worker update cue on the About → Version row.
// When a new worker is waiting (hasPendingUpdate()), the muted value
// pill is replaced by a tappable accent-colored "Update available"
// pill that calls applyPendingUpdate (skipWaiting + reload — the
// same flow the desktop footer's #footVersion runs). When no update
// is pending the row reverts to its read-only state. Idempotent —
// safe to call from both the initial render and the
// appUpdateAvailable event handler while the modal is open.
export function paintAboutVersionUpdateCue(versionRow) {
    if (!versionRow) return;
    const existingPill = versionRow.querySelector('.settingsAboutUpdatePill');
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
