// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-25',
        fixed: [
            "Sign-in now reliably keeps the freshly loaded sidebar visible on every device, closing a remaining edge case that could blank it out.",
            "The browser console no longer prints hydration debug messages on every sign-in.",
            "Editing an existing todo's title now saves to the cloud — previously the change only persisted locally and could revert on the next refresh.",
            "First sign-in on a device now uploads your existing local projects to the cloud, and signing out clears the local copy so a shared device can't leak data between users.",
            "Removed the Google Drive sync UI now that signing in to your account handles multi-device sync automatically.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
