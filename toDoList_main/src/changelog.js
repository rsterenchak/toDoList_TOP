// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-25',
        fixed: [
            "Settings menu now has Export to JSON and Import from JSON options for downloading your data as a portable file or restoring everything from a previously exported file.",
            "Recurring-task stats now show a readable two-row recency strip on narrow phones instead of a squeezed contributions grid.",
            "Recurring-task stats drawer no longer overflows onto the next row on narrow phones — the two-row recency strip and missed-date pills now sit cleanly inside the drawer's border.",
            "Recurring-task stats recency strip on narrow phones now uses a single slim row of 14 cells, eliminating the residual drawer overflow onto the next todo row.",
            "Recurring-task stats drawer's miss-pattern callout and missed-date pills now stay inside the drawer on narrow phones.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
