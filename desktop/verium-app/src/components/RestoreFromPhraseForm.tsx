import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { TwoFactorPrompt } from "@/components/TwoFactorPrompt";
import {
  recoveryApplyHdSeed,
  recoveryValidateMnemonic,
} from "@/lib/security/client";
import { useActiveCoin } from "@/lib/coin/context";
import { useTwoFactorGate } from "@/hooks/useTwoFactorGate";

interface RestoreFromPhraseFormProps {
  onRestored?: () => void;
}

export function RestoreFromPhraseForm({
  onRestored,
}: RestoreFromPhraseFormProps) {
  const coin = useActiveCoin();
  const twoFa = useTwoFactorGate(coin);
  const [phrase, setPhrase] = useState("");
  const [bip39Pass, setBip39Pass] = useState("");

  const restore = useMutation({
    mutationFn: async () => {
      const valid = await recoveryValidateMnemonic(phrase);
      if (!valid) throw new Error("Invalid recovery phrase checksum");
      return recoveryApplyHdSeed(coin, phrase, bip39Pass || undefined);
    },
    onSuccess: () => onRestored?.(),
  });

  return (
    <>
      <TwoFactorPrompt
        open={twoFa.open}
        title={twoFa.title}
        onVerified={twoFa.verified}
        onCancel={twoFa.cancel}
      />
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void twoFa.gate("restore_wallet", () => restore.mutate(), {
            title: "Confirm phrase restore with 2FA",
          });
        }}
      >
        <p className="text-sm text-fg-muted">
          Restore from your 24-word BIP39 recovery phrase. This applies the HD
          seed to your wallet via sethdseed and triggers a rescan.
        </p>
        <textarea
          rows={3}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="Enter your 24-word recovery phrase…"
          className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-xs outline-none focus:border-accent"
        />
        <input
          type="password"
          value={bip39Pass}
          onChange={(e) => setBip39Pass(e.target.value)}
          placeholder="Optional BIP39 passphrase (25th word)"
          className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
        />
        {restore.error && (
          <p className="text-xs text-danger">{String(restore.error)}</p>
        )}
        {restore.isSuccess && (
          <p className="text-xs text-success">{restore.data}</p>
        )}
        <Button type="submit" disabled={!phrase.trim() || restore.isPending}>
          {restore.isPending ? "Restoring…" : "Restore from phrase"}
        </Button>
      </form>
    </>
  );
}
