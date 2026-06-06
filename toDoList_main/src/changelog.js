// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-06',
        changed: [
            "On wide screens the workspace name and open/done counts now sit in the top header, with the Projects / Inbox / Calendar tabs on a slim underlined row beneath it.",
            "On wide screens, clicking the project pill now opens an anchored dropdown to switch projects instead of the slide-in drawer, and the \"open\" count in the header is colored to match its number.",
        ],
        fixed: [
            "The Claude chat panel on wide screens now shows its content on first load instead of appearing empty.",
            "On wide screens the workspace pill again shows the project name and ▾ on a single line and opens the projects drawer when you click anywhere on it.",
            "On wide screens, clicking the project pill now reliably opens the projects dropdown every time instead of sometimes doing nothing.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
