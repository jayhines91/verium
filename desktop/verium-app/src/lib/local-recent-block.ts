import type { CoinId } from "@/lib/coin/profile";
import type { ExplorerBlock } from "@/lib/explorer-api";
import type { BlockMinedEvent } from "@/hooks/useBlockMinedWatcher";
import { rpcRaw } from "@/lib/rpc/client";

/** Merge explorer feed with blocks learned from the local node (shown immediately after mining). */
export function mergeRecentBlocks(
  explorer: ExplorerBlock[],
  local: ExplorerBlock[],
  limit = 10,
): ExplorerBlock[] {
  const byHeight = new Map<number, ExplorerBlock>();
  for (const block of explorer) {
    byHeight.set(block.height, block);
  }
  for (const block of local) {
    const existing = byHeight.get(block.height);
    if (!existing) {
      byHeight.set(block.height, block);
      continue;
    }
    byHeight.set(block.height, {
      ...existing,
      ...block,
      miner_address: block.miner_address ?? existing.miner_address,
      output_total: block.output_total ?? existing.output_total,
      mint: block.mint ?? existing.mint,
    });
  }
  return [...byHeight.values()]
    .sort((a, b) => b.height - a.height)
    .slice(0, limit);
}

async function resolveBlockHash(
  coin: CoinId,
  event: BlockMinedEvent,
): Promise<string | undefined> {
  if (event.blockhash) return event.blockhash;
  if (event.height <= 0) return undefined;
  try {
    const hash = await rpcRaw(coin, "getblockhash", [event.height]);
    return typeof hash === "string" ? hash : undefined;
  } catch {
    return undefined;
  }
}

/** Build a recent-blocks row from the local node (available as soon as the wallet sees the coinbase). */
export async function blockRowFromMinedEvent(
  coin: CoinId,
  event: BlockMinedEvent,
): Promise<ExplorerBlock | null> {
  if (event.height <= 0) return null;

  const hash = await resolveBlockHash(coin, event);
  const reward =
    event.amount != null && Number.isFinite(event.amount)
      ? String(event.amount)
      : undefined;

  if (!hash) {
    return {
      id: event.height,
      hash: event.txid ?? `local-${event.height}`,
      height: event.height,
      time: event.blocktime ?? Math.floor(Date.now() / 1000),
      mint: reward,
      output_total: reward,
      miner_address: event.address,
    };
  }

  try {
    const block = (await rpcRaw(coin, "getblock", [hash, 1])) as Record<
      string,
      unknown
    >;
    const time =
      typeof block.time === "number"
        ? block.time
        : (event.blocktime ?? Math.floor(Date.now() / 1000));
    const txs = block.tx;
    return {
      id: event.height,
      hash,
      height: event.height,
      time,
      mint: reward,
      output_total: reward,
      miner_address: event.address,
      n_tx: Array.isArray(txs) ? txs.length : undefined,
      difficulty:
        block.difficulty != null ? String(block.difficulty) : undefined,
      size: typeof block.size === "number" ? block.size : undefined,
    };
  } catch {
    return {
      id: event.height,
      hash,
      height: event.height,
      time: event.blocktime ?? Math.floor(Date.now() / 1000),
      mint: reward,
      output_total: reward,
      miner_address: event.address,
    };
  }
}
