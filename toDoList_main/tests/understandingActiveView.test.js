import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';
import { ACTIVE_VIEW_KEY, getActiveView, setActiveView } from '../src/prefs.js';

// applyActiveView('understanding') is a third accepted view that mirrors
// 'structure': data-view on #mainBar and <body>, pill + mobile-tab state, the
// detail pane hidden, its own render hook on enter and exit hook on leave, and
// the choice persisted. main.js is too large to boot in jsdom, so the function's
// own source is lifted out and run against the real prefs plus stubbed hooks.

const here = dirname(fileURLToPath(import.meta.url));
const main = readFileSync(resolve(here, '../src/main.js'), 'utf8');

function extractFunction(name) {
    const start = main.indexOf('function ' + name + '(');
    if (start === -1) throw new Error('function not found: ' + name);
    const bodyStart = main.indexOf('{', start);
    let depth = 0;
    for (let i = bodyStart; i < main.length; i++) {
        if (main[i] === '{') depth++;
        else if (main[i] === '}') {
            depth--;
            if (depth === 0) return main.slice(start, i + 1);
        }
    }
    throw new Error('unterminated body for: ' + name);
}

const HOOKS = ['captureStructureSnapshot', 'renderStructureView', 'exitStructureLiveView', 'renderUnderstandingView', 'exitUnderstandingView'];

// The module-scope re-apply state applyActiveView reads lives beside it in
// main.js; the factory declares it fresh per build, as a page load would.
function buildApplyActiveView(hooks) {
    const factory = new Function(
        'getActiveView', 'setActiveView', ...HOOKS,
        'let lastAppliedView = null;\nlet lastAppliedProject = null;\n' +
        extractFunction('selectedProjectForView') + '\n' +
        extractFunction('applyActiveView') + '\nreturn applyActiveView;'
    );
    return factory(getActiveView, setActiveView, ...HOOKS.map((h) => hooks[h]));
}

function selectProject(name) {
    let row = document.querySelector('.selectedProject');
    if (!row) {
        row = document.createElement('div');
        row.className = 'selectedProject';
        row.innerHTML = '<input id="projInput">';
        document.body.appendChild(row);
    }
    row.querySelector('#projInput').value = name;
}

function mountShell() {
    document.body.innerHTML =
        '<div id="mainBar" data-view="projects"></div>' +
        '<div id="descDetailPane"></div>' +
        '<button id="viewPillProjects"></button>' +
        '<button id="viewPillUnderstanding"></button>' +
        '<button id="viewPillStructure"></button>' +
        '<button id="mobileTabProjects"></button>' +
        '<button id="mobileTabUnderstanding"></button>' +
        '<button id="mobileTabStructure"></button>';
}

describe("applyActiveView('understanding')", () => {
    let hooks;
    let applyActiveView;
    beforeEach(() => {
        localStorage.clear();
        document.body.removeAttribute('data-view');
        mountShell();
        hooks = Object.fromEntries(HOOKS.map((h) => [h, vi.fn()]));
        applyActiveView = buildApplyActiveView(hooks);
    });

    it('sets data-view on #mainBar and <body> and persists the view', () => {
        applyActiveView('understanding');
        expect(document.getElementById('mainBar').getAttribute('data-view')).toBe('understanding');
        expect(document.body.getAttribute('data-view')).toBe('understanding');
        expect(localStorage.getItem(ACTIVE_VIEW_KEY)).toBe('understanding');
        expect(getActiveView()).toBe('understanding');
    });

    it('marks only the UNDERSTANDING pill and tab active, with the roving tab stop', () => {
        applyActiveView('understanding');
        const pill = document.getElementById('viewPillUnderstanding');
        expect(pill.classList.contains('active')).toBe(true);
        expect(pill.getAttribute('aria-pressed')).toBe('true');
        expect(pill.getAttribute('tabindex')).toBe('0');
        ['viewPillProjects', 'viewPillStructure'].forEach((id) => {
            const el = document.getElementById(id);
            expect(el.classList.contains('active')).toBe(false);
            expect(el.getAttribute('tabindex')).toBe('-1');
        });
        const tab = document.getElementById('mobileTabUnderstanding');
        expect(tab.classList.contains('active')).toBe(true);
        expect(tab.getAttribute('aria-pressed')).toBe('true');
        expect(document.getElementById('mobileTabStructure').classList.contains('active')).toBe(false);
        expect(document.getElementById('mobileTabProjects').classList.contains('active')).toBe(false);
    });

    it('hides the detail pane and renders the shelf on enter, exits it on leave', () => {
        applyActiveView('understanding');
        expect(document.getElementById('descDetailPane').hidden).toBe(true);
        expect(hooks.renderUnderstandingView).toHaveBeenCalledTimes(1);
        expect(hooks.renderStructureView).not.toHaveBeenCalled();
        expect(hooks.captureStructureSnapshot).not.toHaveBeenCalled();

        applyActiveView('projects');
        expect(document.getElementById('descDetailPane').hidden).toBe(false);
        expect(hooks.exitUnderstandingView).toHaveBeenCalled();
        expect(document.getElementById('viewPillUnderstanding').classList.contains('active')).toBe(false);
    });

    it('switching to Structure leaves Understanding through its exit hook', () => {
        applyActiveView('understanding');
        hooks.exitUnderstandingView.mockClear();
        applyActiveView('structure');
        expect(hooks.exitUnderstandingView).toHaveBeenCalledTimes(1);
        expect(hooks.renderStructureView).toHaveBeenCalledTimes(1);
        expect(document.body.getAttribute('data-view')).toBe('structure');
    });
});

describe('re-applying the active view', () => {
    let hooks;
    let applyActiveView;
    beforeEach(() => {
        localStorage.clear();
        document.body.removeAttribute('data-view');
        mountShell();
        selectProject('Void');
        hooks = Object.fromEntries(HOOKS.map((h) => [h, vi.fn()]));
        applyActiveView = buildApplyActiveView(hooks);
    });

    it('is a no-op for Understanding when the view and project are unchanged', () => {
        applyActiveView('understanding');
        expect(hooks.renderUnderstandingView).toHaveBeenCalledTimes(1);
        // A sync re-hydrate / wake / realtime push re-applies the same view.
        applyActiveView('understanding');
        applyActiveView('understanding');
        expect(hooks.renderUnderstandingView).toHaveBeenCalledTimes(1);
        expect(hooks.exitUnderstandingView).not.toHaveBeenCalled();
        // The idempotent pill / data-view sync still runs.
        expect(document.body.getAttribute('data-view')).toBe('understanding');
        expect(document.getElementById('viewPillUnderstanding').classList.contains('active')).toBe(true);
    });

    it('is a no-op for Structure when the view and project are unchanged', () => {
        applyActiveView('structure');
        applyActiveView('structure');
        expect(hooks.renderStructureView).toHaveBeenCalledTimes(1);
        expect(hooks.exitStructureLiveView).not.toHaveBeenCalled();
    });

    it('renders fresh after switching away and back', () => {
        applyActiveView('understanding');
        applyActiveView('projects');
        applyActiveView('understanding');
        expect(hooks.renderUnderstandingView).toHaveBeenCalledTimes(2);
        applyActiveView('structure');
        applyActiveView('projects');
        applyActiveView('structure');
        expect(hooks.renderStructureView).toHaveBeenCalledTimes(2);
    });

    it('renders fresh when applied for a different project', () => {
        applyActiveView('understanding');
        selectProject('Other');
        applyActiveView('understanding');
        expect(hooks.renderUnderstandingView).toHaveBeenCalledTimes(2);
        applyActiveView('understanding');
        expect(hooks.renderUnderstandingView).toHaveBeenCalledTimes(2);
    });
});

describe('main.js wiring', () => {
    it('the stay-on-Understanding project switch forces a fresh shelf and records the project', () => {
        const at = main.indexOf('if (stayOnUnderstanding) {');
        expect(at).toBeGreaterThan(-1);
        const block = main.slice(at, at + 400);
        expect(block).toContain('renderUnderstandingView({ force: true })');
        expect(block).toContain('lastAppliedProject = selectedProjectForView()');
    });
});
