import { listLogic } from './listLogic.js';
import { isInjectConfigured, findTargetById, fetchActiveRuns } from './inject.js';
import { setProjectRunSpinnerActive } from './projectRow.js';

// Cross-device run spinners. This module owns the two run-spinner surfaces that
// share the same routed-repo gate:
//   • the active project's trigger glyph (#mobileProjRunSpinner), and
//   • the per-project rows inside the sidebar drawer (#projChild rows).
// It closes over the three DOM refs it paints (mobileProjName,
// mobileProjRunSpinner, sideMain), passed in from main.js, and keeps its own
// request-token / interval state so a stale probe never paints after the active
// project changed or the drawer closed.
const DRAWER_SPINNER_INTERVAL_MS = 10000;

export function createProjRunSpinner({ mobileProjName, mobileProjRunSpinner, sideMain }) {
    let projRunSpinnerReqToken = 0;
    let drawerSpinnerInterval = null;
    let drawerSpinnerReqToken = 0;

    // Resolve the active project's routed inject target (repo). Same gate as
    // the ⚡ inject bolt: inject must be configured AND the project must route
    // to a target id. A project with no routed target has no repo, so it is
    // never polled and never spins.
    function resolveActiveProjectTarget(name) {
        if (!name || !isInjectConfigured()) return null;
        const targetId = listLogic.getProjectTargetId(name);
        if (!targetId) return null;
        const target = findTargetById(targetId);
        return (target && target.repo) ? target : null;
    }

    // Probe the active project's repo and spin the trigger glyph while a run is
    // in flight. Fire-and-forget: an `ok:false` probe (or no routed repo) reads
    // as "not active" and clears the spinner — never an error toast. A request
    // token drops a stale response if the active project changed mid-flight.
    async function refreshProjRunSpinner() {
        const name = (mobileProjName.textContent || '').trim();
        const target = resolveActiveProjectTarget(name);
        if (!target) {
            mobileProjRunSpinner.classList.remove('mobileProjRunSpinner--active');
            return;
        }
        const token = ++projRunSpinnerReqToken;
        const res = await fetchActiveRuns({ repo: target.repo, file_path: target.file_path });
        if (token !== projRunSpinnerReqToken) return; // superseded by a newer poll
        const active = !!(res && res.ok && res.active === true);
        mobileProjRunSpinner.classList.toggle('mobileProjRunSpinner--active', active);
    }

    // ── Per-project run spinners in the sidebar drawer (#projChild rows) ──
    // While the drawer is open, probe every routed project's repo and spin the
    // row whose repo has an in-flight run. Same routed-repo gate as the ⚡ bolt
    // (resolveActiveProjectTarget). The probe set is deduped by repo — several
    // projects can share one repo — so it calls fetchActiveRuns once per
    // distinct repo, then maps each result back to every row that routes there.
    // Open-gated: the poll runs only while `main1.sidebar-open` is set, so the
    // extra chatter is bounded to when the switcher is actually on screen.
    async function refreshDrawerRunSpinners() {
        const rows = Array.prototype.slice.call(sideMain.querySelectorAll('#projChild'));
        if (rows.length === 0) return;
        // Group rows by their resolved repo; rows with no routed repo are
        // cleared immediately and never contribute a probe.
        const rowsByRepo = new Map();
        rows.forEach(function(row) {
            const input = row.querySelector('#projInput');
            const name = input ? (input.value || '').trim() : '';
            const target = resolveActiveProjectTarget(name);
            if (!target || !target.repo) {
                setProjectRunSpinnerActive(row, input, false);
                return;
            }
            let bucket = rowsByRepo.get(target.repo);
            if (!bucket) {
                bucket = { target: target, rows: [] };
                rowsByRepo.set(target.repo, bucket);
            }
            bucket.rows.push({ row: row, input: input });
        });
        if (rowsByRepo.size === 0) return;

        const token = ++drawerSpinnerReqToken;
        rowsByRepo.forEach(function(bucket) {
            fetchActiveRuns({ repo: bucket.target.repo, file_path: bucket.target.file_path })
                .then(function(res) {
                    if (token !== drawerSpinnerReqToken) return; // superseded
                    const active = !!(res && res.ok && res.active === true);
                    bucket.rows.forEach(function(entry) {
                        setProjectRunSpinnerActive(entry.row, entry.input, active);
                    });
                });
        });
    }

    function startDrawerSpinnerPoll() {
        refreshDrawerRunSpinners();
        if (drawerSpinnerInterval === null) {
            drawerSpinnerInterval = setInterval(refreshDrawerRunSpinners, DRAWER_SPINNER_INTERVAL_MS);
        }
    }

    function stopDrawerSpinnerPoll() {
        if (drawerSpinnerInterval !== null) {
            clearInterval(drawerSpinnerInterval);
            drawerSpinnerInterval = null;
        }
        // Drop the request token so a late in-flight probe never paints a row
        // after the drawer has closed.
        drawerSpinnerReqToken++;
    }

    return {
        resolveActiveProjectTarget,
        refreshProjRunSpinner,
        refreshDrawerRunSpinners,
        startDrawerSpinnerPoll,
        stopDrawerSpinnerPoll,
    };
}
