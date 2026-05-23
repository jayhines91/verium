import { invoke } from "@tauri-apps/api/core";

/**
 * Opens a URL in the user's default browser via the Tauri shell plugin.
 *
 * Frontend code must never call `window.open()` directly; routing everything
 * through this helper keeps the CSP strict and makes link behavior easy to
 * audit.
 */
export async function openExternal(url: string): Promise<void> {
  if (!url) return;
  await invoke<void>("open_external_url", { url });
}
