import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Unit tests for the capture-card plumbing in inject.js: dispatchCapture (a
// Worker dispatch that mirrors dispatchRun) and subscribeRunOutputs (a
// per-capture realtime subscription that mirrors subscribeAgentView's channel
// wiring). dispatchCapture goes through fetch (postToWorker), so it is exercised
// the same way as the other dispatch tests. subscribeRunOutputs goes through the
// supabase client, which is mocked here so the channel wiring is observable.

// A scriptable supabase mock: channel(name) records the name, .on(...) records
// the filter/config and the callback, .subscribe() returns the channel. When
// `noRealtime` is set, channel is not a function so the subscribe path bails.
let channelCalls;
let onCalls;
let removedChannels;
let noRealtime;

const realtimeSupabase = {
    channel(name) {
        channelCalls.push(name);
        const ch = {
            _name: name,
            on(event, config, cb) {
                onCalls.push({ event, config, cb });
                this._cb = cb;
                return this;
            },
            subscribe() { return this; },
        };
        return ch;
    },
    removeChannel(ch) { removedChannels.push(ch); },
};

vi.mock('../src/supabaseClient.js', () => ({
    get supabase() {
        return noRealtime ? { channel: null } : realtimeSupabase;
    },
}));

import { dispatchCapture, subscribeRunOutputs, initInjectConfig } from '../src/inject.js';

let fetchSpy;
let realFetch;

function lastCaptureBody() {
    const call = fetchSpy.mock.calls.find((c) => {
        try { return JSON.parse(c[1].body).dispatch_capture; } catch (e) { return false; }
    });
    return call ? JSON.parse(call[1].body) : null;
}

beforeEach(() => {
    channelCalls = [];
    onCalls = [];
    removedChannels = [];
    noRealtime = false;

    localStorage.setItem('todoapp_injectWorkerUrl', 'https://worker.example/');
    localStorage.setItem('todoapp_injectSharedSecret', 'secret');
    initInjectConfig();

    realFetch = globalThis.fetch;
    fetchSpy = vi.fn(() => Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ dispatched: true }),
    }));
    globalThis.fetch = fetchSpy;
});

afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.clear();
    initInjectConfig();
});

// dispatchCapture mirrors dispatchRun's shape exactly but flips the Worker route
// to `dispatch_capture`, carrying `args`/`project` (empty by default) and the
// same repo/filePath routing plus error vocabulary.
describe('dispatchCapture — worker dispatch_capture payload', () => {
    it('POSTs { dispatch_capture, correlation_id, args, project } and spreads the payload', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ dispatched: true }),
        }));
        const res = await dispatchCapture({ correlationId: 'corr-cap' });
        const body = lastCaptureBody();
        expect(body).toBeTruthy();
        expect(body.dispatch_capture).toBe(true);
        expect(body.correlation_id).toBe('corr-cap');
        expect(body.args).toBe('');
        expect(body.project).toBe('');
        expect(res.ok).toBe(true);
        expect(res.dispatched).toBe(true);
    });

    it('passes args and project through when provided', async () => {
        await dispatchCapture({ correlationId: 'corr-cap', args: '--fast', project: 'proj-7' });
        const body = lastCaptureBody();
        expect(body).toBeTruthy();
        expect(body.args).toBe('--fast');
        expect(body.project).toBe('proj-7');
    });

    it('routes to the passed target repo/filePath so capture runs against the project repo', async () => {
        await dispatchCapture({ correlationId: 'corr-cap', target: { repo: 'owner/other', file_path: 'docs/TODO.md' } });
        const body = lastCaptureBody();
        expect(body).toBeTruthy();
        expect(body.repo).toBe('owner/other');
        expect(body.filePath).toBe('docs/TODO.md');
    });

    it('omits repo/filePath when no target is passed so the Worker default applies', async () => {
        await dispatchCapture({ correlationId: 'corr-cap' });
        const body = lastCaptureBody();
        expect(body).toBeTruthy();
        expect(body.repo).toBeUndefined();
        expect(body.filePath).toBeUndefined();
    });

    it('funnels a transport failure through describeError', async () => {
        fetchSpy.mockImplementationOnce(() => Promise.resolve({ ok: false, status: 500 }));
        const res = await dispatchCapture({ correlationId: 'corr-cap' });
        expect(res.ok).toBe(false);
        expect(res.reason).toBe('Server error 500');
    });
});

// subscribeRunOutputs opens a per-capture channel keyed by correlation id,
// filtered to that id's run_outputs row, invokes onRow(payload.new) on each
// event, and returns the channel for the caller to tear down. It returns null
// when realtime is unavailable so the caller degrades gracefully.
describe('subscribeRunOutputs — per-capture realtime channel', () => {
    it('opens a channel named for the correlation id and filters run_outputs to it', () => {
        const ch = subscribeRunOutputs('corr-cap', () => {});
        expect(channelCalls).toEqual(['run_outputs:corr-cap']);
        expect(onCalls).toHaveLength(1);
        expect(onCalls[0].event).toBe('postgres_changes');
        expect(onCalls[0].config).toEqual({
            event: '*',
            schema: 'public',
            table: 'run_outputs',
            filter: 'correlation_id=eq.corr-cap',
        });
        expect(ch).toBeTruthy();
    });

    it('invokes onRow with payload.new on each event', () => {
        const seen = [];
        subscribeRunOutputs('corr-cap', (row) => seen.push(row));
        const row = { correlation_id: 'corr-cap', status: 'running' };
        onCalls[0].cb({ new: row });
        expect(seen).toEqual([row]);
    });

    it('returns the channel so the caller owns teardown via removeChannel', () => {
        const ch = subscribeRunOutputs('corr-cap', () => {});
        realtimeSupabase.removeChannel(ch);
        expect(removedChannels).toEqual([ch]);
    });

    it('returns null when realtime is unavailable so the caller degrades gracefully', () => {
        noRealtime = true;
        const ch = subscribeRunOutputs('corr-cap', () => {});
        expect(ch).toBeNull();
        expect(channelCalls).toHaveLength(0);
    });

    it('tolerates a missing onRow callback without throwing', () => {
        subscribeRunOutputs('corr-cap', undefined);
        expect(() => onCalls[0].cb({ new: { status: 'done' } })).not.toThrow();
    });
});
