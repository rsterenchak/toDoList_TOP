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

    it("falls back to 'projects' when a legacy 'inbox' value is persisted", () => {
        // The Inbox view was removed; a persisted 'inbox' is no longer a
        // live token and must fall through to the 'projects' default.
        localStorage.setItem(ACTIVE_VIEW_KEY, 'inbox');
        expect(getActiveView()).toBe('projects');
    });

    it("falls back to 'projects' when a legacy 'today' value is persisted", () => {
        localStorage.setItem(ACTIVE_VIEW_KEY, 'today');
        expect(getActiveView()).toBe('projects');
    });

    it("returns 'projects' when 'projects' is persisted", () => {
        setActiveView('projects');
        expect(getActiveView()).toBe('projects');
    });

    it("falls back to 'projects' when a legacy 'calendar' value is persisted", () => {
        localStorage.setItem(ACTIVE_VIEW_KEY, 'calendar');
        expect(getActiveView()).toBe('projects');
    });

    it("falls back to 'projects' when a retired 'agent' value is persisted", () => {
        // The Agent queue board is no longer reachable through the UI; a
        // persisted 'agent' token must fall through to the 'projects' default
        // rather than booting into a dead board with no way back.
        localStorage.setItem(ACTIVE_VIEW_KEY, 'agent');
        expect(getActiveView()).toBe('projects');
    });

    it("never persists 'agent' — setActiveView('agent') stores 'projects'", () => {
        setActiveView('agent');
        expect(localStorage.getItem(ACTIVE_VIEW_KEY)).toBe('projects');
        expect(getActiveView()).toBe('projects');
    });

    it("still persists 'structure' when selected", () => {
        setActiveView('structure');
        expect(getActiveView()).toBe('structure');
    });

    it("falls back to 'projects' for a stale or hand-edited pref", () => {
        localStorage.setItem(ACTIVE_VIEW_KEY, 'somethingElse');
        expect(getActiveView()).toBe('projects');
    });
});
