// Shared Supabase client.
//
// Initialized once at module load and exported as a singleton — every
// other module that needs to talk to Supabase imports `supabase` from
// here. One module owns the lifecycle; everyone else borrows the result.
//
// ── PROVISIONING ──
//
// Two environment variables must be set at build time:
//
//   SUPABASE_URL       — e.g. https://abcdefghij.supabase.co
//   SUPABASE_ANON_KEY  — long JWT starting with `eyJ...`
//
// Both come from your Supabase project's Settings → API page. The anon
// key is safe to expose to the browser (it's literally meant for client-
// side use) — what protects user data is the Row-Level Security policies
// applied in the schema, not the key itself.
//
//   • Local development: set both in a `.env` file at the repo root.
//     Webpack's DefinePlugin (configured via dotenv) substitutes them
//     into `process.env.*` at build time. The `.env` file is gitignored
//     so it never leaves your machine.
//
//   • Production (GitHub Pages): add both as repository secrets and wire
//     them into the deploy workflow's build step. See `.env.example` for
//     the exact variable names.
//
// If either var is missing at build time, the client still constructs
// (createClient doesn't validate the URL beyond shape), but every query
// will fail at runtime. The auth modal in Phase 4 surfaces this clearly.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.SUPABASE_URL      || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';

// Surface a console warning at boot if either is missing — saves a confusing
// "why doesn't anything work" debugging session when you forget to set them.
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.warn(
        '[supabaseClient] Missing SUPABASE_URL or SUPABASE_ANON_KEY at build time. ' +
        'Supabase requests will fail. See .env.example for setup.'
    );
}

// Singleton — one client per page load, shared by every importer.
//
// When SUPABASE_URL is empty (e.g. a test runner with no `.env` file,
// or a build that forgot to pipe the secrets through), createClient
// throws synchronously with "supabaseUrl is required.". The full test
// suite imports listLogic.js which now imports this module, so a throw
// here would brick every test file. The stub below stands in for the
// real client with no-op handlers shaped like the surfaces the rest of
// the codebase actually touches (auth.getSession, from().insert/update/
// delete/select, channel().on().subscribe, removeChannel). Real
// production builds carry the env vars and hit the live createClient
// path below.
function buildStubClient() {
    const noopQuery = {
        select: function() { return Promise.resolve({ data: [], error: null }); },
        insert: function() { return Promise.resolve({ data: null, error: null }); },
        update: function() { return this; },
        delete: function() { return this; },
        eq: function() { return Promise.resolve({ data: null, error: null }); },
        order: function() { return Promise.resolve({ data: [], error: null }); },
    };
    const noopChannel = {
        on: function() { return this; },
        subscribe: function() { return this; },
        unsubscribe: function() { return this; },
    };
    return {
        auth: {
            getSession: function() {
                return Promise.resolve({ data: { session: null }, error: null });
            },
            onAuthStateChange: function() {
                return { data: { subscription: { unsubscribe: function() {} } } };
            },
            signInWithOtp: function() {
                return Promise.resolve({ data: null, error: { message: 'Supabase not configured' } });
            },
            signOut: function() {
                return Promise.resolve({ error: null });
            },
        },
        from: function() { return noopQuery; },
        channel: function() { return noopChannel; },
        removeChannel: function() {},
    };
}

export const supabase = (SUPABASE_URL && SUPABASE_ANON_KEY)
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            // Persist the auth session (JWT) in localStorage so the user
            // stays signed in across page reloads. This is the default but
            // we set it explicitly so the contract is visible.
            persistSession: true,
            // Auto-refresh the JWT in the background as it approaches
            // expiry. Without this, sessions would die after ~1 hour.
            autoRefreshToken: true,
            // Detect the magic-link callback in the URL after the user
            // clicks the email link, exchange it for a session, then clear
            // the hash. Required for the magic-link flow we picked in
            // Phase 1 Decision 2.
            detectSessionInUrl: true,
        },
    })
    : buildStubClient();
