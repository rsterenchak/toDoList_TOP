// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-07',
        fixed: [
            "On desktop, the view-tab band now paints its full row, removing the thin grey strip that showed below the view tabs.",
            "The TODO.md viewer's 'Show completed' control is now a compact icon button with a count badge, so the viewer header no longer clips on narrow mobile screens.",
            "The TODO.md viewer's 'Show completed' control now uses a checkmark icon and moves to the header's right edge, and the redundant fullscreen-expand button was removed to ease crowding.",
            "Inbox cards are now compact one-line cards that no longer clip their content, and tapping a card opens a modal showing its full title and description.",
            "The Inbox card modal's Done button now just closes the card without marking the idea complete, so ideas you've read stay in your Inbox.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
