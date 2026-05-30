import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookUser,
  ClipboardPaste,
  Coins,
  Plus,
  QrCode,
  SendHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  SendConfirmDialog,
  type SendConfirmRecipient,
} from "@/components/SendConfirmDialog";
import { AddressBookPicker } from "@/components/AddressBookPicker";
import {
  CoinControlDialog,
  type SelectedUtxoSet,
} from "@/components/CoinControlDialog";
import { FeeRateDialog } from "@/components/FeeRateDialog";
import { QrScanModal } from "@/components/QrScanModal";
import { TwoFactorPrompt } from "@/components/TwoFactorPrompt";
import { ExplorerLink } from "@/components/ExplorerLink";
import {
  rpcGetWalletInfo,
  rpcSendToAddress,
  rpcWalletSendWithInputs,
  rpcWalletSetTxFee,
} from "@/lib/rpc/client";
import { useActiveCoin, useCoinProfile } from "@/lib/coin/context";
import { coinQueryKey, getCoinProfile, type CoinId } from "@/lib/coin/profile";
import { useUserPreferences } from "@/lib/user-preferences";
import { coinSymbol, formatCoinAmount } from "@/lib/units";
import { cn } from "@/lib/utils";
import {
  auditLogRecord,
  spendingControlsCheckSend,
  spendingControlsGet,
  spendingControlsRecordSend,
  twoFactorIsGated,
} from "@/lib/security/client";

const EXAMPLE_ADDRESSES: Partial<Record<CoinId, string>> = {
  verium: "VY6E3KSqrMk1hcy5Cu4EGyHrdDS5ch3YHU",
};
const DEFAULT_FEE_RATE = 0.001;

interface SendRecipient {
  id: string;
  address: string;
  label: string;
  amount: string;
}

function newRecipient(): SendRecipient {
  return {
    id: crypto.randomUUID(),
    address: "",
    label: "",
    amount: "",
  };
}

function parseAmount(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

interface SendSuccessResult {
  txids: string[];
  recipients: SendConfirmRecipient[];
  totalAmount: number;
  completedAt: number;
}

function SendSuccessBanner({
  result,
  coin,
  onDismiss,
}: {
  result: SendSuccessResult;
  coin: CoinId;
  onDismiss: () => void;
}) {
  const symbol = getCoinProfile(coin).symbol;
  const singleTx = result.txids.length === 1;

  return (
    <div className="mt-3 rounded-md border border-success/30 bg-success/10 px-3 py-3 text-xs text-success">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-fg">Payment submitted</p>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 text-fg-muted hover:text-fg"
          aria-label="Dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 tabular-nums text-fg">
        Total sent:{" "}
        <span className="font-semibold">
          {formatCoinAmount(result.totalAmount, coin, 8)}
        </span>
        {result.recipients.length > 1 && (
          <span className="text-fg-muted">
            {" "}
            · {result.recipients.length} recipients
          </span>
        )}
      </p>
      <ul className="mt-2 space-y-2 border-t border-success/20 pt-2">
        {result.recipients.map((recipient, index) => {
          const txid = singleTx ? result.txids[0] : result.txids[index];
          return (
            <li key={`${recipient.address}-${index}`} className="text-fg">
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <span className="text-[11px] break-all">
                  {recipient.address}
                </span>
                <span className="shrink-0 tabular-nums font-medium">
                  {formatCoinAmount(recipient.amount, coin, 8)}
                </span>
              </div>
              {recipient.label && (
                <p className="mt-0.5 text-fg-muted">{recipient.label}</p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                {txid && (
                  <>
                    <span className="text-[10px] text-fg-muted break-all">
                      {txid}
                    </span>
                    <ExplorerLink
                      coin={coin}
                      target={{ kind: "tx", txid }}
                      label="View tx"
                      className="text-accent"
                    />
                  </>
                )}
                <ExplorerLink
                  coin={coin}
                  target={{ kind: "address", address: recipient.address }}
                  label="View address"
                  className="text-accent"
                />
              </div>
            </li>
          );
        })}
      </ul>
      {singleTx && result.recipients.length > 1 && (
        <div className="mt-2 border-t border-success/20 pt-2">
          <ExplorerLink
            coin={coin}
            target={{ kind: "tx", txid: result.txids[0]! }}
            label={`View combined transaction on ${symbol} explorer`}
            className="text-accent"
          />
        </div>
      )}
      <p className="mt-2 text-[10px] text-fg-muted">
        Submitted {new Date(result.completedAt).toLocaleString()} — awaiting network
        confirmation.
      </p>
    </div>
  );
}

interface SendPanelProps {
  className?: string;
  initialAddress?: string;
  initialAmount?: string;
  initialLabel?: string;
}

export function SendPanel({
  className,
  initialAddress,
  initialAmount,
  initialLabel,
}: SendPanelProps) {
  const coin = useActiveCoin();
  const profile = useCoinProfile();
  const symbol = coinSymbol(coin);
  const exampleAddress = EXAMPLE_ADDRESSES[coin];
  const queryClient = useQueryClient();
  const prefs = useUserPreferences((s) => s.prefs);
  const updatePrefs = useUserPreferences((s) => s.update);
  const wallet = useQuery({
    queryKey: coinQueryKey(coin, "getwalletinfo"),
    queryFn: () => rpcGetWalletInfo(coin),
    refetchInterval: 10_000,
  });

  const [recipients, setRecipients] = useState<SendRecipient[]>([
    newRecipient(),
  ]);
  const [subtractFee, setSubtractFee] = useState(false);
  const [feeRate, setFeeRate] = useState<number>(
    prefs.tx_fee_rate_vrm_per_kb ?? DEFAULT_FEE_RATE,
  );
  const [feeDialogOpen, setFeeDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [addressBookFor, setAddressBookFor] = useState<string | null>(null);
  const [coinControlOpen, setCoinControlOpen] = useState(false);
  const [coinControl, setCoinControl] = useState<SelectedUtxoSet>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrTargetId, setQrTargetId] = useState<string | null>(null);
  const [twoFaOpen, setTwoFaOpen] = useState(false);
  const [clipboardGuardError, setClipboardGuardError] = useState<string | null>(null);
  const [spendWarning, setSpendWarning] = useState<string | null>(null);
  const [lastSend, setLastSend] = useState<SendSuccessResult | null>(null);
  const clipboardSnapshot = useRef<Map<string, string>>(new Map());

  const spendingCfg = useQuery({
    queryKey: ["spending-controls"],
    queryFn: spendingControlsGet,
  });

  useEffect(() => {
    if (!initialAddress && !initialAmount && !initialLabel) return;
    setRecipients([
      {
        ...newRecipient(),
        address: initialAddress ?? "",
        amount: initialAmount ?? "",
        label: initialLabel ?? "",
      },
    ]);
  }, [initialAddress, initialAmount, initialLabel]);

  // Keep daemon's settxfee aligned with the persisted preference.
  useEffect(() => {
    rpcWalletSetTxFee(coin, feeRate).catch(() => {
      /* daemon may not be ready; the next send will retry. */
    });
  }, [feeRate]);

  const balance = wallet.data?.balance ?? 0;
  const coinControlTotal = coinControl.reduce((sum, u) => sum + u.amount, 0);

  const updateRecipient = useCallback(
    (id: string, patch: Partial<SendRecipient>) => {
      setRecipients((rows) =>
        rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
      );
    },
    [],
  );

  const removeRecipient = useCallback((id: string) => {
    setRecipients((rows) => {
      if (rows.length <= 1) {
        return [{ ...rows[0]!, address: "", label: "", amount: "" }];
      }
      return rows.filter((row) => row.id !== id);
    });
  }, []);

  const clearAll = useCallback(() => {
    setRecipients([newRecipient()]);
    setSubtractFee(false);
  }, []);

  const addRecipient = useCallback(() => {
    setRecipients((rows) => [...rows, newRecipient()]);
  }, []);

  const pasteAddress = useCallback(async (id: string) => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        clipboardSnapshot.current.set(id, text.trim());
        updateRecipient(id, { address: text.trim() });
      }
    } catch {
      // Clipboard unavailable
    }
  }, [updateRecipient]);

  const useAvailableBalance = useCallback(
    (id: string) => {
      if (balance <= 0) return;
      const feeBuffer = subtractFee ? 0 : feeRate;
      const spendable = Math.max(0, balance - feeBuffer);
      updateRecipient(id, { amount: spendable.toFixed(8) });
    },
    [balance, feeRate, subtractFee, updateRecipient],
  );

  const validRows = recipients.filter(
    (row) => row.address.trim().length > 0 && parseAmount(row.amount) != null,
  );

  const confirmRecipients: SendConfirmRecipient[] = validRows.map((row) => ({
    address: row.address.trim(),
    label: row.label.trim() || undefined,
    amount: parseAmount(row.amount)!,
  }));

  const send = useMutation({
    mutationFn: async () => {
      const sentRecipients: SendConfirmRecipient[] = validRows.map((row) => ({
        address: row.address.trim(),
        label: row.label.trim() || undefined,
        amount: parseAmount(row.amount)!,
      }));
      const totalAmount = sentRecipients.reduce((sum, r) => sum + r.amount, 0);

      // Coin control path uses createraw/fundraw/signraw/sendraw for one tx
      // covering all outputs with explicit UTXO selection.
      let txids: string[];
      if (coinControl.length > 0) {
        const outputs: Record<string, number> = {};
        for (const row of validRows) {
          outputs[row.address.trim()] = parseAmount(row.amount)!;
        }
        const txid = await rpcWalletSendWithInputs(
          coin,
          coinControl.map((u) => ({ txid: u.txid, vout: u.vout })),
          outputs,
          undefined,
          feeRate,
        );
        txids = [txid];
      } else {
        txids = [];
        for (const row of validRows) {
          const amount = parseAmount(row.amount)!;
          const txid = await rpcSendToAddress(
            coin,
            row.address.trim(),
            amount,
            row.label.trim() || undefined,
          );
          txids.push(txid);
        }
      }

      return {
        txids,
        recipients: sentRecipients,
        totalAmount,
        completedAt: Date.now(),
      };
    },
    onMutate: () => setLastSend(null),
    onSuccess: async (result) => {
      setConfirmOpen(false);
      setLastSend(result);
      clearAll();
      setCoinControl([]);
      for (const row of result.recipients) {
        await spendingControlsRecordSend(row.amount, coin, row.address);
        await auditLogRecord(
          "send",
          `Sent ${formatCoinAmount(row.amount, coin, 8)} to ${row.address} tx ${result.txids[0] ?? ""}`,
          coin,
        );
      }
      queryClient.invalidateQueries({ queryKey: coinQueryKey(coin, "listtransactions") });
      queryClient.invalidateQueries({ queryKey: coinQueryKey(coin, "getwalletinfo") });
      queryClient.invalidateQueries({ queryKey: coinQueryKey(coin, "listunspent") });
    },
    onError: () => {
      setConfirmOpen(false);
    },
  });

  const canSend = validRows.length > 0 && !send.isPending;

  const openConfirm = async () => {
    setClipboardGuardError(null);
    setSpendWarning(null);

    if (spendingCfg.data?.clipboard_guard_enabled) {
      for (const row of validRows) {
        const snap = clipboardSnapshot.current.get(row.id);
        if (snap && snap !== row.address.trim()) {
          setClipboardGuardError(
            "Clipboard contents changed since paste — possible hijack. Re-paste the address.",
          );
          return;
        }
      }
    }

    const total = validRows.reduce((s, r) => s + parseAmount(r.amount)!, 0);
    const check = await spendingControlsCheckSend(total, coin, validRows[0]!.address.trim());
    if (!check.allowed) {
      setSpendWarning(check.reason ?? "Send blocked by spending controls.");
      return;
    }
    if (check.look_alike_warning) setSpendWarning(check.look_alike_warning);

    const gated = await twoFactorIsGated("send", coin, total);
    if (gated) {
      setTwoFaOpen(true);
      return;
    }
    setConfirmOpen(true);
  };

  return (
    <div className={cn("flex flex-col", className)}>
      <TwoFactorPrompt
        open={twoFaOpen}
        title="Confirm send with 2FA"
        onVerified={() => {
          setTwoFaOpen(false);
          setConfirmOpen(true);
        }}
        onCancel={() => setTwoFaOpen(false)}
      />

      <QrScanModal
        open={qrOpen}
        onClose={() => {
          setQrOpen(false);
          setQrTargetId(null);
        }}
        onScan={(address, amount) => {
          if (qrTargetId) {
            updateRecipient(qrTargetId, {
              address,
              ...(amount != null ? { amount: amount.toFixed(8) } : {}),
            });
          }
        }}
      />
      <SendConfirmDialog
        open={confirmOpen}
        coin={coin}
        recipients={confirmRecipients}
        feeRatePerKb={feeRate}
        subtractFeeFromAmount={subtractFee}
        confirming={send.isPending}
        onConfirm={() => send.mutate()}
        onCancel={() => {
          if (!send.isPending) setConfirmOpen(false);
        }}
      />

      <AddressBookPicker
        open={addressBookFor !== null}
        onClose={() => setAddressBookFor(null)}
        category="send"
        onPick={(entry) => {
          if (addressBookFor) {
            updateRecipient(addressBookFor, {
              address: entry.address,
              label: entry.label,
            });
          }
          setAddressBookFor(null);
        }}
      />

      <CoinControlDialog
        open={coinControlOpen}
        selected={coinControl}
        onClose={() => setCoinControlOpen(false)}
        onApply={setCoinControl}
      />

      <FeeRateDialog
        open={feeDialogOpen}
        current={feeRate}
        symbol={symbol}
        onClose={() => setFeeDialogOpen(false)}
        onApply={(rate) => {
          setFeeRate(rate);
          void updatePrefs({ tx_fee_rate_vrm_per_kb: rate });
        }}
      />

      <div className="flex flex-col gap-3">
        {recipients.map((row, index) => (
          <div
            key={row.id}
            className="rounded-lg border border-border bg-bg-subtle/80 p-4"
          >
            <div className="grid gap-3">
              <div className="grid gap-1.5 sm:grid-cols-[5rem_1fr] sm:items-center">
                <label
                  htmlFor={`pay-to-${row.id}`}
                  className="text-sm font-medium text-fg-muted sm:text-right"
                >
                  Pay To
                </label>
                <div className="flex min-w-0 gap-1">
                  <input
                    id={`pay-to-${row.id}`}
                    type="text"
                    spellCheck={false}
                    value={row.address}
                    onChange={(e) =>
                      updateRecipient(row.id, { address: e.target.value })
                    }
                    placeholder={
                      exampleAddress
                        ? `Enter a ${profile.displayName} address (e.g. ${exampleAddress})`
                        : `Enter a ${profile.displayName} address`
                    }
                    className="h-10 min-w-0 flex-1 rounded-md border border-border bg-bg-panel px-3 text-xs outline-none focus:border-accent"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-10 w-10 shrink-0 px-0"
                    title="Pick from address book"
                    onClick={() => setAddressBookFor(row.id)}
                  >
                    <BookUser className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-10 w-10 shrink-0 px-0"
                    title="Paste from clipboard"
                    onClick={() => void pasteAddress(row.id)}
                  >
                    <ClipboardPaste className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-10 w-10 shrink-0 px-0"
                    title="Scan QR code"
                    onClick={() => {
                      setQrTargetId(row.id);
                      setQrOpen(true);
                    }}
                  >
                    <QrCode className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-10 w-10 shrink-0 px-0"
                    title={recipients.length > 1 ? "Remove recipient" : "Clear"}
                    onClick={() => removeRecipient(row.id)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid gap-1.5 sm:grid-cols-[5rem_1fr] sm:items-center">
                <label
                  htmlFor={`label-${row.id}`}
                  className="text-sm font-medium text-fg-muted sm:text-right"
                >
                  Label
                </label>
                <input
                  id={`label-${row.id}`}
                  type="text"
                  value={row.label}
                  onChange={(e) =>
                    updateRecipient(row.id, { label: e.target.value })
                  }
                  placeholder="Enter a label for this address to add it to your address book"
                  className="h-10 rounded-md border border-border bg-bg-panel px-3 text-sm outline-none focus:border-accent"
                />
              </div>

              <div className="grid gap-1.5 sm:grid-cols-[5rem_1fr] sm:items-center">
                <label
                  htmlFor={`amount-${row.id}`}
                  className="text-sm font-medium text-fg-muted sm:text-right"
                >
                  Amount
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    id={`amount-${row.id}`}
                    type="number"
                    min={0}
                    step="0.00000001"
                    value={row.amount}
                    onChange={(e) =>
                      updateRecipient(row.id, { amount: e.target.value })
                    }
                    className="h-10 w-36 rounded-md border border-border bg-bg-panel px-3 text-sm tabular-nums outline-none focus:border-accent"
                  />
                  <select
                    className="h-10 rounded-md border border-border bg-bg-panel px-2 text-sm outline-none focus:border-accent"
                    value={symbol}
                    disabled
                    aria-label="Coin unit"
                  >
                    <option value={symbol}>{symbol}</option>
                  </select>
                  {index === 0 && (
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-fg-muted">
                      <input
                        type="checkbox"
                        checked={subtractFee}
                        onChange={(e) => setSubtractFee(e.target.checked)}
                        className="h-3.5 w-3.5 rounded accent-accent"
                      />
                      Subtract fee from amount
                    </label>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="ml-auto shrink-0"
                    onClick={() => useAvailableBalance(row.id)}
                    disabled={balance <= 0}
                  >
                    Use available balance
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
        <span className="text-fg-muted">
          Transaction Fee:{" "}
          <span className="font-medium tabular-nums text-fg">
            {feeRate.toFixed(8)} {symbol}/kB
          </span>
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setFeeDialogOpen(true)}
        >
          Choose…
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setCoinControlOpen(true)}
        >
          <Coins className="h-4 w-4" />
          Coin control
          {coinControl.length > 0 && (
            <span className="ml-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              {coinControl.length}
            </span>
          )}
        </Button>
        {coinControl.length > 0 && (
          <span className="text-xs text-fg-muted">
            Selected inputs:{" "}
            <span className="font-medium tabular-nums text-fg">
              {formatCoinAmount(coinControlTotal, coin, 8)}
            </span>{" "}
            ·{" "}
            <button
              type="button"
              className="text-accent underline"
              onClick={() => setCoinControl([])}
            >
              Clear
            </button>
          </span>
        )}
      </div>

      {clipboardGuardError && (
        <div className="mt-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          {clipboardGuardError}
        </div>
      )}
      {spendWarning && (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          {spendWarning}
        </div>
      )}
      {send.error && (
        <div className="mt-3 text-xs text-danger">{String(send.error)}</div>
      )}
      {lastSend && (
        <SendSuccessBanner
          result={lastSend}
          coin={coin}
          onDismiss={() => setLastSend(null)}
        />
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-accent px-4 py-3 text-accent-fg">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="border-0 bg-white text-accent hover:bg-white/90"
            disabled={!canSend}
            onClick={() => void openConfirm()}
          >
            <SendHorizontal className="h-4 w-4" />
            {send.isPending ? "Sending…" : "Send"}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="lg"
            onClick={() => {
              clearAll();
              setLastSend(null);
            }}
          >
            <X className="h-4 w-4" />
            Clear All
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="border-0 bg-white/15 text-accent-fg hover:bg-white/25"
            onClick={addRecipient}
          >
            <Plus className="h-4 w-4" />
            Add Recipient
          </Button>
        </div>
        <div className="text-sm font-semibold tabular-nums">
          Balance: {formatCoinAmount(balance, coin, 8)}
        </div>
      </div>
    </div>
  );
}
