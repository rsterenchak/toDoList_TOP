import { listLogic } from '../src/listLogic.js';

// Runtime coverage for getIdeaTodosAcrossProjects — the cross-project query
// backing the INBOX view. It walks the same in-memory `allProjects` model
// the per-project views render from and returns the LIVE item references
// (so the shared entry-#2 status popover can mutate them in place) paired
// with their originating project name, filtered to status==='idea' and
// ordered newest-capture-first by `created_at`.
describe('listLogic.getIdeaTodosAcrossProjects', () => {
    beforeEach(() => {
        listLogic._reset();
    });
    afterEach(() => {
        listLogic._reset();
    });

    // Add a committed todo to a project and return its live item, optionally
    // overriding status / created_at for deterministic assertions.
    function addTodo(project, title, createdAt, status) {
        listLogic.addToDo(project, title);
        const item = listLogic.listItems(project).find((i) => i.tit === title);
        if (status !== undefined) item.status = status;
        if (createdAt !== undefined) item.created_at = createdAt;
        return item;
    }

    it('(a) returns only status==="idea" todos', () => {
        listLogic.addProject('Work');
        addTodo('Work', 'capture me', '2026-01-01T00:00:00.000Z', 'idea');
        addTodo('Work', 'active task', '2026-01-02T00:00:00.000Z', 'active');
        const res = listLogic.getIdeaTodosAcrossProjects();
        expect(res.map((r) => r.item.tit)).toEqual(['capture me']);
    });

    it('(b) excludes active and in_progress todos', () => {
        listLogic.addProject('Work');
        addTodo('Work', 'a', '2026-01-01T00:00:00.000Z', 'active');
        addTodo('Work', 'b', '2026-01-02T00:00:00.000Z', 'in_progress');
        expect(listLogic.getIdeaTodosAcrossProjects()).toEqual([]);
    });

    it('(c) includes the originating project name as metadata', () => {
        listLogic.addProject('Personal');
        addTodo('Personal', 'idea one', '2026-01-01T00:00:00.000Z', 'idea');
        const res = listLogic.getIdeaTodosAcrossProjects();
        expect(res).toHaveLength(1);
        expect(res[0].project).toBe('Personal');
    });

    it('gathers idea captures across multiple projects', () => {
        listLogic.addProject('Work');
        listLogic.addProject('Home');
        addTodo('Work', 'w', '2026-01-01T00:00:00.000Z', 'idea');
        addTodo('Home', 'h', '2026-01-02T00:00:00.000Z', 'idea');
        const res = listLogic.getIdeaTodosAcrossProjects();
        expect(res.map((r) => r.project).sort()).toEqual(['Home', 'Work']);
    });

    it('(d) sorts by created_at descending (newest capture first)', () => {
        listLogic.addProject('Work');
        addTodo('Work', 'oldest', '2026-01-01T00:00:00.000Z', 'idea');
        addTodo('Work', 'newest', '2026-03-01T00:00:00.000Z', 'idea');
        addTodo('Work', 'middle', '2026-02-01T00:00:00.000Z', 'idea');
        const res = listLogic.getIdeaTodosAcrossProjects();
        expect(res.map((r) => r.item.tit)).toEqual(['newest', 'middle', 'oldest']);
    });

    it('sorts todos missing a created_at last so a legacy row cannot jump to the top', () => {
        listLogic.addProject('Work');
        addTodo('Work', 'stamped', '2026-01-01T00:00:00.000Z', 'idea');
        addTodo('Work', 'legacy', null, 'idea');
        const res = listLogic.getIdeaTodosAcrossProjects();
        expect(res.map((r) => r.item.tit)).toEqual(['stamped', 'legacy']);
    });

    it('(g) promoting an idea to active removes it from the next query', () => {
        listLogic.addProject('Work');
        const item = addTodo('Work', 'promote me', '2026-01-01T00:00:00.000Z', 'idea');
        expect(listLogic.getIdeaTodosAcrossProjects()).toHaveLength(1);
        listLogic.setToDoStatus('Work', item, 'active');
        expect(listLogic.getIdeaTodosAcrossProjects()).toEqual([]);
    });

    it('returns the LIVE item reference so the status popover mutates the model in place', () => {
        listLogic.addProject('Work');
        const item = addTodo('Work', 'live', '2026-01-01T00:00:00.000Z', 'idea');
        const res = listLogic.getIdeaTodosAcrossProjects();
        expect(res[0].item).toBe(item);
    });

    it('skips completed idea todos and the blank placeholder', () => {
        listLogic.addProject('Work');
        const done = addTodo('Work', 'done idea', '2026-01-01T00:00:00.000Z', 'idea');
        done.completed = true;
        listLogic.addToDo('Work', ''); // pinned blank placeholder — never a capture
        expect(listLogic.getIdeaTodosAcrossProjects()).toEqual([]);
    });

    it('returns an empty array when no projects or ideas exist', () => {
        expect(listLogic.getIdeaTodosAcrossProjects()).toEqual([]);
    });

    it('stamps a created_at on newly added todos', () => {
        listLogic.addProject('Work');
        listLogic.addToDo('Work', 'fresh');
        const item = listLogic.listItems('Work').find((i) => i.tit === 'fresh');
        expect(typeof item.created_at).toBe('string');
        expect(item.created_at.length).toBeGreaterThan(0);
    });
});
