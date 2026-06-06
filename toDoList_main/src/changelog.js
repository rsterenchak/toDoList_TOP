// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-06',
        added: [
            "On wide screens you can now collapse the Claude chat panel to give your tasks the full width, then reopen it from the edge tab — the choice is remembered.",
        ],
        changed: [
            "On wide screens the Claude chat now appears as a persistent panel beside your tasks instead of a slide-up sheet.",
            "On wide screens the workspace name and open/done counts now sit in the top header, with the Projects / Inbox / Calendar tabs on a slim underlined row beneath it.",
        ],
        fixed: [
            "The Claude chat panel on wide screens now shows its content on first load instead of appearing empty.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-05',
        fixed: [
            "The first-run welcome tour now opens the projects drawer when spotlighting the sample project and the add-project button, so those steps highlight the real controls instead of empty screen edge.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
