// Offline (no-account) mode behind the sign-in gate.
//
// The contract pinned here:
//
//   • the gate renders the "Use offline on this device" door; taking it writes
//     `todoapp_accessMode = 'local'`, dismisses the gate and boots the app
//   • a boot with that flag and no session never raises the gate
//   • under html[data-access="local"] every LOCAL_HIDDEN_SELECTORS entry is
//     display:none, and style.css lists exactly those selectors
//   • hasAccount() false → neither mountClaudeSheet nor ensureGhostForSession runs
//   • a session arriving on an offline shell flips the flag to 'account' and
//     triggers the reload hook
//
// index.js is driven for real against the real component(); the Supabase client
// and the boot's network-bound steps are mocked, and the auth listener is
// captured so the test can fire a sign-in the way Supabase would.

import fs from 'fs';
import path from 'path';
import { vi } from 'vitest';

const h = vi.hoisted(() => ({
    session: null,
    authListener: null,
    carousel: null,
    showAuth: null,
    mountSheet: null,
    ensureGhost: null,
    realAuth: true,
}));

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        auth: {
            getSession: () => Promise.resolve({ data: { session: h.session } }),
            onAuthStateChange: (fn) => {
                h.authListener = fn;
                return { data: { subscription: { unsubscribe() {} } } };
            },
            signInWithOtp: () => Promise.resolve({ error: null }),
            verifyOtp: () => Promise.resolve({ error: null }),
            signOut: () => Promise.resolve({ error: null }),
        },
    },
}));
vi.mock('../src/listLogic.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        listLogic: Object.assign(Object.create(actual.listLogic), {
            hydrateFromSupabase: () => Promise.resolve(),
            subscribeToRealtime: () => {},
            handleSignOut: () => {},
        }),
    };
});
vi.mock('../src/auth.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        showAuthModal: (...args) => {
            if (h.showAuth) h.showAuth(...args);
            return actual.showAuthModal(...args);
        },
    };
});
vi.mock('../src/migration.js', () => ({
    maybeMigrateLocalToSupabase: () => Promise.resolve(),
    maybeSkipFirstRunForCloudUser: () => Promise.resolve(false),
    wipeLocalUserDataOnSignOut: () => Promise.resolve(),
}));
vi.mock('../src/welcomeCarousel.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        maybeStartFirstRunCarousel: (...args) => { if (h.carousel) h.carousel(...args); },
    };
});
vi.mock('../src/viewportHeal.js', async (importOriginal) => ({
    ...(await importOriginal()),
    initViewportHeal: () => {},
}));
vi.mock('../src/claudeSheet.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        mountClaudeSheet: (...args) => {
            if (h.mountSheet) h.mountSheet(...args);
            return actual.mountClaudeSheet(...args);
        },
    };
});
vi.mock('../src/main.js', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        ensureGhostForSession: (...args) => {
            if (h.ensureGhost) h.ensureGhost(...args);
            return actual.ensureGhostForSession(...args);
        },
    };
});

async function flush(n = 8) {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

let accessMode;
let reload;

beforeEach(async () => {
    vi.resetModules();
    h.session = null;
    h.authListener = null;
    h.carousel = vi.fn();
    h.showAuth = vi.fn();
    h.mountSheet = vi.fn();
    h.ensureGhost = vi.fn();
    document.body.innerHTML = '';
    delete document.documentElement.dataset.access;
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    accessMode = await import('../src/accessMode.js');
    reload = vi.fn();
    accessMode.setAccessModeReloader(reload);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('sign-in gate — offline door', () => {
    it('renders the or rule, the offline button and its caption', async () => {
        await import('../src/index.js');
        await flush();
        const backdrop = document.getElementById('authModalBackdrop');
        expect(backdrop).not.toBeNull();
        expect(backdrop.querySelector('.authModalOr').textContent).toBe('or');
        const offline = document.getElementById('authModalOffline');
        expect(offline).not.toBeNull();
        expect(offline.textContent).toBe('Use offline on this device');
        expect(backdrop.querySelector('.authModalOfflineCaption').textContent)
            .toBe('Projects and tasks only, saved in this browser. Export a backup any time from Settings.');
        // The offline door sits after the Continue form.
        const form = document.getElementById('authModalForm');
        expect(form.compareDocumentPosition(offline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('choosing it writes the flag, dismisses the gate and boots the app', async () => {
        await import('../src/index.js');
        await flush();
        expect(h.carousel).not.toHaveBeenCalled();

        document.getElementById('authModalOffline').click();
        await flush();

        expect(localStorage.getItem('todoapp_accessMode')).toBe('local');
        expect(document.documentElement.dataset.access).toBe('local');
        expect(document.getElementById('authModalBackdrop')).toBeNull();
        expect(h.carousel).toHaveBeenCalledTimes(1);
        expect(accessMode.hasAccount()).toBe(false);
    });
});

describe('offline boot', () => {
    beforeEach(() => {
        localStorage.setItem('todoapp_accessMode', 'local');
    });

    it('with the flag and no session, never raises the gate and boots locally', async () => {
        await import('../src/index.js');
        // Supabase also fires the listener on subscribe with no session.
        h.authListener('INITIAL_SESSION', null);
        await flush();
        expect(h.showAuth).not.toHaveBeenCalled();
        expect(document.getElementById('authModalBackdrop')).toBeNull();
        expect(h.carousel).toHaveBeenCalledTimes(1);
        expect(document.documentElement.dataset.access).toBe('local');
    });

    it('never mounts the Claude sheet or the ghost', async () => {
        await import('../src/index.js');
        await flush();
        expect(h.mountSheet).not.toHaveBeenCalled();
        expect(h.ensureGhost).not.toHaveBeenCalled();
        expect(document.getElementById('claudeSheet')).toBeNull();
    });

    it('mounts STREAM alone in the view switcher and the mobile tab bar', async () => {
        await import('../src/index.js');
        await flush();
        expect(document.getElementById('viewPillProjects')).not.toBeNull();
        expect(document.getElementById('viewPillUnderstanding')).toBeNull();
        expect(document.getElementById('viewPillStructure')).toBeNull();
        expect(document.getElementById('mobileTabProjects')).not.toBeNull();
        expect(document.getElementById('mobileTabUnderstanding')).toBeNull();
        expect(document.getElementById('mobileTabStructure')).toBeNull();
    });

    it('a session arriving flips the flag to account and triggers the reload hook', async () => {
        await import('../src/index.js');
        await flush();
        expect(reload).not.toHaveBeenCalled();

        h.authListener('SIGNED_IN', { user: { id: 'user-1' } });
        await flush();

        expect(localStorage.getItem('todoapp_accessMode')).toBe('account');
        expect(reload).toHaveBeenCalledTimes(1);
    });
});

describe('signed-in boot is unchanged', () => {
    it('mounts the Claude sheet and the ghost, and records the account mode', async () => {
        h.session = { user: { id: 'user-1' } };
        await import('../src/index.js');
        await flush();
        expect(h.mountSheet).toHaveBeenCalled();
        expect(h.ensureGhost).toHaveBeenCalled();
        expect(h.showAuth).not.toHaveBeenCalled();
        expect(localStorage.getItem('todoapp_accessMode')).toBe('account');
        expect(reload).not.toHaveBeenCalled();
        expect(document.getElementById('viewPillStructure')).not.toBeNull();
    });
});

describe('local-mode CSS switch', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../src/style.css'), 'utf8');
    const block = css.slice(
        css.indexOf('/* local-hidden:start */'),
        css.indexOf('/* local-hidden:end */')
    );

    it('style.css hides exactly LOCAL_HIDDEN_SELECTORS', () => {
        const selectors = block
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .split('{')[0]
            .split(',')
            .map((s) => s.trim().replace(/^html\[data-access="local"\]\s+/, ''));
        expect(selectors).toEqual(accessMode.LOCAL_HIDDEN_SELECTORS);
    });

    it('every selector is display:none under data-access="local" and shown otherwise', () => {
        const style = document.createElement('style');
        style.textContent = block;
        document.head.appendChild(style);
        const els = accessMode.LOCAL_HIDDEN_SELECTORS.map((sel) => {
            const el = document.createElement('div');
            if (sel[0] === '#') el.id = sel.slice(1);
            else el.className = sel.slice(1);
            document.body.appendChild(el);
            return { sel, el };
        });

        els.forEach(({ el }) => expect(getComputedStyle(el).display).not.toBe('none'));

        accessMode.applyAccessMode('local');
        els.forEach(({ sel, el }) => {
            expect(getComputedStyle(el).display, sel).toBe('none');
        });
        style.remove();
    });
});

describe('Settings in local mode', () => {
    it('the mobile Settings modal offers Sign in and drops Repo setup / Models / Diagnostics', async () => {
        localStorage.setItem('todoapp_accessMode', 'local');
        await import('../src/index.js');
        await flush();
        document.getElementById('drawerSettingsBtn').click();
        await flush();
        const modal = document.getElementById('settingsModal') || document.body;
        expect(modal.querySelector('#settingsRepoSetupSection')).toBeNull();
        expect(modal.querySelector('#settingsModelsSection')).toBeNull();
        expect(modal.querySelector('#settingsDiagnosticsSection')).toBeNull();
        const account = modal.querySelector('#settingsAccountSection');
        expect(account.textContent).toContain('Sign in');
        expect(account.textContent).not.toContain('Sign out');
    });
});
