// Tests for the Settings → Diagnostics section.
//
// Four viewport fixes shipped with no way to observe any of them on the device
// that has the bug, and the leading suspect was that the heal's standalone gate
// never passes inside the installed iOS container — which would silently no-op
// every fix behind it while looking exactly like a fix that ran and did not
// help. This section is what makes that distinguishable on the phone.
//
// What is pinned here: the section renders every field the readout promises,
// the values are recomputed on each open (not frozen at module load), the copy
// chip emits parseable JSON covering every displayed field, and the heal's
// gate readings surface even when the gate REJECTED — the case the section
// exists for.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const showRepoSetupModal = vi.fn();
const showInjectSettingsModal = vi.fn();

vi.mock('../src/repoSetup.js', () => ({
    showRepoSetupModal: (...args) => showRepoSetupModal(...args),
}));
vi.mock('../src/inject.js', () => ({
    showInjectSettingsModal: (...args) => showInjectSettingsModal(...args),
}));

const {
    buildSettingsDiagnosticsSection,
    collectDiagnostics,
    buildDiagnosticsJson,
} = await import('../src/settingsDiagnostics.js');
const { initViewportHeal } = await import('../src/viewportHeal.js');
const { createSettingsModal } = await import('../src/settingsModal.js');
const { changelog } = await import('../src/changelog.js');

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, '../src/style.css'), 'utf8');

// Every field the entry's acceptance criteria name, by the key the JSON uses.
const REQUIRED_FIELDS = [
    'appVersion',
    'displayModeStandalone',
    'navigatorStandalone',
    'screen',
    'innerHeight',
    'visualViewportHeight',
    'visualViewportOffsetTop',
    'clientHeight',
    'serviceWorkerController',
    'healArmed',
    'healGateDisplayMode',
    'healGateNavigator',
    'healExpectedHeight',
    'healLastDeficit',
    'healLastCheck',
    'healsAttempted',
    'healsEffective',
    'healFallback',
];

function setStandalone(matches) {
    window.matchMedia = function (query) {
        return {
            matches: query === '(display-mode: standalone)' ? matches : false,
            media: query,
            addEventListener() {},
            removeEventListener() {},
            addListener() {},
            removeListener() {},
        };
    };
}

function mount() {
    document.body.innerHTML = '';
    const section = buildSettingsDiagnosticsSection();
    document.body.appendChild(section);
    return section;
}

function valueOf(section, key) {
    const row = section.querySelector('.diagnosticsRow[data-field="' + key + '"]');
    expect(row, 'no row for ' + key).toBeTruthy();
    return row.querySelector('.diagnosticsValue').textContent;
}

beforeEach(() => {
    setStandalone(false);
    delete window.visualViewport;
});

afterEach(() => {
    document.body.innerHTML = '';
    delete window.navigator.standalone;
    delete window.visualViewport;
    vi.restoreAllMocks();
});

describe('Settings → Diagnostics — section scaffolding', () => {
    it('mirrors the other settings sections: id, class, and a heading', () => {
        const section = mount();
        expect(section.tagName).toBe('SECTION');
        expect(section.id).toBe('settingsDiagnosticsSection');
        expect(section.classList.contains('settingsSection')).toBe(true);

        const heading = section.querySelector('.settingsSectionHeading');
        expect(heading).toBeTruthy();
        expect(heading.textContent).toBe('Diagnostics');
    });

    it('renders a row for every field in the readout', () => {
        const section = mount();
        const keys = [...section.querySelectorAll('.diagnosticsRow')]
            .map((row) => row.getAttribute('data-field'));
        REQUIRED_FIELDS.forEach((key) => expect(keys).toContain(key));
        expect(keys.length).toBe(REQUIRED_FIELDS.length);
    });

    it('labels every row and gives every value the SpaceMono class', () => {
        const section = mount();
        [...section.querySelectorAll('.diagnosticsRow')].forEach((row) => {
            expect(row.querySelector('.diagnosticsLabel').textContent).not.toBe('');
            expect(row.querySelector('.diagnosticsValue')).toBeTruthy();
        });
        expect(css).toMatch(/\.diagnosticsValue\s*\{[^}]*font-family:\s*'SpaceMono'/);
    });
});

describe('Settings → Diagnostics — the values', () => {
    it('reads the app version from the newest changelog entry', () => {
        const section = mount();
        expect(valueOf(section, 'appVersion')).toContain('v' + changelog[0].version);
        expect(valueOf(section, 'appVersion')).toContain(changelog[0].date);
    });

    it('recomputes on every open rather than freezing at module load', () => {
        // The whole reason the builder is called from inside showSettingsModal:
        // you change the viewport, reopen settings, and read the new number.
        window.innerHeight = 793;
        expect(valueOf(mount(), 'innerHeight')).toBe('793');

        window.innerHeight = 852;
        expect(valueOf(mount(), 'innerHeight')).toBe('852');
    });

    it('reports the screen as width×height', () => {
        const section = mount();
        expect(valueOf(section, 'screen'))
            .toBe(window.screen.width + '×' + window.screen.height);
    });

    it('renders a placeholder rather than a guess when visualViewport is absent', () => {
        const section = mount();
        expect(valueOf(section, 'visualViewportHeight')).toBe('—');
        expect(valueOf(section, 'visualViewportOffsetTop')).toBe('—');
    });

    it('reads visualViewport height and offsetTop when present', () => {
        window.visualViewport = { height: 793.4, offsetTop: 12 };
        const section = mount();
        expect(valueOf(section, 'visualViewportHeight')).toBe('793');
        expect(valueOf(section, 'visualViewportOffsetTop')).toBe('12');
    });

    it('reads the live display-mode query, not a stored one', () => {
        setStandalone(true);
        expect(valueOf(mount(), 'displayModeStandalone')).toBe('true');
        setStandalone(false);
        expect(valueOf(mount(), 'displayModeStandalone')).toBe('false');
    });

    it('reports navigator.standalone as absent when the flag does not exist', () => {
        expect(valueOf(mount(), 'navigatorStandalone')).toBe('false');
        Object.defineProperty(window.navigator, 'standalone', {
            configurable: true,
            value: true,
        });
        expect(valueOf(mount(), 'navigatorStandalone')).toBe('true');
    });
});

describe('Settings → Diagnostics — the heal readout', () => {
    it('shows both gate readings and armed:false when the gate REJECTED', () => {
        // The case the section exists for: nothing armed, so nothing healed,
        // and without this readout that is indistinguishable from a heal that
        // ran and did not work.
        setStandalone(false);
        expect(initViewportHeal()).toBeNull();

        const section = mount();
        expect(valueOf(section, 'healArmed')).toBe('false');
        expect(valueOf(section, 'healGateDisplayMode')).toBe('false');
        expect(valueOf(section, 'healGateNavigator')).toBe('false');
    });

    it('shows armed:true and the reading that let it through once armed', () => {
        setStandalone(true);
        const stop = initViewportHeal();
        expect(typeof stop).toBe('function');
        try {
            const section = mount();
            expect(valueOf(section, 'healArmed')).toBe('true');
            expect(valueOf(section, 'healGateDisplayMode')).toBe('true');
        } finally {
            stop();
        }
    });
});

describe('Settings → Diagnostics — the heal fallback row', () => {
    // The reason this row exists: the flip is invisible either way, so the
    // next device screenshot has to be able to say whether the viewport is
    // still stuck without anyone guessing from the chrome's position.
    it('reads "off" while the viewport measures healthy', () => {
        setStandalone(false);
        expect(initViewportHeal()).toBeNull();
        expect(valueOf(mount(), 'healFallback')).toBe('off');
    });

    it('reports the stuck session and its measured deficit once the fallback engages', () => {
        const screenWidth = Object.getOwnPropertyDescriptor(window.screen, 'width');
        const screenHeight = Object.getOwnPropertyDescriptor(window.screen, 'height');
        const { innerWidth, innerHeight } = window;
        vi.useFakeTimers();
        Object.defineProperty(window.screen, 'width', { configurable: true, value: 393 });
        Object.defineProperty(window.screen, 'height', { configurable: true, value: 852 });
        window.innerWidth = 390;
        window.innerHeight = 793;                // the field reading: 59px short
        setStandalone(true);

        const stop = initViewportHeal();
        expect(typeof stop).toBe('function');
        try {
            document.body.innerHTML = '<div id="outerContainer"></div>';
            vi.advanceTimersByTime(400);          // past the launch settle check
            expect(valueOf(mount(), 'healFallback')).toBe('active · 59px');
        } finally {
            stop();
            vi.useRealTimers();
            if (screenWidth) Object.defineProperty(window.screen, 'width', screenWidth);
            if (screenHeight) Object.defineProperty(window.screen, 'height', screenHeight);
            window.innerWidth = innerWidth;
            window.innerHeight = innerHeight;
        }
    });
});

describe('Settings → Diagnostics — the copy chip', () => {
    function stubClipboard() {
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: { writeText },
        });
        return writeText;
    }

    afterEach(() => {
        delete window.navigator.clipboard;
    });

    it('mounts exactly one 36×36 chip in the heading', () => {
        const section = mount();
        const chips = section.querySelectorAll('.diagnosticsCopyBtn');
        expect(chips.length).toBe(1);
        expect(chips[0].closest('.settingsSectionHeading')).toBeTruthy();
        expect(chips[0].getAttribute('aria-label')).toBe('Copy diagnostics as JSON');

        const rule = css.match(/\.diagnosticsCopyBtn\s*\{([^}]*)\}/);
        expect(rule).not.toBeNull();
        expect(rule[1]).toMatch(/width:\s*36px/);
        expect(rule[1]).toMatch(/height:\s*36px/);
    });

    it('writes parseable JSON containing every displayed field', () => {
        const writeText = stubClipboard();
        const section = mount();
        section.querySelector('.diagnosticsCopyBtn').click();

        expect(writeText).toHaveBeenCalledTimes(1);
        const parsed = JSON.parse(writeText.mock.calls[0][0]);
        REQUIRED_FIELDS.forEach((key) => {
            expect(Object.prototype.hasOwnProperty.call(parsed, key), key + ' missing').toBe(true);
        });
        expect(Object.keys(parsed).length).toBe(REQUIRED_FIELDS.length);
    });

    it('copies the same values the rows display', () => {
        const writeText = stubClipboard();
        window.innerHeight = 793;
        const section = mount();
        section.querySelector('.diagnosticsCopyBtn').click();

        const parsed = JSON.parse(writeText.mock.calls[0][0]);
        REQUIRED_FIELDS.forEach((key) => {
            // healLastCheck is elapsed-time and may tick between the two
            // reads; every other field is a straight readback.
            if (key === 'healLastCheck') return;
            expect(parsed[key], key).toBe(valueOf(section, key));
        });
    });

    it('flips to the confirmed glyph after the write resolves', async () => {
        stubClipboard();
        const section = mount();
        const chip = section.querySelector('.diagnosticsCopyBtn');
        chip.click();
        await Promise.resolve();
        expect(chip.getAttribute('data-copied')).toBe('true');
    });

    it('leaves the chip idle when the clipboard write rejects', async () => {
        Object.defineProperty(window.navigator, 'clipboard', {
            configurable: true,
            value: { writeText: () => Promise.reject(new Error('denied')) },
        });
        const section = mount();
        const chip = section.querySelector('.diagnosticsCopyBtn');
        expect(() => chip.click()).not.toThrow();
        await Promise.resolve();
        await Promise.resolve();
        expect(chip.hasAttribute('data-copied')).toBe(false);
    });

    it('builds its JSON from the row list, so the two can never diverge', () => {
        const rows = collectDiagnostics();
        const parsed = JSON.parse(buildDiagnosticsJson(rows));
        rows.forEach((row) => expect(parsed[row.key]).toBe(row.value));
    });
});

describe('Settings → Diagnostics — mounted in the settings modal', () => {
    function mountSettingsModal() {
        document.body.innerHTML = '<button id="drawerSettingsBtn"></button>';
        const { showSettingsModal } = createSettingsModal({
            buildExpandAllToggle: () => ({ row: document.createElement('div') }),
            buildCompanionToggle: () => ({ row: document.createElement('div') }),
            wireDismissable: () => ({ close: () => {} }),
            drawerSettingsBtn: document.getElementById('drawerSettingsBtn'),
            applyActiveView: () => {},
            rebuildAfterImport: () => {},
            seedSampleTodosIntoActiveProjectIfEmpty: () => {},
        });
        showSettingsModal();
    }

    it('sits after Repo setup and before Account', () => {
        mountSettingsModal();
        const headings = [...document.querySelectorAll('#settingsModalBody .settingsSectionHeading')]
            .map((el) => el.textContent);
        expect(headings).toContain('Diagnostics');
        expect(headings.indexOf('Diagnostics')).toBeGreaterThan(headings.indexOf('Repo setup'));
        expect(headings.indexOf('Diagnostics')).toBeLessThan(headings.indexOf('Account'));
    });

    it('leaves the modal\'s other sections exactly as they were', () => {
        mountSettingsModal();
        const headings = [...document.querySelectorAll('#settingsModalBody .settingsSectionHeading')]
            .map((el) => el.textContent);
        expect(headings).toEqual([
            'View', 'Appearance', 'About', 'Help', 'Data', 'Repo setup', 'Diagnostics', 'Account',
        ]);
    });

    it('re-reads its values on every open', () => {
        window.innerHeight = 793;
        mountSettingsModal();
        expect(valueOf(document.getElementById('settingsDiagnosticsSection'), 'innerHeight'))
            .toBe('793');

        window.innerHeight = 852;
        mountSettingsModal();
        expect(valueOf(document.getElementById('settingsDiagnosticsSection'), 'innerHeight'))
            .toBe('852');
    });
});
