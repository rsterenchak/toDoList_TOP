// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-12',
        added: [
            'Swipe up from the bottom edge of the screen on mobile to open the utilities sheet, and swipe down on its handle to close it.',
        ],
        fixed: [
            'Mobile project header now switches projects via prev/next chevrons and a horizontal swipe on the title row, replacing the page-dot indicator.',
            'Mobile top chrome now keeps breathing room above the hamburger button, project header, and welcome screen in browser tabs and on non-notched devices.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-11',
        fixed: [
            'Long-pressing a project row on iOS now opens only the app\'s context menu, suppressing the iOS native text-selection handles and callout bar.',
            'Mobile drawer now hides the hamburger toggle while open so only the drawer\'s close button remains in the top-right corner.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
