import { ExternalLink } from "lucide-react";
import { useUserPreferences } from "@/lib/user-preferences";
import {
  buildAddressExplorerUrl,
  buildBlockExplorerUrl,
  buildTxExplorerUrl,
  DEFAULT_ADDRESS_EXPLORER_TEMPLATE,
  DEFAULT_BLOCK_EXPLORER_TEMPLATE,
  EXPLORER_HOME,
} from "@/lib/verium-links";
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
  label?: string;
  className?: string;
  showIcon?: boolean;
  title?: string;
}

export function ExplorerLink({
  target,
  label = "View on explorer",
  className,
  showIcon = true,
  title,
}: ExplorerLinkProps) {
  const { prefs } = useUserPreferences();
  const txTemplate = prefs.explorer_tx_url_template;
  const blockTemplate =
    prefs.explorer_block_url_template ?? DEFAULT_BLOCK_EXPLORER_TEMPLATE;
  const addressTemplate =
    prefs.explorer_address_url_template ?? DEFAULT_ADDRESS_EXPLORER_TEMPLATE;

  const resolveUrl = () => {
    switch (target.kind) {
      case "home":
        return EXPLORER_HOME;
      case "tx":
        return buildTxExplorerUrl(txTemplate, target.txid);
      case "block":
        return buildBlockExplorerUrl(blockTemplate, target.hashOrHeight);
      case "address":
        return buildAddressExplorerUrl(addressTemplate, target.address);
      case "raw":
        return target.url;
    }
  };

  return (
    <button
      type="button"
      title={title ?? label}
      onClick={() => {
        const url = resolveUrl();
        void openExternal(url);
      }}
      className={cn(
        "inline-flex items-center gap-1 rounded text-xs text-fg-muted transition-colors hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent",
        className,
      )}
    >
      {label}
      {showIcon && <ExternalLink className="h-3 w-3" />}
    </button>
  );
}
