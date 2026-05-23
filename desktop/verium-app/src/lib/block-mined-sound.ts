import {
  getSharedAudioContext,
  unlockSharedWebAudio,
} from "@/lib/web-audio";

/** Pleasant three-note chime when you find a block (Web Audio — no asset file). */

/** Call after user gesture so autoplay policies allow sound later. */
export async function unlockBlockMinedAudio(): Promise<void> {
  await unlockSharedWebAudio();
}

export async function playBlockMinedSound(): Promise<void> {
  const ctx = getSharedAudioContext();
  if (!ctx) return;

  try {
    await unlockSharedWebAudio();
    if (ctx.state !== "running") return;

    const now = ctx.currentTime;
    const notes = [523.25, 659.25, 783.99]; // C5 · E5 · G5

    for (let i = 0; i < notes.length; i += 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = notes[i]!;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const start = now + i * 0.11;
      const peak = 0.18 - i * 0.03;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.06), start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.42);

      osc.start(start);
      osc.stop(start + 0.45);
    }
  } catch {
    // Ignore playback failures (muted, policy, etc.)
  }
}
