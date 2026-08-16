import { listLogic } from './listLogic.js';
import {
    readAssignmentFromWorker,
    readRepoFile,
    showInjectToast,
    mintEntryId,
    dispatchDerive,
    findTargetById,
    getCachedTargets,
} from './inject.js';
import { showAssignmentEditorModal, wireModalDismiss } from './modals.js';
import {
    getQueueRows,
    onQueueChange,
    isDeriveActive,
    startDeriveTracking,
    stopDeriveTracking,
    setDeriveCorrelationId,
    loadQueueRows,
    fireTriageSweep,
    pendingAnswers,
} from './agentQueueStore.js';
import { dispatchDraft, resolveDispatchTarget } from './dispatchDraft.js';
// The shared A/B/C mockup flow, mounted on a homeless `needs_mockup` row's card in
// the proposal review modal. mockupFlow.js imports only listLogic / inject /
// modalDismiss — never this module — so the edge is acyclic.
import { buildMockupSecondary } from './mockupFlow.js';

// The assignment / rubric-coverage subsystem, extracted verbatim from
// agentView.js so it can be re-homed as a chat-pane tab later. It owns reading
// and classifying `assignment.md`, parsing rubric aspects, computing per-aspect
// coverage from the tagged agent_queue rows, the coverage summary, the coverage
// detail modal, the manual commit-tick controls backed by `aspect_submissions`,
// and the assignment editor trigger. The board imports the same entry points it
// called before (buildAspectBadge / buildAssignmentCard / refreshAssignment) and
// nothing a user sees changes.
//
// The subsystem calls back out to read the selected project, repaint, resolve the
// read target, hand a blocked aspect's question off to the chat, and fire the
// board's own derive dispatch (getSelectedProjectName / paint / resolveReadTarget
// / openChatWithSeed / fireDeriveRun). Those live in agentView.js and
// claudeSheet.js, and importing either here would create a cycle (claudeSheet.js
// already imports this module), so agentWiring.js injects them once at boot via
// configureAssignmentCoverage. Until it does, the bindings are inert no-ops. The
// relocated derive tracker itself (isDeriveActive / startDeriveTracking / …) is
// imported directly from agentQueueStore so the coverage tab's own Derive action
// works without the board.
let getSelectedProjectName = function () { return ''; };
let paint = function () {};
let resolveReadTarget = function () { return null; };
let openChatWithSeed = function () {};
let fireDeriveRun = function () {};

// Wire the host-side callbacks the subsystem depends on. Called once by
// agentWiring.js at boot (and by agentView.js when a test mounts the board). Only
// overrides the callbacks actually supplied so a partial wiring can't blank out an
// already-set binding.
export function configureAssignmentCoverage(deps) {
    if (deps && typeof deps.getSelectedProjectName === 'function') getSelectedProjectName = deps.getSelectedProjectName;
    if (deps && typeof deps.paint === 'function') paint = deps.paint;
    if (deps && typeof deps.resolveReadTarget === 'function') resolveReadTarget = deps.resolveReadTarget;
    if (deps && typeof deps.openChatWithSeed === 'function') openChatWithSeed = deps.openChatWithSeed;
    if (deps && typeof deps.fireDeriveRun === 'function') fireDeriveRun = deps.fireDeriveRun;
}

// The active project's assignment-context state — the classified result of
// reading `assignment.md` (the sibling of the routed repo's TODO.md). Shaped
// `{ state: 'absent' | 'unfilled' | 'filled', ... }` (filled also carries the
// summary title + word/section counts), or null before the first read resolves.
// Module-level (mirroring _rows) so a realtime-push repaint renders the card
// from cache — paint() must NOT re-fetch. `_assignmentProject` records which
// project the cache belongs to so mount/project-switch fetch exactly once.
let _assignment = null;
let _assignmentProject = null;

// Which document the cached descriptor was classified from — 'assignment' for a
// graded `assignment.md`, 'brief' for a personal repo's `project.md`. Set
// synchronously by refreshAssignment (the way `_assignmentProject` is) and by
// openAssignmentEditor, so a post-save reclassify and the no-target toast still
// read the right kind when there is no descriptor to read it off.
let _assignmentKind = 'assignment';

// Clear the cached assignment descriptor (the board resets it alongside _rows on
// a project switch so the stale card doesn't paint before the fresh read lands).
export function resetAssignmentCache() {
    _assignment = null;
}

// Which project the cached assignment belongs to — the board reads this to guard
// its mount-time read against renderAgentView's project-switch read (no double-fetch).
export function getAssignmentProject() {
    return _assignmentProject;
}

// The classified state of the cached assignment ('absent' | 'unfilled' |
// 'filled'), or null before the first read resolves. The chat pane's COVERAGE
// tab reads this to decide its own visibility — shown only for 'unfilled' /
// 'filled', hidden for 'absent', and hidden while null so it never flashes in
// before the read lands.
export function getAssignmentState() {
    return _assignment ? _assignment.state : null;
}

// Subscribers notified whenever the cached assignment descriptor resolves (on a
// no-target sync-to-absent or an async read completing). The chat pane's COVERAGE
// tab registers here so it can (re)resolve its visibility and repaint once the
// read lands, without polling. Module-level so a single registration survives
// across sheet re-mounts (the chat pane guards against double-registering).
const assignmentListeners = [];
export function onAssignmentChange(fn) {
    if (typeof fn === 'function') assignmentListeners.push(fn);
}
function notifyAssignmentChange() {
    assignmentListeners.forEach(function (fn) {
        try { fn(); } catch (e) { /* a listener error must not abort the read */ }
    });
}

// Resolve the routed read target for a specific project name, independent of the
// DOM selection. Mirrors the board's injected resolveReadTarget() (project name →
// routed target id → target object) but keys off the name the caller passes rather
// than re-reading getSelectedProjectName(). The switch path needs this because the
// project name threaded from syncClaudeSheetForProject is authoritative the instant
// the switch fires, whereas the DOM `.selectedProject` reader can still lag behind
// it — resolving the target off the lagging DOM would fetch the wrong repo's file.
function resolveReadTargetFor(projectName) {
    if (!projectName) return null;
    const targetId = listLogic.getProjectTargetId(projectName);
    return targetId ? findTargetById(targetId) : null;
}

// Tell "this project has no context document" apart from "the inject-targets
// cache has not warmed up yet". Both hand refreshAssignment a null descriptor,
// but only the first is an answer: settling the second as `absent` records the
// project in `_assignmentProject`, and the double-fetch guard then suppresses
// every later read, so the tab stays empty until a project switch invalidates
// the cache. That is the whole bug — the guard is right, an unresolved state
// just must not satisfy it.
//
// A project carrying no routed target id genuinely has none, whatever the cache
// holds. One that IS routed but resolves against an EMPTY cache is waiting on
// initInjectTargets; the emptiness of the cache is the registry-not-loaded
// signal, not the missing lookup, because a loaded cache that simply lacks this
// id is a real answer.
function isAwaitingInjectTargets(projectName) {
    if (!projectName) return false;
    let targetId = null;
    try {
        targetId = listLogic.getProjectTargetId(projectName);
    } catch (e) {
        return false;
    }
    if (!targetId) return false;
    let cached = null;
    try {
        cached = getCachedTargets();
    } catch (e) {
        // Can't read the cache at all — that is not positive evidence it is
        // cold, so answer "loaded" and let the caller settle as it did before.
        return false;
    }
    return Array.isArray(cached) && cached.length === 0;
}

// Which document kind a routed target's context lives in, read off the registry
// `purpose` inject.js now stamps onto every target descriptor. An assignment
// repo is graded against `assignment.md`; everything else — including a target
// whose purpose is missing or unrecognized — is a personal repo described by a
// `project.md` beside its TODO.md. That is the same one-field rule inject.js's
// assignmentDocName applies to pick the path it reads and writes, so the copy
// here and the file there cannot disagree.
function docKindFor(target) {
    return (target && target.purpose === 'assignment') ? 'assignment' : 'brief';
}

// The noun each kind goes by in user-visible copy, and the file it lives in. A
// personal repo says "brief" everywhere the assignment flow says "assignment".
function docNoun(kind) {
    return kind === 'brief' ? 'brief' : 'assignment';
}
function docFileName(kind) {
    return kind === 'brief' ? 'project.md' : 'assignment.md';
}

// Resolve (or re-resolve) the active project's assignment for a non-board host —
// the chat pane's COVERAGE tab. Callers thread the project being switched to
// (syncClaudeSheetForProject already holds it as its argument); the mount path
// omits it and falls back to the settled DOM selection. Guards against a
// double-fetch: when the cache already belongs to (or is in flight for) that
// project, the board (or a prior pane call) already kicked the read off, so this is
// a no-op and the pending read's notify still repaints the tab. Otherwise it resets
// the stale descriptor (so getAssignmentState reads null → the tab hides until the
// fresh read lands, never flashing the prior project's state) and fires the read.
// Both the double-fetch guard and the read target key off the passed name rather
// than the DOM selection, so a switch whose DOM `.selectedProject` update trails the
// call still resolves and reads the intended project instead of no-opping.
export function refreshAssignmentForActiveProject(projectName) {
    const name = (typeof projectName === 'string' && projectName)
        ? projectName
        : getSelectedProjectName();
    if (getAssignmentProject() === name) return;
    resetAssignmentCache();
    refreshAssignment(resolveReadTargetFor(name), name);
}

// The other half of the empty-tab fix. main.js fires initInjectTargets() without
// awaiting it, so the coverage tab routinely mounts and calls
// refreshAssignmentForActiveProject() before a single target is resolvable. That
// call now leaves the read unresolved instead of settling as `absent`, which is
// only useful if something re-drives it — this is that something. Registered at
// module scope (not per mount) so it survives sheet re-mounts and covers whichever
// surface got there first.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('injectTargetsLoaded', function () {
        refreshAssignmentForActiveProject();
    });
}

// A derive aspect badge: a small mono tag ("A1"/"B1") shown near the chip on
// derive-generated rows. Returns null when the row carries no aspect (all
// existing triage rows), so those cards render unchanged.
export function buildAspectBadge(row) {
    const aspect = (row && typeof row.aspect === 'string') ? row.aspect.trim() : '';
    if (!aspect) return null;
    const badge = document.createElement('span');
    badge.className = 'agentAspectBadge';
    badge.textContent = aspect;
    return badge;
}

// Sort key for a proposal's rubric aspect, read from the same `row.aspect` the
// badge renders so the ordering and the badge can never disagree. IDs come in
// three shapes — bare letter (`A`), letter+number (`B10`), and a lettered
// suffix (`B2a`) — so we split all three: the letter sorts lexically, the
// number NUMERICALLY (a plain string sort would put `B10` before `B2`), and the
// suffix lexically after it. A missing number reads as 0 so a bare `B` sorts
// ahead of `B1`, and a missing suffix as '' so `B2` sorts ahead of `B2a`. The
// letter run is capped at two to match the ID grammar parseAspects accepts;
// anything longer is prose, not a tag. Case and stray whitespace are normalised
// for comparison only. Returns null when the row carries no parseable aspect
// tag, so untagged proposals can be grouped last.
function aspectSortKey(row) {
    const raw = (row && typeof row.aspect === 'string') ? row.aspect.trim() : '';
    if (!raw) return null;
    const m = /^([A-Za-z]{1,2})\s*(\d*)([a-z]?)\b/.exec(raw);
    if (!m) return null;
    return {
        letter: m[1].toUpperCase(),
        num: m[2] ? parseInt(m[2], 10) : 0,
        suffix: m[3] || '',
    };
}

// A proposal's insertion time in ms, read from the `created_at` the store's
// `select('*')` already carries. Returns null for a missing or unparseable
// value so the comparator can treat such a row as equal to anything rather than
// sorting every one of them to the same end.
function proposalInsertedAt(row) {
    const raw = row && row.created_at;
    if (raw === null || raw === undefined || raw === '') return null;
    const t = new Date(raw).getTime();
    return Number.isFinite(t) ? t : null;
}

// Tie-break for two proposals inserted inside the same timestamp tick. Ids are
// numeric in the store and string uuids elsewhere, so compare numerically when
// both are numbers and lexically otherwise; an absent id on either side leaves
// the pair equal.
function compareProposalIds(a, b) {
    const ia = a && a.id;
    const ib = b && b.id;
    if (ia === null || ia === undefined || ib === null || ib === undefined) return 0;
    if (typeof ia === 'number' && typeof ib === 'number') return ia - ib;
    const sa = String(ia);
    const sb = String(ib);
    if (sa === sb) return 0;
    return sa < sb ? -1 : 1;
}

// Order proposals by rubric aspect (A1, A2, …, B1, B10, …), untagged last —
// and among untagged ones, oldest first by insertion time. A project derive
// emits every proposal untagged and writes them foundation-first, which is the
// order its closing summary tells you to accept them in; without the
// `created_at` comparison the sort is a no-op for that whole set and the
// rendered order is whatever Postgres returned. Rows whose timestamps are
// absent, unparseable, or equal fall back to the id, then to the stable sort's
// fetch order — which also keeps the live onQueueChange repaint from
// reshuffling cards while the user works through them.
function compareProposalsByAspect(a, b) {
    const ka = aspectSortKey(a);
    const kb = aspectSortKey(b);
    if (ka && kb) {
        if (ka.letter !== kb.letter) return ka.letter < kb.letter ? -1 : 1;
        if (ka.num !== kb.num) return ka.num - kb.num;
        // Suffixed siblings (`B2a`, `B2b`) share a number, so the suffix breaks
        // the tie and keeps both between `B1` and `B3`.
        if (ka.suffix !== kb.suffix) return ka.suffix < kb.suffix ? -1 : 1;
        return 0;
    }
    if (ka) return -1;
    if (kb) return 1;
    const ta = proposalInsertedAt(a);
    const tb = proposalInsertedAt(b);
    if (ta === null || tb === null) return 0;
    if (ta !== tb) return ta - tb;
    return compareProposalIds(a, b);
}

// Every `<!-- … -->` span removed. The template seeds assignment.md with
// commented-out example rows and hint prose, and a comment is not content: the
// derive agent already ignores it (`.claude/derive.md`), so the parse must too
// or a hint sentence becomes a rubric aspect no queue row can ever cover. Spans
// are stripped rather than whole lines dropped, since a comment can open and
// close mid-line.
function stripHtmlComments(text) {
    return text.replace(/<!--[\s\S]*?-->/g, '');
}

// Return the raw text under the first top-level `## Requirements` header, up to
// the next `## ` header or EOF, or null when there's no such header. Level-3+
// sub-headers (`### …`) inside the section are kept (the `^## ` boundary only
// matches level-2 headers). Comments are stripped before the scan, so a hint
// spanning several lines can contribute neither an aspect ID nor a label. Used
// to classify assignment.md content.
function extractRequirementsSection(content) {
    const lines = stripHtmlComments(content).split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^##\s+requirements\s*$/i.test(lines[i].trim())) { start = i + 1; break; }
    }
    if (start === -1) return null;
    const out = [];
    for (let i = start; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) break;
        out.push(lines[i]);
    }
    return out.join('\n');
}

// Return the raw text under the first top-level `## Rubric` header, up to the
// next `## ` header or EOF, or null when there's no such header. Mirrors
// extractRequirementsSection's boundary handling (level-3+ sub-headers are
// kept, only `^## ` closes the section, comments are stripped first). Feeds the
// aspect-ID parse that drives the filled card's coverage summary.
function extractRubricSection(content) {
    const lines = stripHtmlComments(content).split('\n');
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^##\s+rubric\s*$/i.test(lines[i].trim())) { start = i + 1; break; }
    }
    if (start === -1) return null;
    const out = [];
    for (let i = start; i < lines.length; i++) {
        if (/^##\s+/.test(lines[i])) break;
        out.push(lines[i]);
    }
    return out.join('\n');
}

// The leading rubric-ID tag of a single row, matched against the three shapes
// real rubrics use: bare letter (`A`, `I`), letter+number (`B1`, `C10`) and a
// lettered suffix splitting one criterion in two (`B2a`, `B2b`). The optional
// prefix skips whatever leads the row into its ID — a markdown heading, a list
// bullet (`- `, `* `, `1. `) and/or emphasis (`**A1**`, `` `A1` ``) — and the
// anchor to line start is load-bearing rather than cosmetic: with the digit no
// longer required, an unanchored match would read the article "A" or the
// pronoun "I" out of the middle of any wrapped rubric paragraph. Shared by
// parseAspects and parseAspectLabels so the two can't drift; `m[0]` spans the
// prefix as well as the ID, so slice past it (not past `m[1]`) to reach a row's
// trailing label text.
//
// The lowercase suffix is gated behind a required digit, and that gate is what
// keeps ordinary prose out: an apostrophe counts as a word boundary, so an
// ungated `[a-z]?` reads "It's a pre-written list…" as an aspect named `It`.
// With the digit required, the `t` is only reachable through the digit branch —
// `B2a` still matches, `It` cannot.
const ASPECT_ID_RE =
    /^\s*(?:#{1,6}\s+)?(?:[-*+]\s+|\d+[.)]\s+)?(?:[*_`]+\s*)?([A-Z]{1,2}(?:\d+[a-z]?)?)\b/;

// Parse the ordered, de-duplicated list of rubric aspect IDs from an
// assignment.md — the leading `A1`/`B2`-style tag of each row under the
// `## Rubric` section (the ASPECT_ID_RE match per line). Returns [] when
// there's no rubric section or no IDs, so a requirements-only spec still
// classifies as filled and the card degrades to its words/sections line. These
// IDs cross-reference the agent_queue rows' `aspect` field to compute coverage.
function parseAspects(content) {
    const rubric = extractRubricSection(content);
    if (rubric === null) return [];
    const seen = Object.create(null);
    const aspects = [];
    rubric.split('\n').forEach(function (line) {
        const m = line.match(ASPECT_ID_RE);
        if (m && !seen[m[1]]) { seen[m[1]] = true; aspects.push(m[1]); }
    });
    return aspects;
}

// Parse a `{ id: label }` map of each rubric aspect's human-readable label — the
// `## Requirements` row text after its `A1`/`B2` tag, with any leading separator
// (`:`, `-`, `—`, `.`, `)`, `]`) and markdown emphasis (`*`, `_`, backtick)
// stripped from BOTH ends: a row written `**A. GitLab repository**` opens its
// emphasis before the ID (so ASPECT_ID_RE's prefix eats it) and closes it after
// the label, leaving a trailing `**` that renders as literal markdown.
// The requirement rows (`**A1** — <what to build>`) carry the short task phrase,
// whereas the rubric rows (`**A1 — Competent:** <bar>`) hold grading criteria — so
// the label sources from requirements while parseAspects keeps the canonical
// aspect-ID list on the rubric. Additive to parseAspects: the coverage detail
// modal reads this so a row can read "A1 — Menu-driven interface" rather than a
// bare ID. Returns an empty map when there's no requirements section, and omits
// IDs whose row carries no trailing text.
function parseAspectLabels(content) {
    const labels = Object.create(null);
    const requirements = extractRequirementsSection(content);
    if (requirements === null) return labels;
    requirements.split('\n').forEach(function (line) {
        const m = line.match(ASPECT_ID_RE);
        if (!m || labels[m[1]]) return;
        const after = line.slice(m.index + m[0].length)
            .replace(/^[\s:.)\]\-–—*`]+/, '')
            .replace(/[\s*_`]+$/, '')
            .trim();
        if (after) labels[m[1]] = after;
    });
    return labels;
}

// A project brief's own prose: the document with HTML comments and markdown
// headings removed. A `project.md` has no fixed section contract — judging it
// against `## Requirements` the way an assignment is judged would make an
// ordinary brief classify as unfilled — so its content is whatever survives
// stripping the seeded heading and comment hints. Returns '' when only those
// remain.
function briefBody(content) {
    return content
        .replace(/<!--[\s\S]*?-->/g, '')
        .split('\n')
        .filter(function (l) { return !/^\s*#{1,6}\s/.test(l); })
        .join('\n')
        .trim();
}

// Classify a context document into the card's three states. `kind` selects the
// contract: an 'assignment' is judged against its `## Requirements` section, a
// 'brief' against its body (see briefBody).
//   'absent'   — no file / empty content: render no card.
//   'unfilled' — an assignment with no `## Requirements` header or a section
//                holding only HTML comments / whitespace (the seeded hint); a
//                brief with nothing beyond its heading and hints: render the
//                invite.
//   'filled'   — the section (or the brief's body) has real content: render the
//                summary.
function classifyAssignment(content, kind) {
    if (typeof content !== 'string' || !content.trim()) return 'absent';
    if (kind === 'brief') return briefBody(content) ? 'filled' : 'unfilled';
    const req = extractRequirementsSection(content);
    if (req === null) return 'unfilled';
    const stripped = req.replace(/<!--[\s\S]*?-->/g, '').trim();
    return stripped ? 'filled' : 'unfilled';
}

// Build the context descriptor the card renders from: `{ state, kind }` for
// absent / unfilled, and for filled the summary — the document's first real line
// as the title, plus a word count over the comment-stripped document, a section
// count of its `## ` headers, and the ordered rubric aspect IDs. The aspect list
// is parsed once here (per read); the card's coverage tally against agent_queue
// rows is recomputed each paint in buildAssignmentCard. `kind` rides on the
// descriptor so every surface built from it words itself for the right document
// without re-resolving the target.
function describeAssignment(content, kind) {
    const docKind = kind === 'brief' ? 'brief' : 'assignment';
    const state = classifyAssignment(content, docKind);
    if (state !== 'filled') return { state: state, kind: docKind };
    // The title is the document's first real line — a requirement row for an
    // assignment, the brief's opening sentence for a project.
    const titleSource = docKind === 'brief'
        ? briefBody(content)
        : (extractRequirementsSection(content) || '').replace(/<!--[\s\S]*?-->/g, '');
    const firstLine = titleSource
        .split('\n').map(function (l) { return l.trim(); })
        .find(function (l) { return l.length > 0; })
        || (docKind === 'brief' ? 'Project brief' : 'Assignment');
    const cleaned = content.replace(/<!--[\s\S]*?-->/g, '');
    const words = (cleaned.match(/\S+/g) || []).length;
    const sections = cleaned.split('\n').filter(function (l) {
        return /^##\s+/.test(l);
    }).length;
    return {
        state: 'filled',
        kind: docKind,
        title: firstLine,
        words: words,
        sections: sections,
        // A project brief carries no rubric, and reporting no aspects is exactly
        // what routes it through the untallied paths — no fraction, no bar, and
        // proposals grouped last. Inventing IDs from its `##` headings would
        // produce a coverage fraction with a meaningless denominator.
        aspects: docKind === 'brief' ? [] : parseAspects(content),
        aspectLabels: docKind === 'brief' ? Object.create(null) : parseAspectLabels(content),
    };
}

// Fetch a project's context document once and repaint with the classified
// result — `assignment.md` on an assignment repo, `project.md` on a personal one
// (inject.js resolves the path from the same target).
// The project the read belongs to is threaded in by the caller (the board and the
// mount path omit it and fall back to the current DOM selection, unchanged from
// before); recording it in `_assignmentProject` lets mount + project switch avoid a
// double-fetch (see subscribeAgentView / renderAgentView) AND serves as the
// mid-fetch staleness guard. A no-target project resolves synchronously to absent
// (no card) without a Worker call.
export function refreshAssignment(target, projectName) {
    const name = (typeof projectName === 'string' && projectName)
        ? projectName
        : getSelectedProjectName();
    // A routed project whose target can't be resolved yet has NOT been answered,
    // so leave the cache unbound: recording `_assignmentProject` here is what
    // made the double-fetch guard swallow every later read. Staying unresolved
    // keeps getAssignmentState() null (the tab hides, as it does before any read
    // lands) and lets the next call — the `injectTargetsLoaded` retry above, or a
    // project switch — read for real.
    if (!target && isAwaitingInjectTargets(name)) {
        _assignment = null;
        notifyAssignmentChange();
        return;
    }
    _assignmentProject = name;
    const kind = docKindFor(target);
    _assignmentKind = kind;
    if (!target) {
        _assignment = { state: 'absent', kind: kind };
        notifyAssignmentChange();
        return;
    }
    readAssignmentFromWorker(target).then(function (res) {
        // Guard against a project switch mid-fetch: only the most recent read may
        // populate the cache. `_assignmentProject` is set synchronously to the
        // intended project by every refreshAssignment call, so if a later switch
        // superseded this read it no longer matches `name` and this stale read is
        // dropped. Keying off `_assignmentProject` rather than the DOM selection
        // keeps the guard correct even when the selection reader lags the switch.
        if (_assignmentProject !== name) return;
        _assignment = describeAssignment(res && res.ok ? res.content : null, kind);
        paint();
        notifyAssignmentChange();
    });
}

// Apply a just-saved assignment.md straight from the text the user wrote, with
// no Worker read. Mirrors refreshAssignment's success path synchronously: the
// cache is rebound to the current project, reclassified from the saved content,
// and the card + every assignment listener (the chat pane's COVERAGE tab) repaint
// off it. The saved text is authoritative — a fresh read only risks being served
// the pre-edit file by Worker caching or GitHub propagation lag, which used to
// leave the coverage summary and its Derive / Draft controls showing the old
// classification until a full reload. refreshAssignment stays the path for the
// mount read and the project-switch read, where there is no local content to use.
export function applyAssignmentSave(content) {
    _assignmentProject = getSelectedProjectName();
    // The kind is a property of the routed repo, not of the text just saved, so
    // it carries over from the read (or the editor open) that preceded this.
    _assignment = describeAssignment(
        typeof content === 'string' ? content : null, _assignmentKind);
    paint();
    notifyAssignmentChange();
}

// A file-text glyph for the assignment card. DOM-built like the other glyphs
// (no new asset, no icon library) and theme-correct via currentColor.
function buildFileTextIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.6');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    [
        ['path', { d: 'M14 3H7a2 2 0 0 0 -2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2V8z' }],
        ['path', { d: 'M14 3v5h5' }],
        ['line', { x1: '9', y1: '13', x2: '15', y2: '13' }],
        ['line', { x1: '9', y1: '17', x2: '13', y2: '17' }],
    ].forEach(function (spec) {
        const el = document.createElementNS(ns, spec[0]);
        Object.keys(spec[1]).forEach(function (k) { el.setAttribute(k, spec[1][k]); });
        svg.appendChild(el);
    });
    return svg;
}

// The assignment-context card mounted at the top of the AGENT board, rendered
// Tap handler for the assignment card. Re-reads assignment.md at tap time for
// fresh content + sha (the `_assignment` cache holds only the classified
// descriptor, never raw content/sha), then opens the editor modal preloaded with
// that content. On a failed re-read it surfaces a toast and does not open —
// creating the file on a repo that lacks one is a separate future entry, and the
// card is only shown when the file already exists. On Save the modal hands back
// the text it wrote and the card repaints from it via applyAssignmentSave — no
// second read, so a stale one can't undo the edit on screen.
function openAssignmentEditor() {
    const target = resolveReadTarget();
    if (!target) {
        showInjectToast(
            'No repo linked — cannot edit the ' + docNoun(_assignmentKind) + '.', 'error');
        return;
    }
    const kind = docKindFor(target);
    _assignmentKind = kind;
    readAssignmentFromWorker(target).then(function (res) {
        if (!res || !res.ok) {
            showInjectToast(
                'Could not load ' + docFileName(kind) + ': ' + ((res && res.reason) || 'Unknown error'),
                'error'
            );
            return;
        }
        // The modal words its header, its textarea label and its conflict text
        // from the kind rather than resolving the target a second time.
        showAssignmentEditorModal(target, res.content, res.sha, {
            docKind: kind,
            onSaved: function (saved) { applyAssignmentSave(saved); },
        });
    });
}

// The coverage status of one rubric aspect, derived from the states of the
// agent_queue rows carrying its tag. Priority (highest first): a shipped row
// means covered; else an in-flight (dispatched/running) row; else a failed row;
// else a blocked (needs_words or needs_mockup) row; else a drafted row; else a
// proposed row; else nothing has started. "Covered" (the summary's numerator) is
// exactly the shipped case.
//
// Both waiting-on-you states count as blocked: a row parked in needs_mockup is
// as stalled as one parked in needs_words — it is waiting on a visual direction
// instead of on words — and without this it would read as not-started, hiding
// the aspect from the modal's "Waiting on you" group entirely.
//
// `failed` and `drafted` are recognised for the same reason: without them a row
// in either state matched nothing and fell through to 'not-started', so the tab
// read the aspect as untouched while the derive routine counted it as covered
// and skipped it — an aspect that deadlocks in silence. `failed` sorts ABOVE
// `blocked` because a broken run needs attention before an unanswered question
// does; `drafted` sorts below both, since a draft waiting on a Dispatch is
// progress rather than a stall. Neither counts toward the covered numerator.
function aspectStatus(rows) {
    let inFlight = false, failed = false, blocked = false;
    let drafted = false, proposed = false;
    for (let i = 0; i < rows.length; i++) {
        const s = rows[i] && rows[i].state;
        if (s === 'shipped') return 'shipped';
        if (s === 'dispatched' || s === 'running') inFlight = true;
        else if (s === 'failed') failed = true;
        else if (s === 'needs_words' || s === 'needs_mockup') blocked = true;
        else if (s === 'drafted') drafted = true;
        else if (s === 'proposed') proposed = true;
    }
    if (inFlight) return 'in-flight';
    if (failed) return 'failed';
    if (blocked) return 'blocked';
    if (drafted) return 'drafted';
    if (proposed) return 'proposed';
    return 'not-started';
}

// The two statuses pinned in the detail modal's "Waiting on you" group: a
// blocked aspect (a question waiting on an answer) and a failed one (a run
// waiting on a retry). Shared by the modal's grouping, its section echoes and
// the pane's breakdown count so the pinned group, the section rows and the
// pane's "N blocked" can never disagree about what needs attention.
function isAttentionStatus(status) {
    return status === 'blocked' || status === 'failed';
}

// Tally the coverage of the rubric `aspects` against the live agent_queue
// `rows`: group rows by their `aspect` tag, derive each aspect's status, and
// count shipped / in-flight aspects. `outstanding` is the segmented bar's third
// slice — every aspect neither shipped nor in-flight (blocked, proposed,
// not-started). Recomputed each paint so it tracks rows shipping/changing live.
function computeCoverage(aspects, rows) {
    const byAspect = Object.create(null);
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
        const tag = r && typeof r.aspect === 'string' ? r.aspect.trim() : '';
        if (!tag) return;
        (byAspect[tag] || (byAspect[tag] = [])).push(r);
    });
    let shipped = 0, inFlight = 0;
    aspects.forEach(function (a) {
        const st = aspectStatus(byAspect[a] || []);
        if (st === 'shipped') shipped++;
        else if (st === 'in-flight') inFlight++;
    });
    const total = aspects.length;
    return {
        total: total,
        shipped: shipped,
        inFlight: inFlight,
        outstanding: total - shipped - inFlight,
    };
}

// Tally one rubric section's aspects using the same shipped / in-flight /
// everything-else split computeCoverage applies to the whole rubric, so a
// section head can never disagree with the modal's header total. Takes the
// classified items the detail modal already built rather than re-deriving each
// status from the queue rows a second time.
function sectionTally(list) {
    let shipped = 0, inFlight = 0;
    list.forEach(function (it) {
        if (it && it.status === 'shipped') shipped++;
        else if (it && it.status === 'in-flight') inFlight++;
    });
    return {
        total: list.length,
        shipped: shipped,
        inFlight: inFlight,
        outstanding: list.length - shipped - inFlight,
    };
}

// Bucket classified aspect items into rubric sections by the letter of their ID,
// preserving the order letters first appear (the list arrives in rubric-file
// order from parseAspects) and item order within each bucket. Reuses
// aspectSortKey, which accepts any object carrying `.aspect`, so there's no
// second regex to drift. Items whose ID doesn't split into a leading letter
// collect into `other`, which the modal renders as one trailing group — every ID
// parseAspects yields does split, so that bucket guards against a future ID
// shape rather than a state today's parse can reach. Exported because that guard
// is unreachable through the parse path and can only be exercised directly.
export function groupAspectsBySection(list) {
    const order = [];
    const buckets = Object.create(null);
    const other = [];
    (Array.isArray(list) ? list : []).forEach(function (it) {
        const key = aspectSortKey({ aspect: it && it.id });
        if (!key) { other.push(it); return; }
        if (!buckets[key.letter]) { buckets[key.letter] = []; order.push(key.letter); }
        buckets[key.letter].push(it);
    });
    return {
        sections: order.map(function (letter) {
            return { letter: letter, items: buckets[letter] };
        }),
        other: other,
    };
}

// Build the filled card's coverage summary — a gap-framed headline plus a
// segmented progress bar — from the rubric `aspects` and the live agent_queue
// `rows`. The headline leads with the outstanding count (aspects not yet
// covered), since the pre-submit question is "what's still missing"; the bar
// splits the aspects into shipped / in-flight / outstanding proportions.
function buildCoverageSummary(aspects, rows) {
    const cov = computeCoverage(aspects, rows);
    const wrap = document.createElement('div');
    wrap.className = 'agentCoverage';
    // The summary is a drill-in affordance: tapping it opens the coverage detail
    // modal. Give it button semantics + keyboard activation, and stop the event
    // from bubbling to the card's openAssignmentEditor handler (mirroring the
    // Draft button's stopPropagation guard so the editor doesn't also open).
    wrap.setAttribute('role', 'button');
    wrap.setAttribute('tabindex', '0');
    wrap.setAttribute('aria-label', 'View coverage detail');
    wrap.addEventListener('click', function (e) {
        e.stopPropagation();
        showCoverageDetailModal();
    });
    wrap.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            e.stopPropagation();
            showCoverageDetailModal();
        }
    });

    const head = document.createElement('div');
    head.className = 'agentCoverageHead';

    const headline = document.createElement('div');
    headline.className = 'agentCoverageHeadline';
    const outstanding = cov.total - cov.shipped;
    headline.textContent = outstanding + ' outstanding · ' +
        cov.shipped + ' of ' + cov.total + ' covered';
    head.appendChild(headline);

    const chevron = document.createElement('span');
    chevron.className = 'agentCoverageChevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.appendChild(buildChevronRightIcon());
    head.appendChild(chevron);
    wrap.appendChild(head);

    // The bar is decorative — the headline text is the accessible summary — so
    // hide it from assistive tech. Three proportional segments sized by aspect
    // count via flex-grow (computed dynamically, hence inline); a zero-count
    // segment collapses to nothing.
    const bar = document.createElement('div');
    bar.className = 'agentCoverageBar';
    bar.setAttribute('aria-hidden', 'true');
    [
        { key: 'shipped', n: cov.shipped },
        { key: 'in-flight', n: cov.inFlight },
        { key: 'outstanding', n: cov.outstanding },
    ].forEach(function (seg) {
        const el = document.createElement('div');
        el.className = 'agentCoverageSeg agentCoverageSeg--' + seg.key;
        el.style.flexGrow = String(seg.n);
        el.setAttribute('data-count', String(seg.n));
        bar.appendChild(el);
    });
    wrap.appendChild(bar);
    return wrap;
}

// A small right-pointing chevron for the tappable coverage summary. DOM-built
// like the other glyphs (no new asset, no icon library) and theme-correct via
// currentColor.
function buildChevronRightIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M9 6l6 6l-6 6');
    svg.appendChild(path);
    return svg;
}

// A checkmark glyph for the icon-only confirmation tick on blocked rows. DOM-built
// like the other glyphs (no new asset, no icon library) and theme-correct via
// currentColor, so it picks up the tick's amber / committed-white colour.
function buildCheckIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.4');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M5 12l5 5l9 -9');
    svg.appendChild(path);
    return svg;
}

// The human-readable status label for each aspect lifecycle, shown in the
// coverage detail modal's per-aspect rows. Keys match aspectStatus()'s return
// values; process/manual aspects render their own "manual · outstanding" copy.
const COVERAGE_STATUS_LABEL = {
    shipped: 'Shipped',
    'in-flight': 'In progress',
    failed: 'Failed',
    blocked: 'Blocked',
    drafted: 'Drafted',
    proposed: 'Proposed',
    'not-started': 'Not started',
};

// Rubric aspects the agent can't ship — Git / process work (commit history,
// branching, repository hygiene) — matched by keyword against the aspect label.
// These carry no agent-driven done-state, so the detail modal sets them apart in
// a manual lane reading "manual · outstanding" rather than a lifecycle status.
const PROCESS_ASPECT_RE = /commit|branch|repositor|version control|\bgit\b|\bhistory\b/i;

function isProcessAspect(label) {
    return PROCESS_ASPECT_RE.test(label || '');
}

// Build one control for a project+aspect's confirmation tick: a checkbox-role
// button whose accent-filled / amber-outlined state reflects the shared
// `ctx.committed` Set. Toggling optimistically flips the UI + header count,
// persists via listLogic.setAspectSubmitted, and reverts on failure. Rendered
// on every aspect row with status-appropriate copy — "Committed to GitLab" in a
// shipped aspect's expansion, "mark done" on a manual aspect's row, and
// "Confirmed" on every other aspect — so any aspect can be signed off
// independently of its derived status. Registers itself in `ctx.ticks` so the
// modal's async submission-hydrate can refresh it once stored state loads.
// `iconOnly` renders the compact square variant used on blocked rows, whose
// status word and chevron leave no room for a text-labelled control: same
// role/state/behaviour, but a checkmark glyph carries the visual and `labelText`
// becomes the accessible name instead of visible copy.
function buildCommitTick(item, ctx, labelText, iconOnly) {
    const committed = (ctx && ctx.committed instanceof Set) ? ctx.committed : new Set();
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'coverageCommitTick' + (iconOnly ? ' coverageCommitTick--icon' : '');
    btn.setAttribute('role', 'checkbox');

    if (iconOnly) {
        btn.setAttribute('aria-label', labelText);
        btn.title = labelText;
        btn.appendChild(buildCheckIcon());
    } else {
        const box = document.createElement('span');
        box.className = 'coverageCommitTickBox';
        box.setAttribute('aria-hidden', 'true');
        btn.appendChild(box);

        const label = document.createElement('span');
        label.className = 'coverageCommitTickLabel';
        label.textContent = labelText;
        btn.appendChild(label);
    }

    const setState = function (on) {
        btn.setAttribute('aria-checked', on ? 'true' : 'false');
        btn.classList.toggle('is-committed', on);
    };
    setState(committed.has(item.id));
    // Let the async submission-hydrate re-sync this tick to stored state.
    if (ctx && Array.isArray(ctx.ticks)) {
        ctx.ticks.push({ id: item.id, refresh: function () { setState(committed.has(item.id)); } });
    }

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (btn.disabled) return;
        const wasOn = committed.has(item.id);
        const nextOn = !wasOn;
        // Optimistic: flip the tick + header count before the write resolves.
        if (nextOn) committed.add(item.id); else committed.delete(item.id);
        setState(nextOn);
        if (ctx && typeof ctx.onCountChange === 'function') ctx.onCountChange();
        btn.disabled = true;
        const revert = function (msg) {
            if (wasOn) committed.add(item.id); else committed.delete(item.id);
            setState(wasOn);
            if (ctx && typeof ctx.onCountChange === 'function') ctx.onCountChange();
            showInjectToast(msg || 'Couldn’t update the tick — try again.', 'error');
        };
        Promise.resolve(
            (ctx && ctx.projectId)
                ? listLogic.setAspectSubmitted(ctx.projectId, item.id, nextOn)
                : { ok: false, error: 'No project linked.' }
        ).then(function (res) {
            btn.disabled = false;
            if (!res || !res.ok) revert(res && res.error);
        }, function () {
            btn.disabled = false;
            revert();
        });
    });
    return btn;
}

// The Retry control mounted on a failed aspect's row in the detail modal. A
// derive row carries `todo_id: null`, so a failed derive run has no task row to
// retry from — this is its only surface. Runs the SAME shared dispatch the task
// row's Retry does (dispatchDraft with the row's stored `entry_id`), so the
// marker already in TODO.md is reused and injectEntry dedup-skips rather than
// appending a second copy of the entry. On success the row leaves `failed` and
// the queue-change repaint restyles the aspect; a failure re-enables the button
// and surfaces a toast, since a two-line grid row has no space for an inline
// error lane.
function buildAspectRetry(queueRow) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'coverageRetryBtn';
    btn.textContent = 'Retry';
    // Retry proceeds on the stored entry_id alone (the marker is already in
    // TODO.md); with neither an id nor a draft there is nothing to re-ship.
    const draftText = (queueRow.draft || '').trim();
    btn.disabled = !(queueRow.entry_id || draftText);

    btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('is-pending');
        btn.textContent = 'Retrying…';
        const fail = function (message) {
            btn.disabled = false;
            btn.classList.remove('is-pending');
            btn.textContent = 'Retry';
            showInjectToast(message || 'Could not retry. Try again.', 'error');
        };
        Promise.resolve(dispatchDraft(queueRow, draftText, queueRow.entry_id))
            .then(function (res) {
                // On success the row leaves `failed`; the queue-change repaint
                // rebuilds the modal body, so there is nothing to restore here.
                if (res && res.ok) return;
                fail(res && res.error);
            }, function () { fail(); });
    });
    return btn;
}

// Which blocked aspect's answer lane is currently open, or null. Module-level
// because the coverage modal's body is rebuilt wholesale on every onQueueChange —
// element state would be lost — so the open lane is re-expanded from this after
// each rebuild. Reset when the modal opens, so it always opens fully collapsed.
let _expandedBlockedAspect = null;

// Build one row of the coverage detail modal: a status dot, the aspect ID, its
// rubric label, and a status word. Blocked aspects (a needs_words question is
// waiting) render as a tap-to-expand toggle that reveals an answer lane — the
// question, a reply box, Send, and a hand-off to chat — so the question can be
// answered without leaving the modal. Shipped aspects render as a tap-to-expand
// toggle that reveals a commit-helper lane (copy-ready commit message + file
// manifest for the GitHub → GitLab transfer, plus a "Committed to GitLab" tick).
// Failed aspects render a static row carrying a Retry that re-dispatches the
// broken run — their derive row has no task row to retry from.
// Manual Git/process aspects render a static row with a "mark done" tick. Every
// other status (in progress, proposed, blocked, not started) renders with a
// "Confirmed" tick so any aspect can be signed off by hand alongside its derived
// status. `ctx` carries the shared committed-tick state (see buildCommitTick);
// absent for callers that don't wire ticks.
function buildCoverageDetailRow(item, ctx) {
    // The waiting row behind a blocked aspect — the question the answer lane
    // replies to. A blocked status always derives from one (see aspectStatus),
    // but resolve it rather than assume it: with no row there is nothing to
    // answer, so the aspect falls back to a static row. Matches BOTH blocked
    // states aspectStatus recognises, so a needs_mockup aspect still finds the
    // row behind its amber flag — answering in words re-triages it exactly as it
    // does a needs_words row (the mockup itself is chosen from the proposal
    // review sheet's card).
    const blockedRow = (item.status === 'blocked' && Array.isArray(item.rows))
        ? item.rows.find(function (r) {
            return r && (r.state === 'needs_words' || r.state === 'needs_mockup');
        })
        : null;
    const isAnswerable = !!blockedRow;
    // The broken run behind a failed aspect — what Retry re-dispatches. Resolved
    // rather than assumed for the same reason blockedRow is: with no row there is
    // nothing to retry, so the aspect renders without the control.
    const failedRow = (item.status === 'failed' && Array.isArray(item.rows))
        ? item.rows.find(function (r) { return r && r.state === 'failed'; })
        : null;
    // Shipped, non-process aspects expand to a commit helper derived from their
    // shipped rows; nothing to commit for any other status, so they stay static.
    const shippedRows = (!item.process && item.status === 'shipped' &&
        Array.isArray(item.rows))
        ? item.rows.filter(function (r) { return r && r.state === 'shipped'; })
        : [];
    const isExpandable = shippedRows.length > 0;
    const interactive = isAnswerable || isExpandable;
    const row = document.createElement(interactive ? 'button' : 'div');
    row.className = 'coverageDetailRow coverageDetailRow--' +
        (item.process ? 'manual' : item.status);
    if (interactive) row.type = 'button';

    const dot = document.createElement('span');
    dot.className = 'coverageDetailDot';
    dot.setAttribute('aria-hidden', 'true');
    row.appendChild(dot);

    const id = document.createElement('span');
    id.className = 'coverageDetailId';
    id.textContent = item.id;
    row.appendChild(id);

    const label = document.createElement('span');
    label.className = 'coverageDetailLabel';
    label.textContent = item.label || '(no label)';
    row.appendChild(label);

    const status = document.createElement('span');
    status.className = 'coverageDetailStatus';
    status.textContent = item.process
        ? 'manual · outstanding'
        : (COVERAGE_STATUS_LABEL[item.status] || item.status);
    row.appendChild(status);

    // Manual Git/process aspects can't be shipped by the agent, so in place of a
    // commit helper they get a "mark done" tick that persists to the same
    // aspect_submissions store as the shipped checkboxes.
    if (item.process && ctx) {
        row.appendChild(buildCommitTick(item, ctx, 'mark done'));
    }

    if (!isExpandable) {
        // Every non-process, non-shipped aspect (in progress, proposed, blocked,
        // not started) also carries a confirmation tick, so ANY aspect can be
        // signed off by hand alongside its derived status — confirmation is a
        // second, independent axis, never an override of the derived lifecycle.
        // (Shipped aspects confirm through the commit lane's tick below; process
        // aspects already have their "mark done" tick above.) A blocked row spends
        // its width on the amber status word and the disclosure chevron, so its
        // tick renders icon-only — otherwise the text label pushes the control off
        // the right edge of the modal on narrow screens.
        const confirmTick = (ctx && !item.process)
            ? buildCommitTick(item, ctx, 'Confirmed', item.status === 'blocked') : null;
        if (isAnswerable) {
            // Tap-to-expand: the row discloses an answer lane below it. The row is
            // itself a <button>, so the tick <button> can't nest inside it — pair
            // them as siblings in a flex head, with the lane beneath both.
            makeDisclosure(row);
            const head = document.createElement('div');
            head.className = 'coverageDetailConfirmable';
            head.appendChild(row);
            if (confirmTick) head.appendChild(confirmTick);

            const wrap = document.createElement('div');
            wrap.className = 'coverageDetailItem';
            wrap.appendChild(head);
            wrap.appendChild(buildAnswerLane(blockedRow));
            wireDisclosure(row, wrap, function (open) {
                _expandedBlockedAspect = open ? item.id : null;
            });
            // The modal body is rebuilt on every onQueueChange, so an open lane
            // would be torn down mid-typing. Re-expand the aspect the user left
            // open (buildAnswerLane restores the unsent draft alongside it).
            if (_expandedBlockedAspect === item.id) setDisclosureOpen(row, wrap, true);
            return wrap;
        }
        // A failed aspect carries a Retry beside its tick. It is never answerable
        // (a failed status and a blocked one are mutually exclusive), so it always
        // lands here rather than in the disclosure branch above.
        if (failedRow) row.appendChild(buildAspectRetry(failedRow));
        if (confirmTick) row.appendChild(confirmTick);
        return row;
    }

    // Tap-to-expand: chevron + a commit-helper panel toggled below the row.
    makeDisclosure(row);

    const wrap = document.createElement('div');
    wrap.className = 'coverageDetailItem';
    wrap.appendChild(row);
    const panel = buildCommitHelperPanel(item, shippedRows, ctx);
    wrap.appendChild(panel);

    wireDisclosure(row, wrap);

    return wrap;
}

// An attention aspect's echo inside its home rubric section — blocked (a waiting
// question) or failed (a broken run). The live, actionable row is pinned in the
// "Waiting on you" group at the top of the modal, but its section still counts
// it — so without an echo a section reading "1 / 3" would show only two rows.
// Renders as a dimmed div, never a button: there is nothing to disclose here, no
// tick, no Retry and no chevron, and the whole row is aria-hidden so the pinned
// row stays the single announced one.
function buildSectionEchoRow(item) {
    const row = document.createElement('div');
    row.className = 'coverageDetailRow coverageDetailRow--' + item.status +
        ' coverageDetailRow--echo';
    row.setAttribute('aria-hidden', 'true');

    const dot = document.createElement('span');
    dot.className = 'coverageDetailDot';
    row.appendChild(dot);

    const id = document.createElement('span');
    id.className = 'coverageDetailId';
    id.textContent = item.id;
    row.appendChild(id);

    const label = document.createElement('span');
    label.className = 'coverageDetailLabel';
    label.textContent = item.label || '(no label)';
    row.appendChild(label);

    const status = document.createElement('span');
    status.className = 'coverageDetailStatus';
    status.textContent = 'Waiting on you ↑';
    row.appendChild(status);

    return row;
}

// Turn a detail row into a disclosure control: the expandable treatment plus a
// chevron that rotates when its .coverageDetailItem wrapper is expanded. Shared
// by the shipped commit lane and the blocked answer lane so the two affordances
// can't drift apart.
function makeDisclosure(row) {
    row.classList.add('coverageDetailRow--expandable');
    row.setAttribute('aria-expanded', 'false');
    const chevron = document.createElement('span');
    chevron.className = 'coverageDetailChevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.appendChild(buildChevronRightIcon());
    row.appendChild(chevron);
}

// Bind a disclosure row's click to toggling its wrapper's expanded state, keeping
// aria-expanded in step. `onToggle` receives the new state so a caller can record
// which aspect is open across a body rebuild.
function wireDisclosure(row, wrap, onToggle) {
    row.addEventListener('click', function () {
        const open = wrap.classList.toggle('is-expanded');
        row.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (typeof onToggle === 'function') onToggle(open);
    });
}

// Set a disclosure's expanded state directly (no click), for restoring an open
// lane after the modal body is rebuilt.
function setDisclosureOpen(row, wrap, open) {
    wrap.classList.toggle('is-expanded', !!open);
    row.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// Build the commit-helper lane revealed when a shipped aspect is expanded: a
// copy-ready commit message (the aspect's shipped-row title + the aspect ID)
// and the file manifest (the deduped union of `file_paths` across the aspect's
// shipped rows — which files to copy into the GitLab clone). Derived entirely
// from the shipped rows, so no storage and no backend. `ctx`, when present,
// adds a "Committed to GitLab" tick (the built-vs-submitted distinction) that
// persists to aspect_submissions via buildCommitTick.
function buildCommitHelperPanel(item, shippedRows, ctx) {
    const panel = document.createElement('div');
    panel.className = 'coverageCommitLane';

    // The submission tick: whether this shipped aspect has been copied into the
    // GitLab clone yet. Amber until ticked, accent once committed.
    if (ctx) {
        const tickRow = document.createElement('div');
        tickRow.className = 'coverageCommitTickRow';
        tickRow.appendChild(buildCommitTick(item, ctx, 'Committed to GitLab'));
        panel.appendChild(tickRow);
    }

    const first = shippedRows[0];
    const title = (first && first.context && first.context.title) ||
        item.label || item.id;
    const message = title + ' (' + item.id + ')';

    const msgRow = document.createElement('div');
    msgRow.className = 'coverageCommitMsgRow';

    const msg = document.createElement('span');
    msg.className = 'coverageCommitMsg';
    msg.textContent = message;
    msgRow.appendChild(msg);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'coverageCommitCopy';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', function () {
        let copied;
        try {
            copied = navigator.clipboard.writeText(message);
        } catch (e) {
            copied = Promise.reject(e);
        }
        Promise.resolve(copied).then(function () {
            showInjectToast('Commit message copied.');
        }, function () {
            showInjectToast('Couldn’t copy the commit message — try again.', 'error');
        });
    });
    msgRow.appendChild(copyBtn);
    panel.appendChild(msgRow);

    // File manifest: deduped union of file_paths across the shipped rows.
    const files = [];
    const seen = Object.create(null);
    shippedRows.forEach(function (r) {
        const paths = (r && Array.isArray(r.file_paths)) ? r.file_paths : [];
        paths.forEach(function (p) {
            const path = typeof p === 'string' ? p.trim() : '';
            if (path && !seen[path]) { seen[path] = true; files.push(path); }
        });
    });

    if (files.length) {
        const manifestLabel = document.createElement('div');
        manifestLabel.className = 'coverageCommitManifestLabel';
        manifestLabel.textContent = files.length === 1
            ? '1 file' : files.length + ' files';
        panel.appendChild(manifestLabel);

        const list = document.createElement('ul');
        list.className = 'coverageCommitManifest';
        files.forEach(function (p) {
            const li = document.createElement('li');
            li.className = 'coverageCommitManifestItem';

            const pathSpan = document.createElement('span');
            pathSpan.className = 'coverageCommitManifestPath';
            pathSpan.textContent = p;
            li.appendChild(pathSpan);

            const fileCopyBtn = document.createElement('button');
            fileCopyBtn.type = 'button';
            fileCopyBtn.className = 'coverageCommitFileCopy';
            fileCopyBtn.textContent = 'Copy';
            fileCopyBtn.addEventListener('click', function () {
                const target = resolveReadTarget();
                if (!target) {
                    showInjectToast('No repo linked — cannot copy the file.', 'error');
                    return;
                }
                // The read is a network round-trip (unlike the instant
                // commit-message copy), so disable the button until it settles
                // to keep a double-tap from firing two reads.
                fileCopyBtn.disabled = true;
                readRepoFile(target, p).then(function (res) {
                    if (!res || !res.ok || typeof res.content !== 'string') {
                        showInjectToast('Couldn’t read ' + p + ' — try again.', 'error');
                        fileCopyBtn.disabled = false;
                        return;
                    }
                    let copied;
                    try {
                        copied = navigator.clipboard.writeText(res.content);
                    } catch (e) {
                        copied = Promise.reject(e);
                    }
                    Promise.resolve(copied).then(function () {
                        showInjectToast(p + ' copied.');
                    }, function () {
                        showInjectToast('Couldn’t copy ' + p + ' — try again.', 'error');
                    }).then(function () {
                        fileCopyBtn.disabled = false;
                    });
                });
            });
            li.appendChild(fileCopyBtn);

            list.appendChild(li);
        });
        panel.appendChild(list);
    } else {
        const empty = document.createElement('div');
        empty.className = 'coverageCommitManifestEmpty';
        empty.textContent = 'No files recorded for this aspect.';
        panel.appendChild(empty);
    }

    return panel;
}

// Assemble the chat seed for a needs_words hand-off: the task title and
// description (from the row's `context`) plus triage's pending question, framed
// as an opening turn. The user still sends it — this only pre-fills the composer.
// Mirrors the board's buildDiscussSeed; reproduced rather than imported because
// agentView.js no longer loads in the app.
function buildAnswerSeed(row) {
    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const val = function (v) { return (v == null) ? '' : String(v).trim(); };
    const title = val(ctx.title) || val(row.title);
    const description = val(ctx.description);
    const question = val(row.question);

    const lines = ["I'd like to discuss this task and work out the details together."];
    if (title) { lines.push('', 'Task: ' + title); }
    if (description) { lines.push(description); }
    if (question) { lines.push('', 'The agent asked: ' + question); }
    return lines.join('\n');
}

// Build the answer lane revealed when a blocked aspect is expanded: triage's
// pending question, a reply box, a non-blocking error line, a "Discuss in chat"
// hand-off, and Send. This is the ONLY surface in the app that can answer a
// needs_words question raised against a rubric aspect — the row layer's ASKING
// block mounts per todo via `agent_queue.todo_id`, and a derive-produced aspect
// row that parks in needs_words before it is accepted into a todo has none.
//
// Sending appends to the row's thread and re-queues the task (state → triaging)
// through listLogic.answerAgentTask — the only sanctioned agent_queue write path —
// then reloads the queue and fires a triage sweep so the answer is picked up.
// The answer is already saved by then, so a failed sweep is surfaced as a toast
// and never blocks or rolls back the send.
function buildAnswerLane(queueRow) {
    const lane = document.createElement('div');
    lane.className = 'coverageAnswerLane';

    const q = (queueRow.question || '').trim();
    if (q) {
        const question = document.createElement('p');
        question.className = 'coverageAnswerQuestion';
        question.textContent = q;
        lane.appendChild(question);
    }

    // The 16px font-size (in CSS) avoids iOS Safari's focus auto-zoom.
    const input = document.createElement('textarea');
    input.className = 'coverageAnswerInput';
    input.rows = 3;
    input.placeholder = 'Answer to continue…';
    input.setAttribute('aria-label', 'Answer');
    // The modal body is rebuilt on every onQueueChange, which tears this textarea
    // down. Mirror the draft into the shared store on each keystroke and re-apply
    // it here, so an unsent answer survives a rebuild (and is shared with the row
    // layer's own answer control).
    if (pendingAnswers.has(queueRow.id)) input.value = pendingAnswers.get(queueRow.id);
    input.addEventListener('input', function () {
        pendingAnswers.set(queueRow.id, input.value);
    });
    lane.appendChild(input);

    const errorEl = document.createElement('p');
    errorEl.className = 'coverageAnswerError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    lane.appendChild(errorEl);

    const actions = document.createElement('div');
    actions.className = 'coverageAnswerActions';

    // A lightweight hand-off to the in-app Claude chat, sitting left of Send. For
    // questions that need real back-and-forth, re-firing a triage sweep per answer
    // is too heavy; this seeds a chat with the task context instead and leaves the
    // conversation to the user. It never writes to the data model. The row id
    // links the session so a ship from it still settles this row.
    const discuss = document.createElement('button');
    discuss.type = 'button';
    discuss.className = 'coverageAnswerDiscuss';
    discuss.textContent = 'Discuss in chat';
    discuss.addEventListener('click', function () {
        openChatWithSeed(buildAnswerSeed(queueRow), queueRow.id);
    });
    actions.appendChild(discuss);

    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'coverageAnswerSend';
    send.textContent = 'Send';
    actions.appendChild(send);
    lane.appendChild(actions);

    // Submit the trimmed answer. Empty/whitespace-only input is ignored (no
    // write). While the write is in flight the input and button are disabled; on
    // failure both re-enable and the error line shows.
    function submitAnswer() {
        if (send.disabled) return;
        const text = (input.value || '').trim();
        if (!text) return;
        errorEl.hidden = true;
        errorEl.textContent = '';
        send.disabled = true;
        input.disabled = true;
        send.classList.add('is-pending');
        send.textContent = 'Sending…';
        const fail = function (msg) {
            send.disabled = false;
            input.disabled = false;
            send.classList.remove('is-pending');
            send.textContent = 'Send';
            errorEl.textContent = msg || 'Could not send. Try again.';
            errorEl.hidden = false;
        };
        Promise.resolve(listLogic.answerAgentTask(queueRow.id, text, queueRow.thread))
            .then(function (res) {
                if (!res || !res.ok) {
                    fail(res && res.error);
                    return;
                }
                input.value = '';
                pendingAnswers.delete(queueRow.id);
                // Reload the queue so the row leaves needs_words even where the
                // realtime push isn't observed, then auto-fire the sweep that
                // re-triages it now that it carries the answer.
                loadQueueRows(getSelectedProjectName());
                Promise.resolve(fireTriageSweep(getSelectedProjectName())).then(function (tr) {
                    if (tr && tr.ok === false) {
                        showInjectToast('Answer saved, but triage didn’t start — tap Run to sweep.');
                    }
                });
            }, function () { fail(); });
    }

    // Enter (without Shift) submits; Shift+Enter inserts a newline.
    input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitAnswer();
        }
    });
    send.addEventListener('click', submitAnswer);

    return lane;
}

// The coverage detail modal: the drillable view behind the assignment card's
// coverage summary. Lists every rubric aspect with its live lifecycle status
// (shipped / in-flight / proposed / blocked / not-started), color-coded, reading
// its ID + rubric label. Blocked aspects (a needs_words question is waiting) are
// grouped and emphasized at the top in amber and expand in place into an answer
// lane for that question; Git / process aspects the agent can't ship are set apart
// in a manual lane. Reads `_assignment` (aspects + labels) and `_rows`, reusing computeCoverage's
// per-aspect status logic. Mirrors the assignment editor's chrome and the shared
// three-way dismiss (close X, backdrop, Escape — CLAUDE.md modal contract).
function showCoverageDetailModal(preloadedCommitted) {
    const a = _assignment;
    if (!a || a.state !== 'filled' ||
        !Array.isArray(a.aspects) || !a.aspects.length) {
        return;
    }
    const aspects = a.aspects;
    const labels = (a.aspectLabels && typeof a.aspectLabels === 'object')
        ? a.aspectLabels : {};

    // Shared committed-tick state for this modal. `committed` starts from any
    // preloaded Set (else empty) and is hydrated async from aspect_submissions
    // below; buildCommitTick mutates it optimistically and registers each tick in
    // `ctx.ticks` so the hydrate can re-sync them. `projectId` scopes the writes.
    // `committed` survives a live re-render (same reference), so hydrated ticks are
    // not lost when a row settles behind the open modal.
    const projectName = getSelectedProjectName();
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    const committed = (preloadedCommitted instanceof Set)
        ? preloadedCommitted : new Set();
    const ctx = { committed: committed, projectId: projectId, ticks: [], onCountChange: null };
    // The classified aspect list — reassigned on every (re)render from the live
    // rows, so committedCount and the async tick-hydrate always read the current set.
    let items = [];
    function committedCount() {
        let n = 0;
        items.forEach(function (it) { if (committed.has(it.id)) n++; });
        return n;
    }

    // Every blocked answer lane starts collapsed on a fresh open; the id only
    // persists so a live rebuild can restore a lane the user has open right now.
    _expandedBlockedAspect = null;

    const prior = document.getElementById('coverageDetailModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'coverageDetailModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'coverageDetailModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'coverageDetailModalTitleText');

    const header = document.createElement('div');
    header.id = 'coverageDetailModalHeader';

    const title = document.createElement('div');
    title.id = 'coverageDetailModalTitle';

    const eyebrow = document.createElement('span');
    eyebrow.id = 'coverageDetailModalEyebrow';
    eyebrow.textContent = 'COVERAGE';

    const titleText = document.createElement('span');
    titleText.id = 'coverageDetailModalTitleText';

    // The built-vs-submitted distinction: how many aspects are ticked as copied
    // into GitLab. Recomputed in place as ticks toggle (ctx.onCountChange) and
    // refreshed once stored submissions hydrate.
    const committedCountEl = document.createElement('span');
    committedCountEl.id = 'coverageDetailModalCommitted';
    function updateCommittedCount() {
        committedCountEl.textContent = committedCount() + ' committed to GitLab';
    }
    ctx.onCountChange = updateCommittedCount;

    title.appendChild(eyebrow);
    title.appendChild(titleText);
    title.appendChild(committedCountEl);

    const closeX = document.createElement('button');
    closeX.id = 'coverageDetailModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close coverage detail');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'coverageDetailModalBody';

    function appendGroup(labelText, list, modifier) {
        if (!list.length) return;
        const group = document.createElement('div');
        group.className = 'coverageDetailGroup' +
            (modifier ? ' coverageDetailGroup--' + modifier : '');
        if (labelText) {
            const heading = document.createElement('div');
            heading.className = 'coverageDetailGroupLabel';
            heading.textContent = labelText;
            group.appendChild(heading);
        }
        list.forEach(function (it) {
            group.appendChild(buildCoverageDetailRow(it, ctx));
        });
        body.appendChild(group);
    }

    // One rubric section — the aspects sharing an ID letter — headed by the bare
    // letter, its "shipped / total" tally and a three-segment mini bar sized to
    // that section's own aspects. `letter` is null for the trailing catch-all
    // group of IDs that don't split into a section (see groupAspectsBySection):
    // it renders a plain "Other aspects" heading with no tally and no bar, since
    // there is no letter to head it with. A blocked or failed aspect renders as
    // an echo — its live row is pinned in the "Waiting on you" group above.
    function appendSection(letter, sectionItems) {
        if (!sectionItems.length) return;
        const group = document.createElement('div');
        group.className = 'coverageDetailGroup coverageDetailGroup--section';
        if (letter) {
            const head = document.createElement('div');
            head.className = 'coverageSectionHead';

            const letterEl = document.createElement('span');
            letterEl.className = 'coverageSectionLetter';
            letterEl.textContent = letter;
            head.appendChild(letterEl);

            const tally = sectionTally(sectionItems);
            const count = document.createElement('span');
            count.className = 'coverageSectionCount';
            count.textContent = tally.shipped + ' / ' + tally.total;
            head.appendChild(count);
            group.appendChild(head);

            // Decorative — the tally text above is the accessible summary. Three
            // proportional segments sized by aspect count via flex-grow, computed
            // per paint (hence inline), matching buildCoverageSummary's bar.
            const bar = document.createElement('div');
            bar.className = 'coverageSectionBar';
            bar.setAttribute('aria-hidden', 'true');
            [
                { key: 'shipped', n: tally.shipped },
                { key: 'in-flight', n: tally.inFlight },
                { key: 'outstanding', n: tally.outstanding },
            ].forEach(function (seg) {
                const el = document.createElement('div');
                el.className = 'coverageSectionSeg coverageSectionSeg--' + seg.key;
                el.style.flexGrow = String(seg.n);
                el.setAttribute('data-count', String(seg.n));
                bar.appendChild(el);
            });
            group.appendChild(bar);
        } else {
            const heading = document.createElement('div');
            heading.className = 'coverageDetailGroupLabel';
            heading.textContent = 'Other aspects';
            group.appendChild(heading);
        }
        sectionItems.forEach(function (it) {
            group.appendChild(isAttentionStatus(it.status)
                ? buildSectionEchoRow(it)
                : buildCoverageDetailRow(it, ctx));
        });
        body.appendChild(group);
    }

    // Recompute the whole modal body from the LIVE queue rows and repaint the list
    // and the header counts in place. Called once on open and again on every
    // onQueueChange while the modal is mounted, so a row settling from dispatched to
    // shipped moves its aspect from "In progress" to "Shipped" and bumps the covered
    // count without a close/reopen. Only the list body is rebuilt — the dialog, its
    // focus trap, the close controls, and the shared `committed` set survive — so
    // scroll position and hydrated ticks persist across a settle. `ctx.ticks` is
    // reset each render because the tick controls are rebuilt from scratch.
    function renderBody() {
        const rows = getQueueRows();
        // Group rows by aspect tag, then classify each rubric aspect. Process
        // aspects short-circuit to 'manual' (no agent-shippable state); everything
        // else derives its lifecycle from its rows exactly as computeCoverage does.
        const byAspect = Object.create(null);
        rows.forEach(function (r) {
            const tag = r && typeof r.aspect === 'string' ? r.aspect.trim() : '';
            if (!tag) return;
            (byAspect[tag] || (byAspect[tag] = [])).push(r);
        });
        items = aspects.map(function (id) {
            const label = labels[id] || '';
            const process = isProcessAspect(label);
            return {
                id: id,
                label: label,
                process: process,
                rows: byAspect[id] || [],
                status: process ? 'manual' : aspectStatus(byAspect[id] || []),
            };
        });
        // "Waiting on you" pins both attention statuses: a blocked aspect (a
        // question waiting on an answer) and a failed one (a run waiting on a
        // retry). Kept in rubric-aspect order, as the section lists are.
        const blocked = items.filter(function (it) { return isAttentionStatus(it.status); });
        const manual = items.filter(function (it) { return it.process; });
        // Only the manual lane is partitioned off — blocked and failed aspects
        // stay in the section list so each one renders an echo in its home
        // section, keeping a section's row count in step with its tally. Their
        // live, actionable row is the pinned one in the "Waiting on you" group.
        const grouped = groupAspectsBySection(items.filter(function (it) {
            return !it.process;
        }));

        const cov = computeCoverage(aspects, rows);
        titleText.textContent = (cov.total - cov.shipped) + ' outstanding · ' +
            cov.shipped + ' of ' + cov.total + ' covered';

        // Preserve scroll position across the body rebuild; the tick controls are
        // rebuilt from scratch, so drop their stale handles before re-registering.
        const scroll = body.scrollTop;
        body.textContent = '';
        ctx.ticks = [];

        // Blocked at the top (amber, expandable into its answer lane), then one
        // group per rubric section letter in first-appearance order, then the
        // manual Git/process lane at the bottom.
        appendGroup('Waiting on you', blocked, 'blocked');
        grouped.sections.forEach(function (sec) {
            appendSection(sec.letter, sec.items);
        });
        appendSection(null, grouped.other);
        appendGroup('Manual · Git & process', manual, 'manual');

        body.scrollTop = scroll;
        updateCommittedCount();
    }

    renderBody();

    const actions = document.createElement('div');
    actions.id = 'coverageDetailModalActions';

    const closeBtn = document.createElement('button');
    closeBtn.id = 'coverageDetailModalCloseBtn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    actions.appendChild(closeBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    // Register the live-update hook so the SINGLE shared onQueueChange listener
    // repaints this modal when a row settles. Cleared on dismiss (below) so no
    // repaint fires afterward.
    _coverageModal = { onQueueChange: renderBody };
    ensureQueueRepaintListener();

    // Hydrate the committed ticks from stored aspect_submissions unless a Set was
    // preloaded by the caller. The modal opens synchronously (ticks default to
    // unchecked); when the read resolves, merge its ids into the shared set,
    // refresh every registered tick, and recompute the header count in place.
    if (!(preloadedCommitted instanceof Set) && projectId &&
        typeof listLogic.getAspectSubmissions === 'function') {
        Promise.resolve(listLogic.getAspectSubmissions(projectId)).then(function (set) {
            if (!(set instanceof Set)) return;
            set.forEach(function (id) { committed.add(id); });
            ctx.ticks.forEach(function (t) { t.refresh(); });
            updateCommittedCount();
        }, function () { /* leave ticks unchecked on read failure */ });
    }

    const previouslyFocused = document.activeElement;
    closeBtn.focus();

    wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX, closeBtn],
        onClose: function () {
            // Clear the live-update hook so no repaint fires after dismissal; the
            // proposal modal's handle is separate and untouched.
            _coverageModal = null;
            _expandedBlockedAspect = null;
            if (previouslyFocused &&
                typeof previouslyFocused.focus === 'function' &&
                document.contains(previouslyFocused)) {
                try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
            }
        },
    });
}

// from the `_assignment` cache. Returns null for the absent state (no file /
// empty), so the caller appends nothing; the unfilled state renders an amber
// "add assignment context" invite, and the filled state renders a summary —
// a rubric coverage tally when the spec has aspect IDs, else the words/sections
// line. Tapping either state re-reads the file for fresh content + sha and opens
// the assignment editor modal (openAssignmentEditor).
export function buildAssignmentCard() {
    const a = _assignment;
    if (!a || a.state === 'absent') return null;
    const kind = a.kind || 'assignment';

    const card = document.createElement('div');
    card.className = 'agentAssignmentCard agentAssignmentCard--' + a.state;
    // The card is now an interactive editor entry point (both unfilled invite
    // and filled summary), so give it button semantics and keyboard activation.
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('aria-label', 'Edit ' + docNoun(kind) + ' context');
    card.addEventListener('click', openAssignmentEditor);
    card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            openAssignmentEditor();
        }
    });

    const glyph = document.createElement('span');
    glyph.className = 'agentAssignmentGlyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.appendChild(buildFileTextIcon());
    card.appendChild(glyph);

    const body = document.createElement('div');
    body.className = 'agentAssignmentBody';

    const eyebrow = document.createElement('div');
    eyebrow.className = 'agentAssignmentEyebrow';
    eyebrow.textContent = kind === 'brief' ? 'BRIEF' : 'ASSIGNMENT';
    body.appendChild(eyebrow);

    const title = document.createElement('div');
    title.className = 'agentAssignmentTitle';
    title.textContent = a.state === 'filled'
        ? a.title
        : 'No spec — add ' + docNoun(kind) + ' context';
    body.appendChild(title);

    // Filled with rubric aspects → a live coverage summary (headline + bar),
    // recomputed from `_rows` each paint so it tracks rows shipping/changing.
    // Filled without aspects (requirements-only spec) degrades to the original
    // words/sections line; unfilled shows the "Tap to add" hint.
    const aspects = a.state === 'filled' && Array.isArray(a.aspects) ? a.aspects : [];
    if (aspects.length) {
        body.appendChild(buildCoverageSummary(aspects, getQueueRows()));
    } else {
        const meta = document.createElement('div');
        meta.className = 'agentAssignmentMeta';
        meta.textContent = a.state === 'filled'
            ? a.words + ' words · ' + a.sections + ' sections'
            : 'Tap to add';
        body.appendChild(meta);
    }

    // Filled state only: a full-width "Draft tasks from this" footer button that
    // dispatches a derive run (assignment.md → candidate tasks + questions). The
    // card itself opens the assignment editor on click/Enter/Space, so the button
    // stops event propagation to keep the derive dispatch from also opening the
    // editor. Fire-and-forget like the header Run's triage sweep; results land in
    // agent_queue and surface once the Proposed bucket ships.
    if (a.state === 'filled') {
        const draftBtn = document.createElement('button');
        draftBtn.type = 'button';
        draftBtn.className = 'agentAssignmentDeriveBtn';
        // The button is rebuilt on each paint, so derive its working state from
        // `_deriveActive` (not a one-shot timer) — a repaint mid-run keeps it
        // showing "Drafting…" and disabled until the tracked run settles.
        if (isDeriveActive()) {
            draftBtn.textContent = 'Drafting…';
            draftBtn.disabled = true;
        } else {
            draftBtn.textContent = 'Draft tasks from this';
        }
        draftBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            fireDeriveRun(draftBtn);
        });
        // Enter/Space activate the button natively; stop them bubbling to the
        // card's keyboard-activation handler so they don't also open the editor.
        draftBtn.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
                e.stopPropagation();
            }
        });
        body.appendChild(draftBtn);
    }

    card.appendChild(body);
    return card;
}

// Tally the pane's secondary counts line — how many rubric aspects are blocked
// (a question waiting or a failed run needing a retry), in progress
// (dispatched/running), and manual (Git/process aspects the agent can't ship).
// Mirrors showCoverageDetailModal's classification (process aspects short-circuit
// to the manual lane; everything else derives its lifecycle from its tagged rows
// via aspectStatus) so the pane's summary and the drill-in modal never disagree —
// `blocked` counts exactly the aspects the modal pins in "Waiting on you", which
// is why it spans both attention statuses rather than the blocked one alone.
// `manual` is simply the count of process aspects, matching the modal's
// "manual · outstanding" lane.
function computePaneBreakdown(aspects, labels, rows) {
    const byAspect = Object.create(null);
    (Array.isArray(rows) ? rows : []).forEach(function (r) {
        const tag = r && typeof r.aspect === 'string' ? r.aspect.trim() : '';
        if (!tag) return;
        (byAspect[tag] || (byAspect[tag] = [])).push(r);
    });
    let blocked = 0, inProgress = 0, manual = 0;
    aspects.forEach(function (id) {
        const label = (labels && labels[id]) || '';
        if (isProcessAspect(label)) { manual++; return; }
        const st = aspectStatus(byAspect[id] || []);
        if (isAttentionStatus(st)) blocked++;
        else if (st === 'in-flight') inProgress++;
    });
    return { blocked: blocked, inProgress: inProgress, manual: manual };
}

// The label shown on the pane's Derive action, and the disabled pending text it
// swaps to while a derive run is in flight. Derived from `isDeriveActive()` on
// each paint so a repaint mid-run keeps the disabled "Deriving…" state until the
// tracked run settles, rather than a one-shot timer.
const DERIVE_LABEL = 'Derive tasks';
const DERIVE_PENDING_LABEL = 'Deriving…';

// Paint the pane's Derive action for a given pending state — label, disabled
// flag, and the in-flight spinner, together, so the three can never disagree.
// The spinner is a sibling element of the label text rather than part of it, so
// the button's textContent stays the bare label; it exists only while pending,
// so a resting button carries no animating node. `aria-hidden` keeps it out of
// the accessibility tree — the "Deriving…" label already announces the state.
function paintDeriveAction(btn, pending) {
    if (!btn) return;
    btn.disabled = !!pending;
    btn.textContent = '';
    if (pending) {
        const spinner = document.createElement('span');
        spinner.className = 'projRunSpinner claudeCoverageDeriveSpinner';
        spinner.setAttribute('aria-hidden', 'true');
        btn.appendChild(spinner);
    }
    btn.appendChild(document.createTextNode(
        pending ? DERIVE_PENDING_LABEL : DERIVE_LABEL
    ));
}

// The active project's queue rows waiting on a review decision — derive output in
// `proposed` (Accept / Dismiss), plus HOMELESS `needs_mockup` and `drafted` rows:
// a derive row parked on a mockup decision or holding a finished draft carries
// `todo_id: null`, so the row layer's per-todo panes (the mockup pane, the
// description panel's Dispatch action) have nowhere to render it and the sheet is
// its only surface. The `todo_id` guard is what keeps that scoped — a row in
// either state that belongs to a real task row already renders there and must not
// be pulled in here as well. `getQueueRows()` is already scoped to the loaded
// project, so this needs no further project filter. This is the SINGLE source the
// pane's count badge, the "Review N proposals" action, and the review modal all
// derive from, so they can never disagree about how many proposals are
// outstanding.
export function getProposedRows() {
    return getQueueRows().filter(function (r) {
        if (!r) return false;
        if (r.state === 'proposed') return true;
        if (r.state === 'needs_mockup' && !r.todo_id) return true;
        return r.state === 'drafted' && !r.todo_id;
    });
}

// Dispatch a derive run for the active project from the coverage pane. Mirrors the
// board's fireDeriveRun (resolve the project id, mint an entry/correlation id,
// resolve the linked target) but is self-contained so the coverage tab drives
// derive without the board mounted: it calls the relocated startDeriveTracking (the
// SAME single module-level poller the board uses — never a second one) and
// dispatchDerive directly. Fire-and-forget; the pending state is read back from
// `isDeriveActive()` on every paint. On a dispatch failure the tracker is stopped
// and the button restored locally, since no pane repaint fires on that path.
function fireDeriveFromPane(btn) {
    if (btn && btn.disabled) return;
    if (isDeriveActive()) return;
    const projectName = getSelectedProjectName();
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) return;
    // Instant local feedback so a double-tap can't fire two runs before the first
    // paint; the durable disabled state now comes from isDeriveActive().
    paintDeriveAction(btn, true);
    startDeriveTracking();
    const correlationId = mintEntryId();
    setDeriveCorrelationId(correlationId);
    Promise.resolve(dispatchDerive(projectId, correlationId, resolveDispatchTarget()))
        .then(
            function (res) {
                if (res && res.ok === false) {
                    stopDeriveTracking();
                    paintDeriveAction(btn, false);
                }
            },
            function () {
                stopDeriveTracking();
                paintDeriveAction(btn, false);
            }
        );
}

// The pane's Derive action: a full-width button that dispatches a derive run and
// disables itself (via isDeriveActive) while the tracked run is in flight, so a
// second dispatch can't queue behind the first (derive is concurrency-limited to
// one at a time by the workflow).
function buildDeriveAction() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'claudeCoverageDerive';
    paintDeriveAction(btn, isDeriveActive());
    btn.addEventListener('click', function () { fireDeriveFromPane(btn); });
    return btn;
}

// The pane's "Review N proposals" action — present only when derive has produced
// unaccepted `proposed` rows. Opens the batch review modal. Returns null when there
// are no proposals so the caller appends nothing.
function buildProposalsAction() {
    const proposals = getProposedRows();
    if (!proposals.length) return null;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'claudeCoverageProposals';
    btn.textContent = 'Review ' + proposals.length + ' proposal' +
        (proposals.length === 1 ? '' : 's');
    btn.addEventListener('click', function () { showProposalReviewModal(); });
    return btn;
}

// The COVERAGE tab's body for the chat pane — a slimmer, pane-native rendering of
// the same assignment/coverage data the board's buildAssignmentCard shows, minus
// the board's agentAssignment* card frame. Reuses the module's own data functions
// (describeAssignment's cached descriptor, buildCoverageSummary, computePaneBreakdown,
// showCoverageDetailModal) so the numbers and the drill-in modal stay identical to
// the board. Renders the filled summary (headline + bar + counts line + breakdown
// action), the unfilled invite, or the requirements-only words/sections line, each
// with an edit action into the assignment editor; a filled spec also gets the
// Derive action and — when proposals are waiting — the batch review action. Callers
// gate mounting on getAssignmentState() being 'unfilled' / 'filled'; the absent
// guard here is defensive.
export function buildCoveragePane() {
    const a = _assignment;
    const pane = document.createElement('div');
    pane.className = 'claudeCoveragePane';
    if (!a || a.state === 'absent') return pane;
    const kind = a.kind || 'assignment';

    const header = document.createElement('div');
    header.className = 'claudeCoverageHeader';

    const title = document.createElement('div');
    title.className = 'claudeCoverageTitle';
    title.textContent = a.state === 'filled'
        ? a.title
        : (kind === 'brief' ? 'No project brief yet' : 'No assignment spec yet');
    header.appendChild(title);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'claudeCoverageEdit';
    editBtn.textContent = 'Edit';
    editBtn.setAttribute('aria-label', 'Edit ' + docFileName(kind));
    editBtn.addEventListener('click', function () { openAssignmentEditor(); });
    header.appendChild(editBtn);

    pane.appendChild(header);

    // Unfilled: an invite to add the spec, no coverage bar to draw yet and nothing
    // for derive to read, so no Derive action either.
    if (a.state !== 'filled') {
        const prompt = document.createElement('div');
        prompt.className = 'claudeCoveragePrompt';
        prompt.textContent = kind === 'brief'
            ? 'Add a brief describing this project to track work here.'
            : 'Add your assignment requirements and rubric to track coverage here.';
        pane.appendChild(prompt);
        return pane;
    }

    const aspects = Array.isArray(a.aspects) ? a.aspects : [];
    if (!aspects.length) {
        // Filled without parsed rubric aspects: degrade to the words/sections line
        // rather than drawing an empty bar.
        const meta = document.createElement('div');
        meta.className = 'claudeCoverageMeta';
        meta.textContent = a.words + ' words · ' + a.sections + ' sections';
        pane.appendChild(meta);
    } else {
        // Filled with aspects: the shared coverage summary (headline + segmented bar,
        // itself a drill-in into the detail modal), a secondary counts line, and an
        // explicit breakdown action.
        const rows = getQueueRows();
        pane.appendChild(buildCoverageSummary(aspects, rows));

        const labels = (a.aspectLabels && typeof a.aspectLabels === 'object')
            ? a.aspectLabels : {};
        const bd = computePaneBreakdown(aspects, labels, rows);
        const counts = document.createElement('div');
        counts.className = 'claudeCoverageCounts';
        counts.textContent = bd.blocked + ' blocked · ' + bd.inProgress +
            ' in progress · ' + bd.manual + ' manual';
        pane.appendChild(counts);

        const breakdownBtn = document.createElement('button');
        breakdownBtn.type = 'button';
        breakdownBtn.className = 'claudeCoverageBreakdown';
        breakdownBtn.textContent = 'View full breakdown';
        breakdownBtn.addEventListener('click', function () { showCoverageDetailModal(); });
        pane.appendChild(breakdownBtn);
    }

    // Filled state (aspects or not): a Derive action to enumerate uncovered aspects
    // into `proposed` rows, and — when derive has produced any — a batch review
    // action. Derive reads the raw context document, so it belongs even on a
    // filled-but-aspectless spec — and on a project brief, which never has
    // aspects.
    pane.appendChild(buildDeriveAction());
    const proposalsAction = buildProposalsAction();
    if (proposalsAction) pane.appendChild(proposalsAction);

    return pane;
}

// The currently-open modals' live-update hooks (each null when its modal is
// closed). A SINGLE module-level onQueueChange listener drives both, so a row
// settling, or a proposal accepted/dismissed here or on another device, re-renders
// whichever modal is open — the coverage breakdown tracks aspects moving to Shipped
// and the covered count climbing, the proposal list drops resolved cards and closes
// itself when the last one is gone — without stacking one listener per open. The two
// modals open in sequence, never simultaneously; the dispatch tolerates a null handle
// for whichever is closed and clearing one on dismiss never touches the other's.
let _proposalModal = null;
let _coverageModal = null;
let _queueRepaintWired = false;
// Queue-row ids whose mockup flow the user has disclosed on their proposal card.
// Module-level for the same reason _expandedBlockedAspect is: the review modal's
// body is rebuilt wholesale on every onQueueChange, so an open flow would be torn
// down mid-generation — the rebuilt card re-opens from this instead (the shared
// _mockupVariants cache repaints the already-generated previews alongside it).
// Session-scoped only; never pruned, since a resolved row simply stops rendering.
const _expandedMockupRows = new Set();
function ensureQueueRepaintListener() {
    if (_queueRepaintWired) return;
    _queueRepaintWired = true;
    onQueueChange(function () {
        if (_coverageModal) _coverageModal.onQueueChange();
        if (_proposalModal) _proposalModal.onQueueChange();
    });
}

// One proposal card in the review modal: the aspect badge (when tagged), the
// proposal title, a description preview, and a primary action + Dismiss.
//
// For a `proposed` row the primary is Accept, which ships the proposal's draft
// through the SAME dispatchDraft path Dispatch / Retry / the board's Accept use
// (mint an id, inject the entry, dispatch a run); the row transitions proposed →
// dispatched and the queue-change repaint drops it from the list.
//
// For a homeless `needs_mockup` row the primary is "Choose mockup" instead. Such a
// row has no `draft` — triage parked it waiting on a visual direction — so the
// Accept path's empty-draft guard would be all it could ever do. The button
// discloses the shared A/B/C flow (the SAME buildMockupSecondary the Agent board
// and the desktop detail pane mount, wired via configureMockupFlow) right on the
// card; choosing a variant writes the finished entry and moves the row to
// `drafted`, where the card re-renders with the Dispatch primary below.
//
// For a homeless `drafted` row the primary is Dispatch — the entry is already
// written (by derive, or by the mockup flow above), so the only step left is to
// ship it. It runs the very same Accept path: `dispatchDraft` with the row's
// stored entry id, which is what keeps a re-ship from appending a duplicate entry
// to TODO.md. Only the wording differs, because "Accept" reads as a decision the
// user already made when the draft was written.
//
// Dismiss is identical for all three: it removes the queue row via
// listLogic.unflagAgentTask (the board's × remove control) — cheap to redo by
// deriving again, so no confirm. Both controls disable while their action is in
// flight and re-enable with an inline error on failure.
function buildProposalCard(row) {
    const isMockup = row.state === 'needs_mockup';
    const isDrafted = row.state === 'drafted';
    // The primary's wording, shared by its idle label, its pending label and both
    // failure messages so a Dispatch card can never revert to reading "Accept".
    const primaryLabel = isDrafted ? 'Dispatch' : 'Accept';
    const card = document.createElement('div');
    card.className = 'proposalCard';

    const headRow = document.createElement('div');
    headRow.className = 'proposalCardHead';
    const badge = buildAspectBadge(row);
    if (badge) headRow.appendChild(badge);
    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const titleText = (ctx.title || row.title || 'Proposed task').toString().trim()
        || 'Proposed task';
    const titleEl = document.createElement('div');
    titleEl.className = 'proposalCardTitle';
    titleEl.textContent = titleText;
    headRow.appendChild(titleEl);
    card.appendChild(headRow);

    const description = (ctx.description || '').toString().trim();
    if (description) {
        const preview = document.createElement('p');
        preview.className = 'proposalCardPreview';
        preview.textContent = description;
        card.appendChild(preview);
    }

    const errorEl = document.createElement('p');
    errorEl.className = 'proposalCardError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'proposalCardActions';

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'proposalDismissBtn';
    dismiss.textContent = 'Dismiss';

    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = isMockup ? 'proposalMockupBtn' : 'proposalAcceptBtn';
    accept.textContent = isMockup ? 'Choose mockup' : primaryLabel;

    const draftText = (row.draft || '').trim();

    function fail(btn, restoreLabel, message) {
        accept.disabled = false;
        dismiss.disabled = false;
        btn.classList.remove('is-pending');
        btn.textContent = restoreLabel;
        errorEl.textContent = message;
        errorEl.hidden = false;
    }

    // The disclosed mockup flow, mounted lazily below the actions row so an
    // un-opened card stays as compact as a proposal's. Empty (and unappended) for
    // a `proposed` row.
    const flow = document.createElement('div');
    flow.className = 'proposalMockupFlow';
    function openMockupFlow() {
        if (flow.childNodes.length) return;
        // `tabbed`: the review modal is as narrow as the mobile description editor,
        // so the variants render as an OPTION A/B/C radiogroup above one scaled
        // preview rather than three frames stacked down the card.
        flow.appendChild(buildMockupSecondary(row, { tabbed: true }));
        accept.setAttribute('aria-expanded', 'true');
    }

    if (isMockup) {
        accept.setAttribute('aria-expanded', 'false');
        accept.addEventListener('click', function () {
            if (accept.disabled) return;
            _expandedMockupRows.add(row.id);
            openMockupFlow();
        });
    } else {
        const failMessage = isDrafted
            ? 'Could not dispatch. Try again.' : 'Could not accept. Try again.';
        accept.addEventListener('click', function () {
            if (accept.disabled) return;
            if (!draftText) {
                fail(accept, primaryLabel, isDrafted
                    ? 'No draft to dispatch.' : 'No proposal to accept.');
                return;
            }
            errorEl.hidden = true;
            errorEl.textContent = '';
            accept.disabled = true;
            dismiss.disabled = true;
            accept.classList.add('is-pending');
            accept.textContent = isDrafted ? 'Dispatching…' : 'Accepting…';
            Promise.resolve(dispatchDraft(row, draftText, row.entry_id)).then(function (res) {
                // On success the row leaves `proposed` / `drafted`; the
                // queue-change repaint drops it from the list, so there's nothing
                // to do here.
                if (res && res.ok) return;
                fail(accept, primaryLabel, (res && res.error) || failMessage);
            }).catch(function () {
                fail(accept, primaryLabel, failMessage);
            });
        });
    }

    dismiss.addEventListener('click', function () {
        if (dismiss.disabled) return;
        errorEl.hidden = true;
        errorEl.textContent = '';
        accept.disabled = true;
        dismiss.disabled = true;
        dismiss.classList.add('is-pending');
        dismiss.textContent = 'Dismissing…';
        Promise.resolve(listLogic.unflagAgentTask(row.id)).then(function (res) {
            if (res && res.ok) return;
            fail(dismiss, 'Dismiss', 'Could not dismiss. Try again.');
        }).catch(function () {
            fail(dismiss, 'Dismiss', 'Could not dismiss. Try again.');
        });
    });

    actions.appendChild(errorEl);
    actions.appendChild(dismiss);
    actions.appendChild(accept);
    card.appendChild(actions);
    if (isMockup) {
        card.appendChild(flow);
        // The modal body is rebuilt on every onQueueChange, so a flow the user had
        // open would silently collapse mid-generation. Re-disclose the one they
        // left open; buildMockupSecondary restores its cached previews (and any
        // in-flight "Generating…" state) from the shared module-level caches.
        if (_expandedMockupRows.has(row.id)) openMockupFlow();
    }
    return card;
}

// The batch proposal review modal — lists every row waiting on a review decision
// (see getProposedRows) with its aspect tag, title, description preview, and a
// state-appropriate primary (Accept / Choose mockup / Dispatch) + Dismiss. Built with
// the shared three-way dismiss (close X, backdrop, Escape) and focus restore,
// matching showCoverageDetailModal so the two modals in this subsystem read alike.
// The list updates live on onQueueChange (a proposal accepted or dismissed here or
// on another device), and the modal closes itself when the last proposal resolves.
// A no-op when there are no proposals to review.
export function showProposalReviewModal() {
    if (!getProposedRows().length) return;

    const prior = document.getElementById('proposalReviewModalBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'proposalReviewModalBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'proposalReviewModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'proposalReviewModalTitleText');

    const header = document.createElement('div');
    header.id = 'proposalReviewModalHeader';

    const title = document.createElement('div');
    title.id = 'proposalReviewModalTitle';

    const eyebrow = document.createElement('span');
    eyebrow.id = 'proposalReviewModalEyebrow';
    eyebrow.textContent = 'PROPOSALS';

    const titleText = document.createElement('span');
    titleText.id = 'proposalReviewModalTitleText';

    title.appendChild(eyebrow);
    title.appendChild(titleText);

    const closeX = document.createElement('button');
    closeX.id = 'proposalReviewModalClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close proposal review');
    closeX.textContent = '×';

    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'proposalReviewModalBody';

    const actions = document.createElement('div');
    actions.id = 'proposalReviewModalActions';
    const closeBtn = document.createElement('button');
    closeBtn.id = 'proposalReviewModalCloseBtn';
    closeBtn.type = 'button';
    closeBtn.textContent = 'Close';
    actions.appendChild(closeBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(actions);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let closeRef = null;
    const closeFn = function () { if (closeRef) closeRef(); };

    // Re-render the list from the live proposal set. Closes the modal outright once
    // the last proposal is resolved so an empty shell never lingers.
    function renderList() {
        const proposals = getProposedRows().slice().sort(compareProposalsByAspect);
        if (!proposals.length) { closeFn(); return; }
        titleText.textContent = proposals.length + ' proposal' +
            (proposals.length === 1 ? '' : 's') + ' to review';
        body.textContent = '';
        proposals.forEach(function (row) { body.appendChild(buildProposalCard(row)); });
    }

    _proposalModal = { onQueueChange: renderList };
    ensureQueueRepaintListener();
    renderList();

    const previouslyFocused = document.activeElement;
    closeBtn.focus();

    closeRef = wireModalDismiss({
        backdrop: backdrop,
        closeButtons: [closeX, closeBtn],
        onClose: function () {
            _proposalModal = null;
            if (previouslyFocused &&
                typeof previouslyFocused.focus === 'function' &&
                document.contains(previouslyFocused)) {
                try { previouslyFocused.focus(); } catch (e) { /* defensive */ }
            }
        },
    });
}
