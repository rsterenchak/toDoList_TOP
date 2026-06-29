import { sizeMainListGhostSpacer } from '../src/emptyState.js';

// Regression for the trailing black-band bug: the mobile ghost spacer was
// forced to a hard min-height: 200px, so on a project whose task list already
// fills or overflows the viewport, scrolling to the bottom revealed a ~200px
// black band (the dimmed ghost) trailing the content. sizeMainListGhostSpacer
// now makes the spacer conditional — it collapses to zero when the list fills
// the screen and expands to exactly the leftover height when the list is short.
describe('mobile ghost spacer collapse — sizeMainListGhostSpacer', () => {

    let savedMatchMedia;

    function setViewport(matches) {
        window.matchMedia = function (query) {
            return { matches, media: query, addListener() {}, removeListener() {} };
        };
    }

    // jsdom reports 0 for every layout metric, so stub the three the sizer
    // reads. `content` (everything but the spacer) = scrollHeight - spacerH;
    // `remaining` = clientHeight - content.
    function makeMainList({ clientHeight, scrollHeight, spacerHeight, emptyState }) {
        document.body.innerHTML = '';
        const mainList = document.createElement('div');
        mainList.id = 'mainList';
        if (emptyState) mainList.classList.add('emptyStatePresent');

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

    it('collapses the spacer to zero when the visible list overflows the viewport', () => {
        // content = 820 - 0 = 820; remaining = 800 - 820 = -20 (< MIN_GHOST_SPACE).
        const { spacer } = makeMainList({ clientHeight: 800, scrollHeight: 820, spacerHeight: 0 });
        spacer.style.height = '200px';
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(true);
        expect(spacer.style.height).toBe('');
    });

    it('collapses when the leftover gap is a small natural remainder below the ghost footprint', () => {
        // remaining = 800 - 700 = 100, under the ~160px ghost footprint.
        const { spacer } = makeMainList({ clientHeight: 800, scrollHeight: 700, spacerHeight: 0 });
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(true);
        expect(spacer.style.height).toBe('');
    });

    it('expands the spacer to exactly the leftover height when the list is short', () => {
        // content = 300 - 0 = 300; remaining = 800 - 300 = 500 (>= MIN_GHOST_SPACE).
        const { spacer } = makeMainList({ clientHeight: 800, scrollHeight: 300, spacerHeight: 0 });
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(false);
        expect(spacer.style.height).toBe('500px');
    });

    it('excludes the spacer\'s own height from the measurement so it cannot flip-flop', () => {
        // The spacer is currently 200px tall but the underlying content is short.
        // content = (300 incl. spacer) - 200 = 100; remaining = 800 - 100 = 700.
        const { spacer } = makeMainList({ clientHeight: 800, scrollHeight: 300, spacerHeight: 200 });
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(false);
        expect(spacer.style.height).toBe('700px');
    });

    it('is a no-op on desktop (matchMedia does not match the mobile breakpoint)', () => {
        setViewport(false);
        const { spacer } = makeMainList({ clientHeight: 800, scrollHeight: 300, spacerHeight: 0 });
        spacer.style.height = '200px';
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        // Untouched: no collapsed class, inline height left as-is.
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(false);
        expect(spacer.style.height).toBe('200px');
    });

    it('bails when the empty state is present (that CSS rule owns hiding the spacer)', () => {
        const { spacer } = makeMainList({ clientHeight: 800, scrollHeight: 300, spacerHeight: 0, emptyState: true });
        spacer.style.height = '200px';
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(false);
        expect(spacer.style.height).toBe('200px');
    });

    // Wide touch layout: a large-screen touch device clears the 1023px mobile
    // breakpoint (so '(max-width: 1023px)' is false) but still renders the
    // stacked single-column layout where the ghost spacer is painted. The sizer
    // must run there too — otherwise a short list trails a bare #mainList band.
    describe('wide touch layout (≥1024px, coarse pointer)', () => {
        // Query-aware stub: the mobile breakpoint does NOT match, but the
        // wide-touch query DOES — exactly the affected device's state.
        function setWideTouchViewport() {
            window.matchMedia = function (query) {
                const matches = /pointer:\s*coarse/.test(query) && /min-width/.test(query);
                return { matches, media: query, addListener() {}, removeListener() {} };
            };
        }

        it('collapses the spacer to zero when the visible list fills the viewport', () => {
            setWideTouchViewport();
            // content = 820 - 0 = 820; remaining = 800 - 820 = -20 (< MIN_GHOST_SPACE).
            const { spacer } = makeMainList({ clientHeight: 800, scrollHeight: 820, spacerHeight: 0 });
            spacer.style.height = '200px';
            sizeMainListGhostSpacer(document.getElementById('mainList'));
            expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(true);
            expect(spacer.style.height).toBe('');
        });

        it('expands the spacer to the leftover height when the list is short', () => {
            setWideTouchViewport();
            // content = 300 - 0 = 300; remaining = 800 - 300 = 500 (>= MIN_GHOST_SPACE).
            const { spacer } = makeMainList({ clientHeight: 800, scrollHeight: 300, spacerHeight: 0 });
            sizeMainListGhostSpacer(document.getElementById('mainList'));
            expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(false);
            expect(spacer.style.height).toBe('500px');
        });
    });

    // Guard: the wide-touch path must NOT fire on a fine-pointer desktop, where
    // neither query matches and the base `display: none` rule still owns the
    // spacer. Acceptance: true desktop layout stays unchanged.
    it('stays a no-op on fine-pointer desktop (neither breakpoint matches)', () => {
        window.matchMedia = function (query) {
            // Mobile false; the wide-touch query is false because the pointer is
            // fine, not coarse.
            return { matches: false, media: query, addListener() {}, removeListener() {} };
        };
        const { spacer } = makeMainList({ clientHeight: 800, scrollHeight: 300, spacerHeight: 0 });
        spacer.style.height = '200px';
        sizeMainListGhostSpacer(document.getElementById('mainList'));
        expect(spacer.classList.contains('viewGhostSpacer--collapsed')).toBe(false);
        expect(spacer.style.height).toBe('200px');
    });
});
