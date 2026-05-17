// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-17',
        added: [
            'Recurring tasks now expose a stats drawer with hit-rate cards, a contributions grid, a window selector, and a missed-dates list.',
        ],
        fixed: [
            'Nav, sidebar, todo rows, and view-switcher pills now share a unified purple-tinted border and pill style.',
            'Recurring-task stats drawer now expands fully to show the stat cards, contributions grid, and missed-dates list instead of clipping after the first row.',
            'Recurring-task stats grid now shows weekday letters down the left edge and month abbreviations along the top.',
            'Recurring-task stats drawer now summarises miss patterns in one sentence and tucks long miss lists behind a + N more modal grouped by month.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
