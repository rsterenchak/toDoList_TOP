// Lint-style static scan: every function in listLogic.js that calls
// saveToStorage must carry a `// @category: <name>` annotation in its
// preceding comment block, and its body must match the shape that
// category promises.
//
// Three valid categories:
//
//   user-mutation-only — always a real user-initiated mutation. Must
//     NOT accept an `opts` parameter and must NOT call
//     `saveToStorage(opts)` — there is no sync flag to forward, and
//     accepting one would mask whether the caller is really a render
//     path in disguise.
//
//   sync-safe — accepts an `opts` parameter and forwards it via
//     `saveToStorage(opts)` so reconciliation callers can pass
//     `{ fromSync: true }` and suppress the per-row Supabase mirror
//     writes downstream.
//
//   defensive-normalize — invoked from both render and mutation paths
//     and must skip the write when no observable change occurred. Must
//     contain a guard expression (e.g. `if (unchanged) return;` or
//     `if (a !== b)`) so the save is short-circuited on noop, AND must
//     accept an `opts` parameter so the sync-safe path forwards
//     correctly when a real change DID occur.
//
// Background: a defensive sort running from a render path that saves
// unconditionally even though no data actually changed produced the
// project-switch bug — the annotation-plus-shape contract catches that
// failure mode at lint time so the next new caller can't repeat the
// audit miss silently.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');
const SRC = readFileSync(resolve(srcDir, 'listLogic.js'), 'utf8');

const VALID_CATEGORIES = ['user-mutation-only', 'sync-safe', 'defensive-normalize'];


// Locate every `function NAME(...)` declaration in the file, capturing
// the leading comment lines so the annotation rule can be checked and
// recording the 1-based line number for error messages.
function collectFunctionDeclarations(src) {
    const out = [];
    const re = /(^|\n)\s*function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g;
    let match;
    while ((match = re.exec(src)) !== null) {
        const declStart = match.index + match[1].length;
        const name = match[2];
        const params = match[3];
        const openBrace = src.indexOf('{', match.index + match[0].length - 1);
        // Walk braces to find the matching close so the body is exact.
        let depth = 0;
        let bodyEnd = openBrace;
        for (let i = openBrace; i < src.length; i++) {
            const ch = src[i];
            if (ch === '{') depth++;
            else if (ch === '}') {
                depth--;
                if (depth === 0) { bodyEnd = i; break; }
            }
        }
        const body = src.slice(openBrace + 1, bodyEnd);
        // Walk backwards from the declaration line collecting only
        // the contiguous comment-or-blank block immediately above so
        // the annotation from a preceding function can't leak into
        // this function's preceding block.
        const before = src.slice(0, declStart);
        const beforeLines = before.split('\n');
        const precedingLines = [];
        for (let i = beforeLines.length - 2; i >= 0; i--) {
            const trimmed = beforeLines[i].trim();
            if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
                precedingLines.unshift(beforeLines[i]);
            } else {
                break;
            }
        }
        const preceding = precedingLines.join('\n');
        const line = beforeLines.length;
        out.push({ name, params, body, preceding, line });
    }
    return out;
}

function callsSaveToStorage(body) {
    return /\bsaveToStorage\s*\(/.test(body);
}

function acceptsOpts(params) {
    return /(^|,)\s*opts\s*(,|$)/.test(params);
}

function forwardsOpts(body) {
    return /\bsaveToStorage\s*\(\s*opts\s*\)/.test(body);
}

function getCategoryAnnotation(preceding) {
    const m = preceding.match(/\/\/\s*@category:\s*([a-z-]+)\b/);
    return m ? m[1] : null;
}

// Detect a guard expression of the shape `if (...changed...)` or
// `if (...!==...)`. The match is intentionally loose — the annotation
// is the source of truth; this just verifies the function body has at
// least one shape consistent with the noop-when-unchanged contract.
// `changed` matches both `changed` and `unchanged` as substrings.
function hasGuardExpression(body) {
    return /\bif\s*\([^)]*(changed|!==)[^)]*\)/.test(body);
}

function validateBodyShape(category, fn) {
    const acceptsOptsParam = acceptsOpts(fn.params);
    const forwarding = forwardsOpts(fn.body);

    if (category === 'user-mutation-only') {
        if (acceptsOptsParam) {
            return {
                ok: false,
                reason: 'must not accept an `opts` parameter — user-mutation paths have no sync flag to forward, and accepting one here masks whether the caller is really a render path that should be defensive-normalize instead.',
            };
        }
        if (forwarding) {
            return {
                ok: false,
                reason: 'must not call `saveToStorage(opts)` — user-mutation paths should call `saveToStorage()` with no arguments.',
            };
        }
        return { ok: true };
    }

    if (category === 'sync-safe') {
        if (!acceptsOptsParam) {
            return {
                ok: false,
                reason: 'must accept an `opts` parameter so callers can pass `{ fromSync: true }` through.',
            };
        }
        if (!forwarding) {
            return {
                ok: false,
                reason: 'must forward opts via `saveToStorage(opts)` at least once so the fromSync flag is preserved on the save.',
            };
        }
        return { ok: true };
    }

    if (category === 'defensive-normalize') {
        if (!acceptsOptsParam) {
            return {
                ok: false,
                reason: 'must accept an `opts` parameter so the save forwards the fromSync flag when a real change DID occur.',
            };
        }
        if (!hasGuardExpression(fn.body)) {
            return {
                ok: false,
                reason: 'must contain a guard expression (e.g. `if (unchanged) return;` or `if (a !== b)`) so the save is skipped when nothing actually changed.',
            };
        }
        return { ok: true };
    }

    return {
        ok: false,
        reason: 'unknown @category value `' + category + '`. Valid values: ' + VALID_CATEGORIES.join(', ') + '.',
    };
}

// Run the audit against a source string. Returns `{ callers, issues }`
// where `callers` is every function in the source that calls
// saveToStorage and `issues` is the subset that failed annotation or
// body-shape checks.
export function auditSaveToStorageCallers(src) {
    const functions = collectFunctionDeclarations(src);
    const callers = [];
    const issues = [];

    functions.forEach(function(fn) {
        if (!callsSaveToStorage(fn.body)) return;
        callers.push(fn);

        const category = getCategoryAnnotation(fn.preceding);
        if (!category) {
            issues.push({
                name: fn.name,
                line: fn.line,
                kind: 'missing-annotation',
                message: '`' + fn.name + '` (listLogic.js line ' + fn.line + ') calls saveToStorage but has no `// @category` annotation. Add one of: ' + VALID_CATEGORIES.join(', ') + '.',
            });
            return;
        }
        if (VALID_CATEGORIES.indexOf(category) === -1) {
            issues.push({
                name: fn.name,
                line: fn.line,
                kind: 'invalid-category',
                category: category,
                message: '`' + fn.name + '` (listLogic.js line ' + fn.line + ') has an unknown `// @category: ' + category + '` annotation. Valid values: ' + VALID_CATEGORIES.join(', ') + '.',
            });
            return;
        }

        const check = validateBodyShape(category, fn);
        if (!check.ok) {
            issues.push({
                name: fn.name,
                line: fn.line,
                kind: 'shape-mismatch',
                category: category,
                message: '`' + fn.name + '` (listLogic.js line ' + fn.line + ') is annotated `@category: ' + category + '` but ' + check.reason,
            });
        }
    });

    return { callers, issues };
}


describe('listLogic — saveToStorage caller audit (real source)', () => {

    const result = auditSaveToStorageCallers(SRC);

    it('sanity: parsed at least one saveToStorage caller from listLogic.js', () => {
        expect(result.callers.length).toBeGreaterThan(5);
    });

    it('every saveToStorage caller in listLogic.js carries a valid @category annotation with a matching body shape', () => {
        const messages = result.issues.map(function(i) { return '- ' + i.message; }).join('\n');
        expect(
            result.issues.length,
            result.issues.length === 0
                ? ''
                : 'Found ' + result.issues.length + ' issue(s) in listLogic.js saveToStorage callers:\n' + messages
        ).toBe(0);
    });

    // Per-function assertion so a single failure surfaces the function
    // name in the test output rather than burying it inside one big
    // aggregate failure.
    result.callers.forEach(function(fn) {
        it('"' + fn.name + '" passes the @category contract', () => {
            const issue = result.issues.find(function(i) { return i.name === fn.name; });
            expect(issue ? issue.message : null, issue ? issue.message : '').toBe(null);
        });
    });

    it('sortCompletedToBottom is annotated @category: defensive-normalize', () => {
        const fn = collectFunctionDeclarations(SRC).find(function(f) {
            return f.name === 'sortCompletedToBottom';
        });
        expect(fn).toBeTruthy();
        expect(getCategoryAnnotation(fn.preceding)).toBe('defensive-normalize');
    });

    it('replaceAllProjects is annotated @category: sync-safe', () => {
        const fn = collectFunctionDeclarations(SRC).find(function(f) {
            return f.name === 'replaceAllProjects';
        });
        expect(fn).toBeTruthy();
        expect(getCategoryAnnotation(fn.preceding)).toBe('sync-safe');
    });
});


describe('saveToStorage audit parser — fixture tests', () => {

    it('flags a saveToStorage caller missing the @category annotation', () => {
        const src = `
            function newCallerNoAnnotation() {
                saveToStorage();
            }
        `;
        const result = auditSaveToStorageCallers(src);
        const issue = result.issues.find(function(i) { return i.name === 'newCallerNoAnnotation'; });
        expect(issue).toBeTruthy();
        expect(issue.kind).toBe('missing-annotation');
        // The error message must name all three valid categories so a
        // contributor adding a new caller sees their options.
        expect(issue.message).toMatch(/user-mutation-only/);
        expect(issue.message).toMatch(/sync-safe/);
        expect(issue.message).toMatch(/defensive-normalize/);
        expect(issue.message).toMatch(/listLogic\.js line \d+/);
    });

    it('flags a caller annotated with an unknown category value', () => {
        const src = `
            // @category: bogus-category
            function bogusCaller() {
                saveToStorage();
            }
        `;
        const result = auditSaveToStorageCallers(src);
        const issue = result.issues.find(function(i) { return i.name === 'bogusCaller'; });
        expect(issue).toBeTruthy();
        expect(issue.kind).toBe('invalid-category');
    });

    it('skips functions that do not call saveToStorage', () => {
        const src = `
            function inertHelper() {
                return 42;
            }
        `;
        const result = auditSaveToStorageCallers(src);
        expect(result.callers).toEqual([]);
        expect(result.issues).toEqual([]);
    });

    it('accepts a well-formed user-mutation-only caller', () => {
        const src = `
            // @category: user-mutation-only
            function fineUserMutation() {
                saveToStorage();
            }
        `;
        const result = auditSaveToStorageCallers(src);
        expect(result.issues).toEqual([]);
        expect(result.callers).toHaveLength(1);
    });

    it('flags a user-mutation-only caller that accepts an opts parameter', () => {
        const src = `
            // @category: user-mutation-only
            function userMutationWithOpts(opts) {
                saveToStorage();
            }
        `;
        const result = auditSaveToStorageCallers(src);
        const issue = result.issues.find(function(i) { return i.name === 'userMutationWithOpts'; });
        expect(issue).toBeTruthy();
        expect(issue.kind).toBe('shape-mismatch');
        expect(issue.category).toBe('user-mutation-only');
        expect(issue.message).toMatch(/opts/);
    });

    it('flags a user-mutation-only caller that forwards opts to saveToStorage', () => {
        const src = `
            // @category: user-mutation-only
            function userMutationForwardsOpts(opts) {
                saveToStorage(opts);
            }
        `;
        const result = auditSaveToStorageCallers(src);
        const issue = result.issues.find(function(i) { return i.name === 'userMutationForwardsOpts'; });
        expect(issue).toBeTruthy();
        expect(issue.kind).toBe('shape-mismatch');
    });

    it('accepts a well-formed sync-safe caller', () => {
        const src = `
            // @category: sync-safe
            function fineSyncSafe(opts) {
                saveToStorage(opts);
            }
        `;
        const result = auditSaveToStorageCallers(src);
        expect(result.issues).toEqual([]);
    });

    it('flags a sync-safe caller missing the opts parameter', () => {
        const src = `
            // @category: sync-safe
            function syncSafeNoOpts() {
                saveToStorage();
            }
        `;
        const result = auditSaveToStorageCallers(src);
        const issue = result.issues.find(function(i) { return i.name === 'syncSafeNoOpts'; });
        expect(issue).toBeTruthy();
        expect(issue.kind).toBe('shape-mismatch');
        expect(issue.message).toMatch(/opts/);
    });

    it('flags a sync-safe caller that accepts opts but does not forward it', () => {
        const src = `
            // @category: sync-safe
            function syncSafeDropsOpts(opts) {
                saveToStorage();
            }
        `;
        const result = auditSaveToStorageCallers(src);
        const issue = result.issues.find(function(i) { return i.name === 'syncSafeDropsOpts'; });
        expect(issue).toBeTruthy();
        expect(issue.kind).toBe('shape-mismatch');
        expect(issue.message).toMatch(/forward/);
    });

    it('accepts a well-formed defensive-normalize caller using `if (unchanged)`', () => {
        const src = `
            // @category: defensive-normalize
            function fineDefensiveUnchanged(opts) {
                let unchanged = true;
                if (unchanged) return;
                saveToStorage(opts);
            }
        `;
        const result = auditSaveToStorageCallers(src);
        expect(result.issues).toEqual([]);
    });

    it('accepts a well-formed defensive-normalize caller using `if (a !== b)`', () => {
        const src = `
            // @category: defensive-normalize
            function fineDefensiveStrictNeq(opts) {
                const a = 1;
                const b = 2;
                if (a !== b) {
                    saveToStorage(opts);
                }
            }
        `;
        const result = auditSaveToStorageCallers(src);
        expect(result.issues).toEqual([]);
    });

    it('flags a defensive-normalize caller missing the guard expression', () => {
        const src = `
            // @category: defensive-normalize
            function defensiveNoGuard(opts) {
                saveToStorage(opts);
            }
        `;
        const result = auditSaveToStorageCallers(src);
        const issue = result.issues.find(function(i) { return i.name === 'defensiveNoGuard'; });
        expect(issue).toBeTruthy();
        expect(issue.kind).toBe('shape-mismatch');
        expect(issue.message).toMatch(/guard/);
    });

    it('flags a defensive-normalize caller missing the opts parameter', () => {
        const src = `
            // @category: defensive-normalize
            function defensiveNoOpts() {
                let unchanged = true;
                if (unchanged) return;
                saveToStorage();
            }
        `;
        const result = auditSaveToStorageCallers(src);
        const issue = result.issues.find(function(i) { return i.name === 'defensiveNoOpts'; });
        expect(issue).toBeTruthy();
        expect(issue.kind).toBe('shape-mismatch');
        expect(issue.message).toMatch(/opts/);
    });

    it('classifies multiple callers in one source independently', () => {
        const src = `
            // @category: user-mutation-only
            function goodUserMutation() {
                saveToStorage();
            }

            // @category: sync-safe
            function badSyncSafe() {
                saveToStorage();
            }

            function alsoMissingAnnotation() {
                saveToStorage();
            }
        `;
        const result = auditSaveToStorageCallers(src);
        expect(result.callers).toHaveLength(3);
        expect(result.issues).toHaveLength(2);
        const names = result.issues.map(function(i) { return i.name; }).sort();
        expect(names).toEqual(['alsoMissingAnnotation', 'badSyncSafe']);
    });
});
