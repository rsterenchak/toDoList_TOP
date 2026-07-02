import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, '../src');

function read(relative) {
    return readFileSync(resolve(srcDir, relative), 'utf8');
}

// Pins the mobile-row chrome changes that ship together: a purple copy-title
// icon button between the title and the due pill, and a slimmer due pill
// (no border / background, condensed label text) under the ≤1023px media
// query. Desktop chrome stays untouched. Source-inspection only, matching
// the existing mobileTaskInteractions / mobileTapToViewEdit patterns —
// buildToDoRow is too heavily wired for a full jsdom instantiation here.

describe('mobile copy-title button — wiring and skip-on-blank-placeholder', () => {

    const toDoRow = read('toDoRow.js');

    function extractBuildBody() {
        const start = toDoRow.indexOf('export function buildToDoRow(');
        expect(start).toBeGreaterThan(-1);
        // Walk braces to find the function body's closing brace.
        let depth = 0;
        let i = toDoRow.indexOf('{', start);
        for (; i < toDoRow.length; i++) {
            if (toDoRow[i] === '{') depth++;
            else if (toDoRow[i] === '}') {
                depth--;
                if (depth === 0) return toDoRow.slice(start, i + 1);
            }
        }
        throw new Error('buildToDoRow closing brace not found');
    }

    const buildBody = extractBuildBody();

    it('declares a copyBtn element inside buildToDoRow', () => {
        expect(buildBody).toMatch(/const\s+copyBtn\s*=\s*document\.createElement\(['"]button['"]\)/);
    });

    it('assigns copyBtn.id = "copyTitleBtn" and the matching class', () => {
        expect(buildBody).toMatch(/copyBtn\.id\s*=\s*['"]copyTitleBtn['"]/);
        expect(buildBody).toMatch(/copyBtn\.className\s*=\s*['"]copyTitleBtn['"]/);
    });

    it('inserts copyBtn into the DOM between toDoInput and duePill', () => {
        // The chrome order on each row reads:
        //   toDoInput → copyBtn → duePill → spacer → statsToggle → descToggle → close
        // The build site appends in that exact order, so an indexOf chain
        // locks the sequence in.
        const inputAppend = buildBody.indexOf('toDoChild.appendChild(toDoInput)');
        const copyAppend  = buildBody.indexOf('toDoChild.appendChild(copyBtn)');
        const pillAppend  = buildBody.indexOf('toDoChild.appendChild(duePill)');
        expect(inputAppend).toBeGreaterThan(-1);
        expect(copyAppend).toBeGreaterThan(-1);
        expect(pillAppend).toBeGreaterThan(-1);
        expect(copyAppend).toBeGreaterThan(inputAppend);
        expect(pillAppend).toBeGreaterThan(copyAppend);
    });

    it('hides the copy button on blank placeholder rows (skips wiring on no-title rows)', () => {
        // Blank rows already hide every other piece of row chrome
        // (delete X, descToggle, duePill, checkbox). copyBtn follows the
        // same `if (!item.tit) ... display = "none"` pattern so a brand-
        // new placeholder doesn't surface a copy icon for an empty title.
        expect(buildBody).toMatch(
            /if\s*\(\s*!item\.tit\s*\)\s*copyBtn\.style\.display\s*=\s*["']none["']/
        );
    });

    it('reveals copyBtn in the Enter-commit handler alongside duePill / closeButton / descToggle', () => {
        // When the user commits a blank row into a real todo, the row's
        // chrome cluster (checkbox, close, due pill, etc.) all flip back
        // to their default display. copyBtn has to ride along — otherwise
        // a freshly committed row keeps the copy icon hidden until the
        // project is re-rendered from storage.
        const commitBlock = buildBody.match(
            /Idempotent[\s\S]{0,80}first-commit reveal[\s\S]*?duePill\.style\.display\s*=\s*["']["'];/
        );
        expect(commitBlock).not.toBeNull();
        // copyBtn is revealed within the same idempotent block (next line
        // or two) so the source order doesn't matter — just locate it
        // after the marker.
        const idemIdx = buildBody.indexOf('// Idempotent');
        expect(idemIdx).toBeGreaterThan(-1);
        const tail = buildBody.slice(idemIdx);
        const copyReveal = tail.match(/copyBtn\.style\.display\s*=\s*["']["']/);
        expect(copyReveal).not.toBeNull();
    });

    it('copyBtn click handler writes item.tit to the clipboard and flips to the checkmark glyph', () => {
        // Both branches matter: the modern Clipboard API path (mobile
        // Safari needs this on a user gesture) and the legacy execCommand
        // fallback for environments without async clipboard support.
        expect(toDoRow).toMatch(/function\s+copyTitleToClipboard\(item,\s*copyBtn\)/);
        expect(toDoRow).toMatch(/navigator\.clipboard\.writeText\(/);
        // Feedback swap path — the helper that toggles between the copy
        // SVG and the checkmark SVG must be reachable from the success
        // callback so the user sees a confirmation flip.
        expect(toDoRow).toMatch(/function\s+setCopyBtnGlyph\(copyBtn,\s*done\)/);
        // 1s feedback window per the task brief.
        expect(toDoRow).toMatch(/COPY_FEEDBACK_MS\s*=\s*1000/);
    });

    it('row-level click handler bails on copyTitleBtn so its click is not stolen', () => {
        // wireToDoRowClick's catch-all click listener would otherwise
        // promote the row to "active" or focus the input when the user
        // taps the copy icon. The bail-out list must include
        // `.copyTitleBtn` so the copy click reaches its own handler
        // cleanly.
        expect(toDoRow).toMatch(/e\.target\.closest\(['"]\.copyTitleBtn['"]\)/);
    });
});


describe('mobile due-date pill — slimmed background-less treatment with condensed label', () => {

    const css = read('style.css');
    const dueDate = read('dueDate.js');

    function allMobileMediaBlocks() {
        const blocks = [];
        let cursor = 0;
        while (true) {
            const media = css.indexOf('@media (max-width: 1023px)', cursor);
            if (media === -1) break;
            let depth = 0;
            let end = css.length;
            for (let i = css.indexOf('{', media); i < css.length; i++) {
                if (css[i] === '{') depth++;
                else if (css[i] === '}') {
                    depth--;
                    if (depth === 0) { end = i + 1; break; }
                }
            }
            blocks.push({ start: media, end, text: css.slice(media, end) });
            cursor = end;
        }
        expect(blocks.length).toBeGreaterThan(0);
        return blocks;
    }

    function extractRule(haystack, selector) {
        const stripped = haystack.replace(/\/\*[\s\S]*?\*\//g, '');
        const escaped = selector.replace(/[#.\[\]"=]/g, m => '\\' + m);
        const re = new RegExp(
            '(?:^|[\\s,{}])' + escaped + '\\s*(?=[,{])',
            'm'
        );
        const m = re.exec(stripped);
        if (!m) return null;
        const startIdx = stripped.indexOf('{', m.index);
        if (startIdx === -1) return null;
        // Walk braces to find the matching close.
        let depth = 0;
        for (let i = startIdx; i < stripped.length; i++) {
            if (stripped[i] === '{') depth++;
            else if (stripped[i] === '}') {
                depth--;
                if (depth === 0) return stripped.slice(startIdx + 1, i);
            }
        }
        return null;
    }

    it('updateDuePillLabel writes a data-short-label attribute alongside the long label', () => {
        // CSS swaps to the short form by reading attr(data-short-label),
        // so the JS path has to emit it on every label update — otherwise
        // the mobile pill would render empty.
        expect(dueDate).toMatch(/setAttribute\(\s*['"]data-short-label['"]/);
    });

    it('short-label uses condensed forms for each urgency bucket', () => {
        // "1d" for overdue, "Today" for due-today, "Nd" for due-soon,
        // absolute MMM D otherwise. The corresponding source branches are
        // adjacent to the existing long-label strings — locate them via
        // the long-label anchor.
        // Overdue: "Nd overdue" → "Nd"
        expect(dueDate).toMatch(/Math\.abs\(days\)\s*\+\s*['"]d['"]/);
        // Due today: "Due today" → "Today"
        expect(dueDate).toMatch(/shortLabel\s*=\s*['"]Today['"]/);
        // Due-soon: "Due in Nd" → "Nd"
        expect(dueDate).toMatch(/shortLabel\s*=\s*days\s*\+\s*['"]d['"]/);
    });

    function findMobileDuePillRule() {
        const blocks = allMobileMediaBlocks();
        for (const block of blocks) {
            const body = extractRule(block.text, '#duePill');
            if (body !== null) return { block, body };
        }
        return null;
    }

    it('mobile @media block has a #duePill rule that drops background, border, and uppercase chrome', () => {
        const hit = findMobileDuePillRule();
        expect(hit).not.toBeNull();
        // Background flattened to transparent.
        expect(hit.body).toMatch(/background:\s*transparent/);
        // Border stripped.
        expect(hit.body).toMatch(/border:\s*none/);
        // Uppercase transform undone.
        expect(hit.body).toMatch(/text-transform:\s*none/);
        // Letter-spacing collapsed.
        expect(hit.body).toMatch(/letter-spacing:\s*0/);
    });

    it('mobile @media block renders the pill as a bare calendar icon with no inline date text', () => {
        // Bare-icon treatment: both the desktop long label and the previous
        // short-label pseudo-text are suppressed on mobile so only the
        // calendar glyph paints. Confirm nothing surfaces date text via an
        // attr() pseudo on #duePill at the mobile breakpoint.
        const blocks = allMobileMediaBlocks();
        const hidesLongLabel = blocks.some(b =>
            /#duePill\s+\.duePillLabel\s*\{[^}]*display:\s*none/.test(b.text)
        );
        expect(hidesLongLabel).toBe(true);
        const hidesChevron = blocks.some(b =>
            /#duePill\s+\.duePillChevron\s*\{[^}]*display:\s*none/.test(b.text)
        );
        expect(hidesChevron).toBe(true);
        const surfacesShortLabel = blocks.some(b =>
            /#duePill\b[^{]*::after\s*\{[^}]*content:\s*attr\(data-short-label\)/.test(b.text)
        );
        expect(surfacesShortLabel).toBe(false);
    });

    it('mobile #duePill keeps a ≥32×32px tap target so the icon stays touch-reachable', () => {
        const hit = findMobileDuePillRule();
        expect(hit).not.toBeNull();
        const minW = hit.body.match(/min-width:\s*(\d+)px/);
        const minH = hit.body.match(/min-height:\s*(\d+)px/);
        expect(minW).not.toBeNull();
        expect(minH).not.toBeNull();
        expect(parseInt(minW[1], 10)).toBeGreaterThanOrEqual(32);
        expect(parseInt(minH[1], 10)).toBeGreaterThanOrEqual(32);
    });

    it('mobile @media block colors the bare icon per urgency (overdue red, soon amber, default neutral, empty gray)', () => {
        // The bare icon's color encodes urgency. Use literal hex values
        // rather than the desktop urgency tokens because the bare icon
        // wants its own visual scale independent of the bordered desktop
        // pill's text-color contrast targets. The calendar recedes to a
        // dim neutral by default so it stops competing with the title;
        // red is reserved for past-due.
        const blocks = allMobileMediaBlocks();
        const joined = blocks.map(b => b.text).join('\n');
        // Default (date set, no urgency class): dim neutral #4a4b58 on the
        // base #duePill rule itself.
        const hit = findMobileDuePillRule();
        expect(hit.body).toMatch(/color:\s*#4a4b58/i);
        // Empty (no date set): dim gray #5A5A6A.
        expect(joined).toMatch(/#duePill\[data-empty="true"\]\s*\{[^}]*color:\s*#5A5A6A/i);
        // Due-soon: amber #EF9F27.
        expect(joined).toMatch(/#toDoChild\.due-soon\s+#duePill\s*\{[^}]*color:\s*#EF9F27/i);
        // Overdue: red #ff5d7a — reserved for a past-due date.
        expect(joined).toMatch(/#toDoChild\.due-overdue\s+#duePill\s*\{[^}]*color:\s*#ff5d7a/i);
    });

    it('desktop top-level #duePill rule keeps its bordered chrome (regression guard for dueDatePillBorder)', () => {
        // The dueDatePillBorder test pins the 1px border and the
        // overflow:clip + clip-margin chrome. Confirm both are still
        // intact at the top level so the mobile carve-out doesn't leak
        // into desktop styling.
        const topLevel = css.match(/(?:^|\n)#duePill\s*\{([\s\S]*?)\}/);
        expect(topLevel).not.toBeNull();
        const body = topLevel[1];
        expect(body).toMatch(/border:\s*1px\s+solid/);
        expect(body).toMatch(/text-transform:\s*uppercase/);
    });

    it('mobile @media block reveals the copy-title button via display: inline-flex', () => {
        // The desktop default is display: none on .copyTitleBtn; the
        // ≤1023px breakpoint flips it on. Without this rule the JS-side
        // wiring would be dark on every device.
        const block = allMobileMediaBlocks().find(b =>
            /\.copyTitleBtn\s*\{[^}]*display:\s*inline-flex/.test(b.text)
        );
        expect(block).toBeTruthy();
    });

    it('desktop default rule on .copyTitleBtn is display: none', () => {
        // Outside any media query, the button must be hidden — otherwise
        // it leaks onto desktop rows where the copy icon would crowd the
        // existing chrome.
        const topLevel = css.match(/(?:^|\n)\.copyTitleBtn\s*\{([\s\S]*?)\}/);
        expect(topLevel).not.toBeNull();
        expect(topLevel[1]).toMatch(/display:\s*none/);
    });

    it('desktop urgency cascade for #duePill stays intact at the top level', () => {
        // The bare-icon mobile pill overrides these in the ≤1023px media
        // block with its own literal-hex colors, but desktop must still
        // recolor the bordered pill text via the existing urgency tokens.
        // Lock in the top-level rules so a future refactor doesn't drop
        // the desktop cascade while reworking the mobile bare-icon path.
        // Due-soon keeps its amber token; overdue is the reserved danger
        // pink #ff5d7a (was var(--text-urgent)) so it reads at a glance.
        expect(css).toMatch(/#toDoChild\.due-soon\s+#duePill\s*\{[^}]*color:\s*var\(--text-warning\)/);
        expect(css).toMatch(/#toDoChild\.due-overdue\s+#duePill\s*\{[^}]*color:\s*#ff5d7a/);
    });
});
