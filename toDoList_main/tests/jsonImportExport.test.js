// Tests for the pure pieces of jsonImportExport.js — payload shape and
// the validator. The Supabase orchestrators (exportToJson, importFromJson)
// require a live session and a real backend; their wiring is verified at
// the source level via the settings-menu integration tests and exercised
// manually. These tests focus on the data surface a malformed import
// file would otherwise leak into the app and on the roundtrip integrity
// between export and re-import.

import {
    buildExportPayload,
    validateImportShape,
} from '../src/jsonImportExport.js';


describe('jsonImportExport — buildExportPayload', () => {

    it('includes version, exportedAt, projects, and todos', () => {
        const payload = buildExportPayload(
            [{ id: 'p1', name: 'Demo' }],
            [{ id: 't1', project_id: 'p1', title: 'Hello' }],
            new Date('2026-05-25T10:00:00Z')
        );

        expect(payload.version).toBe(1);
        expect(payload.exportedAt).toBe('2026-05-25T10:00:00.000Z');
        expect(Array.isArray(payload.projects)).toBe(true);
        expect(Array.isArray(payload.todos)).toBe(true);
        expect(payload.projects[0].name).toBe('Demo');
        expect(payload.todos[0].title).toBe('Hello');
    });

    it('coerces missing or non-array inputs to empty arrays', () => {
        const payload = buildExportPayload(null, undefined, new Date('2026-05-25T10:00:00Z'));
        expect(payload.projects).toEqual([]);
        expect(payload.todos).toEqual([]);
    });

    it('produces a valid envelope for an empty dataset', () => {
        const payload = buildExportPayload([], [], new Date('2026-05-25T10:00:00Z'));
        expect(payload.version).toBe(1);
        expect(payload.projects).toEqual([]);
        expect(payload.todos).toEqual([]);
    });
});


describe('jsonImportExport — validateImportShape', () => {

    function validProjects() {
        return [{ id: 'p1', name: 'Demo' }];
    }

    function validTodos() {
        return [{ id: 't1', project_id: 'p1', title: 'One' }];
    }

    it('accepts a well-formed v1 envelope', () => {
        const result = validateImportShape({
            version: 1,
            exportedAt: '2026-05-25T10:00:00.000Z',
            projects: validProjects(),
            todos: validTodos(),
        });
        expect(result.valid).toBe(true);
    });

    it('accepts an empty-dataset envelope', () => {
        const result = validateImportShape({
            version: 1,
            exportedAt: '2026-05-25T10:00:00.000Z',
            projects: [],
            todos: [],
        });
        expect(result.valid).toBe(true);
    });

    it('rejects null, primitives, and arrays at the top level', () => {
        expect(validateImportShape(null).valid).toBe(false);
        expect(validateImportShape('a string').valid).toBe(false);
        expect(validateImportShape([1, 2, 3]).valid).toBe(false);
    });

    it('rejects an unsupported version with a clear message', () => {
        const result = validateImportShape({
            version: 99,
            projects: [],
            todos: [],
        });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/unsupported export format/i);
    });

    it('rejects a missing version field', () => {
        const result = validateImportShape({
            projects: [],
            todos: [],
        });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/unsupported export format/i);
    });

    it('rejects when projects or todos is not an array', () => {
        const r1 = validateImportShape({ version: 1, projects: {}, todos: [] });
        expect(r1.valid).toBe(false);

        const r2 = validateImportShape({ version: 1, projects: [], todos: 'nope' });
        expect(r2.valid).toBe(false);
    });

    it('rejects a project row missing id or name', () => {
        const r1 = validateImportShape({
            version: 1,
            projects: [{ name: 'No ID' }],
            todos: [],
        });
        expect(r1.valid).toBe(false);

        const r2 = validateImportShape({
            version: 1,
            projects: [{ id: 'p1' }],
            todos: [],
        });
        expect(r2.valid).toBe(false);
    });

    it('rejects a todo row missing id, project_id, or title', () => {
        const r1 = validateImportShape({
            version: 1,
            projects: validProjects(),
            todos: [{ project_id: 'p1', title: 'No ID' }],
        });
        expect(r1.valid).toBe(false);

        const r2 = validateImportShape({
            version: 1,
            projects: validProjects(),
            todos: [{ id: 't1', title: 'No project' }],
        });
        expect(r2.valid).toBe(false);

        const r3 = validateImportShape({
            version: 1,
            projects: validProjects(),
            todos: [{ id: 't1', project_id: 'p1' }],
        });
        expect(r3.valid).toBe(false);
    });

    it('reports a parse-style error for malformed top-level shapes', () => {
        const result = validateImportShape({
            version: 1,
            projects: validProjects(),
            todos: 'not an array',
        });
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/invalid export file/i);
    });
});


describe('jsonImportExport — roundtrip integrity', () => {

    it('serialised export validates back as a v1 envelope', () => {
        const original = buildExportPayload(
            [
                { id: 'p1', name: 'Project 1', color: null, position: 0 },
                { id: 'p2', name: 'Project 2', color: 'red', position: 1 },
            ],
            [
                {
                    id: 't1',
                    project_id: 'p1',
                    title: 'Item A',
                    description: null,
                    due_date: '2026-05-31',
                    priority: '2',
                    position: 0,
                    completed: false,
                    recurrence: null,
                },
                {
                    id: 't2',
                    project_id: 'p2',
                    title: 'Item B',
                    description: 'details',
                    due_date: null,
                    priority: '1',
                    position: 0,
                    completed: true,
                    recurrence: null,
                },
            ],
            new Date('2026-05-25T10:00:00Z')
        );

        const text = JSON.stringify(original);
        const parsed = JSON.parse(text);

        const validation = validateImportShape(parsed);
        expect(validation.valid).toBe(true);

        // Round-trip preserves identity at the row level — id, name,
        // title, project_id all survive the serialise/parse hop.
        expect(parsed.projects).toEqual(original.projects);
        expect(parsed.todos).toEqual(original.todos);
    });
});
