// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-15',
        fixed: [
            'Top-bar view-switch pills no longer clip into the iOS status bar / Dynamic Island on mobile.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-14',
        fixed: [
            'Top-bar view-switch pills reordered to show PROJECTS first, followed by TODAY and CALENDAR.',
            'Default landing view for first-time or cleared-storage visits switched from TODAY to PROJECTS.',
            'Header arrow-key navigation now walks through the PROJECTS, TODAY, and CALENDAR pills between the hamburger and the right-side icons.',
            'Mobile gets a persistent bottom tab bar for Projects, Today, and Calendar, plus a denser project header with inline open/done count pills.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
