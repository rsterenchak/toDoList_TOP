// Tests for the Models panel — the read/write UI over the Worker's per-surface
// model registry. Two halves:
//   • The pure presentation helpers (buildModelRows / buildPickerGroups /
//     describeInherit / readAutoMerge3p), which decide set-vs-inherited styling,
//     lane dots, and the "this pick leaves plan quota" badge. None of that is
//     recoverable from the DOM after render, so it is pinned directly.
//   • The panel itself: parallel read on open behind one spinner, an inline
//     error instead of a fake-empty matrix, the in-place picker drill, and the
//     optimistic-write-with-revert contract on both writes.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const fetchModelCatalog = vi.fn();
const fetchModelSettings = vi.fn();
const saveModelSetting = vi.fn();
const saveAutoMerge3p = vi.fn();
const showInjectToast = vi.fn();
let activeRepo = 'rsterenchak/toDoList_TOP';

// inject.js reaches the network and drags supabaseClient in behind it; claudeSheet
// is the whole assistant sheet. The panel only needs four calls and one repo
// getter from them, so both are stubbed down to exactly that.
vi.mock('../src/inject.js', () => ({
    fetchModelCatalog: (...args) => fetchModelCatalog(...args),
    fetchModelSettings: (...args) => fetchModelSettings(...args),
    saveModelSetting: (...args) => saveModelSetting(...args),
    saveAutoMerge3p: (...args) => saveAutoMerge3p(...args),
    showInjectToast: (...args) => showInjectToast(...args),
}));
vi.mock('../src/claudeSheet.js', () => ({
    getActiveChatRepo: () => activeRepo,
}));

const {
    openModelsPanel,
    buildModelRows,
    buildPickerGroups,
    describeInherit,
    readAutoMerge3p,
    readAutoMerge3pAtScope,
    pinnedAtScope,
    resolveSurfaceChip,
} = await import('../src/modelsPanel.js');

const CATALOG = {
    ok: true,
    models: [
        { id: 'claude-opus-4-8', provider: 'anthropic', lanes: ['run', 'triage', 'derive'], quota: '5×/day' },
        { id: 'claude-sonnet-5', provider: 'anthropic', lanes: ['run', 'triage', 'derive', 'scan', 'chat'], quota: '40×/day' },
        { id: 'gpt-5-codex', provider: 'openai', lanes: ['run', 'chat'] },
        { id: 'ghost-only', provider: 'anthropic', lanes: ['ghost'], quota: 'n/a' },
    ],
    plan_lanes: ['run', 'triage', 'derive'],
    ghost_model: 'claude-haiku-4-5',
};

// The same catalog as it arrives from a Worker that publishes the `defaults`
// map — each surface paired with the id its workflow hardcode resolves to. The
// bare CATALOG above deliberately keeps no map, so every assertion written
// against it also pins the older-Worker fallback to the literal `default` text.
const CATALOG_WITH_DEFAULTS = Object.assign({}, CATALOG, {
    defaults: {
        run: 'claude-opus-5',
        triage: 'claude-haiku-4-5',
        derive: 'claude-sonnet-5',
        scan: 'claude-haiku-4-5',
        chat: 'claude-sonnet-5',
        deep: 'claude-opus-5',
    },
});

// One payload, three parts: the resolved view the REPO tab renders, plus the raw
// per-scope layers the Worker sends alongside it — `global` carrying only what
// is pinned for every repo, `repo_overrides` only what this workspace pinned.
// The resolved map above is exactly those two flattened together.
function settingsFixture(overrides) {
    return Object.assign({
        ok: true,
        surfaces: {
            run: { value: 'claude-opus-4-8', source: 'repo' },
            triage: { value: 'claude-sonnet-5', source: 'global' },
            derive: { value: '', source: 'default' },
            scan: { value: 'claude-sonnet-5', source: 'global' },
            chat: { value: 'claude-sonnet-5', source: 'repo' },
        },
        global: {
            models: { triage: 'claude-sonnet-5', scan: 'claude-sonnet-5' },
            autoMerge3p: false,
        },
        repo_overrides: {
            models: { run: 'claude-opus-4-8', chat: 'claude-sonnet-5' },
            autoMerge3p: false,
        },
        autoMerge3p: false,
    }, overrides || {});
}

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function rowBySurface(surface) {
    const labels = [...document.querySelectorAll('.modelsRow')];
    return labels.find((el) => el.querySelector('.modelsRowLabel').textContent === surface.toUpperCase());
}

async function openPanel() {
    openModelsPanel(null);
    await flush();
}

describe('models panel — row presentation (pure)', () => {
    it('marks a value set at the showing scope as set, and one from another layer as inherited', () => {
        const rows = buildModelRows(CATALOG, settingsFixture(), 'repo');
        const run = rows.find((r) => r.surface === 'run');
        const triage = rows.find((r) => r.surface === 'triage');

        expect(run.inherited).toBe(false);
        expect(run.sourceTag).toBe('');
        expect(run.chipText).toBe('claude-opus-4-8');

        // Set globally, viewed at repo scope — inherited here, and the tag says
        // which layer it fell through from.
        expect(triage.inherited).toBe(true);
        expect(triage.sourceTag).toBe('global');
    });

    it('renders the global scope from the raw global layer, not the resolved view', () => {
        // Same payload, different scope. `run` is pinned for THIS repo only, so
        // at global scope it is unset — and it must not borrow the repo's id,
        // which is what made the global tab look like it held picks it never had.
        const rows = buildModelRows(CATALOG, settingsFixture(), 'global');
        const run = rows.find((r) => r.surface === 'run');
        expect(run.inherited).toBe(true);
        expect(run.chipText).toBe('default');
        expect(run.sourceTag).toBe('default');

        // `triage` IS in the global layer, so it reads as set at this scope with
        // no source tag — there is no layer below global to inherit from.
        const triage = rows.find((r) => r.surface === 'triage');
        expect(triage.inherited).toBe(false);
        expect(triage.sourceTag).toBe('');
        expect(triage.chipText).toBe('claude-sonnet-5');
    });

    it('badges a third-party model pinned globally on a plan lane', () => {
        const rows = buildModelRows(CATALOG, settingsFixture({
            global: { models: { run: 'gpt-5-codex', chat: 'gpt-5-codex' } },
        }), 'global');
        expect(rows.find((r) => r.surface === 'run').apiBadge).toBe(true);
        expect(rows.find((r) => r.surface === 'run').chipText).toBe('gpt-5-codex');
        // Not a plan lane — nothing leaves plan quota, so no badge.
        expect(rows.find((r) => r.surface === 'chat').apiBadge).toBe(false);
    });

    it('shows every global surface as default when the payload carries no layer', () => {
        // A response that predates the layered shape must read as "nothing is
        // pinned globally" rather than falling back to the repo's values.
        const flat = settingsFixture();
        delete flat.global;
        const rows = buildModelRows(CATALOG, flat, 'global');
        const set = rows.filter((r) => !r.locked && !r.inherited);
        expect(set).toEqual([]);
        expect(rows.find((r) => r.surface === 'run').chipText).toBe('default');
    });

    it('reads the auto-merge flag from the layer the showing scope owns', () => {
        const settings = settingsFixture({
            autoMerge3p: true,
            global: { models: {}, auto_merge_3p: false },
        });
        expect(readAutoMerge3pAtScope(settings, 'repo')).toBe(true);
        expect(readAutoMerge3pAtScope(settings, 'global')).toBe(false);
        // Alternate key spelling, same as the resolved payload's.
        expect(readAutoMerge3pAtScope(settingsFixture({
            global: { models: {}, auto_merge_3p: true },
        }), 'global')).toBe(true);
    });

    it('reports what is pinned at each scope, and nothing where a scope inherits', () => {
        const settings = settingsFixture();
        expect(pinnedAtScope(settings, 'run', 'repo')).toBe('claude-opus-4-8');
        expect(pinnedAtScope(settings, 'run', 'global')).toBe('');
        expect(pinnedAtScope(settings, 'triage', 'repo')).toBe('');
        expect(pinnedAtScope(settings, 'triage', 'global')).toBe('claude-sonnet-5');
    });

    it('tags a never-set surface as default and shows a default chip', () => {
        const rows = buildModelRows(CATALOG, settingsFixture(), 'repo');
        const derive = rows.find((r) => r.surface === 'derive');
        expect(derive.inherited).toBe(true);
        expect(derive.sourceTag).toBe('default');
        expect(derive.chipText).toBe('default');
    });

    it('shows what default resolves to on a never-set surface, keeping the default tag', () => {
        const rows = buildModelRows(CATALOG_WITH_DEFAULTS, settingsFixture(), 'repo');
        const derive = rows.find((r) => r.surface === 'derive');
        // Dim and still tagged `default` — only the chip text changes, so
        // "inherited" never starts reading like "set here".
        expect(derive.chipText).toBe('claude-sonnet-5');
        expect(derive.sourceTag).toBe('default');
        expect(derive.inherited).toBe(true);
        // Set-at-scope and global-sourced rows are untouched by the map.
        const run = rows.find((r) => r.surface === 'run');
        expect(run.chipText).toBe('claude-opus-4-8');
        expect(run.sourceTag).toBe('');
        const triage = rows.find((r) => r.surface === 'triage');
        expect(triage.chipText).toBe('claude-sonnet-5');
        expect(triage.sourceTag).toBe('global');
        // GHOST is pinned server-side and reports the catalog's own model.
        expect(rows[rows.length - 1].chipText).toBe('claude-haiku-4-5');
    });

    it('shows what default resolves to for an unpinned surface at global scope too', () => {
        const rows = buildModelRows(CATALOG_WITH_DEFAULTS, settingsFixture(), 'global');
        const run = rows.find((r) => r.surface === 'run');
        expect(run.chipText).toBe('claude-opus-5');
        expect(run.sourceTag).toBe('default');
        expect(run.inherited).toBe(true);
    });

    it('does not badge a plan-lane row just because its default resolves third-party', () => {
        // Nobody picked this — reporting "→ api" would announce a billing change
        // the user never made.
        const thirdPartyDefault = Object.assign({}, CATALOG, {
            defaults: { derive: 'gpt-5-codex' },
        });
        const rows = buildModelRows(thirdPartyDefault, settingsFixture(), 'repo');
        const derive = rows.find((r) => r.surface === 'derive');
        expect(derive.chipText).toBe('gpt-5-codex');
        expect(derive.apiBadge).toBe(false);
    });

    it('dots plan-lane surfaces purple and the rest amber, per the catalog', () => {
        const rows = buildModelRows(CATALOG, settingsFixture(), 'repo');
        expect(rows.find((r) => r.surface === 'run').lane).toBe('plan');
        expect(rows.find((r) => r.surface === 'derive').lane).toBe('plan');
        expect(rows.find((r) => r.surface === 'scan').lane).toBe('other');
        expect(rows.find((r) => r.surface === 'chat').lane).toBe('other');
    });

    it('falls back to run/triage/derive when the catalog names no plan lanes', () => {
        const noLanes = Object.assign({}, CATALOG, { plan_lanes: [] });
        const rows = buildModelRows(noLanes, settingsFixture(), 'repo');
        expect(rows.find((r) => r.surface === 'triage').lane).toBe('plan');
        expect(rows.find((r) => r.surface === 'scan').lane).toBe('other');
    });

    it('badges a plan-lane row that resolved to a third-party model, and only that', () => {
        const rows = buildModelRows(CATALOG, settingsFixture({
            surfaces: {
                // plan lane + third-party → the pick moves the run onto API billing
                run: { value: 'gpt-5-codex', source: 'repo' },
                // plan lane + anthropic → still on plan quota
                triage: { value: 'claude-opus-4-8', source: 'repo' },
                // NOT a plan lane + third-party → nothing left plan quota, so no badge
                chat: { value: 'gpt-5-codex', source: 'repo' },
            },
        }), 'repo');
        expect(rows.find((r) => r.surface === 'run').apiBadge).toBe(true);
        expect(rows.find((r) => r.surface === 'triage').apiBadge).toBe(false);
        expect(rows.find((r) => r.surface === 'chat').apiBadge).toBe(false);
    });

    it('stacks DEEP between CHAT and GHOST, pickable and on the non-plan lane', () => {
        const rows = buildModelRows(CATALOG, settingsFixture(), 'repo');
        const order = rows.map((r) => r.surface);
        expect(order).toEqual(['run', 'triage', 'derive', 'scan', 'chat', 'deep', 'ghost']);
        const deep = rows.find((r) => r.surface === 'deep');
        // Not in plan_lanes, so the existing dot logic amber-dots it for free —
        // and it is a real row, not the locked display-only shape GHOST uses.
        expect(deep.lane).toBe('other');
        expect(deep.locked).toBe(false);
        expect(deep.label).toBe('DEEP');
    });

    it('names which send mode each of CHAT and DEEP serves', () => {
        const rows = buildModelRows(CATALOG, settingsFixture(), 'repo');
        expect(rows.find((r) => r.surface === 'chat').subline).toBe('fast sends');
        expect(rows.find((r) => r.surface === 'deep').subline).toBe('deep sends');
        // Every other pickable row stays quiet — the note exists to separate two
        // neighbours, not to annotate the matrix.
        expect(rows.find((r) => r.surface === 'run').subline).toBe('');
    });

    it('names the deep default by id, the same way every other row does', () => {
        const rows = buildModelRows(CATALOG_WITH_DEFAULTS, settingsFixture(), 'repo');
        const deep = rows.find((r) => r.surface === 'deep');
        expect(deep.chipText).toBe('claude-opus-5');
        expect(deep.sourceTag).toBe('default');
        expect(deep.inherited).toBe(true);
    });

    it('reports a deep pick set at the showing scope as set', () => {
        const rows = buildModelRows(CATALOG_WITH_DEFAULTS, settingsFixture({
            surfaces: { deep: { value: 'claude-sonnet-5', source: 'repo' } },
        }), 'repo');
        const deep = rows.find((r) => r.surface === 'deep');
        expect(deep.chipText).toBe('claude-sonnet-5');
        expect(deep.sourceTag).toBe('');
        expect(deep.inherited).toBe(false);
    });

    it('closes the matrix with a locked ghost row carrying the catalog model', () => {
        const rows = buildModelRows(CATALOG, settingsFixture(), 'repo');
        const ghost = rows[rows.length - 1];
        expect(ghost.surface).toBe('ghost');
        expect(ghost.locked).toBe(true);
        expect(ghost.chipText).toBe('claude-haiku-4-5');
        expect(ghost.subline).toBe('locked server-side');
        expect(rows.filter((r) => r.locked)).toHaveLength(1);
    });

    it('reads the auto-merge flag under either key spelling', () => {
        expect(readAutoMerge3p({ autoMerge3p: true })).toBe(true);
        expect(readAutoMerge3p({ auto_merge_3p: true })).toBe(true);
        expect(readAutoMerge3p({})).toBe(false);
        expect(readAutoMerge3p(null)).toBe(false);
    });
});

describe('models panel — picker groups (pure)', () => {
    it('splits allowlisted models by who pays and hints each group differently', () => {
        const groups = buildPickerGroups(CATALOG, 'run');
        expect(groups.plan.map((m) => m.id)).toEqual(['claude-opus-4-8', 'claude-sonnet-5']);
        expect(groups.plan[0].hint).toBe('5×/day');
        expect(groups.api.map((m) => m.id)).toEqual(['gpt-5-codex']);
        expect(groups.api[0].hint).toBe('openai');
    });

    it('offers only models allowlisted for the surface', () => {
        const groups = buildPickerGroups(CATALOG, 'scan');
        expect(groups.plan.map((m) => m.id)).toEqual(['claude-sonnet-5']);
        expect(groups.api).toEqual([]);
    });

    it('offers DEEP exactly the chat lane, mirroring how the Worker validates it', () => {
        const deep = buildPickerGroups(CATALOG, 'deep');
        const chat = buildPickerGroups(CATALOG, 'chat');
        expect(deep.plan.map((m) => m.id)).toEqual(chat.plan.map((m) => m.id));
        expect(deep.api.map((m) => m.id)).toEqual(chat.api.map((m) => m.id));
        // Concretely: the chat-lane models, and nothing allowlisted only elsewhere.
        expect(deep.plan.map((m) => m.id)).toEqual(['claude-sonnet-5']);
        expect(deep.api.map((m) => m.id)).toEqual(['gpt-5-codex']);
    });

    it('treats a model with no lanes as allowlisted nowhere', () => {
        const groups = buildPickerGroups({ models: [{ id: 'mystery', provider: 'anthropic' }] }, 'run');
        expect(groups.plan).toEqual([]);
        expect(groups.api).toEqual([]);
    });

    it('describes what Inherit would resolve to at each scope', () => {
        const settings = settingsFixture();
        // Currently inheriting → its resolved value IS the inherit value.
        expect(describeInherit(settings, 'triage', 'repo')).toBe('claude-sonnet-5');
        // Pinned at this scope → name the layer rather than guess a model id.
        expect(describeInherit(settings, 'run', 'repo')).toBe('global setting');
        expect(describeInherit(settings, 'triage', 'global')).toBe('workflow default');
        // Global sits above only the workflow hardcode — a repo-level pick is
        // NOT what tapping Inherit there would fall back to.
        expect(describeInherit(settings, 'run', 'global')).toBe('workflow default');
    });

    it('names the workflow default by id at global scope once the Worker publishes one', () => {
        const settings = settingsFixture();
        const defaults = CATALOG_WITH_DEFAULTS.defaults;
        // Global sits above nothing but the hardcode, and the hardcode now has
        // a name — "workflow default" was a layer, this is the model.
        expect(describeInherit(settings, 'triage', 'global', defaults)).toBe('claude-haiku-4-5');
        expect(describeInherit(settings, 'run', 'global', defaults)).toBe('claude-opus-5');
    });

    it('names the global row at repo scope, and the workflow default when the global row is empty', () => {
        const defaults = CATALOG_WITH_DEFAULTS.defaults;
        // `chat` is pinned at repo scope, so its underlying value isn't in the
        // resolved map — but the global layer in the same payload has one.
        const withGlobalChat = settingsFixture({
            global: { models: { chat: 'claude-sonnet-5' }, autoMerge3p: false },
        });
        expect(describeInherit(withGlobalChat, 'chat', 'repo', defaults)).toBe('claude-sonnet-5');
        // `run` is pinned at repo scope and the global layer has nothing for it,
        // so the next layer down is the workflow default.
        expect(describeInherit(settingsFixture(), 'run', 'repo', defaults)).toBe('claude-opus-5');
    });
});

// The single answer to "what does this surface resolve to", shared by the
// matrix, the picker's Inherit row, and the drafted card's chip.
describe('models panel — resolveSurfaceChip (pure)', () => {
    const DEFAULTS = CATALOG_WITH_DEFAULTS.defaults;

    it('reports a repo-set surface bright, with no tag', () => {
        const chip = resolveSurfaceChip('run', settingsFixture(), DEFAULTS, 'repo');
        expect(chip).toEqual({ text: 'claude-opus-4-8', tag: '' });
    });

    it('reports a global-sourced surface by its id, tagged global', () => {
        const chip = resolveSurfaceChip('triage', settingsFixture(), DEFAULTS, 'repo');
        expect(chip).toEqual({ text: 'claude-sonnet-5', tag: 'global' });
    });

    it('names the workflow default by id on a default-sourced surface, still tagged default', () => {
        // The whole point: the tag keeps naming the LAYER, the chip stops
        // repeating it and names the MODEL that layer resolves to.
        const chip = resolveSurfaceChip('derive', settingsFixture(), DEFAULTS, 'repo');
        expect(chip).toEqual({ text: 'claude-sonnet-5', tag: 'default' });
    });

    it('falls back to the literal word when the Worker publishes no defaults map', () => {
        expect(resolveSurfaceChip('derive', settingsFixture(), undefined, 'repo'))
            .toEqual({ text: 'default', tag: 'default' });
        // A map that simply has no entry for this surface reads the same way.
        expect(resolveSurfaceChip('derive', settingsFixture(), { run: 'claude-opus-5' }, 'repo'))
            .toEqual({ text: 'default', tag: 'default' });
    });

    it('reads the raw global layer at global scope, not the resolved map', () => {
        const settings = settingsFixture();
        // Pinned globally → the id, set-at-scope.
        expect(resolveSurfaceChip('triage', settings, DEFAULTS, 'global'))
            .toEqual({ text: 'claude-sonnet-5', tag: '' });
        // `run` is a REPO pick — at global scope that is not a global default,
        // so it reads as the workflow default it would fall through to.
        expect(resolveSurfaceChip('run', settings, DEFAULTS, 'global'))
            .toEqual({ text: 'claude-opus-5', tag: 'default' });
    });
});

describe('models panel — panel behaviour', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        activeRepo = 'rsterenchak/toDoList_TOP';
        fetchModelCatalog.mockReset().mockResolvedValue(CATALOG);
        fetchModelSettings.mockReset().mockResolvedValue(settingsFixture());
        saveModelSetting.mockReset().mockResolvedValue({ ok: true });
        saveAutoMerge3p.mockReset().mockResolvedValue({ ok: true });
        showInjectToast.mockReset();
    });

    afterEach(() => {
        document.body.innerHTML = '';
    });

    it('shows one spinner until both reads land, then renders the matrix', async () => {
        let releaseSettings;
        fetchModelSettings.mockReturnValue(new Promise((resolve) => { releaseSettings = resolve; }));

        openModelsPanel(null);
        await flush();
        // Catalog is back but settings are not — a matrix drawn now would have no
        // values to show, so the spinner stays.
        expect(document.querySelector('.modelsPanelSpinner')).toBeTruthy();
        expect(document.querySelector('.modelsMatrix')).toBeFalsy();

        releaseSettings(settingsFixture());
        await flush();
        expect(document.querySelector('.modelsPanelSpinner')).toBeFalsy();
        expect(document.querySelector('.modelsMatrix')).toBeTruthy();
    });

    it('renders every surface plus ghost, reading the active repo for the scope toggle', async () => {
        await openPanel();
        const labels = [...document.querySelectorAll('.modelsRowLabel')].map((el) => el.textContent);
        expect(labels).toEqual(['RUN', 'TRIAGE', 'DERIVE', 'SCAN', 'CHAT', 'DEEP', 'GHOST']);
        expect(fetchModelSettings).toHaveBeenCalledWith('rsterenchak/toDoList_TOP');
        // The REPO half is labelled with the workspace's short name, not owner/name.
        expect(document.querySelectorAll('.modelsScopeSeg')[0].textContent).toBe('toDoList_TOP');
        expect(document.getElementById('modelsPanelEyebrow').textContent).toBe('MODELS');
    });

    it('surfaces a failed read inline rather than an empty matrix', async () => {
        fetchModelSettings.mockResolvedValue({ ok: false, reason: '503 Server error' });
        await openPanel();
        expect(document.querySelector('.modelsMatrix')).toBeFalsy();
        const err = document.querySelector('.modelsPanelError');
        expect(err).toBeTruthy();
        expect(err.textContent).toContain('503 Server error');
    });

    // Regression: the scope toggle used to re-read with the registry's `'*'`
    // sentinel, a row the Worker deliberately keeps off its allowlist — so the
    // GLOBAL tab always came back "Target not in allowlist (400)". One read now
    // carries both layers and the toggle is a repaint over it.
    it('serves both scopes from one read that always names the active repo', async () => {
        await openPanel();
        document.querySelectorAll('.modelsScopeSeg')[1].click();
        await flush();

        expect(fetchModelSettings).toHaveBeenCalledTimes(1);
        expect(fetchModelSettings).toHaveBeenCalledWith('rsterenchak/toDoList_TOP');
        expect(fetchModelSettings).not.toHaveBeenCalledWith('*');
        // The catalog is scope-independent, so switching must not re-fetch it.
        expect(fetchModelCatalog).toHaveBeenCalledTimes(1);

        // And the tab renders — the global layer, not the repo's resolved values.
        expect(document.querySelector('.modelsPanelError')).toBeFalsy();
        expect(document.querySelector('.modelsMatrix')).toBeTruthy();
        expect(rowBySurface('run').querySelector('.modelsRowChip').textContent).toBe('default');
        expect(rowBySurface('triage').querySelector('.modelsRowChip').textContent).toBe('claude-sonnet-5');

        // Flipping back shows what this workspace actually runs on again.
        document.querySelectorAll('.modelsScopeSeg')[0].click();
        await flush();
        expect(rowBySurface('run').querySelector('.modelsRowChip').textContent).toBe('claude-opus-4-8');
    });

    it('writes a global pick against the active repo and repaints the global layer', async () => {
        await openPanel();
        document.querySelectorAll('.modelsScopeSeg')[1].click();
        await flush();
        rowBySurface('run').click();
        await flush();

        // Nothing is pinned globally for run, so Inherit holds the ✓ and names
        // the only layer beneath global.
        const rows = [...document.querySelectorAll('.modelsPickerRow')];
        expect(rows[0].getAttribute('aria-pressed')).toBe('true');
        expect(rows[0].querySelector('.modelsPickerHint').textContent).toBe('workflow default');

        rows.find((r) => r.querySelector('.modelsPickerLabel').textContent === 'gpt-5-codex').click();
        await flush();

        // Global scope still names the real repo — `scope` alone picks the row.
        expect(saveModelSetting).toHaveBeenCalledWith({
            scope: 'global',
            surface: 'run',
            model: 'gpt-5-codex',
            repo: 'rsterenchak/toDoList_TOP',
        });
        expect(rowBySurface('run').querySelector('.modelsRowChip').textContent).toBe('gpt-5-codex');
        expect(showInjectToast).not.toHaveBeenCalled();
    });

    it('clears a global pick back to inherited rather than to a blank chip', async () => {
        await openPanel();
        document.querySelectorAll('.modelsScopeSeg')[1].click();
        await flush();
        rowBySurface('triage').click();
        await flush();
        document.querySelectorAll('.modelsPickerRow')[0].click(); // Inherit
        await flush();

        expect(saveModelSetting).toHaveBeenCalledWith({
            scope: 'global',
            surface: 'triage',
            model: null,
            repo: 'rsterenchak/toDoList_TOP',
        });
        const chip = rowBySurface('triage').querySelector('.modelsRowChip');
        expect(chip.textContent).toBe('default');
        expect(rowBySurface('triage').querySelector('.modelsRowSource').textContent).toBe('default');
    });

    it('reverts a refused global pick back to the layer it had', async () => {
        saveModelSetting.mockResolvedValue({ ok: false, reason: '403 Forbidden' });
        await openPanel();
        document.querySelectorAll('.modelsScopeSeg')[1].click();
        await flush();
        rowBySurface('derive').click();
        await flush();
        [...document.querySelectorAll('.modelsPickerRow')]
            .find((r) => r.querySelector('.modelsPickerLabel').textContent === 'claude-opus-4-8')
            .click();
        await flush();

        // derive was never pinned globally, so the revert removes the key again
        // instead of leaving a set-looking chip behind.
        expect(rowBySurface('derive').querySelector('.modelsRowChip').textContent).toBe('default');
        expect(showInjectToast.mock.calls[0][1]).toBe('error');
    });

    it('binds the auto-merge toggle to the layer the showing scope owns', async () => {
        fetchModelSettings.mockResolvedValue(settingsFixture({
            autoMerge3p: true,
            global: { models: {}, auto_merge_3p: false },
        }));
        await openPanel();
        const toggle = () => document.querySelector('.modelsAutoToggle');
        expect(toggle().textContent).toBe('ON');

        document.querySelectorAll('.modelsScopeSeg')[1].click();
        await flush();
        // The global layer has it off — reading the resolved flag here would
        // report the repo's setting as the every-repo default.
        expect(toggle().textContent).toBe('OFF');

        toggle().click();
        await flush();
        expect(saveAutoMerge3p).toHaveBeenCalledWith({
            scope: 'global',
            value: true,
            repo: 'rsterenchak/toDoList_TOP',
        });
        expect(toggle().textContent).toBe('ON');

        // The repo layer is untouched by the global write.
        document.querySelectorAll('.modelsScopeSeg')[0].click();
        await flush();
        expect(toggle().textContent).toBe('ON');
    });

    it('leaves the locked ghost row untappable', async () => {
        await openPanel();
        const ghost = rowBySurface('ghost');
        expect(ghost.tagName).toBe('DIV');
        ghost.click();
        await flush();
        expect(document.querySelector('.modelsPicker')).toBeFalsy();
    });

    it('drills into the picker in place and comes back via the header chevron', async () => {
        await openPanel();
        rowBySurface('run').click();
        await flush();

        // One dialog only — the picker replaces the body, it does not stack.
        expect(document.querySelectorAll('#modelsPanelModal')).toHaveLength(1);
        expect(document.querySelector('.modelsMatrix')).toBeFalsy();
        expect(document.querySelector('.modelsPicker')).toBeTruthy();
        expect(document.getElementById('modelsPanelBack').hidden).toBe(false);
        expect(document.getElementById('modelsPanelScope').hidden).toBe(true);
        expect(document.getElementById('modelsPanelTitleText').textContent).toBe('RUN');

        document.getElementById('modelsPanelBack').click();
        await flush();
        expect(document.querySelector('.modelsMatrix')).toBeTruthy();
        expect(document.getElementById('modelsPanelBack').hidden).toBe(true);
    });

    it('leads the picker with Inherit and checks the resolved model', async () => {
        await openPanel();
        rowBySurface('run').click();
        await flush();

        const rows = [...document.querySelectorAll('.modelsPickerRow')];
        expect(rows[0].querySelector('.modelsPickerLabel').textContent).toBe('Inherit');
        // run is set at repo scope, so Inherit is NOT the current selection.
        expect(rows[0].getAttribute('aria-pressed')).toBe('false');
        const checked = rows.filter((r) => r.getAttribute('aria-pressed') === 'true');
        expect(checked).toHaveLength(1);
        expect(checked[0].querySelector('.modelsPickerLabel').textContent).toBe('claude-opus-4-8');

        const headings = [...document.querySelectorAll('.modelsPickerHeading')].map((el) => el.textContent);
        expect(headings[0]).toBe('PLAN QUOTA');
        expect(headings[1]).toBe('API BILLED · leaves plan, pays per token');
    });

    it('checks Inherit when nothing is pinned at the showing scope', async () => {
        await openPanel();
        rowBySurface('derive').click();
        await flush();
        const rows = [...document.querySelectorAll('.modelsPickerRow')];
        expect(rows[0].getAttribute('aria-pressed')).toBe('true');
    });

    it('discloses the manual-merge consequence on plan lanes while auto-merge is off', async () => {
        await openPanel();
        rowBySurface('run').click();
        await flush();
        expect(document.querySelector('.modelsPickerNote').textContent)
            .toContain('third-party picks open a PR and wait for manual merge');

        // Not a plan lane — nothing leaves plan quota, so no disclosure.
        document.getElementById('modelsPanelBack').click();
        await flush();
        rowBySurface('chat').click();
        await flush();
        expect(document.querySelector('.modelsPickerNote')).toBeFalsy();
    });

    it('writes a pick at the showing scope and repaints optimistically', async () => {
        await openPanel();
        rowBySurface('run').click();
        await flush();
        [...document.querySelectorAll('.modelsPickerRow')]
            .find((r) => r.querySelector('.modelsPickerLabel').textContent === 'gpt-5-codex')
            .click();
        await flush();

        expect(saveModelSetting).toHaveBeenCalledWith({
            scope: 'repo',
            surface: 'run',
            model: 'gpt-5-codex',
            repo: 'rsterenchak/toDoList_TOP',
        });
        // Back on the matrix, showing the new pick and its now-earned api badge.
        const chip = rowBySurface('run').querySelector('.modelsRowChip');
        expect(chip.textContent).toBe('gpt-5-codex');
        expect(rowBySurface('run').querySelector('.modelsRowBadge')).toBeTruthy();
        expect(showInjectToast).not.toHaveBeenCalled();
    });

    it('drills into DEEP and writes the pick against the deep surface', async () => {
        await openPanel();
        const deepRow = rowBySurface('deep');
        // Pickable, unlike GHOST — a button, not a plain div.
        expect(deepRow.tagName).toBe('BUTTON');
        deepRow.click();
        await flush();
        expect(document.getElementById('modelsPanelTitleText').textContent).toBe('DEEP');

        // The offered list is the chat lane, so a run-only model is absent.
        const labels = [...document.querySelectorAll('.modelsPickerRow')]
            .map((r) => r.querySelector('.modelsPickerLabel').textContent);
        expect(labels).toEqual(['Inherit', 'claude-sonnet-5', 'gpt-5-codex']);

        [...document.querySelectorAll('.modelsPickerRow')]
            .find((r) => r.querySelector('.modelsPickerLabel').textContent === 'claude-sonnet-5')
            .click();
        await flush();
        expect(saveModelSetting).toHaveBeenCalledWith({
            scope: 'repo',
            surface: 'deep',
            model: 'claude-sonnet-5',
            repo: 'rsterenchak/toDoList_TOP',
        });
        expect(rowBySurface('deep').querySelector('.modelsRowChip').textContent)
            .toBe('claude-sonnet-5');
    });

    it('sends model:null for Inherit, always naming the active repo', async () => {
        await openPanel();
        rowBySurface('run').click();
        await flush();
        document.querySelectorAll('.modelsPickerRow')[0].click();
        await flush();
        expect(saveModelSetting).toHaveBeenCalledWith({
            scope: 'repo',
            surface: 'run',
            model: null,
            repo: 'rsterenchak/toDoList_TOP',
        });
    });

    it('reverts the pick and toasts when the write fails', async () => {
        saveModelSetting.mockResolvedValue({ ok: false, reason: '403 Forbidden' });
        await openPanel();
        rowBySurface('run').click();
        await flush();
        [...document.querySelectorAll('.modelsPickerRow')]
            .find((r) => r.querySelector('.modelsPickerLabel').textContent === 'gpt-5-codex')
            .click();
        await flush();

        // The optimistic chip is put back, so the panel never keeps showing a
        // value the Worker refused.
        expect(rowBySurface('run').querySelector('.modelsRowChip').textContent).toBe('claude-opus-4-8');
        expect(showInjectToast).toHaveBeenCalledTimes(1);
        expect(showInjectToast.mock.calls[0][0]).toContain('403 Forbidden');
        expect(showInjectToast.mock.calls[0][1]).toBe('error');
    });

    it('writes the auto-merge toggle at the showing scope and reverts on failure', async () => {
        await openPanel();
        const toggle = () => document.querySelector('.modelsAutoToggle');
        expect(toggle().textContent).toBe('OFF');

        toggle().click();
        await flush();
        expect(saveAutoMerge3p).toHaveBeenCalledWith({
            scope: 'repo',
            value: true,
            repo: 'rsterenchak/toDoList_TOP',
        });
        expect(toggle().textContent).toBe('ON');
        expect(toggle().getAttribute('aria-pressed')).toBe('true');

        saveAutoMerge3p.mockResolvedValue({ ok: false, reason: 'Network error' });
        toggle().click();
        await flush();
        expect(toggle().textContent).toBe('ON');
        expect(showInjectToast.mock.calls[0][1]).toBe('error');
    });

    it('closes three ways and hands focus back to whatever opened it', async () => {
        const opener = document.createElement('button');
        document.body.appendChild(opener);

        openModelsPanel(opener);
        await flush();
        document.getElementById('modelsPanelClose').click();
        expect(document.getElementById('modelsPanelBackdrop')).toBeFalsy();
        expect(document.activeElement).toBe(opener);

        openModelsPanel(opener);
        await flush();
        document.getElementById('modelsPanelBackdrop').dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.getElementById('modelsPanelBackdrop')).toBeFalsy();

        openModelsPanel(opener);
        await flush();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        expect(document.getElementById('modelsPanelBackdrop')).toBeFalsy();
    });

    it('drops a read that lands after dismissal instead of re-mounting a body', async () => {
        let releaseSettings;
        fetchModelSettings.mockReturnValue(new Promise((resolve) => { releaseSettings = resolve; }));
        openModelsPanel(null);
        await flush();
        document.getElementById('modelsPanelClose').click();

        releaseSettings(settingsFixture());
        await flush();
        expect(document.querySelector('.modelsMatrix')).toBeFalsy();
        expect(document.getElementById('modelsPanelBackdrop')).toBeFalsy();
    });
});
