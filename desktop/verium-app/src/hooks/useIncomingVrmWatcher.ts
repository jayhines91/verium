import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { coinQueryKey } from "@/lib/coin/profile";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { rpcListTransactions, type TransactionItem } from "@/lib/rpc/client";

export interface IncomingVrmEvent {
  txid: string;
  amount: number;
  address?: string;
  confirmations: number;
}

export interface IncomingVrmBatch {
  events: IncomingVrmEvent[];
  totalAmount: number;
}

type IncomingVrmListener = (batch: IncomingVrmBatch) => void;

const listeners = new Set<IncomingVrmListener>();

export function subscribeIncomingVrm(
  listener: IncomingVrmListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitIncomingVrm(batch: IncomingVrmBatch): void {
  if (batch.events.length === 0) return;
  for (const listener of listeners) {
    listener(batch);
  }
}

const POLL_MS = 10_000;
const BATCH_DEBOUNCE_MS = 800;
const SEEN_STORAGE_KEY = "verium-notified-receive-txids";
const MAX_SEEN_TXIDS = 2_000;
const VERIUM = "verium" as const;

function isIncomingReceive(tx: TransactionItem): boolean {
  return tx.category === "receive" && tx.amount > 0;
}

function loadSeenTxids(): Set<string> {
  if (typeof sessionStorage === "undefined") return new Set();
  try {
    const raw = sessionStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

function persistSeenTxids(seen: Set<string>): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const ids = [...seen];
    const trimmed =
      ids.length > MAX_SEEN_TXIDS ? ids.slice(-MAX_SEEN_TXIDS) : ids;
    sessionStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore quota / privacy mode failures.
  }
}

function mergeReceiveEvent(
  map: Map<string, IncomingVrmEvent>,
  tx: TransactionItem,
): void {
  const existing = map.get(tx.txid);
  if (existing) {
    existing.amount += tx.amount;
    if (!existing.address && tx.address) existing.address = tx.address;
    existing.confirmations = Math.max(existing.confirmations, tx.confirmations);
    return;
  }

  map.set(tx.txid, {
    txid: tx.txid,
    amount: tx.amount,
    address: tx.address,
    confirmations: tx.confirmations,
  });
}

export function useIncomingVrmWatcher(): void {
  const { data: status } = useDaemonStatus(VERIUM);
  const seen = useRef<Set<string>>(loadSeenTxids());
  const initialized = useRef(false);
  const pending = useRef<IncomingVrmEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const txs = useQuery({
    queryKey: coinQueryKey(VERIUM, "listtransactions", "incoming-vrm-watcher"),
    queryFn: () => rpcListTransactions(VERIUM, 200, 0),
    refetchInterval: POLL_MS,
    retry: 0,
    enabled: status?.connected === true,
  });

  useEffect(() => {
    return () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!txs.isSuccess || txs.data === undefined) return;

    const incoming = txs.data.filter(isIncomingReceive);

    if (!initialized.current) {
      for (const tx of incoming) {
        seen.current.add(tx.txid);
      }
      persistSeenTxids(seen.current);
      initialized.current = true;
      return;
    }

    const scheduleFlush = () => {
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(() => {
        const events = pending.current;
        pending.current = [];
        flushTimer.current = null;
        if (events.length === 0) return;
        emitIncomingVrm({
          events,
          totalAmount: events.reduce((sum, e) => sum + e.amount, 0),
        });
      }, BATCH_DEBOUNCE_MS);
    };

    const newlyDetected = new Map<string, IncomingVrmEvent>();
    let added = false;

    for (const tx of incoming) {
      if (seen.current.has(tx.txid)) continue;
      seen.current.add(tx.txid);
      mergeReceiveEvent(newlyDetected, tx);
      added = true;
    }

    if (!added) return;

    persistSeenTxids(seen.current);
    for (const event of newlyDetected.values()) {
      pending.current.push(event);
    }
    scheduleFlush();
  }, [txs.data, txs.isSuccess]);
}
