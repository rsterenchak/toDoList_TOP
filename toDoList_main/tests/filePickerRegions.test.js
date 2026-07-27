import { describe, it, expect, vi, beforeEach } from 'vitest';

// Behavioral pins for the file picker's UI-region rows. The picker surfaces the
// manifest's `regions` array — { selector, label, file, line, files } — above the
// plain file list, so a target can be chosen by what it is on screen ("Filter &
// sort strip") rather than by path, with the owning file resolved underneath.
// The manifest read reaches listLogic (project → target id), inject.js (target
// id → repo), and claudeSheet.js (repo → cached manifest); mock those three seams
// so the picker can be exercised end-to-end in jsdom.

vi.mock('../src/claudeSheet.js', () => ({
    getCachedManifest: vi.fn(),
    loadManifest: vi.fn(),
}));
vi.mock('../src/inject.js', () => ({
    findTargetById: vi.fn(),
}));
vi.mock('../src/listLogic.js', () => ({
    listLogic: { getProjectTargetId: vi.fn(), saveToStorage: vi.fn() },
}));

import { createFilePicker } from '../src/filePicker.js';
import { getCachedManifest } from '../src/claudeSheet.js';
import { findTargetById } from '../src/inject.js';
import { listLogic } from '../src/listLogic.js';

// Warm cache carrying files, regions, and an optional srcRoot — mirrors a real
// manifest whose file/region paths are relative to that root.
function withManifest({ files = [], regions, srcRoot } = {}) {
    listLogic.getProjectTargetId.mockReturnValue('target-1');
    findTargetById.mockReturnValue({ id: 'target-1', repo: 'owner/repo' });
    const manifest = { ok: true, files };
    if (regions !== undefined) manifest.regions = regions;
    if (srcRoot !== undefined) manifest.srcRoot = srcRoot;
    getCachedManifest.mockReturnValue(manifest);
}

function openPicker(textarea) {
    const ta = textarea || document.createElement('textarea');
    const picker = createFilePicker({ projectName: 'P', textarea: ta });
    document.body.appendChild(picker.trigger);
    document.body.appendChild(picker.panel);
    picker.trigger.click();
    return picker;
}

function setSearch(picker, value) {
    const search = picker.panel.querySelector('.filePickSearch');
    search.value = value;
    search.dispatchEvent(new Event('input'));
}

describe('file picker — UI regions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.body.innerHTML = '';
    });

    it('lists regions above files, each with its owning file, under section labels', () => {
        withManifest({
            files: ['src/toDoRow.js', 'src/style.css'],
            regions: [
                { selector: '#taskFilterBar', label: 'Filter & sort strip', file: 'src/taskFilter.js' },
            ],
        });
        const picker = openPicker();

        const regionRows = picker.panel.querySelectorAll('.filePickRegionRow');
        expect(regionRows.length).toBe(1);
        expect(regionRows[0].querySelector('.filePickRegionLabel').textContent).toBe('Filter & sort strip');
        expect(regionRows[0].querySelector('.filePickRegionFile').textContent).toBe('src/taskFilter.js');

        // Two section labels: "UI regions" then "Files".
        const labels = [...picker.panel.querySelectorAll('.filePickSectionLabel')].map((l) => l.textContent);
        expect(labels).toEqual(['UI regions', 'Files']);

        // The region row precedes every plain file row in DOM order.
        const children = [...picker.panel.querySelector('.filePickList').children];
        const firstRegionIdx = children.findIndex((c) => c.classList.contains('filePickRegionRow'));
        const firstFileIdx = children.findIndex((c) => c.classList.contains('filePickRow'));
        expect(firstRegionIdx).toBeGreaterThanOrEqual(0);
        expect(firstFileIdx).toBeGreaterThan(firstRegionIdx);

        const fileRows = picker.panel.querySelectorAll('.filePickRow');
        expect(fileRows.length).toBe(2);
    });

    it('prefixes region owning files with srcRoot, same as plain files', () => {
        withManifest({
            srcRoot: 'toDoList_main/src',
            files: ['style.css'],
            regions: [{ selector: '#bar', label: 'Bar', file: 'taskFilter.js' }],
        });
        const picker = openPicker();
        expect(picker.panel.querySelector('.filePickRegionFile').textContent)
            .toBe('toDoList_main/src/taskFilter.js');
    });

    it('filters on region labels and region file paths as well as file paths', () => {
        withManifest({
            files: ['src/style.css', 'src/toDoRow.js'],
            regions: [
                { selector: '#a', label: 'Filter & sort strip', file: 'src/taskFilter.js' },
                { selector: '#b', label: 'Compose row', file: 'src/compose.js' },
            ],
        });
        const picker = openPicker();

        // Matches the region label only.
        setSearch(picker, 'sort');
        expect(picker.panel.querySelectorAll('.filePickRegionRow').length).toBe(1);
        expect(picker.panel.querySelector('.filePickRegionLabel').textContent).toBe('Filter & sort strip');
        expect(picker.panel.querySelectorAll('.filePickRow').length).toBe(0);

        // Matches a region file path AND a plain file path.
        setSearch(picker, 'todorow');
        expect(picker.panel.querySelectorAll('.filePickRow').length).toBe(1);

        // Matches a region file path token that no label carries.
        setSearch(picker, 'compose');
        expect(picker.panel.querySelectorAll('.filePickRegionRow').length).toBe(1);
        expect(picker.panel.querySelector('.filePickRegionLabel').textContent).toBe('Compose row');
    });

    it('inserts the region owning file into the File: line exactly as a file pick does', () => {
        withManifest({
            srcRoot: 'toDoList_main/src',
            files: [],
            regions: [{ selector: '#bar', label: 'Bar', file: 'taskFilter.js' }],
        });
        const textarea = document.createElement('textarea');
        textarea.value = '- [ ] **[MEDIUM]** Do a thing\n  - Type: feature';
        const picker = openPicker(textarea);
        picker.panel.querySelector('.filePickRegionRow').click();
        expect(textarea.value).toContain('- File: `toDoList_main/src/taskFilter.js`');
        // Panel closes on pick, mirroring a file pick.
        expect(picker.panel.hidden).toBe(true);
    });

    it('folds two regions sharing one owning file into a single row', () => {
        withManifest({
            files: [],
            regions: [
                { selector: '#a', label: 'Header', file: 'src/main.js' },
                { selector: '#b', label: 'Footer', file: 'src/main.js' },
            ],
        });
        const picker = openPicker();

        // One grouped row for the shared file, with both labels on its
        // secondary line (sorted for stable ordering).
        const regionRows = picker.panel.querySelectorAll('.filePickRegionRow');
        expect(regionRows.length).toBe(1);
        expect(regionRows[0].querySelector('.filePickRegionFile').textContent).toBe('src/main.js');
        expect(regionRows[0].querySelector('.filePickRegionLabel').textContent).toBe('Footer, Header');
    });

    it('inserts the grouped file once when its row is picked', () => {
        withManifest({
            files: [],
            regions: [
                { selector: '#a', label: 'Header', file: 'src/main.js' },
                { selector: '#b', label: 'Footer', file: 'src/main.js' },
            ],
        });
        const textarea = document.createElement('textarea');
        textarea.value = '- [ ] **[MEDIUM]** Do a thing\n  - Type: feature';
        const picker = openPicker(textarea);
        picker.panel.querySelector('.filePickRegionRow').click();

        const occurrences = textarea.value.split('`src/main.js`').length - 1;
        expect(occurrences).toBe(1);
    });

    it('leads the grouped row with the prefixed owning file path', () => {
        withManifest({
            srcRoot: 'toDoList_main/src',
            files: [],
            regions: [{ selector: '#bar', label: 'Bar', file: 'taskFilter.js' }],
        });
        const picker = openPicker();
        expect(picker.panel.querySelector('.filePickRegionFile').textContent)
            .toBe('toDoList_main/src/taskFilter.js');
    });

    it('matches a grouped row by a label the "+N more" cap hides from view', () => {
        // Five labels on one file: only four display, but all five stay
        // filter-matchable.
        withManifest({
            files: [],
            regions: [
                { selector: '#a', label: 'Alpha', file: 'src/main.js' },
                { selector: '#b', label: 'Bravo', file: 'src/main.js' },
                { selector: '#c', label: 'Charlie', file: 'src/main.js' },
                { selector: '#d', label: 'Delta', file: 'src/main.js' },
                { selector: '#e', label: 'Zulu', file: 'src/main.js' },
            ],
        });
        const picker = openPicker();

        // Secondary line shows the first four (sorted) plus a "+1 more" suffix.
        const secondary = picker.panel.querySelector('.filePickRegionLabel').textContent;
        expect(secondary).toBe('Alpha, Bravo, Charlie, Delta +1 more');
        expect(secondary).not.toContain('Zulu');

        // Filtering by the hidden label still finds the row.
        setSearch(picker, 'zulu');
        expect(picker.panel.querySelectorAll('.filePickRegionRow').length).toBe(1);
        expect(picker.panel.querySelector('.filePickRegionFile').textContent).toBe('src/main.js');
    });

    it('counts grouped rows against the shared row cap', () => {
        // 30 files, each carrying 3 regions → 30 grouped region rows, not 90.
        const regions = [];
        for (let i = 0; i < 30; i++) {
            for (let j = 0; j < 3; j++) {
                regions.push({ selector: '#r' + i + '_' + j, label: 'R' + i + '_' + j, file: 'src/region-' + i + '.js' });
            }
        }
        const files = Array.from({ length: 40 }, (_, i) => 'src/file-' + i + '.js');
        withManifest({ files, regions });
        const picker = openPicker();

        const regionRows = picker.panel.querySelectorAll('.filePickRegionRow');
        const fileRows = picker.panel.querySelectorAll('.filePickRow');
        // 30 grouped region rows + 40 files = 70 candidates, capped at 60 total.
        expect(regionRows.length).toBe(30);
        expect(fileRows.length).toBe(30);

        const hint = [...picker.panel.querySelectorAll('.filePickEmpty')]
            .find((p) => /narrow/i.test(p.textContent));
        expect(hint).toBeTruthy();
        expect(hint.textContent).toContain('70');
    });

    it('renders only files with no section header when the manifest declares no regions', () => {
        withManifest({ files: ['src/a.js', 'src/b.js'] }); // no regions key
        const picker = openPicker();
        expect(picker.panel.querySelectorAll('.filePickRegionRow').length).toBe(0);
        expect(picker.panel.querySelectorAll('.filePickSectionLabel').length).toBe(0);
        expect(picker.panel.querySelectorAll('.filePickRow').length).toBe(2);
    });

    it('renders only files with no section header when the regions array is empty', () => {
        withManifest({ files: ['src/a.js'], regions: [] });
        const picker = openPicker();
        expect(picker.panel.querySelectorAll('.filePickSectionLabel').length).toBe(0);
        expect(picker.panel.querySelectorAll('.filePickRow').length).toBe(1);
    });

    it('skips a region that carries no owning file', () => {
        withManifest({
            files: ['src/a.js'],
            regions: [
                { selector: '#a', label: 'Has file', file: 'src/keep.js' },
                { selector: '#b', label: 'No file' },
            ],
        });
        const picker = openPicker();
        const regionRows = picker.panel.querySelectorAll('.filePickRegionRow');
        expect(regionRows.length).toBe(1);
        expect(regionRows[0].querySelector('.filePickRegionLabel').textContent).toBe('Has file');
    });

    it('falls back to the selector as the display label when label is missing', () => {
        withManifest({
            files: [],
            regions: [{ selector: '#taskFilterBar', file: 'src/taskFilter.js' }],
        });
        const picker = openPicker();
        expect(picker.panel.querySelector('.filePickRegionLabel').textContent).toBe('#taskFilterBar');
    });

    it('shares the row cap between regions and files, and counts both in the narrow hint', () => {
        const regions = Array.from({ length: 40 }, (_, i) => ({
            selector: '#r' + i, label: 'Region ' + i, file: 'src/region-' + i + '.js',
        }));
        const files = Array.from({ length: 40 }, (_, i) => 'src/file-' + i + '.js');
        withManifest({ files, regions });
        const picker = openPicker();

        const regionRows = picker.panel.querySelectorAll('.filePickRegionRow');
        const fileRows = picker.panel.querySelectorAll('.filePickRow');
        // 40 regions + 40 files = 80 candidates, capped at 60 shown total.
        expect(regionRows.length + fileRows.length).toBe(60);
        // Regions come first, so all 40 regions show and files take the remaining 20.
        expect(regionRows.length).toBe(40);
        expect(fileRows.length).toBe(20);

        const hint = [...picker.panel.querySelectorAll('.filePickEmpty')]
            .find((p) => /narrow/i.test(p.textContent));
        expect(hint).toBeTruthy();
        expect(hint.textContent).toContain('80');
    });
});
