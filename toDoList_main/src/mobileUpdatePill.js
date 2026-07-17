// Lower-center mobile update-reload pill — a thumb-zone surface that
// surfaces a pending service-worker update directly above the bottom
// nav, so applying it no longer means spotting the gear-button dot and
// digging through Settings → About. Mobile-only (≤1023px, the same
// boundary where #footVersion is hidden); desktop keeps its footer cue.
// It routes Reload through applyPendingUpdate() (the shared skipWaiting +
// reload path) and auto-removes on appUpdateApplied so it can't outlive
// the reload triggered from any surface.
//
// The controller owns its own single-instance state and receives its
// three collaborators (isMobile, hasPendingUpdate, applyPendingUpdate) by
// injection so the caller keeps ownership of them. Wiring the returned
// show/remove handlers to appUpdateAvailable/appUpdateApplied stays with
// the caller.
export function createMobileUpdatePill({ isMobile, hasPendingUpdate, applyPendingUpdate }) {
    let mobileUpdatePill = null;
    let mobileUpdatePillDismissed = false;

    function removeMobileUpdatePill() {
        if (mobileUpdatePill && mobileUpdatePill.parentNode) {
            mobileUpdatePill.parentNode.removeChild(mobileUpdatePill);
        }
        mobileUpdatePill = null;
    }

    function buildMobileUpdatePill() {
        const pill = document.createElement('div');
        pill.id = 'mobileUpdatePill';
        pill.setAttribute('role', 'status');
        pill.setAttribute('aria-live', 'polite');

        const icon = document.createElement('span');
        icon.className = 'mobileUpdatePillIcon';
        icon.setAttribute('aria-hidden', 'true');
        // Inline refresh glyph (no icon library per CLAUDE.md) — two
        // counter-rotating arrows built from path primitives.
        icon.innerHTML =
            '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M3 12 a9 9 0 0 1 15.5 -6.2 L21 8"/>' +
            '<path d="M21 3 L21 8 L16 8"/>' +
            '<path d="M21 12 a9 9 0 0 1 -15.5 6.2 L3 16"/>' +
            '<path d="M3 21 L3 16 L8 16"/>' +
            '</svg>';

        const label = document.createElement('span');
        label.className = 'mobileUpdatePillLabel';
        label.textContent = 'Update available';

        const reloadBtn = document.createElement('button');
        reloadBtn.type = 'button';
        reloadBtn.className = 'mobileUpdatePillReload';
        reloadBtn.textContent = 'Reload';
        reloadBtn.setAttribute('aria-label', 'Reload to apply update');
        reloadBtn.addEventListener('click', function () {
            // The shared apply path fires appUpdateApplied + reloads; the
            // pill tears itself down on that event, so no manual remove here.
            applyPendingUpdate();
        });

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'mobileUpdatePillDismiss';
        dismissBtn.setAttribute('aria-label', 'Dismiss');
        dismissBtn.innerHTML = '&times;';
        dismissBtn.addEventListener('click', function () {
            // Session-only dismiss — leave pendingUpdateRegistration intact so
            // the gear-button dot and Settings → About pill stay live.
            mobileUpdatePillDismissed = true;
            removeMobileUpdatePill();
        });

        pill.appendChild(icon);
        pill.appendChild(label);
        pill.appendChild(reloadBtn);
        pill.appendChild(dismissBtn);
        return pill;
    }

    function showMobileUpdatePill() {
        if (!isMobile()) return;              // never mount on desktop
        if (mobileUpdatePillDismissed) return;
        if (!hasPendingUpdate()) return;
        if (mobileUpdatePill) return;         // single instance — never stack
        mobileUpdatePill = buildMobileUpdatePill();
        document.body.appendChild(mobileUpdatePill);
    }

    return { showMobileUpdatePill, removeMobileUpdatePill, buildMobileUpdatePill };
}
