import { useEffect } from "react";

let sharedContext: AudioContext | null = null;

/** Shared AudioContext for in-app chimes (block found, incoming VRM). */
export function getSharedAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedContext || sharedContext.state === "closed") {
    sharedContext = new AudioContext();
  }
  return sharedContext;
}

/** Resume context and run a silent graph so WebKit/WebView2 allow later playback. */
export async function resumeWebAudioContext(ctx: AudioContext): Promise<boolean> {
  try {
    if (ctx.state === "closed") return false;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      if (ctx.state === "running") break;
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 50);
      });
    }
    if (ctx.state !== "running") return false;

    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start();
    source.stop(ctx.currentTime + 0.01);
    return true;
  } catch {
    return false;
  }
}

/** Call during a user gesture so autoplay policies allow chimes later. */
export async function unlockSharedWebAudio(): Promise<void> {
  const ctx = getSharedAudioContext();
  if (!ctx) return;
  await resumeWebAudioContext(ctx);
}

/**
 * Keeps trying to unlock Web Audio on user gestures until prefs no longer need it.
 * Required for bundled WebViews where AudioContext starts suspended.
 */
export function useWebAudioGestureUnlock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const onGesture = () => {
      void unlockSharedWebAudio();
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void unlockSharedWebAudio();
      }
    };

    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    window.addEventListener("focus", onGesture, true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      window.removeEventListener("focus", onGesture, true);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);
}
