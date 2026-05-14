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

    it("returns 'today' when 'today' is persisted", () => {
        setActiveView('today');
        expect(getActiveView()).toBe('today');
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
