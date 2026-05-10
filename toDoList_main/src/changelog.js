// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-10',
        added: [
            'Tab now reaches every todo row control in visual order — checkbox, title, due date, expand caret, delete, and description — and Enter activates the focused one.',
            'Mobile layout now shows a project header with page dots to jump between projects, and the drawer closes via an X button or Escape.',
        ],
        fixed: [
            'Arrow keys now navigate between the projects sidebar, the header buttons, and the footer version label so keyboard users can move across the chrome without tabbing.',
            'Arrow Down from the sidebar toggle now lands on the first project instead of jumping past the sidebar to the first todo.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-09',
        fixed: [
            'Focus Music modal now opens YouTube from a single icon button in its header instead of an arrow on every station row.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
