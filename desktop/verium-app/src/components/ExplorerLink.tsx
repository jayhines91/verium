import { type ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { useActiveCoin } from "@/lib/coin/context";
import type { CoinId } from "@/lib/coin/profile";
import {
  buildAddressExplorerUrl,
  buildBlockExplorerUrl,
  buildTxExplorerUrl,
  effectiveAddressExplorerTemplate,
  effectiveBlockExplorerTemplate,
  effectiveTxExplorerTemplate,
  explorerHome,
} from "@/lib/explorer-links";
import { useUserPreferences } from "@/lib/user-preferences";
import { openExternal } from "@/lib/open-external";
import { cn } from "@/lib/utils";

type ExplorerTarget =
  | { kind: "home" }
  | { kind: "tx"; txid: string }
  | { kind: "block"; hashOrHeight: string | number }
  | { kind: "address"; address: string }
  | { kind: "raw"; url: string };

interface ExplorerLinkProps {
  target: ExplorerTarget;
  coin?: CoinId;
  label?: ReactNode;
  className?: string;
  showIcon?: boolean;
  title?: string;
}

export function ExplorerLink({
  target,
  coin: coinProp,
  label = "View on explorer",
  className,
  showIcon = true,
  title,
}: ExplorerLinkProps) {
  const activeCoin = useActiveCoin();
  const coin = coinProp ?? activeCoin;
  const { prefs } = useUserPreferences();
  const txTemplate = effectiveTxExplorerTemplate(
    coin,
    prefs.explorer_tx_url_template,
  );
  const blockTemplate = effectiveBlockExplorerTemplate(
    coin,
    prefs.explorer_block_url_template,
  );
  const addressTemplate = effectiveAddressExplorerTemplate(
    coin,
    prefs.explorer_address_url_template,
  );

  const resolveUrl = () => {
    switch (target.kind) {
      case "home":
        return explorerHome(coin);
      case "tx":
        return buildTxExplorerUrl(coin, txTemplate, target.txid);
      case "block":
        return buildBlockExplorerUrl(coin, blockTemplate, target.hashOrHeight);
      case "address":
        return buildAddressExplorerUrl(coin, addressTemplate, target.address);
      case "raw":
        return target.url;
    }
  };

  return (
    <button
      type="button"
      title={title ?? (typeof label === "string" ? label : "View on explorer")}
      onClick={() => void openExternal(resolveUrl())}
      className={cn(
        "inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline",
        className,
      )}
    >
      {label}
      {showIcon && (
        <ExternalLink className="h-3 w-3 shrink-0 opacity-70 truncate" />
      )}
    </button>
  );
}
