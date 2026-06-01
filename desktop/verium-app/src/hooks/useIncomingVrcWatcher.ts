import { useEffect, useRef } from "react";
import { useDaemonStatus } from "@/hooks/useDaemonStatus";
import { useWalletTransactions } from "@/hooks/useWalletTransactions";
import { type TransactionItem } from "@/lib/rpc/client";

export interface IncomingVrcEvent {
  txid: string;
  amount: number;
  address?: string;
  confirmations: number;
}

export interface IncomingVrcBatch {
  events: IncomingVrcEvent[];
  totalAmount: number;
}

type IncomingVrcListener = (batch: IncomingVrcBatch) => void;

const listeners = new Set<IncomingVrcListener>();

export function subscribeIncomingVrc(
  listener: IncomingVrcListener,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emitIncomingVrc(batch: IncomingVrcBatch): void {
  if (batch.events.length === 0) return;
  for (const listener of listeners) {
    listener(batch);
  }
}

const BATCH_DEBOUNCE_MS = 800;
const SEEN_STORAGE_KEY = "verium-notified-vrc-receive-txids";
const MAX_SEEN_TXIDS = 2_000;
const VERICOIN = "vericoin" as const;

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
  map: Map<string, IncomingVrcEvent>,
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

export function useIncomingVrcWatcher(): void {
  const { data: status } = useDaemonStatus(VERICOIN);
  const seen = useRef<Set<string>>(loadSeenTxids());
  const initialized = useRef(false);
  const pending = useRef<IncomingVrcEvent[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const txs = useWalletTransactions(VERICOIN, {
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
        emitIncomingVrc({
          events,
          totalAmount: events.reduce((sum, e) => sum + e.amount, 0),
        });
      }, BATCH_DEBOUNCE_MS);
    };

    const newlyDetected = new Map<string, IncomingVrcEvent>();
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
