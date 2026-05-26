// Inject to TODO.md — sends a todo's description to a user-configured
// Cloudflare Worker that appends it as a new entry to TODO.md in this repo.
//
// Worker URL and shared secret are per-device, stored in localStorage and
// configured via the Inject settings modal (opened from the ghost menu's
// "Configure inject" row). Once configured, each todo's expanded
// description panel renders an "Inject to TODO.md" button that POSTs the
// description verbatim, stamps `injectedAt` on the todo, and persists.

import { showConfirmModal } from './modals.js';
import { listLogic } from './listLogic.js';

const URL_KEY         = 'todoapp_injectWorkerUrl';
const SECRET_KEY      = 'todoapp_injectSharedSecret';
const LAST_TESTED_KEY = 'todoapp_injectLastTestedAt';
const LAST_RESULT_KEY = 'todoapp_injectLastTestResult';

// Module-level cache populated on app boot via initInjectConfig.
let cachedUrl = '';
let cachedSecret = '';

export function initInjectConfig() {
    try {
        cachedUrl    = localStorage.getItem(URL_KEY)    || '';
        cachedSecret = localStorage.getItem(SECRET_KEY) || '';
    } catch (e) { /* private mode */ }
}

export function isInjectConfigured() {
    return !!(cachedUrl && cachedSecret);
}

function saveInjectConfig(url, secret) {
    cachedUrl    = url    || '';
    cachedSecret = secret || '';
    try {
        if (cachedUrl)    localStorage.setItem(URL_KEY, cachedUrl);
        else              localStorage.removeItem(URL_KEY);
        if (cachedSecret) localStorage.setItem(SECRET_KEY, cachedSecret);
        else              localStorage.removeItem(SECRET_KEY);
    } catch (e) { /* private mode */ }
}

function readLastTest() {
    try {
        const ts = parseInt(localStorage.getItem(LAST_TESTED_KEY) || '0', 10);
        const result = localStorage.getItem(LAST_RESULT_KEY) || '';
        return { ts: isNaN(ts) ? 0 : ts, result: result };
    } catch (e) { return { ts: 0, result: '' }; }
}

function writeLastTest(result) {
    try {
        localStorage.setItem(LAST_TESTED_KEY, String(Date.now()));
        localStorage.setItem(LAST_RESULT_KEY, result || '');
    } catch (e) { /* private mode */ }
}


// ── TOAST ──
// Self-contained mirror of the jsonImportExport.js pattern. A single toast
// node is reused — any prior one is yanked before the new one appears.
function showInjectToast(message, variant) {
    const prior = document.getElementById('injectToast');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const toast = document.createElement('div');
    toast.id = 'injectToast';
    if (variant === 'error') toast.classList.add('injectToast--error');
    else                     toast.classList.add('injectToast--ok');
    toast.setAttribute('role', 'status');
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function() {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
}


// ── WORKER CALLS ──
async function postToWorker(payload) {
    if (!isInjectConfigured()) {
        const e = new Error('Not configured');
        e.notConfigured = true;
        throw e;
    }
    let res;
    try {
        res = await fetch(cachedUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + cachedSecret,
            },
            body: JSON.stringify(payload),
        });
    } catch (networkErr) {
        const e = new Error('Network error');
        e.network = true;
        throw e;
    }
    if (!res.ok) {
        const e = new Error('HTTP ' + res.status);
        e.status = res.status;
        throw e;
    }
    try { return await res.json(); } catch (e) { return null; }
}

function describeError(e) {
    if (!e) return 'Unknown error';
    if (e.notConfigured) return 'Not configured';
    if (e.status === 401) return '401 Unauthorized';
    if (e.status === 403) return '403 Forbidden';
    if (e.status && e.status >= 500) return 'Server error ' + e.status;
    if (e.status) return 'HTTP ' + e.status;
    if (e.network) return 'Network error';
    return e.message || 'Unknown error';
}

async function injectDescription(item) {
    if (!item || !item.desc) return { ok: false, reason: 'No description' };
    try {
        await postToWorker({ entry: item.desc });
        item.injectedAt = Date.now();
        listLogic.saveToStorage();
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: describeError(e) };
    }
}

async function testConnection() {
    try {
        await postToWorker({ test: true });
        writeLastTest('ok');
        return { ok: true, label: 'Connected' };
    } catch (e) {
        const label = describeError(e);
        writeLastTest(label);
        return { ok: false, label: label };
    }
}


// ── INJECT BUTTON FACTORY ──
// Builds a single inject button used in both the desktop descSibling panel
// and the mobile edit modal. Returns the button element. State is computed
// from `item` via refreshInjectButton — callers should re-refresh when the
// description changes (becomes empty / non-empty) or after a successful
// inject.
//
// `options.onInjected(item)` fires after a successful POST so callers can
// re-sync any other UI they own (e.g., the mobile edit modal can swap its
// own copy of the button alongside the row's). The handler stashes the
// item on the button so refreshAllInjectButtons can re-render every visible
// button after a config change without each caller re-registering.
export function makeInjectButton(item, options) {
    const opts = options || {};
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'injectBtn';
    btn._injectItem = item;

    // Inline SVG icons — upload arrow for ready/unconfigured, checkmark for
    // injected. Matching the inline-SVG approach used elsewhere in the app
    // (toDoRow.js, modals.js) instead of importing icon assets.
    btn.innerHTML = injectBtnInnerHTML('ready');

    refreshInjectButton(btn, item);

    btn.addEventListener('click', async function(event) {
        event.stopPropagation();
        if (btn.disabled) return;
        const state = btn.dataset.state || '';

        if (state === 'unconfigured') {
            showInjectSettingsModal();
            return;
        }
        if (state === 'injected') return;
        if (state === 'ready') {
            // Disable immediately to block double-clicks during the in-
            // flight request (acceptance criteria: double-click must not
            // produce two commits).
            btn.disabled = true;
            const result = await injectDescription(item);
            if (result.ok) {
                showInjectToast('Injected to TODO.md');
                refreshInjectButton(btn, item);
                if (typeof opts.onInjected === 'function') opts.onInjected(item);
            } else {
                showInjectToast('Inject failed — ' + result.reason, 'error');
                btn.disabled = false;
            }
        }
    });

    return btn;
}

function injectBtnInnerHTML(state) {
    if (state === 'injected') {
        return '<svg class="injectBtnIcon" viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 7.5 6 10.5 11 4.5"/></svg>'
             + '<span class="injectBtnLabel">Injected</span>';
    }
    return '<svg class="injectBtnIcon" viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="7" y1="11.5" x2="7" y2="3"/><polyline points="3.5 6.5 7 3 10.5 6.5"/><line x1="3" y1="13" x2="11" y2="13"/></svg>'
         + '<span class="injectBtnLabel"></span>';
}

export function refreshInjectButton(btn, item) {
    if (!btn || !item) return;
    btn._injectItem = item;

    const hasDesc = !!(item.desc && item.desc.trim().length > 0);
    if (!hasDesc) {
        btn.style.display = 'none';
        btn.disabled = true;
        btn.dataset.state = 'hidden';
        return;
    }
    btn.style.display = '';

    if (item.injectedAt) {
        btn.dataset.state = 'injected';
        btn.disabled = true;
        btn.classList.remove('injectBtn--unconfigured');
        btn.classList.add('injectBtn--injected');
        btn.innerHTML = injectBtnInnerHTML('injected');
        btn.setAttribute('aria-label', 'Already injected to TODO.md');
        btn.title = 'This description was already sent to TODO.md';
        return;
    }

    if (!isInjectConfigured()) {
        btn.dataset.state = 'unconfigured';
        btn.disabled = false;
        btn.classList.add('injectBtn--unconfigured');
        btn.classList.remove('injectBtn--injected');
        btn.innerHTML = injectBtnInnerHTML('unconfigured');
        const label = btn.querySelector('.injectBtnLabel');
        if (label) label.textContent = 'Configure inject in settings';
        btn.setAttribute('aria-label', 'Open inject settings');
        btn.title = 'Inject is not configured — open settings';
        return;
    }

    btn.dataset.state = 'ready';
    btn.disabled = false;
    btn.classList.remove('injectBtn--unconfigured');
    btn.classList.remove('injectBtn--injected');
    btn.innerHTML = injectBtnInnerHTML('ready');
    const label = btn.querySelector('.injectBtnLabel');
    if (label) label.textContent = 'Inject to TODO.md';
    btn.setAttribute('aria-label', 'Inject description to TODO.md');
    btn.title = 'Send this description to TODO.md';
}

function refreshAllInjectButtons() {
    const buttons = document.querySelectorAll('.injectBtn');
    buttons.forEach(function(btn) {
        const item = btn._injectItem;
        if (item) refreshInjectButton(btn, item);
    });
}


// ── SETTINGS MODAL ──
// Opens the per-device Inject settings dialog. Reads / writes the four
// localStorage keys above; Save and Clear both refresh every visible
// inject button so the row UI reflects new config immediately.
export function showInjectSettingsModal() {
    const prior = document.getElementById('injectSettingsBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'injectSettingsBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'injectSettingsModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'injectSettingsTitle');

    // Header
    const header = document.createElement('div');
    header.id = 'injectSettingsHeader';
    const title = document.createElement('div');
    title.id = 'injectSettingsTitle';
    title.textContent = 'Inject settings';
    const closeX = document.createElement('button');
    closeX.id = 'injectSettingsClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close inject settings');
    closeX.textContent = '×';
    header.appendChild(title);
    header.appendChild(closeX);

    // Status pill row
    const statusRow = document.createElement('div');
    statusRow.id = 'injectSettingsStatusRow';

    function renderStatus() {
        statusRow.innerHTML = '';
        const pill = document.createElement('span');
        pill.className = 'injectStatusPill';
        if (!isInjectConfigured()) {
            pill.textContent = 'Not configured';
            pill.classList.add('injectStatusPill--unconfigured');
        } else {
            const lt = readLastTest();
            if (!lt.ts) {
                pill.textContent = 'Configured · never tested';
                pill.classList.add('injectStatusPill--idle');
            } else if (lt.result === 'ok') {
                pill.textContent = 'Connected · last tested ' + relativeTime(lt.ts);
                pill.classList.add('injectStatusPill--ok');
            } else {
                pill.textContent = lt.result + ' · ' + relativeTime(lt.ts);
                pill.classList.add('injectStatusPill--err');
            }
        }
        statusRow.appendChild(pill);
    }

    // Body — inputs
    const body = document.createElement('div');
    body.id = 'injectSettingsBody';

    const urlLabel = document.createElement('label');
    urlLabel.className = 'injectFieldLabel';
    urlLabel.textContent = 'Worker URL';
    const urlInput = document.createElement('input');
    urlInput.id = 'injectWorkerUrlInput';
    urlInput.type = 'url';
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;
    urlInput.placeholder = 'https://your-worker.example.workers.dev';
    urlInput.value = cachedUrl;
    urlLabel.appendChild(urlInput);

    const secretLabel = document.createElement('label');
    secretLabel.className = 'injectFieldLabel';
    secretLabel.textContent = 'Shared secret';
    const secretWrap = document.createElement('div');
    secretWrap.className = 'injectSecretWrap';
    const secretInput = document.createElement('input');
    secretInput.id = 'injectSharedSecretInput';
    secretInput.type = 'password';
    secretInput.autocomplete = 'off';
    secretInput.spellcheck = false;
    secretInput.placeholder = '••••••••';
    secretInput.value = cachedSecret;
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.className = 'injectEyeBtn';
    eyeBtn.setAttribute('aria-label', 'Show secret');
    eyeBtn.title = 'Show / hide secret';
    eyeBtn.textContent = '👁';
    eyeBtn.addEventListener('click', function() {
        if (secretInput.type === 'password') {
            secretInput.type = 'text';
            eyeBtn.setAttribute('aria-label', 'Hide secret');
        } else {
            secretInput.type = 'password';
            eyeBtn.setAttribute('aria-label', 'Show secret');
        }
    });
    secretWrap.appendChild(secretInput);
    secretWrap.appendChild(eyeBtn);
    secretLabel.appendChild(secretWrap);

    body.appendChild(urlLabel);
    body.appendChild(secretLabel);

    // Action row — Save, Test connection, Clear (Clear pushed right and
    // visually separated as a destructive action).
    const actions = document.createElement('div');
    actions.id = 'injectSettingsActions';

    const saveBtn = document.createElement('button');
    saveBtn.id = 'injectSettingsSave';
    saveBtn.type = 'button';
    saveBtn.className = 'injectSettingsBtn injectSettingsBtn--primary';
    saveBtn.textContent = 'Save';

    const testBtn = document.createElement('button');
    testBtn.id = 'injectSettingsTest';
    testBtn.type = 'button';
    testBtn.className = 'injectSettingsBtn';
    testBtn.textContent = 'Test connection';

    const spacer = document.createElement('div');
    spacer.className = 'injectSettingsActionsSpacer';

    const clearBtn = document.createElement('button');
    clearBtn.id = 'injectSettingsClear';
    clearBtn.type = 'button';
    clearBtn.className = 'injectSettingsBtn injectSettingsBtn--danger';
    clearBtn.textContent = 'Clear';

    actions.appendChild(saveBtn);
    actions.appendChild(testBtn);
    actions.appendChild(spacer);
    actions.appendChild(clearBtn);

    dialog.appendChild(header);
    dialog.appendChild(statusRow);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    renderStatus();

    const previouslyFocused = document.activeElement;
    let closed = false;

    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (previouslyFocused &&
            typeof previouslyFocused.focus === 'function' &&
            document.contains(previouslyFocused)) {
            try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
        }
    }

    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            close();
        }
    }

    closeX.addEventListener('click', close);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);

    saveBtn.addEventListener('click', function() {
        saveInjectConfig(urlInput.value.trim(), secretInput.value);
        renderStatus();
        refreshAllInjectButtons();
        showInjectToast('Inject settings saved');
    });

    testBtn.addEventListener('click', async function() {
        // Test what's currently in the form, not necessarily what's saved —
        // intuitive for a user editing and verifying in one pass. Persists
        // the form values so the test result reflects the same config the
        // user will keep when they close the modal.
        const formUrl    = urlInput.value.trim();
        const formSecret = secretInput.value;
        if (!formUrl || !formSecret) {
            showInjectToast('Enter URL and secret first', 'error');
            return;
        }
        saveInjectConfig(formUrl, formSecret);
        testBtn.disabled = true;
        const orig = testBtn.textContent;
        testBtn.textContent = 'Testing…';
        const r = await testConnection();
        testBtn.disabled = false;
        testBtn.textContent = orig;
        renderStatus();
        if (r.ok) showInjectToast('Connection ok');
        else      showInjectToast('Test failed — ' + r.label, 'error');
    });

    clearBtn.addEventListener('click', function() {
        if (!isInjectConfigured() && !urlInput.value && !secretInput.value) {
            showInjectToast('Nothing to clear');
            return;
        }
        showConfirmModal({
            message: 'Clear inject config? Both URL and shared secret will be erased from this device.',
            confirmLabel: 'Clear',
            onConfirm: function() {
                saveInjectConfig('', '');
                try {
                    localStorage.removeItem(LAST_TESTED_KEY);
                    localStorage.removeItem(LAST_RESULT_KEY);
                } catch (e) { /* private mode */ }
                urlInput.value = '';
                secretInput.value = '';
                renderStatus();
                refreshAllInjectButtons();
                showInjectToast('Inject config cleared');
            }
        });
    });

    setTimeout(function() {
        try { urlInput.focus(); } catch (e) { /* defensive */ }
    }, 0);
}


function relativeTime(ts) {
    const diff = Date.now() - ts;
    if (diff < 0) return 'just now';
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const d = Math.floor(hr / 24);
    return d + 'd ago';
}
