// ── MODELS PANEL ──
// One shared surface, two openers — the desktop gear dropdown and the mobile
// settings modal both call openModelsPanel(), the same one-panel-two-openers
// shape openSpendPanel() uses (own backdrop + modal appended to body, dismissed
// three ways through wireModalDismiss, read on open with no polling, focus
// restored to whatever opened it).
//
// What it edits is which model each pipeline workflow runs on. The Worker
// already resolves that per surface out of the `inject_targets` registry (a
// `models` jsonb plus `auto_merge_3p`, with a `repo: '*'` sentinel row holding
// the per-user global default); this panel is nothing more than that registry's
// read/write UI. Every call goes through the thin wrappers in inject.js, so the
// panel touches Supabase only through the Worker, never directly.
//
// Every request names the ACTIVE workspace repo — the sentinel row is a registry
// key, not an addressable target, and the Worker refuses a request that names
// it. One read on open returns the resolved view plus the raw per-scope layers,
// and the scope toggle is a view over that one response; writes name the same
// repo at both scopes and let `scope` choose the row.
import {
    fetchModelCatalog,
    fetchModelSettings,
    saveModelSetting,
    saveAutoMerge3p,
    showInjectToast,
} from './inject.js';
import { getActiveChatRepo } from './claudeSheet.js';
import { wireModalDismiss } from './modalDismiss.js';

// The pickable surfaces, in the order the matrix stacks them. GHOST is appended
// separately by buildModelRows because it is display-only — the model it runs on
// is pinned server-side and the row is not tappable.
//
// DEEP closes the pickable set, straight after CHAT: the composer's two send
// modes are two registry surfaces now, so the panel stacks them together rather
// than leaving deep-think as the one model the user can't see or change.
const MODEL_SURFACES = ['run', 'triage', 'derive', 'scan', 'chat', 'deep'];

// The dim right-hand note on a row, where the label alone doesn't say which of
// two neighbours a surface is. CHAT and DEEP are the composer's two send modes,
// and nothing about the words "CHAT" and "DEEP" says which one a Fast send uses.
const SURFACE_SUBLINES = { chat: 'fast sends', deep: 'deep sends' };

// The catalog lane a surface's picker filters on. The Worker validates a `deep`
// pick against the `chat` lane — deep-think is the chat route on a heavier
// model, not a route of its own — so the picker mirrors that mapping here and
// offers exactly the set a deep write would accept. Every other surface is its
// own lane.
const PICKER_LANE_ALIASES = { deep: 'chat' };

function pickerLaneFor(surface) {
    return PICKER_LANE_ALIASES[surface] || surface;
}

// The surfaces that bill to plan quota when they run on an Anthropic model.
// Only used when the catalog doesn't name its own `plan_lanes`; the Worker's
// list wins whenever it sends one, so a lane added server-side needs no release
// here.
const FALLBACK_PLAN_LANES = ['run', 'triage', 'derive'];

// Read the auto-merge flag out of a settings payload. The Worker's own key is
// `autoMerge3p`, but the registry column it comes from is `auto_merge_3p` and a
// route that forwards the row verbatim would spell it that way — so accept both
// rather than silently rendering the toggle off against a row that has it on.
export function readAutoMerge3p(settings) {
    if (!settings || typeof settings !== 'object') return false;
    if (typeof settings.autoMerge3p === 'boolean') return settings.autoMerge3p;
    if (typeof settings.auto_merge_3p === 'boolean') return settings.auto_merge_3p;
    return false;
}

// The raw layer one scope owns, out of the single models_get response:
// `{ models: { <surface>: <id> } }` carrying ONLY the keys explicitly set at
// that layer. Absence is the whole signal — it is what separates "pinned here"
// from "falling through from below", and the resolved `surfaces` map can't say
// it, because by then every layer has been flattened into one value per surface.
//
// The panel reads it for GLOBAL, where the alternative was a second request
// naming the registry's `'*'` sentinel — a row the Worker deliberately keeps out
// of its allowlist, so that request could only ever 400.
export function readScopeLayer(settings, scope) {
    const s = settings || {};
    const layer = (scope === 'global' ? s.global : s.repo_overrides) || {};
    const models = (layer.models && typeof layer.models === 'object') ? layer.models : {};
    return { models: models, autoMerge3p: readAutoMerge3p(layer) };
}

// The auto-merge flag as the showing scope owns it. REPO renders the resolved
// flag it always did; GLOBAL has to read its own layer, or a repo-level ON would
// show up as the global default.
export function readAutoMerge3pAtScope(settings, scope) {
    if (scope === 'global') return readScopeLayer(settings, 'global').autoMerge3p;
    return readAutoMerge3p(settings);
}

// The id an unconfigured surface actually runs on, out of the catalog's
// `defaults` map — `{ run, triage, derive, scan, chat }` → model id, mirroring
// the workflow hardcodes the Worker dispatches against. Read defensively: an
// older Worker sends no map at all, and every caller below degrades to the
// literal `default` text it used to print when this comes back ''.
function defaultIdFor(defaults, surface) {
    const map = (defaults && typeof defaults === 'object') ? defaults : {};
    const id = map[surface];
    return (typeof id === 'string') ? id.trim() : '';
}

// What one surface resolves to, as the two halves of a chip: `text` is the model
// id it runs on, and `tag` names the layer that id fell out of — '' when it is
// set at the scope on screen, 'global' or 'default' when it is falling through
// from below. The single place that question is answered, because the matrix,
// the picker's Inherit row, and the drafted card's chip all ask it and three
// copies would disagree the first time one of them changed.
//
// The `default` case is the whole reason it exists. An unconfigured surface used
// to render the word `default` twice over — once as the chip, once as the tag —
// which named the layer but never the model, so the panel couldn't tell you what
// RUN was about to run on. The tag still names the layer; the chip now names the
// id from `defaults`, and falls back to the old word when the Worker sends none.
export function resolveSurfaceChip(surface, settings, defaults, scope) {
    const fallbackId = defaultIdFor(defaults, surface);

    // GLOBAL reads its own raw layer, where presence of the key IS the pick —
    // the same split buildModelRows draws the matrix from, since the resolved
    // map at that scope carries whatever the repo layer won with.
    if (scope === 'global') {
        const pinned = readScopeLayer(settings, 'global').models[surface];
        if (typeof pinned === 'string' && pinned) return { text: pinned, tag: '' };
        return { text: fallbackId || 'default', tag: 'default' };
    }

    const entry = ((settings && settings.surfaces) || {})[surface] || {};
    const value = typeof entry.value === 'string' ? entry.value : '';
    const source = typeof entry.source === 'string' ? entry.source : '';
    // A `source` the Worker doesn't recognise degrades to 'default', which is
    // what an unset surface resolves to anyway.
    const tag = source === 'repo' ? '' : (source === 'global' ? 'global' : 'default');
    return { text: value || fallbackId || 'default', tag: tag };
}

function modelById(catalog, id) {
    const models = catalog && Array.isArray(catalog.models) ? catalog.models : [];
    for (let i = 0; i < models.length; i++) {
        if (models[i] && models[i].id === id) return models[i];
    }
    return null;
}

// Who bills for a model, straight off the catalog. Exported because the
// drafted-entry card's per-run picker has to answer the same question the
// matrix's `→ api` badge answers — "does this pick leave plan quota?" — and a
// second copy of the id → provider lookup would drift from the catalog the
// moment the Worker adds a model. An id the catalog doesn't know returns '',
// which every caller reads as "not demonstrably third-party" rather than
// guessing.
export function providerForModel(catalog, id) {
    const m = modelById(catalog, id);
    return (m && typeof m.provider === 'string') ? m.provider : '';
}

// The three ways a pick can be paid for, as the panel words them: metered
// against the Claude Code plan's quota, covered by the OpenCode Go
// subscription, or billed per token to the API account.
const BILLING_KINDS = ['plan', 'subscription', 'api'];

// Who pays for one catalog row. The panel's whole purple-vs-amber decision comes
// out of here, so it reads the catalog's own billing signals in a fixed order
// rather than asking who made the model:
//
//   1. The `go/` prefix, FIRST and unconditionally — a Go row carries a real
//      third-party provider AND a dollar cap in `quota`, so either later test
//      would misfile it (the same ordering constraint the spend math's zero-rate
//      branch carries).
//   2. An explicit `billing` on the row. Catalog shape is the Worker's to
//      define, so when it states who pays, nothing here second-guesses it.
//   3. A `quota` string. A model the plan meters by quota is on plan quota
//      whoever built it — this is the case the old `provider === 'anthropic'`
//      test got wrong, badging a Pro-plan-quota model like a per-token one and
//      telling the user their pick had left the plan when it hadn't.
//   4. Provider, last: Anthropic is on plan quota, anyone else bills per token.
//
// A row that says none of it returns '' rather than guessing, and every caller
// reads '' as "not demonstrably API billed" — an unknown model must not raise a
// billing alarm.
function billingOfCatalogRow(model) {
    if (!model || !model.id) return '';
    if (isOpencodeGoId(model.id)) return 'subscription';
    const stated = typeof model.billing === 'string' ? model.billing.trim().toLowerCase() : '';
    if (BILLING_KINDS.indexOf(stated) !== -1) return stated;
    if (model.quota) return 'plan';
    const provider = typeof model.provider === 'string' ? model.provider : '';
    if (provider === 'anthropic') return 'plan';
    return provider ? 'api' : '';
}

// Who pays for one model id — `'plan'`, `'subscription'`, `'api'`, or `''` when
// the catalog doesn't carry it. Exported because both halves of the panel ask
// it: the matrix's `→ api` badge ("does this pick leave plan quota?") and the
// picker's group split ("which heading does this row sit under?"). One answer
// for both, or the badge and the heading disagree about the same model.
//
// The `go/` prefix answers even for an id the catalog is missing — the prefix is
// the whole signal there, not a lookup.
export function billingForModel(catalog, id) {
    if (isOpencodeGoId(id)) return 'subscription';
    return billingOfCatalogRow(modelById(catalog, id));
}

function planLanesOf(catalog) {
    const lanes = catalog && Array.isArray(catalog.plan_lanes) ? catalog.plan_lanes : null;
    return (lanes && lanes.length) ? lanes : FALLBACK_PLAN_LANES;
}

// The panel's whole presentation decision, kept pure so the set-vs-inherited
// styling, the lane dot, and the "this pick leaves plan quota" badge can be
// asserted without mounting anything. Given the catalog, the one settings
// payload, and which scope is showing, produce one descriptor per matrix row.
//
// Each scope reads a different part of that one payload, because they are
// asking different questions:
//   • REPO asks "what does this workspace actually run on?" — the resolved
//     `surfaces` map, where a value counts as SET only when its `source` matches
//     the scope on screen. A `source: 'global'` value is inherited, not set: it
//     renders dim with a `global` tag, so "I changed this here" never reads the
//     same as "this is falling through from somewhere else".
//   • GLOBAL asks "what has been pinned as the default for every repo?" — the
//     raw `global.models` layer, where a surface is set iff its key is present.
//     Reading the resolved map at global scope would be wrong twice over: a
//     repo-level pick would show as the global default, and a surface set
//     globally to the same id a repo overrode would vanish.
//
// The `→ api` badge fires only on a PLAN-lane row whose model the catalog bills
// per token (`billingForModel` → `'api'`). That is exactly the case where the
// pick moves the run off plan quota and onto per-token API billing; a third-party
// model on a surface that never billed to plan quota costs the user nothing new,
// so badging it would be noise — and neither does a model the plan meters by
// quota, whoever built it.
export function buildModelRows(catalog, settings, scope) {
    const cat = catalog || {};
    const surfaces = (settings && settings.surfaces) || {};
    const globalModels = readScopeLayer(settings, 'global').models;
    const planLanes = planLanesOf(cat);
    const isGlobal = scope === 'global';
    const rows = [];

    for (let i = 0; i < MODEL_SURFACES.length; i++) {
        const surface = MODEL_SURFACES[i];
        const entry = surfaces[surface] || {};
        const resolved = typeof entry.value === 'string' ? entry.value : '';
        const pinned = typeof globalModels[surface] === 'string' ? globalModels[surface] : '';
        const isPlanLane = planLanes.indexOf(surface) !== -1;
        const value = isGlobal ? pinned : resolved;
        const billing = value ? billingForModel(cat, value) : '';
        // A dim chip is only half the story — the tag names WHERE the inherited
        // value came from, so global-set and never-set don't look identical, and
        // an empty tag is exactly "set at the scope on screen". At global scope
        // there is nothing below to fall through from but the workflow's own
        // hardcode, so unset always reads 'default' — and the chip beside it now
        // names the id that hardcode resolves to instead of repeating the word.
        const chip = resolveSurfaceChip(surface, settings, cat.defaults, scope);
        rows.push({
            surface: surface,
            label: surface.toUpperCase(),
            lane: isPlanLane ? 'plan' : 'other',
            chipText: chip.text,
            inherited: !!chip.tag,
            sourceTag: chip.tag,
            // Keyed on the id explicitly pinned at this layer, NOT on the chip's
            // text: a default-sourced row now names a real model, but nobody
            // picked it, so badging it would report a billing change that isn't
            // one.
            apiBadge: isPlanLane && billing === 'api',
            locked: false,
            subline: SURFACE_SUBLINES[surface] || '',
        });
    }

    // GHOST closes the matrix: pinned server-side, so it reports the catalog's
    // `ghost_model` and says why it can't be changed rather than offering a
    // picker that would fail on write.
    rows.push({
        surface: 'ghost',
        label: 'GHOST',
        lane: 'other',
        chipText: (cat.ghost_model && String(cat.ghost_model)) || 'default',
        inherited: true,
        sourceTag: '',
        apiBadge: false,
        locked: true,
        subline: 'locked server-side',
    });

    return rows;
}

// True for the OpenCode Go allowlist ids — the ones the Worker routes to a flat
// monthly subscription with dollar-capped quotas rather than per-token billing.
// The `go/` prefix is the whole signal, and it is deliberately a PREFIX test
// rather than a substring one: `algo/…` or a model whose name happens to
// contain `go` is not a Go row.
export function isOpencodeGoId(id) {
    return typeof id === 'string' && id.indexOf('go/') === 0;
}

// The label a Go row wears inside its own group. The header already says
// OPENCODE GO, so repeating the prefix on every row is noise — but only the
// DISPLAY drops it. The id written through saveModelSetting stays fully
// prefixed, exactly as the catalog serves it.
export function opencodeGoLabel(id) {
    return isOpencodeGoId(id) ? id.slice(3) : id;
}

// The picker's three groups for one surface, split by who pays — the split is
// `billingOfCatalogRow`'s, the same answer the matrix's `→ api` badge reads, so a
// model can never sit under PLAN QUOTA and wear the amber badge at once. PLAN
// QUOTA holds the plan-metered models allowlisted for the surface — Anthropic's
// and any third-party one the plan meters by quota — and hints each one's quota
// string verbatim from the catalog; OPENCODE GO holds the `go/`-prefixed
// subscription rows and hints THEIR quota the same way, since a Go pick is
// bounded by a per-model dollar cap rather than by its provider's price sheet;
// API BILLED holds the per-token ones and hints the provider instead. A model
// with no `lanes` is treated as allowlisted nowhere rather than everywhere — an
// unknown allowlist should narrow the menu, not widen it into picks the Worker
// would reject.
//
// A row the catalog says nothing billable about lands in PLAN QUOTA: it is
// already allowlisted for the lane, so the menu has to offer it somewhere, and
// filing an unknown under API BILLED would invent a per-token charge.
//
// The lane filtered on is `pickerLaneFor(surface)`, not the surface itself, so
// DEEP offers the `chat` lane the Worker validates a deep pick against.
export function buildPickerGroups(catalog, surface) {
    const models = (catalog && Array.isArray(catalog.models)) ? catalog.models : [];
    const lane = pickerLaneFor(surface);
    const plan = [];
    const go = [];
    const api = [];
    for (let i = 0; i < models.length; i++) {
        const m = models[i];
        if (!m || !m.id) continue;
        if (!Array.isArray(m.lanes) || m.lanes.indexOf(lane) === -1) continue;
        const billing = billingOfCatalogRow(m);
        if (billing === 'subscription') {
            go.push({ id: m.id, label: opencodeGoLabel(m.id), hint: m.quota ? String(m.quota) : '' });
        } else if (billing === 'api') {
            api.push({ id: m.id, hint: m.provider ? String(m.provider) : '' });
        } else {
            plan.push({ id: m.id, hint: m.quota ? String(m.quota) : '' });
        }
    }
    return { plan: plan, go: go, api: api };
}

function buildPickerGroupHeading(text, variant) {
    const heading = document.createElement('div');
    heading.className = 'modelsPickerHeading' + (variant ? ' modelsPickerHeading--' + variant : '');
    heading.textContent = text;
    return heading;
}

function buildPickerOption(opt) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'modelsPickerRow';
    el.setAttribute('aria-pressed', opt.checked ? 'true' : 'false');

    const check = document.createElement('span');
    check.className = 'modelsPickerCheck';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = opt.checked ? '✓' : '';
    el.appendChild(check);

    const label = document.createElement('span');
    label.className = 'modelsPickerLabel';
    label.textContent = opt.label;
    el.appendChild(label);

    const hint = document.createElement('span');
    hint.className = 'modelsPickerHint';
    hint.textContent = opt.hint || '';
    el.appendChild(hint);

    el.addEventListener('click', opt.onPick);
    return el;
}

// The rendered picker list for one surface — an Inherit row, then the lane
// groups from buildPickerGroups. Two surfaces render it: this panel's
// drill-in (scope-wide defaults) and the drafted-entry card's per-run popover
// in claudeSheet.js. It lives here once rather than twice because the two would
// otherwise drift on exactly the details that matter — which models are
// allowlisted for the lane, which group they land in, and how the amber
// "leaves plan" heading is worded.
//
// Pure in the sense that matters: it reads only its arguments and returns a
// detached element. `current` is the id currently pinned by whatever is calling
// (a scope's setting, or a card's override) — pass '' to mean "inheriting",
// which is what puts the ✓ on the Inherit row. `onPick` receives the picked
// model id, or null for Inherit.
export function buildPickerList(options) {
    const o = options || {};
    const surface = o.surface;
    const current = typeof o.current === 'string' ? o.current : '';
    const onPick = typeof o.onPick === 'function' ? o.onPick : function() {};
    const groups = buildPickerGroups(o.catalog, surface);

    const list = document.createElement('div');
    list.className = 'modelsPicker';

    // Inherit sits first and carries the ✓ when nothing is pinned, so "not set
    // here" is a state you can see and select rather than the absence of a
    // selection.
    list.appendChild(buildPickerOption({
        label: 'Inherit',
        hint: o.inheritHint || '',
        checked: !current,
        onPick: function() { onPick(null); },
    }));

    if (groups.plan.length) {
        list.appendChild(buildPickerGroupHeading('PLAN QUOTA', ''));
        for (let i = 0; i < groups.plan.length; i++) {
            const m = groups.plan[i];
            list.appendChild(buildPickerOption({
                label: m.id,
                hint: m.hint,
                checked: current === m.id,
                onPick: function() { onPick(m.id); },
            }));
        }
    }

    // Between the two: subscription is neither plan quota nor per-token, so it
    // sits between them and wears a dim heading rather than API BILLED's amber.
    // The heading names the coverage rather than a cap figure — the caps differ
    // per model and each row hints its own on the right, the way a plan row
    // hints its quota. Rows show the un-prefixed name; `m.id` — still prefixed —
    // is what gets picked and written.
    if (groups.go && groups.go.length) {
        list.appendChild(buildPickerGroupHeading(
            'OPENCODE GO · INCLUDED · CAPS VARY BY MODEL', 'go'));
        for (let g = 0; g < groups.go.length; g++) {
            const m = groups.go[g];
            list.appendChild(buildPickerOption({
                label: m.label,
                hint: m.hint,
                checked: current === m.id,
                onPick: function() { onPick(m.id); },
            }));
        }
    }

    if (groups.api.length) {
        list.appendChild(buildPickerGroupHeading('API BILLED · leaves plan, pays per token', 'api'));
        for (let j = 0; j < groups.api.length; j++) {
            const m = groups.api[j];
            list.appendChild(buildPickerOption({
                label: m.id,
                hint: m.hint,
                checked: current === m.id,
                onPick: function() { onPick(m.id); },
            }));
        }
    }

    return list;
}

// What tapping "Inherit" would resolve to, spelled out so the row is a real
// preview rather than a blank promise. When the surface is already inheriting,
// its resolved value IS the inherit value and we can name it. When it is set at
// this scope the underlying value isn't in the resolved map — but the global
// layer is in the same payload, and beneath that sits the workflow hardcode the
// catalog's `defaults` map names, so the row can still name a model rather than
// a layer. `entry.inherited` still wins when the Worker volunteers it.
//
// Global scope has only one layer beneath it, the workflow's own hardcode: it
// names that id straight from `defaults` and never reaches for the resolved map,
// whose value at that point is whatever the REPO layer won with. With no
// `defaults` from the Worker, both scopes fall back to naming the layer the way
// they always did.
export function describeInherit(settings, surface, scope, defaults) {
    const fallbackId = defaultIdFor(defaults, surface);
    if (scope === 'global') return fallbackId || 'workflow default';
    const entry = ((settings && settings.surfaces) || {})[surface] || {};
    const source = typeof entry.source === 'string' ? entry.source : '';
    if (typeof entry.inherited === 'string' && entry.inherited) return entry.inherited;
    if (source !== scope && typeof entry.value === 'string' && entry.value) return entry.value;
    const pinnedGlobal = readScopeLayer(settings, 'global').models[surface];
    if (typeof pinnedGlobal === 'string' && pinnedGlobal) return pinnedGlobal;
    return fallbackId || 'global setting';
}

// The id pinned AT the showing scope, or '' when the surface inherits there —
// the picker's notion of a current selection, and the same set-vs-inherited
// split buildModelRows draws the matrix chip from.
export function pinnedAtScope(settings, surface, scope) {
    if (scope === 'global') {
        const pinned = readScopeLayer(settings, 'global').models[surface];
        return typeof pinned === 'string' ? pinned : '';
    }
    const entry = ((settings && settings.surfaces) || {})[surface] || {};
    if (entry.source !== scope) return '';
    return typeof entry.value === 'string' ? entry.value : '';
}

// The short name the scope toggle labels its REPO half with — `owner/name` is
// too wide for a 36px segmented control and the owner never varies within a
// workspace anyway.
function shortRepoName(repo) {
    if (!repo) return 'repo';
    const slash = repo.lastIndexOf('/');
    return slash === -1 ? repo : repo.slice(slash + 1);
}

function spinnerInto(container, label) {
    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'modelsPanelLoading';
    const spinner = document.createElement('div');
    spinner.className = 'projRunSpinner modelsPanelSpinner';
    const text = document.createElement('div');
    text.className = 'modelsPanelLoadingLabel';
    text.textContent = label || 'Loading models…';
    wrap.appendChild(spinner);
    wrap.appendChild(text);
    container.appendChild(wrap);
}

// A failed read is stated, never absorbed. Rendering an empty matrix would read
// as "nothing is configured" — the opposite of "we couldn't find out" — and the
// rows it would show are every surface at its default.
function errorInto(container, message) {
    container.innerHTML = '';
    const err = document.createElement('div');
    err.className = 'modelsPanelError';
    err.textContent = message || 'Couldn’t load model settings';
    container.appendChild(err);
}

// Build and open the shared Models panel. `anchorEl` is whatever opened it and
// gets focus back on close.
export function openModelsPanel(anchorEl) {
    const prior = document.getElementById('modelsPanelBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    // The repo every write is attributed to. Read once at open — the panel does
    // not follow a workspace swap that happens behind it, which can't occur
    // while a modal is up.
    const activeRepo = getActiveChatRepo();

    let catalog = null;
    let settings = null;
    let scope = 'repo';
    let pickerSurface = null; // non-null while the body is drilled into a picker

    const backdrop = document.createElement('div');
    backdrop.id = 'modelsPanelBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'modelsPanelModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'modelsPanelTitleText');

    const header = document.createElement('div');
    header.id = 'modelsPanelHeader';

    // The picker drills the BODY rather than stacking a second modal, so the
    // back chevron lives in the header and is the only way out of a picker
    // short of dismissing the whole panel.
    const backBtn = document.createElement('button');
    backBtn.id = 'modelsPanelBack';
    backBtn.type = 'button';
    backBtn.setAttribute('aria-label', 'Back to all workflows');
    backBtn.textContent = '‹';
    backBtn.hidden = true;

    const title = document.createElement('div');
    title.id = 'modelsPanelTitle';
    const eyebrow = document.createElement('span');
    eyebrow.id = 'modelsPanelEyebrow';
    eyebrow.textContent = 'MODELS';
    const titleText = document.createElement('span');
    titleText.id = 'modelsPanelTitleText';
    titleText.textContent = 'Per-workflow';
    title.appendChild(eyebrow);
    title.appendChild(titleText);

    // Scope toggle — REPO shows fully resolved values for the active workspace,
    // GLOBAL shows the every-repo defaults layer, where "inherited" means the
    // workflow's own hardcoded default. Both come out of the one read, so
    // flipping is a repaint, not a refetch. Hidden inside a picker, where the
    // scope is fixed by whatever the matrix was showing when the row was tapped.
    const scopeToggle = document.createElement('div');
    scopeToggle.id = 'modelsPanelScope';
    scopeToggle.setAttribute('role', 'group');
    scopeToggle.setAttribute('aria-label', 'Settings scope');

    const repoSeg = document.createElement('button');
    repoSeg.type = 'button';
    repoSeg.className = 'modelsScopeSeg';
    repoSeg.textContent = shortRepoName(activeRepo);

    const globalSeg = document.createElement('button');
    globalSeg.type = 'button';
    globalSeg.className = 'modelsScopeSeg';
    globalSeg.textContent = 'GLOBAL';

    scopeToggle.appendChild(repoSeg);
    scopeToggle.appendChild(globalSeg);

    const closeX = document.createElement('button');
    closeX.id = 'modelsPanelClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close models');
    closeX.textContent = '×';

    header.appendChild(backBtn);
    header.appendChild(title);
    header.appendChild(scopeToggle);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'modelsPanelBody';

    dialog.appendChild(header);
    dialog.appendChild(body);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    const previouslyFocused = anchorEl || document.activeElement;
    closeX.focus();

    wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX],
        onClose: function() {
            if (previouslyFocused
                && typeof previouslyFocused.focus === 'function'
                && document.contains(previouslyFocused)) {
                try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
            }
        },
    });

    function isOpen() {
        return document.body.contains(backdrop);
    }

    function paintScopeToggle() {
        repoSeg.classList.toggle('modelsScopeSeg--on', scope === 'repo');
        globalSeg.classList.toggle('modelsScopeSeg--on', scope === 'global');
        repoSeg.setAttribute('aria-pressed', scope === 'repo' ? 'true' : 'false');
        globalSeg.setAttribute('aria-pressed', scope === 'global' ? 'true' : 'false');
    }

    function paintHeader() {
        const inPicker = !!pickerSurface;
        backBtn.hidden = !inPicker;
        scopeToggle.hidden = inPicker;
        titleText.textContent = inPicker ? pickerSurface.toUpperCase() : 'Per-workflow';
    }

    // ── MATRIX VIEW ──
    function render() {
        paintHeader();
        paintScopeToggle();
        if (!catalog || !settings) return; // load/error states own the body
        if (pickerSurface) renderPicker();
        else renderMatrix();
    }

    function renderMatrix() {
        body.innerHTML = '';
        const rows = buildModelRows(catalog, settings, scope);
        const matrix = document.createElement('div');
        matrix.className = 'modelsMatrix';

        for (let i = 0; i < rows.length; i++) {
            matrix.appendChild(buildMatrixRow(rows[i]));
        }
        body.appendChild(matrix);

        const divider = document.createElement('div');
        divider.className = 'modelsDivider';
        divider.setAttribute('role', 'separator');
        body.appendChild(divider);

        body.appendChild(buildAutoMergeRow());

        const legend = document.createElement('div');
        legend.className = 'modelsLegend';
        legend.textContent = 'Purple = plan quota · amber = API billed · dim = inherited';
        body.appendChild(legend);
    }

    function buildMatrixRow(row) {
        // A locked row is a plain div: it reports state and can't be actioned, so
        // giving it a button's affordances would promise a picker that isn't
        // there.
        const el = document.createElement(row.locked ? 'div' : 'button');
        el.className = 'modelsRow' + (row.locked ? ' modelsRow--locked' : '');
        if (!row.locked) {
            el.type = 'button';
            el.addEventListener('click', function() { openPicker(row.surface); });
        }

        const dot = document.createElement('span');
        dot.className = 'modelsRowDot modelsRowDot--' + row.lane;
        dot.setAttribute('aria-hidden', 'true');
        el.appendChild(dot);

        const label = document.createElement('span');
        label.className = 'modelsRowLabel';
        label.textContent = row.label;
        el.appendChild(label);

        const chipWrap = document.createElement('span');
        chipWrap.className = 'modelsRowChipWrap';
        const chip = document.createElement('span');
        chip.className = 'modelsRowChip' + (row.inherited ? ' modelsRowChip--inherited' : '');
        chip.textContent = row.chipText;
        chipWrap.appendChild(chip);
        if (row.sourceTag) {
            const tag = document.createElement('span');
            tag.className = 'modelsRowSource';
            tag.textContent = row.sourceTag;
            chipWrap.appendChild(tag);
        }
        if (row.apiBadge) {
            const badge = document.createElement('span');
            badge.className = 'modelsRowBadge';
            badge.textContent = '→ api';
            chipWrap.appendChild(badge);
        }
        el.appendChild(chipWrap);

        if (row.locked) {
            const lock = document.createElement('span');
            lock.className = 'modelsRowLock';
            lock.setAttribute('aria-hidden', 'true');
            lock.textContent = '🔒';
            el.appendChild(lock);
        }
        if (row.subline) {
            const sub = document.createElement('span');
            sub.className = 'modelsRowSubline';
            sub.textContent = row.subline;
            el.appendChild(sub);
        }
        return el;
    }

    function buildAutoMergeRow() {
        const on = readAutoMerge3pAtScope(settings, scope);
        const row = document.createElement('div');
        row.className = 'modelsAutoRow';

        const text = document.createElement('div');
        text.className = 'modelsAutoText';
        const label = document.createElement('div');
        label.className = 'modelsAutoLabel';
        label.textContent = 'AUTO-MERGE 3P SHIPS';
        const sub = document.createElement('div');
        sub.className = 'modelsAutoSub';
        sub.textContent = 'off: third-party runs open a PR and wait';
        text.appendChild(label);
        text.appendChild(sub);
        row.appendChild(text);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'modelsAutoToggle' + (on ? ' modelsAutoToggle--on' : '');
        toggle.textContent = on ? 'ON' : 'OFF';
        toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
        toggle.addEventListener('click', function() { commitAutoMerge(!on); });
        row.appendChild(toggle);

        return row;
    }

    // ── PICKER VIEW ──
    function openPicker(surface) {
        pickerSurface = surface;
        render();
    }

    function closePicker() {
        pickerSurface = null;
        render();
    }

    function renderPicker() {
        body.innerHTML = '';
        const surface = pickerSurface;

        // Same list the drafted-entry card's per-run popover renders, built by
        // the shared builder rather than a second copy of the grouping rules —
        // "pinned at this scope" is exactly the panel's notion of a current
        // value, so an inherited row passes '' and the Inherit option carries
        // the ✓.
        body.appendChild(buildPickerList({
            catalog: catalog,
            surface: surface,
            current: pinnedAtScope(settings, surface, scope),
            inheritHint: describeInherit(settings, surface, scope, catalog && catalog.defaults),
            onPick: function(model) { commitModel(surface, model); },
        }));

        // While third-party ships don't auto-merge, say so at the point of
        // choosing one — after the pick it's a surprise, before it it's a
        // known trade.
        const planLanes = planLanesOf(catalog);
        if (planLanes.indexOf(surface) !== -1 && !readAutoMerge3pAtScope(settings, scope)) {
            const note = document.createElement('div');
            note.className = 'modelsPickerNote';
            note.textContent = 'Non-Claude models open a PR; manual review and merge required.';
            body.appendChild(note);
        }
    }

    // ── WRITES ──
    // Both writes repaint optimistically and put the old value back if the
    // Worker refuses. The panel reads on open only, so a failed write left
    // unreverted would keep lying until the next open.
    //
    // Which part of the payload a write touches follows what its scope renders
    // from: REPO edits the resolved `surfaces` map, GLOBAL edits the raw
    // `global` layer. The repo is the ACTIVE workspace repo either way — `scope`
    // alone tells the Worker which registry row to land on, and naming the `'*'`
    // sentinel instead would be refused as off-allowlist.
    function applyPick(surface, model) {
        if (scope === 'global') {
            const models = globalLayer().models;
            const had = Object.prototype.hasOwnProperty.call(models, surface);
            const before = models[surface];
            // Absence IS inherit in the raw layer, so clearing deletes the key
            // rather than blanking it — a '' left behind would render as a set
            // pick with an empty id.
            if (model === null) delete models[surface];
            else models[surface] = model;
            return function() {
                if (had) models[surface] = before;
                else delete models[surface];
            };
        }
        const surfaces = settings.surfaces || (settings.surfaces = {});
        const before = surfaces[surface] ? Object.assign({}, surfaces[surface]) : undefined;
        surfaces[surface] = model === null
            ? { value: '', source: '' }
            : { value: model, source: scope };
        return function() {
            if (before === undefined) delete surfaces[surface];
            else surfaces[surface] = before;
        };
    }

    function applyAutoMerge(next) {
        const target = scope === 'global' ? globalLayer() : settings;
        const before = readAutoMerge3p(target);
        writeAutoMerge3p(target, next);
        return function() { writeAutoMerge3p(target, before); };
    }

    // The mutable `global` layer, created on demand so a Worker response that
    // predates the layered shape still edits somewhere the matrix reads back.
    function globalLayer() {
        const layer = settings.global || (settings.global = {});
        if (!layer.models || typeof layer.models !== 'object') layer.models = {};
        return layer;
    }

    function writeAutoMerge3p(target, value) {
        target.autoMerge3p = value;
        if ('auto_merge_3p' in target) target.auto_merge_3p = value;
    }

    function commitModel(surface, model) {
        const revert = applyPick(surface, model);
        closePicker();

        saveModelSetting({
            scope: scope,
            surface: surface,
            model: model,
            repo: activeRepo,
        }).then(function(res) {
            if (res && res.ok) return;
            revert();
            if (isOpen()) render();
            showInjectToast('Model not saved — ' + ((res && res.reason) || 'unknown error'), 'error');
        });
    }

    function commitAutoMerge(next) {
        const revert = applyAutoMerge(next);
        if (isOpen()) render();

        saveAutoMerge3p({ scope: scope, value: next, repo: activeRepo }).then(function(res) {
            if (res && res.ok) return;
            revert();
            if (isOpen()) render();
            showInjectToast('Auto-merge not saved — ' + ((res && res.reason) || 'unknown error'), 'error');
        });
    }

    // ── READS ──
    // Catalog and settings are fetched in parallel; the body stays on the
    // spinner until BOTH land, since a matrix drawn from one without the other
    // would have either no model ids or no lane/provider facts to style them by.
    //
    // ONE read, on open, naming the active workspace repo — it carries the
    // resolved view and both raw layers, so scope is a client-side view over the
    // one response rather than a second request. It used to re-read per scope
    // and name the registry's `'*'` sentinel for GLOBAL, which the Worker keeps
    // off its allowlist on purpose: the tab could only ever fail with "Target
    // not in allowlist".
    function load() {
        spinnerInto(body, 'Loading models…');
        return Promise.all([
            catalog ? Promise.resolve({ ok: true }) : fetchModelCatalog(),
            fetchModelSettings(activeRepo),
        ]).then(function(results) {
            if (!isOpen()) return; // dismissed before the reads landed
            const cat = results[0];
            const set = results[1];
            if (cat && cat.ok && !catalog) catalog = cat;
            if (!catalog) {
                errorInto(body, 'Couldn’t load models — ' + ((cat && cat.reason) || 'unknown error'));
                return;
            }
            if (!set || !set.ok) {
                errorInto(body, 'Couldn’t load model settings — ' + ((set && set.reason) || 'unknown error'));
                return;
            }
            settings = set;
            render();
        }, function() {
            if (!isOpen()) return;
            errorInto(body, 'Couldn’t load model settings');
        });
    }

    function switchScope(next) {
        if (scope === next) return;
        scope = next;
        pickerSurface = null;
        render();
    }

    backBtn.addEventListener('click', closePicker);
    repoSeg.addEventListener('click', function() { switchScope('repo'); });
    globalSeg.addEventListener('click', function() { switchScope('global'); });

    paintScopeToggle();
    paintHeader();
    load();
}
