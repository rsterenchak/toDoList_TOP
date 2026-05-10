// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-10',
        added: [
            'Mobile layout now shows a project header with page dots to jump between projects, and the drawer closes via an X button or Escape.',
        ],
        fixed: [
            'Arrow keys now navigate between the projects sidebar, the header buttons, and the footer version label so keyboard users can move across the chrome without tabbing.',
            'Arrow Down from the sidebar toggle now lands on the first project instead of jumping past the sidebar to the first todo.',
        ],
        changed: [
            'Mobile menu drawer slides in from the right with Projects, View, and Appearance sections plus a project-count footer, and tapping a project now keeps the drawer open so you can compare across projects.',
            'Mobile empty-state screens now show a ghost mascot — a purple welcome ghost when no projects exist, a gray ghost on a fresh project, and a green ghost with sparkles when everything is done.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
