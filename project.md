# Project

<!-- SYNTHETIC — written to exercise the Coverage tab and the project-derive
     pass. Sized so each goal is roughly one entry's work, and deliberately
     UI-first so the Surfaces section carries real weight. -->

## Overview

A practice log for guitar. I practise most days, usually for twenty minutes,
usually on my phone propped against something, and I never remember what I
worked on last time or how long it's been since I touched a particular piece.

Paper notebooks don't survive contact with a guitar case. Existing apps are
either metronome-first or built around courses I'm not taking.

The thing I actually want is small: start a session, tag what I worked on, stop,
and later be able to see what I've been neglecting.

## Goals

- Starting a session takes one tap from the app opening — no setup, no choosing
  anything first. Tagging what I worked on happens during or after, never before.
- A session survives the screen locking, the app backgrounding, and the browser
  being killed. Losing forty minutes because iOS reclaimed the tab is the failure
  that would make me stop using it.
- I can see at a glance which pieces I have not touched recently, because that is
  the question I actually have and the one a chronological list answers worst.
- Works with no network. Practice happens in a basement with no signal.
- Usable one-handed while holding a guitar. Every primary action reachable with a
  thumb, nothing requiring precision.

## Surfaces

- **Session screen** — the default view. A large start control, the running
  elapsed time once active, and a stop control. Nothing else competes with it.
  As in `docs/mockups/session-screen.html`.
- **Tag sheet** — slides up after stopping. The pieces worked on, chosen from
  recent ones or typed fresh. Skippable; an untagged session still counts.
- **Neglect list** — pieces ordered by how long since they were last practised,
  longest first. The app's actual answer to "what should I work on".
- **History** — sessions in reverse order, date and duration and tags. Deliberately
  plain; it exists so nothing feels lost, not to be browsed.
- **Piece detail** — one piece's total time, last practised, and its sessions.
  Reached from the neglect list or from a tag.

## Look and feel

Dark, high contrast, large touch targets — it gets used in a dim room at arm's
length. One accent colour, used only for the active session state, so "am I
recording" is answerable from across the room.

Type large enough to read without leaning in. No decorative chrome; a session
screen that is mostly empty space is correct.

## Constraints

- Offline-first. Every surface must work with no network; sync, if it ever
  exists, is additive and never a precondition.
- Local storage only for now. No account, no server, no login wall between
  opening the app and starting a session.
- The elapsed timer must be derived from a stored start timestamp rather than an
  interval counter, so a backgrounded tab resumes correctly instead of losing
  time.
- Mobile web, installable. Not a native app.

## Out of scope

- **A metronome or tuner.** Every other app has them; I have a physical one and a
  clip-on tuner, and adding them makes this a different product.
- **Goals, streaks, or targets.** Deliberately not motivational. A day missed
  should cost nothing, because the guilt mechanic is why I stopped using the last
  three of these.
- **Audio recording.** Storage, permissions, and playback UI for something I would
  never listen back to.
- **Sheet music or tab.** I read from a stand or a separate app; duplicating that
  is a project of its own.
- **Multi-instrument support.** Guitar only. Generalising the model before there
  is a second instrument is speculative work.
- **Sharing or social anything.** No.