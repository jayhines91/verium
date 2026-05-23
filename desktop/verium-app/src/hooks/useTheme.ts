import { useCallback, useEffect } from "react";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  applyTheme,
  cacheThemeMode,
  readCachedThemeMode,
  resolveTheme,
  type ThemeMode,
} from "@/lib/theme";

/**
 * Keeps the document theme in sync with the persisted preference and the OS
 * `prefers-color-scheme` setting. Returns the current mode and a setter that
 * updates prefs, localStorage, and the document class together.
 */
export function useTheme() {
  const prefs = useUserPreferences((s) => s.prefs);
  const loaded = useUserPreferences((s) => s.loaded);
  const updatePrefs = useUserPreferences((s) => s.update);

  const mode: ThemeMode = prefs.theme_mode ?? "system";

  useEffect(() => {
    if (!loaded) return;
    applyTheme(resolveTheme(mode));
    cacheThemeMode(mode);
  }, [loaded, mode]);

  useEffect(() => {
    if (mode !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(resolveTheme("system"));
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [mode]);

  const setMode = useCallback(
    async (next: ThemeMode) => {
      cacheThemeMode(next);
      applyTheme(resolveTheme(next));
      await updatePrefs({ theme_mode: next });
    },
    [updatePrefs],
  );

  return { mode, setMode };
}

/**
 * One-shot: sync the document class with the cached localStorage value while
 * preferences are still loading. The boot script in public/theme-boot.js
 * already runs before React mounts, so this is only useful when called from
 * places that re-render before `loaded` flips true.
 */
export function syncThemeFromCache(): void {
  const cached = readCachedThemeMode() ?? "system";
  applyTheme(resolveTheme(cached));
}
