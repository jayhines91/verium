import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { passkeyGateRequired, passkeyVerifyPin } from "@/lib/security/client";

interface PasskeyGateProps {
  children: React.ReactNode;
}

export function PasskeyGate({ children }: PasskeyGateProps) {
  const [required, setRequired] = useState<boolean | null>(null);
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    void passkeyGateRequired().then((r) => {
      setRequired(r);
      if (!r) setUnlocked(true);
    });
  }, []);

  if (required === null) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-fg-muted">
        Loading…
      </div>
    );
  }

  if (!required || unlocked) {
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
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="PIN"
          className="mb-3 h-10 w-full rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
          onKeyDown={(e) => {
            if (e.key === "Enter" && pin.length >= 6) {
              void (async () => {
                setChecking(true);
                setError(null);
                const ok = await passkeyVerifyPin(pin);
                setChecking(false);
                if (ok) setUnlocked(true);
                else setError("Invalid PIN");
              })();
            }
          }}
        />
        {error && <p className="mb-3 text-xs text-danger">{error}</p>}
        <Button
          disabled={pin.length < 6 || checking}
          onClick={async () => {
            setChecking(true);
            setError(null);
            const ok = await passkeyVerifyPin(pin);
            setChecking(false);
            if (ok) setUnlocked(true);
            else setError("Invalid PIN");
          }}
          className="w-full"
        >
          {checking ? "Checking…" : "Unlock"}
        </Button>
      </div>
    </div>
  );
}
