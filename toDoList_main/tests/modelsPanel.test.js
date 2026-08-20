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

    it('flips set-vs-inherited when the same settings are viewed at global scope', () => {
        // Same payload, different scope: a repo-sourced value is no longer "set
        // here", and a global-sourced one now is.
        const rows = buildModelRows(CATALOG, settingsFixture(), 'global');
        expect(rows.find((r) => r.surface === 'run').inherited).toBe(true);
        expect(rows.find((r) => r.surface === 'triage').inherited).toBe(false);
        expect(rows.find((r) => r.surface === 'triage').sourceTag).toBe('');
    });

    it('tags a never-set surface as default and shows a default chip', () => {
        const rows = buildModelRows(CATALOG, settingsFixture(), 'repo');
        const derive = rows.find((r) => r.surface === 'derive');
        expect(derive.inherited).toBe(true);
        expect(derive.sourceTag).toBe('default');
        expect(derive.chipText).toBe('default');
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
        expect(labels).toEqual(['RUN', 'TRIAGE', 'DERIVE', 'SCAN', 'CHAT', 'GHOST']);
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

    it('re-reads the sentinel row when the scope flips to global', async () => {
        await openPanel();
        document.querySelectorAll('.modelsScopeSeg')[1].click();
        await flush();
        expect(fetchModelSettings).toHaveBeenLastCalledWith('*');
        // The catalog is scope-independent, so switching must not re-fetch it.
        expect(fetchModelCatalog).toHaveBeenCalledTimes(1);
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
