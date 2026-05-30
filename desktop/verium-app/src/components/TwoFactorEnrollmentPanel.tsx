import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { TotpQrCode } from "@/components/TotpQrCode";
import {
  twoFactorConfirmEnrollment,
  twoFactorPendingOtpauthUri,
  twoFactorStartEnrollment,
  twoFactorStatus,
} from "@/lib/security/client";

const totpInputClass =
  "h-9 w-full max-w-[12rem] rounded-md border border-border bg-bg-subtle px-3 text-sm text-fg placeholder:text-fg-subtle outline-none focus:border-accent focus:ring-1 focus:ring-accent/30";

interface TwoFactorEnrollmentPanelProps {
  /** Called after 2FA is confirmed and enabled. */
  onEnabled?: () => void;
  /** Start TOTP enrollment as soon as the panel mounts (onboarding). */
  autoStartEnrollment?: boolean;
  /** Show a button to begin enrollment instead of auto-starting. */
  showStartButton?: boolean;
  className?: string;
}

export function TwoFactorEnrollmentPanel({
  onEnabled,
  autoStartEnrollment = false,
  showStartButton = false,
  className,
}: TwoFactorEnrollmentPanelProps) {
  const queryClient = useQueryClient();
  const [totpCode, setTotpCode] = useState("");
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ["two-factor"],
    queryFn: twoFactorStatus,
  });

  const pendingOtpauth = useQuery({
    queryKey: ["two-factor-pending-uri", status.data?.secret_base32],
    queryFn: twoFactorPendingOtpauthUri,
    enabled: Boolean(!status.data?.enabled && status.data?.secret_base32),
  });

  const enroll = useMutation({
    mutationFn: twoFactorStartEnrollment,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["two-factor"] });
      void queryClient.invalidateQueries({ queryKey: ["two-factor-pending-uri"] });
    },
  });

  const enrollmentSecret =
    enroll.data?.secret_base32 ?? status.data?.secret_base32 ?? null;
  const enrollmentOtpauth =
    enroll.data?.otpauth_uri ?? pendingOtpauth.data ?? null;
  const showEnrollmentPanel = Boolean(
    !status.data?.enabled && enrollmentSecret && enrollmentOtpauth,
  );

  const confirm = useMutation({
    mutationFn: ({ code, secret }: { code: string; secret: string }) =>
      twoFactorConfirmEnrollment(code, secret),
    onMutate: () => setConfirmError(null),
    onSuccess: async () => {
      setTotpCode("");
      setConfirmError(null);
      enroll.reset();
      queryClient.setQueryData(
        ["two-factor"],
        (prev: Awaited<ReturnType<typeof twoFactorStatus>> | undefined) => ({
          ...(prev ?? {
            enabled: false,
            gated_actions: [],
            secret_base32: null,
          }),
          enabled: true,
          secret_base32: null,
        }),
      );
      await queryClient.invalidateQueries({ queryKey: ["two-factor"] });
      await queryClient.invalidateQueries({ queryKey: ["two-factor-pending-uri"] });
      onEnabled?.();
    },
    onError: (err) => setConfirmError(String(err)),
  });

  const autoStartAttempted = useRef(false);
  useEffect(() => {
    if (!autoStartEnrollment || status.data?.enabled || showEnrollmentPanel) {
      return;
    }
    if (autoStartAttempted.current || enroll.isPending) return;
    autoStartAttempted.current = true;
    enroll.mutate();
  }, [
    autoStartEnrollment,
    status.data?.enabled,
    showEnrollmentPanel,
    enroll.isPending,
    enroll,
  ]);

  if (status.data?.enabled) {
    return (
      <p className="text-xs text-success">
        Two-factor authentication is enabled for this wallet app (all chains).
      </p>
    );
  }

  return (
    <div className={className}>
      {showStartButton && !showEnrollmentPanel && (
        <Button
          size="sm"
          onClick={() => enroll.mutate()}
          disabled={enroll.isPending}
          className="self-start"
        >
          {enroll.isPending ? "Starting…" : "Set up authenticator app"}
        </Button>
      )}
      {autoStartEnrollment && enroll.isPending && !showEnrollmentPanel && (
        <p className="text-xs text-fg-muted">Preparing your authenticator setup…</p>
      )}
      {enroll.error && (
        <p className="text-xs text-danger">{String(enroll.error)}</p>
      )}
      {showEnrollmentPanel && enrollmentSecret && enrollmentOtpauth && (
        <div className="space-y-3 rounded-md border border-border bg-bg-subtle p-4 text-xs">
          <TotpQrCode
            otpauthUri={enrollmentOtpauth}
            secretBase32={enrollmentSecret}
          />
          <p className="text-fg-muted">
            Enter the 6-digit code from your app to confirm. Use the QR or manual
            key shown here—do not start enrollment again or the code will change.
          </p>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={totpCode}
            onChange={(e) => {
              setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              setConfirmError(null);
            }}
            placeholder="6-digit code"
            className={totpInputClass}
          />
          {confirmError && <p className="text-danger">{confirmError}</p>}
          <Button
            size="sm"
            onClick={() => {
              if (totpCode.length < 6) {
                setConfirmError(
                  "Enter the full 6-digit code from your authenticator.",
                );
                return;
              }
              confirm.mutate({ code: totpCode, secret: enrollmentSecret });
            }}
            disabled={confirm.isPending || totpCode.length < 6}
          >
            {confirm.isPending ? "Confirming…" : "Confirm 2FA"}
          </Button>
          {enroll.data?.recovery_codes && (
            <details>
              <summary className="cursor-pointer text-fg-muted">
                Recovery codes (save these offline)
              </summary>
              <pre className="mt-1 whitespace-pre-wrap text-fg">
                {enroll.data.recovery_codes.join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
