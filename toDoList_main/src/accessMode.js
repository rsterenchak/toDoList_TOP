// Access mode — whether this device runs signed in ('account') or offline with
// no account ('local').
//
// The sign-in gate offers a second door, "Use offline on this device", for a
// visitor who isn't on the allowlist: projects and tasks only, kept in
// localStorage, with no Supabase session, no Worker, and none of the pipeline or
// assistant surfaces. The choice persists under `todoapp_accessMode` so a reload
// boots straight back into it; a live session always wins over the flag.
//
// Local mode is one switch rather than per-feature patches: applyAccessMode
// stamps `data-access` on <html>, and style.css hides every Worker- or
// pipeline-backed surface under `html[data-access="local"]` (the selectors in
// LOCAL_HIDDEN_SELECTORS — the CSS block lists exactly these, and a test pins
// the two together). Mount sites additionally check hasAccount() so nothing in
// that list is built, and no request fires, on a boot that starts offline.

export const ACCESS_MODE_KEY = 'todoapp_accessMode';

// Every surface local mode hides. Each entry is a single id or class selector so
// the CSS block and its test can match them one-to-one.
export const LOCAL_HIDDEN_SELECTORS = [
    // UNDERSTANDING / STRUCTURE — desktop pills and mobile tab-bar items.
    '#viewPillUnderstanding',
    '#viewPillStructure',
    '#mobileTabUnderstanding',
    '#mobileTabStructure',
    // The Claude assistant: desktop chat pane, its collapse / expand controls,
    // and the slide-up sheet's launcher.
    '#desktopChatPane',
    '#chatCollapseButton',
    '#chatExpandButton',
    '#claudeLauncher',
    '#claudeSheet',
    '#claudeSheetBackdrop',
    // Header usage control.
    '#usageSpendToggle',
    // TODO.md viewer card (and its Running pill) plus its desktop rail strip.
    '#todoMdViewerCard',
    '#todoMdViewerStrip',
    // Run spinners and run-status glyphs.
    '#mobileProjRunSpinner',
    '.projRunSpinner',
    '#descIndicator',
    '.agentWorkingMarker',
    // The description panel's pipeline cluster (desktop row + mobile editor).
    '.descActionsRow',
    '.injectBtn',
    '.generateBtn',
    '.discussBtn',
    '.generateFailure',
    '.filePickTrigger',
    '.filePickPanel',
    '.descFileReadout',
    '.descDetailHeaderMarker',
    '.descScreenshotRow',
    '.descModeStrip',
    '.descGenerateBody',
    '.descPasteBody',
    '.phaseRail',
    '.askingBlock',
    '.descEditorModalStuck',
    '.descDispatchBlock',
    '.descReviewBlock',
    '.descRunReportBlock',
    '.descMockupBlock',
    '.descTriageBlock',
    '#descEditorModalTabs',
    '#descEditorModalAgentPane',
    '#descEditorModalGenerateSpend',
    // Mobile Settings sections that point the app at a repo or the Worker.
    '#settingsRepoSetupSection',
    '#settingsModelsSection',
    '#settingsDiagnosticsSection',
    // Quick-capture's split-into-tasks chip (plain add stays).
    '#createCaptureChip',
];

// Whether a Supabase session is live. index.js reports it as the session probe
// and auth listener resolve; it outranks the stored flag.
let liveSession = false;

function readFlag() {
    try { return localStorage.getItem(ACCESS_MODE_KEY); } catch (_) { return null; }
}

function writeFlag(mode) {
    try {
        if (mode) localStorage.setItem(ACCESS_MODE_KEY, mode);
        else localStorage.removeItem(ACCESS_MODE_KEY);
    } catch (_) { /* storage denied (private mode) */ }
}

export function setLiveSession(present) {
    liveSession = !!present;
}

// 'account' while a session is live (or the device last chose its account),
// 'local' when the device chose offline, null before any choice.
export function getAccessMode() {
    if (liveSession) return 'account';
    const flag = readFlag();
    if (flag === 'local' || flag === 'account') return flag;
    return null;
}

// True everywhere except offline mode — the gate itself (no choice yet) still
// builds the signed-in shell behind it, exactly as before this mode existed.
export function hasAccount() {
    return getAccessMode() !== 'local';
}

export function applyAccessMode(mode) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (mode) document.documentElement.dataset.access = mode;
    else delete document.documentElement.dataset.access;
}

export function chooseLocalMode() {
    writeFlag('local');
    applyAccessMode('local');
}

export function chooseAccountMode() {
    writeFlag('account');
    applyAccessMode('account');
}

// What the gate's offline door runs once the flag is written — index.js
// registers its boot here, since auth.js can't import the entry module.
let localModeBoot = null;
export function setLocalModeBoot(fn) {
    localModeBoot = fn;
}
export function bootLocalMode() {
    if (typeof localModeBoot === 'function') localModeBoot();
}

// A session arriving on a shell that booted offline can't remount every
// surface in place (bootApp is latched), so flip to 'account' and reload — the
// signed-in boot then migrates the offline data up. Swappable for tests.
let reloader = function() { window.location.reload(); };
export function setAccessModeReloader(fn) {
    reloader = fn;
}
export function switchToAccountAndReload() {
    chooseAccountMode();
    reloader();
}
