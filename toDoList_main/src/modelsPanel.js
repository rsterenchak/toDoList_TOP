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
const MODEL_SURFACES = ['run', 'triage', 'derive', 'scan', 'chat'];

// The surfaces that bill to plan quota when they run on an Anthropic model.
// Only used when the catalog doesn't name its own `plan_lanes`; the Worker's
// list wins whenever it sends one, so a lane added server-side needs no release
// here.
const FALLBACK_PLAN_LANES = ['run', 'triage', 'derive'];

const GLOBAL_SCOPE_REPO = '*';

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

function planLanesOf(catalog) {
    const lanes = catalog && Array.isArray(catalog.plan_lanes) ? catalog.plan_lanes : null;
    return (lanes && lanes.length) ? lanes : FALLBACK_PLAN_LANES;
}

// The panel's whole presentation decision, kept pure so the set-vs-inherited
// styling, the lane dot, and the "this pick leaves plan quota" badge can be
// asserted without mounting anything. Given the catalog, one scope's settings,
// and which scope is showing, produce one descriptor per matrix row.
//
// The two rules worth stating outright, because both are easy to get subtly
// wrong and neither is visible in the DOM once rendered:
//   • A value counts as SET only when its `source` matches the scope on screen.
//     At repo scope a `source: 'global'` value is inherited, not set — it renders
//     dim with a `global` tag, so "I changed this here" never reads the same as
//     "this is falling through from somewhere else".
//   • The `→ api` badge fires only on a PLAN-lane row that resolved to a
//     non-Anthropic model. That is exactly the case where the pick moves the run
//     off plan quota and onto per-token API billing; a third-party model on a
//     surface that never billed to plan quota costs the user nothing new, so
//     badging it would be noise.
export function buildModelRows(catalog, settings, scope) {
    const cat = catalog || {};
    const surfaces = (settings && settings.surfaces) || {};
    const planLanes = planLanesOf(cat);
    const rows = [];

    for (let i = 0; i < MODEL_SURFACES.length; i++) {
        const surface = MODEL_SURFACES[i];
        const entry = surfaces[surface] || {};
        const value = typeof entry.value === 'string' ? entry.value : '';
        const source = typeof entry.source === 'string' ? entry.source : '';
        const isPlanLane = planLanes.indexOf(surface) !== -1;
        const setAtScope = source === scope;
        const model = value ? modelById(cat, value) : null;
        const provider = model && model.provider ? model.provider : '';
        rows.push({
            surface: surface,
            label: surface.toUpperCase(),
            lane: isPlanLane ? 'plan' : 'other',
            chipText: value || 'default',
            inherited: !setAtScope,
            // A dim chip is only half the story — the tag names WHERE the
            // inherited value came from, so global-set and never-set don't look
            // identical. A `source` the Worker doesn't recognise degrades to
            // 'default', which is what an unset surface resolves to anyway.
            sourceTag: setAtScope ? '' : (source === 'global' ? 'global' : 'default'),
            apiBadge: isPlanLane && !!provider && provider !== 'anthropic',
            locked: false,
            subline: '',
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

// The picker's two groups for one surface, split by who pays. PLAN QUOTA holds
// the Anthropic models allowlisted for the surface and hints each one's quota
// string verbatim from the catalog; API BILLED holds the third-party ones and
// hints the provider instead. A model with no `lanes` is treated as allowlisted
// nowhere rather than everywhere — an unknown allowlist should narrow the menu,
// not widen it into picks the Worker would reject.
export function buildPickerGroups(catalog, surface) {
    const models = (catalog && Array.isArray(catalog.models)) ? catalog.models : [];
    const plan = [];
    const api = [];
    for (let i = 0; i < models.length; i++) {
        const m = models[i];
        if (!m || !m.id) continue;
        if (!Array.isArray(m.lanes) || m.lanes.indexOf(surface) === -1) continue;
        if (m.provider === 'anthropic') {
            plan.push({ id: m.id, hint: m.quota ? String(m.quota) : '' });
        } else {
            api.push({ id: m.id, hint: m.provider ? String(m.provider) : '' });
        }
    }
    return { plan: plan, api: api };
}

function buildPickerGroupHeading(text, isApi) {
    const heading = document.createElement('div');
    heading.className = 'modelsPickerHeading' + (isApi ? ' modelsPickerHeading--api' : '');
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

// The rendered picker list for one surface — an Inherit row, then the two
// lane groups from buildPickerGroups. Two surfaces render it: this panel's
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
        list.appendChild(buildPickerGroupHeading('PLAN QUOTA', false));
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

    if (groups.api.length) {
        list.appendChild(buildPickerGroupHeading('API BILLED · leaves plan, pays per token', true));
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
// this scope the underlying value isn't in the payload, so name the layer
// instead of guessing a model id — unless the Worker volunteered one on the
// entry's `inherited` field, which is read defensively for exactly that case.
export function describeInherit(settings, surface, scope) {
    const entry = ((settings && settings.surfaces) || {})[surface] || {};
    const source = typeof entry.source === 'string' ? entry.source : '';
    if (typeof entry.inherited === 'string' && entry.inherited) return entry.inherited;
    if (source !== scope && typeof entry.value === 'string' && entry.value) return entry.value;
    return scope === 'repo' ? 'global setting' : 'workflow default';
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
    // GLOBAL shows the `*` sentinel row where "inherited" means the workflow's
    // own hardcoded default. Hidden inside a picker, where the scope is fixed by
    // whatever the matrix was showing when the row was tapped.
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
        const on = readAutoMerge3p(settings);
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
        const entry = ((settings && settings.surfaces) || {})[surface] || {};
        const resolved = typeof entry.value === 'string' ? entry.value : '';
        const setAtScope = entry.source === scope;

        // Same list the drafted-entry card's per-run popover renders, built by
        // the shared builder rather than a second copy of the grouping rules —
        // "pinned at this scope" is exactly the panel's notion of a current
        // value, so an inherited row passes '' and the Inherit option carries
        // the ✓.
        body.appendChild(buildPickerList({
            catalog: catalog,
            surface: surface,
            current: setAtScope ? resolved : '',
            inheritHint: describeInherit(settings, surface, scope),
            onPick: function(model) { commitModel(surface, model); },
        }));

        // While third-party ships don't auto-merge, say so at the point of
        // choosing one — after the pick it's a surprise, before it it's a
        // known trade.
        const planLanes = planLanesOf(catalog);
        if (planLanes.indexOf(surface) !== -1 && !readAutoMerge3p(settings)) {
            const note = document.createElement('div');
            note.className = 'modelsPickerNote';
            note.textContent = 'third-party picks open a PR and wait for manual merge';
            body.appendChild(note);
        }
    }

    // ── WRITES ──
    // Both writes repaint optimistically and put the old value back if the
    // Worker refuses. The panel reads on open only, so a failed write left
    // unreverted would keep lying until the next open.
    function commitModel(surface, model) {
        const surfaces = settings.surfaces || (settings.surfaces = {});
        const before = surfaces[surface] ? Object.assign({}, surfaces[surface]) : undefined;
        surfaces[surface] = model === null
            ? { value: '', source: '' }
            : { value: model, source: scope };
        closePicker();

        saveModelSetting({
            scope: scope,
            surface: surface,
            model: model,
            repo: activeRepo,
        }).then(function(res) {
            if (res && res.ok) return;
            if (before === undefined) delete surfaces[surface];
            else surfaces[surface] = before;
            if (isOpen()) render();
            showInjectToast('Model not saved — ' + ((res && res.reason) || 'unknown error'), 'error');
        });
    }

    function commitAutoMerge(next) {
        const before = readAutoMerge3p(settings);
        settings.autoMerge3p = next;
        if ('auto_merge_3p' in settings) settings.auto_merge_3p = next;
        if (isOpen()) render();

        saveAutoMerge3p({ scope: scope, value: next, repo: activeRepo }).then(function(res) {
            if (res && res.ok) return;
            settings.autoMerge3p = before;
            if ('auto_merge_3p' in settings) settings.auto_merge_3p = before;
            if (isOpen()) render();
            showInjectToast('Auto-merge not saved — ' + ((res && res.reason) || 'unknown error'), 'error');
        });
    }

    // ── READS ──
    // Catalog and settings are fetched in parallel; the body stays on the
    // spinner until BOTH land, since a matrix drawn from one without the other
    // would have either no model ids or no lane/provider facts to style them by.
    function loadScope(repoForScope) {
        spinnerInto(body, 'Loading models…');
        return Promise.all([
            catalog ? Promise.resolve({ ok: true }) : fetchModelCatalog(),
            fetchModelSettings(repoForScope),
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
        settings = null;
        paintScopeToggle();
        paintHeader();
        loadScope(next === 'global' ? GLOBAL_SCOPE_REPO : activeRepo);
    }

    backBtn.addEventListener('click', closePicker);
    repoSeg.addEventListener('click', function() { switchScope('repo'); });
    globalSeg.addEventListener('click', function() { switchScope('global'); });

    paintScopeToggle();
    paintHeader();
    loadScope(activeRepo);
}
