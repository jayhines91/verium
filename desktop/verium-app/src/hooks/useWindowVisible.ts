import { useSyncExternalStore } from "react";

/**
 * App-wide "should display polling be running" signal.
 *
 * Display-only polling subscribes to this so it can wind down when the wallet
 * is not actually being used, without ever looking "stuck" to an active user.
 * The rule is:
 *
 *   active = NOT minimized/hidden  AND  user interacted within INACTIVITY_LIMIT
 *
 * - While the window is visible and the user is interacting (mouse, keyboard,
 *   scroll, touch) at least once every 30 minutes, polling keeps running.
 * - After 30 minutes of no interaction, display polling pauses to stay light;
 *   it resumes instantly on the next interaction.
 * - When the window is minimized/hidden it pauses immediately (the user cannot
 *   see it anyway).
 *
 * Exactly one set of DOM listeners + one timer is attached for the whole app
 * regardless of how many components consume the hook, so this never
 * accumulates listeners over a long session.
 *
 * IMPORTANT: background watchers that drive the mined/received chimes and OS
 * notifications must NOT gate on this — they keep running while paused/hidden.
 */

/** Pause display polling after this much continuous user inactivity. */
const INACTIVITY_LIMIT_MS = 30 * 60_000;
/** How often to re-check whether the inactivity threshold has been crossed. */
const INACTIVITY_CHECK_MS = 60_000;

let lastActivityAt = Date.now();
let active = computeActive();
const listeners = new Set<() => void>();
let initialized = false;

function isHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function computeActive(): boolean {
  if (typeof document === "undefined") return true;
  if (isHidden()) return false;
  return Date.now() - lastActivityAt < INACTIVITY_LIMIT_MS;
}

function notify(): void {
  for (const listener of listeners) listener();
}

function recompute(): void {
  const next = computeActive();
  if (next === active) return;
  active = next;
  notify();
}

function markActivity(): void {
  lastActivityAt = Date.now();
  // Cheap fast path: while already active, repeated activity only refreshes the
  // timestamp and must not trigger re-renders. Only a paused->resumed (or
  // hidden->visible) transition notifies subscribers.
  if (!active && !isHidden()) {
    active = true;
    notify();
  }
}

function onVisibilityChange(): void {
  if (isHidden()) {
    if (active) {
      active = false;
      notify();
    }
  } else {
    // Returning to the window counts as activity and resumes polling.
    markActivity();
  }
}

function ensureInitialized(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  document.addEventListener("visibilitychange", onVisibilityChange);

  // Passive activity listeners — work is a timestamp write plus, only on a
  // paused->resumed transition, a single notify().
  const opts: AddEventListenerOptions = { passive: true };
  window.addEventListener("pointerdown", markActivity, opts);
  window.addEventListener("pointermove", markActivity, opts);
  window.addEventListener("keydown", markActivity, opts);
  window.addEventListener("wheel", markActivity, opts);
  window.addEventListener("touchstart", markActivity, opts);
  window.addEventListener("scroll", markActivity, opts);

  // Single low-frequency timer flips us to inactive once the threshold passes.
  window.setInterval(recompute, INACTIVITY_CHECK_MS);
}

function subscribe(listener: () => void): () => void {
  ensureInitialized();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return active;
}

/**
 * True when display polling should run: the window is visible and the user has
 * interacted within the last 30 minutes.
 */
export function useWindowVisible(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true);
}

/**
 * Helper for React Query: returns `ms` while active, otherwise `false` to pause
 * the interval. Use for display-only queries.
 */
export function useVisibleRefetchInterval(ms: number): number | false {
  return useWindowVisible() ? ms : false;
}
