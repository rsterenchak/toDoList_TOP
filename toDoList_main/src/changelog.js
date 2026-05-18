// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-18',
        fixed: [
            "Completing a recurring task today now counts toward the streak, hit rate, and contributions grid immediately instead of waiting for midnight.",
            "Recurring-task stats grid no longer clips the month abbreviation above a single-column window.",
            "Backspace on a focused todo row control (checkbox, date, expand caret, stats, delete) now backs out to row navigation mode instead of jumping into title editing.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-17',
        fixed: [
            'Recurring-task stats drawer now summarises miss patterns in one sentence and tucks long miss lists behind a + N more modal grouped by month.',
            'Switching projects after typing into the blank task placeholder no longer leaves the partial text behind or reveals the row controls on return.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
