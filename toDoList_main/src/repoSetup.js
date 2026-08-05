// Repo setup shape reference — the SHAPES.md picker.
//
// Starting a course repo means knowing which shape it is, whether a template
// exists or a CLI is needed, and which gotchas apply. All of that lives in
// SHAPES.md at the root of the public `claude-routine-template` repo, so this
// module fetches that file LIVE from raw.githubusercontent.com rather than
// bundling a copy: adding a shape to the file adds it to the picker with no
// client release. The repo is public, so the fetch needs no Worker and no auth.
//
// The file carries a PARSING CONTRACT comment naming the four markers parsed
// here — `## `, `**Template:**`, `**Onboarding adds:**`, `**Gotchas**`. Nothing
// else in the document is load-bearing; a section missing every marker still
// renders with its lead paragraph.
//
// SECURITY: the document is remote text. Every node is built with
// `textContent`; `innerHTML` is never assigned from the fetch (or at all in
// this module), so a change to the source file can never inject markup.

import { isMobileViewport } from './viewport.js';

export const SHAPES_URL =
    'https://raw.githubusercontent.com/rsterenchak/claude-routine-template/main/SHAPES.md';

// Shown in the modal footer so the picker names what it is reading.
export const SHAPES_FILENAME = 'SHAPES.md';

// How many gotcha rows render before the SHOW N MORE control takes over.
const GOTCHA_PREVIEW = 2;

// Session cache for the fetched document. Held module-level rather than
// per-modal so re-opening the picker in the same session is instant; a reload
// re-fetches, which is the intended freshness window for a file that changes
// when a shape is added.
let shapesDocCache = null;

// Exported for tests, which need each case to start from a cold cache.
export function clearShapesCache() {
    shapesDocCache = null;
}

// Fetch-once-per-session. A failed fetch is NOT cached, so the error state's
// retry control gets a real second attempt.
export async function loadShapesDoc() {
    if (typeof shapesDocCache === 'string') return shapesDocCache;
    const res = await fetch(SHAPES_URL);
    if (!res || res.ok === false) {
        throw new Error('SHAPES.md fetch failed');
    }
    const text = await res.text();
    shapesDocCache = String(text || '');
    return shapesDocCache;
}


// ── PARSING ──

// The PARSING CONTRACT block (and any other HTML comment) is documentation for
// whoever edits the file, not content — stripped before both parsing and the
// full-document render.
export function stripHtmlComments(text) {
    return String(text == null ? '' : text).replace(/<!--[\s\S]*?-->/g, '');
}

// Markdown emphasis removed for the surfaces that are plain text (the chips and
// the copyable value). Rendered prose goes through appendInline instead, which
// keeps bold and inline code as real elements.
function stripInlineMarkdown(text) {
    return String(text == null ? '' : text)
        .replace(/`/g, '')
        .replace(/\*\*/g, '')
        .trim();
}

// Split the document on `## ` headings, tracking fenced code so a `## ` inside a
// snippet can't open a phantom section. Everything before the first heading (the
// title, the contract comment's remains, the preamble) is discarded.
function splitSections(lines) {
    const sections = [];
    let current = null;
    let inFence = false;
    lines.forEach(function(line) {
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
        } else if (!inFence && /^##\s+\S/.test(line)) {
            current = { name: line.replace(/^##\s+/, '').trim(), lines: [] };
            sections.push(current);
            return;
        }
        if (current) current.lines.push(line);
    });
    return sections;
}

// The `---` rules between sections belong to neither, so trailing rules and
// blank lines come off before a section body is read.
function trimSectionLines(lines) {
    const out = lines.slice();
    while (out.length && /^(\s*|---+\s*)$/.test(out[out.length - 1])) out.pop();
    return out;
}

// First non-empty paragraph of the section — the one-or-two-sentence description
// under the heading. Returned as a single line so it renders as prose.
function readLeadParagraph(lines) {
    const para = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) {
            if (para.length) break;
            continue;
        }
        para.push(line.trim());
    }
    return para.join(' ');
}

// The paragraph a marker line opens: that line plus every following non-blank
// line, joined. Returns '' when the marker isn't present.
function readMarkerParagraph(lines, marker) {
    const start = lines.findIndex(function(line) { return line.indexOf(marker) === 0; });
    if (start === -1) return '';
    const para = [lines[start]];
    for (let i = start + 1; i < lines.length; i++) {
        if (!lines[i].trim()) break;
        para.push(lines[i].trim());
    }
    return para.join(' ').slice(marker.length).trim();
}

// The first sentence of a paragraph. A period only ends a sentence when what
// follows is whitespace or the end of the text — otherwise `deploy.yml` and
// `TODO.md` would each split the list mid-chip.
function firstSentence(text) {
    const str = String(text || '');
    for (let i = 0; i < str.length; i++) {
        if (str[i] !== '.') continue;
        const next = str[i + 1];
        if (next === undefined || /\s/.test(next)) return str.slice(0, i);
    }
    return str;
}

// Comma-split that ignores commas inside parentheses, so an aside like
// "`manifest.yml` (regenerates the source manifest and commits it to the repo
// root)" stays one chip instead of splitting on its internal comma.
function splitTopLevelCommas(text) {
    const parts = [];
    let depth = 0;
    let buf = '';
    String(text || '').split('').forEach(function(ch) {
        if (ch === '(') depth++;
        else if (ch === ')') depth = Math.max(0, depth - 1);
        if (ch === ',' && depth === 0) {
            parts.push(buf);
            buf = '';
            return;
        }
        buf += ch;
    });
    parts.push(buf);
    return parts;
}

// `**Onboarding adds:**` → the chip list. Only the marker paragraph's first
// sentence is the list; what follows it is prose about Pages sources and
// omissions, which would otherwise land as a chip.
function parseAdds(lines) {
    const para = readMarkerParagraph(lines, '**Onboarding adds:**');
    if (!para) return [];
    const chips = [];
    splitTopLevelCommas(firstSentence(para)).forEach(function(part) {
        const text = stripInlineMarkdown(part).replace(/^and\s+/i, '').trim();
        if (!text) return;
        // A comma before a relative pronoun opens a clause about the item just
        // named, not a new item — "…in SQL mode, which publishes a table
        // outline" is one entry, so fold it back rather than chipping it.
        if (chips.length && /^(which|that)\s/i.test(text)) {
            chips[chips.length - 1] += ', ' + text;
            return;
        }
        chips.push(text);
    });
    return chips;
}

// `**Gotchas**` → every `- ` bullet until the next heading or `---` rule.
// Bullets wrap across lines in the source, so an indented continuation folds
// into the bullet it belongs to.
function parseGotchas(lines) {
    const start = lines.findIndex(function(line) { return line.indexOf('**Gotchas**') === 0; });
    if (start === -1) return [];
    const bullets = [];
    let inBullet = false;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i];
        if (/^---+\s*$/.test(line) || /^#{1,6}\s/.test(line)) break;
        if (/^-\s+/.test(line)) {
            bullets.push(line.replace(/^-\s+/, '').trim());
            inBullet = true;
            continue;
        }
        if (!line.trim()) { inBullet = false; continue; }
        if (inBullet) bullets[bullets.length - 1] += ' ' + line.trim();
    }
    return bullets;
}

// The first fenced code block's contents — the copyable value for a CLI shape,
// which has no template repo to name.
function firstFencedBlock(lines) {
    let inFence = false;
    const body = [];
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*```/.test(lines[i])) {
            if (!inFence) { inFence = true; continue; }
            break;
        }
        if (inFence) body.push(lines[i]);
    }
    return body.join('\n').trim();
}

// `### <variant>` sub-blocks inside a section — the framework variants under
// build-pipeline, each carrying its own scaffold command and its own config
// edits. The variant region runs from the first `### ` heading to the
// `**Gotchas**` marker (or the section's end), so the gotcha list is never
// absorbed into the last variant. Fenced code is tracked so a `### ` inside a
// snippet can't open a phantom variant.
function splitVariants(lines) {
    let inFence = false;
    let start = -1;
    let end = lines.length;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*```/.test(lines[i])) { inFence = !inFence; continue; }
        if (inFence) continue;
        if (start === -1) {
            if (/^###\s+\S/.test(lines[i])) start = i;
            continue;
        }
        if (lines[i].indexOf('**Gotchas**') === 0) { end = i; break; }
    }
    if (start === -1) return [];

    const variants = [];
    let current = null;
    inFence = false;
    for (let i = start; i < end; i++) {
        const line = lines[i];
        if (/^\s*```/.test(line)) {
            inFence = !inFence;
        } else if (!inFence && /^###\s+\S/.test(line)) {
            current = { name: line.replace(/^###\s+/, '').trim(), lines: [] };
            variants.push(current);
            continue;
        }
        if (current) current.lines.push(line);
    }
    return variants.map(function(variant) {
        return { name: variant.name, parts: parseVariantBody(variant.lines) };
    });
}

// A variant's body as an ordered list of prose paragraphs and fenced blocks,
// kept in the file's order so a paragraph explaining an edit stays next to the
// block it explains. Fenced text is taken VERBATIM — leading whitespace and the
// blank line between the two files in a jsonc edits block are significant, and
// the copy control ships exactly what is rendered.
function parseVariantBody(lines) {
    const parts = [];
    let para = [];
    function flushParagraph() {
        if (!para.length) return;
        parts.push({ type: 'prose', text: para.join(' ') });
        para = [];
    }
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*```/.test(lines[i])) {
            flushParagraph();
            const body = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) {
                body.push(lines[i]);
                i++;
            }
            parts.push({ type: 'code', text: body.join('\n') });
            continue;
        }
        if (!lines[i].trim()) { flushParagraph(); continue; }
        para.push(lines[i].trim());
    }
    flushParagraph();
    return parts;
}

// One picker row's worth of parsed data. `kind` drives the row's chip:
// 'template' → the TEMPLATE chip and the template repo as the copyable value,
// 'cli' → the dimmed CLI label and the first fenced block, 'none' → NO SHAPE,
// which is checked FIRST because a no-shape section also has no template line
// and would otherwise be mislabelled CLI.
//
// A section carrying `### ` variants has no single copyable value — its blocks
// belong to the variants, one scaffold each — so `copyValue` stays empty there
// and the row renders the segmented control instead.
export function parseShapesDoc(text) {
    const clean = stripHtmlComments(text);
    return splitSections(clean.split('\n')).map(function(section) {
        const lines = trimSectionLines(section.lines);
        const body = lines.join('\n');
        const templateLine = readMarkerParagraph(lines, '**Template:**');
        const templateMatch = templateLine.match(/`([^`]+)`/);
        const variants = splitVariants(lines);

        let kind = 'cli';
        if (body.indexOf('**No shape exists.**') !== -1) kind = 'none';
        else if (templateMatch) kind = 'template';

        let copyValue = '';
        if (kind === 'template') copyValue = templateMatch[1].trim();
        else if (kind === 'cli' && !variants.length) copyValue = firstFencedBlock(lines);

        return {
            name: section.name,
            kind: kind,
            // `least-proven` anywhere in the body earns the amber glyph. Matched
            // case-insensitively because the file writes it sentence-initial.
            warn: /least-proven/i.test(body),
            lead: readLeadParagraph(lines),
            copyValue: copyValue,
            variants: variants,
            adds: parseAdds(lines),
            gotchas: parseGotchas(lines),
        };
    });
}


// ── INLINE + MARKDOWN RENDERING ──

// Inline markdown → real nodes. Bold and inline code only; everything else is a
// text node, so remote text can never become markup.
function appendInline(host, text) {
    const parts = String(text == null ? '' : text).split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
    parts.forEach(function(part) {
        if (!part) return;
        if (part.length > 2 && part[0] === '`' && part[part.length - 1] === '`') {
            const code = document.createElement('code');
            code.className = 'repoSetupCode';
            code.textContent = part.slice(1, -1);
            host.appendChild(code);
            return;
        }
        if (part.length > 4 && part.slice(0, 2) === '**' && part.slice(-2) === '**') {
            const strong = document.createElement('strong');
            strong.textContent = part.slice(2, -2);
            host.appendChild(strong);
            return;
        }
        host.appendChild(document.createTextNode(part));
    });
}

// The full-document view's reader. Deliberately small — the file only uses
// headings, paragraphs, fenced code, inline code, bold, and unordered lists, so
// those are the only blocks handled. No library, per CLAUDE.md.
export function renderMarkdown(host, text) {
    const lines = stripHtmlComments(text).split('\n');
    let paragraph = [];
    let list = null;

    function flushParagraph() {
        if (!paragraph.length) return;
        const p = document.createElement('p');
        p.className = 'repoSetupDocP';
        appendInline(p, paragraph.join(' '));
        host.appendChild(p);
        paragraph = [];
    }
    function flushList() {
        list = null;
    }
    function flushAll() {
        flushParagraph();
        flushList();
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        if (/^\s*```/.test(line)) {
            flushAll();
            const body = [];
            i++;
            while (i < lines.length && !/^\s*```/.test(lines[i])) {
                body.push(lines[i]);
                i++;
            }
            const pre = document.createElement('pre');
            pre.className = 'repoSetupDocPre';
            const code = document.createElement('code');
            code.textContent = body.join('\n');
            pre.appendChild(code);
            host.appendChild(pre);
            continue;
        }

        const heading = line.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushAll();
            const h = document.createElement('div');
            h.className = 'repoSetupDocH repoSetupDocH--' + heading[1].length;
            appendInline(h, heading[2].trim());
            host.appendChild(h);
            continue;
        }

        if (/^---+\s*$/.test(line)) {
            flushAll();
            const rule = document.createElement('div');
            rule.className = 'repoSetupDocRule';
            host.appendChild(rule);
            continue;
        }

        if (/^-\s+/.test(line)) {
            flushParagraph();
            if (!list) {
                list = document.createElement('ul');
                list.className = 'repoSetupDocList';
                host.appendChild(list);
            }
            const li = document.createElement('li');
            appendInline(li, line.replace(/^-\s+/, ''));
            list.appendChild(li);
            continue;
        }

        if (!line.trim()) {
            flushAll();
            continue;
        }

        // A non-blank line under an open bullet is that bullet's continuation.
        if (list && /^\s+\S/.test(line)) {
            const li = list.lastElementChild;
            if (li) {
                li.appendChild(document.createTextNode(' '));
                appendInline(li, line.trim());
                continue;
            }
        }

        flushList();
        paragraph.push(line.trim());
    }
    flushAll();
}


// ── COPYABLE VALUE ──

// Same clipboard discipline as the row copy button: the async API when present
// (the only path that works from a button activation on mobile Safari), the
// legacy execCommand path as the fallback for environments without it (jsdom in
// particular). The temporary textarea is positioned by a class, not inline
// styles.
function copyValueToClipboard(text, button) {
    if (!text) return;

    function flash() {
        const prior = button.textContent;
        button.textContent = 'COPIED';
        if (button.__repoSetupCopyTimer) clearTimeout(button.__repoSetupCopyTimer);
        button.__repoSetupCopyTimer = setTimeout(function() {
            button.textContent = prior;
            button.__repoSetupCopyTimer = null;
        }, 1400);
    }

    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(flash).catch(function() { /* user can select the text */ });
        return;
    }

    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.className = 'repoSetupCopyProbe';
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand && document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) flash();
    } catch (e) { /* swallow — the value stays on screen to copy by hand */ }
}


// ── VARIANTS ──

// One fenced block plus its copy control. The first block of a variant is the
// scaffold command and the second, when present, is the config edits; anything
// beyond those two renders unlabelled rather than inventing a name for it.
const VARIANT_BLOCK_LABELS = ['SCAFFOLD', 'EDITS'];

function buildVariantBlock(text, index) {
    const block = document.createElement('div');
    block.className = 'repoSetupVariantBlock';

    const labelText = VARIANT_BLOCK_LABELS[index];
    if (labelText) {
        const label = document.createElement('div');
        label.className = 'repoSetupVariantLabel';
        label.textContent = labelText;
        block.appendChild(label);
    }

    const copyWrap = document.createElement('div');
    copyWrap.className = 'repoSetupCopy';
    const value = document.createElement('pre');
    value.className = 'repoSetupCopyValue';
    // Verbatim: the label lives in its own node and the prose in another, so
    // what the button copies is exactly the block as written in the file.
    value.textContent = text;
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'repoSetupGhostBtn repoSetupCopyBtn';
    copyBtn.textContent = 'COPY';
    copyBtn.addEventListener('click', function() {
        copyValueToClipboard(text, copyBtn);
    });
    copyWrap.appendChild(value);
    copyWrap.appendChild(copyBtn);
    block.appendChild(copyWrap);
    return block;
}

// The segmented control plus one body per variant, all mounted at once and
// toggled by `hidden` — the bodies are small and switching between them is the
// point of the control, so rebuilding on every tap would only lose the copy
// buttons' COPIED state mid-flash.
function buildVariants(variants) {
    const wrap = document.createElement('div');
    wrap.className = 'repoSetupVariants';

    const control = document.createElement('div');
    control.className = 'repoSetupVariantControl';
    control.setAttribute('role', 'radiogroup');
    control.setAttribute('aria-label', 'Variant');
    wrap.appendChild(control);

    const bodies = [];
    const segs = variants.map(function(variant) {
        const seg = document.createElement('button');
        seg.type = 'button';
        seg.className = 'repoSetupVariantSeg';
        seg.dataset.variant = variant.name;
        seg.textContent = variant.name;
        seg.setAttribute('role', 'radio');
        control.appendChild(seg);

        const body = document.createElement('div');
        body.className = 'repoSetupVariantBody';
        let blockIndex = 0;
        variant.parts.forEach(function(part) {
            if (part.type === 'prose') {
                const prose = document.createElement('div');
                prose.className = 'repoSetupVariantProse';
                appendInline(prose, part.text);
                body.appendChild(prose);
                return;
            }
            body.appendChild(buildVariantBlock(part.text, blockIndex));
            blockIndex++;
        });
        bodies.push(body);
        wrap.appendChild(body);
        return seg;
    });

    function select(index) {
        segs.forEach(function(seg, i) {
            const on = i === index;
            seg.classList.toggle('selected', on);
            seg.setAttribute('aria-checked', on ? 'true' : 'false');
            bodies[i].hidden = !on;
        });
    }
    segs.forEach(function(seg, i) {
        seg.addEventListener('click', function() { select(i); });
    });
    // First variant in file order is the one that opens.
    select(0);

    return wrap;
}


// ── MODAL ──

// Opens the Repo setup picker. Structurally modeled on the onboard sub-modal:
// backdrop / dialog / header-with-× / body / footer, and the three close
// affordances CLAUDE.md requires (× button, backdrop click, Escape).
export function showRepoSetupModal() {
    const prior = document.getElementById('repoSetupBackdrop');
    if (prior && prior.parentNode) prior.parentNode.removeChild(prior);

    const backdrop = document.createElement('div');
    backdrop.id = 'repoSetupBackdrop';

    const dialog = document.createElement('div');
    dialog.id = 'repoSetupModal';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'repoSetupTitle');

    const header = document.createElement('div');
    header.id = 'repoSetupHeader';
    const title = document.createElement('div');
    title.id = 'repoSetupTitle';
    title.textContent = 'Repo setup';
    const closeX = document.createElement('button');
    closeX.id = 'repoSetupClose';
    closeX.type = 'button';
    closeX.setAttribute('aria-label', 'Close repo setup dialog');
    closeX.textContent = '×';
    header.appendChild(title);
    header.appendChild(closeX);

    const body = document.createElement('div');
    body.id = 'repoSetupBody';

    const status = document.createElement('div');
    status.id = 'repoSetupStatus';
    status.setAttribute('role', 'status');
    status.textContent = 'Loading ' + SHAPES_FILENAME + '…';
    body.appendChild(status);

    // Fetch failure lands here rather than leaving an empty modal — the retry
    // control re-runs the same load, and the cache holds nothing on failure so
    // the retry is a genuine second attempt.
    const error = document.createElement('div');
    error.id = 'repoSetupError';
    error.hidden = true;
    const errorText = document.createElement('div');
    errorText.className = 'repoSetupErrorText';
    errorText.textContent = 'Couldn’t load ' + SHAPES_FILENAME + '.';
    const retryBtn = document.createElement('button');
    retryBtn.id = 'repoSetupRetry';
    retryBtn.type = 'button';
    retryBtn.className = 'repoSetupGhostBtn';
    retryBtn.textContent = 'RETRY';
    error.appendChild(errorText);
    error.appendChild(retryBtn);
    body.appendChild(error);

    const list = document.createElement('div');
    list.id = 'repoSetupList';
    list.hidden = true;
    body.appendChild(list);

    // The whole document, rendered on demand. Above 1024px it appends below the
    // picker; below, it replaces it (see setFullView) so the modal's 92vh cap
    // isn't spent scrolling past rows to reach the prose.
    const full = document.createElement('div');
    full.id = 'repoSetupFull';
    full.hidden = true;
    body.appendChild(full);

    const footer = document.createElement('div');
    footer.id = 'repoSetupFooter';
    const source = document.createElement('span');
    source.className = 'repoSetupSource';
    source.textContent = SHAPES_FILENAME;
    const viewFullBtn = document.createElement('button');
    viewFullBtn.id = 'repoSetupViewFull';
    viewFullBtn.type = 'button';
    viewFullBtn.className = 'repoSetupGhostBtn';
    viewFullBtn.textContent = 'VIEW FULL';
    viewFullBtn.hidden = true;
    footer.appendChild(source);
    footer.appendChild(viewFullBtn);

    dialog.appendChild(header);
    dialog.appendChild(body);
    dialog.appendChild(footer);
    backdrop.appendChild(dialog);
    document.body.appendChild(backdrop);

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeydown, true);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    }

    // Capture-phase Escape so this dialog consumes the key rather than any
    // surface underneath it, matching the onboard sub-modal.
    function onKeydown(event) {
        if (event.key === 'Escape') {
            event.stopPropagation();
            event.preventDefault();
            close();
        }
    }

    closeX.addEventListener('click', close);
    backdrop.addEventListener('click', function(event) {
        if (event.target === backdrop) close();
    });
    document.addEventListener('keydown', onKeydown, true);

    // ── PICKER ROWS ──

    // One row expanded at a time: opening a row closes whichever was open, so
    // the list never grows past a screenful of headings plus one body.
    const rowBodies = [];
    function collapseAll() {
        rowBodies.forEach(function(entry) {
            entry.body.hidden = true;
            entry.head.setAttribute('aria-expanded', 'false');
        });
    }

    function buildRow(section) {
        const row = document.createElement('div');
        row.className = 'repoSetupRow';

        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'repoSetupRowHead';
        head.setAttribute('aria-expanded', 'false');

        const name = document.createElement('span');
        name.className = 'repoSetupRowName';
        name.textContent = section.name;
        head.appendChild(name);

        const label = document.createElement('span');
        if (section.kind === 'template') {
            label.className = 'repoSetupRowLabel repoSetupRowLabel--template';
            label.textContent = 'TEMPLATE';
        } else if (section.kind === 'none') {
            label.className = 'repoSetupRowLabel repoSetupRowLabel--none';
            label.textContent = 'NO SHAPE';
        } else {
            label.className = 'repoSetupRowLabel repoSetupRowLabel--cli';
            label.textContent = 'CLI';
        }
        head.appendChild(label);

        if (section.warn) {
            const warn = document.createElement('span');
            warn.className = 'repoSetupRowWarn';
            warn.textContent = '▲';
            warn.setAttribute('title', 'Least-proven shape');
            head.appendChild(warn);
        }
        row.appendChild(head);

        const rowBody = document.createElement('div');
        rowBody.className = 'repoSetupRowBody';
        rowBody.hidden = true;

        if (section.lead) {
            const lead = document.createElement('div');
            lead.className = 'repoSetupLead';
            appendInline(lead, section.lead);
            rowBody.appendChild(lead);
        }

        if (section.copyValue) {
            const copyWrap = document.createElement('div');
            copyWrap.className = 'repoSetupCopy';
            const value = document.createElement('pre');
            value.className = 'repoSetupCopyValue';
            value.textContent = section.copyValue;
            const copyBtn = document.createElement('button');
            copyBtn.type = 'button';
            copyBtn.className = 'repoSetupGhostBtn repoSetupCopyBtn';
            copyBtn.textContent = 'COPY';
            copyBtn.addEventListener('click', function() {
                copyValueToClipboard(section.copyValue, copyBtn);
            });
            copyWrap.appendChild(value);
            copyWrap.appendChild(copyBtn);
            rowBody.appendChild(copyWrap);
        }

        if (section.adds.length) {
            const chips = document.createElement('div');
            chips.className = 'repoSetupChips';
            section.adds.forEach(function(text) {
                const chip = document.createElement('span');
                chip.className = 'repoSetupChip';
                chip.textContent = text;
                chips.appendChild(chip);
            });
            rowBody.appendChild(chips);
        }

        // Variants sit between the shape's own material and its gotchas: the
        // lead and the chips describe the shape, the gotchas apply to all of
        // it, and only the middle swaps with the selection.
        if (section.variants && section.variants.length) {
            rowBody.appendChild(buildVariants(section.variants));
        }

        if (section.gotchas.length) {
            const gotchas = document.createElement('div');
            gotchas.className = 'repoSetupGotchas';
            const hiddenRows = [];
            section.gotchas.forEach(function(text, idx) {
                const gotcha = document.createElement('div');
                gotcha.className = 'repoSetupGotcha';
                appendInline(gotcha, text);
                if (idx >= GOTCHA_PREVIEW) {
                    gotcha.hidden = true;
                    hiddenRows.push(gotcha);
                }
                gotchas.appendChild(gotcha);
            });
            if (hiddenRows.length) {
                const more = document.createElement('button');
                more.type = 'button';
                more.className = 'repoSetupGhostBtn repoSetupGotchaMore';
                more.textContent = 'SHOW ' + hiddenRows.length + ' MORE';
                more.addEventListener('click', function() {
                    hiddenRows.forEach(function(node) { node.hidden = false; });
                    more.hidden = true;
                });
                gotchas.appendChild(more);
            }
            rowBody.appendChild(gotchas);
        }

        row.appendChild(rowBody);

        head.addEventListener('click', function() {
            const opening = rowBody.hidden;
            collapseAll();
            if (!opening) return;
            rowBody.hidden = false;
            head.setAttribute('aria-expanded', 'true');
        });

        rowBodies.push({ head: head, body: rowBody });
        return row;
    }

    // ── FULL DOCUMENT VIEW ──

    // The document text this modal loaded. Held here rather than read back off
    // the module cache so the full view always renders what the picker was
    // built from.
    let docText = '';

    let fullRendered = false;
    function setFullView(on) {
        if (on && !fullRendered) {
            const back = document.createElement('button');
            back.type = 'button';
            back.id = 'repoSetupFullBack';
            back.className = 'repoSetupGhostBtn';
            back.textContent = '‹ Back to shapes';
            back.addEventListener('click', function() { setFullView(false); });
            full.appendChild(back);
            const doc = document.createElement('div');
            doc.className = 'repoSetupDoc';
            renderMarkdown(doc, docText);
            full.appendChild(doc);
            fullRendered = true;
        }
        full.hidden = !on;
        viewFullBtn.hidden = on;
        // Below 1024px the document replaces the picker; above it, the picker
        // stays put and the document reads underneath it.
        list.hidden = on && isMobileViewport();
    }
    viewFullBtn.addEventListener('click', function() { setFullView(true); });

    // ── LOAD ──

    function load() {
        status.hidden = false;
        status.textContent = 'Loading ' + SHAPES_FILENAME + '…';
        error.hidden = true;
        list.hidden = true;
        viewFullBtn.hidden = true;
        loadShapesDoc().then(function(text) {
            if (closed) return;
            docText = text;
            list.textContent = '';
            rowBodies.length = 0;
            parseShapesDoc(text).forEach(function(section) {
                list.appendChild(buildRow(section));
            });
            status.hidden = true;
            error.hidden = true;
            list.hidden = false;
            viewFullBtn.hidden = false;
        }).catch(function() {
            if (closed) return;
            status.hidden = true;
            list.hidden = true;
            error.hidden = false;
        });
    }

    retryBtn.addEventListener('click', load);
    load();

    return { close: close };
}
