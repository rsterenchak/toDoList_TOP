// Desktop-only ghost companion. Lives in the bottom strip of the viewport,
// drifts between idle and walking on a slow random timer, and cheers when
// the host app calls `cheer()` on a todo completion. The companion holds no
// app state and has no side effects beyond its own DOM elements. When
// disabled (or on non-qualifying viewports) they are never created, so no
// timers or paint work are incurred. The ghost sprite itself is declared in
// style.css (background-image on .companion) so this module stays
// asset-import-free and testable.
//
// The sprite is also a tap target: hovering freezes the wander loop in place
// and clicking emits an "activate" event. That activation is the ghost's only
// door on desktop — main.js listens for it and flips the Claude pane into (and
// back out of) the ghost's identity. Pointer handling lives on a slightly
// larger `.companionHit` wrapper rather than on `.companion` itself, so the
// sprite keeps its `pointer-events: none` and never intercepts a click meant
// for the app chrome it happens to be drifting over.
//
// While the ghost wears the pane the sprite parks on it: `dock()` glides it to
// the pane's rim and holds it there, `release()` hands it back to the wander
// from wherever it was left. Both are driven from outside — this module knows
// nothing about possession beyond the element it is asked to perch on.

const STORAGE_KEY = 'todoapp_companion_enabled';

// Sprite box, mirrored from the `.companion` rule in style.css. Used as the
// fallback when offsetWidth/offsetHeight read 0 (no layout engine under test)
// so `getPosition()` always hands the talk surface a usable box.
const SPRITE_W = 48;
const SPRITE_H = 56;
// The hit wrapper is inset by this much on every side, giving the pointer a
// forgiving margin around a sprite that is constantly drifting.
const HIT_PAD = 10;

// Where the sprite parks while it is docked: straddling the target's left rim
// (half the sprite hangs over it) and this far below its top edge, so the ghost
// reads as perched ON the pane rather than standing beside it.
const DOCK_TOP_INSET = 18;
// Glide pace toward the dock point: a fixed fraction of the remaining distance
// with a floor under it, so a long trip eases in and a short one still arrives.
const DOCK_EASE = 0.14;
const DOCK_MIN_SPEED = 2;

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

export function prefersReducedMotion() {
    return !!(window.matchMedia &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// ── SPRITE ACTIVATION ──
// Module-level rather than per-controller on purpose: the companion is torn
// down and rebuilt whenever the user toggles the floating ghost off and on,
// so a subscription held against one controller instance would silently go
// dead after the first toggle. Subscribers register once and keep receiving
// activations from whichever controller is currently mounted.
const activateHandlers = [];

export function onCompanionActivate(handler) {
    if (typeof handler !== 'function') return function () {};
    activateHandlers.push(handler);
    return function () {
        const i = activateHandlers.indexOf(handler);
        if (i >= 0) activateHandlers.splice(i, 1);
    };
}

function emitActivate(api) {
    activateHandlers.slice().forEach(function (handler) {
        try { handler(api); } catch (e) { /* a bad subscriber never breaks the sprite */ }
    });
}

// Factory — each call returns an independent controller. The typical app
// creates exactly one. Returns { cheer, setEnabled, isEnabled, destroy } plus
// the sprite API the talk surface needs — see `spriteApi` below.
export function createCompanion(doc) {
    doc = doc || document;

    let el        = null;
    // Transparent pointer target tracking the sprite. Separate element so the
    // sprite itself stays pointer-events: none.
    let hitEl     = null;
    // Wander paused in place (pointer is over the sprite, or the ghost is
    // docked). Position is never reset while frozen, so resuming continues from
    // where the ghost stopped rather than teleporting.
    let frozen    = false;
    // Something outside is holding the ghost still — today, possession holding
    // it on its perch. mouseleave must NOT resume while it is set, or the ghost
    // would walk off the pane it is supposed to be sitting on.
    let talkOpen  = false;
    let rafId     = null;
    let timerId   = null;
    let cheerId   = null;
    // Independent timer driving the periodic eye-blink. Lives alongside the
    // wander timer so a blink can fire (or be cancelled) without disturbing
    // the wander cadence.
    let blinkId   = null;
    let state     = 'IDLE';
    let curX      = 0;
    let curY      = 0;
    let tgtX      = 0;
    let tgtY      = 0;
    // Per-walk pace, re-rolled each time pickTarget runs. Varying the speed
    // between walks is the cheapest source of unpredictable rhythm — a fixed
    // step rate reads as a constant treadmill.
    let stepSpeed = 0.5;
    // The element the sprite is perched on, or null when it is free to wander.
    // Held rather than reduced to a boolean because the rim has to be
    // re-measured whenever the window resizes under a docked ghost.
    let dockEl    = null;
    let dockRafId = null;
    let dockResize = null;
    let dockTgtX  = 0;
    let dockTgtY  = 0;

    function mount() {
        if (el) return;
        if (!supportsDesktopCompanion()) return;
        el = doc.createElement('div');
        el.id = 'companion';
        el.className = 'companion idle';
        el.setAttribute('aria-hidden', 'true');
        doc.body.appendChild(el);
        mountHit();
        placeInitial();
        // Wander runs regardless of reduced-motion — the slow drift is mild
        // enough to read as ambient. Only the attention-grabby cheer pop is
        // gated by `prefersReducedMotion()` inside `cheer()`.
        scheduleWanderTick();
        scheduleBlink();
    }

    // The pointer target. It rides one layer under the sprite's z-index so a
    // click lands on it rather than on whatever the ghost is drifting over,
    // and stays aria-hidden like the sprite — it is a decorative mascot, not
    // a control in the tab order.
    function mountHit() {
        if (hitEl) return;
        hitEl = doc.createElement('div');
        hitEl.id = 'companionHit';
        hitEl.className = 'companionHit';
        hitEl.setAttribute('aria-hidden', 'true');
        hitEl.addEventListener('mouseenter', onHitEnter);
        hitEl.addEventListener('mouseleave', onHitLeave);
        hitEl.addEventListener('click', onHitClick);
        doc.body.appendChild(hitEl);
    }

    function onHitEnter() {
        freeze();
    }

    function onHitLeave() {
        // The talk surface owns the freeze while it is open; releasing it here
        // would let the ghost wander away from its own bubble.
        if (talkOpen) return;
        resume();
    }

    function onHitClick() {
        if (!el) return;
        // Hold the ghost still for whatever the activation opens. A subscriber
        // that declines to open anything leaves `talkOpen` false, so the next
        // mouseleave resumes the wander as usual.
        freeze();
        emitActivate(spriteApi);
    }

    function destroy() {
        if (rafId)   { cancelAnimationFrame(rafId); rafId = null; }
        if (timerId) { clearTimeout(timerId); timerId = null; }
        if (cheerId) { clearTimeout(cheerId); cheerId = null; }
        if (blinkId) { clearTimeout(blinkId); blinkId = null; }
        // A destroy mid-dock takes the perch with it: the glide and the resize
        // listener would otherwise outlive the sprite they were placing.
        stopDockGlide();
        forgetDock();
        if (el && el.parentNode) el.parentNode.removeChild(el);
        if (hitEl) {
            hitEl.removeEventListener('mouseenter', onHitEnter);
            hitEl.removeEventListener('mouseleave', onHitLeave);
            hitEl.removeEventListener('click', onHitClick);
            if (hitEl.parentNode) hitEl.parentNode.removeChild(hitEl);
            hitEl = null;
        }
        el = null;
        frozen = false;
        talkOpen = false;
        state = 'IDLE';
    }

    // ── FREEZE / RESUME ──
    // The explicit contract the talk surface drives. Freezing cancels the
    // in-flight walk and the pending hop timer but leaves curX/curY alone;
    // resuming just re-arms the hop timer, so the next target is picked
    // relative to the frozen position.
    function freeze() {
        if (!el || frozen) return;
        frozen = true;
        if (rafId)   { cancelAnimationFrame(rafId); rafId = null; }
        if (timerId) { clearTimeout(timerId); timerId = null; }
        if (state === 'WALKING') setState('IDLE');
    }

    function resume() {
        if (!frozen) return;
        frozen = false;
        if (!el) return;
        // A cheer in flight re-arms the wander itself when it settles.
        if (state === 'CHEERING') return;
        setState('IDLE');
        scheduleWanderTick();
    }

    function isFrozen() {
        return frozen;
    }

    function setTalkOpen(open) {
        talkOpen = !!open;
    }

    // ── DOCK / RELEASE ──
    // Possession's half of the freeze contract. `dock` parks the ghost on the
    // rim of the element it is given and claims the still-state for as long as
    // it sits there — the same hold a hover takes, so a mouseleave can't walk
    // the ghost off its perch. `release` gives the wander back from wherever
    // the sprite ended up; nothing here ever teleports it.
    //
    // Both are idempotent enough to be driven straight off a state event: a
    // second dock re-measures, and a release with nothing docked is a no-op.
    function dock(target) {
        if (!el || !target) return;
        dockEl = target;
        setTalkOpen(true);
        freeze();
        if (!dockResize) {
            // A resize moves the rim out from under the sprite, so re-measure
            // for as long as it is docked. Placement is instant here rather
            // than a second glide — the layout has already jumped, and a ghost
            // gliding after it would read as lag.
            dockResize = function() { if (dockEl) placeAtDock(); };
            window.addEventListener('resize', dockResize);
        }
        glideToDock();
    }

    function release() {
        if (!dockEl) return;
        stopDockGlide();
        forgetDock();
        setTalkOpen(false);
        resume();
    }

    function isDocked() {
        return !!dockEl;
    }

    function forgetDock() {
        dockEl = null;
        if (dockResize) {
            window.removeEventListener('resize', dockResize);
            dockResize = null;
        }
    }

    // The perch in viewport coordinates, or null when the target can't be
    // measured. Clamped to the viewport so a pane hanging off-screen still
    // leaves the ghost somewhere a user can see (and click) it.
    function dockPoint() {
        if (!dockEl || typeof dockEl.getBoundingClientRect !== 'function') return null;
        const rect = dockEl.getBoundingClientRect();
        const w  = (el && el.offsetWidth)  || SPRITE_W;
        const h  = (el && el.offsetHeight) || SPRITE_H;
        const vw = window.innerWidth  || 1024;
        const vh = window.innerHeight || 768;
        return {
            x: Math.max(0, Math.min(vw - w, rect.left - w / 2)),
            y: Math.max(0, Math.min(vh - h, rect.top + DOCK_TOP_INSET)),
        };
    }

    function placeAtDock() {
        const p = dockPoint();
        if (!p) return;
        stopDockGlide();
        curX = p.x;
        curY = p.y;
        applyTransform();
    }

    // Reduced motion places the sprite outright. Everything else walks it over,
    // so the move reads as the ghost drifting to its perch rather than cutting
    // to it. The glide runs on its own rAF: the wander is frozen by now, and
    // borrowing its loop would resume it the moment the walk finished.
    function glideToDock() {
        const p = dockPoint();
        if (!p) return;
        if (prefersReducedMotion()) { placeAtDock(); return; }
        dockTgtX = p.x;
        dockTgtY = p.y;
        stopDockGlide();
        stepDock();
    }

    function stepDock() {
        dockRafId = null;
        if (!el || !dockEl) return;
        const dx = dockTgtX - curX;
        const dy = dockTgtY - curY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1.5) {
            curX = dockTgtX;
            curY = dockTgtY;
            applyTransform();
            return;
        }
        const speed = Math.max(DOCK_MIN_SPEED, dist * DOCK_EASE);
        curX += (dx / dist) * speed;
        curY += (dy / dist) * speed;
        applyTransform();
        dockRafId = requestAnimationFrame(stepDock);
    }

    function stopDockGlide() {
        if (dockRafId) { cancelAnimationFrame(dockRafId); dockRafId = null; }
    }

    // Current sprite box in viewport coordinates. Returns null when the
    // companion is not mounted so callers can bail without guessing.
    function getPosition() {
        if (!el) return null;
        return {
            x:      curX,
            y:      curY,
            width:  el.offsetWidth  || SPRITE_W,
            height: el.offsetHeight || SPRITE_H,
        };
    }

    // The narrow surface handed to activation subscribers — position plus
    // freeze controls, and nothing that reaches into the wander internals.
    const spriteApi = {
        getPosition: getPosition,
        freeze:      freeze,
        resume:      resume,
        isFrozen:    isFrozen,
        setTalkOpen: setTalkOpen,
    };

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
        if (hitEl) {
            // Same box as the sprite, grown by HIT_PAD on every side.
            hitEl.style.left = (curX - HIT_PAD) + 'px';
            hitEl.style.top  = (curY - HIT_PAD) + 'px';
        }
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
        if (!el || frozen) return;
        if (timerId) return;
        const delay = 500 + Math.random() * 1500;
        timerId = setTimeout(function() {
            timerId = null;
            if (!el || frozen) return;
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
        if (!el || frozen) return;
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
            // A cheer that lands mid-freeze parks in place; resume() re-arms
            // the wander when the pointer (or the talk surface) lets go.
            if (!frozen) scheduleWanderTick();
        }, dur);
    }

    function setState(next) {
        state = next;
        if (!el) return;
        el.classList.remove('idle', 'walking', 'cheering');
        el.classList.add(next.toLowerCase());
        // Blinks run through IDLE and WALKING (the 120ms transform squish
        // doesn't conflict with the position lerp). Only CHEERING blocks
        // them — its scale/translate keyframes would fight the blink frame.
        if (next === 'CHEERING') cancelBlink();
        else                     scheduleBlink();
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
        setEnabled:  setEnabled,
        isEnabled:   isCompanionEnabled,
        destroy:     destroy,
        // Sprite API — also handed to activation subscribers directly.
        getPosition: getPosition,
        freeze:      freeze,
        resume:      resume,
        isFrozen:    isFrozen,
        setTalkOpen: setTalkOpen,
        // Perch controls, driven by whoever owns the state the perch reflects.
        dock:        dock,
        release:     release,
        isDocked:    isDocked,
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