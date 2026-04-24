// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-04-24',
        fixed: [
            'Installing the app to the home screen now launches the live app with the correct icon, even when the site is hosted from a GitHub Pages subpath.',
            'Footer version and open/done counts no longer get clipped at the bottom of the viewport on iOS mobile when the todo list is long.',
            'Tapping "Create your first project" on mobile now slides the projects sidebar open and focuses the name input so the soft keyboard appears immediately.',
            'Due-date pill on each todo row now renders a fully enclosed border instead of having its bottom edge cropped flush against the row.',
            'Due-date pill border is now a full pixel wide so the bottom edge no longer drops out on standard-resolution desktop displays.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
