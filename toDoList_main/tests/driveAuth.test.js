// Tests for the shared driveAuth module's getAccessToken surface. The
// silent variant powers the app-load auto-sync re-auth (zero-click for
// returning users); the interactive variant powers the explicit
// "Connect to Drive" menu row and the manual Export / Import buttons.
// Both share one cached-token lifecycle so importing right after
// exporting in the same session reuses the grant without re-prompting.

import {
    getAccessToken,
    _resetCachedToken,
    _resetGisPromise,
} from '../src/driveAuth.js';


// Install a fake GIS client that records the args passed to
// `requestAccessToken` so the test can pin the silent vs interactive
// prompt flag. The fake resolves the callback synchronously with a token.
function installFakeGisClient() {
    const calls = [];
    window.google = {
        accounts: {
            oauth2: {
                initTokenClient(config) {
                    return {
                        requestAccessToken(opts) {
                            calls.push(opts || {});
                            config.callback({
                                access_token: 'tok-' + calls.length,
                                expires_in: 3600,
                            });
                        },
                    };
                },
            },
        },
    };
    return calls;
}

function installFakeGisClientErroring(errorString) {
    window.google = {
        accounts: {
            oauth2: {
                initTokenClient(config) {
                    return {
                        requestAccessToken() {
                            config.callback({ error: errorString });
                        },
                    };
                },
            },
        },
    };
}

function uninstallFakeGisClient() {
    try { delete window.google; } catch (_) { window.google = undefined; }
}


describe('driveAuth — getAccessToken silent vs interactive prompt', () => {
    beforeEach(() => {
        _resetGisPromise();
        _resetCachedToken();
    });

    afterEach(() => {
        uninstallFakeGisClient();
        _resetGisPromise();
        _resetCachedToken();
    });

    it('getAccessToken({ silent: true }) constructs the GIS token client with prompt: "none"', async () => {
        const calls = installFakeGisClient();
        await getAccessToken({ silent: true });
        expect(calls).toHaveLength(1);
        expect(calls[0].prompt).toBe('none');
    });

    it('getAccessToken() with no opts uses the default interactive prompt (empty string)', async () => {
        const calls = installFakeGisClient();
        await getAccessToken();
        expect(calls).toHaveLength(1);
        // Empty string is the GIS default — show consent only if needed.
        // The key contract is "NOT prompt: none", which guarantees the
        // interactive popup can surface when consent is required.
        expect(calls[0].prompt).not.toBe('none');
        expect(calls[0].prompt).toBe('');
    });

    it('getAccessToken({}) (empty opts object) also uses the interactive prompt', async () => {
        const calls = installFakeGisClient();
        await getAccessToken({});
        expect(calls).toHaveLength(1);
        expect(calls[0].prompt).not.toBe('none');
    });

    it('silent variant rejects when GIS reports an error (no popup fallback)', async () => {
        installFakeGisClientErroring('access_denied');
        let caught;
        try { await getAccessToken({ silent: true }); }
        catch (e) { caught = e; }
        expect(caught).toBeTruthy();
        expect(String(caught.message)).toMatch(/access_denied/);
    });

    it('cached token short-circuits the silent variant — no GIS call', async () => {
        const calls = installFakeGisClient();
        // First call seeds the cache via the (default) interactive path.
        await getAccessToken();
        expect(calls).toHaveLength(1);
        // Second call asks for silent — but the cached token should be
        // reused without invoking the GIS client again.
        const token = await getAccessToken({ silent: true });
        expect(calls).toHaveLength(1);
        expect(token).toBe('tok-1');
    });
});
