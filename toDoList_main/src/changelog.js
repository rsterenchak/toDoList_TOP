// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-20',
        fixed: [
            "Mobile Calendar view now drops the month-navigation row below the hamburger so the next-month arrow no longer collides with the menu, and Today and Projects fill the empty space under short item lists with a dimmed ghost companion.",
            "ArrowUp / ArrowDown now walk between rows on the Today view and ArrowLeft / ArrowRight / ArrowUp / ArrowDown traverse the Calendar grid, with Enter activating the focused item.",
            "ArrowUp from the first Today row or top-row Calendar cell now jumps back to the matching view pill, and ArrowDown anchors focus on the row card before stepping between rows.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-19',
        fixed: [
            "Pressing ArrowDown on the Today or Calendar header buttons now drops keyboard focus into the visible items list, and ArrowUp from the new-task input returns to the active view pill.",
            "Today and Calendar views on mobile now reserve the iOS status bar / Dynamic Island inset so their titles no longer collide with device chrome, and the Calendar day-detail panel sits flush against the bottom tab bar instead of stranded above it.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
