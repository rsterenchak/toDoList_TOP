// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-22',
        added: [
            "Completing a todo now plays a brief slide-out fade so the check-off action gives clear visual feedback.",
        ],
        fixed: [
            "Replaying the welcome tour now seeds starter todos into an empty active project so every step anchors to real row chrome.",
        ],
    },
    {
        version: '1.1',
        date: '2026-05-21',
        fixed: [
            "ArrowUp from a top-row Calendar cell now lands on the side-nearest month prev / next arrow instead of jumping straight to the Calendar pill.",
            "Pressing ArrowLeft on the focused Calendar prev arrow now retreats one month, and ArrowRight on the focused next arrow advances one month.",
            "Replaying the welcome tour now jumps to the Projects view and seeds a sample project when needed, so callouts always line up with real targets.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
