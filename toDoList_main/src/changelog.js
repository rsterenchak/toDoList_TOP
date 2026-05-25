// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-25',
        fixed: [
            "Recurring-task stats now open in a full-screen modal on narrow phones, with the full contributions grid rendered at desktop size instead of a squeezed recency strip.",
            "Mobile todo rows hide the check-off square so titles get more horizontal room — swipe right to complete still works.",
            "Mobile todo rows now have wider screen-edge gutters so titles don't hug the viewport, with task titles slightly compacted on narrow phones to keep room for text.",
            "Mobile todo rows now show due dates as a single color-coded calendar icon — red overdue, amber due soon, purple future, gray unset — freeing horizontal room for the task title; tap the icon to open the date picker.",
            "Todo rows now open their description on focus and close it on blur, replacing the always-visible dropdown chevron.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
