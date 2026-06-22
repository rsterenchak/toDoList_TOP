// Shape-aware Conceive helpers shared by the Conceive view (conceiveView.js)
// and the "Generate tasks" modal (seedTasksModal.js).
//
// Each project has a lifecycle SHAPE that determines which stage is the
// actionable "task source" — the stage Generate tasks decomposes and Suggest
// plan drafts into. The Iterative shape builds from "Next up"; the Spec shape
// (and its legacy 'SDLC' alias) builds from "Build plan". Every other stage in
// the project is treated as upstream/context for those tools.
//
// Defining the map in one place keeps the view and the modal resolving the
// same stage. This module imports nothing from the app, so it stays a clean
// leaf shared by both surfaces.

export const ITERATIVE_ACTIONABLE_LABEL = 'Next up';
export const SPEC_ACTIONABLE_LABEL = 'Build plan';

// Lifecycle shape → actionable stage label. 'spec' and the legacy 'SDLC' label
// resolve to 'Build plan'; everything else resolves to the Iterative default
// via actionableStageLabel below.
const SHAPE_ACTIONABLE_LABEL = {
    iterative: ITERATIVE_ACTIONABLE_LABEL,
    spec: SPEC_ACTIONABLE_LABEL,
    SDLC: SPEC_ACTIONABLE_LABEL,
};

// Resolve a lifecycle shape to its actionable stage label, defaulting to the
// Iterative 'Next up' for an unset or unknown shape (matching the default
// new-project shape).
export function actionableStageLabel(lifecycle) {
    return SHAPE_ACTIONABLE_LABEL[lifecycle] || ITERATIVE_ACTIONABLE_LABEL;
}
