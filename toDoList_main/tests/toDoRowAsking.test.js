import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

// buildToDoRow is too heavily wired to instantiate end-to-end in jsdom (see the
// same caveat across the row-layer test files), so the ASKING inline-answer
// surface is pinned at the source level: the row must surface triage's
// needs_words question on the task row and answer it through the SAME write path
// and sweep the Agent board uses, sharing the store's draft map + in-flight guard.

const here = dirname(fileURLToPath(import.meta.url));
const toDoRow = readFileSync(resolve(here, '../src/toDoRow.js'), 'utf8');

describe('toDoRow ASKING inline-answer wiring', () => {
    it('imports the shared store surface it needs (no agentView import)', () => {
        expect(toDoRow).toMatch(/from '\.\/agentQueueStore\.js'/);
        expect(toDoRow).toMatch(/getQueueRowForTodo/);
        expect(toDoRow).toMatch(/pendingAnswers/);
        expect(toDoRow).toMatch(/fireTriageSweep/);
        // The cycle-avoidance rule: the row layer must not import the Agent view.
        expect(toDoRow).not.toMatch(/from '\.\/agentView\.js'/);
    });

    it('maps the asking/accept phases to the badge overlay', () => {
        expect(toDoRow).toMatch(/function overlayForPhase\(phase\)/);
        expect(toDoRow).toMatch(/if\s*\(\s*phase\s*===\s*PHASE\.ASKING\s*\)\s*return\s*'asking'/);
        expect(toDoRow).toMatch(/if\s*\(\s*phase\s*===\s*PHASE\.ACCEPT\s*\)\s*return\s*'review'/);
    });

    it('routes Send through listLogic.answerAgentTask with the linked queue-row id + thread', () => {
        expect(toDoRow).toMatch(
            /listLogic\.answerAgentTask\(queueRow\.id,\s*text,\s*queueRow\.thread\)/
        );
    });

    it('fires the shared triage sweep after a successful answer and reloads the store', () => {
        expect(toDoRow).toMatch(/loadQueueRows\(projectName\)\)\.then\(refreshDescStatusDots\)/);
        expect(toDoRow).toMatch(/fireTriageSweep\(projectName\)/);
    });

    it('mirrors the unsent answer into the shared pendingAnswers map, keyed by queue-row id', () => {
        expect(toDoRow).toMatch(/pendingAnswers\.set\(queueRow\.id,\s*input\.value\)/);
        expect(toDoRow).toMatch(/pendingAnswers\.has\(queueRow\.id\)/);
        expect(toDoRow).toMatch(/pendingAnswers\.delete\(queueRow\.id\)/);
    });

    it('only mounts the question block when the linked queue row is in needs_words', () => {
        expect(toDoRow).toMatch(/queueRow\.state\s*===\s*'needs_words'/);
        expect(toDoRow).toMatch(/function syncAskingPanel\(/);
    });

    it('re-mounts the question block when the description panel opens', () => {
        expect(toDoRow).toMatch(/syncAskingPanel\(toDoChild,\s*item,\s*projectName\)/);
    });

    it('re-attaches the expanded-viewer height after the block is added or removed', () => {
        // Inserting/removing the block shifts every row below, including an
        // expanded viewer card whose body height is a cached snapshot.
        const sync = toDoRow.slice(
            toDoRow.indexOf('function syncAskingPanel('),
            toDoRow.indexOf('function syncAskingPanel(') + 900
        );
        expect(sync).toMatch(/refreshViewerExpandedHeight\(\)/);
    });

    it('loads the project queue rows on a full render so badges light without opening the Agent tab', () => {
        expect(toDoRow).toMatch(/function loadQueueRowsForRender\(projectName\)/);
        expect(toDoRow).toMatch(/loadQueueRowsForRender\(name\)/);
        expect(toDoRow).toMatch(/startAgentQueueSubscription\(\)/);
    });
});
