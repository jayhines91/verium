import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { passkeyGateRequired, passkeyVerifyPin, PASSKEY_GATE_QUERY_KEY } from "@/lib/security/client";

interface PasskeyGateProps {
  children: React.ReactNode;
}

function normalizePinInput(value: string): string {
  return value.replace(/\D/g, "").slice(0, 12);
}

export function PasskeyGate({ children }: PasskeyGateProps) {
  const gate = useQuery({
    queryKey: PASSKEY_GATE_QUERY_KEY,
    queryFn: passkeyGateRequired,
  });
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (gate.data === undefined) return;
    setUnlocked(!gate.data);
    if (gate.data) {
      setPin("");
      setError(null);
    }
  }, [gate.data]);

  const tryUnlock = async () => {
    if (pin.length < 6) {
      setError("Enter at least 6 digits.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const ok = await passkeyVerifyPin(pin);
      if (ok) {
        setUnlocked(true);
        setPin("");
      } else {
        setError("Invalid PIN");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  };

  if (gate.isLoading || gate.data === undefined) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-fg-muted">
        Loading…
      </div>
    );
  }

  if (!gate.data || unlocked) {
    return <>{children}</>;
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg-panel p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-lg border border-border bg-bg-subtle p-2.5">
            <Lock className="h-5 w-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold">Unlock Vericonomy Wallet</h1>
            <p className="text-sm text-fg-muted">Enter your PIN to continue.</p>
          </div>
        </div>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          maxLength={12}
          value={pin}
          onChange={(e) => {
            setPin(normalizePinInput(e.target.value));
            setError(null);
          }}
          placeholder="6–12 digit PIN"
          className="mb-3 h-10 w-full rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
          onKeyDown={(e) => {
            if (e.key === "Enter" && pin.length >= 6 && !checking) {
              void tryUnlock();
            }
          }}
        />
        {error && <p className="mb-3 text-xs text-danger">{error}</p>}
        <Button
          disabled={pin.length < 6 || checking}
          onClick={() => void tryUnlock()}
          className="w-full"
        >
          {checking ? "Checking…" : "Unlock"}
        </Button>
      </div>
    </div>
  );
}
