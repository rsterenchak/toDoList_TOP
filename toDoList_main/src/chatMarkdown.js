// Render an assistant reply's markdown into real elements, without a library and
// without ever parsing the model's text as HTML.
//
// The subset is what the chat model actually emits: paragraphs, `#`–`###`
// headings, bold, italic, inline code, ordered and unordered lists nested to
// three levels, fenced code blocks, blockquotes, horizontal rules and links.
// Every piece of the model's text lands through a text node, so a `<script>` in
// prose renders as the literal characters. Anything the parser doesn't
// recognise falls through as a paragraph.

const FENCE_RE = /^(\s*)```\s*([\w+#.-]*)\s*$/;
const HR_RE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const HEADING_RE = /^\s{0,3}(#{1,3})\s+(.*?)\s*#*\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?(.*)$/;
const ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const MAX_LIST_DEPTH = 3;

// Inline constructs, in priority order inside one alternation so the earliest
// match wins: code, bold (** / __), italic (* / _), and [text](url) links.
const INLINE_RE = /`([^`\n]+)`|\*\*(.+?)\*\*|__(.+?)__|\*([^*\s](?:[^*\n]*?[^*\s])?)\*|(^|[^\w])_([^_\s](?:[^_\n]*?[^_\s])?)_(?!\w)|\[([^\]\n]+)\]\(([^)\s]+)\)/g;

function indentOf(line) {
    return line.replace(/\t/g, '    ').match(/^ */)[0].length;
}

function isBlank(line) {
    return !line || !line.trim();
}

// Only web and mail links become anchors; any other scheme (javascript:,
// data:) stays as its visible text.
function safeHref(url) {
    return /^(https?:\/\/|mailto:)/i.test(url) ? url : null;
}

// Append `text`'s inline markdown to `parent` as text nodes and elements.
export function renderInline(text, parent) {
    const src = String(text == null ? '' : text);
    const re = new RegExp(INLINE_RE.source, 'g');
    let last = 0;
    let m;
    while ((m = re.exec(src))) {
        let start = m.index;
        // The underscore branch captures the boundary character before the `_`.
        if (m[6] !== undefined && m[5]) start += m[5].length;
        if (start > last) parent.appendChild(document.createTextNode(src.slice(last, start)));
        let el = null;
        if (m[1] !== undefined) {
            el = document.createElement('code');
            el.textContent = m[1];
        } else if (m[2] !== undefined || m[3] !== undefined) {
            el = document.createElement('strong');
            renderInline(m[2] !== undefined ? m[2] : m[3], el);
        } else if (m[4] !== undefined || m[6] !== undefined) {
            el = document.createElement('em');
            renderInline(m[4] !== undefined ? m[4] : m[6], el);
        } else {
            const href = safeHref(m[8]);
            if (href) {
                el = document.createElement('a');
                el.href = href;
                el.target = '_blank';
                el.rel = 'noopener';
                renderInline(m[7], el);
            } else {
                el = document.createTextNode(m[7]);
            }
        }
        parent.appendChild(el);
        last = re.lastIndex;
    }
    if (last < src.length) parent.appendChild(document.createTextNode(src.slice(last)));
    return parent;
}

// Inline-render several lines into `parent`, a <br> between each.
function renderLines(lines, parent) {
    lines.forEach(function (line, i) {
        if (i) parent.appendChild(document.createElement('br'));
        renderInline(line.trim(), parent);
    });
    return parent;
}

function copyText(text, btn) {
    const done = function () {
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = 'Copy'; }, 1200);
    };
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(function () {});
        }
    } catch (e) { /* clipboard unavailable — the button simply does nothing */ }
}

// A fenced block: a header row (language left, Copy right) over a <pre> that
// scrolls horizontally on its own, so a long line never widens the bubble.
export function buildCodeBlock(lang, code) {
    const wrap = document.createElement('div');
    wrap.className = 'claudeMdCode';
    const head = document.createElement('div');
    head.className = 'claudeMdCodeHead';
    const label = document.createElement('span');
    label.className = 'claudeMdCodeLang';
    label.textContent = lang || 'code';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'claudeMdCodeCopy';
    copy.textContent = 'Copy';
    copy.setAttribute('aria-label', 'Copy code');
    copy.addEventListener('click', function () { copyText(code, copy); });
    head.appendChild(label);
    head.appendChild(copy);
    const pre = document.createElement('pre');
    const codeEl = document.createElement('code');
    codeEl.setAttribute('data-lang', lang || '');
    codeEl.textContent = code;
    pre.appendChild(codeEl);
    wrap.appendChild(head);
    wrap.appendChild(pre);
    return wrap;
}

// Read a fence opening at lines[i]; the body's lines lose the fence's own
// indent. Returns { el, next }. An unclosed fence runs to the end of the text.
function readFence(lines, i) {
    const open = FENCE_RE.exec(lines[i]);
    const pad = indentOf(open[1]);
    const body = [];
    let j = i + 1;
    while (j < lines.length && !/^\s*```\s*$/.test(lines[j])) {
        const line = lines[j].replace(/\t/g, '    ');
        body.push(line.slice(Math.min(pad, indentOf(line))));
        j++;
    }
    return { el: buildCodeBlock(open[2], body.join('\n')), next: Math.min(j + 1, lines.length) };
}

// Walk a list from lines[i] with an indent stack: a deeper item opens a nested
// list inside the previous <li> (to MAX_LIST_DEPTH), a shallower one pops back.
// Indented fences and continuation lines attach to the item they sit under.
function readList(lines, i) {
    const stack = [];
    let root = null;
    let j = i;
    while (j < lines.length) {
        const line = lines[j];
        if (isBlank(line)) {
            let k = j + 1;
            while (k < lines.length && isBlank(lines[k])) k++;
            if (k >= lines.length) break;
            const ahead = lines[k];
            if (!ITEM_RE.test(ahead) && indentOf(ahead) <= stack[0].indent) break;
            j = k;
            continue;
        }
        const item = ITEM_RE.exec(line);
        const indent = indentOf(line);
        if (!item) {
            if (indent <= stack[0].indent) break;
            let owner = stack[stack.length - 1];
            for (let s = stack.length - 1; s >= 0; s--) {
                if (stack[s].indent < indent) { owner = stack[s]; break; }
            }
            if (FENCE_RE.test(line)) {
                const fence = readFence(lines, j);
                owner.li.appendChild(fence.el);
                j = fence.next;
                continue;
            }
            owner.li.appendChild(document.createElement('br'));
            renderInline(line.trim(), owner.li);
            j++;
            continue;
        }
        const ordered = /\d/.test(item[2]);
        while (stack.length > 1 && indent < stack[stack.length - 1].indent) stack.pop();
        let top = stack[stack.length - 1];
        let opens = !top || (indent >= top.indent + 2 && stack.length < MAX_LIST_DEPTH);
        // A bullet switching to numbers (or back) at the same level starts a
        // fresh list: the caller's at the top level, a sibling one when nested.
        if (!opens && top.ordered !== ordered) {
            if (stack.length === 1) break;
            stack.pop();
            top = stack[stack.length - 1];
            opens = true;
        }
        if (opens) {
            const list = document.createElement(ordered ? 'ol' : 'ul');
            const n = parseInt(item[2], 10);
            if (ordered && n !== 1) list.setAttribute('start', String(n));
            if (top) top.li.appendChild(list);
            else root = list;
            top = { indent: indent, ordered: ordered, list: list, li: null };
            stack.push(top);
        }
        const li = document.createElement('li');
        renderInline(item[3], li);
        top.list.appendChild(li);
        top.li = li;
        j++;
    }
    return { el: root, next: j };
}

function startsBlock(line) {
    return FENCE_RE.test(line) || HR_RE.test(line) || HEADING_RE.test(line)
        || QUOTE_RE.test(line) || ITEM_RE.test(line);
}

function renderBlocks(lines, parent) {
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (isBlank(line)) { i++; continue; }
        if (FENCE_RE.test(line)) {
            const fence = readFence(lines, i);
            parent.appendChild(fence.el);
            i = fence.next;
            continue;
        }
        if (HR_RE.test(line)) {
            parent.appendChild(document.createElement('hr'));
            i++;
            continue;
        }
        const heading = HEADING_RE.exec(line);
        if (heading) {
            // `#` maps to <h3> so a reply's headings never outrank the sheet's own.
            const h = document.createElement('h' + (heading[1].length + 2));
            renderInline(heading[2], h);
            parent.appendChild(h);
            i++;
            continue;
        }
        if (QUOTE_RE.test(line)) {
            const inner = [];
            let m;
            while (i < lines.length && (m = QUOTE_RE.exec(lines[i]))) { inner.push(m[1]); i++; }
            const quote = document.createElement('blockquote');
            renderBlocks(inner, quote);
            parent.appendChild(quote);
            continue;
        }
        if (ITEM_RE.test(line)) {
            const list = readList(lines, i);
            if (list.el) {
                parent.appendChild(list.el);
                i = list.next;
                continue;
            }
        }
        const para = [line];
        i++;
        while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i])) {
            para.push(lines[i]);
            i++;
        }
        const p = document.createElement('p');
        renderLines(para, p);
        parent.appendChild(p);
    }
    return parent;
}

// Parse `text` as markdown and return the rendered DocumentFragment.
export function renderMarkdown(text) {
    const frag = document.createDocumentFragment();
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    return renderBlocks(lines, frag);
}
