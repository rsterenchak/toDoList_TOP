// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-13',
        added: [
            'Today dashboard now lists overdue, today, and upcoming todos aggregated across every project, with a count summary and a checkbox plus project pill on each row.',
            'New Calendar view alongside Today and Projects: a month grid with density dots on dates that have todos, plus a side panel listing the selected day\'s tasks.',
        ],
        changed: [
            'View-switch pills moved into the top bar next to the hamburger, and the sidebar PROJECTS label was removed so the project list begins at the sidebar\'s top edge.',
        ],
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
