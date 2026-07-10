import { sizeMainListGhostSpacer } from '../src/emptyState.js';

// Regression for the "that's all for this project" ghost leaking into non-repo
// projects that still have todos: the spacer's visibility used to be a pure
// leftover-height heuristic, so a short list of real items (common on non-repo
// projects, which lack the tall TODO.md viewer card) left enough room for the
// ghost to expand — showing "that's all" even though the project had items.
// sizeMainListGhostSpacer now gates the ghost on the actual committed item
// count: it collapses whenever the selected project has one or more todo items,
// independent of how much vertical room is left, and only runs the leftover-
// height sizing when the item count is truly 0.
describe('mobile ghost spacer item-count gate — sizeMainListGhostSpacer', () => {

    let savedMatchMedia;

    function setViewport(matches) {
        window.matchMedia = function (query) {
            return { matches, media: query, addListener() {}, removeListener() {} };
        };
    }

    // Build a #mainList with `itemValues.length` committed todo rows (each a
    // #toDoChild whose #toDoInput carries a non-blank value) plus the ghost
    // spacer. Blank-input rows model the trailing placeholder row and do NOT
    // count as items. Layout metrics are stubbed exactly as jsdom needs.
    function makeMainList({ clientHeight, scrollHeight, spacerHeight, itemValues = [] }) {
        document.body.innerHTML = '';
        const mainList = document.createElement('div');
        mainList.id = 'mainList';

        itemValues.forEach(function (val) {
            const row = document.createElement('div');
            row.id = 'toDoChild';
            const input = document.createElement('input');
            input.id = 'toDoInput';
            input.value = val;
            row.appendChild(input);
            mainList.appendChild(row);
        });

        const spacer = document.createElement('div');
        spacer.id = 'projectsGhostSpacer';
        spacer.className = 'viewGhostSpacer';
        mainList.appendChild(spacer);
        document.body.appendChild(mainList);

        Object.defineProperty(mainList, 'clientHeight', { value: clientHeight, configurable: true });
        Object.defineProperty(mainList, 'scrollHeight', { value: scrollHeight, configurable: true });
        Object.defineProperty(spacer, 'offsetHeight', { value: spacerHeight, configurable: true });

        return { mainList, spacer };
    }

    beforeEach(() => {
        savedMatchMedia = window.matchMedia;
        setViewport(true);
    });

    afterEach(() => {
        window.matchMedia = savedMatchMedia;
        document.body.innerHTML = '';
    });

    it('collapses the ghost when the project has one committed item even though the list is short', () => {
        // Short list (remaining = 800 - 300 = 500 >= MIN_GHOST_SPACE) would
        // normally expand — but a real item exists, so the ghost must collapse.
        const { spacer } = makeMainList({
            clientHeight: 800, scrollHeight: 300, spacerHeight: 0, itemValues: ['Buy milk'],
        });
        spacer.style.height = '200px';
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(true);
        expect(spacer.style.height).toBe('');
    });

    it('collapses the ghost when the project has several committed items', () => {
        const { spacer } = makeMainList({
            clientHeight: 800, scrollHeight: 300, spacerHeight: 0,
            itemValues: ['A', 'B', 'C'],
        });
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(true);
        expect(spacer.style.height).toBe('');
    });

    it('ignores a blank placeholder row — zero real items still runs the sizing and expands on a short list', () => {
        // One blank-input row (the trailing placeholder) means zero committed
        // items, so the leftover-height sizing runs unchanged and the ghost
        // expands to the full leftover height.
        const { spacer } = makeMainList({
            clientHeight: 800, scrollHeight: 300, spacerHeight: 0, itemValues: [''],
        });
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(false);
        expect(spacer.style.height).toBe('500px');
    });

    it('counts a completed item — a project with only committed items keeps the ghost collapsed', () => {
        const { spacer } = makeMainList({
            clientHeight: 800, scrollHeight: 300, spacerHeight: 0, itemValues: ['Done task'],
        });
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(true);
        expect(spacer.style.height).toBe('');
    });
});
