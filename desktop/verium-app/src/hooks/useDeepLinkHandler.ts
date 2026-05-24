import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { CoinId } from "@/lib/coin/profile";
import { parsePaymentUri } from "@/lib/security/client";
import { setPendingPaymentUri } from "@/lib/payment-uri-pending";

function coinFromScheme(scheme: string): CoinId | null {
  if (scheme === "verium") return "verium";
  if (scheme === "vericoin") return "vericoin";
  return null;
}

async function handleUrls(urls: string[], navigate: (path: string) => void) {
  for (const raw of urls) {
    try {
      const parsed = await parsePaymentUri(raw);
      const coin = coinFromScheme(parsed.scheme);
      if (!coin) continue;
      setPendingPaymentUri({ ...parsed, coin });
      navigate("/transactions");
    } catch {
      // Ignore malformed URIs.
    }
  }
}

export function useDeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    void getCurrent().then((urls) => {
      if (urls?.length) void handleUrls(urls, navigate);
    });

    void onOpenUrl((urls) => {
      void handleUrls(urls, navigate);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [navigate]);
}
