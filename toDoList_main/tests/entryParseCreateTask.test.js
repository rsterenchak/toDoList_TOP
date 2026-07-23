import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { beforeEach, describe, it, expect } from 'vitest';

import { parsePastedEntry, commitEntryToActiveProject } from '../src/entryParse.js';
import { listLogic } from '../src/listLogic.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the "turn a chat reply into a task without the clipboard" slice: the
// shared entry parser (single source, imported by both the compose-row paste
// chip and the chat reply action) plus commitEntryToActiveProject, which drives
// the active project's blank placeholder through the same Enter path a typed
// task uses. Source inspection is paired with light DOM instantiation against
// the exported helpers — the full toDoRow commit handler is not wired here, so
// the commit test verifies the drive (desc set on the shared item, title placed
// in the input, an Enter keydown dispatched) rather than the downstream row
// chrome, which its own tests already cover.

describe('parsePastedEntry — shared parser parity', () => {
    it('takes the checkbox headline as the title, stripping the priority marker', () => {
        const raw = '- [ ] **[HIGH]** Add a settings toggle\n  - Type: feature';
        const parsed = parsePastedEntry(raw);
        expect(parsed.title).toBe('Add a settings toggle');
    });

    it('strips a wrapping code fence but keeps the headline in the description', () => {
        const raw = '```md\n- [ ] **[LOW]** Fix the footer\n  - Type: bug\n```';
        const parsed = parsePastedEntry(raw);
        expect(parsed.title).toBe('Fix the footer');
        expect(parsed.description).not.toMatch(/```/);
        expect(parsed.description).toContain('- [ ] **[LOW]** Fix the footer');
    });

    it('drops a trailing Completed note from the title', () => {
        const raw = '- [x] **[MEDIUM]** Ship it — Completed: 2026-01-01 (PR #12)';
        expect(parsePastedEntry(raw).title).toBe('Ship it');
    });

    it('falls back to the first non-empty line when there is no checkbox headline', () => {
        const raw = '\n\nJust a plain reply about the layout\nmore prose';
        expect(parsePastedEntry(raw).title).toBe('Just a plain reply about the layout');
    });

    it('flags an entry that already carries an id marker', () => {
        const withMarker = '- [ ] Reuse me\n<!-- id: abc-123 -->';
        expect(parsePastedEntry(withMarker).hasMarker).toBe(true);
        expect(parsePastedEntry('- [ ] Fresh').hasMarker).toBe(false);
    });

    it('returns an empty title for empty input rather than throwing', () => {
        expect(parsePastedEntry('').title).toBe('');
        expect(parsePastedEntry(null).title).toBe('');
    });
});

describe('commitEntryToActiveProject — drives the active project blank placeholder', () => {
    beforeEach(() => {
        try { localStorage.clear(); } catch (e) { /* ignore */ }
        listLogic._reset();
        document.body.innerHTML = '';
    });

    function mountActiveProject(name) {
        listLogic.addProject(name);
        // Minimal sidebar selection surface that activeProjectNameForViewer reads.
        const proj = document.createElement('div');
        proj.className = 'selectedProject';
        const projInput = document.createElement('input');
        projInput.id = 'projInput';
        projInput.value = name;
        proj.appendChild(projInput);
        document.body.appendChild(proj);
        // A #mainList carrying the blank placeholder's (empty) #toDoInput.
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        const input = document.createElement('input');
        input.id = 'toDoInput';
        input.value = '';
        mainList.appendChild(input);
        document.body.appendChild(mainList);
        return input;
    }

    it('sets the entry text on the shared blank item, fills the input, and dispatches Enter', () => {
        const input = mountActiveProject('Work');
        let dispatched = null;
        input.addEventListener('keydown', (e) => { dispatched = e; });

        const parsed = parsePastedEntry('- [ ] **[HIGH]** Wire the export button\n  - Type: feature');
        const project = commitEntryToActiveProject(parsed);

        expect(project).toBe('Work');
        const blankItem = listLogic.listItems('Work').find((i) => !i.tit);
        expect(blankItem.desc).toBe(parsed.description);
        expect(input.value).toBe('Wire the export button');
        expect(dispatched).not.toBeNull();
        expect(dispatched.key).toBe('Enter');
    });

    it('returns null when no project is selected', () => {
        // #mainList with a blank input, but no .selectedProject.
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        const input = document.createElement('input');
        input.id = 'toDoInput';
        input.value = '';
        mainList.appendChild(input);
        document.body.appendChild(mainList);

        expect(commitEntryToActiveProject(parsePastedEntry('- [ ] Nope'))).toBeNull();
    });

    it('returns null when the active project has no blank placeholder input in #mainList', () => {
        listLogic.addProject('Work');
        const proj = document.createElement('div');
        proj.className = 'selectedProject';
        const projInput = document.createElement('input');
        projInput.id = 'projInput';
        projInput.value = 'Work';
        proj.appendChild(projInput);
        document.body.appendChild(proj);
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        document.body.appendChild(mainList); // no #toDoInput

        expect(commitEntryToActiveProject(parsePastedEntry('- [ ] Nope'))).toBeNull();
    });

    it('returns null for a parse with no title', () => {
        mountActiveProject('Work');
        expect(commitEntryToActiveProject({ title: '', description: '' })).toBeNull();
        expect(commitEntryToActiveProject(null)).toBeNull();
    });
});

describe('wiring — source inspection', () => {
    it('mobileTaskCreate re-exports the parser from the shared module, not a second copy', () => {
        const src = read('mobileTaskCreate.js');
        expect(src).toMatch(/import\s*\{\s*parsePastedEntry\s*\}\s*from\s*['"]\.\/entryParse\.js['"]/);
        expect(src).toMatch(/export\s*\{\s*parsePastedEntry\s*\}/);
        // The inline definition must be gone so the two surfaces can't drift.
        expect(src).not.toMatch(/function\s+parsePastedEntry/);
    });

    it('claudeSheet imports the shared parser + commit helper and mounts the action on assistant bubbles', () => {
        const src = read('claudeSheet.js');
        expect(src).toMatch(/import\s*\{\s*parsePastedEntry,\s*commitEntryToActiveProject\s*\}\s*from\s*['"]\.\/entryParse\.js['"]/);
        expect(src).toMatch(/function mountCreateTaskAction/);
        // Mounted from both the live reply path and the history replay path.
        const mounts = src.match(/mountCreateTaskAction\(/g) || [];
        expect(mounts.length).toBeGreaterThanOrEqual(3); // definition + 2 call sites
        // The action is on assistant bubbles only — the replay call sits in the
        // assistant-role branch.
        expect(src).toMatch(/role === 'assistant'[\s\S]{0,120}mountCreateTaskAction/);
    });

    it('the Create task control carries its styling with the 10px-radius convention', () => {
        const css = read('style.css');
        expect(css).toMatch(/\.claudeMsgCreateTask\s*\{[\s\S]*?border-radius:\s*10px/);
    });
});
