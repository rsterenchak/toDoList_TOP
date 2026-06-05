import './style.css';



// FACTORY FUNCTION: TODO OBJECT
// Store list items in objects
const toDo = (title, description, dueDate, priority, position) => {
    let tit = title;
    let desc = description;
    let due = dueDate;
    let pri = priority;
    let pos = position;
    let completed = false;
    // Workflow status: 'active' (default), 'in_progress', or 'idea'. New
    // todos start 'active'; the value is persisted to the Supabase `status`
    // column and round-trips through hydrate/realtime. Legacy cached todos
    // without the field are normalised to 'active' on load (see listLogic).
    let status = 'active';
    // null = one-off task. Otherwise an object shaped
    // { pattern, interval, intervalUnit, basis, endDate } — see
    // listLogic.js's nextDueDate for the supported pattern values.
    let recurrence = null;
    // Stable identifier used by the Supabase persistence layer. Assigned
    // at creation so optimistic writes can target the same row the server
    // will see. crypto.randomUUID is available on every browser since
    // 2021; the global fallback below covers older environments and
    // legacy test runners where the API may be absent.
    let id = (typeof globalThis !== 'undefined'
        && globalThis.crypto
        && typeof globalThis.crypto.randomUUID === 'function')
        ? globalThis.crypto.randomUUID()
        : null;
    // Timestamp (ms since epoch) recorded when the user successfully sent
    // the description to the configured Cloudflare Worker via the Inject to
    // TODO.md button. Null means "never injected"; once set, the inject
    // button on the row renders in the "injected" terminal state.
    let injectedAt = null;
    // ISO capture time, stamped at creation. Mirrors the Supabase
    // `todos.created_at` column (which the server populates authoritatively
    // and hydrate copies back over this client estimate). Used to order the
    // cross-project INBOX view newest-capture-first; legacy cached todos
    // predating the field read as null and sort last.
    let created_at = new Date().toISOString();

    return {id, tit, desc, due, pri, pos, completed, status, recurrence, injectedAt, created_at};
  };
  

  export { toDo };