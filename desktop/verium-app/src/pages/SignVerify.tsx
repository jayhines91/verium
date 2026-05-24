import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CheckCircle2, ShieldCheck, ShieldX } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { WalletUnlockGate } from "@/components/WalletUnlockGate";
import {
  rpcWalletSignMessage,
  rpcWalletVerifyMessage,
} from "@/lib/rpc/client";
import { useActiveCoin } from "@/lib/coin/context";

export function SignVerify() {
  return (
    <WalletUnlockGate
      title="Unlock to sign messages"
      description="Signing proves ownership of an address. Your passphrase is required."
    >
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <SignCard />
        <VerifyCard />
      </div>
    </WalletUnlockGate>
  );
}

function SignCard() {
  const coin = useActiveCoin();
  const [address, setAddress] = useState("");
  const [message, setMessage] = useState("");

  const sign = useMutation({
    mutationFn: () => rpcWalletSignMessage(coin, address.trim(), message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-accent" /> Sign message
        </CardTitle>
        <CardDescription>
          Produce a cryptographic signature for a message using an address you
          own.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-muted">Address</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            className="h-9 rounded-md border border-border bg-bg-subtle px-3 font-mono text-xs outline-none focus:border-accent"
            placeholder="VTDns…"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-muted">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm outline-none focus:border-accent"
            placeholder="Enter the message you want to sign"
          />
        </div>
        <Button
          size="sm"
          onClick={() => sign.mutate()}
          disabled={!address.trim() || !message || sign.isPending}
        >
          {sign.isPending ? "Signing…" : "Sign message"}
        </Button>
        {sign.error && (
          <div className="text-xs text-danger">{String(sign.error)}</div>
        )}
        {sign.data && (
          <div className="flex flex-col gap-1">
            <label className="text-xs text-fg-muted">Signature</label>
            <textarea
              readOnly
              value={sign.data}
              rows={3}
              className="rounded-md border border-success/40 bg-success/5 px-3 py-2 font-mono text-[11px] outline-none"
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(sign.data ?? "");
              }}
            >
              Copy signature
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VerifyCard() {
  const coin = useActiveCoin();
  const [address, setAddress] = useState("");
  const [signature, setSignature] = useState("");
  const [message, setMessage] = useState("");

  const verify = useMutation({
    mutationFn: () =>
      rpcWalletVerifyMessage(coin, address.trim(), signature.trim(), message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldX className="h-4 w-4 text-accent" /> Verify message
        </CardTitle>
        <CardDescription>
          Check that a signature was produced by the owner of a given address.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-muted">Address</label>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            spellCheck={false}
            className="h-9 rounded-md border border-border bg-bg-subtle px-3 font-mono text-xs outline-none focus:border-accent"
            placeholder="VTDns…"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-muted">Signature</label>
          <textarea
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            rows={2}
            spellCheck={false}
            className="rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-[11px] outline-none focus:border-accent"
            placeholder="Base64 signature"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-fg-muted">Message</label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>
        <Button
          size="sm"
          onClick={() => verify.mutate()}
          disabled={
            !address.trim() ||
            !signature.trim() ||
            !message ||
            verify.isPending
          }
        >
          {verify.isPending ? "Verifying…" : "Verify signature"}
        </Button>
        {verify.error && (
          <div className="text-xs text-danger">{String(verify.error)}</div>
        )}
        {verify.data === true && (
          <div className="flex items-center gap-2 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> Signature is valid.
          </div>
        )}
        {verify.data === false && (
          <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
            <ShieldX className="h-4 w-4" /> Signature does not match.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
