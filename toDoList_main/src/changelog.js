// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-23',
        fixed: [
            "Drive sync indicator now correctly returns to green after a successful import or export.",
            "Drive import no longer shows a misleading 'try again' error after a successful restore.",
            "Drive sync indicator now stays green after a Drive import (previously slipped back to amber once the row layout settled).",
            "Drive sync now reconnects automatically on app load for returning users, and a dedicated Connect to Drive option in the menu lets first-time users sign in without exporting or importing first.",
            "Connect to Drive now arms auto-sync immediately on sign-in, and the sync indicator no longer shows the red failure icon when you simply have unsaved local changes.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
