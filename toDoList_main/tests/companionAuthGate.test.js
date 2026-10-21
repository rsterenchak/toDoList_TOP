// The desktop ghost exists only while someone is signed in.
//
// index.js builds the whole page with component() before it knows whether a
// session exists, so anything component() mounts shows up on the sign-in
// screen too. The ghost used to be one of those things: on a device that still
// held the Worker secret it could be clicked and would talk while signed out.
// The contract pinned here:
//
//   • no session            → component() leaves no ghost in the DOM
//   • bootApp's first render → the ghost mounts
//   • sign-out              → the ghost is gone (and the pane handed back)
//   • sign-in on the same tab → the ghost is back, exactly once
//
// index.js is the entry module and is driven for real against the real
// component(); only the Supabase client and the boot's network-bound steps are
// mocked, and the auth listener is captured so the test can fire sign-in and
// sign-out events the way Supabase would.

import { vi } from 'vitest';

const h = vi.hoisted(() => ({
    session: null,
    authListener: null,
}));

vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        auth: {
            getSession: () => Promise.resolve({ data: { session: h.session } }),
            onAuthStateChange: (fn) => {
                h.authListener = fn;
                return { data: { subscription: { unsubscribe() {} } } };
            },
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
vi.mock('../src/auth.js', () => ({ showAuthModal: () => {}, hideAuthModal: () => {} }));
vi.mock('../src/migration.js', () => ({
    maybeMigrateLocalToSupabase: () => Promise.resolve(),
    maybeSkipFirstRunForCloudUser: () => Promise.resolve(false),
}));
vi.mock('../src/welcomeCarousel.js', () => ({ maybeStartFirstRunCarousel: () => {} }));
vi.mock('../src/viewportHeal.js', () => ({ initViewportHeal: () => {} }));

// jsdom answers `matches: false` to everything, which would bar the desktop
// gate the companion runs behind — and make every assertion below vacuous.
function stubDesktop() {
    window.matchMedia = (query) => ({
        matches: !/prefers-reduced-motion/.test(query),
        media: query,
        addListener() {},
        removeListener() {},
        addEventListener() {},
        removeEventListener() {},
    });
    Object.defineProperty(window, 'innerWidth', { value: 1300, configurable: true, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true, writable: true });
}

async function flush(n = 8) {
    for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
}

const ghosts = () => document.querySelectorAll('.companion');
const signIn = () => h.authListener('SIGNED_IN', { user: { id: 'user-1' } });
const signOut = () => h.authListener('SIGNED_OUT', null);

describe('desktop ghost — mounted only while signed in', () => {
    let companion;

    beforeEach(async () => {
        vi.resetModules();
        h.session = null;
        h.authListener = null;
        document.body.innerHTML = '';
        localStorage.clear();
        stubDesktop();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        companion = await import('../src/companion.js');
    });

    afterEach(async () => {
        // Each case re-imports a fresh module graph, and every main.js instance
        // leaves its possession listener on the shared document. Signing this
        // instance's ghost out makes that listener inert, so a later case's
        // possession flip can't mount a ghost from a stale instance.
        const main = await import('../src/main.js');
        main.releaseGhostForSignOut();
        companion.destroyCompanion();
        vi.restoreAllMocks();
    });

    it('the desktop gate is open in this environment (guards against a vacuous pass)', () => {
        expect(companion.supportsDesktopCompanion()).toBe(true);
        expect(companion.isCompanionEnabled()).toBe(true);
    });

    it('with no session, component() leaves no ghost on the page', async () => {
        await import('../src/index.js');
        await flush();
        expect(ghosts().length).toBe(0);
    });

    it('mounts the ghost once bootApp renders for a session', async () => {
        h.session = { user: { id: 'user-1' } };
        await import('../src/index.js');
        // Supabase fires the listener on subscribe with the current session too;
        // the ghost must still end up mounted exactly once.
        signIn();
        await flush();
        expect(ghosts().length).toBe(1);
    });

    it('removes the ghost on sign-out', async () => {
        h.session = { user: { id: 'user-1' } };
        await import('../src/index.js');
        await flush();
        expect(ghosts().length).toBe(1);

        signOut();
        await flush();
        expect(ghosts().length).toBe(0);
    });

    it('brings the ghost back exactly once after sign-out then sign-in on the same tab', async () => {
        await import('../src/index.js');
        await flush();
        expect(ghosts().length).toBe(0);

        signIn();
        await flush();
        expect(ghosts().length).toBe(1);

        signOut();
        await flush();
        expect(ghosts().length).toBe(0);

        signIn();
        signIn(); // a token refresh lands as another session event
        await flush();
        expect(ghosts().length).toBe(1);
    });

    it('hands a possessed pane back on sign-out and leaves the ghost unmounted', async () => {
        h.session = { user: { id: 'user-1' } };
        await import('../src/index.js');
        await flush();
        const sheet = await import('../src/claudeSheet.js');
        sheet.togglePossession();
        expect(sheet.isSheetPossessed()).toBe(true);

        signOut();
        await flush();
        expect(sheet.isSheetPossessed()).toBe(false);
        expect(ghosts().length).toBe(0);
    });
});
