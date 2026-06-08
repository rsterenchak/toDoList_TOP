import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { ACTIVE_VIEW_KEY, getActiveView, setActiveView } from '../src/prefs.js';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the TODAY → INBOX internal rename. The top-level view that was
// previously identified by the 'today' token, the #viewPillToday /
// #mobileTabToday controls, and the #todayView / #todaySections shell is
// now identified by 'inbox' across the routing layer. Only the visible
// tab label changes for the user (TODAY → INBOX); the view still renders
// blank until the INBOX placeholder ships in a follow-up entry.
//
// Deliberately OUT of scope (and asserted to survive): the `.todayRow`
// task-row card and its buildTodayRow / handleTodayCheckboxToggle
// builders, which the Calendar day-detail panel shares, and the
// calendar/due-date "today" semantics (resetCalendarStateToToday,
// todayKey, isToday) that have nothing to do with the view identifier.
describe('TODAY → INBOX internal rename', () => {
    const main = read('main.js');
    const css = read('style.css');

    describe('routing identifier is now "inbox"', () => {
        it('renames the desktop pill to #viewPillInbox with the INBOX label', () => {
            expect(main).toMatch(/viewPillInbox\.id\s*=\s*['"]viewPillInbox['"]/);
            expect(main).toMatch(/viewPillInbox\.textContent\s*=\s*['"]INBOX['"]/);
        });

        it('renames the mobile bottom tab to #mobileTabInbox with the Inbox label and an inbox icon', () => {
            expect(main).toMatch(
                /buildMobileTab\(\s*['"]inbox['"]\s*,\s*['"]Inbox['"]\s*,\s*ICON_INBOX\s*\)/
            );
            expect(main).toMatch(/mobileTabInbox\.id\s*=\s*['"]mobileTabInbox['"]/);
        });

        it('the inbox pill click routes through applyActiveView("inbox")', () => {
            expect(main).toMatch(
                /viewPillInbox\.addEventListener\(\s*'click'[\s\S]{0,200}applyActiveView\(\s*['"]inbox['"]\s*\)/
            );
        });

        it('CSS routes the view off [data-view="inbox"] for #inboxView', () => {
            expect(css).toMatch(/#mainBar\[data-view="inbox"\]\s+#inboxView/);
        });
    });

    describe('no stray "today" view identifiers survive the rename', () => {
        it('drops the old viewPillToday / mobileTabToday control identifiers', () => {
            expect(main).not.toMatch(/viewPillToday/);
            expect(main).not.toMatch(/mobileTabToday/);
        });

        it('drops the old #todayView / #todaySections shell ids in JS and CSS', () => {
            for (const id of ['todayView', 'todaySections', 'todayDateHeader', 'todayEmpty', 'todayCountSummary']) {
                expect(main).not.toMatch(new RegExp(id + "\\.id\\s*=\\s*['\"]" + id + "['\"]"));
                expect(css).not.toMatch(new RegExp('#' + id + '\\b'));
            }
        });

        it('drops the old [data-view="today"] routing value from JS and CSS', () => {
            expect(main).not.toMatch(/data-view="today"|data-view='today'/);
            expect(css).not.toMatch(/\[data-view="today"\]/);
        });
    });

    describe('shared / unrelated "today" code is intentionally preserved', () => {
        it('keeps the Calendar-shared .todayRow row card and its builders', () => {
            // buildTodayRow + handleTodayCheckboxToggle are the shared task-row
            // card the Calendar day-detail panel renders — not a view
            // identifier, so the rename leaves them alone. They now live in
            // calendarView.js (extracted from main.js).
            const calendar = read('calendarView.js');
            expect(calendar).toMatch(/function\s+buildTodayRow\b/);
            expect(calendar).toMatch(/function\s+handleTodayCheckboxToggle\b/);
            expect(calendar).toMatch(/row\.className\s*=\s*['"]todayRow todoRowCard['"]/);
        });

        it('keeps the calendar/due-date "today" date semantics', () => {
            const calendar = read('calendarView.js');
            expect(calendar).toMatch(/function\s+resetCalendarStateToToday\b/);
        });
    });

    describe('persistence migration (prefs.js, runtime)', () => {
        beforeEach(() => localStorage.clear());

        it('setActiveView("inbox") round-trips through getActiveView', () => {
            setActiveView('inbox');
            expect(localStorage.getItem(ACTIVE_VIEW_KEY)).toBe('inbox');
            expect(getActiveView()).toBe('inbox');
        });

        it('migrates a legacy persisted "today" value to "inbox" on read', () => {
            localStorage.setItem(ACTIVE_VIEW_KEY, 'today');
            expect(getActiveView()).toBe('inbox');
        });

        it('an unknown stored value still falls back to projects', () => {
            localStorage.setItem(ACTIVE_VIEW_KEY, 'bogus');
            expect(getActiveView()).toBe('projects');
        });
    });
});
