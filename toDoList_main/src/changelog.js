// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-05',
        added: [
            "Tasks now show a workflow-status badge — Active, In Progress, or Idea — and tapping it opens a quick menu to change the status.",
            "Filter pills above the task list (ALL / Active / Ideas) show all tasks, just active work, or just ideas, each with a live count, and your choice is remembered across reloads.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-04',
        changed: [
            "The Claude assistant's chat area and message box now share the main list's background color for a more unified look.",
        ],
        fixed: [
            "The Claude assistant's message box background now reads as a distinct field again instead of blending into the chat area.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-03',
        changed: [
            "The attach (📎) button now sits in the Claude chat composer between the message box and the Send button.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
