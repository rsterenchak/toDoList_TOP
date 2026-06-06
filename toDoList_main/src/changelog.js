// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-05',
        changed: [
            "The redundant hamburger button has been removed from the mobile header — tap the project name and chevron to open the menu as before.",
            "The TODAY tab no longer shows its overdue/today/upcoming task dashboard while that view is being reworked.",
            "The bottom-nav tab once labeled TODAY is now labeled INBOX, with a matching inbox tray icon.",
            "The Pomodoro timer button now expands to show a live countdown next to its clock icon, with a purple accent border, while a session is running or paused.",
            "The layout now switches to the mobile view on screens narrower than 1024px instead of 700px, so tablets and medium-width windows get the touch-optimized layout.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
