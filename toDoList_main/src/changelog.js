// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-29',
        fixed: [
            "The TODO.md viewer card now stays full-height on a project with no open todos but many completed items, instead of collapsing to a sliver.",
            "On mobile the inline TODO.md viewer is now a compact tappable launcher, so it no longer clips to a sliver or overlaps the list when a project has many items.",
            "On mobile the inline TODO.md launcher no longer clips its bottom edge when a project's list fills the screen.",
            "New todos committed without a chosen date now default to today on desktop, matching mobile, so the row reads DUE TODAY.",
            "Renaming a project on one device no longer leaves a duplicate copy on your other devices after they sync.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
