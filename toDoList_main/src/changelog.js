// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-18',
        fixed: [
            "Backspace on a focused todo row control (checkbox, date, expand caret, stats, delete) now backs out to row navigation mode instead of jumping into title editing.",
            "Calendar view now stacks the day-detail panel below the calendar grid on wide screens, with the grid capped at 700px and centered so day cells stay readable.",
            "Calendar grid now fills the full content width with square day cells instead of sitting in a narrow centered column.",
            "Calendar view now sits within a horizontal gutter on wide screens so day cells stay sized for readability.",
            "Page scrollbars now match the Void aesthetic — a slim purple thumb on a dark track, lifting to a brighter purple on hover, across every scrollable surface.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
