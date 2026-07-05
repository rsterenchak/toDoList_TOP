// Hardcoded changelog entries for the footer version modal. Newest-first.
// Each entry: { version, date (ISO YYYY-MM-DD), added?, fixed?, changed? }.
// Add new releases to the top of the array; the modal renders order as-is
// and the footer unseen-dot compares `date` against todoapp_changelogLastSeen.
export const changelog = [
    {
        version: '1.1',
        date: '2026-07-05',
        fixed: [
            "The Agent board now reliably settles dispatched runs to Shipped or Stuck, catching up runs that finished while the tab was closed instead of leaving cards stuck as queued.",
            "Agent mockup cards now reveal the exact copy-ready prompt to paste into Claude, with its own Copy button, instead of showing a separate raw context bundle.",
        ],
        added: [
            "A Run button in the Agent tab starts a triage sweep for the current project, and answering an agent's question now auto-starts one so the follow-up loop runs hands-off.",
            "Agent tasks that need a mockup now have a launcher: tap to copy a ready-to-paste prompt into Claude, then paste the finished entry back to queue it for dispatch.",
        ],
    },
    {
        version: '1.1',
        date: '2026-07-04',
        fixed: [
            "The expanded TODO.md viewer card now resizes when a todo description opens or closes, so its panel no longer overruns and overlaps neighboring rows.",
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
