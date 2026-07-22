import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    mountClaudeSheet,
    openChatWithTask,
    getActiveChatTask,
} from '../src/claudeSheet.js';
import { listLogic } from '../src/listLogic.js';

// claudeSheet → inject → supabaseClient. Stub the shared client so mounting the
// sheet never reaches the network (mirrors the other claudeSheet runtime tests).
vi.mock('../src/supabaseClient.js', () => {
    function makeQuery() {
        const q = {
            select: function() { return q; },
            order: function() { return Promise.resolve({ data: [], error: null }); },
            insert: function() { return Promise.resolve({ data: null, error: null }); },
            update: function() { return q; },
            delete: function() { return q; },
            eq: function() { return Promise.resolve({ data: null, error: null }); },
        };
        return q;
    }
    return {
        supabase: {
            auth: {
                getSession: function() { return Promise.resolve({ data: { session: null }, error: null }); },
                onAuthStateChange: function() { return { data: { subscription: { unsubscribe: function() {} } } }; },
                signInWithOtp: function() { return Promise.resolve({ data: null, error: { message: 'x' } }); },
                signOut: function() { return Promise.resolve({ error: null }); },
            },
            from: function() { return makeQuery(); },
            channel: function() { return { on: function() { return this; }, subscribe: function() { return this; }, unsubscribe: function() { return this; } }; },
            removeChannel: function() {},
        },
    };
});

const CHAT_TASK_KEY = 'todoapp_claudeChatTask';
const DEFAULT_REPO = 'rsterenchak/toDoList_TOP';

function seedTodo(projectName, title, desc) {
    listLogic.addProject(projectName);
    listLogic.addToDo(projectName, title);
    const item = listLogic.listItems(projectName).find((i) => i.tit === title);
    if (desc != null) item.desc = desc;
    return item;
}

function scopeChip() {
    return document.getElementById('claudeScopeChip');
}

// The task-scope chip + attachment lifecycle: attaching a task from a row's
// "Discuss" action scopes the whole conversation to it, the chip renders it
// (with a detach control), the id persists per repo, and every reset path
// (detach / New Chat / deleted task) collapses it back to unscoped.
describe('claudeSheet — task scope chip + attachment', () => {
    beforeEach(() => {
        localStorage.clear();
        document.body.innerHTML = '';
        document.body.className = '';
        listLogic._reset();
        mountClaudeSheet(document.body);
    });

    it('renders an "Unscoped" chip and no attachment on a fresh mount', () => {
        expect(getActiveChatTask()).toBe(null);
        const chip = scopeChip();
        expect(chip).toBeTruthy();
        expect(chip.textContent).toContain('Unscoped');
        expect(chip.querySelector('.claudeScopeChipRemove')).toBe(null);
    });

    it('openChatWithTask attaches the task, renders its title, and persists the id', () => {
        const item = seedTodo('Proj', 'Add a widget', 'Under the header');
        openChatWithTask(item.id);

        expect(getActiveChatTask()).toBe(item.id);
        const chip = scopeChip();
        expect(chip.textContent).toContain('Add a widget');
        expect(chip.querySelector('.claudeScopeChipRemove')).toBeTruthy();
        expect(chip.querySelector('.claudeScopeChipTag--scoped')).toBeTruthy();

        const persisted = JSON.parse(localStorage.getItem(CHAT_TASK_KEY));
        expect(persisted[DEFAULT_REPO]).toBe(item.id);
    });

    it('ignores an unresolved id and stays unscoped', () => {
        openChatWithTask('no-such-todo');
        expect(getActiveChatTask()).toBe(null);
        expect(scopeChip().textContent).toContain('Unscoped');
    });

    it('the chip reflects a live rename', () => {
        const item = seedTodo('Proj', 'Old name', '');
        openChatWithTask(item.id);
        item.tit = 'New name';
        // Re-mount (reload) to force a fresh render from the persisted id.
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        expect(scopeChip().textContent).toContain('New name');
    });

    it('the detach control clears the attachment and its persisted id', () => {
        const item = seedTodo('Proj', 'Detach me', '');
        openChatWithTask(item.id);
        expect(getActiveChatTask()).toBe(item.id);

        scopeChip().querySelector('.claudeScopeChipRemove').click();

        expect(getActiveChatTask()).toBe(null);
        expect(scopeChip().textContent).toContain('Unscoped');
        const persisted = JSON.parse(localStorage.getItem(CHAT_TASK_KEY) || '{}');
        expect(persisted[DEFAULT_REPO]).toBeUndefined();
    });

    it('attaching a different task replaces the current one (at most one)', () => {
        const a = seedTodo('Proj', 'Task A', '');
        const b = seedTodo('Proj', 'Task B', '');
        openChatWithTask(a.id);
        openChatWithTask(b.id);
        expect(getActiveChatTask()).toBe(b.id);
        expect(scopeChip().textContent).toContain('Task B');
        expect(scopeChip().textContent).not.toContain('Task A');
    });

    it('"+ New Chat" clears the attachment along with the transcript', () => {
        const item = seedTodo('Proj', 'Scoped task', '');
        openChatWithTask(item.id);
        expect(getActiveChatTask()).toBe(item.id);

        document.getElementById('claudeClearChat').click();

        expect(getActiveChatTask()).toBe(null);
        expect(scopeChip().textContent).toContain('Unscoped');
        const persisted = JSON.parse(localStorage.getItem(CHAT_TASK_KEY) || '{}');
        expect(persisted[DEFAULT_REPO]).toBeUndefined();
    });

    it('a deleted task self-heals to unscoped on re-render', () => {
        const item = seedTodo('Proj', 'Doomed', '');
        openChatWithTask(item.id);
        expect(getActiveChatTask()).toBe(item.id);

        listLogic.removeToDoByItem('Proj', item);
        // Re-mount (reload) hydrates the stored id, but getTodoById no longer
        // resolves it, so renderScopeChip drops the dead attachment.
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);

        expect(getActiveChatTask()).toBe(null);
        expect(scopeChip().textContent).toContain('Unscoped');
        const persisted = JSON.parse(localStorage.getItem(CHAT_TASK_KEY) || '{}');
        expect(persisted[DEFAULT_REPO]).toBeUndefined();
    });

    it('the attachment survives a re-mount (reload) within the session', () => {
        const item = seedTodo('Proj', 'Persist me', 'body');
        openChatWithTask(item.id);
        document.body.innerHTML = '';
        mountClaudeSheet(document.body);
        expect(getActiveChatTask()).toBe(item.id);
        expect(scopeChip().textContent).toContain('Persist me');
    });
});

// Guard the toDoRow "Discuss" wiring: the row must reach the sheet through the
// registered handler, never by importing claudeSheet directly (that would close
// the toDoRow → claudeSheet → modals → toDoRow cycle inject.js documents).
describe('toDoRow Discuss wiring', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = (rel) => readFileSync(resolve(here, '../src', rel), 'utf8');

    it('toDoRow does not import claudeSheet.js', () => {
        expect(src('toDoRow.js')).not.toMatch(/from ['"]\.\/claudeSheet\.js['"]/);
    });

    it('toDoRow exposes a Discuss handler setter and a discussBtn', () => {
        const code = src('toDoRow.js');
        expect(code).toContain('export function setDiscussTaskHandler');
        expect(code).toContain('discussBtn');
    });

    it('main.js wires the Discuss handler to openChatWithTask', () => {
        const code = src('main.js');
        expect(code).toContain('setDiscussTaskHandler');
        expect(code).toContain('openChatWithTask');
    });
});
