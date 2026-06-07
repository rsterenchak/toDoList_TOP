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
            "Runs shipped from the chat assistant to a non-default workspace now report their final status instead of staying stuck as queued.",
            "Projects can be deleted again from the desktop project dropdown — right-click or long-press a project for a Delete option, with a confirmation naming the project and how many todos go with it.",
            "The desktop project dropdown's Delete option is reachable again — its menu now opens above the dropdown instead of behind it.",
            "Choosing Rename in the desktop project dropdown now edits the name inline in the row instead of switching to the project.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
