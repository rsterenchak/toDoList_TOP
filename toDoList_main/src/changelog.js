// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-08-09',
        changed: [
            "The pomodoro and music bottom sheet, along with its bottom-edge swipe-up handle, no longer appears on mobile; the bottom tab bar is unchanged.",
        ],
        fixed: [
            "The bottom tab bar's icons and labels stay fully visible in the installed iPhone app when the viewport is stuck short, with the strip beneath the bar reading as part of it.",
            "A backlog run that completed no task now reads as “No change” in the Runs tab instead of Shipped, and takes the name of the task its summary says it picked.",
            "A task whose triage run is queued behind another sweep no longer flips to a stuck badge before its run has had a chance to start.",
            "On iPhone, opening the keyboard now asks the browser to shrink only the visible area instead of the page itself, so the app no longer stays short after the keyboard closes.",
        ],
    },
];

// Convenience for the footer unseen-dot logic. Returns the ISO date string
// of the newest entry, or null when the array is empty.
export function getNewestChangelogDate() {
    if (!changelog.length) return null;
    return changelog[0].date;
}

// Build the changelog entry DOM (one <section.changelogEntry> per release,
// newest-first) and append it into `container`. Shared by the desktop
// footer changelog modal (modals.js) and the mobile Settings → Version
// changelog sheet (mobileSheets.js) so both surfaces render identically
// from a single source of truth. Returns the container for chaining.
export function renderChangelogEntries(container) {
    if (!container) return container;
    changelog.forEach(function(entry) {
        const block = document.createElement('section');
        block.className = 'changelogEntry';

        const heading = document.createElement('div');
        heading.className = 'changelogEntryHeading';

        const ver = document.createElement('span');
        ver.className = 'changelogEntryVersion';
        ver.textContent = 'v' + entry.version;

        const date = document.createElement('span');
        date.className = 'changelogEntryDate';
        date.textContent = entry.date;

        heading.appendChild(ver);
        heading.appendChild(date);
        block.appendChild(heading);

        [
            ['Added',   entry.added],
            ['Changed', entry.changed],
            ['Fixed',   entry.fixed]
        ].forEach(function(pair) {
            const label = pair[0];
            const bullets = pair[1];
            if (!bullets || !bullets.length) return;

            const groupLabel = document.createElement('div');
            groupLabel.className = 'changelogGroupLabel';
            groupLabel.textContent = label;

            const list = document.createElement('ul');
            list.className = 'changelogBullets';
            bullets.forEach(function(text) {
                const li = document.createElement('li');
                li.textContent = text;
                list.appendChild(li);
            });

            block.appendChild(groupLabel);
            block.appendChild(list);
        });

        container.appendChild(block);
    });
    return container;
}
