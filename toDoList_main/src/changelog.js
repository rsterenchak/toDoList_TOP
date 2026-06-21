// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-06-21',
        added: [
            "A new Deep (🧠) send button in the Claude assistant chat composer sends a single message for deeper, heavier-model processing.",
        ],
        fixed: [
            "The Claude assistant's chat composer controls now render as uniform round icon buttons, with the Fast and Deep sends paired together under small labels.",
        ],
    },
    {
        version: '1.1',
        date: '2026-06-20',
        fixed: [
            "The Claude assistant's voice-input button now shows the same purple border and glyph highlight on hover as the other composer buttons.",
            "Switching projects now actually shows or hides the Claude chat pane based on the project's repo configuration, instead of leaving it unchanged.",
            "The app now recovers on its own from a blank screen after an update, refreshing itself automatically instead of needing a manual hard refresh.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
