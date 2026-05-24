// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-24',
        added: [
            "Projects and todos now sync to your account, so the same lists show up on every device you sign in on.",
        ],
        fixed: [
            "Sync button now prompts you to sign in again when your Drive session has expired, instead of looking ready and doing nothing when you tap it.",
            "Mobile Settings now surfaces the 'Update available' cue, and the gear button picks up a dot, so the reload prompt isn't desktop-only.",
            "Tapping a todo row on mobile now highlights it as the active card and unclamps long titles so they wrap into readable paragraphs without having to enter edit mode.",
            "Mobile read-mode no longer shows an empty title band on first tap — the title stays visible and wraps to multi-line as intended.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
