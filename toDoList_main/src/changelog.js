// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-08',
        fixed: [
            "Deleting a project on one device now sticks across all your devices instead of reappearing after the next sync.",
            "The green ⚡ on project rows now appears only on projects routed to an inject target, and shows on desktop as well as mobile.",
            "The inject ⚡ now appears on project rows in the desktop picker dropdown too, and is now amber instead of green.",
            "The inject ⚡ no longer leaves a stray gap on project picker rows that aren't routed to an inject target.",
        ],
        added: [
            "Project rows show a green ⚡ next to the name when inject is configured.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
