import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';
import {
    syncAgentAvailabilityForProject,
    isAgentUnavailable,
    showAgentUnavailableTooltip,
    AGENT_UNAVAILABLE_MSG,
} from '../src/agentView.js';
import { initInjectConfig } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

// agentView → inject → supabaseClient. Stub the shared client so module import
// doesn't reach the network (the availability gate never touches Supabase, but
// importing the module still loads the client).
vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        from: () => ({
            select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => {},
    },
}));

const URL_KEY    = 'todoapp_injectWorkerUrl';
const SECRET_KEY = 'todoapp_injectSharedSecret';

// Drive isInjectConfigured() by seeding the per-device config keys, then loading
// them into the inject.js module cache the way app boot does.
function setInjectConfigured(configured) {
    if (configured) {
        localStorage.setItem(URL_KEY, 'https://worker.example');
        localStorage.setItem(SECRET_KEY, 'shh');
    } else {
        localStorage.removeItem(URL_KEY);
        localStorage.removeItem(SECRET_KEY);
    }
    initInjectConfig();
}

function seedProject(name, targetId) {
    listLogic.addProject(name);
    if (targetId) listLogic.setProjectTargetId(name, targetId);
}

// Mount the two AGENT entry points the gate drives: the desktop pill and the
// mobile bottom-bar tab. Each carries an original `title` so the restore path
// (put the prev title back, not the unavailable message) is observable.
function mountEntryPoints() {
    document.body.innerHTML =
        '<button id="viewPillAgent" title="Agent">AGENT</button>' +
        '<button id="mobileTabAgent" title="Agent">Agent</button>';
}

// A project with no routed repo can't draft, dispatch, or ship agent work, so
// both AGENT tab entry points present as visible-but-inert: one `agentUnavailable`
// body flag drives the dimmed CSS, flips aria-disabled, and makes a tap a
// no-op-plus-tooltip. The flag clears the moment a repo-backed project is active.
describe('syncAgentAvailabilityForProject — gate the AGENT tab off with no repo', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        document.body.className = '';
        listLogic._reset();
        mountEntryPoints();
    });

    it('sets the agentUnavailable flag when the project has no repo', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);

        const hasRepo = syncAgentAvailabilityForProject('NoRepo');
        expect(hasRepo).toBe(false);
        expect(document.body.classList.contains('agentUnavailable')).toBe(true);
        expect(isAgentUnavailable()).toBe(true);
    });

    it('clears the flag when a repo-backed project becomes active', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);
        seedProject('Repo', 'tgt-1');

        syncAgentAvailabilityForProject('NoRepo');
        expect(isAgentUnavailable()).toBe(true);

        const hasRepo = syncAgentAvailabilityForProject('Repo');
        expect(hasRepo).toBe(true);
        expect(document.body.classList.contains('agentUnavailable')).toBe(false);
        expect(isAgentUnavailable()).toBe(false);
    });

    it('treats unconfigured inject as unavailable even with a target', () => {
        setInjectConfigured(false);
        seedProject('Repo', 'tgt-1');

        syncAgentAvailabilityForProject('Repo');
        expect(isAgentUnavailable()).toBe(true);
    });

    it('marks both entry points aria-disabled with an explanatory title', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);

        syncAgentAvailabilityForProject('NoRepo');
        const pill = document.getElementById('viewPillAgent');
        const tab = document.getElementById('mobileTabAgent');
        expect(pill.getAttribute('aria-disabled')).toBe('true');
        expect(pill.getAttribute('title')).toBe(AGENT_UNAVAILABLE_MSG);
        expect(tab.getAttribute('aria-disabled')).toBe('true');
        expect(tab.getAttribute('title')).toBe(AGENT_UNAVAILABLE_MSG);
    });

    it('restores both entry points when a repo is routed', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);
        seedProject('Repo', 'tgt-1');

        syncAgentAvailabilityForProject('NoRepo');
        syncAgentAvailabilityForProject('Repo');
        const pill = document.getElementById('viewPillAgent');
        const tab = document.getElementById('mobileTabAgent');
        expect(pill.hasAttribute('aria-disabled')).toBe(false);
        expect(pill.getAttribute('title')).toBe('Agent');
        expect(tab.hasAttribute('aria-disabled')).toBe(false);
        expect(tab.getAttribute('title')).toBe('Agent');
    });

    it('shows a tooltip with the explanatory message anchored to the tapped control', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);
        syncAgentAvailabilityForProject('NoRepo');

        showAgentUnavailableTooltip(document.getElementById('viewPillAgent'));
        const tip = document.querySelector('.agentUnavailableTooltip');
        expect(tip).not.toBeNull();
        expect(tip.textContent).toBe(AGENT_UNAVAILABLE_MSG);

        // Re-tapping replaces the bubble rather than stacking a second one.
        showAgentUnavailableTooltip(document.getElementById('mobileTabAgent'));
        expect(document.querySelectorAll('.agentUnavailableTooltip').length).toBe(1);
    });
});

// Static wiring guard: agentView exports the gate, and main.js routes project
// switches through it and guards both AGENT entry-point clicks with it.
describe('AGENT tab availability wiring', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcDir = resolve(here, '../src');
    const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

    it('agentView.js exports the gate helpers', () => {
        const av = read('agentView.js');
        expect(av).toMatch(/export\s+function\s+syncAgentAvailabilityForProject\s*\(/);
        expect(av).toMatch(/export\s+function\s+isAgentUnavailable\s*\(/);
        expect(av).toMatch(/export\s+function\s+showAgentUnavailableTooltip\s*\(/);
    });

    it('main.js imports and calls syncAgentAvailabilityForProject at both switch hooks', () => {
        const main = read('main.js');
        expect(main)
            .toMatch(/import\s*\{[^}]*syncAgentAvailabilityForProject[^}]*\}\s*from\s*['"]\.\/agentView\.js['"]/);
        const calls = main.match(/syncAgentAvailabilityForProject\(/g) || [];
        // two click-handler call sites (the import reference has no paren)
        expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    it('main.js gates both AGENT entry points through isAgentUnavailable', () => {
        const main = read('main.js');
        expect(main).toMatch(/isAgentUnavailable\(\)/);
        expect(main).toMatch(/showAgentUnavailableTooltip\(/);
    });
});
