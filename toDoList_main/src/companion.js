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

    function mount() {
        if (el) return;
        if (!supportsDesktopCompanion()) return;
        el = doc.createElement('div');
        el.id = 'companion';
        el.className = 'companion idle';
        el.setAttribute('aria-hidden', 'true');
        doc.body.appendChild(el);
        placeInitial();
        // Reduced motion: render static, no wander, no cheer animations.
        // The cheer() call is still safe to invoke — it no-ops out visually.
        if (!prefersReducedMotion()) {
            scheduleWanderTick();
        }
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
        tgtX = MARGIN_X + Math.random() * Math.max(1, vw - MARGIN_X * 2);
        tgtY = STRIP_TOP + Math.random() * (STRIP_BOT - STRIP_TOP);
    }

    // 20–120s cadence between wander decisions, weighted ~70% idle so the
    // ghost mostly stands still rather than pacing constantly.
    function scheduleWanderTick() {
        if (!el) return;
        const delay = 20000 + Math.random() * 100000;
        timerId = setTimeout(function() {
            timerId = null;
            if (!el) return;
            if (state === 'CHEERING') { scheduleWanderTick(); return; }
            if (Math.random() < 0.3) startWalking();
            else scheduleWanderTick();
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
        const speed = 0.6; // px per frame — slow, ambient pace
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
            if (!prefersReducedMotion()) scheduleWanderTick();
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
