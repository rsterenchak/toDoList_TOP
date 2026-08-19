// The PIN setup modal and the two settings rows that open it.
//
// The modal is an ordinary dismissible dialog and MUST keep all three
// CLAUDE.md close affordances (× / backdrop / Escape) — the exemption belongs
// to the lock overlay it configures, not to the setup surface. The save path
// is pinned because it writes four separate pieces of state (PIN, timeout,
// enabled flag, activity stamp) and dropping any one of them yields a setting
// that looks saved and does nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { showPinLockModal } from '../src/pinLockModal.js';
import {
    APP_LOCK_ACTIVITY_KEY,
    clearAppLock,
    hasAppLockPin,
    isAppLockArmed,
    isAppLockEnabled,
    readAppLockTimeoutMinutes,
    resetAppLockWatchForTests,
    setAppLockEnabled,
    setAppLockPin,
    verifyAppLockPin,
    writeAppLockTimeoutMinutes,
} from '../src/appLock.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(resolve(here, '../src', rel), 'utf8');

function typePin(pin) {
    const inputs = [...document.querySelectorAll('#pinLockModal .pinDigitInput')];
    for (let i = 0; i < pin.length; i++) {
        inputs[i].value = pin[i];
        inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
    }
}

beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    resetAppLockWatchForTests();
});

afterEach(() => {
    resetAppLockWatchForTests();
    document.body.innerHTML = '';
});

describe('pinLockModal — structure and close affordances', () => {
    it('renders the PIN boxes, the idle-timeout select, and Save / Cancel', () => {
        showPinLockModal();
        expect(document.getElementById('pinLockModal')).toBeTruthy();
        expect(document.querySelectorAll('#pinLockModal .pinDigitInput')).toHaveLength(4);
        const select = document.getElementById('pinLockTimeoutSelect');
        expect([...select.options].map((o) => o.textContent))
            .toEqual(['1 minute', '5 minutes', '15 minutes', '30 minutes', 'Never']);
        expect(document.getElementById('pinLockSave')).toBeTruthy();
        expect(document.getElementById('pinLockCancel')).toBeTruthy();
    });

    it('preselects the stored idle timeout', () => {
        writeAppLockTimeoutMinutes(30);
        showPinLockModal();
        expect(document.getElementById('pinLockTimeoutSelect').value).toBe('30');
    });

    it('closes on the × button', () => {
        showPinLockModal();
        document.getElementById('pinLockClose').click();
        expect(document.getElementById('pinLockBackdrop')).toBeNull();
    });

    it('closes on a backdrop click', () => {
        showPinLockModal();
        const backdrop = document.getElementById('pinLockBackdrop');
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('pinLockBackdrop')).toBeNull();
    });

    it('closes on Escape', () => {
        showPinLockModal();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.getElementById('pinLockBackdrop')).toBeNull();
    });

    it('closes on Cancel without writing anything', () => {
        showPinLockModal();
        typePin('1234');
        document.getElementById('pinLockCancel').click();
        expect(document.getElementById('pinLockBackdrop')).toBeNull();
        expect(hasAppLockPin()).toBe(false);
        expect(isAppLockEnabled()).toBe(false);
    });
});

describe('pinLockModal — saving', () => {
    it('stores the PIN, the timeout, and the enabled flag together', () => {
        const onChange = vi.fn();
        showPinLockModal({ onChange });
        typePin('7391');
        document.getElementById('pinLockTimeoutSelect').value = '15';
        document.getElementById('pinLockSave').click();

        expect(verifyAppLockPin('7391')).toBe(true);
        expect(readAppLockTimeoutMinutes()).toBe(15);
        expect(isAppLockEnabled()).toBe(true);
        expect(isAppLockArmed()).toBe(true);
        // The activity stamp is reset so the freshly-armed lock measures its
        // idle span from the save, not from whenever the app last saw input.
        expect(localStorage.getItem(APP_LOCK_ACTIVITY_KEY)).toBeTruthy();
        expect(document.getElementById('pinLockBackdrop')).toBeNull();
        expect(onChange).toHaveBeenCalledTimes(1);
    });

    it('rejects a partial PIN and stays open', () => {
        showPinLockModal();
        typePin('73');
        document.getElementById('pinLockSave').click();
        expect(document.getElementById('pinLockBackdrop')).toBeTruthy();
        expect(document.getElementById('pinLockError').textContent).toMatch(/all 4 digits/i);
        expect(hasAppLockPin()).toBe(false);
    });

    it('keeps the existing PIN when the boxes are left blank', () => {
        setAppLockPin('1122');
        setAppLockEnabled(true);
        showPinLockModal();
        document.getElementById('pinLockTimeoutSelect').value = '1';
        document.getElementById('pinLockSave').click();
        expect(verifyAppLockPin('1122')).toBe(true);
        expect(readAppLockTimeoutMinutes()).toBe(1);
    });

    it('replaces the existing PIN when new digits are entered', () => {
        setAppLockPin('1122');
        setAppLockEnabled(true);
        showPinLockModal();
        typePin('3344');
        document.getElementById('pinLockSave').click();
        expect(verifyAppLockPin('3344')).toBe(true);
        expect(verifyAppLockPin('1122')).toBe(false);
    });

    it('still rejects a partial PIN when one is already stored', () => {
        setAppLockPin('1122');
        setAppLockEnabled(true);
        showPinLockModal();
        typePin('33');
        document.getElementById('pinLockSave').click();
        expect(document.getElementById('pinLockBackdrop')).toBeTruthy();
        expect(verifyAppLockPin('1122')).toBe(true);
    });
});

describe('pinLockModal — turning the lock off', () => {
    it('offers Turn off only once the lock is on', () => {
        showPinLockModal();
        expect(document.getElementById('pinLockTurnOff')).toBeNull();
        document.getElementById('pinLockClose').click();

        setAppLockPin('1122');
        setAppLockEnabled(true);
        showPinLockModal();
        expect(document.getElementById('pinLockTurnOff')).toBeTruthy();
    });

    it('Turn off forgets the PIN as well as the flag', () => {
        setAppLockPin('1122');
        setAppLockEnabled(true);
        const onChange = vi.fn();
        showPinLockModal({ onChange });
        document.getElementById('pinLockTurnOff').click();
        expect(isAppLockEnabled()).toBe(false);
        expect(hasAppLockPin()).toBe(false);
        expect(document.getElementById('pinLockBackdrop')).toBeNull();
        expect(onChange).toHaveBeenCalledTimes(1);
    });
});

describe('app lock settings rows', () => {
    const settingsMenu = read('settingsMenu.js');
    const drawerRows = read('drawerRows.js');
    const settingsModal = read('settingsModal.js');
    const main = read('main.js');
    const css = read('style.css');

    it('desktop settings menu builds the row via the shared item helper', () => {
        expect(settingsMenu).toMatch(/buildSettingsMenuItem\(\s*'App lock \(PIN\)'/);
        const idx = settingsMenu.indexOf("'App lock (PIN)'");
        const slice = settingsMenu.slice(idx, idx + 300);
        // ON only when fully armed, and tapping opens the setup modal.
        expect(slice).toMatch(/isAppLockArmed\(\)\s*\?\s*'ON'\s*:\s*'OFF'/);
        expect(slice).toMatch(/showPinLockModal\(\)/);
        // Sits alongside the ghost toggle, above the first divider.
        const ghostIdx = settingsMenu.indexOf("'Toggle floating ghost'");
        const dividerIdx = settingsMenu.indexOf('menu.appendChild(buildSettingsMenuDivider()');
        expect(idx).toBeGreaterThan(ghostIdx);
        expect(idx).toBeLessThan(dividerIdx);
    });

    it('mobile settings modal appends the toggle row into the Appearance section', () => {
        expect(drawerRows).toMatch(/export function buildAppLockToggle\s*\(/);
        expect(drawerRows).toMatch(/createDrawerToggleRow\(\s*['"]App lock \(PIN\)['"]/);
        expect(settingsModal).toMatch(/appearanceSection\.appendChild\(buildAppLockToggle\(\)\.row\)/);
    });

    it('mobile row reports state and repaints once the dialog saves', () => {
        const idx = drawerRows.indexOf('buildAppLockToggle');
        const slice = drawerRows.slice(idx);
        expect(slice).toMatch(/isAppLockArmed\(\)/);
        expect(slice).toMatch(/showPinLockModal\(\{\s*onChange:\s*function\(\)\s*\{\s*toggle\.refresh\(\)/);
        expect(slice).toMatch(/aria-haspopup['"]\s*,\s*['"]dialog/);
    });

    it('main.js starts the idle watch at boot', () => {
        expect(main).toMatch(/import\s*\{\s*startAppLockWatch\s*\}\s*from\s*'\.\/appLock\.js'/);
        expect(main).toMatch(/setTimeout\(startAppLockWatch,\s*0\)/);
    });

    it('the lock overlay outranks every other layer in the stylesheet', () => {
        const overlay = css.slice(css.indexOf('#appLockOverlay {'));
        const zIndex = parseInt(overlay.match(/z-index:\s*(\d+)/)[1], 10);
        const highestElsewhere = [...css.matchAll(/z-index:\s*(\d+)/g)]
            .map((m) => parseInt(m[1], 10))
            .filter((z) => z !== zIndex);
        expect(zIndex).toBeGreaterThan(Math.max(...highestElsewhere));
    });

    it('the PIN boxes clear the iOS auto-zoom font floor', () => {
        const rule = css.slice(css.indexOf('.pinDigitInput {'));
        const size = parseInt(rule.match(/font-size:\s*(\d+)px/)[1], 10);
        expect(size).toBeGreaterThanOrEqual(16);
    });
});
