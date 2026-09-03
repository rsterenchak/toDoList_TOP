import { listLogic } from './listLogic.js';
import { findTargetById, chatWithWorker, showInjectToast } from './inject.js';
// wireModalDismiss centralizes the modal close contract (close button, backdrop
// tap, Escape) + focus restoration. Imported from its own leaf module (NOT
// modals.js, which imports buildMockupSecondary from here — a static modals.js
// import would form a modals ↔ mockupFlow init cycle); the leaf has no app
// imports, so this stays clean.
import { wireModalDismiss } from './modalDismiss.js';

// The `needs_mockup` A/B/C mockup flow, extracted from agentView.js so it can be
// mounted outside the Agent board later. It owns the prompt builders, the reply
// parser, the preview iframes, and the `needs_mockup` card's secondary content.
// The board imports buildMockupSecondary and calls it exactly where it did
// before; nothing a user sees changes.
//
// The flow calls back into the board to read the selected project, repaint, and
// refresh the queue (getSelectedProjectName / paint / refreshAgentQueue). Those
// live in agentView.js and importing them here would create a view → module →
// view cycle, so the board injects them once at load via configureMockupFlow.
// Until it does, the bindings are inert no-ops.
let getSelectedProjectName = function () { return ''; };
let refreshAgentQueue = function () { return Promise.resolve(); };
let paint = function () {};

// Wire the board-side callbacks the flow depends on. Called once by agentView.js
// at module load. Only overrides the callbacks actually supplied so a partial
// wiring can't blank out an already-set binding.
export function configureMockupFlow(deps) {
    if (deps && typeof deps.getSelectedProjectName === 'function') getSelectedProjectName = deps.getSelectedProjectName;
    if (deps && typeof deps.refreshAgentQueue === 'function') refreshAgentQueue = deps.refreshAgentQueue;
    if (deps && typeof deps.paint === 'function') paint = deps.paint;
}

// Generated A/B/C mockup variants, keyed by agent_queue row id → the parsed
// { A, B, C } variant object. Mockup previews are otherwise transient DOM state
// on the needs_mockup card, so a realtime push repaint (paint() rebuilds the
// whole board from _rows for ANY row change in the project) would wipe the
// just-generated previews out from under the user. Caching here (mirroring
// _handedOffRows/_dispatchPollers/_revertedEntries) lets buildMockupSecondary
// repaint them immediately instead of an empty "Generate mockups" button.
// Session-scoped only; resets on reload.
const _mockupVariants = new Map();
// Row ids with a mockup generation currently in flight, keyed by agent_queue row
// id. Mirrors _mockupVariants: a realtime push repaint (paint() rebuilds the whole
// board from _rows for ANY row change) tears down the just-clicked "Generating…"
// button and rebuilds a fresh idle one, so the original request finishes against a
// detached node and the user sees an inert "Generate mockups" they must click
// again. Recording the in-flight row here (set on click, cleared in both the
// success and failure paths) lets buildMockupSecondary re-render the button as
// disabled/"Generating…" after a repaint instead of resetting it to idle.
// Session-scoped only; resets on reload.
const _mockupPending = new Set();

// How a mockup prompt names the repo it targets. The three prompt builders no
// longer hardcode `toDoList_TOP` / `toDoList_main/src/`: given the active
// project's linked inject-target repo (owner/name, from mockupChatRepo) they
// name that repo and use neutral "repo-relative paths" wording, so a prompt for
// a linked repo (e.g. matchingGame-test) points at the right source tree. When
// no target is routed (repo null/empty), they fall back to the original
// toDoList_TOP PWA wording and its `toDoList_main/src/` path pin.
function mockupRepoLabel(repo) {
    const slug = (repo == null) ? '' : String(repo).trim();
    return slug ? ('`' + slug + '` repo') : 'toDoList_TOP PWA';
}
function mockupPathHint(repo) {
    const slug = (repo == null) ? '' : String(repo).trim();
    return slug ? 'full repo-relative paths' : 'full repo-relative paths under `toDoList_main/src/`';
}

// Build the ready-to-paste mockup prompt from the task + captured context
// bundle. Any Context line whose field is empty is omitted; when no bundle
// field is present the whole Context block is dropped rather than leaving a
// bare "Context:" header. The trailing format instruction pins the entry shape
// the user should paste back (matching the routine's TODO.md conventions).
function buildMockupPrompt(ctx, repo) {
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const val = function (v) { return (v == null) ? '' : String(v).trim(); };
    const title = val(c.title);
    const description = val(c.description);

    const contextLines = [];
    if (val(c.region)) contextLines.push('- Region: ' + val(c.region));
    if (val(c.tokens)) contextLines.push('- Tokens: ' + val(c.tokens));
    if (val(c.change)) contextLines.push('- Change: ' + val(c.change));
    const contextBlock = contextLines.length ? ('\n\nContext:\n' + contextLines.join('\n')) : '';

    // Raw source slices of the target region, added by triage so the mockup is
    // grounded in the real UI from the first message rather than reconstructed
    // from the hand-summarized `tokens`. Fenced verbatim; omitted (conditional,
    // like the Context lines) on older rows that predate these fields.
    const markup = val(c.markup);
    const css = val(c.css);
    const markupBlock = markup ? ('\n\nCurrent markup:\n```\n' + markup + '\n```') : '';
    const cssBlock = css ? ('\n\nCurrent CSS:\n```css\n' + css + '\n```') : '';

    return "I'm working on my " + mockupRepoLabel(repo) + ' and need mockups for a UI change, then a finished TODO.md entry.\n\n'
        + 'Task: ' + title + '\n' + description
        + contextBlock
        + markupBlock
        + cssBlock
        + '\n\nShow me 2-3 mockup options (A/B/C), let me pick one, then produce a single TODO.md entry '
        + 'in this format: `- [ ] **[PRIORITY]** <title>` with `- Type:` / `- Description:` / `- File:` / '
        + '`- Completed:` sub-bullets, priority in literal brackets, ' + mockupPathHint(repo) + ', no id marker.';
}

// The machine-parseable sibling of buildMockupPrompt: same grounded context
// (region/tokens/change/markup/css) but asking for three self-contained HTML
// documents — variants A/B/C — returned as a single JSON object and nothing
// else, so the reply can be parsed and rendered as live previews right on the
// card. Deliberately carries NO TODO.md-entry instruction: the finished entry
// stays with the fallback hand-off (buildMockupPrompt), so a Generate call is
// mockups-only.
function buildMockupGenPrompt(ctx, repo) {
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const val = function (v) { return (v == null) ? '' : String(v).trim(); };
    const title = val(c.title);
    const description = val(c.description);

    const contextLines = [];
    if (val(c.region)) contextLines.push('- Region: ' + val(c.region));
    if (val(c.tokens)) contextLines.push('- Tokens: ' + val(c.tokens));
    if (val(c.change)) contextLines.push('- Change: ' + val(c.change));
    const contextBlock = contextLines.length ? ('\n\nContext:\n' + contextLines.join('\n')) : '';

    const markup = val(c.markup);
    const css = val(c.css);
    const markupBlock = markup ? ('\n\nCurrent markup:\n```\n' + markup + '\n```') : '';
    const cssBlock = css ? ('\n\nCurrent CSS:\n```css\n' + css + '\n```') : '';

    return 'I need three UI mockup variants (A, B, C) for a change to my ' + mockupRepoLabel(repo) + ', '
        + 'to preview inline. Do NOT write a TODO.md entry — mockups only.\n\n'
        + 'Task: ' + title + '\n' + description
        + contextBlock
        + markupBlock
        + cssBlock
        + '\n\nProduce three distinct, self-contained HTML documents — one per variant — that '
        + 'render the proposed change. Each must be a complete standalone document styled with an '
        + 'inline <style> block, using the app CSS variables (var(--accent), var(--bg-base), '
        + 'var(--text-primary), etc.) so it matches the real theme; no external assets and no scripts.'
        + '\n\nReturn the three complete documents as RAW HTML — no JSON, no escaping, no code '
        + 'fences. Precede each document with its own marker line, alone on its own line, exactly:\n'
        + '===VARIANT A===\n<full html document for A>\n===VARIANT B===\n<full html document for B>\n'
        + '===VARIANT C===\n<full html document for C>\n'
        + 'Output nothing before ===VARIANT A=== and nothing after the C document.';
}

// Parse a mockup-generation reply into { A, B, C } HTML strings, defensively.
// The reply is raw HTML — each variant document preceded by a sentinel marker
// line (===VARIANT A=== / B / C) — NOT JSON: embedding full HTML documents as
// JSON string values proved too fragile (every quote and newline needs
// escaping), so the contract is marker-delimited raw HTML with no escaping.
// Splits on the markers (tolerating surrounding prose or a ```html fence around
// each document) and returns { A, B, C }. Returns null if it can't recover at
// least one variant — the caller surfaces that as a non-blocking error and
// leaves the fallback hand-off usable. Never throws.
function parseMockupVariants(reply) {
    if (!reply || typeof reply !== 'string') return null;
    const text = reply;
    // Locate every "===VARIANT X===" marker, tolerating spacing and case.
    const markerRe = /={2,}\s*VARIANT\s+([ABC])\s*={2,}/gi;
    const markers = [];
    let m;
    while ((m = markerRe.exec(text)) !== null) {
        markers.push({ key: m[1].toUpperCase(), start: m.index, contentStart: markerRe.lastIndex });
    }
    if (!markers.length) return null;
    const out = {};
    let any = false;
    for (let i = 0; i < markers.length; i++) {
        const end = (i + 1 < markers.length) ? markers[i + 1].start : text.length;
        let slice = text.slice(markers[i].contentStart, end).trim();
        // Peel a ```html … ``` (or bare ```) fence wrapping the document.
        const fence = slice.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
        if (fence) slice = fence[1].trim();
        // First writer wins if a marker somehow repeats.
        if (slice && !out[markers[i].key]) { out[markers[i].key] = slice; any = true; }
    }
    return any ? out : null;
}

// Build the prompt that turns a chosen A/B/C variant into a finished TODO.md
// entry. Carries the same grounded context buildMockupGenPrompt uses
// (title/description/region/tokens/change/markup/css) plus the selected
// variant's HTML, and asks for ONLY the finished entry in the exact shape the
// fallback prompt pins — so the reply can be written straight to the row's
// draft after a single fence strip.
function buildMockupEntryPrompt(ctx, key, html, repo) {
    const c = (ctx && typeof ctx === 'object') ? ctx : {};
    const val = function (v) { return (v == null) ? '' : String(v).trim(); };
    const title = val(c.title);
    const description = val(c.description);

    const contextLines = [];
    if (val(c.region)) contextLines.push('- Region: ' + val(c.region));
    if (val(c.tokens)) contextLines.push('- Tokens: ' + val(c.tokens));
    if (val(c.change)) contextLines.push('- Change: ' + val(c.change));
    const contextBlock = contextLines.length ? ('\n\nContext:\n' + contextLines.join('\n')) : '';

    const markup = val(c.markup);
    const css = val(c.css);
    const markupBlock = markup ? ('\n\nCurrent markup:\n```\n' + markup + '\n```') : '';
    const cssBlock = css ? ('\n\nCurrent CSS:\n```css\n' + css + '\n```') : '';

    const variantHtml = String(html == null ? '' : html);
    const variantBlock = '\n\nChosen mockup (variant ' + String(key) + '):\n```html\n' + variantHtml + '\n```';

    return 'I picked a mockup for a UI change to my ' + mockupRepoLabel(repo) + '. Turn it into a single '
        + 'finished TODO.md entry — nothing else.\n\n'
        + 'Task: ' + title + '\n' + description
        + contextBlock
        + markupBlock
        + cssBlock
        + variantBlock
        + '\n\nReturn ONLY the finished entry in exactly this format: '
        + '`- [ ] **[PRIORITY]** <title>` with `- Type:` / `- Description:` / `- File:` / '
        + '`- Completed:` sub-bullets, priority in literal brackets, ' + mockupPathHint(repo)
        + ', no id marker. No prose, no explanation, no code fences.';
}

// Strip a single wrapping ```…``` (or ```markdown …```) code fence from a reply
// and trim, so a fenced entry pastes cleanly into the row's draft. A reply with
// no fence is returned trimmed as-is. Never throws.
function stripEntryFence(reply) {
    let s = String(reply == null ? '' : reply).trim();
    const fence = s.match(/^```[a-zA-Z]*\s*\n?([\s\S]*?)\n?```$/);
    if (fence) s = fence[1].trim();
    return s;
}

// The app's Void design tokens (the dark-theme :root defaults from style.css),
// injected into every preview iframe so a variant's HTML renders against the
// real cascade rather than an approximation. Kept in sync with style.css by
// token name; buildPreviewCss() overrides any token whose live computed value
// is readable at render time, so an active light theme is honored too.
const PREVIEW_TOKENS = [
    ['--bg-base', '#0e0f14'],
    ['--bg-elevated', '#14151b'],
    ['--bg-raised', '#1c1e27'],
    ['--bg-surface', '#191a22'],
    ['--bg-row', '#1b1c25'],
    ['--bg-hover', '#1f2130'],
    ['--bg-active', '#1a1c29'],
    ['--border-dim', '#1d1e26'],
    ['--border-mid', '#23242e'],
    ['--border-bright', '#2d2f3d'],
    ['--accent', '#8b7bff'],
    ['--accent-dim', 'rgba(139, 123, 255, 0.12)'],
    ['--accent-text', '#8b7bff'],
    ['--accent-glow', 'rgba(139, 123, 255, 0.55)'],
    ['--text-primary', '#e6e7ee'],
    ['--text-secondary', '#8a8d9c'],
    ['--text-muted', '#5a5d6b'],
    ['--text-danger', '#e06a7a'],
    ['--text-warning', '#d9b86a'],
    ['--text-urgent', '#e06a7a'],
    ['--type-feature', '#9ad0a8'],
    ['--type-bug', '#e48a96'],
    ['--type-modify', '#d9b88a'],
    ['--radius-sm', '4px'],
    ['--radius-md', '6px'],
];

// Build the <style> body injected into each preview document: the resolved
// Void tokens on :root plus a base reset and the app font stack, so a variant
// inherits the real theme + typography. Reads live token values off the root
// element when available (honoring the active theme), falling back to the dark
// defaults when they can't be read (e.g. under a headless test).
function buildPreviewCss() {
    let live = null;
    try { live = window.getComputedStyle(document.documentElement); } catch (e) { live = null; }
    const decls = PREVIEW_TOKENS.map(function (pair) {
        let value = pair[1];
        if (live) {
            const v = live.getPropertyValue(pair[0]);
            if (v && v.trim()) value = v.trim();
        }
        return '  ' + pair[0] + ': ' + value + ';';
    }).join('\n');
    return ':root {\n' + decls + '\n}\n'
        + 'html, body { margin: 0; }\n'
        + 'body { padding: 12px; background: var(--bg-base); color: var(--text-primary);'
        + " font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,"
        + ' Helvetica, Arial, sans-serif; }\n'
        + "code, pre, kbd { font-family: 'SpaceMono', ui-monospace, SFMono-Regular, Consolas, monospace; }";
}

// Inject the preview <style> into a variant's HTML so it renders against the
// app cascade. Splices into an existing <head> when the variant is a full
// document, opens one inside a bare <html>, or wraps a fragment in a minimal
// document — so both full documents and fragments preview correctly.
function injectPreviewStyle(html) {
    const styleTag = '<style>' + buildPreviewCss() + '</style>';
    const h = String(html == null ? '' : html);
    if (/<head[^>]*>/i.test(h)) {
        return h.replace(/<head[^>]*>/i, function (m) { return m + styleTag; });
    }
    if (/<html[^>]*>/i.test(h)) {
        return h.replace(/<html[^>]*>/i, function (m) { return m + '<head>' + styleTag + '</head>'; });
    }
    return '<!doctype html><html><head>' + styleTag + '</head><body>' + h + '</body></html>';
}

// The repo to point a mockup-generation chat turn at: the active project's
// linked inject target repo (the same routing the inject/run path uses), or
// null when the project has no target — in which case the Worker falls back to
// its default repo. Mirrors resolveProjectRepo without pulling that module's
// import graph into this view.
function mockupChatRepo(projectName) {
    const targetId = listLogic.getProjectTargetId(projectName);
    if (!targetId) return null;
    const target = findTargetById(targetId);
    return target && target.repo ? target.repo : null;
}

// Authoring dimensions a scaled preview renders at before being shrunk to fit
// its (much narrower) three-across pane tile. The frame is sized to these px in
// CSS and a CSS transform scales it down; the wrapper is sized to the scaled
// result. The board's stacked, full-width tiles don't scale, so these apply only
// in the scaled (pane) path.
const MOCKUP_SCALED_WIDTH = 1024;
const MOCKUP_SCALED_HEIGHT = 720;

// Fit a fixed-size preview frame to its wrapper: scale = wrapperWidth /
// authoringWidth, applied as a CSS transform, with the wrapper's height set to
// the scaled content height so the tile is exactly as tall as the shrunk mockup.
// A zero width (an unmeasured / headless node) is left alone, so it's a harmless
// no-op under jsdom.
function applyMockupScale(scaler, frame) {
    const w = scaler.clientWidth || scaler.offsetWidth || 0;
    if (!w) return;
    const scale = w / MOCKUP_SCALED_WIDTH;
    frame.style.transform = 'scale(' + scale + ')';
    scaler.style.height = (MOCKUP_SCALED_HEIGHT * scale) + 'px';
}

// Wire a scaled preview frame: observe its wrapper so a pane resize (e.g. docking
// the chat) re-fits the mockup live when ResizeObserver is available, plus a
// one-shot measure for the initial paint and the ResizeObserver-absent case.
function mountScaledFrame(scaler, frame) {
    if (typeof ResizeObserver !== 'undefined') {
        try {
            const ro = new ResizeObserver(function () { applyMockupScale(scaler, frame); });
            ro.observe(scaler);
        } catch (e) { /* no-op: the one-shot measure below still fits it once */ }
    }
    applyMockupScale(scaler, frame);
}

// The tap-to-enlarge overlay: one mockup variant rendered large — wider than any
// pane or the mobile modal — and layered above whatever opened it. RE-RENDERS the
// variant HTML at a scale suited to the overlay's own (much wider) width via the
// shared scaler machinery, rather than upscaling the tile's already-shrunk frame,
// so a dense mockup reads at ~1:1 instead of blurring. Carries the same "use this"
// action the tiles do — choosing here produces the entry, flips the row to
// `drafted`, and closes the overlay. Reuses wireModalDismiss for the close-button /
// backdrop / Escape contract and focus restoration, traps focus while open, and
// removes any prior overlay first so a second open never leaves the first's iframe
// in the document. `row` omitted keeps it a pure viewer (no Use control). Returns
// the guarded close fn. Never throws.
function openMockupOverlay(key, html, row) {
    if (!html) return function () {};
    // Never stack two overlays; a stale one would strand its iframe in the DOM.
    const prior = document.getElementById('mockupOverlayBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    // Restore focus to whatever opened the overlay (the tapped tile / tab) on close.
    const previouslyFocused = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.id = 'mockupOverlayBackdrop';
    backdrop.className = 'mockupOverlayBackdrop';

    const dialog = document.createElement('div');
    dialog.className = 'mockupOverlay';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Mockup option ' + key + ' preview');

    const header = document.createElement('div');
    header.className = 'mockupOverlayHeader';

    const label = document.createElement('span');
    label.className = 'mockupOverlayLabel';
    label.textContent = 'Option ' + key;
    header.appendChild(label);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'mockupOverlayClose';
    closeBtn.setAttribute('aria-label', 'Close preview');
    closeBtn.textContent = '×';
    header.appendChild(closeBtn);
    dialog.appendChild(header);

    // Large preview: a FRESH scaler + iframe re-rendered from the variant HTML and
    // scaled to the overlay's width — not the shrunk tile frame reused. Same
    // maximum-restriction sandbox as the tiles; do not relax it for the larger view.
    const scaler = document.createElement('div');
    scaler.className = 'agentMockupFrameScaler mockupOverlayScaler';
    const frame = document.createElement('iframe');
    frame.className = 'agentMockupFrame';
    frame.setAttribute('sandbox', '');
    frame.setAttribute('title', 'Mockup option ' + key);
    frame.srcdoc = injectPreviewStyle(html);
    scaler.appendChild(frame);
    dialog.appendChild(scaler);

    // ── "use this": the same createMockupEntry path the tiles use, closing the
    // overlay on success. Omitted for view-only (no-row) callers. ──
    let useBtn = null;
    if (row) {
        const useRow = document.createElement('div');
        useRow.className = 'agentMockupUseRow mockupOverlayUseRow';

        const useErr = document.createElement('p');
        useErr.className = 'agentMockupUseError';
        useErr.setAttribute('role', 'alert');
        useErr.hidden = true;

        useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'agentMockupUse';
        useBtn.textContent = 'use this';

        let failed = false;
        const useFail = function (message) {
            failed = true;
            useBtn.disabled = false;
            useBtn.classList.remove('is-pending');
            useBtn.textContent = 'use this';
            useErr.textContent = message || 'Couldn’t create the entry. Try again.';
            useErr.hidden = false;
        };

        useBtn.addEventListener('click', function () {
            if (useBtn.disabled) return;
            failed = false;
            useErr.hidden = true;
            useErr.textContent = '';
            useBtn.disabled = true;
            useBtn.classList.add('is-pending');
            useBtn.textContent = 'Creating entry…';
            createMockupEntry(row, key, html, useFail).then(function () {
                // Success: the row is now drafted — close. On failure useFail has
                // already re-enabled the button and surfaced the error, so hold.
                if (!failed) close();
            });
        });

        useRow.appendChild(useBtn);
        useRow.appendChild(useErr);
        dialog.appendChild(useRow);
    }

    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const close = wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeBtn],
        onClose: function () {
            if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
                try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
            }
        },
    });

    // Trap focus inside the overlay while open — it holds actionable controls, so
    // Tab must not reach the pane/modal beneath. Cycles between the close control
    // and (when present) the enabled Use button.
    dialog.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        const focusables = [closeBtn, useBtn].filter(function (b) { return b && !b.disabled; });
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
            if (active === first || !dialog.contains(active)) { e.preventDefault(); last.focus(); }
        } else {
            if (active === last || !dialog.contains(active)) { e.preventDefault(); first.focus(); }
        }
    });

    // Fit the preview to the overlay's width now it's measurable in the DOM.
    mountScaledFrame(scaler, frame);

    // Land focus on the close control so Escape/Enter work at once and the trap
    // has a starting point inside the overlay.
    try { closeBtn.focus(); } catch (e) { /* defensive */ }

    return close;
}

// Layer a tap-to-enlarge affordance over a scaled preview `scaler`: a transparent
// button ON TOP of the pointer-inert sandboxed iframe (which swallows clicks), so
// a tap or Enter/Space opens the variant in the overlay. A small corner glyph
// surfaces on hover/focus to signal it's interactive. `describe` names the variant
// for the accessible label; `onEnlarge` opens the overlay for whatever variant is
// current at click time (fixed for a tile, the selected tab for the tabbed host).
function addMockupEnlarge(scaler, describe, onEnlarge) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agentMockupEnlarge';
    btn.setAttribute('aria-label', 'Enlarge ' + describe + ' preview');

    const hint = document.createElement('span');
    hint.className = 'agentMockupEnlargeHint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = '⤢';
    btn.appendChild(hint);

    btn.addEventListener('click', function () { onEnlarge(); });
    scaler.appendChild(btn);
    return btn;
}

// Turn a chosen A/B/C variant into a finished TODO.md entry and write it to the
// row's draft, flipping the row to `drafted` at the existing Dispatch gate. The
// chat round-trip → fence strip → save → refresh sequence is identical for every
// host (the board's stacked tiles, the pane's three-across tiles, the mobile
// modal's tabbed preview); only the pending / error UI differs, so each host
// passes an `onFail(message)` and drives its own button state. Returns the
// promise so a caller can chain; never throws (rejections route to onFail).
function createMockupEntry(row, key, html, onFail) {
    const fail = (typeof onFail === 'function') ? onFail : function () {};
    const repo = mockupChatRepo(getSelectedProjectName());
    return Promise.resolve().then(function () {
        return chatWithWorker(
            [{ role: 'user', content: buildMockupEntryPrompt(row.context, key, html, repo) }],
            null, null, repo,
        );
    }).then(function (res) {
        const draft = stripEntryFence((res && typeof res.reply === 'string') ? res.reply : '');
        if (!draft) {
            fail('The reply was empty — try again.');
            return null;
        }
        return Promise.resolve(listLogic.setAgentRunState(row.id, { draft: draft, state: 'drafted' }))
            .then(function (saved) {
                if (saved && saved.ok) {
                    // Realtime moves the card to In progress; force a refresh so
                    // the drafted row lands promptly.
                    refreshAgentQueue(getSelectedProjectName());
                    return;
                }
                fail(saved && saved.error);
            });
    }).catch(function () {
        fail('Couldn’t create the entry. Try again.');
    });
}

// Render the A/B/C variants into the previews container as tiles, each a
// sandboxed <iframe> (scripts OFF via an empty `sandbox`, so pure-CSS motion
// still runs) whose srcdoc is the variant HTML with the app cascade injected.
// Replaces any prior tiles.
//
// When `row` is supplied, each tile also carries a "use this" control: tapping
// it turns that variant into a finished TODO.md entry (buildMockupEntryPrompt →
// chat Worker) and writes it to the row's draft, flipping the row to `drafted`
// at the existing Dispatch gate. The row is omitted only by view-only callers
// (older/test call sites), keeping the tiles inert there.
//
// `options` lets a host share this one renderer while laying the tiles out
// differently: `options.scaled` wraps each frame in a clipping scaler and shrinks
// a desktop-width variant to fit a narrow three-across tile (the detail pane),
// while the board omits it for its stacked full-width frames; `options.onRender`
// is invoked after the tiles mount so a host can re-snapshot its layout (the pane
// re-measures its expanded height — three tiles are much taller than the empty
// state). Both default off, so the board's call is byte-for-byte unchanged.
function renderMockupPreviews(container, variants, row, options) {
    const opts = (options && typeof options === 'object') ? options : {};
    const scaled = !!opts.scaled;
    container.textContent = '';
    const useButtons = [];
    ['A', 'B', 'C'].forEach(function (k) {
        if (!variants[k]) return;
        const tile = document.createElement('div');
        tile.className = 'agentMockupTile';

        const label = document.createElement('span');
        label.className = 'agentMockupTileLabel';
        label.textContent = 'Option ' + k;
        tile.appendChild(label);

        const frame = document.createElement('iframe');
        frame.className = 'agentMockupFrame';
        // Empty sandbox = maximum restriction: scripts, forms, and same-origin
        // are all off. Pure-CSS animation is unaffected.
        frame.setAttribute('sandbox', '');
        frame.setAttribute('title', 'Mockup option ' + k);
        frame.setAttribute('loading', 'lazy');
        frame.srcdoc = injectPreviewStyle(variants[k]);
        if (scaled) {
            // Fixed authoring width inside a clipping wrapper, shrunk to fit the
            // narrow tile — otherwise a desktop-width mockup shows only its
            // top-left corner at ~270px (or ~110px with the chat pane docked).
            const scaler = document.createElement('div');
            scaler.className = 'agentMockupFrameScaler';
            scaler.appendChild(frame);
            mountScaledFrame(scaler, frame);
            // Tap the (necessarily small) scaled preview to open it large — the
            // grid tiles are too small to read a dense mockup. Not added to the
            // board's unscaled full-width frames (out of scope).
            addMockupEnlarge(scaler, 'Option ' + k, function () {
                openMockupOverlay(k, variants[k], row);
            });
            tile.appendChild(scaler);
        } else {
            tile.appendChild(frame);
        }

        if (row) {
            const useRow = document.createElement('div');
            useRow.className = 'agentMockupUseRow';

            const useErr = document.createElement('p');
            useErr.className = 'agentMockupUseError';
            useErr.setAttribute('role', 'alert');
            useErr.hidden = true;

            const useBtn = document.createElement('button');
            useBtn.type = 'button';
            useBtn.className = 'agentMockupUse';
            useBtn.textContent = 'use this';
            useButtons.push(useBtn);

            function useFail(message) {
                tile.classList.remove('is-selected');
                useButtons.forEach(function (b) { b.disabled = false; });
                useBtn.classList.remove('is-pending');
                useBtn.textContent = 'use this';
                useErr.textContent = message || 'Couldn’t create the entry. Try again.';
                useErr.hidden = false;
            }

            useBtn.addEventListener('click', function () {
                if (useBtn.disabled) return;
                useErr.hidden = true;
                useErr.textContent = '';
                // Enter pending: ring this tile, disable every "use this" while
                // the entry is generated.
                container.querySelectorAll('.agentMockupTile.is-selected').forEach(function (t) {
                    t.classList.remove('is-selected');
                });
                tile.classList.add('is-selected');
                useButtons.forEach(function (b) { b.disabled = true; });
                useBtn.classList.add('is-pending');
                useBtn.textContent = 'Creating entry…';

                createMockupEntry(row, k, variants[k], useFail);
            });

            useRow.appendChild(useBtn);
            useRow.appendChild(useErr);
            tile.appendChild(useRow);
        }

        container.appendChild(tile);
    });
    // Let the host re-snapshot its layout now the tiles (or none) have mounted.
    if (typeof opts.onRender === 'function') opts.onRender(container);
}

// The A/B/C variants laid out as a TABBED selector for a narrow host — the mobile
// description-editor modal. Three variants across (the pane's grid) is unusable at
// phone width (~120px each), and stacking three frames blows the modal's height cap
// and forces scroll-to-compare — the very thing A/B/C exists to avoid. So the tabs
// render OPTION A / B / C as a `radiogroup` above a SINGLE scaled preview, re-pointed
// as the selected tab changes, with one "use this" action acting on the selection.
// Shares the entry-creation path (createMockupEntry) and the preview scaling
// (mountScaledFrame, sized to the modal's width) with the tile renderer; only the
// arrangement differs, so the flow — generation, parsing, the Use path — is never
// reimplemented. `row` omitted keeps the tabs inert (view-only). `options.onRender`
// fires after mount so a host can re-measure. Never throws.
function renderMockupTabs(container, variants, row, options) {
    const opts = (options && typeof options === 'object') ? options : {};
    container.textContent = '';
    const keys = ['A', 'B', 'C'].filter(function (k) { return !!variants[k]; });
    if (!keys.length) {
        if (typeof opts.onRender === 'function') opts.onRender(container);
        return;
    }

    // ── Tab strip — a radiogroup: one radio per available variant, arrow-key
    // navigation, exactly one selected (roving tabindex). ──
    const tabs = document.createElement('div');
    tabs.className = 'agentMockupTabs';
    tabs.setAttribute('role', 'radiogroup');
    tabs.setAttribute('aria-label', 'Mockup options');

    // ── Single preview — one clipping scaler + iframe, re-pointed on tab change.
    // Scaled the same way the pane's tiles are, so a desktop-width variant fits
    // the modal rather than showing only its top-left corner. ──
    const scaler = document.createElement('div');
    scaler.className = 'agentMockupFrameScaler';
    const frame = document.createElement('iframe');
    frame.className = 'agentMockupFrame';
    // Empty sandbox = maximum restriction (scripts/forms/same-origin off);
    // pure-CSS animation still runs. Matches the tile renderer's frames.
    frame.setAttribute('sandbox', '');
    frame.setAttribute('title', 'Mockup preview');
    frame.setAttribute('loading', 'lazy');
    scaler.appendChild(frame);

    let selectedKey = keys[0];
    const tabButtons = {};

    function selectKey(k) {
        if (!variants[k]) return;
        selectedKey = k;
        keys.forEach(function (kk) {
            const b = tabButtons[kk];
            const on = kk === k;
            b.setAttribute('aria-checked', on ? 'true' : 'false');
            b.tabIndex = on ? 0 : -1;
            b.classList.toggle('is-selected', on);
        });
        // Re-point the single preview at the selected variant and re-fit it.
        frame.srcdoc = injectPreviewStyle(variants[k]);
        applyMockupScale(scaler, frame);
    }

    keys.forEach(function (k, i) {
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'agentMockupTab';
        tab.setAttribute('role', 'radio');
        tab.textContent = 'Option ' + k;
        tab.addEventListener('click', function () { selectKey(k); });
        tab.addEventListener('keydown', function (e) {
            let next = null;
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = keys[(i + 1) % keys.length];
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = keys[(i - 1 + keys.length) % keys.length];
            if (next) {
                e.preventDefault();
                selectKey(next);
                try { tabButtons[next].focus(); } catch (err) { /* defensive */ }
            }
        });
        tabButtons[k] = tab;
        tabs.appendChild(tab);
    });

    container.appendChild(tabs);
    container.appendChild(scaler);

    // ── "use this": acts on the CURRENT selection, generating its finished entry
    // and flipping the row to `drafted` — omitted for view-only (no-row) callers. ──
    if (row) {
        const useRow = document.createElement('div');
        useRow.className = 'agentMockupUseRow';

        const useErr = document.createElement('p');
        useErr.className = 'agentMockupUseError';
        useErr.setAttribute('role', 'alert');
        useErr.hidden = true;

        const useBtn = document.createElement('button');
        useBtn.type = 'button';
        useBtn.className = 'agentMockupUse';
        useBtn.textContent = 'use this';

        function useFail(message) {
            useBtn.disabled = false;
            useBtn.classList.remove('is-pending');
            useBtn.textContent = 'use this';
            useErr.textContent = message || 'Couldn’t create the entry. Try again.';
            useErr.hidden = false;
        }

        useBtn.addEventListener('click', function () {
            if (useBtn.disabled) return;
            useErr.hidden = true;
            useErr.textContent = '';
            useBtn.disabled = true;
            useBtn.classList.add('is-pending');
            useBtn.textContent = 'Creating entry…';
            createMockupEntry(row, selectedKey, variants[selectedKey], useFail);
        });

        useRow.appendChild(useBtn);
        useRow.appendChild(useErr);
        container.appendChild(useRow);
    }

    // Tap the single tabbed preview to open the CURRENTLY-selected variant large —
    // the modal-width preview is too narrow to read a dense mockup. Reads
    // selectedKey at click time so it always enlarges the visible tab.
    addMockupEnlarge(scaler, 'the selected option', function () {
        openMockupOverlay(selectedKey, variants[selectedKey], row);
    });

    // Paint the first preview and wire the scale observer so a viewport / modal
    // resize re-fits it live.
    selectKey(selectedKey);
    mountScaledFrame(scaler, frame);

    if (typeof opts.onRender === 'function') opts.onRender(container);
}

// Secondary content for a `needs_mockup` card. Two paths stacked top-to-bottom:
//
//   1. In-app A/B/C generation — a Generate / Regenerate control that calls the
//      chat Worker with a machine-parseable prompt, parses the reply, and
//      renders the three variants as sandboxed preview iframes right on the
//      card. This is the primary path.
//   2. A tucked "Not quite right?" fallback — the original manual hand-off,
//      unchanged: an "Open mockup" button that expands a read-only block showing
//      the *actual full prompt* to paste into Claude, with a Copy button and a
//      separate "Open Claude Design" control, plus a paste-back field that takes
//      the finished TODO.md entry, writes it to the row's `draft`, and flips the
//      row to `drafted` — where the Dispatch card already ships it.
//
// The view never writes to Supabase directly (the save routes through
// listLogic.setAgentRunState) and generation reuses the existing chat proxy
// (no Worker change). Each preview tile also carries a "use this" control that
// turns the chosen variant into the finished entry and flips the row to
// `drafted`; the fallback paste-back stays as the manual escape hatch.
// `options` (all optional, defaulting off so the board's `buildMockupSecondary(row)`
// call is unchanged) let other hosts reuse this one implementation with a different
// preview layout: `options.grid` (the desktop detail pane) lays the variants three
// across (via the `agentMockup--grid` class) and scales each preview to fit its
// narrow tile; `options.tabbed` (the mobile description-editor modal) renders the
// variants as an OPTION A/B/C radiogroup above a single scaled preview (via the
// `agentMockup--tabbed` class and renderMockupTabs), so three frames don't blow the
// modal's height cap; `options.onRender` is threaded to the active renderer so the
// host can re-snapshot its height whenever variants (re)render. grid and tabbed are
// mutually exclusive; tabbed wins if both are set.
function buildMockupSecondary(row, options) {
    const opts = (options && typeof options === 'object') ? options : {};
    const useTabs = !!opts.tabbed;
    const renderOpts = {
        scaled: !useTabs && !!opts.grid,
        onRender: (typeof opts.onRender === 'function') ? opts.onRender : null,
    };
    // Route to the tabbed (single scaled preview) renderer or the tile renderer
    // (stacked on the board, three-across when scaled) from one call site, so the
    // Generate / Regenerate / cache-restore paths below never branch on layout.
    function renderInto(cont, vars) {
        if (useTabs) renderMockupTabs(cont, vars, row, { onRender: renderOpts.onRender });
        else renderMockupPreviews(cont, vars, row, renderOpts);
    }
    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const wrap = document.createElement('div');
    wrap.className = 'agentSecondary agentMockup'
        + (useTabs ? ' agentMockup--tabbed' : (opts.grid ? ' agentMockup--grid' : ''));

    // ── In-app A/B/C generation ──
    // Generate calls the chat Worker with buildMockupGenPrompt, parses the reply
    // into three variants, and renders them as sandboxed preview iframes.
    // Regenerate re-runs and replaces the tiles. A generation or parse failure
    // shows a non-blocking error and leaves the fallback hand-off fully usable.
    const gen = document.createElement('div');
    gen.className = 'agentMockupGen';

    const previews = document.createElement('div');
    previews.className = 'agentMockupPreviews';

    const genError = document.createElement('p');
    genError.className = 'agentMockupGenError';
    genError.setAttribute('role', 'alert');
    genError.hidden = true;

    const genBtn = document.createElement('button');
    genBtn.type = 'button';
    genBtn.className = 'agentMockupGenerate';
    genBtn.textContent = 'Generate mockups';

    // Previously-generated variants survive a realtime repaint: repaint them
    // immediately from the module-level cache and offer a Regenerate rather than
    // a bare "Generate mockups" button, so a background board change doesn't wipe
    // the user's mockups.
    const cachedVariants = _mockupVariants.get(row.id);
    if (cachedVariants) {
        renderInto(previews, cachedVariants);
        genBtn.textContent = 'Regenerate';
    }

    // A generation kicked off before this render is still in flight (a realtime
    // repaint tore down the button that started it). Re-render as the disabled
    // "Generating…" state rather than a bare idle button so the user doesn't
    // click again and fire a redundant generation against a detached node.
    if (_mockupPending.has(row.id)) {
        genBtn.disabled = true;
        genBtn.classList.add('is-pending');
        genBtn.textContent = 'Generating…';
    }

    function genFail(message) {
        _mockupPending.delete(row.id);
        // A repaint detached this card while the request was in flight; the
        // visible button is a fresh node still showing "Generating…". Repaint so
        // it leaves that state (the error surfaces on the next attempt).
        if (!genBtn.isConnected) {
            paint();
            return;
        }
        genBtn.disabled = false;
        genBtn.classList.remove('is-pending');
        genBtn.textContent = previews.childNodes.length ? 'Regenerate' : 'Generate mockups';
        genError.textContent = message || 'Couldn’t generate mockups. Try again.';
        genError.hidden = false;
    }

    genBtn.addEventListener('click', function () {
        if (genBtn.disabled) return;
        genError.hidden = true;
        genError.textContent = '';
        genBtn.disabled = true;
        genBtn.classList.add('is-pending');
        genBtn.textContent = 'Generating…';
        _mockupPending.add(row.id);
        const repo = mockupChatRepo(getSelectedProjectName());
        Promise.resolve().then(function () {
            return chatWithWorker([{ role: 'user', content: buildMockupGenPrompt(ctx, repo) }], null, null, repo);
        }).then(function (res) {
            const reply = (res && typeof res.reply === 'string') ? res.reply : '';
            const variants = parseMockupVariants(reply);
            if (!variants) {
                genFail('Couldn’t read the mockups from the reply — try Regenerate, or use the fallback below.');
                return;
            }
            // Cache the parsed variants so a realtime repaint restores them.
            _mockupVariants.set(row.id, variants);
            _mockupPending.delete(row.id);
            // If a repaint detached this card mid-flight, its button is elsewhere
            // stuck on "Generating…"; repaint so the visible card renders the new
            // previews from cache. Otherwise update this (still-connected) node.
            if (!genBtn.isConnected) {
                paint();
                return;
            }
            renderInto(previews, variants);
            genBtn.disabled = false;
            genBtn.classList.remove('is-pending');
            genBtn.textContent = 'Regenerate';
        }).catch(function (e) {
            // chatWithWorker hands up the Worker's own `{ error, detail }` body as
            // `reason` (an upstream status and its error text on the 502 paths), so
            // name the cause rather than swallowing it. The generic copy stands in
            // only when the error carries nothing to say.
            const reason = e && (e.reason || e.message);
            genFail(reason
                ? 'Couldn’t generate mockups — ' + reason + '. Or use the fallback below.'
                : 'Couldn’t generate mockups — try again, or use the fallback below.');
        });
    });

    gen.appendChild(genBtn);
    gen.appendChild(genError);
    gen.appendChild(previews);
    wrap.appendChild(gen);

    // ── Fallback hand-off ──
    // The full manual path, tucked beneath the previews as a collapsible
    // "Not quite right?" section. Nothing here changed — it just no longer sits
    // at the top of the card.
    const fallback = document.createElement('details');
    fallback.className = 'agentMockupFallback';
    const fallbackSummary = document.createElement('summary');
    fallbackSummary.className = 'agentMockupFallbackSummary';
    fallbackSummary.textContent = 'Not quite right? Hand off to Claude';
    fallback.appendChild(fallbackSummary);

    // The full assembled prompt — the same string the user pastes into Claude.
    // Built once (the context bundle is folded into it), shown verbatim in the
    // toggled block so what the user sees is exactly what they copy. Grounded at
    // the active project's linked repo so a linked repo isn't mislabeled as
    // toDoList_TOP.
    const prompt = buildMockupPrompt(ctx, mockupChatRepo(getSelectedProjectName()));

    // Open mockup: toggles the read-only prompt block open/closed. No clipboard
    // write or tab-open here — those live on the Copy button and the Open Claude
    // Design control inside the block, kept separate to avoid a focus race.
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'agentMockupOpen';
    openBtn.textContent = 'Open mockup';
    openBtn.setAttribute('aria-expanded', 'false');
    fallback.appendChild(openBtn);

    const promptWrap = document.createElement('div');
    promptWrap.className = 'agentMockupPrompt';
    promptWrap.hidden = true;

    const promptBlock = document.createElement('pre');
    promptBlock.className = 'agentDraftBlock agentMockupPromptBlock';
    promptBlock.setAttribute('tabindex', '0');
    promptBlock.setAttribute('aria-label', 'Mockup prompt');
    promptBlock.textContent = prompt;
    promptWrap.appendChild(promptBlock);

    const promptActions = document.createElement('div');
    promptActions.className = 'agentMockupPromptActions';

    // Copy: write the prompt to the clipboard and confirm via toast; a failure
    // says so rather than swallowing it. The block stays visible regardless, so
    // the user can also select-and-copy manually.
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'agentMockupCopy';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', function () {
        let copied;
        try {
            copied = navigator.clipboard.writeText(prompt);
        } catch (e) {
            copied = Promise.reject(e);
        }
        Promise.resolve(copied).then(function () {
            showInjectToast('Mockup prompt copied — paste it into Claude or Claude Design.');
        }, function () {
            showInjectToast('Couldn’t copy the prompt — select and copy it manually.', 'error');
        });
    });
    promptActions.appendChild(copyBtn);

    // Open Claude Design: a separate, deliberate tap that opens Claude in a new
    // tab — decoupled from Copy so there's no focus race between the two.
    const designBtn = document.createElement('button');
    designBtn.type = 'button';
    designBtn.className = 'agentMockupDesignLink';
    designBtn.textContent = 'Open Claude Design';
    designBtn.addEventListener('click', function () {
        try { window.open('https://claude.ai/new', '_blank'); } catch (e) { /* popup blocked */ }
    });
    promptActions.appendChild(designBtn);

    promptWrap.appendChild(promptActions);
    fallback.appendChild(promptWrap);

    openBtn.addEventListener('click', function () {
        const open = promptWrap.hidden;
        promptWrap.hidden = !open;
        openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Paste-back field: the finished TODO.md entry. Saving writes it to the
    // row's `draft` and flips the row to `drafted`. Multi-line by nature, so
    // Enter inserts newlines (no Enter-to-submit). 16px avoids iOS focus zoom.
    const input = document.createElement('textarea');
    input.className = 'agentMockupPaste';
    input.rows = 4;
    input.placeholder = 'Paste the finished TODO.md entry…';
    input.setAttribute('aria-label', 'Finished entry');
    fallback.appendChild(input);

    const actions = document.createElement('div');
    actions.className = 'agentMockupActions';

    const errorEl = document.createElement('p');
    errorEl.className = 'agentMockupError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    actions.appendChild(errorEl);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'agentMockupSave';
    save.textContent = 'Save draft';
    actions.appendChild(save);
    fallback.appendChild(actions);

    function fail(message) {
        save.disabled = false;
        input.disabled = false;
        save.classList.remove('is-pending');
        save.textContent = 'Save draft';
        errorEl.textContent = message || 'Could not save. Try again.';
        errorEl.hidden = false;
    }

    // Save the pasted entry: empty/whitespace-only input is ignored (no write).
    // While the write is in flight the input and button are disabled; on success
    // the board refreshes (the realtime subscription moves the card to In
    // progress / drafted); on failure the controls re-enable and an error shows.
    save.addEventListener('click', function () {
        if (save.disabled) return;
        const text = (input.value || '').trim();
        if (!text) return;
        errorEl.hidden = true;
        errorEl.textContent = '';
        save.disabled = true;
        input.disabled = true;
        save.classList.add('is-pending');
        save.textContent = 'Saving…';
        Promise.resolve(listLogic.setAgentRunState(row.id, { draft: text, state: 'drafted' })).then(function (res) {
            if (res && res.ok) {
                refreshAgentQueue(getSelectedProjectName());
                return;
            }
            fail(res && res.error);
        }).catch(function () {
            fail('Could not save. Try again.');
        });
    });

    wrap.appendChild(fallback);
    return wrap;
}

export {
    mockupRepoLabel,
    mockupPathHint,
    buildMockupPrompt,
    buildMockupGenPrompt,
    parseMockupVariants,
    buildMockupEntryPrompt,
    mockupChatRepo,
    renderMockupPreviews,
    renderMockupTabs,
    openMockupOverlay,
    buildMockupSecondary,
};
