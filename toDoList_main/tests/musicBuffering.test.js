// Focus music must never strand on "buffering". A failed YouTube API script
// load is retried on the next play (the cached promise and the dead script tag
// are both cleared), and a play that never starts falls back to IDLE after the
// buffering watchdog instead of showing "buffering" until a page refresh.

import {
    createMusic,
    loadIframeApi,
    _resetIframeApiPromise,
    MUSIC_STATE_KEY,
    BUFFERING_WATCHDOG_MS,
} from '../src/music.js';

function apiTag() {
    return document.getElementById('youtubeIframeApi');
}

function flush() {
    return new Promise(function(resolve) { resolve(); }).then(function() {}).then(function() {});
}

// A stand-in YT.Player that records its events so tests can fire them.
function installFakeYT() {
    const created = [];
    function FakePlayer(target, opts) {
        this.events = opts.events;
        this.playVideo = vi.fn();
        this.pauseVideo = vi.fn();
        this.setVolume = vi.fn();
        this.loadVideoById = vi.fn();
        this.loadPlaylist = vi.fn();
        this.getVideoData = function() { return {}; };
        created.push(this);
    }
    window.YT = { Player: FakePlayer };
    return created;
}

function cleanup() {
    const tag = apiTag();
    if (tag) tag.remove();
    delete window.YT;
    delete window.onYouTubeIframeAPIReady;
    _resetIframeApiPromise();
    localStorage.removeItem(MUSIC_STATE_KEY);
}

describe('music — failed YouTube API load is retried', () => {
    beforeEach(cleanup);
    afterEach(() => { vi.useRealTimers(); cleanup(); });

    it('clears the cached promise and the failed script tag when the script errors', async () => {
        const first = loadIframeApi(document);
        const tag = apiTag();
        expect(tag).not.toBeNull();
        tag.onerror();
        await expect(first).rejects.toThrow();
        expect(apiTag()).toBeNull();

        const second = loadIframeApi(document);
        second.catch(function() {});
        expect(second).not.toBe(first);
        expect(apiTag()).not.toBeNull();
        expect(apiTag()).not.toBe(tag);
    });

    it('play after a failed load re-injects the script instead of reusing the dead promise', async () => {
        const ctl = createMusic(document);
        const target = document.createElement('div');
        ctl.play(target);
        expect(ctl.getState().status).toBe('BUFFERING');
        apiTag().onerror();
        await flush();
        expect(ctl.getState().status).toBe('IDLE');
        expect(apiTag()).toBeNull();

        ctl.play(target);
        expect(ctl.getState().status).toBe('BUFFERING');
        expect(apiTag()).not.toBeNull();

        // The retry succeeds: the API lands and the player starts.
        const created = installFakeYT();
        window.onYouTubeIframeAPIReady();
        await flush();
        expect(created.length).toBe(1);
        created[0].events.onReady();
        expect(created[0].playVideo).toHaveBeenCalled();
        created[0].events.onStateChange({ data: 1 });
        expect(ctl.getState().status).toBe('PLAYING');
        ctl.destroy();
    });
});

describe('music — buffering watchdog', () => {
    beforeEach(cleanup);
    afterEach(() => { vi.useRealTimers(); cleanup(); });

    it('falls back to IDLE when the API script never loads, and the next play retries', async () => {
        vi.useFakeTimers();
        const ctl = createMusic(document);
        const target = document.createElement('div');
        ctl.play(target);
        const firstTag = apiTag();
        expect(ctl.getState().status).toBe('BUFFERING');

        vi.advanceTimersByTime(BUFFERING_WATCHDOG_MS - 1);
        expect(ctl.getState().status).toBe('BUFFERING');
        vi.advanceTimersByTime(1);
        expect(ctl.getState().status).toBe('IDLE');

        ctl.play(target);
        expect(ctl.getState().status).toBe('BUFFERING');
        expect(apiTag()).not.toBeNull();
        expect(apiTag()).not.toBe(firstTag);
        ctl.destroy();
    });

    it('falls back to IDLE when the player never becomes ready, and a late onReady does not auto-play', async () => {
        vi.useFakeTimers();
        const created = installFakeYT();
        const ctl = createMusic(document);
        ctl.play(document.createElement('div'));
        await flush();
        expect(created.length).toBe(1);

        vi.advanceTimersByTime(BUFFERING_WATCHDOG_MS);
        expect(ctl.getState().status).toBe('IDLE');

        created[0].events.onReady();
        expect(created[0].playVideo).not.toHaveBeenCalled();
        ctl.destroy();
    });

    it('does not fire once playback has started', async () => {
        vi.useFakeTimers();
        const created = installFakeYT();
        const ctl = createMusic(document);
        ctl.play(document.createElement('div'));
        await flush();
        created[0].events.onReady();
        created[0].events.onStateChange({ data: 1 });
        expect(ctl.getState().status).toBe('PLAYING');

        vi.advanceTimersByTime(BUFFERING_WATCHDOG_MS * 2);
        expect(ctl.getState().status).toBe('PLAYING');
        ctl.destroy();
    });

    it('falls back to IDLE when a created player stalls on a repeat play', async () => {
        vi.useFakeTimers();
        const created = installFakeYT();
        const ctl = createMusic(document);
        ctl.play(document.createElement('div'));
        await flush();
        created[0].events.onReady();
        created[0].events.onStateChange({ data: 2 });
        expect(ctl.getState().status).toBe('PAUSED');

        ctl.play(document.createElement('div'));
        expect(ctl.getState().status).toBe('BUFFERING');
        vi.advanceTimersByTime(BUFFERING_WATCHDOG_MS);
        expect(ctl.getState().status).toBe('IDLE');
        ctl.destroy();
    });
});

describe('music — player error clears a pending play', () => {
    beforeEach(cleanup);
    afterEach(cleanup);

    it('onError returns to IDLE and a later onReady does not start playback', async () => {
        const created = installFakeYT();
        const ctl = createMusic(document);
        ctl.play(document.createElement('div'));
        await flush();
        created[0].events.onError();
        expect(ctl.getState().status).toBe('IDLE');

        created[0].events.onReady();
        expect(created[0].playVideo).not.toHaveBeenCalled();
        ctl.destroy();
    });
});
