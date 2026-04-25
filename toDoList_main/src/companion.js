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
    let state     = 'IDLE';
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
    }

    function destroy() {
        if (rafId)   { cancelAnimationFrame(rafId); rafId = null; }
        if (timerId) { clearTimeout(timerId); timerId = null; }
        if (cheerId) { clearTimeout(cheerId); cheerId = null; }
        if (el && el.parentNode) el.parentNode.removeChild(el);
        el = null;
        state = 'IDLE';
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
        // safe margin either way.
        const range    = vw * 0.3;
        const proposed = curX + (Math.random() * 2 - 1) * range;
        tgtX = Math.max(MARGIN_X, Math.min(vw - MARGIN_X, proposed));
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
            if (state === 'CHEERING') { scheduleWanderTick(); return; }
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
            setState('IDLE');
            scheduleWanderTick();
        }, dur);
    }

    function setState(next) {
        state = next;
        if (!el) return;
        el.classList.remove('idle', 'walking', 'cheering');
        el.classList.add(next.toLowerCase());
    }

    function setEnabled(v) {
        setCompanionEnabled(v);
        if (v) mount();
        else   destroy();
    }

    if (isCompanionEnabled()) mount();

    return {
        cheer:      cheer,
        setEnabled: setEnabled,
        isEnabled:  isCompanionEnabled,
        destroy:    destroy,
    };
}
