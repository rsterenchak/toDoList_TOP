// Behavioural regression for entry-todo creation losing its description and
// entry id server-side (regression for #entry-text-and-id-lost-on-materialize).
//
// Bug symptom: a task created for an injected entry — chat's Inject & run, or an
// accepted derive proposal, both routed through materializeEntryTodo — reached
// Supabase with `description` and `entry_id` BOTH null, even though local state
// looked correct. The cause was write ordering: the old path called `addToDo`
// (which mints the id and fires a fire-and-forget INSERT carrying an empty
// description and no entry id), then backfilled with `editToDoItem` /
// `stampTodoEntryId` UPDATEs. persistMutation serializes a todo write only behind
// a parent PROJECT insert, not behind a sibling TODO insert, so those UPDATEs
// raced ahead of the INSERT, matched zero rows, and the INSERT then landed with
// the original empty payload.
//
// The fix adds `listLogic.addEntryTodo`, which builds the item complete —
// description AND entry id set — BEFORE its single INSERT is queued, so the one
// write persists both with no follow-up UPDATE needed. These tests exercise that
// write against a mocked Supabase client and assert the captured INSERT row
// (not just in-memory state — an in-memory assertion passed with the bug present)
// carries the description and entry_id.

import { vi } from 'vitest';

import { listLogic } from '../src/listLogic.js';
import { supabase } from '../src/supabaseClient.js';


// Stand up a signed-in session and a supabase.from mock that records every
// insert/update issued against the todos and projects tables. Returns the
// capture arrays so a test can assert on the exact network row shape.
function captureSupabaseWrites() {
    const todoInserts = [];
    const todoUpdates = [];
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValue({
        data: { session: { user: { id: 'user-1' } } },
        error: null,
    });
    vi.spyOn(supabase, 'from').mockImplementation(function (table) {
        const builder = {
            insert: function (row) {
                if (table === 'todos') todoInserts.push(row);
                return Promise.resolve({ data: [row], error: null });
            },
            update: function (row) {
                builder._updateRow = row;
                return builder;
            },
            eq: function () {
                if (table === 'todos' && builder._updateRow) {
                    todoUpdates.push(builder._updateRow);
                }
                return Promise.resolve({ data: [], error: null });
            },
        };
        return builder;
    });
    return { todoInserts, todoUpdates };
}

// persistMutation is async and fire-and-forget (addEntryTodo does not await it),
// so let its microtask chain — getSession, the FK gate, the insert — drain.
async function flushWrites() {
    for (let i = 0; i < 5; i++) {
        await new Promise(function (res) { setTimeout(res, 0); });
    }
}


describe('listLogic.addEntryTodo — the single-insert entry-todo create (regression for #entry-text-and-id-lost-on-materialize)', () => {
    beforeEach(() => {
        listLogic._reset();
        vi.spyOn(console, 'warn').mockImplementation(function () {});
        vi.spyOn(console, 'log').mockImplementation(function () {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        listLogic._reset();
    });

    it('persists the description AND entry_id in the ROW\'S SINGLE INSERT — no racing UPDATE', async () => {
        listLogic.addProject('Inbox');
        const { todoInserts, todoUpdates } = captureSupabaseWrites();
        // Let the project INSERT settle so the FK gate resolves cleanly.
        await flushWrites();

        const entry =
            '- [ ] **[MEDIUM]** Add a widget\n  - Type: feature\n' +
            '  - Description: Renders a widget.\n  - File: `src/widget.js`\n' +
            '  <!-- id: entry-uuid -->';

        const createdId = listLogic.addEntryTodo('Inbox', 'Add a widget', entry, 'entry-uuid');
        expect(createdId).toBeTruthy();

        await flushWrites();

        // Exactly one todos INSERT, and it already carries the full entry text and
        // the entry id — the row is correct server-side with no follow-up UPDATE.
        expect(todoInserts).toHaveLength(1);
        expect(todoInserts[0].id).toBe(createdId);
        expect(todoInserts[0].title).toBe('Add a widget');
        expect(todoInserts[0].description).toBe(entry);
        expect(todoInserts[0].entry_id).toBe('entry-uuid');
        // The bug's tell: the create issued NO update the row's data depends on.
        expect(todoUpdates).toHaveLength(0);
    });

    it('sets desc and entryId on the in-memory item so the row renders locally too', async () => {
        listLogic.addProject('Inbox');
        captureSupabaseWrites();
        await flushWrites();

        const createdId = listLogic.addEntryTodo('Inbox', 'Ship it', 'the entry body', 'ent-9');
        const created = listLogic.listItems('Inbox').find(function (i) { return i.id === createdId; });
        expect(created).toBeTruthy();
        expect(created.desc).toBe('the entry body');
        expect(created.entryId).toBe('ent-9');
    });

    it('creates a brand-new row rather than adopting a pre-existing same-title task', async () => {
        listLogic.addProject('Inbox');
        // A committed task with the same title already exists.
        listLogic.addToDo('Inbox', 'Add a widget');
        const existing = listLogic.listItems('Inbox').find(function (i) { return i.tit === 'Add a widget'; });
        expect(existing).toBeTruthy();

        const { todoInserts } = captureSupabaseWrites();
        await flushWrites();

        const createdId = listLogic.addEntryTodo('Inbox', 'Add a widget', 'entry body', 'ent-1');
        await flushWrites();

        // The returned id is a fresh one, not the pre-existing row's, and the
        // pre-existing task is left untouched.
        expect(createdId).not.toBe(existing.id);
        expect(existing.desc).toBe('');
        expect(todoInserts).toHaveLength(1);
        expect(todoInserts[0].id).toBe(createdId);
    });

    it('omits entry_id from the insert when no entryId is supplied (plain create)', async () => {
        listLogic.addProject('Inbox');
        const { todoInserts } = captureSupabaseWrites();
        await flushWrites();

        listLogic.addEntryTodo('Inbox', 'No marker yet', 'just a description');
        await flushWrites();

        expect(todoInserts).toHaveLength(1);
        expect(todoInserts[0].description).toBe('just a description');
        // The graceful-degradation contract: entry_id is forwarded only when set.
        expect(todoInserts[0].entry_id).toBeUndefined();
    });

    it('returns null and writes nothing when the project is missing or the title is blank', async () => {
        listLogic.addProject('Inbox');
        const { todoInserts } = captureSupabaseWrites();
        await flushWrites();

        expect(listLogic.addEntryTodo('Nope', 'Add a widget', 'e', 'id')).toBeNull();
        expect(listLogic.addEntryTodo('Inbox', '   ', 'e', 'id')).toBeNull();
        await flushWrites();

        expect(todoInserts).toHaveLength(0);
    });
});
