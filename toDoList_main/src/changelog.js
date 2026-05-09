// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-05-09',
        added: [
            'Press Ctrl+Space anywhere in the app to start, pause, or resume the Pomodoro timer, with a quick status pill confirming the toggle.',
        ],
        fixed: [
            'Focus Music stations now show an Open-in-YouTube link so you can sign in on youtube.com when the embedded player gates playback.',
            'Focus Music modal now opens YouTube from a single icon button in its header instead of an arrow on every station row.',
        ],
    },
    {
        version: '1.1',
        date: '2026-05-07',
        added: [
            'Focus-music popover with curated lofi/ambient stations, paste-your-own YouTube URLs, and auto-pause when a Pomodoro session ends.',
        ],
        changed: [
            'Compact titles toggle removed from the Todo Items header.',
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}
