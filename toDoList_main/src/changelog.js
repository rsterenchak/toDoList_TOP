// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-04-24',
        added: [
            'Task Management can now be installed to the home screen and keeps working offline, with a quiet reload cue in the footer whenever a new version is ready.',
        ],
        fixed: [
            'Installing the app to the home screen now launches the live app with the correct icon, even when the site is hosted from a GitHub Pages subpath.',
        ],
    },
    {
        version: '1.1',
        date: '2026-04-23',
        fixed: [
            'Due date field restored on mobile layouts below 420px.',
            'Drag-and-drop reordering now keeps completed items at the bottom.',
            'Blank todo input now reliably reappears after committing a title, even when the user clicked away and returned before pressing Enter.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
