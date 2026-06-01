// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-01',
        changed: [
            "A run wrongly marked failed now corrects itself to shipped when its change is confirmed merged, so the Runs list stops showing false failures.",
            "The TODO.md viewer panel now starts collapsed, keeping its content hidden until you open it.",
            "The Claude chat file picker now shows a browsable file list for any repo that publishes one, not just the default repo, falling back to free-text paths elsewhere.",
            "A workspace pill in the Claude chat header now switches the whole conversation between repos and starts a fresh chat on change, replacing the file picker's own repo selector.",
        ],
        fixed: [
            "Automated runs whose outcome can't be verified now show \"Unknown\" instead of being falsely marked failed; only confirmed failures read as failed.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
