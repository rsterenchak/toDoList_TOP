// Regression pin: listLogic.js must never reference the column
// `todos.user_id`. The `todos` table intentionally has no `user_id`
// column — per-user access is enforced by RLS using a sub-select
// against the parent project. Three separate PR iterations have
// re-introduced `user_id` references against todos (twice in
// hydrateFromSupabase's filter, once in persistMutation's insert
// payload), each surfacing as a PGRST204 "Could not find the
// 'user_id' column of 'todos' in the schema cache" error at
// runtime. The pattern is readers reasonably assuming every row
// needs user_id and missing the projects-side RLS sub-select.
//
// This is a fast, deterministic static check — read listLogic.js
// as a string and assert that no quoted `'todos'` appears within
// 200 chars of a quoted `'user_id'` (and vice versa). The inline
// comments at the persistMutation insert branch, update branch,
// and hydrateFromSupabase todos query name this test so anyone
// who tries to re-add the reference sees the guard immediately.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(resolve(here, '../src/listLogic.js'), 'utf8');

const TODOS_THEN_USER_ID = /['"]todos['"][\s\S]{0,200}['"]user_id['"]/g;
const USER_ID_THEN_TODOS = /['"]user_id['"][\s\S]{0,200}['"]todos['"]/g;

function collectMatches(re, src) {
    const out = [];
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(src)) !== null) {
        const before = src.slice(0, m.index);
        const line = before.split('\n').length;
        out.push({ line, snippet: m[0] });
    }
    return out;
}

describe('listLogic.js — no todos.user_id schema reference', () => {

    it('sanity: source file is non-empty and contains a todos query', () => {
        expect(SRC.length).toBeGreaterThan(0);
        expect(SRC).toMatch(/['"]todos['"]/);
    });

    it("contains no `'todos'` followed by `'user_id'` within 200 chars", () => {
        const matches = collectMatches(TODOS_THEN_USER_ID, SRC);
        const message = matches.length === 0
            ? ''
            : 'listLogic.js contains forbidden `\'todos\' ... \'user_id\'` window(s):\n'
                + matches.map(function(m) {
                    return '- line ' + m.line + ': ' + m.snippet.replace(/\s+/g, ' ').slice(0, 160);
                }).join('\n')
                + '\n\nThe `todos` table has no user_id column. Per-user access is enforced by RLS via a sub-select against the parent project. Do not add `user_id` to todos queries or payloads.';
        expect(matches.length, message).toBe(0);
    });

    it("contains no `'user_id'` followed by `'todos'` within 200 chars", () => {
        const matches = collectMatches(USER_ID_THEN_TODOS, SRC);
        const message = matches.length === 0
            ? ''
            : 'listLogic.js contains forbidden `\'user_id\' ... \'todos\'` window(s):\n'
                + matches.map(function(m) {
                    return '- line ' + m.line + ': ' + m.snippet.replace(/\s+/g, ' ').slice(0, 160);
                }).join('\n')
                + '\n\nThe `todos` table has no user_id column. Per-user access is enforced by RLS via a sub-select against the parent project. Do not add `user_id` to todos queries or payloads.';
        expect(matches.length, message).toBe(0);
    });

    it('parser sanity: regex matches a deliberately-crafted offending fixture', () => {
        const offending = "supabase.from('todos').select('*').eq('user_id', userId);";
        expect(TODOS_THEN_USER_ID.test(offending)).toBe(true);
        const reverse = "const userIdKey = 'user_id'; const table = 'todos';";
        expect(USER_ID_THEN_TODOS.test(reverse)).toBe(true);
    });

    it('parser sanity: regex does NOT match a bare (unquoted) user_id identifier near a `todos` literal', () => {
        const benign = "const result = supabase.from('todos').insert({ project_id: pid, title: t });";
        TODOS_THEN_USER_ID.lastIndex = 0;
        USER_ID_THEN_TODOS.lastIndex = 0;
        expect(TODOS_THEN_USER_ID.test(benign)).toBe(false);
        expect(USER_ID_THEN_TODOS.test(benign)).toBe(false);
    });
});


// Pull out the body of a top-level function declaration so per-function
// assertions can inspect only the relevant region. Walks braces to find
// the matching close. Mirrors the helper in listLogicSupabase.test.js.
function functionBody(src, name) {
    const declRe = new RegExp('function\\s+' + name + '\\s*\\([^)]*\\)\\s*\\{');
    const match = declRe.exec(src);
    if (!match) return null;
    const openBrace = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = openBrace; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return src.slice(openBrace + 1, i);
        }
    }
    return null;
}


describe('listLogic.js — toProjectRowPayload carries the per-project stages/lifecycle columns', () => {
    // The per-project Conceive stages sync added `stages` (jsonb) and
    // `lifecycle` (text) columns to the projects row. toProjectRowPayload
    // is the single funnel every project write mirrors through, so it must
    // carry both fields or the sync silently no-ops — the green-but-does-
    // nothing failure mode this codebase pins by test rather than by eye.
    const body = functionBody(SRC, 'toProjectRowPayload');

    it('exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    it('includes `stages` sourced from the entry', () => {
        expect(body).toMatch(/stages:\s*entry\.stages/);
    });

    it('includes `lifecycle` defaulting to the default shape', () => {
        // `entry.lifecycle || DEFAULT_LIFECYCLE` — never undefined on the wire.
        expect(body).toMatch(/lifecycle:\s*entry\.lifecycle\s*\|\|/);
    });
});


describe('listLogic.js — toTodoRowPayload carries the injected entry_id column', () => {
    // The cross-device shipped-run dot reads shipped-truth from the shared
    // TODO.md, but needs the injected entry's marker id to sync with the task.
    // toTodoRowPayload is the single funnel every todo write mirrors through, so
    // it must carry entry_id or the id never reaches Supabase and the dot can
    // never agree across devices — the green-but-does-nothing failure mode this
    // codebase pins by test rather than by eye.
    const body = functionBody(SRC, 'toTodoRowPayload');

    it('exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    it('includes `entry_id` sourced from the item, nullable', () => {
        expect(body).toMatch(/entry_id:\s*item\.entryId\s*\|\|\s*null/);
    });

    it('hydrates item.entryId back from the row on the read/merge path', () => {
        // Round-trip: the Supabase-read merge builds items with entryId from the
        // row's entry_id, falling back to a locally-known id when the column is
        // null (pre-migration rows), and degrading to undefined when neither has
        // it so the read path never throws.
        expect(SRC).toMatch(/entryId:\s*t\.entry_id[\s\S]{0,120}\|\|\s*undefined/);
    });
});


describe('listLogic.js — toTodoRowPayload carries the draft_seen_at column', () => {
    // The cross-device DRAFTED badge (a landed generate draft the user hasn't
    // looked at) reads its cleared/uncleared state from draft_seen_at, mirroring
    // entry_reviewed_at. toTodoRowPayload is the single funnel every todo write
    // mirrors through, so it must carry draft_seen_at or opening a draft on one
    // device never clears the badge on another — the green-but-does-nothing
    // failure mode this codebase pins by test rather than by eye.
    const body = functionBody(SRC, 'toTodoRowPayload');

    it('includes `draft_seen_at` sourced from the item, nullable', () => {
        expect(body).toMatch(/draft_seen_at:\s*item\.draftSeenAt\s*\|\|\s*null/);
    });

    it('hydrates item.draftSeenAt back from the row on the read/merge path', () => {
        expect(SRC).toMatch(/draftSeenAt:\s*t\.draft_seen_at[\s\S]{0,120}\|\|\s*undefined/);
    });

    it('forwards draft_seen_at only when set in both persist branches', () => {
        const pm = functionBody(SRC, 'persistMutation');
        const insertIdx = pm.indexOf("op === 'insert'");
        const updateIdx = pm.indexOf("op === 'update'");
        const insertBranch = pm.slice(insertIdx, updateIdx);
        const updateBranch = pm.slice(updateIdx);
        expect(insertBranch).toMatch(/if\s*\(payload\.draft_seen_at\)\s*row\.draft_seen_at\s*=\s*payload\.draft_seen_at/);
        expect(updateBranch).toMatch(/if\s*\(payload\.draft_seen_at\)\s*row\.draft_seen_at\s*=\s*payload\.draft_seen_at/);
    });
});


describe('listLogic.js — persistMutation forwards hide_dates on the projects payload', () => {
    // toProjectRowPayload packs hide_dates, but persistMutation does NOT forward
    // the payload as-is for the projects table — it hand-rebuilds a fixed column
    // whitelist in BOTH the insert and update branches. hide_dates was dropped
    // from both whitelists, so the per-project dates toggle never reached the
    // server: it updated localStorage (showing immediately) but the UPDATE
    // omitted the column, so hydrateFromSupabase read the false default back and
    // the pills reappeared ("worked then came back"). This whitelist has now
    // silently dropped a new column more than once, so pin both branches by test.
    const body = functionBody(SRC, 'persistMutation');

    it('persistMutation exists as a declared function', () => {
        expect(body).toBeTruthy();
    });

    // Split the funnel into its op branches so each projects row object can be
    // asserted independently — a column present in insert but missing from
    // update (or vice versa) is exactly the drift this guard exists to catch.
    const insertIdx = body.indexOf("op === 'insert'");
    const updateIdx = body.indexOf("op === 'update'");
    const insertBranch = body.slice(insertIdx, updateIdx);
    const updateBranch = body.slice(updateIdx);

    it('locates both the insert and update branches', () => {
        expect(insertIdx).toBeGreaterThanOrEqual(0);
        expect(updateIdx).toBeGreaterThan(insertIdx);
    });

    it('forwards hide_dates unconditionally in the insert branch', () => {
        // `!!payload.hide_dates`, not a truthy-only guard: un-hiding a project
        // must persist `false`, or the off state is stranded server-side.
        expect(insertBranch).toMatch(/hide_dates:\s*!!\s*payload\.hide_dates/);
    });

    it('forwards hide_dates unconditionally in the update branch', () => {
        expect(updateBranch).toMatch(/hide_dates:\s*!!\s*payload\.hide_dates/);
    });
});
