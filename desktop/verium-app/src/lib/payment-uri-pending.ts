import type { CoinId } from "@/lib/coin/profile";
import type { ParsedPaymentUri } from "@/lib/security/client";

export interface PendingPaymentUri extends ParsedPaymentUri {
  coin: CoinId;
}

let pending: PendingPaymentUri | null = null;

export function setPendingPaymentUri(uri: PendingPaymentUri): void {
  pending = uri;
}

export function consumePendingPaymentUri(): PendingPaymentUri | null {
  const value = pending;
  pending = null;
  return value;
}
