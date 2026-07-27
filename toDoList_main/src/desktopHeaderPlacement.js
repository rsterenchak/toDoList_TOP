// Desktop header consolidation — relocate the workspace pill
// (#mobileProjHeader) and its open/done counts (#mobileProjStats) into the
// top header (#navBar) at desktop widths, and return them to the stacked
// project header inside #mainBar at mobile widths. The nodes are MOVED, not
// duplicated, so their event wiring (drawer open on tap, ‹ › carousel,
// swipe-to-navigate) and the single updateMobileProjHeader writer that
// drives the counts all survive the move. Idempotent: a no-op when the
// nodes already sit in the container matching the current breakpoint, so it
// is safe to call on every resize. The view tabs (#viewSwitcher) have a
// permanent home in #navBar; the pill + counts are inserted just before them
// at desktop, so the header reads pill → counts → view tabs → chip cluster.
//
// Behaviour-preserving: the closed-over DOM nodes it reads (the two nodes that
// shuttle plus the containers/anchors they move between, including the
// #viewSwitcher insertion anchor) arrive as factory deps.
export function createDesktopHeaderPlacement({
    nav,
    main2,
    viewSwitcher,
    mobileProjHeader,
    mobileProjStats,
    mobileProjMain,
    taskFilterBar,
}) {
    function placeDesktopHeader() {
        const desktop = window.innerWidth >= 1024;
        if (desktop) {
            if (mobileProjHeader.parentNode !== nav) {
                nav.insertBefore(mobileProjHeader, viewSwitcher);
            }
            // Counts sit inline to the right of the pill, ahead of the view
            // tabs — lifted out of the pill so they read as header text
            // rather than part of the clickable drawer trigger.
            if (mobileProjStats.parentNode !== nav) {
                nav.insertBefore(mobileProjStats, viewSwitcher);
            }
        } else {
            if (mobileProjHeader.parentNode !== main2) {
                main2.insertBefore(mobileProjHeader, taskFilterBar);
            }
            // Variant C: the counts are the bottom line of the header's left
            // column (#mobileProjMain), not a direct child of the header, so
            // return them there when shuttling back from the desktop navBar.
            if (mobileProjStats.parentNode !== mobileProjMain) {
                mobileProjMain.appendChild(mobileProjStats);
            }
        }
    }

    return { placeDesktopHeader };
}
