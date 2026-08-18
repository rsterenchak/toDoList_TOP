// Shared entry parsing + task-commit for the two "draft an entry, land it as a
// task" surfaces: the compose-row paste chip (mobileTaskCreate.js) and the chat
// reply "Create task" action (claudeSheet.js). Kept in its own leaf module so
// both callers import ONE parser — a second copy that drifted from this one is
// exactly the failure mode this extraction prevents — without either dragging
// in the other's dependency graph. (mobileTaskCreate → inject → modals →
// claudeSheet forms a cycle, so claudeSheet cannot import the parser from
// mobileTaskCreate directly; both import it from here instead.)

import { listLogic } from './listLogic.js';
import { activeProjectNameForViewer } from './runState.js';


// The ` — Completed: 2026-08-18 (PR #12)` note the routine appends to a task
// line when it checks the entry off. Declared once because BOTH readers of it —
// taskLineTitle (which drops it to get a display title) and reopenTaskLine
// (which drops it to un-ship the entry) — must agree on exactly what the suffix
// is; two copies that drifted would leave a reopened entry still claiming a
// completion date.
const COMPLETED_SUFFIX_RE = /\s*[—-]\s*Completed:.*$/i;


// Reduce a TODO.md task line to its display title: strip the `- [ ]` / `- [x]`
// checkbox, a leading `**[PRIORITY]**` marker, and a trailing `— Completed: …`
// note. Returns '' for a line that isn't a task line, so callers can use it as a
// filter as well as a parser. Exported because the same title must be derived in
// two places — the pasted-entry parse below, and the Runs tab's recovery of
// WHICH entry a backlog run completed (claudeSheet.js) — and a second copy of
// these regexes is exactly the drift this module exists to prevent.
export function taskLineTitle(line) {
    const text = String(line == null ? '' : line);
    if (!/^\s*- \[[ xX]\]/.test(text)) return '';
    return text
        .replace(/^\s*- \[[ xX]\]\s*/, '')
        .replace(/^\*\*\[[^\]]*\]\*\*\s*/, '')
        .replace(COMPLETED_SUFFIX_RE, '')
        .trim();
}


// Invert the routine's completion edit on a single TODO.md task line: flip
// `- [x]` back to `- [ ]` and strip the trailing `— Completed: …` note, keeping
// the leading indentation and the `**[PRIORITY]**` marker exactly as they were.
// This is the line-level half of a hard rollback — a merged revert undoes the
// code, and the entry has to go back to being open work. Returns null for a line
// that is not a CHECKED task line (an already-open entry, or not a task line at
// all), so a caller can tell "nothing to reopen" from "reopened".
export function reopenTaskLine(line) {
    const text = String(line == null ? '' : line);
    const m = text.match(/^(\s*)- \[[xX]\]\s?(.*)$/);
    if (!m) return null;
    return (m[1] + '- [ ] ' + m[2].replace(COMPLETED_SUFFIX_RE, '')).replace(/\s+$/, '');
}


// Reopen the ONE top-level entry in `markdown` whose block ends with the
// `<!-- id: <entryId> -->` marker: its headline is rewritten by reopenTaskLine
// and every other line — the Type/Description/File sub-bullets and the marker
// line itself — is preserved byte-for-byte, so the entry stays traceable to the
// PR that shipped (and then reverted) it and stays runnable again.
//
// The marker sits at the END of an entry's block, several lines below the
// headline, so the scan tracks the most recent TOP-LEVEL task line (indent 0,
// matching the viewer's `tok.indent === 0` notion of an entry) and rewrites that
// one when the marker turns up. Returns `{ changed, content }`; `changed` is
// false — with `content` returned untouched — when the id is empty, its marker
// is absent, it has no headline above it, or that headline is already unchecked,
// so a caller can skip a pointless write.
export function reopenEntryInMarkdown(markdown, entryId) {
    const text = String(markdown == null ? '' : markdown);
    const id = String(entryId == null ? '' : entryId).trim();
    const unchanged = { changed: false, content: text };
    if (!id) return unchanged;

    const markerRe = new RegExp(
        '<!--\\s*id:\\s*' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*-->'
    );
    const lines = text.split('\n');
    let headline = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^- \[[ xX]\]/.test(lines[i])) headline = i;
        if (!markerRe.test(lines[i])) continue;
        if (headline === -1) return unchanged;
        const reopened = reopenTaskLine(lines[headline]);
        if (reopened === null) return unchanged;
        lines[headline] = reopened;
        return { changed: true, content: lines.join('\n') };
    }
    return unchanged;
}


// Parse a pasted / drafted TODO.md entry into a display title + a verbatim
// description. Deliberately narrow (see the compose-row paste entry's notes):
//   - strip lines that are just a wrapping code fence (``` optionally + lang),
//   - use the first top-level `- [ ]` / `- [x]` headline for the title,
//     stripping its checkbox, a leading `**[PRIORITY]**`, and a trailing
//     `— Completed: …` note,
//   - fall back to the first non-empty line as the title when there is no
//     checkbox headline, so a rough paste (or a plain-prose reply) still lands.
// The description is the fence-stripped text preserved byte-for-byte — it keeps
// the headline line, because that is what Inject commits. `hasMarker` is a
// simple presence check for the `<!-- id: … -->` comment; the id value is not
// needed here, so no marker parser is duplicated into this module.
export function parsePastedEntry(raw) {
    const text = String(raw == null ? '' : raw);
    const description = text
        .split('\n')
        .filter(function(line) { return !/^\s*```/.test(line); })
        .join('\n');

    const lines = description.split('\n');
    let title = '';
    const checkboxLine = lines.find(function(line) {
        return /^\s*- \[[ xX]\]/.test(line);
    });
    if (checkboxLine) title = taskLineTitle(checkboxLine);
    if (!title) {
        const firstNonEmpty = lines.find(function(line) { return line.trim().length > 0; });
        title = firstNonEmpty ? firstNonEmpty.trim() : '';
    }

    return { title: title, description: description, hasMarker: /<!-- id:/.test(description) };
}


// Report which recognisable TODO-entry fields a pasted blob carries, for the
// PASTE authoring mode's "recognised: …" feedback. This is a field-PRESENCE
// report, NOT a second parser: it delegates the title / description / marker
// detection to parsePastedEntry above and only scans for the common sub-bullet
// labels (Type, Description, File) and the priority marker so the user can see
// at a glance what the parse picked up before it lands in the entry. Returns the
// recognised field names in a stable display order (empty when nothing parses).
export function recognizedEntryFields(raw) {
    const text = String(raw == null ? '' : raw);
    const parsed = parsePastedEntry(text);
    const fields = [];
    if (parsed.title) fields.push('title');
    if (/\*\*\[(?:HIGH|MEDIUM|LOW)\]\*\*/i.test(text)) fields.push('priority');
    if (/^\s*[-*]?\s*Type:\s*\S/im.test(text)) fields.push('type');
    if (/^\s*[-*]?\s*Description:\s*\S/im.test(text)) fields.push('description');
    if (/^\s*[-*]?\s*File:\s*\S/im.test(text)) fields.push('file');
    if (parsed.hasMarker) fields.push('marker id');
    return fields;
}


// Commit a parsed entry into the ACTIVE project by driving its blank
// placeholder through the same Enter path a typed task uses — so the committed
// row gets its status badge, a fresh blank placeholder, and persistence, and
// the caller never writes listLogic directly (which would strand the row
// without a badge and leave the list without a placeholder). The blank
// placeholder's item object is shared with the row that closed over it at build
// time, so setting `.desc` here lands the full entry text; the Enter handler
// reads only the title from the input and never touches desc, so the value
// survives commit. Mirrors handleEntryPaste's dispatch in mobileTaskCreate.js.
// Returns the project name committed into, or null when there is no active
// project or no blank placeholder input to drive.
export function commitEntryToActiveProject(parsed) {
    if (!parsed || !parsed.title) return null;
    if (typeof document === 'undefined') return null;
    const projectName = activeProjectNameForViewer();
    if (!projectName) return null;
    const items = listLogic.listItems(projectName);
    if (!items) return null;
    const blankItem = items.find(function(i) { return !i.tit; });
    if (!blankItem) return null;

    // Find the blank placeholder's input among #mainList's rows — the one whose
    // own #toDoInput is currently empty (mirrors emptyState.js's commit-delegate
    // lookup, so both surfaces resolve the same hidden placeholder row).
    const mainListDiv = document.getElementById('mainList');
    if (!mainListDiv) return null;
    let target = null;
    const inputs = mainListDiv.querySelectorAll('#toDoInput');
    for (let i = 0; i < inputs.length; i++) {
        if (inputs[i].value.trim() === '') { target = inputs[i]; break; }
    }
    if (!target) return null;

    blankItem.desc = parsed.description;
    // A pasted / drafted entry describes work already under way, so it lands
    // in_progress rather than the toDo() factory's 'active' default — the Enter
    // handler reads item.status to build the row's badge and commitBlankPlaceholder
    // carries it into the persisted payload, so setting it here is enough.
    blankItem.status = 'in_progress';
    target.value = parsed.title;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return projectName;
}
