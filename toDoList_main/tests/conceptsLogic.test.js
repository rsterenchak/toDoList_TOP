// Behavioural regression for the Conceive view's data model. conceptsLogic.js
// owns the concept list and its localStorage cache (todoapp_concepts) the same
// way listLogic.js owns the project model. These tests pin the SDLC seed, the
// id-targeted stage mutator, the filled/empty derivation from a stage body,
// and localStorage round-trips.

import {
    CONCEPTS_KEY,
    SDLC_STAGE_LABELS,
    DEFAULT_LIFECYCLE,
    reloadConcepts,
    getAllConcepts,
    getConcept,
    createConcept,
    renameConcept,
    deleteConcept,
    reorderConcepts,
    setStageBody,
} from '../src/conceptsLogic.js';

function readCache() {
    const raw = localStorage.getItem(CONCEPTS_KEY);
    return raw ? JSON.parse(raw) : null;
}

describe('conceptsLogic', () => {
    beforeEach(() => {
        localStorage.clear();
        reloadConcepts();
    });

    describe('createConcept — SDLC seed', () => {
        it('seeds the five SDLC stages in order', () => {
            const concept = createConcept('My idea');
            expect(concept.stages.map((s) => s.label)).toEqual([
                'Why',
                'Concept',
                'Requirements',
                'Design',
                'Build plan',
            ]);
            // The exported constant is the single source of truth for the seed.
            expect(SDLC_STAGE_LABELS).toEqual(concept.stages.map((s) => s.label));
        });

        it('every seeded stage starts with an empty body and a unique id', () => {
            const concept = createConcept('');
            const ids = concept.stages.map((s) => s.id);
            concept.stages.forEach((s) => expect(s.body).toBe(''));
            expect(new Set(ids).size).toBe(ids.length);
            ids.forEach((id) => expect(typeof id).toBe('string'));
        });

        it("labels the lifecycle 'SDLC' and stamps the expected shape", () => {
            const concept = createConcept('Idea');
            expect(concept.lifecycle).toBe(DEFAULT_LIFECYCLE);
            expect(concept.lifecycle).toBe('SDLC');
            expect(typeof concept.id).toBe('string');
            expect(concept.title).toBe('Idea');
            expect(typeof concept.createdAt).toBe('string');
            expect(typeof concept.updatedAt).toBe('string');
            expect(typeof concept.pos).toBe('number');
            expect(Array.isArray(concept.stages)).toBe(true);
        });

        it('defaults to an empty title when none is given', () => {
            const concept = createConcept();
            expect(concept.title).toBe('');
        });

        it('lists newest-first (newest concept at the top)', () => {
            const first = createConcept('First');
            const second = createConcept('Second');
            const all = getAllConcepts();
            expect(all[0].id).toBe(second.id);
            expect(all[1].id).toBe(first.id);
        });
    });

    describe('setStageBody — id-targeted mutation + filled/empty derivation', () => {
        it('sets a stage body by concept id + stage id', () => {
            const concept = createConcept('Idea');
            const stageId = concept.stages[2].id; // Requirements
            setStageBody(concept.id, stageId, 'must do X');
            expect(getConcept(concept.id).stages[2].body).toBe('must do X');
            // Sibling stages are untouched.
            expect(getConcept(concept.id).stages[0].body).toBe('');
        });

        it('treats a non-empty body as filled and an empty/whitespace body as empty', () => {
            const concept = createConcept('Idea');
            const stageId = concept.stages[0].id;
            const filled = (id) => {
                const s = getConcept(concept.id).stages.find((x) => x.id === id);
                return !!(s.body && s.body.trim());
            };
            expect(filled(stageId)).toBe(false);
            setStageBody(concept.id, stageId, 'why this matters');
            expect(filled(stageId)).toBe(true);
            setStageBody(concept.id, stageId, '   ');
            expect(filled(stageId)).toBe(false);
        });

        it('is a no-op for an unknown concept or stage id', () => {
            const concept = createConcept('Idea');
            expect(setStageBody('nope', concept.stages[0].id, 'x')).toBeNull();
            expect(setStageBody(concept.id, 'nope', 'x')).toBeNull();
        });
    });

    describe('localStorage round-trips', () => {
        it('persists a created concept to the todoapp_concepts cache', () => {
            const concept = createConcept('Persisted');
            const cache = readCache();
            expect(Array.isArray(cache)).toBe(true);
            expect(cache.length).toBe(1);
            expect(cache[0].id).toBe(concept.id);
            expect(cache[0].stages.map((s) => s.label)).toEqual(SDLC_STAGE_LABELS);
        });

        it('survives a reload from the cache (simulating a page reload)', () => {
            const concept = createConcept('Idea');
            setStageBody(concept.id, concept.stages[1].id, 'the concept body');
            // Drop in-memory state and re-read from localStorage.
            reloadConcepts();
            const restored = getConcept(concept.id);
            expect(restored).not.toBeNull();
            expect(restored.title).toBe('Idea');
            expect(restored.stages[1].body).toBe('the concept body');
        });

        it('renameConcept and deleteConcept persist through the cache', () => {
            const concept = createConcept('Before');
            renameConcept(concept.id, 'After');
            reloadConcepts();
            expect(getConcept(concept.id).title).toBe('After');

            deleteConcept(concept.id);
            reloadConcepts();
            expect(getConcept(concept.id)).toBeNull();
            expect(getAllConcepts().length).toBe(0);
        });

        it('reloadConcepts resets to empty when the cache is absent or corrupt', () => {
            createConcept('Idea');
            localStorage.setItem(CONCEPTS_KEY, '{not valid json');
            reloadConcepts();
            expect(getAllConcepts()).toEqual([]);
        });
    });

    describe('reorderConcepts', () => {
        it('reassigns display order from an array of ids (first = top)', () => {
            const a = createConcept('A');
            const b = createConcept('B');
            const c = createConcept('C');
            reorderConcepts([a.id, b.id, c.id]);
            expect(getAllConcepts().map((x) => x.title)).toEqual(['A', 'B', 'C']);
        });
    });
});
