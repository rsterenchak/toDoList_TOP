// Tests for the pure pieces of exportImport.js — payload shape and the
// validator. UI paths (file picker, drag-and-drop overlay, confirm modal,
// stale hint) are exercised manually; the test suite focuses on the data
// surface that a malformed import file would otherwise leak into the app.

import { listLogic } from '../src/listLogic.js';
import {
    buildExportPayload,
    parseAndValidateExport,
    formatRelativeExportedAt,
} from '../src/exportImport.js';


describe('exportImport — payload shape', () => {
    beforeEach(() => {
        listLogic._reset();
    });

    it('buildExportPayload includes version, exportedAt, and projects', () => {
        listLogic.addProject('Demo');
        listLogic.addToDo('Demo', 'Hello');

        const payload = buildExportPayload(new Date('2026-04-28T10:00:00Z'));

        expect(payload.version).toBe(1);
        expect(payload.exportedAt).toBe('2026-04-28T10:00:00.000Z');
        expect(Array.isArray(payload.projects)).toBe(true);
        expect(payload.projects[0].name).toBe('Demo');
        const titles = payload.projects[0].items.map(i => i.tit);
        expect(titles).toContain('Hello');
    });
});


describe('exportImport — parseAndValidateExport', () => {

    it('rejects malformed JSON', () => {
        const result = parseAndValidateExport('not valid json {{{');
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/expected a todos export/i);
    });

    it('rejects payloads with the wrong top-level shape', () => {
        expect(parseAndValidateExport('null').ok).toBe(false);
        expect(parseAndValidateExport('"a string"').ok).toBe(false);
        expect(parseAndValidateExport('[1,2,3]').ok).toBe(false);
    });

    it('rejects payloads missing a numeric version field', () => {
        const r1 = parseAndValidateExport(JSON.stringify({ projects: [] }));
        expect(r1.ok).toBe(false);

        const r2 = parseAndValidateExport(JSON.stringify({ version: 'one', projects: [] }));
        expect(r2.ok).toBe(false);
    });

    it('rejects unsupported version numbers with a clear message', () => {
        const result = parseAndValidateExport(JSON.stringify({ version: 99, projects: [] }));
        expect(result.ok).toBe(false);
        expect(result.error).toMatch(/version/i);
    });

    it('accepts a well-formed v1 export with the array-shape projects field', () => {
        const result = parseAndValidateExport(JSON.stringify({
            version: 1,
            exportedAt: '2026-04-28T10:00:00.000Z',
            projects: [
                { name: 'Demo', items: [{ tit: 'Hello', completed: false, due: '' }], color: null },
            ],
        }));
        expect(result.ok).toBe(true);
        expect(result.projects).toHaveLength(1);
        expect(result.projects[0].name).toBe('Demo');
    });

    it('forgives the legacy object-shape projects field', () => {
        // Older exports (or hand-edited files mirroring the raw localStorage
        // shape) come through as `{ name: { items, color } }`. The validator
        // normalises this to the array shape before returning.
        const result = parseAndValidateExport(JSON.stringify({
            version: 1,
            projects: { Demo: { items: [{ tit: 'Hello' }], color: null } },
        }));
        expect(result.ok).toBe(true);
        expect(result.projects).toHaveLength(1);
        expect(result.projects[0].name).toBe('Demo');
    });

    it('rejects payloads where projects is missing', () => {
        const result = parseAndValidateExport(JSON.stringify({ version: 1 }));
        expect(result.ok).toBe(false);
    });
});


describe('exportImport — formatRelativeExportedAt', () => {
    // Drives both the footer's last-exported label and the ghost menu's
    // Export JSON state pill. The wording ages from "just now" → minutes →
    // hours → days → months → years so the gap softens into a visible
    // backup-reminder over time.
    const now = new Date('2026-05-04T12:00:00Z');

    it('returns "Never synced" when no timestamp is stored', () => {
        expect(formatRelativeExportedAt(null, now)).toBe('Never synced');
        expect(formatRelativeExportedAt(undefined, now)).toBe('Never synced');
        expect(formatRelativeExportedAt('', now)).toBe('Never synced');
    });

    it('returns "Never synced" when the stored value is unparseable', () => {
        expect(formatRelativeExportedAt('not-a-date', now)).toBe('Never synced');
    });

    it('returns "Synced just now" for sub-minute gaps and future-dated stamps', () => {
        expect(formatRelativeExportedAt('2026-05-04T11:59:30Z', now)).toBe('Synced just now');
        // Clock skew or future-stamped file — never claim "in the future".
        expect(formatRelativeExportedAt('2026-05-04T12:30:00Z', now)).toBe('Synced just now');
    });

    it('formats minute, hour, day, month, and year buckets with correct pluralisation', () => {
        // 1 minute → singular.
        expect(formatRelativeExportedAt('2026-05-04T11:59:00Z', now)).toBe('Synced 1 minute ago');
        // 5 minutes → plural.
        expect(formatRelativeExportedAt('2026-05-04T11:55:00Z', now)).toBe('Synced 5 minutes ago');
        // 2 hours.
        expect(formatRelativeExportedAt('2026-05-04T10:00:00Z', now)).toBe('Synced 2 hours ago');
        // 1 day → singular.
        expect(formatRelativeExportedAt('2026-05-03T12:00:00Z', now)).toBe('Synced 1 day ago');
        // 3 days → plural.
        expect(formatRelativeExportedAt('2026-05-01T12:00:00Z', now)).toBe('Synced 3 days ago');
        // ~2 months (60 days).
        expect(formatRelativeExportedAt('2026-03-05T12:00:00Z', now)).toBe('Synced 2 months ago');
        // ~1 year.
        expect(formatRelativeExportedAt('2025-05-04T12:00:00Z', now)).toBe('Synced 1 year ago');
        // ~2 years.
        expect(formatRelativeExportedAt('2024-05-04T12:00:00Z', now)).toBe('Synced 2 years ago');
    });
});


describe('exportImport — round-trip via replaceAllProjects', () => {
    // End-to-end-ish guarantee: export from project A, wipe storage, import
    // the file → identical state restored. Pin the acceptance criterion in
    // TODO.md so a future refactor that changes the snapshot shape catches.
    beforeEach(() => {
        listLogic._reset();
    });

    it('export → wipe → import restores the same project + todo state', () => {
        listLogic.addProject('Source');
        listLogic.addToDo('Source', 'One');
        listLogic.addToDo('Source', 'Two');
        listLogic.setProjectColor('Source', 'red');

        const text = JSON.stringify(buildExportPayload(new Date()));

        listLogic._reset();
        const result = parseAndValidateExport(text);
        expect(result.ok).toBe(true);
        listLogic.replaceAllProjects(result.projects);

        expect(listLogic.listProjectsArray()).toEqual(['Source']);
        const titles = listLogic.listItems('Source').map(i => i.tit);
        expect(titles).toContain('One');
        expect(titles).toContain('Two');
        expect(listLogic.getProjectColor('Source')).toBe('red');
    });
});
