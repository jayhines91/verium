import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { TwoFactorPrompt } from "@/components/TwoFactorPrompt";
import { useActiveCoin } from "@/lib/coin/context";
import { rpcWalletDumpPrivKey } from "@/lib/rpc/client";
import { auditLogRecord } from "@/lib/security/client";
import { useTwoFactorGate } from "@/hooks/useTwoFactorGate";

export function DumpPrivkeyCard() {
  const coin = useActiveCoin();
  const [address, setAddress] = useState("");
  const [privkey, setPrivkey] = useState<string | null>(null);
  const twoFa = useTwoFactorGate(coin);

  const dump = useMutation({
    mutationFn: async () => {
      const key = await rpcWalletDumpPrivKey(coin, address.trim());
      await auditLogRecord("dump_privkey", address.trim(), coin);
      return key;
    },
    onSuccess: (key) => setPrivkey(key),
  });

  return (
    <>
      <TwoFactorPrompt
        open={twoFa.open}
        title={twoFa.title}
        onVerified={twoFa.verified}
        onCancel={twoFa.cancel}
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-accent" />
            Export private key
          </CardTitle>
          <CardDescription>
            Dump the WIF private key for a single address. Requires 2FA when
            enabled.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Address"
            className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-xs outline-none focus:border-accent"
          />
          <Button
            size="sm"
            variant="danger"
            disabled={!address.trim() || dump.isPending}
            onClick={() =>
              void twoFa.gate("dump_privkey", () => dump.mutate(), {
                title: "Confirm key export with 2FA",
              })
            }
          >
            {dump.isPending ? "Exporting…" : "Show private key"}
          </Button>
          {privkey && (
            <textarea
              readOnly
              value={privkey}
              rows={2}
              className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs"
            />
          )}
          {dump.error && (
            <p className="text-xs text-danger">{String(dump.error)}</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
