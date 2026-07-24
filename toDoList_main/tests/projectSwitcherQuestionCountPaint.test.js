import { vi, beforeEach, afterEach, describe, it, expect } from 'vitest';

// Mounted-DOM regression for the switcher's per-project triage-question paint.
//
// The first attempt at this feature shipped green and hung the app on load: the
// paint (`updateAllProjectQuestionCounts`) was wired to a `childList`/`subtree`
// MutationObserver on the sidebar, and the paint itself inserts a badge span and
// sets `textContent` — both childList mutations — so every paint re-triggered the
// observer, which repainted, forever. Its tests never caught this because they
// only grepped main.js for strings; none mounted a DOM. These tests mount a real
// switcher and assert the paint's re-entrancy and idempotency invariants against
// live DOM, which is the only thing that would have failed on the bad version.
//
// The count SOURCE (getWaitingQuestionCounts) is mocked so the paint's DOM
// behaviour is driven deterministically and can be forced to throw; the source's
// own logic is covered behaviourally in projectSwitcherQuestionCount.test.js. All
// other store exports are the real module (importActual) so importing main.js —
// which pulls the store in transitively — stays intact.

const hoisted = vi.hoisted(() => ({ counts: {}, throws: false, calls: 0 }));

vi.mock('../src/agentQueueStore.js', async (importActual) => {
    const actual = await importActual();
    return {
        ...actual,
        getWaitingQuestionCounts: () => {
            hoisted.calls += 1;
            if (hoisted.throws) throw new Error('boom');
            return hoisted.counts;
        },
    };
});

import { updateAllProjectQuestionCounts } from '../src/main.js';

const flush = () => new Promise((r) => setTimeout(r, 0));

// Build a minimal but faithful sidebar: #sideMa holding one #projChild per name,
// each with a #projInput carrying the committed project name and the trailing
// purple .projBadge the amber count is meant to sit just left of. This mirrors
// the real markup, duplicate `#projChild` / `#projInput` ids and all.
//
// NOTE ON jsdom: a scoped `row.querySelector('#projInput')` — the exact lookup
// the production paint (and projectBadges.js) use — returns null for every row
// past the FIRST when the id is duplicated, a jsdom-only quirk (real browsers
// scope it correctly). So in this environment only the first row's name
// resolves, and any project expected to show a count must sit first. Test
// helpers below therefore address rows by index and read the input by tag, which
// scopes correctly in jsdom.
function mountSwitcher(names) {
    document.body.innerHTML = '';
    const side = document.createElement('div');
    side.id = 'sideMa';
    names.forEach(function (n) {
        const row = document.createElement('div');
        row.id = 'projChild';
        row.className = 'unselectedProject';
        const input = document.createElement('input');
        input.id = 'projInput';
        input.value = n;
        const badge = document.createElement('div');
        badge.className = 'projBadge';
        row.appendChild(input);
        row.appendChild(badge);
        side.appendChild(row);
    });
    document.body.appendChild(side);
    return side;
}

function rowsOf(side) {
    return Array.prototype.slice.call(side.querySelectorAll('#projChild'));
}

beforeEach(() => {
    hoisted.counts = {};
    hoisted.throws = false;
    hoisted.calls = 0;
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('updateAllProjectQuestionCounts — mounted DOM', () => {
    it('stamps an amber count on a project with waiting questions and nothing on the others', () => {
        const side = mountSwitcher(['Alpha', 'Beta']);
        hoisted.counts = { Alpha: 2 };

        updateAllProjectQuestionCounts();

        const [alpha, beta] = rowsOf(side);

        const alphaBadge = alpha.querySelector('.projQuestionCount');
        expect(alphaBadge).not.toBeNull();
        expect(alphaBadge.textContent).toBe('2');
        expect(alpha.classList.contains('hasQuestionCount')).toBe(true);
        expect(alphaBadge.getAttribute('aria-label')).toMatch(/2 triage questions/);
        // Amber pill sits just left of the purple incomplete-count pill.
        expect(alphaBadge.nextElementSibling).toBe(alpha.querySelector('.projBadge'));

        // A project with no waiting question shows no badge and no reveal class.
        expect(beta.querySelector('.projQuestionCount')).toBeNull();
        expect(beta.classList.contains('hasQuestionCount')).toBe(false);
    });

    it('uses the singular label for a single waiting question', () => {
        const side = mountSwitcher(['Alpha']);
        hoisted.counts = { Alpha: 1 };
        updateAllProjectQuestionCounts();
        const badge = rowsOf(side)[0].querySelector('.projQuestionCount');
        expect(badge.textContent).toBe('1');
        expect(badge.getAttribute('aria-label')).toMatch(/1 triage question waiting/);
    });

    it('clears the badge and reveal class when a project drops to zero', () => {
        const side = mountSwitcher(['Alpha']);
        hoisted.counts = { Alpha: 3 };
        updateAllProjectQuestionCounts();
        const alpha = rowsOf(side)[0];
        expect(alpha.classList.contains('hasQuestionCount')).toBe(true);

        hoisted.counts = {}; // question answered elsewhere → count gone
        updateAllProjectQuestionCounts();
        expect(alpha.classList.contains('hasQuestionCount')).toBe(false);
        const badge = alpha.querySelector('.projQuestionCount');
        // The span may linger but must be emptied so it stays hidden by CSS.
        if (badge) expect(badge.textContent).toBe('');
    });

    // (b) idempotency — a second paint with unchanged counts performs ZERO DOM
    // writes. This is the property that breaks the observer loop: no writes means
    // no mutation to feed back into any observer.
    it('performs no DOM writes on a repeat paint with unchanged counts', async () => {
        const side = mountSwitcher(['Alpha', 'Beta']);
        hoisted.counts = { Alpha: 2 };
        updateAllProjectQuestionCounts(); // first paint creates the badge

        let mutations = 0;
        const obs = new MutationObserver(function (records) { mutations += records.length; });
        obs.observe(side, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
        });

        updateAllProjectQuestionCounts(); // counts unchanged → must be a no-op
        await flush();
        obs.disconnect();

        expect(mutations).toBe(0);
    });

    // (a) bounded re-entry — reproduce the #830 wiring (an observer that repaints
    // on sidebar mutations) and prove the idempotent paint makes it CONVERGE
    // instead of looping. On the reverted version this count grew on every flush.
    it('converges to a bounded paint count under a repainting sidebar observer', async () => {
        const side = mountSwitcher(['Alpha', 'Beta']);
        hoisted.counts = { Alpha: 2 };

        // The dangerous wiring from the reverted attempt: repaint on ANY sidebar
        // childList/subtree/attribute mutation.
        const obs = new MutationObserver(function () { updateAllProjectQuestionCounts(); });
        obs.observe(side, { childList: true, subtree: true, attributes: true });

        updateAllProjectQuestionCounts(); // seed paint (creates span, toggles class)
        await flush();
        const afterFirstFlush = hoisted.calls;
        await flush();
        await flush();
        obs.disconnect();

        // Once the DOM matches the counts, the idempotent paint stops mutating, so
        // the observer stops firing and the call count stops growing. A looping
        // (non-idempotent) paint would keep climbing on every flush.
        expect(hoisted.calls).toBe(afterFirstFlush);
        expect(hoisted.calls).toBeLessThanOrEqual(5);
    });

    // (c) render resilience — a throwing count source can never abort the render:
    // every project row is still walked and the list is intact.
    it('still renders every project row when the count source throws', () => {
        const side = mountSwitcher(['Alpha', 'Beta', 'Gamma']);
        hoisted.throws = true;

        expect(() => updateAllProjectQuestionCounts()).not.toThrow();

        // All three rows survive; none carries a (spurious) count.
        expect(side.querySelectorAll('#projChild')).toHaveLength(3);
        side.querySelectorAll('#projChild').forEach(function (row) {
            expect(row.classList.contains('hasQuestionCount')).toBe(false);
            const badge = row.querySelector('.projQuestionCount');
            if (badge) expect(badge.textContent).toBe('');
        });
    });

    it('no-ops safely when the sidebar is absent', () => {
        document.body.innerHTML = ''; // no #sideMa
        hoisted.counts = { Alpha: 2 };
        expect(() => updateAllProjectQuestionCounts()).not.toThrow();
    });
});
