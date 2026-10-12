// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-10-11',
        added: [
            'The Structure tab\'s Tasks & projects section now has tours for editing, status, due dates, deleting and undo, reordering, creating projects, filtering and sorting, and adding tasks on mobile, and the How data is saved tour no longer claims a save refreshes the screen.',
            'The Structure tab\'s Pipeline section now has tours for injecting a task into TODO.md, shipping and following a run, the Agent board, A/B/C mockups, generating tasks from a plan, assignment coverage and the TODO.md viewer.',
            'The Structure tab\'s Chat, Structure and Settings, focus & ghost sections now have tours for sending messages, attaching context, choosing models, the Structure tab\'s lenses and code viewer, app lock, export and import, theme and onboarding, focus mode and the ghost, completing the tour catalog.',
            'Names in the Structure tab\'s code viewer can now be tapped to peek at where they are defined, traced further from inside the peek, or opened with a trail bar to step back, with a picker when several definitions match.',
        ],
        changed: [
            'On desktop, the Structure tab\'s Map view now spreads across three columns, with a list of areas on the left, the map and file list in the middle, and the open file\'s code on the right.',
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
