// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-31',
        added: [
            "Tap a shipped run in the Claude assistant to open an iterate chat seeded from that change, then draft and ship a follow-up the same way.",
        ],
        fixed: [
            "Tapping a shipped run to iterate now opens the chat instead of failing.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-30',
        added: [
            "Chat with Claude in the assistant panel to draft a TODO entry, then ship it with one confirmation while the Runs tab tracks its progress.",
            "The TODO.md viewer panel can now be collapsed to just its header bar and expanded again with a header toggle.",
        ],
        fixed: [
            "The Claude assistant panel can now be dismissed with a close button on desktop.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
