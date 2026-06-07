// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-07',
        changed: [
            "The Sort by due checkbox and Expand all button above the task list are now a single Sort menu that can also sort tasks by status (in progress, then active, then ideas).",
        ],
        fixed: [
            "Projects can be deleted again from the desktop project dropdown — right-click or long-press a project for a Delete option, with a confirmation naming the project and how many todos go with it.",
            "The desktop project dropdown's Delete option is reachable again — its menu now opens above the dropdown instead of behind it.",
            "Choosing Rename in the desktop project dropdown now edits the name inline in the row instead of switching to the project.",
            "Choosing Rename in the desktop project dropdown's menu no longer makes the dropdown close — the inline editor opens and stays put while you rename.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
