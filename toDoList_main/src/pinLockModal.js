// ── APP LOCK (PIN) SETUP MODAL ──
//
// The configuration surface behind the "App lock (PIN)" rows in the desktop
// settings menu (settingsMenu.js) and the mobile settings modal
// (settingsModal.js). One dialog carries both halves of the setting: the
// 4-digit PIN itself and the idle span after which the lock overlay takes
// over.
//
// This is an ordinary dismissible modal and follows the CLAUDE.md three-way
// close (× button, backdrop click, Escape) via the shared wireModalDismiss
// helper. The lock OVERLAY it configures deliberately does not — see the note
// on lockApp() in appLock.js.
//
// Imports flow one way: this module reads and writes app-lock state through
// appLock.js and appLock.js never imports back. wireModalDismiss comes from
// the leaf modalDismiss.js rather than modals.js so the modal doesn't drag
// that view's import graph along.
import { wireModalDismiss } from './modalDismiss.js';
import {
    APP_LOCK_TIMEOUT_OPTIONS,
    PIN_LENGTH,
    createPinDigitInputs,
    clearAppLock,
    hasAppLockPin,
    isAppLockEnabled,
    markAppLockActivity,
    readAppLockTimeoutMinutes,
    rearmAppLockTimer,
    setAppLockEnabled,
    setAppLockPin,
    writeAppLockTimeoutMinutes,
} from './appLock.js';

// options: { onChange } — invoked after a save or a turn-off so the calling
// settings row can repaint its ON/OFF state without being rebuilt.
export function showPinLockModal(options) {
    const opts = options || {};
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    const prior = document.getElementById('pinLockBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const alreadyConfigured = hasAppLockPin();

    const backdrop = document.createElement('div');
    backdrop.id = 'pinLockBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'pinLockModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'pinLockTitle');

    const header = document.createElement('div');
    header.id = 'pinLockHeader';
    const title = document.createElement('div');
    title.id = 'pinLockTitle';
    title.textContent = 'App lock (PIN)';
    const closeX = document.createElement('button');
    closeX.id = 'pinLockClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close app lock settings');
    closeX.textContent = '×';
    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'pinLockBody';

    const blurb = document.createElement('p');
    blurb.className = 'pinLockBlurb';
    blurb.textContent = alreadyConfigured
        ? 'A PIN is set. Enter a new one to replace it, or leave the boxes blank to keep it.'
        : 'Pick a ' + PIN_LENGTH + '-digit PIN. The app locks itself once it has been idle '
          + 'for the span below, and asks for the PIN to carry on.';

    const pinLabel = document.createElement('div');
    pinLabel.className = 'pinLockFieldLabel';
    pinLabel.textContent = alreadyConfigured ? 'New PIN' : 'PIN';

    const error = document.createElement('div');
    error.id = 'pinLockError';
    error.className = 'pinLockError';
    error.setAttribute('role', 'alert');

    const digits = createPinDigitInputs({
        idPrefix: 'pinLockDigit',
        groupLabel: alreadyConfigured ? 'New PIN' : 'PIN',
        onInput: function() { error.textContent = ''; },
    });

    const timeoutLabel = document.createElement('label');
    timeoutLabel.className = 'pinLockFieldLabel pinLockFieldLabel--select';
    timeoutLabel.textContent = 'Auto-lock after idle';
    const timeoutSelect = document.createElement('select');
    timeoutSelect.id = 'pinLockTimeoutSelect';
    timeoutSelect.className = 'pinLockSelect';
    const currentTimeout = readAppLockTimeoutMinutes();
    APP_LOCK_TIMEOUT_OPTIONS.forEach(function(opt) {
        const option = document.createElement('option');
        option.value = String(opt.minutes);
        option.textContent = opt.label;
        if (opt.minutes === currentTimeout) option.selected = true;
        timeoutSelect.appendChild(option);
    });
    timeoutLabel.appendChild(timeoutSelect);

    body.appendChild(blurb);
    body.appendChild(pinLabel);
    body.appendChild(digits.row);
    body.appendChild(timeoutLabel);
    body.appendChild(error);

    const actions = document.createElement('div');
    actions.id = 'pinLockActions';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'pinLockSave';
    saveBtn.type = 'button';
    saveBtn.className = 'pinLockBtn pinLockBtn--primary';
    saveBtn.textContent = 'Save';

    const cancelBtn = document.createElement('button');
    cancelBtn.id = 'pinLockCancel';
    cancelBtn.type = 'button';
    cancelBtn.className = 'pinLockBtn';
    cancelBtn.textContent = 'Cancel';

    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);

    // Turn off is only meaningful once the lock is actually on. It forgets the
    // PIN as well as the flag (see clearAppLock), so it reads as destructive
    // and is pushed to the right, matching the Inject settings modal's Clear.
    let turnOffBtn = null;
    if (alreadyConfigured && isAppLockEnabled()) {
        const spacer = document.createElement('div');
        spacer.className = 'pinLockActionsSpacer';
        actions.appendChild(spacer);
        turnOffBtn = document.createElement('button');
        turnOffBtn.id = 'pinLockTurnOff';
        turnOffBtn.type = 'button';
        turnOffBtn.className = 'pinLockBtn pinLockBtn--danger';
        turnOffBtn.textContent = 'Turn off';
        actions.appendChild(turnOffBtn);
    }

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const previouslyFocused = document.activeElement;

    const close = wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX, cancelBtn],
        onClose: function() {
            if (previouslyFocused
                && typeof previouslyFocused.focus === 'function'
                && document.contains(previouslyFocused)) {
                try { previouslyFocused.focus(); } catch (_) { /* focus is best-effort */ }
            }
        },
    });

    saveBtn.addEventListener('click', function() {
        const pin = digits.value();
        // Blank is "keep the existing PIN" only when there is one to keep;
        // a partial entry is always an error so a half-typed PIN can't be
        // mistaken for a deliberate no-change.
        if (!pin && alreadyConfigured) {
            writeAppLockTimeoutMinutes(parseInt(timeoutSelect.value, 10));
            setAppLockEnabled(true);
            markAppLockActivity();
            rearmAppLockTimer();
            close();
            if (onChange) onChange();
            return;
        }
        if (pin.length !== PIN_LENGTH) {
            error.textContent = 'Enter all ' + PIN_LENGTH + ' digits.';
            digits.focusFirst();
            return;
        }
        if (!setAppLockPin(pin)) {
            error.textContent = 'Could not save the PIN on this device.';
            return;
        }
        writeAppLockTimeoutMinutes(parseInt(timeoutSelect.value, 10));
        setAppLockEnabled(true);
        markAppLockActivity();
        rearmAppLockTimer();
        close();
        if (onChange) onChange();
    });

    if (turnOffBtn) {
        turnOffBtn.addEventListener('click', function() {
            clearAppLock();
            rearmAppLockTimer();
            close();
            if (onChange) onChange();
        });
    }

    digits.focusFirst();

    return { close: close };
}
