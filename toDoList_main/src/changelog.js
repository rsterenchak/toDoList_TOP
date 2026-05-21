// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-21',
        fixed: [
            "ArrowDown from the TODAY and CALENDAR view pills now lands on the first row card or selected day cell so the next keystroke advances without an extra press.",
            "ArrowDown off the bottom row of the Calendar grid now drops focus into the day-detail list below, and ArrowUp from the first day-detail row returns to the calendar.",
            "ArrowUp / ArrowDown now walk between rows in the Calendar day-detail list, and Enter on a focused row jumps to its parent project.",
            "ArrowLeft / ArrowRight header walk now includes the Calendar month prev / next buttons when the Calendar view is active.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-20',
        fixed: [
            "Pressing Enter on a Calendar day no longer strands keyboard focus on the page body — focus stays on the selected cell so arrow-key navigation keeps working without an extra click.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
