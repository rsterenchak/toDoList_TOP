// Tests for the pure pieces of exportImport.js — payload shape and the
// validator. UI paths (file picker, confirm modal, stale hint) are
// exercised manually; the test suite focuses on the data surface that
// a malformed import file would otherwise leak into the app. The drag-
// and-drop overlay structure is locked in below so the boot-time wiring
// keeps the redesigned full-window perimeter rather than silently
// regressing to a centered card or a no-op listener install.

import { listLogic } from '../src/listLogic.js';
import {
    buildExportPayload,
    parseAndValidateExport,
    attachDragDropImport,
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


describe('exportImport — attachDragDropImport overlay', () => {
    // The boot-time call from main.js was missing for a while, so dropping
    // a .json file silently did nothing. These tests pin both halves of
    // the contract: (1) on coarse-pointer touch devices the listeners are
    // never installed (no overlay, no dropEffect), and (2) on mouse
    // devices, dragging a file in renders the redesigned full-window
    // perimeter — inset dashed border + icon + label + subline — rather
    // than the previous small centered card.

    function installMatchMedia(coarse) {
        window.matchMedia = function(query) {
            const matches = query.indexOf('coarse') !== -1 ? !!coarse : !coarse;
            return {
                matches: matches,
                media: query,
                onchange: null,
                addListener: function() {},
                removeListener: function() {},
                addEventListener: function() {},
                removeEventListener: function() {},
                dispatchEvent: function() { return false; },
            };
        };
    }

    function fireDragEnterWithFile() {
        const event = new Event('dragenter', { bubbles: true, cancelable: true });
        event.dataTransfer = { types: ['Files'] };
        window.dispatchEvent(event);
    }

    afterEach(() => {
        const overlay = document.getElementById('importDropOverlay');
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    });

    it('skips listener install on pointer-coarse (touch) devices', () => {
        installMatchMedia(true);
        attachDragDropImport(function() {});

        fireDragEnterWithFile();
        expect(document.getElementById('importDropOverlay')).toBeNull();
    });

    it('renders the full-window dashed perimeter with icon, label, and subline on drag', () => {
        installMatchMedia(false);
        attachDragDropImport(function() {});

        fireDragEnterWithFile();

        const overlay = document.getElementById('importDropOverlay');
        expect(overlay).not.toBeNull();

        const inner = document.getElementById('importDropOverlayInner');
        expect(inner).not.toBeNull();
        expect(inner.parentNode).toBe(overlay);

        // Icon: inline SVG so no icon-font dependency, sized 44px.
        const icon = document.getElementById('importDropOverlayIcon');
        expect(icon).not.toBeNull();
        expect(icon.tagName.toLowerCase()).toBe('svg');
        expect(icon.getAttribute('width')).toBe('44');

        // Label: exact wording the redesign brief calls for.
        const label = document.getElementById('importDropOverlayLabel');
        expect(label).not.toBeNull();
        expect(label.textContent).toBe('DROP JSON TO IMPORT');

        // Subline: states the destructive overwrite before the modal opens.
        const subline = document.getElementById('importDropOverlaySubline');
        expect(subline).not.toBeNull();
        expect(subline.textContent).toMatch(/replaces all/i);
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
