// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-14',
        fixed: [
            'Sidebar project rows now show a small pill with each project\'s incomplete todo count.',
            'Removed the redundant project-name bar above the todo list; the EXPAND ALL toggle now sits at the right end of the add-task row.',
            'Top-bar view-switch pills reordered to show PROJECTS first, followed by TODAY and CALENDAR.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-13',
        fixed: [
            'TODAY / PROJECTS view-switch pills in the top bar reduced to a more compact size.',
            'Today dashboard rows now share the Projects-view card style with a leading purple-outline project chip and a calendar-icon due pill that recolors amber for items due today or within three days.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
