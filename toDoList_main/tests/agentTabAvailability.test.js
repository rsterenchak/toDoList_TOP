import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { vi } from 'vitest';
import {
    syncAgentAvailabilityForProject,
    isAgentUnavailable,
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
// mobile bottom-bar tab. Each carries an original `title` so we can confirm the
// gate no longer swaps it out (the tab stays a normal, tappable control).
function mountEntryPoints() {
    document.body.innerHTML =
        '<button id="viewPillAgent" title="Agent">AGENT</button>' +
        '<button id="mobileTabAgent" title="Agent">Agent</button>';
}

// A project with no routed repo can't draft, dispatch, or ship agent work. The
// AGENT tab stays fully tappable, but a single `agentUnavailable` body flag drives
// a small "no-repo" marker on both entry points and the in-view unavailable
// message. The flag clears the moment a repo-backed project is active.
describe('syncAgentAvailabilityForProject — flag the AGENT tab as no-repo', () => {
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

    it('leaves both entry points tappable — no aria-disabled, title untouched', () => {
        setInjectConfigured(true);
        seedProject('NoRepo', null);

        syncAgentAvailabilityForProject('NoRepo');
        const pill = document.getElementById('viewPillAgent');
        const tab = document.getElementById('mobileTabAgent');
        // The tab now opens a real (unavailable-message) view, so it must not be
        // marked disabled, and its title stays whatever it was.
        expect(pill.hasAttribute('aria-disabled')).toBe(false);
        expect(pill.getAttribute('title')).toBe('Agent');
        expect(tab.hasAttribute('aria-disabled')).toBe(false);
        expect(tab.getAttribute('title')).toBe('Agent');
    });
});

// Static wiring guard: agentView exports the gate, main.js routes project switches
// through it, both AGENT entry-point clicks navigate unconditionally (no gate
// early-return), and both carry the no-repo marker; paint() renders the message.
describe('AGENT tab availability wiring', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const srcDir = resolve(here, '../src');
    const read = (rel) => readFileSync(resolve(srcDir, rel), 'utf8');

    it('agentView.js exports the gate helpers and no longer exports the tooltip', () => {
        const av = read('agentView.js');
        expect(av).toMatch(/export\s+function\s+syncAgentAvailabilityForProject\s*\(/);
        expect(av).toMatch(/export\s+function\s+isAgentUnavailable\s*\(/);
        expect(av).not.toMatch(/showAgentUnavailableTooltip/);
    });

    it('main.js imports and calls syncAgentAvailabilityForProject at both switch hooks', () => {
        const main = read('main.js');
        expect(main)
            .toMatch(/import\s*\{[^}]*syncAgentAvailabilityForProject[^}]*\}\s*from\s*['"]\.\/agentView\.js['"]/);
        const calls = main.match(/syncAgentAvailabilityForProject\(/g) || [];
        expect(calls.length).toBeGreaterThanOrEqual(2);
    });

    it('main.js AGENT entry points navigate unconditionally and carry the no-repo marker', () => {
        const main = read('main.js');
        // The old gate helpers are gone from main.js entirely.
        expect(main).not.toMatch(/isAgentUnavailable/);
        expect(main).not.toMatch(/showAgentUnavailableTooltip/);
        // Both entry points get a real <span> marker toggled by CSS.
        const markers = main.match(/agentNoRepoMarker/g) || [];
        expect(markers.length).toBeGreaterThanOrEqual(2);
    });

    it('agentView paint() renders the unavailable message when the tab is gated', () => {
        const av = read('agentView.js');
        expect(av).toMatch(/if\s*\(\s*isAgentUnavailable\(\)\s*\)/);
        expect(av).toMatch(/AGENT_UNAVAILABLE_MSG/);
    });
});
