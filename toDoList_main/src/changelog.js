// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-07',
        fixed: [
            "On desktop, the filter and sort row no longer paints a greyer chrome stripe — its background again matches the view-tab band above it.",
            "On desktop, the view-tab band now paints the same background as the filter and sort row below it, so the two header rows read as one seamless region.",
            "On desktop, the view-tab band now paints its full row, removing the thin grey strip that showed above the view tabs.",
            "On desktop, a visible divider line again separates the Claude chat pane from the view-tab band, so the two no longer blend into one continuous bar.",
            "On desktop, the Claude chat pane's CHAT and RUNS tabs are no longer hidden behind the view-tab band.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
