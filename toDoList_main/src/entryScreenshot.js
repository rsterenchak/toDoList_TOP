// One screenshot per todo entry, staged in memory and committed by Inject: the
// Worker's `inject` route writes it to `docs/context/<entryId>.<ext>` in the
// target repo before appending the entry, so the run that ships the entry can
// read it as context.
//
// The entry's `- Screenshot: docs/context/<entryId>.<ext>` sub-bullet is the
// contract — the Worker 400s unless the entry text carries that exact path — so
// staging writes the line and removing drops it. The image itself is
// session-scoped and in-memory only (the same rule `pendingImages` follows in
// claudeSheet.js): it is never written to localStorage, so a reload loses it and
// injectDescription refuses to post an entry whose line has nothing staged.
//
// Both description hosts — the desktop panel (toDoRow.js) and the mobile
// description editor (modals.js) — render the row with buildScreenshotRow and
// wire their own hidden file input through wireScreenshotRow, so the two can
// never diverge.

import { listLogic } from './listLogic.js';
import { mintEntryId } from './inject.js';
import { prepareImage, downscaleImage, base64ByteLength, readImageSize } from './imagePrep.js';

// The Worker's screenshot cap (1.5MB decoded) and accepted formats, keyed to the
// extension the committed file takes.
export const SCREENSHOT_MAX_BYTES = 1.5 * 1000 * 1000;
const SCREENSHOT_EXTENSIONS = Object.freeze({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
});

// Tolerant `- Screenshot:` line matcher — leading whitespace, case-insensitive.
// Group 1 is the indent, group 2 the value.
const SCREENSHOT_LINE_RE = /^(\s*)-\s*Screenshot:\s*(.*)$/i;

// Staged images keyed by todo id: { media_type, data, bytes, width, height }.
const staged = new Map();

// The repo-relative path the Worker commits an entry's screenshot to.
export function screenshotPath(entryId, mediaType) {
    return 'docs/context/' + entryId + '.' + (SCREENSHOT_EXTENSIONS[mediaType] || 'jpg');
}

// True when the entry text carries a `- Screenshot:` line.
export function hasScreenshotLine(text) {
    return String(text || '').split('\n').some(function(line) {
        return SCREENSHOT_LINE_RE.test(line);
    });
}

// Insert or replace the entry's `- Screenshot:` line with `path`. An existing
// line keeps its indent; a new one lands before `- Completed:` when present,
// else at the end of the block past trailing blank lines, matching the sibling
// sub-bullets' indent (two spaces when none is found). Only that line changes.
export function setScreenshotLine(text, path) {
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(SCREENSHOT_LINE_RE);
        if (!m) continue;
        lines[i] = m[1] + '- Screenshot: ' + path;
        return lines.join('\n');
    }
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\s*)-\s*Completed:/i);
        if (!m) continue;
        lines.splice(i, 0, m[1] + '- Screenshot: ' + path);
        return lines.join('\n');
    }
    let indent = '  ';
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\s+)-\s/);
        if (m) { indent = m[1]; break; }
    }
    let end = lines.length;
    while (end > 0 && lines[end - 1].trim() === '') end--;
    const line = indent + '- Screenshot: ' + path;
    if (end === 0 && lines.length === 1) return line;
    lines.splice(end, 0, line);
    return lines.join('\n');
}

// Drop every `- Screenshot:` line from the entry text.
export function stripScreenshotLine(text) {
    return String(text || '').split('\n').filter(function(line) {
        return !SCREENSHOT_LINE_RE.test(line);
    }).join('\n');
}

// The staged screenshot for a todo, or null.
export function getEntryScreenshot(item) {
    if (!item || !item.id) return null;
    return staged.get(item.id) || null;
}

// Forget a todo's staged image without touching its entry text — Inject calls
// this once the Worker has committed the file (the file is now the source).
export function clearStagedScreenshot(item) {
    if (!item || !item.id || !staged.has(item.id)) return;
    staged.delete(item.id);
    refreshMountedRows();
}

function persistDesc(item, projectName) {
    listLogic.saveToStorage();
    if (projectName) listLogic.editToDoItem(projectName, item);
}

// Prep a picked image and stage it as the todo's screenshot: mint the entry id
// when absent (the committed path is keyed by it), downscale to the Worker's
// cap and formats, store it, and write the `- Screenshot:` line into item.desc.
// Resolves the staged record, or null when the file can't be read or prepped.
export async function stageEntryScreenshot(item, file, opts) {
    if (!item || !item.id || !file) return null;
    const o = opts || {};
    let image = await prepareImage(file, SCREENSHOT_MAX_BYTES);
    if (!image) return null;
    if (!SCREENSHOT_EXTENSIONS[image.media_type] || base64ByteLength(image.data) > SCREENSHOT_MAX_BYTES) {
        image = await downscaleImage('data:' + image.media_type + ';base64,' + image.data, SCREENSHOT_MAX_BYTES);
        if (!image || !SCREENSHOT_EXTENSIONS[image.media_type]) return null;
    }
    const size = await readImageSize('data:' + image.media_type + ';base64,' + image.data);
    if (!item.entryId) item.entryId = mintEntryId();
    const record = {
        media_type: image.media_type,
        data: image.data,
        bytes: base64ByteLength(image.data),
        width: size.width,
        height: size.height,
    };
    staged.set(item.id, record);
    item.desc = setScreenshotLine(item.desc, screenshotPath(item.entryId, record.media_type));
    persistDesc(item, o.projectName);
    return record;
}

// Drop a todo's staged screenshot and strip its line from item.desc.
export function removeEntryScreenshot(item, opts) {
    if (!item) return;
    const o = opts || {};
    if (item.id) staged.delete(item.id);
    item.desc = stripScreenshotLine(item.desc);
    persistDesc(item, o.projectName);
}


// ── THE ROW ──────────────────────────────────────────────────────────────
// Idle: a dashed strip ("Tap to attach a screenshot"), also a drop target.
// Staged: a 56×56 thumbnail (a background-image, no <img>), the committed path,
// a `<w>×<h> · <KB>` size readout and a Remove button.

// Build the row's DOM once. Painted by refreshScreenshotRow.
export function buildScreenshotRow() {
    const row = document.createElement('div');
    row.className = 'descScreenshotRow';
    const label = document.createElement('span');
    label.className = 'descFileReadoutLabel descScreenshotLabel';
    label.textContent = 'Screenshot';

    const idle = document.createElement('button');
    idle.type = 'button';
    idle.className = 'descScreenshotIdle';
    idle.textContent = 'Tap to attach a screenshot';

    const stagedEl = document.createElement('div');
    stagedEl.className = 'descScreenshotStaged';
    const thumb = document.createElement('span');
    thumb.className = 'descScreenshotThumb';
    thumb.setAttribute('aria-hidden', 'true');
    const meta = document.createElement('div');
    meta.className = 'descScreenshotMeta';
    const path = document.createElement('span');
    path.className = 'descScreenshotPath';
    const size = document.createElement('span');
    size.className = 'descScreenshotSize';
    meta.appendChild(path);
    meta.appendChild(size);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'descScreenshotRemove';
    remove.textContent = 'Remove';
    stagedEl.appendChild(thumb);
    stagedEl.appendChild(meta);
    stagedEl.appendChild(remove);

    row.appendChild(label);
    row.appendChild(idle);
    row.appendChild(stagedEl);
    return row;
}

function formatSize(record) {
    const kb = Math.max(1, Math.round(record.bytes / 1024)) + ' KB';
    return record.width && record.height ? record.width + '×' + record.height + ' · ' + kb : kb;
}

// Repaint the row inside `host` for `item`. `text` is the live entry text
// (defaults to item.desc): when it no longer carries a `- Screenshot:` line the
// staged image is dropped, so deleting the line in the textarea removes the
// attachment too. No-op when the host has no row.
export function refreshScreenshotRow(host, item, text) {
    if (!host || !item) return;
    const row = host.classList && host.classList.contains('descScreenshotRow')
        ? host
        : host.querySelector('.descScreenshotRow');
    if (!row) return;
    row.__screenshotItem = item;
    const source = typeof text === 'string' ? text : item.desc;
    const hasLine = hasScreenshotLine(source);
    if (!hasLine && item.id) staged.delete(item.id);
    const record = getEntryScreenshot(item);
    const idle = row.querySelector('.descScreenshotIdle');
    const stagedEl = row.querySelector('.descScreenshotStaged');
    row.classList.toggle('descScreenshotRow--staged', !!record);
    if (idle) {
        idle.hidden = !!record;
        idle.textContent = hasLine && !record
            ? 'Tap to reattach the screenshot'
            : 'Tap to attach a screenshot';
    }
    if (stagedEl) stagedEl.hidden = !record;
    if (!record) return;
    const thumb = row.querySelector('.descScreenshotThumb');
    if (thumb) thumb.style.backgroundImage = 'url("data:' + record.media_type + ';base64,' + record.data + '")';
    const path = row.querySelector('.descScreenshotPath');
    if (path) path.textContent = screenshotPath(item.entryId, record.media_type);
    const size = row.querySelector('.descScreenshotSize');
    if (size) size.textContent = formatSize(record);
}

// Repaint every mounted row from its own item (after Inject clears a stage).
function refreshMountedRows() {
    if (typeof document === 'undefined') return;
    document.querySelectorAll('.descScreenshotRow').forEach(function(row) {
        if (row.__screenshotItem) refreshScreenshotRow(row, row.__screenshotItem);
    });
}

// Wire a row to its host's hidden file input. Idempotent across reopens: the
// listeners attach once and read the latest options from the row, so a host
// can re-wire on every open. `opts` = { item, fileInput, textarea, projectName,
// onChange }. After a stage or a remove the textarea is re-synced from item.desc
// and fires `input`, so the host's own listeners (inject button, FILE readout,
// this row) repaint through their usual path.
export function wireScreenshotRow(row, opts) {
    if (!row || !opts || !opts.fileInput) return;
    row.__screenshotOpts = opts;
    refreshScreenshotRow(row, opts.item, opts.textarea ? opts.textarea.value : undefined);
    if (row.__screenshotWired) return;
    row.__screenshotWired = true;

    function current() { return row.__screenshotOpts; }

    function syncTextarea(o) {
        if (o.textarea) {
            o.textarea.value = o.item.desc || '';
            o.textarea.dispatchEvent(new Event('input'));
        }
        refreshScreenshotRow(row, o.item);
        if (typeof o.onChange === 'function') o.onChange();
    }

    async function stage(file) {
        const o = current();
        if (!file || !/^image\//.test(file.type || '')) return;
        // The desktop textarea only writes item.desc on blur; take the live text
        // first so a drop mid-edit doesn't discard it.
        if (o.textarea) o.item.desc = o.textarea.value;
        const record = await stageEntryScreenshot(o.item, file, { projectName: o.projectName });
        if (record) syncTextarea(o);
    }

    row.querySelector('.descScreenshotIdle').addEventListener('click', function(event) {
        event.stopPropagation();
        const input = current().fileInput;
        try { input.value = ''; } catch (e) { /* defensive */ }
        input.click();
    });
    row.querySelector('.descScreenshotRemove').addEventListener('click', function(event) {
        event.stopPropagation();
        const o = current();
        if (o.textarea) o.item.desc = o.textarea.value;
        removeEntryScreenshot(o.item, { projectName: o.projectName });
        syncTextarea(o);
    });
    row.addEventListener('dragover', function(event) {
        if (!event.dataTransfer || Array.prototype.indexOf.call(event.dataTransfer.types || [], 'Files') === -1) return;
        event.preventDefault();
        row.classList.add('descScreenshotRow--dragover');
    });
    row.addEventListener('dragleave', function() {
        row.classList.remove('descScreenshotRow--dragover');
    });
    row.addEventListener('drop', function(event) {
        row.classList.remove('descScreenshotRow--dragover');
        const files = event.dataTransfer && event.dataTransfer.files;
        if (!files || !files.length) return;
        event.preventDefault();
        row.screenshotStagePromise = stage(files[0]);
    });
    opts.fileInput.addEventListener('change', function() {
        const input = current().fileInput;
        row.screenshotStagePromise = stage(input.files && input.files[0]);
    });
}
