import type { ExplorerBlock } from "@/lib/explorer-api";

/** How often live block ages refresh (matches live chain feed). */
export const BLOCK_AGE_TICK_MS = 30_000;

/** Tip block from explorer list, preferring the row at `localHeight`. */
export function resolveTipBlock(
  blocks: ExplorerBlock[] | undefined | null,
  localHeight?: number,
): ExplorerBlock | undefined {
  if (!blocks?.length) return undefined;
  if (localHeight != null) {
    const match = blocks.find((b) => b.height === localHeight);
    if (match) return match;
  }
  return blocks.reduce((best, block) =>
    block.height > best.height ? block : best,
  );
}
