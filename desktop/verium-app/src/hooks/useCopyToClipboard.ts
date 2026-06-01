import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_RESET_MS = 2000;

/** Copy text to the clipboard and briefly expose a `copied` flag for UI feedback. */
export function useCopyToClipboard(resetMs = DEFAULT_RESET_MS) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setCopied(false);
  }, []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        if (timerRef.current != null) {
          window.clearTimeout(timerRef.current);
        }
        setCopied(true);
        timerRef.current = window.setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, resetMs);
        return true;
      } catch {
        setCopied(false);
        return false;
      }
    },
    [resetMs],
  );

  useEffect(() => () => reset(), [reset]);

  return { copied, copy, reset };
}
