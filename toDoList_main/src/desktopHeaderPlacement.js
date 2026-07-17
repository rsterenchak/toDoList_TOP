// Desktop header consolidation — relocate the workspace pill
// (#mobileProjHeader) and its open/done counts (#mobileProjStats) into the
// top header (#navBar) at desktop widths, and return them to the stacked
// project header inside #mainBar at mobile widths. The nodes are MOVED, not
// duplicated, so their event wiring (drawer open on tap, ‹ › carousel,
// swipe-to-navigate) and the single updateMobileProjHeader writer that
// drives the counts all survive the move. Idempotent: a no-op when the
// nodes already sit in the container matching the current breakpoint, so it
// is safe to call on every resize. The view tabs already have a permanent
// home in the desktop sub-band; only the pill + counts shuttle across the
// 1024px boundary.
//
// Behaviour-preserving extraction from main.js: the seven closed-over DOM
// nodes it reads (the two nodes that shuttle plus the four containers/anchors
// they move between) arrive as factory deps, so the returned placeDesktopHeader
// body is identical to the inline original.
export function createDesktopHeaderPlacement({
    nav,
    main2,
    pomodoroToggle,
    mobileProjHeader,
    mobileProjStats,
    mobileProjMain,
    taskFilterBar,
}) {
    function placeDesktopHeader() {
        const desktop = window.innerWidth >= 1024;
        if (desktop) {
            if (mobileProjHeader.parentNode !== nav) {
                nav.insertBefore(mobileProjHeader, pomodoroToggle);
            }
            // Counts sit inline to the right of the pill, ahead of the chip
            // cluster — lifted out of the pill so they read as header text
            // rather than part of the clickable drawer trigger.
            if (mobileProjStats.parentNode !== nav) {
                nav.insertBefore(mobileProjStats, pomodoroToggle);
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
