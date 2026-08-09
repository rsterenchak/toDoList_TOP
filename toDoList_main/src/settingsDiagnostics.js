// ── SETTINGS → DIAGNOSTICS ──
//
// Four viewport fixes shipped without a single field observation. Everything
// they do is invisible from the phone that has the bug: the heal arms behind a
// standalone gate, measures against the screen, and flips a container for one
// frame — so a gate that never passes and a flip that never helps look exactly
// alike from the outside. This section is the readout that tells them apart,
// on the device, with no cable and no console.
//
// It is deliberately dumb: every value is read at build time from the live
// object it describes, nothing is cached at module scope, and nothing here can
// change what it measures. `buildSettingsDiagnosticsSection()` is called from
// inside `showSettingsModal()`, which rebuilds its body on every open, so
// re-opening settings after a viewport change is what refreshes the numbers.

import { changelog } from './changelog.js';
import { getViewportHealStatus } from './viewportHeal.js';

// Shown wherever a reading is genuinely unavailable (no visualViewport, no
// screen, a heal field never written). An em dash rather than "0" or "false",
// because "absent" and "zero" are different diagnoses.
const ABSENT = '—';

// The copy chip's two glyphs, same shapes as the task-row copy chips so the
// control reads as the same affordance wherever it appears.
const COPY_GLYPH_SVG = '<svg class="diagnosticsCopyIcon" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.25" y="3.25" width="7.5" height="9" rx="1.25"/><path d="M5.75 3.25V2.25a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v7"/></svg>';
const CHECK_GLYPH_SVG = '<svg class="diagnosticsCopyIcon" viewBox="0 0 14 14" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.75 7.25L5.75 10.25L11.5 4.25"/></svg>';

const COPY_FEEDBACK_MS = 1000;

// A tri-state flag: true / false / unknown. `null` and `undefined` both mean
// the reading was never taken, which for the gate fields is itself the answer
// (the module never ran its gate).
function flag(value) {
    if (value === true) return 'true';
    if (value === false) return 'false';
    return ABSENT;
}

// Numbers are rounded because visualViewport reports fractional CSS pixels and
// a readout meant to be eyeballed against a ~59px deficit does not need them.
function num(value) {
    if (typeof value !== 'number' || !isFinite(value)) return ABSENT;
    return String(Math.round(value));
}

// Elapsed rather than absolute: "when did the heal last look at the viewport"
// is the question, and a relative answer needs no timezone to read.
function since(timestamp) {
    if (typeof timestamp !== 'number' || !timestamp) return ABSENT;
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    return seconds + 's ago';
}

function readAppVersion() {
    const newest = changelog && changelog.length ? changelog[0] : null;
    if (!newest) return ABSENT;
    return 'v' + newest.version + ' · ' + newest.date;
}

// The display-mode query is read HERE as well as inside viewportHeal's gate,
// and on purpose: this one is live at modal-open time, the heal's is frozen at
// the moment it armed. A disagreement between the two rows is itself a finding.
function readDisplayModeStandalone() {
    try {
        if (!window.matchMedia) return ABSENT;
        return flag(!!window.matchMedia('(display-mode: standalone)').matches);
    } catch (e) {
        return ABSENT;
    }
}

function readServiceWorkerController() {
    try {
        if (!navigator || !navigator.serviceWorker) return ABSENT;
        return flag(!!navigator.serviceWorker.controller);
    } catch (e) {
        return ABSENT;
    }
}

// The single source both the rendered rows and the copied JSON come from, so
// the two can never describe different sets of fields. Each entry is
// { key, label, value } — `key` names the field in the JSON, `label` names it
// on screen, and `value` is the display string in both.
export function collectDiagnostics() {
    const heal = getViewportHealStatus();
    const screenRef = window.screen;
    const vv = window.visualViewport;
    const docEl = document.documentElement;

    return [
        { key: 'appVersion', label: 'App version', value: readAppVersion() },
        {
            key: 'displayModeStandalone',
            label: 'display-mode: standalone',
            value: readDisplayModeStandalone(),
        },
        {
            key: 'navigatorStandalone',
            label: 'navigator.standalone',
            value: navigator ? flag(navigator.standalone === true) : ABSENT,
        },
        {
            key: 'screen',
            label: 'screen',
            value: screenRef ? num(screenRef.width) + '×' + num(screenRef.height) : ABSENT,
        },
        { key: 'innerHeight', label: 'window.innerHeight', value: num(window.innerHeight) },
        {
            key: 'visualViewportHeight',
            label: 'visualViewport.height',
            value: vv ? num(vv.height) : ABSENT,
        },
        {
            key: 'visualViewportOffsetTop',
            label: 'visualViewport.offsetTop',
            value: vv ? num(vv.offsetTop) : ABSENT,
        },
        {
            key: 'clientHeight',
            label: 'documentElement.clientHeight',
            value: docEl ? num(docEl.clientHeight) : ABSENT,
        },
        {
            key: 'serviceWorkerController',
            label: 'SW controller',
            value: readServiceWorkerController(),
        },
        { key: 'healArmed', label: 'heal armed', value: flag(heal.armed) },
        {
            key: 'healGateDisplayMode',
            label: 'heal gate: display-mode',
            value: flag(heal.displayModeStandalone),
        },
        {
            key: 'healGateNavigator',
            label: 'heal gate: navigator',
            value: flag(heal.navigatorStandalone),
        },
        { key: 'healExpectedHeight', label: 'heal expected height', value: num(heal.expectedHeight) },
        { key: 'healLastDeficit', label: 'heal last deficit', value: num(heal.lastDeficit) },
        { key: 'healLastCheck', label: 'heal last check', value: since(heal.lastCheckAt) },
        { key: 'healsAttempted', label: 'heals attempted', value: num(heal.healsAttempted) },
        { key: 'healsEffective', label: 'heals effective', value: num(heal.healsEffective) },
    ];
}

// The clipboard payload — every displayed field, keyed and pretty-printed so it
// survives being pasted into a chat and read back by eye or by a parser.
export function buildDiagnosticsJson(rows) {
    const payload = {};
    rows.forEach(function(row) { payload[row.key] = row.value; });
    return JSON.stringify(payload, null, 2);
}

// Same clipboard discipline as the task-row copy chips: the async API when
// present (the only path that works from a button activation on mobile
// Safari), the legacy execCommand path as the fallback for environments
// without it (jsdom in particular). A failure leaves the chip on its idle
// glyph so a retry is obvious rather than masked by a stale checkmark.
function copyDiagnosticsToClipboard(text, button) {
    if (!text) return;

    function flash() {
        button.innerHTML = CHECK_GLYPH_SVG;
        button.setAttribute('data-copied', 'true');
        if (button.__diagnosticsCopyTimer) clearTimeout(button.__diagnosticsCopyTimer);
        button.__diagnosticsCopyTimer = setTimeout(function() {
            button.innerHTML = COPY_GLYPH_SVG;
            button.removeAttribute('data-copied');
            button.__diagnosticsCopyTimer = null;
        }, COPY_FEEDBACK_MS);
    }

    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(flash).catch(function() { /* values stay on screen */ });
        return;
    }

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.className = 'diagnosticsCopyProbe';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) flash();
    } catch (e) { /* swallow — the values stay on screen to read by hand */ }
}

// Build the section. Mirrors the scaffolding of every other Settings section —
// a <section id class="settingsSection"> opening with a .settingsSectionHeading
// — and differs only in that the heading carries the copy chip and the rows are
// the compact read-only pairs this many fields need, rather than 44px
// tap-target rows for values nothing taps.
export function buildSettingsDiagnosticsSection() {
    const section = document.createElement('section');
    section.id = 'settingsDiagnosticsSection';
    section.className = 'settingsSection';

    const heading = document.createElement('div');
    heading.className = 'settingsSectionHeading settingsSectionHeading--withAction';
    const headingText = document.createElement('span');
    headingText.textContent = 'Diagnostics';
    heading.appendChild(headingText);

    const rows = collectDiagnostics();

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.id = 'settingsDiagnosticsCopyBtn';
    copyBtn.className = 'diagnosticsCopyBtn';
    copyBtn.setAttribute('aria-label', 'Copy diagnostics as JSON');
    copyBtn.setAttribute('title', 'Copy diagnostics as JSON');
    copyBtn.innerHTML = COPY_GLYPH_SVG;
    copyBtn.addEventListener('click', function() {
        // Rebuilt on activation rather than reusing the rows rendered above:
        // the modal can sit open across a viewport change, and the copied
        // payload should be the state at the moment you tapped copy.
        copyDiagnosticsToClipboard(buildDiagnosticsJson(collectDiagnostics()), copyBtn);
    });
    heading.appendChild(copyBtn);
    section.appendChild(heading);

    rows.forEach(function(row) {
        const line = document.createElement('div');
        line.className = 'diagnosticsRow';
        line.setAttribute('data-field', row.key);

        const label = document.createElement('span');
        label.className = 'diagnosticsLabel';
        label.textContent = row.label;

        const value = document.createElement('span');
        value.className = 'diagnosticsValue';
        value.textContent = row.value;

        line.appendChild(label);
        line.appendChild(value);
        section.appendChild(line);
    });

    return section;
}
