// Behavioural regression for the default landing view.
//
// First-time visitors (and anyone whose localStorage has been cleared)
// should land on the PROJECTS view; users with a persisted preference
// must keep landing on whichever view they last selected.

import {
    ACTIVE_VIEW_KEY,
    getActiveView,
    setActiveView,
} from '../src/prefs.js';

describe('getActiveView — default landing view', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it("returns 'projects' when the key is missing", () => {
        expect(localStorage.getItem(ACTIVE_VIEW_KEY)).toBeNull();
        expect(getActiveView()).toBe('projects');
    });

    it("returns 'inbox' when 'inbox' is persisted", () => {
        setActiveView('inbox');
        expect(getActiveView()).toBe('inbox');
    });

    it("migrates a legacy persisted 'today' value to 'inbox' on read", () => {
        localStorage.setItem(ACTIVE_VIEW_KEY, 'today');
        expect(getActiveView()).toBe('inbox');
    });

    it("returns 'projects' when 'projects' is persisted", () => {
        setActiveView('projects');
        expect(getActiveView()).toBe('projects');
    });

    it("returns 'calendar' when 'calendar' is persisted", () => {
        setActiveView('calendar');
        expect(getActiveView()).toBe('calendar');
    });

    it("falls back to 'projects' for a stale or hand-edited pref", () => {
        localStorage.setItem(ACTIVE_VIEW_KEY, 'somethingElse');
        expect(getActiveView()).toBe('projects');
    });
});
