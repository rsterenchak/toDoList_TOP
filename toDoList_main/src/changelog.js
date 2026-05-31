// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-30',
        added: [
            "Injecting a todo now tags its TODO.md entry with a stable id, so re-injecting the same item won't create a duplicate.",
            "Hovering the version label in Settings now reveals the full build string.",
            "A new bottom-right button opens an in-app Claude assistant panel with Chat and Runs tabs.",
            "Chat with Claude in the assistant panel to draft a TODO entry, then ship it with one confirmation while the Runs tab tracks its progress.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-29',
        fixed: [
            "Renaming a project on one device no longer leaves a duplicate copy on your other devices after they sync.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
