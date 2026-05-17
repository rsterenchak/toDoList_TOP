// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-17',
        added: [
            'Ghost companion now holds position and reads a tiny book while a Pomodoro session is running, then resumes wandering when the timer pauses or finishes.',
        ],
        fixed: [
            'Nav, sidebar, todo rows, and view-switcher pills now share a unified purple-tinted border and pill style.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-16',
        fixed: [
            'Mobile project header now paints reliably on the Projects view instead of staying hidden after first load.',
            'Mobile project header no longer disappears after switching to Today or Calendar and back to Projects.',
            'Selected project in the collapsed sidebar rail now stands out with a ghost outline and a dot indicator beneath the chip.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
