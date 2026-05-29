import { QRCodeSVG } from "qrcode.react";

interface TotpQrCodeProps {
  otpauthUri: string;
  secretBase32: string;
  size?: number;
}

export function TotpQrCode({
  otpauthUri,
  secretBase32,
  size = 180,
}: TotpQrCodeProps) {
  return (
    <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
      <div className="rounded-lg border border-border bg-white p-3">
        <QRCodeSVG
          value={otpauthUri}
          size={size}
          level="M"
          includeMargin={false}
        />
      </div>
      <div className="flex flex-col gap-2 text-xs">
        <p className="text-fg-muted">
          Scan this QR code with Google Authenticator, Aegis, 1Password,
          Bitwarden, or another TOTP app.
        </p>
        <div>
          <div className="text-fg-subtle">Manual entry key</div>
          <p className="mt-0.5 break-all text-[11px]">{secretBase32}</p>
        </div>
      </div>
    </div>
  );
}
