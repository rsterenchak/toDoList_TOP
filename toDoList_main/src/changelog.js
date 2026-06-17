// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-17',
        added: [
            "Your tasks now refresh from the cloud automatically when you return to the app and every few minutes, so data stays in sync across devices.",
            "Live updates from other devices resume automatically when you return to the app after it has been in the background.",
        ],
        changed: [
            "Long lines in the mobile description editor now wrap inside the box instead of running off the right edge.",
            "The Claude chat composer now arranges the attach, mic, text field, and send controls in a single aligned row.",
        ],
        fixed: [
            "Your current project now stays selected when tasks refresh from the cloud, instead of jumping to another project.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
