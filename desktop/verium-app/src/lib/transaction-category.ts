export type TransactionCategoryBadgeClass =
  | "badge-cat-receive"
  | "badge-cat-send"
  | "badge-cat-generate"
  | "badge-cat-immature"
  | "badge-cat-stake"
  | "badge-cat-stake-mint"
  | "badge-cat-stake-orphan"
  | "badge-cat-move"
  | "badge-cat-orphan"
  | "badge-cat-default";

const CATEGORY_LABELS: Record<string, string> = {
  receive: "Received",
  send: "Sent",
  generate: "Mined",
  immature: "Mined (immature)",
  stake: "Staked",
  "stake-mint": "Stake reward",
  "stake-orphan": "Orphaned stake",
  move: "Internal transfer",
  orphan: "Orphaned",
};

/** User-facing label for a wallet `listtransactions` category. */
export function transactionCategoryLabel(category: string): string {
  const known = CATEGORY_LABELS[category];
  if (known) return known;
  return category
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Distinct badge class per wallet transaction category. */
export function transactionCategoryBadgeClass(
  category: string,
): TransactionCategoryBadgeClass {
  switch (category) {
    case "receive":
      return "badge-cat-receive";
    case "send":
      return "badge-cat-send";
    case "generate":
      return "badge-cat-generate";
    case "immature":
      return "badge-cat-immature";
    case "stake":
      return "badge-cat-stake";
    case "stake-mint":
      return "badge-cat-stake-mint";
    case "stake-orphan":
      return "badge-cat-stake-orphan";
    case "move":
      return "badge-cat-move";
    case "orphan":
      return "badge-cat-orphan";
    default:
      return "badge-cat-default";
  }
}
