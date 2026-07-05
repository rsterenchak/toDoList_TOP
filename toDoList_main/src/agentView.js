import { supabase } from './supabaseClient.js';
import { listLogic } from './listLogic.js';

// The AGENT view: a per-project board of the autonomous-agent work queue. It
// replaces the old Conceive incubator surface. For the currently selected
// project it reads the `agent_queue` Supabase table (scoped by project_id) and
// renders the rows as grouped buckets — Needs you, Stuck, In progress, Shipped
// — matching the reviewed mockups, with a live realtime subscription so state
// changes stream in.
//
// This module is READ/RENDER ONLY. It never mutates the data model (those
// mutations route through listLogic.js) and it never writes to agent_queue.
// Interactive controls (answer inputs, buttons) render here as static, inert
// affordances — the flag toggle and follow-up interactions land in later
// entries. Like the other view modules it reaches the DOM at call time via
// getElementById / createElement and exports only renderAgentView plus a
// subscribe/unsubscribe pair; there is no back-edge into main.js.

// Bucket layout, top to bottom, matching the reviewed mockups. Each bucket
// groups one or more agent_queue `state` values. Empty buckets are omitted at
// render time; a full-empty state shows when the project has no rows at all.
const BUCKETS = [
    { key: 'needs-you', label: 'Needs you', states: ['needs_words', 'needs_mockup'] },
    { key: 'stuck', label: 'Stuck', states: ['failed'] },
    { key: 'in-progress', label: 'In progress', states: ['triaging', 'drafted', 'dispatched', 'running'] },
    { key: 'shipped', label: 'Shipped', states: ['shipped'] },
];

// The in-progress states that render as thin, collapsible rows rather than full
// cards (queued/running work is low-signal until it needs you or ships).
const THIN_STATES = ['dispatched', 'running'];

// Human-readable chip label per state.
const STATE_CHIP = {
    needs_words: 'Needs words',
    needs_mockup: 'Needs mockup',
    failed: 'Stuck',
    triaging: 'Triaging',
    drafted: 'Drafted',
    dispatched: 'Queued',
    running: 'Running',
    shipped: 'Shipped',
};

// ── module state ─────────────────────────────────────────────────────
// The rows last loaded for the active project, the project they belong to,
// and the live realtime channel. Module-level so a re-render (project switch,
// realtime push) paints from the cache without a synchronous refetch, and so
// the channel survives across re-renders and tears down cleanly on view exit.
let _rows = [];
let _loadedProjectName = null;
let _channel = null;

function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

// Resolve the currently-selected project's name from the sidebar — the same
// source of truth the Projects and Conceive views used. Returns '' when
// nothing is selected, which drives the empty state.
function getSelectedProjectName() {
    const selected = document.querySelector('.selectedProject');
    if (!selected) return '';
    const input = selected.querySelector('#projInput');
    return input ? (input.value || '').trim() : '';
}

// Query agent_queue for one project's rows. Written to survive both the live
// Supabase client (a chainable, awaitable query builder) and the test/stub
// client (whose .select() resolves immediately and has no .eq); a synchronous
// throw from the incompatible chain is caught and treated as "no rows", so the
// view degrades to an empty board rather than crashing.
function fetchQueueRows(projectId) {
    return new Promise(function (resolve) {
        try {
            Promise.resolve(
                supabase.from('agent_queue').select('*').eq('project_id', projectId)
            ).then(function (res) {
                if (res && res.error) { resolve([]); return; }
                resolve((res && res.data) || []);
            }).catch(function () { resolve([]); });
        } catch (e) {
            resolve([]);
        }
    });
}

// Re-scope and reload the queue for the given project, then repaint. Only the
// most recent load for the still-selected project is applied, so a stale
// in-flight fetch from a since-abandoned project can't clobber the board.
function refreshAgentQueue(projectName) {
    _loadedProjectName = projectName;
    const projectId = projectName ? listLogic.getProjectId(projectName) : null;
    if (!projectId) {
        _rows = [];
        paint();
        return;
    }
    fetchQueueRows(projectId).then(function (rows) {
        if (getSelectedProjectName() === _loadedProjectName) {
            _rows = Array.isArray(rows) ? rows : [];
            paint();
        }
    });
}

// A state chip: a small pill labelling the row's queue state.
function buildChip(state) {
    const chip = document.createElement('span');
    chip.className = 'agentChip agentChip--' + (state || 'unknown');
    chip.textContent = STATE_CHIP[state] || state || 'Unknown';
    return chip;
}

// State-appropriate secondary content under a card's title: the pending
// question for needs_words, the failure reason for a stuck row, PR/queued
// status for in-progress work. Returns null when there's nothing to show.
function buildSecondary(row) {
    const state = row.state;
    if (state === 'needs_words') {
        const q = (row.question || '').trim();
        // A live answer control: the user types a reply and sends it, which
        // appends to the row's thread and re-queues the task (state ->
        // triaging) for a re-triage that now carries the answer. The realtime
        // subscription then moves the card out of Needs you on its own. The
        // 16px font-size avoids iOS Safari's focus auto-zoom.
        const wrap = document.createElement('div');
        wrap.className = 'agentSecondary';
        if (q) {
            const preview = document.createElement('p');
            preview.className = 'agentQuestion';
            preview.textContent = q;
            wrap.appendChild(preview);
        }
        const input = document.createElement('textarea');
        input.className = 'agentAnswerInput';
        input.rows = 2;
        input.placeholder = 'Answer to continue…';
        input.setAttribute('aria-label', 'Answer');
        wrap.appendChild(input);

        const actions = document.createElement('div');
        actions.className = 'agentAnswerActions';

        const errorEl = document.createElement('p');
        errorEl.className = 'agentAnswerError';
        errorEl.setAttribute('role', 'alert');
        errorEl.hidden = true;
        actions.appendChild(errorEl);

        const send = document.createElement('button');
        send.type = 'button';
        send.className = 'agentAnswerSend';
        send.textContent = 'Send';
        actions.appendChild(send);
        wrap.appendChild(actions);

        // Submit the trimmed answer. Empty/whitespace-only input is ignored
        // (no write). While the write is in flight the input and button are
        // disabled; on success the board refreshes (the row leaves Needs you);
        // on failure the controls re-enable and a non-blocking error shows.
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
            Promise.resolve(listLogic.answerAgentTask(row.id, text, row.thread)).then(function (res) {
                if (res && res.ok) {
                    input.value = '';
                    // The realtime subscription re-renders as the state flips;
                    // refresh explicitly too so the card leaves Needs you even
                    // where realtime isn't observed (e.g. offline stubs).
                    refreshAgentQueue(getSelectedProjectName());
                    return;
                }
                send.disabled = false;
                input.disabled = false;
                send.classList.remove('is-pending');
                send.textContent = 'Send';
                errorEl.textContent = (res && res.error) || 'Could not send. Try again.';
                errorEl.hidden = false;
            }).catch(function () {
                send.disabled = false;
                input.disabled = false;
                send.classList.remove('is-pending');
                send.textContent = 'Send';
                errorEl.textContent = 'Could not send. Try again.';
                errorEl.hidden = false;
            });
        }

        // Enter (without Shift) submits; Shift+Enter inserts a newline.
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submitAnswer();
            }
        });
        send.addEventListener('click', submitAnswer);
        return wrap;
    }
    if (state === 'needs_mockup') {
        const p = document.createElement('p');
        p.className = 'agentSecondary agentSecondaryMuted';
        p.textContent = 'Attach a mockup to continue.';
        return p;
    }
    if (state === 'failed') {
        const reason = (row.failure_reason || '').trim();
        const p = document.createElement('p');
        p.className = 'agentSecondary agentFailure';
        p.textContent = reason || 'The run failed. Retry from the queue.';
        return p;
    }
    if (state === 'shipped') {
        const p = document.createElement('p');
        p.className = 'agentSecondary agentSecondaryMuted';
        const pr = row.pr_number ? ('PR #' + row.pr_number) : (row.pr_url ? 'View PR' : 'Shipped');
        p.textContent = pr;
        return p;
    }
    // In-progress non-thin states (triaging / drafted): a short status line.
    if (state === 'triaging' || state === 'drafted') {
        const p = document.createElement('p');
        p.className = 'agentSecondary agentSecondaryMuted';
        p.textContent = state === 'drafted' ? 'Draft ready to dispatch.' : 'Triaging the request…';
        return p;
    }
    return null;
}

// One card for a single queue row: title, a state chip, and state-appropriate
// secondary content. Rows in the thin states (queued / running) render as a
// compact single-line row instead of a full card.
function buildCard(row) {
    const thin = THIN_STATES.indexOf(row.state) !== -1;
    const card = document.createElement('div');
    card.className = 'agentCard' + (thin ? ' agentCard--thin' : '');
    card.setAttribute('data-state', row.state || '');

    const head = document.createElement('div');
    head.className = 'agentCardHead';

    const title = document.createElement('span');
    title.className = 'agentCardTitle';
    // The title lives inside the `context` JSONB (`context.title`, written at
    // flag time), not in a top-level column. Read it from there, guarding for a
    // missing or non-object context, and never call a string method on the raw
    // object (which would throw and blank the whole board).
    const ctx = (row.context && typeof row.context === 'object') ? row.context : {};
    const text = (ctx.title || row.title || '').trim() || 'Untitled entry';
    title.textContent = text;
    title.title = text;
    head.appendChild(title);

    head.appendChild(buildChip(row.state));
    card.appendChild(head);

    if (!thin) {
        const secondary = buildSecondary(row);
        if (secondary) card.appendChild(secondary);
    }
    return card;
}

// A small inline bolt glyph for the "Give to agent" pill. Built via the DOM
// (no new asset file) and inherits the pill's colour through currentColor so
// it stays theme-correct in both dark and light modes.
function buildBoltIcon() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'agentGiveBolt');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '14');
    svg.setAttribute('height', '14');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M13 2 4 14h6l-1 8 9-12h-6z');
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
}

// The active project's todos that are NOT yet present in the loaded
// agent_queue rows (matched by todo_id). Blank placeholder rows (empty title)
// are render artifacts, not real tasks, so they're excluded. Returns a fresh
// array — the live items array is never mutated.
function computeNotAssigned(projectName, rows) {
    const items = listLogic.listItems(projectName);
    if (!Array.isArray(items) || !items.length) return [];
    const queued = new Set();
    (rows || []).forEach(function (r) {
        if (r && r.todo_id != null) queued.add(r.todo_id);
    });
    return items.filter(function (it) {
        return it && typeof it.tit === 'string' && it.tit.trim() !== '' && !it.completed && !queued.has(it.id);
    });
}

// One "Not assigned" card: the task title plus a real "Give to agent" pill.
// Tapping the pill flags the task for the autonomous agent via listLogic
// (agent_queue insert); the view never writes directly. The button shows a
// brief pending state and disables while the insert is in flight; on success
// the realtime subscription (plus an explicit refresh) moves the task into the
// In progress bucket; on failure the button re-enables and a non-blocking
// error is surfaced beneath it.
function buildGiveToAgentCard(item) {
    const card = document.createElement('div');
    card.className = 'agentCard agentCard--unassigned';
    card.setAttribute('data-todo-id', item.id || '');

    const head = document.createElement('div');
    head.className = 'agentCardHead';

    const title = document.createElement('span');
    title.className = 'agentCardTitle';
    const text = (item.tit || '').trim() || 'Untitled task';
    title.textContent = text;
    title.title = text;
    head.appendChild(title);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'agentGiveButton';
    btn.setAttribute('aria-label', 'Give "' + text + '" to agent');
    btn.appendChild(buildBoltIcon());
    const btnLabel = document.createElement('span');
    btnLabel.className = 'agentGiveButtonLabel';
    btnLabel.textContent = 'Give to agent';
    btn.appendChild(btnLabel);
    head.appendChild(btn);
    card.appendChild(head);

    const errorEl = document.createElement('p');
    errorEl.className = 'agentGiveError';
    errorEl.setAttribute('role', 'alert');
    errorEl.hidden = true;
    card.appendChild(errorEl);

    btn.addEventListener('click', function () {
        if (btn.disabled) return;
        errorEl.hidden = true;
        errorEl.textContent = '';
        btn.disabled = true;
        btn.classList.add('is-pending');
        btnLabel.textContent = 'Adding…';
        Promise.resolve(listLogic.flagTaskForAgent(item.id)).then(function (res) {
            if (res && res.ok) {
                // The realtime subscription re-renders as the new row lands;
                // refresh explicitly too so the card leaves Not-assigned even
                // where realtime isn't observed (e.g. offline stubs).
                refreshAgentQueue(getSelectedProjectName());
                return;
            }
            btn.disabled = false;
            btn.classList.remove('is-pending');
            btnLabel.textContent = 'Give to agent';
            errorEl.textContent = (res && res.error) || 'Could not flag this task. Try again.';
            errorEl.hidden = false;
        }).catch(function () {
            btn.disabled = false;
            btn.classList.remove('is-pending');
            btnLabel.textContent = 'Give to agent';
            errorEl.textContent = 'Could not flag this task. Try again.';
            errorEl.hidden = false;
        });
    });

    return card;
}

// The Not-assigned bucket: a header (label + count) and one Give-to-agent card
// per unqueued task. Rendered at the bottom of the board, below Shipped.
function buildNotAssignedBucket(items) {
    const section = document.createElement('div');
    section.className = 'agentBucket agentBucket--not-assigned';

    const header = document.createElement('div');
    header.className = 'agentBucketHeader';

    const label = document.createElement('span');
    label.className = 'agentBucketLabel';
    label.textContent = 'Not assigned';
    header.appendChild(label);

    const count = document.createElement('span');
    count.className = 'agentBucketCount';
    count.textContent = String(items.length);
    header.appendChild(count);

    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'agentBucketList';
    items.forEach(function (item) { list.appendChild(buildGiveToAgentCard(item)); });
    section.appendChild(list);

    return section;
}

// One bucket section: a header (label + count) and its cards.
function buildBucket(bucket, rows) {
    const section = document.createElement('div');
    section.className = 'agentBucket agentBucket--' + bucket.key;

    const header = document.createElement('div');
    header.className = 'agentBucketHeader';

    const label = document.createElement('span');
    label.className = 'agentBucketLabel';
    label.textContent = bucket.label;
    header.appendChild(label);

    const count = document.createElement('span');
    count.className = 'agentBucketCount';
    count.textContent = String(rows.length);
    header.appendChild(count);

    section.appendChild(header);

    const list = document.createElement('div');
    list.className = 'agentBucketList';
    rows.forEach(function (row) { list.appendChild(buildCard(row)); });
    section.appendChild(list);

    return section;
}

// Paint the board from the cached rows for the currently selected project.
// Pure render — never fetches — so realtime pushes and re-renders stay cheap
// and loop-free. A missing #agentView (before component() builds the shell)
// short-circuits.
function paint() {
    const view = document.getElementById('agentView');
    if (!view) return;
    clear(view);

    const projectName = getSelectedProjectName();
    if (!projectName) {
        const empty = document.createElement('div');
        empty.className = 'agentEmptyState';
        empty.textContent = 'Select a project to see its agent queue.';
        view.appendChild(empty);
        return;
    }

    const header = document.createElement('div');
    header.className = 'agentViewHeader';
    const name = document.createElement('h2');
    name.className = 'agentProjectName';
    name.textContent = projectName;
    header.appendChild(name);
    const chip = document.createElement('span');
    chip.className = 'agentViewChip';
    chip.textContent = 'Agent queue';
    header.appendChild(chip);
    view.appendChild(header);

    const rows = Array.isArray(_rows) ? _rows : [];
    const board = document.createElement('div');
    board.className = 'agentBoard';
    let rendered = false;
    BUCKETS.forEach(function (bucket) {
        const bucketRows = rows.filter(function (r) {
            return r && bucket.states.indexOf(r.state) !== -1;
        });
        if (!bucketRows.length) return;
        board.appendChild(buildBucket(bucket, bucketRows));
        rendered = true;
    });

    // Not-assigned bucket at the bottom: the project's tasks not yet in the
    // queue, each with a live "Give to agent" control. Omitted when every task
    // is already queued (or the project has no tasks).
    const notAssigned = computeNotAssigned(projectName, rows);
    if (notAssigned.length) {
        board.appendChild(buildNotAssignedBucket(notAssigned));
        rendered = true;
    }

    if (!rendered) {
        const empty = document.createElement('div');
        empty.className = 'agentEmptyState';
        empty.textContent = 'No agent work yet for this project.';
        view.appendChild(empty);
        return;
    }
    view.appendChild(board);
}

// Render the AGENT view for the currently selected project. Safe to call
// before component() has built the shell (a missing #agentView short-circuits
// inside paint()). Repaints from the cached rows immediately, and — when the
// selected project has changed since the last load — kicks off a fresh
// project-scoped fetch that repaints again on resolve.
export function renderAgentView() {
    const projectName = getSelectedProjectName();
    if (projectName !== _loadedProjectName) {
        _rows = [];
        refreshAgentQueue(projectName);
        return;
    }
    paint();
}

// Open the realtime subscription on agent_queue and load the current project's
// rows. The channel is user-scoped (RLS narrows it to the signed-in user's
// rows); each push simply re-scopes and reloads the active project's rows.
// Idempotent — a second call while a channel is live only refreshes.
export function subscribeAgentView() {
    if (!_channel && supabase && typeof supabase.channel === 'function') {
        try {
            _channel = supabase
                .channel('public:agent_queue')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'agent_queue' },
                    function () { refreshAgentQueue(getSelectedProjectName()); })
                .subscribe();
        } catch (e) {
            _channel = null;
        }
    }
    refreshAgentQueue(getSelectedProjectName());
}

// Tear down the realtime subscription on view exit so a backgrounded board
// doesn't hold an open channel. Idempotent and safe to call when no channel
// is open.
export function unsubscribeAgentView() {
    if (_channel && supabase && typeof supabase.removeChannel === 'function') {
        try { supabase.removeChannel(_channel); } catch (e) { /* ignore */ }
    }
    _channel = null;
}
