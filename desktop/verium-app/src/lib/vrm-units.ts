import { formatNumber } from "@/lib/utils";

/** 1 VRM = 100_000_000 VRMi (satoshis), matching Qt BitcoinUnits. */
export const VRM_SATOSHI = 100_000_000;

export function formatVrmAmount(value: number, fractionDigits = 8): string {
  return `${formatNumber(value, fractionDigits)} VRM`;
}

/** Alternative subdivisions shown in the send confirmation dialog. */
export function formatVrmAlternates(totalVrm: number): string {
  const mVrm = totalVrm * 1_000;
  const uVrm = totalVrm * 1_000_000;
  const vrmi = Math.round(totalVrm * VRM_SATOSHI);
  return `(=${formatNumber(mVrm, 5)} mVRM or ${formatNumber(uVrm, 2)} µVRM or ${formatNumber(vrmi, 0)} VRMi)`;
}

export function formatRecipientLine(options: {
  amount: number;
  address: string;
  label?: string;
}): string {
  const amount = formatVrmAmount(options.amount, 8);
  const label = options.label?.trim();
  if (label) {
    return `${amount} to '${label}' (${options.address})`;
  }
  return `${amount} to ${options.address}`;
}
