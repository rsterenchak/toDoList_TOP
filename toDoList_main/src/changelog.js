// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-07',
        fixed: [
            "The chat assistant's workspace menu now refreshes each time you open it, so a repo added to or removed from the allowlist shows up without a page reload.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-06',
        fixed: [
            "On wide screens, the faint background stripe behind the view tabs is gone, so the tabs sit directly on the page background.",
            "On wide screens, the chat panel's top row now lines up with the task list's view tabs, so both panes start at the same height.",
            "On wide screens, the strip above the chat panel's top row now matches the chat panel's background instead of showing a faint color seam.",
            "Shipping a drafted entry from the chat assistant now lands in the selected workspace repo instead of always going to the default repository.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
