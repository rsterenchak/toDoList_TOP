// Desktop-only ghost companion. Lives in the bottom strip of the viewport,
// drifts between idle and walking on a slow random timer, and cheers when
// the host app calls `cheer()` on a todo completion. The companion is
// purely decorative — it holds no app state and has no side effects beyond
// its own DOM element. When disabled (or on non-qualifying viewports) the
// DOM element is never created, so no timers or paint work are incurred.
// The ghost sprite itself is declared in style.css (background-image on
// .companion) so this module stays asset-import-free and testable.

const STORAGE_KEY = 'todoapp_companion_enabled';

// Default on. A missing key counts as enabled so the feature is discoverable
// without the user having to opt in.
export function isCompanionEnabled() {
    try {
        const v = localStorage.getItem(STORAGE_KEY);
        return v === null ? true : v === 'true';
    } catch (e) {
        return true;
    }
}

export function setCompanionEnabled(enabled) {
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (e) {
        /* quota or private-mode — preference is transient this session */
    }
}

// Gate: the companion only runs on desktop-class viewports with a fine
// pointer. Mobile's bottom strip overlaps the soft-keyboard area and the
// safe-area inset, so we skip the whole feature there.
export function supportsDesktopCompanion() {
    return !!(window.matchMedia &&
              window.matchMedia('(min-width: 1024px) and (pointer: fine)').matches);
}

function prefersReducedMotion() {
    return !!(window.matchMedia &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Factory — each call returns an independent controller. The typical app
// creates exactly one. Returns { cheer, setEnabled, isEnabled, destroy }.
export function createCompanion(doc) {
    doc = doc || document;

    let el        = null;
    let rafId     = null;
    let timerId   = null;
    let cheerId   = null;
    // Independent timer driving the periodic eye-blink. Lives alongside the
    // wander timer so a blink can fire (or be cancelled) without disturbing
    // the wander cadence.
    let blinkId   = null;
    let state     = 'IDLE';
    // Tracks the user-facing study request independent of `state`. When a
    // cheer is in flight, setStudying(true) defers — this flag holds the
    // intent so cheer's tail-end can transition into STUDYING rather than
    // back to IDLE.
    let studyPending = false;
    let curX      = 0;
    let curY      = 0;
    let tgtX      = 0;
    let tgtY      = 0;
    // Per-walk pace, re-rolled each time pickTarget runs. Varying the speed
    // between walks is the cheapest source of unpredictable rhythm — a fixed
    // step rate reads as a constant treadmill.
    let stepSpeed = 0.5;

    function mount() {
        if (el) return;
        if (!supportsDesktopCompanion()) return;
        el = doc.createElement('div');
        el.id = 'companion';
        el.className = 'companion idle';
        el.setAttribute('aria-hidden', 'true');
        doc.body.appendChild(el);
        placeInitial();
        // Wander runs regardless of reduced-motion — the slow drift is mild
        // enough to read as ambient. Only the attention-grabby cheer pop is
        // gated by `prefersReducedMotion()` inside `cheer()`.
        scheduleWanderTick();
        scheduleBlink();
    }

    function destroy() {
        if (rafId)   { cancelAnimationFrame(rafId); rafId = null; }
        if (timerId) { clearTimeout(timerId); timerId = null; }
        if (cheerId) { clearTimeout(cheerId); cheerId = null; }
        if (blinkId) { clearTimeout(blinkId); blinkId = null; }
        if (el && el.parentNode) el.parentNode.removeChild(el);
        el = null;
        state = 'IDLE';
        studyPending = false;
    }

    // Right-edge footprint accounting — STUDYING widens the sprite to 64px to
    // accommodate the held book; every other state uses the base 48px body.
    function rightMargin() {
        return state === 'STUDYING' ? 64 : 48;
    }

    function placeInitial() {
        const vw = window.innerWidth  || 1024;
        const vh = window.innerHeight || 768;
        curX = Math.round(vw * 0.5);
        curY = vh - 96;
        applyTransform();
    }

    function applyTransform() {
        if (!el) return;
        el.style.left = curX + 'px';
        el.style.top  = curY + 'px';
    }

    function pickTarget() {
        const vw = window.innerWidth  || 1024;
        const vh = window.innerHeight || 768;
        const MARGIN_X = 40;
        const STRIP_TOP = Math.max(0, vh - 160);
        const STRIP_BOT = Math.max(STRIP_TOP + 32, vh - 48);
        // Short hops from the current X — up to ~30% of the viewport width
        // in either direction — so the ghost meanders back and forth rather
        // than crossing the screen in one straight shot. Clamped to the
        // safe margin either way. The right margin grows for STUDYING so the
        // wider footprint doesn't clip past the viewport edge.
        const range    = vw * 0.3;
        const proposed = curX + (Math.random() * 2 - 1) * range;
        tgtX = Math.max(MARGIN_X, Math.min(vw - rightMargin(), proposed));
        tgtY = STRIP_TOP + Math.random() * (STRIP_BOT - STRIP_TOP);
        // Re-roll pace per walk: 1.5–3 px/frame at 60fps gives a brisk-but-
        // not-frantic stroll, with enough variation to read as natural rhythm.
        stepSpeed = 1.5 + Math.random() * 1.5;
    }

    // Short 0.5–2s pauses between hops. The ghost almost always walks when the
    // timer fires (vs the old 70/30 idle bias) — roaming is the default mode,
    // the pause just adds a natural breath between direction changes.
    function scheduleWanderTick() {
        if (!el) return;
        const delay = 500 + Math.random() * 1500;
        timerId = setTimeout(function() {
            timerId = null;
            if (!el) return;
            // STUDYING holds position — the wander loop must not pick a new
            // target until the user-facing state leaves STUDYING.
            if (state === 'CHEERING' || state === 'STUDYING') { scheduleWanderTick(); return; }
            startWalking();
        }, delay);
    }

    function startWalking() {
        pickTarget();
        setState('WALKING');
        stepWalk();
    }

    function stepWalk() {
        if (!el) return;
        const dx = tgtX - curX;
        const dy = tgtY - curY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1.5) {
            setState('IDLE');
            scheduleWanderTick();
            return;
        }
        const speed = stepSpeed; // per-walk pace from pickTarget — varies each hop
        curX += (dx / dist) * speed;
        curY += (dy / dist) * speed;
        applyTransform();
        rafId = requestAnimationFrame(stepWalk);
    }

    // Public cheer — fires on item completion. The `big` flag drives a
    // longer, louder animation used when the last open item in a project
    // gets checked off.
    function cheer(big) {
        if (!el) return;
        // Reduced motion: skip the cheer pop/scale entirely. Wander keeps
        // running — its slow drift respects the preference's intent.
        if (prefersReducedMotion()) return;
        if (rafId)   { cancelAnimationFrame(rafId); rafId = null; }
        if (timerId) { clearTimeout(timerId); timerId = null; }
        if (cheerId) { clearTimeout(cheerId); cheerId = null; }
        setState('CHEERING');
        if (big) el.classList.add('big-cheer');
        else     el.classList.remove('big-cheer');
        const dur = big ? 1400 : 700;
        cheerId = setTimeout(function() {
            cheerId = null;
            if (!el) return;
            el.classList.remove('big-cheer');
            // A study request received mid-cheer is deferred until now so the
            // cheer animation completes uninterrupted. Land in STUDYING (which
            // suspends wander itself) instead of IDLE when it's pending.
            if (studyPending) {
                setState('STUDYING');
                return;
            }
            setState('IDLE');
            scheduleWanderTick();
        }, dur);
    }

    function setState(next) {
        state = next;
        if (!el) return;
        el.classList.remove('idle', 'walking', 'cheering', 'studying');
        el.classList.add(next.toLowerCase());
        // Blinks run through IDLE and WALKING (the 120ms transform squish
        // doesn't conflict with the position lerp). CHEERING blocks them
        // because its scale/translate keyframes would fight the blink frame.
        // STUDYING also blocks them so the focused-study read stays clean.
        if (next === 'CHEERING' || next === 'STUDYING') cancelBlink();
        else                                             scheduleBlink();
    }

    // Public study toggle — drives the visual focus state when the host
    // pomodoro timer is RUNNING. STUDYING suspends wander timers but keeps
    // the idle bob (no `.idle` class, but the same `companionIdle` keyframe
    // is layered onto `.studying` in CSS). Calling while a cheer is in
    // flight defers the transition until the cheer resolves.
    function setStudying(active) {
        const want = !!active;
        if (!el) { studyPending = want; return; }
        if (state === 'CHEERING') {
            // Don't disrupt an in-progress cheer — defer the request and let
            // the cheer's tail-end pick it up.
            studyPending = want;
            return;
        }
        studyPending = want;
        if (want) {
            if (state === 'STUDYING') return;
            // Suspend wander timers — the ghost holds position while studying.
            if (rafId)   { cancelAnimationFrame(rafId); rafId = null; }
            if (timerId) { clearTimeout(timerId); timerId = null; }
            setState('STUDYING');
            return;
        }
        // Leaving STUDYING — resume wander from the current resting spot.
        if (state !== 'STUDYING') return;
        setState('IDLE');
        scheduleWanderTick();
    }

    // Random ~3–6s gap between blinks with a brief ~120ms closed-eye frame.
    // The 120ms is short enough to read as a natural blink instead of a wink.
    function scheduleBlink() {
        if (!el) return;
        if (blinkId) return;
        const delay = 3000 + Math.random() * 3000;
        blinkId = setTimeout(function blinkOpen() {
            blinkId = null;
            if (!el) return;
            // Re-check at fire time — a cheer may have raced ahead of
            // cancelBlink. IDLE/WALKING are both fine to blink in.
            if (state === 'CHEERING') return;
            el.classList.add('blinking');
            blinkId = setTimeout(function blinkClose() {
                blinkId = null;
                if (!el) return;
                el.classList.remove('blinking');
                scheduleBlink();
            }, 120);
        }, delay);
    }

    function cancelBlink() {
        if (blinkId) { clearTimeout(blinkId); blinkId = null; }
        if (el) el.classList.remove('blinking');
    }

    function setEnabled(v) {
        setCompanionEnabled(v);
        if (v) mount();
        else   destroy();
    }

    if (isCompanionEnabled()) mount();

    return {
        cheer:       cheer,
        setStudying: setStudying,
        setEnabled:  setEnabled,
        isEnabled:   isCompanionEnabled,
        destroy:     destroy,
    };
}


// ── MODULE-LEVEL SINGLETON ──
// Centralised access to the desktop companion. Callers (toDoRow.js for cheer
// on completion, main.js for the nav-bar toggle) used to thread an
// `ensureCompanion` helper through a deps bag; consolidating it here removes
// the bag and gives every importer the same lazily-created instance. Stays
// null when the pref is off or the viewport doesn't qualify, so callers must
// null-guard before invoking the returned controller.
let _companionSingleton = null;

export function ensureCompanion() {
    if (_companionSingleton) return _companionSingleton;
    if (!isCompanionEnabled()) return null;
    if (!supportsDesktopCompanion()) return null;
    _companionSingleton = createCompanion(document);
    return _companionSingleton;
}

export function destroyCompanion() {
    if (_companionSingleton) {
        _companionSingleton.destroy();
        _companionSingleton = null;
    }
}