// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-06',
        fixed: [
            "The Claude chat panel on wide screens now shows its content on first load instead of appearing empty.",
            "On wide screens the workspace pill again shows the project name and ▾ on a single line and opens the projects drawer when you click anywhere on it.",
            "On wide screens, clicking the project pill now reliably opens the projects dropdown every time instead of sometimes doing nothing.",
            "On wide screens, the header rows now have clearer vertical spacing so the workspace pill, view tabs, filter row, and compose row read as distinct sections.",
            "On wide screens, the faint background stripe behind the view tabs is gone, so the tabs sit directly on the page background.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
