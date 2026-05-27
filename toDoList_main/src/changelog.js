// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-26',
        fixed: [
            "Mobile description editor footer buttons no longer overflow the dialog on narrow viewports.",
            "Configure inject row is now available in the mobile Settings menu so the inject Worker can be set up from a phone.",
            "Completing a todo by swiping right on mobile now persists across page refreshes.",
            "Inject to TODO.md button in the desktop description editor now shows its upload-arrow icon centered alongside the label.",
            "Completing a todo from the Today dashboard now persists across page refreshes.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
