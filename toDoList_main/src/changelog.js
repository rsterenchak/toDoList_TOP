// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-13',
        added: [
            'New Today dashboard view with a TODAY / PROJECTS pill switcher at the top of the main panel; Today shows a date header and an empty-state placeholder, with item aggregation coming next.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-12',
        fixed: [
            'Mobile sidebar projects list now scrolls internally with a fading bottom edge when many projects exist, keeping the header and add-project button pinned in place.',
            'Mobile sidebar drawer\'s Settings button now centers within the lower half on both axes instead of pinning to the top.',
            'Mobile sidebar drawer\'s projects area now expands to fill the remaining height above the settings and version footer instead of being capped to half the drawer.',
            'Mobile welcome screen now vertically centers the ghost mascot, "Welcome." label, and "+ New project" button within the viewport instead of clustering them in the upper third.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
