// Loads a repo's guided code tours (src-tours.json) and answers the questions
// every tour surface asks of them: which area a tour belongs to, which tour is
// next, and how far through them the user is.
//
// The generator compiles `codetour.json` into `src-tours.json` beside the source
// manifest on each deploy, so the file lives at the repo's Pages URL. It is
// fetched once per repo per session; any failure (404, network, bad JSON)
// resolves to null, and every tour surface then simply doesn't render.
// Everything below the loader is pure, so the Structure view, the All tours
// sheet and the player all agree on ordering and progress.

import { pagesUrlFor } from './structureRemoteCapture.js';

// About one minute of reading per four steps.
const STEPS_PER_MINUTE = 4;

const tourCache = new Map();

function normalizeTours(doc) {
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.tours)) return null;
    const tours = doc.tours.filter(function (t) {
        return t && typeof t.id === 'string' && Array.isArray(t.steps) && t.steps.length;
    });
    return {
        sections: Array.isArray(doc.sections) ? doc.sections.filter(function (s) { return s && typeof s.id === 'string'; }) : [],
        tours: tours,
    };
}

// The repo's compiled tours `{ sections, tours }`, or null when it has none.
export function loadTours(repo) {
    if (tourCache.has(repo)) return tourCache.get(repo);
    const base = pagesUrlFor(repo);
    let p;
    if (!base || typeof fetch !== 'function') {
        p = Promise.resolve(null);
    } else {
        p = Promise.resolve()
            .then(function () { return fetch(base + 'src-tours.json', { cache: 'no-cache' }); })
            .then(function (res) { return res && res.ok ? res.json() : null; })
            .then(normalizeTours)
            .catch(function () { return null; });
    }
    tourCache.set(repo, p);
    return p;
}

// Drop the per-session cache. A test seam.
export function resetTourCache() {
    tourCache.clear();
}

// The most common `area` among a tour's steps. A tie goes to the first step's
// area (or, if that isn't one of the tied areas, the tied area seen first).
export function tourArea(tour) {
    const steps = tour && Array.isArray(tour.steps) ? tour.steps : [];
    const counts = new Map();
    steps.forEach(function (s) {
        if (s && s.area) counts.set(s.area, (counts.get(s.area) || 0) + 1);
    });
    if (!counts.size) return null;
    let max = 0;
    counts.forEach(function (n) { if (n > max) max = n; });
    const first = steps[0] && steps[0].area;
    if (first && counts.get(first) === max) return first;
    for (let i = 0; i < steps.length; i++) {
        const a = steps[i] && steps[i].area;
        if (a && counts.get(a) === max) return a;
    }
    return null;
}

// Every tour, in section order then file order. Tours whose section isn't
// listed come last, in file order.
export function orderedTours(data) {
    if (!data || !Array.isArray(data.tours)) return [];
    const rank = new Map();
    (data.sections || []).forEach(function (s, i) { rank.set(s.id, i); });
    const last = rank.size;
    return data.tours
        .map(function (t, i) { return { t: t, i: i, r: rank.has(t.section) ? rank.get(t.section) : last }; })
        .sort(function (a, b) { return a.r - b.r || a.i - b.i; })
        .map(function (x) { return x.t; });
}

// The first tour, in section order then file order, that isn't done; null when
// every tour is done (or there are none).
export function nextUnfinished(data, progress) {
    const p = progress || {};
    const list = orderedTours(data);
    for (let i = 0; i < list.length; i++) {
        const rec = p[list[i].id];
        if (!rec || !rec.done) return list[i];
    }
    return null;
}

// `{ done, total, minutesLeft }` across all tours. Minutes count the steps not
// yet reached in unfinished tours, never less than 1 while any remain.
export function tourStats(data, progress) {
    const p = progress || {};
    const list = orderedTours(data);
    let done = 0;
    let remaining = 0;
    list.forEach(function (t) {
        const rec = p[t.id];
        if (rec && rec.done) { done++; return; }
        const at = rec ? Math.min(t.steps.length, Math.max(0, rec.step || 0)) : 0;
        remaining += t.steps.length - at;
    });
    const minutesLeft = done === list.length ? 0 : Math.max(1, Math.ceil(remaining / STEPS_PER_MINUTE));
    return { done: done, total: list.length, minutesLeft: minutesLeft };
}
