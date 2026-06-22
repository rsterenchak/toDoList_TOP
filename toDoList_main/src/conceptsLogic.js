// Data model for the Conceive view's "concepts" — incubating project ideas
// walked through a set of lifecycle stages before they graduate into real
// projects. This module owns the concept list and its localStorage cache the
// same way listLogic.js owns the project model: every mutation routes through
// here and writes the cache through one save helper, so the view modules never
// touch localStorage directly (see CLAUDE.md "Source file organization").
//
// Concepts persist to localStorage only for now under the `todoapp_concepts`
// key (the offline-cache layer; Supabase mirroring is a separate follow-up).
// The shape maps cleanly to a future `concepts` row — the ordered `stages`
// array serializes directly to a future `concepts.stages` jsonb column:
//   { id, title, lifecycle, stages: [{ id, label, body }], createdAt,
//     updatedAt, pos }
//
// Stages are stored as an ordered LIST, not fixed fields, so alternate stage
// sets (Lean MVP, Design Thinking, …) can ship later as presets rather than a
// schema migration. This entry only seeds the SDLC set.

export const CONCEPTS_KEY = 'todoapp_concepts';

// The seed stage labels for a freshly-created SDLC concept, in render order.
export const SDLC_STAGE_LABELS = [
    'Why',
    'Concept',
    'Requirements',
    'Design',
    'Build plan',
];

export const DEFAULT_LIFECYCLE = 'SDLC';

// ── UUID HELPER ──────────────────────────────────────────────────────
// crypto.randomUUID is available on every browser since 2021 and inside
// jsdom (which the test suite runs under). Fall back to a random-ish id so a
// stripped-down runtime without crypto doesn't crash — the persistence layer
// treats ids as opaque strings.
function genId() {
    if (typeof globalThis !== 'undefined'
        && globalThis.crypto
        && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return 'c-' + Math.random().toString(36).slice(2) + '-' + Date.now().toString(36);
}

function nowIso() {
    return new Date().toISOString();
}

// In-memory mirror of the persisted concept list. Loaded once at import and
// re-derivable via reloadConcepts() (used by tests and any future restore).
let concepts = [];

// HELPER: persist the current concept list to localStorage. Wrapped in
// try/catch so private-browsing or quota-exceeded states degrade silently to
// an in-memory-only session rather than taking down the rest of the app
// (mirrors the prefs.js convention).
function save() {
    try {
        localStorage.setItem(CONCEPTS_KEY, JSON.stringify(concepts));
    } catch (e) { /* ignore quota/private-mode */ }
}

// Re-read the concept list from localStorage into the in-memory mirror. Any
// parse failure or non-array payload resets to an empty list rather than
// throwing, so a hand-edited or corrupt cache can't desync the renderer.
export function reloadConcepts() {
    try {
        const raw = localStorage.getItem(CONCEPTS_KEY);
        if (!raw) { concepts = []; return concepts; }
        const parsed = JSON.parse(raw);
        concepts = Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        concepts = [];
    }
    return concepts;
}

reloadConcepts();

// Build the ordered SDLC stage list, each stage seeded with an empty body.
function seedStages() {
    return SDLC_STAGE_LABELS.map(function (label) {
        return { id: genId(), label: label, body: '' };
    });
}

// Return every concept sorted for display by `pos` ascending (0 = top). A new
// concept is inserted at pos 0, so the default order is newest-first.
export function getAllConcepts() {
    return concepts.slice().sort(function (a, b) {
        return (a.pos || 0) - (b.pos || 0);
    });
}

// Look up a single concept by id; returns the LIVE object (so the editor reads
// current stage bodies) or null when absent.
export function getConcept(id) {
    if (!id) return null;
    return concepts.find(function (c) { return c.id === id; }) || null;
}

// Create a new (optionally untitled) concept seeded with the ordered SDLC
// stage list and lifecycle 'SDLC'. Inserts it at the top of the list (pos 0,
// shifting the rest down) so it renders newest-first. Persists and returns the
// new concept.
export function createConcept(title) {
    const stamp = nowIso();
    concepts.forEach(function (c) { c.pos = (c.pos || 0) + 1; });
    const concept = {
        id: genId(),
        title: typeof title === 'string' ? title : '',
        lifecycle: DEFAULT_LIFECYCLE,
        stages: seedStages(),
        createdAt: stamp,
        updatedAt: stamp,
        pos: 0,
    };
    concepts.push(concept);
    save();
    return concept;
}

// Rename a concept's title. No-op when the id is unknown.
export function renameConcept(id, title) {
    const concept = getConcept(id);
    if (!concept) return null;
    concept.title = typeof title === 'string' ? title : '';
    concept.updatedAt = nowIso();
    save();
    return concept;
}

// Delete a concept (and all of its stage content) by id.
export function deleteConcept(id) {
    const idx = concepts.findIndex(function (c) { return c.id === id; });
    if (idx === -1) return false;
    concepts.splice(idx, 1);
    save();
    return true;
}

// Reassign display order from an array of concept ids (first = top). Ids not
// present are ignored; any concept omitted from the list keeps its prior pos
// relative to the others by being pushed after the explicitly-ordered ones.
export function reorderConcepts(orderedIds) {
    if (!Array.isArray(orderedIds)) return;
    let pos = 0;
    orderedIds.forEach(function (id) {
        const concept = getConcept(id);
        if (concept) concept.pos = pos++;
    });
    save();
}

// Set the body text of a single stage, targeted by concept id + stage id
// (stages are a list, not fixed keys). No-op when either id is unknown.
export function setStageBody(conceptId, stageId, text) {
    const concept = getConcept(conceptId);
    if (!concept || !Array.isArray(concept.stages)) return null;
    const stage = concept.stages.find(function (s) { return s.id === stageId; });
    if (!stage) return null;
    stage.body = typeof text === 'string' ? text : '';
    concept.updatedAt = nowIso();
    save();
    return stage;
}
