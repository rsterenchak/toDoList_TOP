// First-run welcome carousel for new mobile users.
//
// On a fresh install on a touch viewport the welcome flow seeds a
// "Getting started" sample project (via listLogic.seedSampleProject, the
// same seed used by the desktop coachmark) and runs a full-screen
// four-card carousel that orients the user on projects, the slide-out
// menu, and where the music and settings toggles live before dropping
// them into the seeded project. The cards live inside a single fixed-
// position container; horizontal navigation is a CSS translateX on the
// track. Forward/back uses the Next button or a horizontal swipe — the
// only dismissals are Escape and the Skip link in the corner. There is
// no backdrop click since the carousel fills the viewport.
//
// State survives between sessions only via the persisted onboarding flag
// in prefs.js (`todoapp_onboardingComplete`). Calling startWelcomeCarousel
// while one is already mounted is a no-op. Desktop is intentionally out of
// scope; maybeStartFirstRunCarousel bails on `(pointer: fine)` viewports
// or anything ≥ 768px wide so the desktop coachmark stays in charge there.

import { isOnboardingComplete, setOnboardingComplete } from './prefs.js';

export const CAROUSEL_BACKDROP_ID = 'welcomeCarouselBackdrop';
export const CAROUSEL_ID = 'welcomeCarousel';
export const CAROUSEL_SKIP_ID = 'welcomeCarouselSkip';
export const CAROUSEL_TRACK_ID = 'welcomeCarouselTrack';
export const CAROUSEL_NEXT_ID = 'welcomeCarouselNext';
export const CAROUSEL_TITLE_ID = 'welcomeCarouselTitle';

const MOBILE_MAX_WIDTH = 768;
const SWIPE_DISTANCE = 50;

// Each card renders the same shape: a centered illustration, a headline,
// one short paragraph of body copy. The illustration class names map to
// the existing ghost / icon SVGs in src/ (no new assets) so the cards
// stay visually consistent with the rest of the app.
const CARDS = [
    {
        id: 'welcome',
        illustration: 'ghost',
        title: 'Welcome to Void',
        body: "A calm place to keep your todos. Three quick cards and you're in.",
    },
    {
        id: 'projects',
        illustration: 'projects',
        title: 'Projects & todos',
        body: 'Tap the box to check a task off, tap the date pill to reschedule, and tap the ▾ chevron to expand notes.',
    },
    {
        id: 'menu',
        illustration: 'menu',
        title: 'Menu, music & settings',
        body: 'Open the ≡ menu in the top corner — your projects, focus music, and settings all live inside.',
    },
    {
        id: 'closer',
        illustration: 'sample',
        title: "You're set",
        body: "We've dropped you into a sample 'Getting started' project. Rename or delete it whenever you're ready.",
    },
];

let active = null;

export function getWelcomeCarouselCardCount() { return CARDS.length; }

// Detection: trigger on first load when (pointer: coarse) AND viewport
// width < 768px and the persisted flag isn't set. Falls back to a plain
// width check on environments without matchMedia (older jsdom, exotic
// embedded webviews) so test runs without a stubbed matchMedia still
// resolve a sensible result rather than throwing.
function isMobileCarouselViewport() {
    if (typeof window === 'undefined') return false;
    if (window.innerWidth >= MOBILE_MAX_WIDTH) return false;
    if (!window.matchMedia) return true;
    try {
        return window.matchMedia('(pointer: coarse)').matches;
    } catch (e) {
        return true;
    }
}

// Public entry point — called from index.js after restoreFromStorage so
// the seeded sample project is already in the DOM by the time the closer
// card drops the user into it. Defers to the persisted flag and the
// mobile detection so the carousel only runs on its intended path.
// Yields to the desktop coachmark when both would race in the narrow
// coarse-pointer tablet window — whoever mounted first wins.
export function maybeStartFirstRunCarousel() {
    if (isOnboardingComplete()) return false;
    if (!isMobileCarouselViewport()) return false;
    if (document.getElementById('coachmarkOverlay')) return false;
    startWelcomeCarousel();
    return true;
}

// Explicit trigger — used by the "Replay welcome carousel" menu item.
// Clears the persisted flag for the duration of the carousel so the
// dot-active state and finish() handling mirror the first-run path.
// Replay never re-seeds the sample project — that happens once per
// install, inside listLogic.seedSampleProject().
export function startWelcomeCarousel() {
    if (active) return;
    setOnboardingComplete(false);

    const backdrop = document.createElement('div');
    backdrop.id = CAROUSEL_BACKDROP_ID;
    backdrop.setAttribute('role', 'presentation');

    const container = document.createElement('div');
    container.id = CAROUSEL_ID;
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('aria-labelledby', CAROUSEL_TITLE_ID);

    const skip = document.createElement('button');
    skip.type = 'button';
    skip.id = CAROUSEL_SKIP_ID;
    skip.className = 'welcomeCarouselSkip';
    skip.textContent = 'Skip';
    skip.setAttribute('aria-label', 'Skip welcome carousel');
    skip.addEventListener('click', finish);

    const viewport = document.createElement('div');
    viewport.className = 'welcomeCarouselViewport';

    const track = document.createElement('div');
    track.id = CAROUSEL_TRACK_ID;
    track.className = 'welcomeCarouselTrack';

    CARDS.forEach(function(card, i) {
        const slide = document.createElement('section');
        slide.className = 'welcomeCarouselSlide';
        slide.setAttribute('data-card', card.id);
        slide.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');

        const illustration = document.createElement('div');
        illustration.className = 'welcomeCarouselIllustration welcomeCarouselIllustration--' + card.illustration;
        illustration.setAttribute('aria-hidden', 'true');

        const heading = document.createElement('h2');
        heading.className = 'welcomeCarouselTitle';
        if (i === 0) heading.id = CAROUSEL_TITLE_ID;
        heading.textContent = card.title;

        const body = document.createElement('p');
        body.className = 'welcomeCarouselBody';
        body.textContent = card.body;

        slide.appendChild(illustration);
        slide.appendChild(heading);
        slide.appendChild(body);
        track.appendChild(slide);
    });

    viewport.appendChild(track);

    const footer = document.createElement('div');
    footer.className = 'welcomeCarouselFooter';

    const dots = document.createElement('div');
    dots.className = 'welcomeCarouselDots';
    dots.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < CARDS.length; i++) {
        const dot = document.createElement('span');
        dot.className = 'welcomeCarouselDot' + (i === 0 ? ' active' : '');
        dots.appendChild(dot);
    }

    const next = document.createElement('button');
    next.type = 'button';
    next.id = CAROUSEL_NEXT_ID;
    next.className = 'welcomeCarouselNext';
    next.textContent = CARDS.length > 1 ? 'Next ›' : "Let's go";
    next.addEventListener('click', advance);

    footer.appendChild(dots);
    footer.appendChild(next);

    container.appendChild(skip);
    container.appendChild(viewport);
    container.appendChild(footer);
    backdrop.appendChild(container);
    document.body.appendChild(backdrop);

    active = {
        index: 0,
        backdrop,
        container,
        track,
        dots,
        next,
        touchStartX: null,
        touchStartY: null,
        touchActive: false,
    };

    document.addEventListener('keydown', onKeydown, true);
    track.addEventListener('touchstart', onTouchStart, { passive: true });
    track.addEventListener('touchmove', onTouchMove, { passive: true });
    track.addEventListener('touchend', onTouchEnd);
    track.addEventListener('touchcancel', onTouchCancel);

    renderStep();
    next.focus();
}

function renderStep() {
    if (!active) return;
    active.track.style.transform = 'translateX(-' + (active.index * 100) + '%)';

    const dots = active.dots.children;
    for (let i = 0; i < dots.length; i++) {
        dots[i].classList.toggle('active', i === active.index);
    }

    const slides = active.track.children;
    for (let i = 0; i < slides.length; i++) {
        slides[i].setAttribute('aria-hidden', i === active.index ? 'false' : 'true');
    }

    active.next.textContent = active.index === CARDS.length - 1 ? "Let's go" : 'Next ›';
}

function advance() {
    if (!active) return;
    if (active.index >= CARDS.length - 1) {
        finish();
        return;
    }
    active.index += 1;
    renderStep();
}

function retreat() {
    if (!active) return;
    if (active.index <= 0) return;
    active.index -= 1;
    renderStep();
}

function onKeydown(event) {
    if (!active) return;
    if (event.key === 'Escape') {
        event.stopPropagation();
        finish();
    }
}

function onTouchStart(event) {
    if (!active) return;
    if (!event.touches || event.touches.length !== 1) return;
    active.touchStartX = event.touches[0].clientX;
    active.touchStartY = event.touches[0].clientY;
    active.touchActive = true;
}

function onTouchMove(event) {
    // Reserved for live transform follow-along if we want it later;
    // currently a no-op since the snap-on-end gesture is sufficient for
    // a four-card flow and avoids a flicker if the user changes their
    // mind mid-swipe.
    if (!active || !active.touchActive) return;
    if (!event.touches || event.touches.length !== 1) return;
}

function onTouchEnd(event) {
    if (!active) return;
    if (!active.touchActive) return;
    active.touchActive = false;
    const touch = event.changedTouches && event.changedTouches[0];
    const startX = active.touchStartX;
    const startY = active.touchStartY;
    active.touchStartX = null;
    active.touchStartY = null;
    if (!touch || startX === null || startY === null) return;

    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    // Treat as a swipe only when horizontal motion dominates and crosses
    // the threshold — small taps or vertical scroll-ish gestures do not
    // page the carousel.
    if (Math.abs(dx) < SWIPE_DISTANCE) return;
    if (Math.abs(dx) <= Math.abs(dy)) return;
    if (dx < 0) advance();
    else retreat();
}

function onTouchCancel() {
    if (!active) return;
    active.touchActive = false;
    active.touchStartX = null;
    active.touchStartY = null;
}

function finish() {
    if (!active) return;
    document.removeEventListener('keydown', onKeydown, true);
    if (active.track) {
        active.track.removeEventListener('touchstart', onTouchStart);
        active.track.removeEventListener('touchmove', onTouchMove);
        active.track.removeEventListener('touchend', onTouchEnd);
        active.track.removeEventListener('touchcancel', onTouchCancel);
    }
    if (active.backdrop && active.backdrop.parentNode) {
        active.backdrop.parentNode.removeChild(active.backdrop);
    }
    active = null;
    setOnboardingComplete(true);
}
