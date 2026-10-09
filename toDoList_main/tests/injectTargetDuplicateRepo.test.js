import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Regression tests for the inject-target sub-modal saving a duplicate row
// for a repo that is already a target under a different spelling
// (case, a trailing `.git`, or a pasted github.com URL).

vi.mock('../src/supabaseClient.js', () => ({ supabase: null }));

import { canonicalizeTargetRepo, findDuplicateTarget } from '../src/inject.js';

const here = dirname(fileURLToPath(import.meta.url));
const inject = readFileSync(resolve(here, '../src/inject.js'), 'utf8');

describe('canonicalizeTargetRepo', () => {

    it('strips a github.com URL prefix, trailing slash and .git', () => {
        expect(canonicalizeTargetRepo('https://github.com/rsterenchak/matchingGame-test'))
            .toBe('rsterenchak/matchingGame-test');
        expect(canonicalizeTargetRepo('github.com/rsterenchak/matchingGame-test/'))
            .toBe('rsterenchak/matchingGame-test');
        expect(canonicalizeTargetRepo('  rsterenchak/matchingGame-test.git  '))
            .toBe('rsterenchak/matchingGame-test');
        expect(canonicalizeTargetRepo('https://github.com/rsterenchak/matchingGame-test.git/'))
            .toBe('rsterenchak/matchingGame-test');
    });

    it('keeps the user\'s casing and leaves a plain owner/repo untouched', () => {
        expect(canonicalizeTargetRepo('rsterenchak/matchinggame-test'))
            .toBe('rsterenchak/matchinggame-test');
        expect(canonicalizeTargetRepo('RSterenchak/toDoList_TOP'))
            .toBe('RSterenchak/toDoList_TOP');
    });

    it('returns an empty string for empty input', () => {
        expect(canonicalizeTargetRepo('')).toBe('');
        expect(canonicalizeTargetRepo(null)).toBe('');
    });
});

describe('findDuplicateTarget', () => {

    const targets = [
        { id: 't1', nickname: 'Todo', repo: 'rsterenchak/toDoList_TOP' },
        { id: 't2', nickname: 'Matching', repo: 'rsterenchak/matchingGame-test' },
    ];

    it('matches an existing target case-insensitively', () => {
        const hit = findDuplicateTarget('rsterenchak/matchinggame-test', targets, null);
        expect(hit && hit.nickname).toBe('Matching');
    });

    it('matches a pasted URL / .git spelling once canonicalized', () => {
        const repo = canonicalizeTargetRepo('https://github.com/rsterenchak/matchingGame-test.git');
        expect(findDuplicateTarget(repo, targets, null).id).toBe('t2');
    });

    it('skips the row being edited', () => {
        expect(findDuplicateTarget('rsterenchak/MatchingGame-test', targets, 't2')).toBeNull();
    });

    it('returns null for a new repo or an empty cache', () => {
        expect(findDuplicateTarget('rsterenchak/other', targets, null)).toBeNull();
        expect(findDuplicateTarget('rsterenchak/other', null, null)).toBeNull();
    });
});

describe('sub-modal save wiring', () => {

    it('canonicalizes the repo before validateTargetForm runs', () => {
        expect(inject).toMatch(
            /repo:\s*canonicalizeTargetRepo\(\s*repoField\.input\.value\s*\)[\s\S]{0,200}validateTargetForm\(\s*values\s*\)/
        );
    });

    it('blocks the save with an "Already a target" repo error before the write', () => {
        expect(inject).toMatch(
            /const\s+freshTargets\s*=\s*await\s+loadInjectTargets\(\s*\)\s*;\s*const\s+dup\s*=\s*findDuplicateTarget\(\s*values\.repo\s*,\s*freshTargets\s*,\s*existing\s*\?\s*existing\.id\s*:\s*null\s*\)[\s\S]{0,300}saveBtn\.disabled\s*=\s*false[\s\S]{0,200}setError\(\s*repoField\s*,\s*['"]Already a target: ['"]\s*\+[\s\S]{0,400}insertInjectTarget\(\s*values\s*\)/
        );
    });
});
