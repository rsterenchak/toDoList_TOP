// Tests for how bootApp() in src/index.js routes a failed boot.
//
// markAppBooted() stands the inline watchdog down the moment the shell is in
// the DOM — before the render step runs — so any failure after that point has
// to decide for itself whether the watchdog needs to hear about it. The split
// bootApp encodes:
//
//   • the render step throws          → escalate (empty shell, nothing recovers it)
//   • the chain rejects BEFORE render  → escalate (restoreFromStorage never ran)
//   • the chain fails AFTER render     → warn only (degraded, not dead)
//
// The third case is deliberately quiet: a shell rendered from the local cache
// whose background migrate/hydrate/subscribe fails is usable, and escalating it
// would reload-loop the user through a Supabase outage.
//
// index.js is the entry module — it appends the DOM and hits Supabase at import
// time — so every import it makes is mocked here and the module is re-imported
// per test (bootApp is latched by a module-level `booted` flag).

import { vi } from 'vitest';

const h = vi.hoisted(() => ({
    restoreFromStorage: vi.fn(() => false),
    maybeStartFirstRunCarousel: vi.fn(),
    maybeSkipFirstRunForCloudUser: vi.fn(() => Promise.resolve(false)),
    maybeMigrateLocalToSupabase: vi.fn(() => Promise.resolve()),
    hydrateFromSupabase: vi.fn(() => Promise.resolve()),
    subscribeToRealtime: vi.fn(),
}));

vi.mock('../src/main.js', () => ({
    component: () => document.createElement('div'),
    restoreFromStorage: (...args) => h.restoreFromStorage(...args),
    notifyUpdateAvailable: () => {},
}));
vi.mock('../src/modals.js', () => ({ SW_UPDATE_INITIATOR_KEY: 'todoapp_swUpdateInitiator' }));
vi.mock('../src/listLogic.js', () => ({
    listLogic: {
        hydrateFromSupabase: (...args) => h.hydrateFromSupabase(...args),
        subscribeToRealtime: (...args) => h.subscribeToRealtime(...args),
        handleSignOut: () => {},
    },
}));
vi.mock('../src/welcomeCarousel.js', () => ({
    maybeStartFirstRunCarousel: (...args) => h.maybeStartFirstRunCarousel(...args),
}));
vi.mock('../src/supabaseClient.js', () => ({
    supabase: {
        auth: {
            getSession: () => Promise.resolve({ data: { session: { user: { id: 'user-1' } } } }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        },
    },
}));
vi.mock('../src/auth.js', () => ({ showAuthModal: () => {}, hideAuthModal: () => {} }));
vi.mock('../src/migration.js', () => ({
    maybeMigrateLocalToSupabase: (...args) => h.maybeMigrateLocalToSupabase(...args),
    maybeSkipFirstRunForCloudUser: (...args) => h.maybeSkipFirstRunForCloudUser(...args),
}));
vi.mock('../src/viewportHeal.js', () => ({ initViewportHeal: () => {} }));

describe('bootApp failure routing — src/index.js', () => {
    let reportSpy;
    let warnSpy;

    beforeEach(() => {
        vi.resetModules();
        Object.values(h).forEach((fn) => fn.mockReset());
        h.restoreFromStorage.mockReturnValue(false);
        h.maybeSkipFirstRunForCloudUser.mockResolvedValue(false);
        h.maybeMigrateLocalToSupabase.mockResolvedValue(undefined);
        h.hydrateFromSupabase.mockResolvedValue(undefined);

        reportSpy = vi.fn();
        window.__reportBootFailure = reportSpy;
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        document.body.innerHTML = '';
    });

    afterEach(() => {
        warnSpy.mockRestore();
        delete window.__reportBootFailure;
    });

    // Import the entry module and let the boot promise chain settle. A handful
    // of macrotask turns covers gate → render → sync pipeline → terminal catch.
    async function boot() {
        await import('../src/index.js');
        for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    }

    it('leaves a clean boot alone — nothing reported, nothing warned', async () => {
        await boot();

        expect(h.restoreFromStorage).toHaveBeenCalledTimes(1);
        expect(h.hydrateFromSupabase).toHaveBeenCalledTimes(1);
        expect(reportSpy).not.toHaveBeenCalled();
        expect(warnSpy).not.toHaveBeenCalled();
    });

    it('reports a render throw exactly once and skips the sync pipeline', async () => {
        h.restoreFromStorage.mockImplementation(() => { throw new Error('render blew up'); });

        await boot();

        // Reported once — the render catch handles it and returns, so the
        // terminal catch never sees it and can't report it a second time.
        expect(reportSpy).toHaveBeenCalledTimes(1);
        // migrate/hydrate/subscribe never run against a shell that failed to render.
        expect(h.maybeMigrateLocalToSupabase).not.toHaveBeenCalled();
        expect(h.hydrateFromSupabase).not.toHaveBeenCalled();
        expect(h.subscribeToRealtime).not.toHaveBeenCalled();
    });

    it('reports a pre-render rejection from the terminal catch', async () => {
        // The cloud gate rejecting means the .then holding restoreFromStorage()
        // never runs: empty shell, watchdog already stood down.
        h.maybeSkipFirstRunForCloudUser.mockRejectedValue(new Error('gate rejected'));

        await boot();

        expect(h.restoreFromStorage).not.toHaveBeenCalled();
        expect(reportSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalled();
    });

    it('warns without reporting when the sync pipeline fails after a good render', async () => {
        // Thrown synchronously so the rejection escapes bootSyncPipeline's own
        // catch and lands in the terminal one — with the shell already rendered.
        h.maybeMigrateLocalToSupabase.mockImplementation(() => { throw new Error('migrate blew up'); });

        await boot();

        expect(h.restoreFromStorage).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalled();
        expect(reportSpy).not.toHaveBeenCalled();
    });

    it('warns without reporting when hydration rejects after a good render', async () => {
        h.hydrateFromSupabase.mockRejectedValue(new Error('hydrate rejected'));

        await boot();

        expect(h.restoreFromStorage).toHaveBeenCalledTimes(1);
        expect(h.subscribeToRealtime).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
        expect(reportSpy).not.toHaveBeenCalled();
    });

    it('stays silent when the watchdog hook is absent (stale cached template)', async () => {
        delete window.__reportBootFailure;
        h.maybeSkipFirstRunForCloudUser.mockRejectedValue(new Error('gate rejected'));

        await boot();

        // reportBootFailure() guards on the hook, so a missing one can't turn a
        // boot failure into a second throw out of the terminal catch.
        expect(warnSpy).toHaveBeenCalled();
    });
});
