// Projects sidebar drawer open/close, extracted from main.js (a
// behaviour-preserving move). The projects sidebar is an overlay drawer at
// every breakpoint: open / close both key off the `sidebar-open` class on
// #sideBar (main1) plus the #sidebarOverlay backdrop. The two DOM nodes the
// pair paints and the three main-local helpers they call (refreshDrawerSections
// on open; start/stopDrawerSpinnerPoll to gate the run-spinner poll on drawer
// state) arrive as factory deps so the returned bodies are identical to the
// inline originals. The spinner-poll helpers are created later in main.js than
// this factory runs, so they are passed as thunks and resolved lazily at
// open/close time — mirroring the original forward reference.
export function createSidebarDrawer({
    main1,
    sidebarOverlay,
    refreshDrawerSections,
    startDrawerSpinnerPoll,
    stopDrawerSpinnerPoll,
}) {
    function openSidebar() {
        // Drawer state could have drifted while it was closed (theme toggled
        // via settings menu, Expand All toggled by Ctrl+Enter, a project
        // added/removed). Re-sync the drawer mirrors so the ON/OFF pills and
        // footer count match reality on every open.
        refreshDrawerSections();
        main1.classList.add('sidebar-open');
        sidebarOverlay.classList.add('visible');
        // Drive the per-project run spinners only while the drawer is open.
        startDrawerSpinnerPoll();
        if (typeof window.bottomSheetRefreshVisibility === 'function') {
            window.bottomSheetRefreshVisibility();
        }
    }

    function closeSidebar() {
        main1.classList.remove('sidebar-open');
        sidebarOverlay.classList.remove('visible');
        // Stop the open-gated run-spinner poll when the drawer closes.
        stopDrawerSpinnerPoll();
        if (typeof window.bottomSheetRefreshVisibility === 'function') {
            window.bottomSheetRefreshVisibility();
        }
    }

    return { openSidebar, closeSidebar };
}
