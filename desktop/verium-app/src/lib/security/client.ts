import { invoke } from "@tauri-apps/api/core";
import type { CoinId } from "@/lib/coin/profile";

// ── Recovery ────────────────────────────────────────────────────────────────

export interface RecoveryPhraseBundle {
  mnemonic: string;
  word_count: number;
}

export async function recoveryGenerateMnemonic(): Promise<RecoveryPhraseBundle> {
  return invoke("recovery_generate_mnemonic");
}

export async function recoveryValidateMnemonic(phrase: string): Promise<boolean> {
  return invoke("recovery_validate_mnemonic", { phrase });
}

export async function recoveryVerificationIndices(wordCount = 24): Promise<number[]> {
  return invoke("recovery_verification_indices", { wordCount });
}

export async function recoveryVerifyWords(
  phrase: string,
  indices: number[],
  answers: string[],
): Promise<boolean> {
  return invoke("recovery_verify_words", { phrase, indices, answers });
}

export async function recoveryApplyHdSeed(
  coin: CoinId,
  phrase: string,
  bip39Passphrase?: string,
): Promise<string> {
  return invoke("recovery_apply_hd_seed", {
    coin,
    phrase,
    bip39Passphrase: bip39Passphrase ?? null,
  });
}

export async function recoveryWalletIsHd(coin: CoinId): Promise<boolean> {
  return invoke("recovery_wallet_is_hd", { coin });
}

// ── 2FA ─────────────────────────────────────────────────────────────────────

export interface TwoFactorConfig {
  enabled: boolean;
  secret_base32?: string | null;
  gated_actions: string[];
  send_threshold_vrm?: number | null;
  send_threshold_vrc?: number | null;
}

export interface TwoFactorEnrollment {
  secret_base32: string;
  otpauth_uri: string;
  recovery_codes: string[];
}

export async function twoFactorStatus(): Promise<TwoFactorConfig> {
  return invoke("two_factor_status");
}

export async function twoFactorStartEnrollment(): Promise<TwoFactorEnrollment> {
  return invoke("two_factor_start_enrollment");
}

export async function twoFactorConfirmEnrollment(
  code: string,
  enrollmentSecret?: string | null,
): Promise<void> {
  return invoke("two_factor_confirm_enrollment", {
    code,
    enrollmentSecret: enrollmentSecret ?? null,
  });
}

export async function twoFactorPendingOtpauthUri(): Promise<string | null> {
  return invoke("two_factor_pending_otpauth_uri");
}

export async function twoFactorVerify(code: string): Promise<boolean> {
  return invoke("two_factor_verify", { code });
}

export async function twoFactorDisable(code: string): Promise<void> {
  return invoke("two_factor_disable", { code });
}

export async function twoFactorIsGated(
  action: string,
  coin: CoinId,
  amount?: number,
): Promise<boolean> {
  return invoke("two_factor_is_gated", { action, coin, amount: amount ?? null });
}

// ── Passkey / PIN ───────────────────────────────────────────────────────────

export const PASSKEY_GATE_QUERY_KEY = ["passkey-gate"] as const;

export interface PasskeyConfig {
  enabled: boolean;
  use_pin_fallback: boolean;
  enrolled_at?: number | null;
}

export async function passkeyStatus(): Promise<PasskeyConfig> {
  return invoke("passkey_status");
}

export async function passkeyGateRequired(): Promise<boolean> {
  return invoke("passkey_gate_required");
}

export async function passkeyEnrollPin(pin: string): Promise<void> {
  return invoke("passkey_enroll_pin", { pin });
}

export async function passkeyVerifyPin(pin: string): Promise<boolean> {
  return invoke("passkey_verify_pin", { pin });
}

export async function passkeyDisable(pin: string): Promise<void> {
  return invoke("passkey_disable", { pin });
}

// ── Auto-lock ───────────────────────────────────────────────────────────────

export interface AutoLockConfig {
  enabled: boolean;
  idle_seconds: number;
  lock_on_blur: boolean;
  lock_on_sleep: boolean;
}

export async function autoLockGetConfig(): Promise<AutoLockConfig> {
  return invoke("auto_lock_get_config");
}

export async function autoLockSetConfig(config: AutoLockConfig): Promise<void> {
  return invoke("auto_lock_set_config", { config });
}

export async function autoLockRecordActivity(): Promise<void> {
  return invoke("auto_lock_record_activity");
}

export async function autoLockShouldLock(): Promise<boolean> {
  return invoke("auto_lock_should_lock");
}

// ── Audit log ───────────────────────────────────────────────────────────────

export interface AuditEntry {
  id: string;
  timestamp: number;
  action: string;
  detail: string;
  coin?: string | null;
  signature_hex?: string | null;
}

export async function auditLogList(limit = 100): Promise<AuditEntry[]> {
  return invoke("audit_log_list", { limit });
}

export async function auditLogExport(): Promise<string> {
  return invoke("audit_log_export");
}

export async function auditLogRecord(
  action: string,
  detail: string,
  coin?: CoinId,
): Promise<AuditEntry> {
  return invoke("audit_log_record", { action, detail, coin: coin ?? null });
}

// ── Receive requests ────────────────────────────────────────────────────────

export interface ReceiveRequest {
  id: string;
  created_at: number;
  label: string;
  message: string;
  amount: number | null;
  address: string;
}

export async function receiveRequestsList(coin: CoinId): Promise<ReceiveRequest[]> {
  return invoke("receive_requests_list", { coin });
}

export async function receiveRequestsSave(
  coin: CoinId,
  requests: ReceiveRequest[],
): Promise<void> {
  return invoke("receive_requests_save", { coin, requests });
}

// ── Hardware wallets ────────────────────────────────────────────────────────

export type HardwareVendor = "trezor" | "ledger" | "coldcard" | "manual";

export interface HardwareWalletConfig {
  id: string;
  vendor: HardwareVendor;
  label: string;
  xpub: string;
  derivation_path: string;
  fingerprint?: string | null;
  created_at: number;
}

export interface PsbtSendResult {
  psbt_base64: string;
  txid?: string | null;
  status: string;
}

export async function hardwareWalletList(): Promise<HardwareWalletConfig[]> {
  return invoke("hardware_wallet_list");
}

export async function hardwareWalletAdd(
  config: HardwareWalletConfig,
): Promise<HardwareWalletConfig> {
  return invoke("hardware_wallet_add", { config });
}

export async function hardwareWalletRemove(id: string): Promise<void> {
  return invoke("hardware_wallet_remove", { id });
}

export async function hardwareWalletDetect(): Promise<HardwareVendor[]> {
  return invoke("hardware_wallet_detect");
}

export async function hardwareWalletImportXpub(
  coin: CoinId,
  xpub: string,
  label: string,
): Promise<void> {
  return invoke("hardware_wallet_import_xpub", { coin, xpub, label });
}

export async function hardwareWalletSendPsbt(
  coin: CoinId,
  outputs: Record<string, number>,
  feeRate?: number,
): Promise<PsbtSendResult> {
  return invoke("hardware_wallet_send_psbt", { coin, outputs, feeRate: feeRate ?? null });
}

export async function hardwareWalletFinalizePsbt(
  coin: CoinId,
  psbtBase64: string,
): Promise<string> {
  return invoke("hardware_wallet_finalize_psbt", { coin, psbtBase64 });
}

// ── Multisig ────────────────────────────────────────────────────────────────

export interface MultisigCosigner {
  id: string;
  label: string;
  xpub: string;
  derivation_path: string;
}

export interface MultisigWalletConfig {
  id: string;
  label: string;
  required_sigs: number;
  total_cosigners: number;
  cosigners: MultisigCosigner[];
  multisig_address?: string | null;
  created_at: number;
}

export async function multisigList(): Promise<MultisigWalletConfig[]> {
  return invoke("multisig_list");
}

export async function multisigSave(wallet: MultisigWalletConfig): Promise<MultisigWalletConfig> {
  return invoke("multisig_save", { wallet });
}

export async function multisigRemove(id: string): Promise<void> {
  return invoke("multisig_remove", { id });
}

export async function multisigCreateAddress(
  coin: CoinId,
  required: number,
  pubkeys: string[],
  label: string,
): Promise<string> {
  return invoke("multisig_create_address", { coin, required, pubkeys, label });
}

// ── Spending controls ───────────────────────────────────────────────────────

export interface SpendingControlsConfig {
  daily_spend_cap_vrm?: number | null;
  daily_spend_cap_vrc?: number | null;
  allowlist_only: boolean;
  require_first_send_confirmation: boolean;
  clipboard_guard_enabled: boolean;
}

export interface SpendCheckResult {
  allowed: boolean;
  reason?: string | null;
  requires_extra_confirmation: boolean;
  look_alike_warning?: string | null;
}

export async function spendingControlsGet(): Promise<SpendingControlsConfig> {
  return invoke("spending_controls_get");
}

export async function spendingControlsSave(
  config: SpendingControlsConfig,
): Promise<void> {
  return invoke("spending_controls_save", { config });
}

export async function spendingControlsCheckSend(
  amount: number,
  coin: CoinId,
  address: string,
): Promise<SpendCheckResult> {
  return invoke("spending_controls_check_send", { amount, coin, address });
}

export async function spendingControlsRecordSend(
  amount: number,
  coin: CoinId,
  address: string,
): Promise<void> {
  return invoke("spending_controls_record_send", { amount, coin, address });
}

export async function spendingControlsCheckAllowlist(
  address: string,
  allowlist: string[],
): Promise<boolean> {
  return invoke("spending_controls_check_allowlist", { address, allowlist });
}

// ── Backup scheduler ──────────────────────────────────────────────────────────

export interface BackupSchedulerConfig {
  enabled: boolean;
  daily_retention: number;
  monthly_retention: number;
  interval_hours: number;
  last_run_at?: number | null;
  cloud_folder?: string | null;
}

type BackupSchedulerConfigRaw = BackupSchedulerConfig & {
  intervalHours?: number;
};

function normalizeBackupSchedulerConfig(
  raw: BackupSchedulerConfigRaw,
): BackupSchedulerConfig {
  return {
    ...raw,
    interval_hours: raw.interval_hours ?? raw.intervalHours ?? 24,
  };
}

export interface BackupHealth {
  last_backup_at?: number | null;
  last_verified_at?: number | null;
  backup_count: number;
  cloud_configured: boolean;
  scheduler_enabled: boolean;
}

type BackupHealthRaw = BackupHealth & {
  lastBackupAt?: number | null;
  lastVerifiedAt?: number | null;
  backupCount?: number;
  cloudConfigured?: boolean;
  schedulerEnabled?: boolean;
};

function normalizeBackupHealth(raw: BackupHealthRaw): BackupHealth {
  return {
    last_backup_at: raw.last_backup_at ?? raw.lastBackupAt ?? null,
    last_verified_at: raw.last_verified_at ?? raw.lastVerifiedAt ?? null,
    backup_count: raw.backup_count ?? raw.backupCount ?? 0,
    cloud_configured: raw.cloud_configured ?? raw.cloudConfigured ?? false,
    scheduler_enabled: raw.scheduler_enabled ?? raw.schedulerEnabled ?? false,
  };
}

export async function backupSchedulerGetConfig(): Promise<BackupSchedulerConfig> {
  const raw = await invoke<BackupSchedulerConfigRaw>("backup_scheduler_get_config");
  return normalizeBackupSchedulerConfig(raw);
}

export async function backupSchedulerSaveConfig(
  config: BackupSchedulerConfig,
): Promise<BackupSchedulerConfig> {
  const raw = await invoke<BackupSchedulerConfigRaw>("backup_scheduler_save_config", {
    config: {
      ...config,
      interval_hours: config.interval_hours,
    },
  });
  return normalizeBackupSchedulerConfig(raw);
}

export async function backupSchedulerSetInterval(
  intervalHours: number,
): Promise<BackupSchedulerConfig> {
  const raw = await invoke<BackupSchedulerConfigRaw>("backup_scheduler_set_interval", {
    intervalHours,
  });
  return normalizeBackupSchedulerConfig(raw);
}

export async function backupHealth(): Promise<BackupHealth> {
  const raw = await invoke<BackupHealthRaw>("backup_health");
  return normalizeBackupHealth(raw);
}

export async function backupRunNow(coin: CoinId): Promise<string> {
  return invoke("backup_run_now", { coin });
}

export interface ScheduledBackupResult {
  ran: boolean;
  paths: string[];
}

export async function backupRunScheduled(
  coins: CoinId[],
): Promise<ScheduledBackupResult> {
  return invoke("backup_run_scheduled", { coins });
}

export async function backupExportCloud(
  coin: CoinId,
  password: string,
): Promise<string> {
  return invoke("backup_export_cloud", { coin, password });
}

export async function backupVerify(path: string): Promise<boolean> {
  return invoke("backup_verify", { path });
}

// ── Shamir / SLIP-39 ────────────────────────────────────────────────────────

export interface ShamirShare {
  index: number;
  share_text: string;
}

export interface ShamirSplitResult {
  threshold: number;
  total: number;
  shares: ShamirShare[];
}

export async function slip39Split(
  mnemonic: string,
  threshold: number,
  total: number,
): Promise<ShamirSplitResult> {
  return invoke("slip39_split", { mnemonic, threshold, total });
}

export async function slip39Combine(shares: string[]): Promise<string> {
  return invoke("slip39_combine", { shares });
}

// ── Installer verification ────────────────────────────────────────────────────

export interface VerificationStatus {
  app_verified: boolean;
  sidecar_verified: boolean;
  message: string;
  checked_at: number;
}

export async function verifyInstallation(): Promise<VerificationStatus> {
  return invoke("verify_installation");
}

// ── BIP21 URIs ──────────────────────────────────────────────────────────────

export interface ParsedPaymentUri {
  scheme: string;
  address: string;
  amount?: number | null;
  label?: string | null;
  message?: string | null;
}

export async function parsePaymentUri(uri: string): Promise<ParsedPaymentUri> {
  return invoke("parse_payment_uri", { uri });
}

export async function buildPaymentUri(
  coin: CoinId,
  address: string,
  amount?: number,
  label?: string,
  message?: string,
): Promise<string> {
  return invoke("build_payment_uri", {
    coin,
    address,
    amount: amount ?? null,
    label: label ?? null,
    message: message ?? null,
  });
}
