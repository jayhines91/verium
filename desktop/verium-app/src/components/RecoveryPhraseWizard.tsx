import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { TwoFactorPrompt } from "@/components/TwoFactorPrompt";
import {
  recoveryGenerateMnemonic,
  recoveryVerificationIndices,
  recoveryVerifyWords,
} from "@/lib/security/client";
import { useActiveCoin } from "@/lib/coin/context";
import { useTwoFactorGate } from "@/hooks/useTwoFactorGate";

interface RecoveryPhraseWizardProps {
  /** Called after phrase verification; may apply HD seed (await before showing success). */
  onComplete: (phrase: string) => void | Promise<void>;
  onSkip?: () => void;
}

type Step = "generate" | "reveal" | "verify" | "done";

export function RecoveryPhraseWizard({
  onComplete,
  onSkip,
}: RecoveryPhraseWizardProps) {
  const coin = useActiveCoin();
  const twoFa = useTwoFactorGate(coin);
  const [step, setStep] = useState<Step>("generate");
  const [phrase, setPhrase] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [indices, setIndices] = useState<number[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const generate = useMutation({
    mutationFn: recoveryGenerateMnemonic,
    onSuccess: async (bundle) => {
      setPhrase(bundle.mnemonic);
      const idx = await recoveryVerificationIndices(bundle.word_count);
      setIndices(idx);
      setStep("reveal");
    },
  });

  const words = phrase.split(/\s+/).filter(Boolean);

  const startGenerate = () => {
    void twoFa.gate("show_recovery_phrase", () => generate.mutate(), {
      title: "Confirm recovery phrase setup with 2FA",
    });
  };

  const prompt = (
    <TwoFactorPrompt
      open={twoFa.open}
      title={twoFa.title}
      onVerified={twoFa.verified}
      onCancel={twoFa.cancel}
    />
  );

  if (step === "generate") {
    return (
      <>
        {prompt}
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            A 24-word recovery phrase is the master key to your wallet. Write it
            down on paper and store it somewhere safe. Anyone with this phrase
            can steal your coins.
          </p>
          <Button onClick={startGenerate} disabled={generate.isPending}>
            {generate.isPending ? "Generating…" : "Generate recovery phrase"}
          </Button>
          {onSkip && (
            <Button variant="secondary" onClick={onSkip}>
              Skip for now (not recommended)
            </Button>
          )}
        </div>
      </>
    );
  }

  if (step === "reveal") {
    return (
      <>
        {prompt}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Your recovery phrase</h3>
            <button
              type="button"
              onClick={() => setRevealed((v) => !v)}
              className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg"
            >
              {revealed ? (
                <EyeOff className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {revealed ? "Hide" : "Reveal"}
            </button>
          </div>
          <div
            className={`grid grid-cols-3 gap-2 rounded-lg border border-border p-4 ${
              revealed ? "bg-bg-subtle" : "bg-bg-subtle blur-sm select-none"
            }`}
          >
            {words.map((word, i) => (
              <div key={i} className="text-xs">
                <span className="text-fg-subtle">{i + 1}.</span> {word}
              </div>
            ))}
          </div>
          {revealed && (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(phrase);
                window.setTimeout(
                  () => void navigator.clipboard.writeText(""),
                  30_000,
                );
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy (clears in 30s)
            </Button>
          )}
          <label className="flex cursor-pointer items-start gap-2 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
              className="mt-0.5 accent-accent"
            />
            I have written down my recovery phrase and stored it securely
            offline.
          </label>
          <Button disabled={!acknowledged} onClick={() => setStep("verify")}>
            Continue to verification
          </Button>
        </div>
      </>
    );
  }

  if (step === "verify") {
    return (
      <>
        {prompt}
        <div className="flex flex-col gap-4">
          <p className="text-sm text-fg-muted">
            Confirm you wrote the phrase correctly by entering the requested
            words.
          </p>
          {indices.map((idx, i) => (
            <div key={idx} className="flex flex-col gap-1">
              <label className="text-xs text-fg-muted">Word #{idx + 1}</label>
              <input
                type="text"
                autoComplete="off"
                spellCheck={false}
                value={answers[i]}
                onChange={(e) => {
                  const next = [...answers];
                  next[i] = e.target.value;
                  setAnswers(next);
                }}
                className="h-9 rounded-md border border-border bg-bg-subtle px-3 text-sm outline-none focus:border-accent"
              />
            </div>
          ))}
          {verifyError && (
            <p className="flex items-center gap-1 text-xs text-danger">
              <AlertTriangle className="h-3.5 w-3.5" />
              {verifyError}
            </p>
          )}
          <Button
            onClick={async () => {
              const ok = await recoveryVerifyWords(phrase, indices, answers);
              if (!ok) {
                setVerifyError("Words do not match. Check your written copy.");
                return;
              }
              setVerifyError(null);
              try {
                await onComplete(phrase);
                setStep("done");
              } catch (err) {
                setVerifyError(String(err));
              }
            }}
          >
            Verify phrase
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm text-success">
      <CheckCircle2 className="h-4 w-4" />
      Recovery phrase verified.
    </div>
  );
}
