import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { twoFactorVerify } from "@/lib/security/client";

interface TwoFactorPromptProps {
  open: boolean;
  title?: string;
  onVerified: () => void;
  onCancel: () => void;
}

export function TwoFactorPrompt({
  open,
  title = "Two-factor authentication",
  onVerified,
  onCancel,
}: TwoFactorPromptProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-xl border border-border bg-bg-panel p-5 shadow-2xl">
        <div className="mb-4 flex items-center gap-3">
          <ShieldCheck className="h-5 w-5 text-accent" />
          <h2 className="text-base font-semibold">{title}</h2>
        </div>
        <p className="mb-3 text-sm text-fg-muted">
          Enter the 6-digit code from your authenticator app or a recovery code.
        </p>
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={12}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
          placeholder="000000"
          className="mb-3 h-10 w-full rounded-md border border-border bg-bg-subtle px-3 text-sm tracking-widest outline-none focus:border-accent"
        />
        {error && <p className="mb-3 text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={code.length < 6 || checking}
            onClick={async () => {
              setChecking(true);
              setError(null);
              const ok = await twoFactorVerify(code);
              setChecking(false);
              if (ok) {
                setCode("");
                onVerified();
              } else {
                setError("Invalid code. Try again or use a recovery code.");
              }
            }}
          >
            {checking ? "Verifying…" : "Verify"}
          </Button>
        </div>
      </div>
    </div>
  );
}
