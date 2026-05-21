// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-21',
        fixed: [
            "ArrowUp / ArrowDown now walk between rows in the Calendar day-detail list, and Enter on a focused row jumps to its parent project.",
            "ArrowLeft / ArrowRight header walk now includes the Calendar month prev / next buttons when the Calendar view is active.",
            "Calendar month prev / next buttons are now reachable from the keyboard via ArrowDown from the Calendar pill, with ArrowUp returning to the pill and ArrowDown stepping into the grid.",
            "ArrowUp from a top-row Calendar cell now lands on the side-nearest month prev / next arrow instead of jumping straight to the Calendar pill.",
            "Pressing ArrowLeft on the focused Calendar prev arrow now retreats one month, and ArrowRight on the focused next arrow advances one month.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
