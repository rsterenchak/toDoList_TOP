// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-25',
        fixed: [
            "Signing in via magic link no longer briefly wipes the sidebar — your projects stay visible without needing a manual refresh.",
            "Sign-in now reliably keeps the freshly loaded sidebar visible on every device, closing a remaining edge case that could blank it out.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-24',
        fixed: [
            "Creating, editing, and reordering todos now reliably syncs across devices, fixing a backend payload mismatch that was silently dropping most writes.",
            "New todos now sync to the cloud the moment you press Enter, instead of waiting for a later refresh to pick them up.",
            "Long todo titles on mobile no longer get clipped when the row is tapped open — the row now grows to fit the wrapped title.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
