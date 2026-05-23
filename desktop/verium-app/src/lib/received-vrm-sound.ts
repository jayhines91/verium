import {
  getSharedAudioContext,
  unlockSharedWebAudio,
} from "@/lib/web-audio";

/** Soft two-note chime for incoming VRM (Web Audio — no asset file). */

export async function unlockReceivedVrmAudio(): Promise<void> {
  await unlockSharedWebAudio();
}

export async function playReceivedVrmSound(): Promise<void> {
  const ctx = getSharedAudioContext();
  if (!ctx) return;

  try {
    await unlockSharedWebAudio();
    if (ctx.state !== "running") return;

    const now = ctx.currentTime;
    const notes = [440, 554.37]; // A4 · C#5

    for (let i = 0; i < notes.length; i += 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = notes[i]!;
      osc.connect(gain);
      gain.connect(ctx.destination);

      const start = now + i * 0.08;
      const peak = 0.12 - i * 0.02;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.04), start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);

      osc.start(start);
      osc.stop(start + 0.3);
    }
  } catch {
    // Ignore playback failures (muted, policy, etc.)
  }
}
