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
    if (checkboxLine) {
        title = checkboxLine
            .replace(/^\s*- \[[ xX]\]\s*/, '')
            .replace(/^\*\*\[[^\]]*\]\*\*\s*/, '')
            .replace(/\s*[—-]\s*Completed:.*$/i, '')
            .trim();
    }
    if (!title) {
        const firstNonEmpty = lines.find(function(line) { return line.trim().length > 0; });
        title = firstNonEmpty ? firstNonEmpty.trim() : '';
    }

    return { title: title, description: description, hasMarker: /<!-- id:/.test(description) };
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
    target.value = parsed.title;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    return projectName;
}
