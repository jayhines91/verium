import { useEffect } from "react";
import { playBlockMinedSound } from "@/lib/block-mined-sound";
import { useUserPreferences } from "@/lib/user-preferences";
import { subscribeBlockMined } from "@/hooks/useBlockMinedWatcher";

/** Plays the block-found chime when the user preference is enabled. */
export function useBlockMinedSound(): void {
  const enabled = useUserPreferences(
    (s) => s.prefs.play_sound_on_block_mined === true,
  );

  useEffect(() => {
    if (!enabled) return;
    return subscribeBlockMined(() => {
      void playBlockMinedSound();
    });
  }, [enabled]);
}
