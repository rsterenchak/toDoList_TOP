// Shape-aware lifecycle-stage helpers shared by the "Generate tasks" modal
// (seedTasksModal.js) and the Structure view.
//
// Each project has a lifecycle SHAPE that determines which stage is the
// actionable "task source" — the stage Generate tasks decomposes and Suggest
// plan drafts into. The Iterative board shape builds from "Now"; legacy
// Iterative projects (still carrying the old "Next up" stage) build from "Next
// up"; the Spec shape (and its legacy 'SDLC' alias) builds from "Build plan".
// Every other stage in the project is treated as upstream/context for those
// tools.
//
// Because the shapes now overlap on the `iterative` lifecycle (board vs legacy),
// the reliable resolver keys off the STAGE LABELS present, not the lifecycle
// string — see actionableStageLabelForStages. The lifecycle-only
// actionableStageLabel remains as the fallback when stages aren't available.
//
// Defining the map in one place keeps the view and the modal resolving the
// same stage. This module imports nothing from the app, so it stays a clean
// leaf shared by both surfaces.

export const BOARD_ACTIONABLE_LABEL = 'Now';
export const ITERATIVE_ACTIONABLE_LABEL = 'Next up';
export const SPEC_ACTIONABLE_LABEL = 'Build plan';

// Lifecycle shape → actionable stage label. 'spec' and the legacy 'SDLC' label
// resolve to 'Build plan'; everything else resolves to the Iterative board
// default 'Now' via actionableStageLabel below.
const SHAPE_ACTIONABLE_LABEL = {
    iterative: BOARD_ACTIONABLE_LABEL,
    spec: SPEC_ACTIONABLE_LABEL,
    SDLC: SPEC_ACTIONABLE_LABEL,
};

// Resolve a lifecycle shape to its actionable stage label, defaulting to the
// Iterative board 'Now' for an unset or unknown shape (matching the default
// new-project shape).
export function actionableStageLabel(lifecycle) {
    return SHAPE_ACTIONABLE_LABEL[lifecycle] || BOARD_ACTIONABLE_LABEL;
}

// Resolve the actionable stage by the labels actually present on the project's
// stages, so each shape maps correctly regardless of the stored lifecycle:
// a board project (has "Now") → "Now"; a Spec project (has "Build plan") →
// "Build plan"; a legacy Iterative project (has "Next up") → "Next up". Falls
// back to the lifecycle-only map when none of the known actionable labels are
// present (e.g. a fully custom stage set).
export function actionableStageLabelForStages(stages, lifecycle) {
    const labels = Array.isArray(stages)
        ? stages.map(function (s) { return s && s.label; })
        : [];
    if (labels.indexOf(BOARD_ACTIONABLE_LABEL) !== -1) return BOARD_ACTIONABLE_LABEL;
    if (labels.indexOf(SPEC_ACTIONABLE_LABEL) !== -1) return SPEC_ACTIONABLE_LABEL;
    if (labels.indexOf(ITERATIVE_ACTIONABLE_LABEL) !== -1) return ITERATIVE_ACTIONABLE_LABEL;
    return actionableStageLabel(lifecycle);
}
