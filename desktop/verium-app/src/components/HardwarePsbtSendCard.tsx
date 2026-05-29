import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, SendHorizontal } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useActiveCoin } from "@/lib/coin/context";
import {
  auditLogRecord,
  hardwareWalletFinalizePsbt,
  hardwareWalletSendPsbt,
} from "@/lib/security/client";

export function HardwarePsbtSendCard() {
  const coin = useActiveCoin();
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState("");
  const [psbt, setPsbt] = useState("");
  const [signedPsbt, setSignedPsbt] = useState("");
  const [txid, setTxid] = useState<string | null>(null);

  const build = useMutation({
    mutationFn: async () => {
      const value = Number(amount);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error("Enter a valid amount");
      }
      return hardwareWalletSendPsbt(coin, { [address.trim()]: value });
    },
    onSuccess: (result) => {
      setPsbt(result.psbt_base64);
      setSignedPsbt("");
      setTxid(null);
    },
  });

  const broadcast = useMutation({
    mutationFn: async () => {
      const id = await hardwareWalletFinalizePsbt(coin, signedPsbt.trim());
      await auditLogRecord("hardware_psbt_send", `txid=${id}`, coin);
      return id;
    },
    onSuccess: (id) => setTxid(id),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SendHorizontal className="h-4 w-4 text-accent" />
          Hardware wallet PSBT send
        </CardTitle>
        <CardDescription>
          Build a PSBT on the node, sign on your device (USB, file, or animated
          QR), then paste the signed PSBT to broadcast.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Recipient address"
            className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-xs outline-none focus:border-accent"
          />
          <input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount"
            className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
          />
        </div>
        <Button
          size="sm"
          onClick={() => build.mutate()}
          disabled={!address.trim() || !amount || build.isPending}
        >
          {build.isPending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Building PSBT…
            </>
          ) : (
            "Build unsigned PSBT"
          )}
        </Button>

        {psbt && (
          <div className="space-y-2">
            <label className="text-xs text-fg-muted">
              Unsigned PSBT (copy to device)
            </label>
            <textarea
              readOnly
              value={psbt}
              rows={4}
              className="w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-[10px] outline-none"
            />
          </div>
        )}

        <div className="space-y-2">
          <label className="text-xs text-fg-muted">
            Signed PSBT from device
          </label>
          <textarea
            value={signedPsbt}
            onChange={(e) => setSignedPsbt(e.target.value)}
            rows={4}
            placeholder="Paste signed PSBT base64…"
            className="w-full rounded-md border border-border bg-bg-subtle px-3 py-2 text-[10px] outline-none focus:border-accent"
          />
        </div>

        <Button
          size="sm"
          onClick={() => broadcast.mutate()}
          disabled={!signedPsbt.trim() || broadcast.isPending}
        >
          {broadcast.isPending ? "Broadcasting…" : "Finalize & broadcast"}
        </Button>

        {build.error && (
          <p className="text-xs text-danger">{String(build.error)}</p>
        )}
        {broadcast.error && (
          <p className="text-xs text-danger">{String(broadcast.error)}</p>
        )}
        {txid && (
          <p className="text-xs text-success">
            Broadcast complete. Txid: <span className="font-mono">{txid}</span>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
