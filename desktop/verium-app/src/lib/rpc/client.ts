import { invoke } from "@tauri-apps/api/core";

export interface NodeStatus {
  connected: boolean;
  warming_up?: boolean;
  chain?: string;
  blocks?: number;
  headers?: number;
  verification_progress?: number;
  initial_block_download?: boolean;
  connections?: number;
  warnings?: string;
  version?: number;
  subversion?: string;
  error?: string;
  chain_corrupt?: boolean;
  chain_repair_detail?: string;
  sync_stalled?: boolean;
  sync_stall_detail?: string;
}

export interface BlockchainInfo {
  chain: string;
  blocks: number;
  headers: number;
  bestblockhash: string;
  difficulty: number;
  mediantime: number;
  verificationprogress: number;
  initialblockdownload: boolean;
  size_on_disk: number;
  pruned: boolean;
  warnings: string;
}

export interface NetworkInfo {
  version: number;
  subversion: string;
  protocolversion: number;
  connections: number;
  networkactive: boolean;
  warnings: string;
}

export interface PeerInfo {
  id: number;
  addr: string;
  subver: string;
  inbound: boolean;
  startingheight: number;
  synced_blocks: number;
  synced_headers?: number;
  pingtime?: number;
  conntime: number;
  version: number;
}

export interface MiningInfo {
  blocks: number;
  blockreward: number;
  blocktime: number;
  blocksperhour: number;
  chain: string;
  difficulty: number;
  estimateblockrate: number;
  hashrate: number;
  networkhashps: number;
  pooledtx: number;
  warnings: string;
}

export interface WalletInfo {
  walletname: string;
  walletversion: number;
  balance: number;
  unconfirmed_balance: number;
  immature_balance: number;
  txcount: number;
  unlocked_until?: number;
  keypoolsize?: number;
}

export interface TransactionItem {
  address?: string;
  category: string;
  amount: number;
  fee?: number;
  confirmations: number;
  txid: string;
  time: number;
  timereceived: number;
  comment?: string;
  blockheight?: number;
}

export interface DaemonConfig {
  datadir: string;
  rpc_host: string;
  rpc_port: number;
  chain: string;
  rpc_user?: string;
  rpc_password_set: boolean;
  cookie_path?: string;
}

export interface DaemonConfigPartial {
  datadir?: string;
  rpc_host?: string;
  rpc_port?: number;
  chain?: string;
  rpc_user?: string;
  rpc_password?: string;
}

export interface RpcTestResult {
  ok: boolean;
  reachable: boolean;
  authenticated: boolean;
  warming_up?: boolean;
  auth_method: string;
  cookie_present: boolean;
  message: string;
  chain?: string;
  blocks?: number;
  conf_path: string;
  creds_in_conf: boolean;
  likely_datadir_mismatch: boolean;
  rpc_credentials_stale?: boolean;
  hint?: string;
}

export interface RpcCredentialsSetup {
  rpc_user: string;
  rpc_password: string;
  config: DaemonConfig;
}

export interface MinerLocalState {
  active: boolean;
  threads: number;
  started_at?: number;
}

export async function rpcGetNodeStatus(): Promise<NodeStatus> {
  return invoke<NodeStatus>("get_node_status");
}

export async function rpcGetBlockchainInfo(): Promise<BlockchainInfo> {
  return invoke<BlockchainInfo>("get_blockchain_info");
}

export async function rpcGetNetworkInfo(): Promise<NetworkInfo> {
  return invoke<NetworkInfo>("get_network_info");
}

export async function rpcGetPeerInfo(): Promise<PeerInfo[]> {
  return invoke<PeerInfo[]>("get_peer_info");
}

export interface AddedNodeInfo {
  addednode: string;
  connected: boolean;
}

export async function rpcGetAddedNodeInfo(): Promise<AddedNodeInfo[]> {
  return invoke<AddedNodeInfo[]>("get_added_node_info");
}

export async function rpcAddNode(
  node: string,
  command: "add" | "onetry" | "remove",
): Promise<void> {
  return invoke<void>("add_node", { node, command });
}

export async function rpcGetMiningInfo(): Promise<MiningInfo> {
  return invoke<MiningInfo>("get_mining_info");
}

export async function rpcGetWalletInfo(): Promise<WalletInfo | null> {
  return invoke<WalletInfo | null>("get_wallet_info");
}

export async function rpcGetNewAddress(label?: string): Promise<string> {
  return invoke<string>("get_new_address", { label: label ?? "" });
}

export async function rpcListTransactions(
  count = 25,
  skip = 0,
): Promise<TransactionItem[]> {
  return invoke<TransactionItem[]>("list_transactions", { count, skip });
}

export async function rpcListAddressGroupings(): Promise<string[]> {
  return invoke<string[]>("list_address_groupings");
}

export async function rpcMinerStart(threads: number): Promise<MinerLocalState> {
  return invoke<MinerLocalState>("miner_start", { threads });
}

export async function rpcMinerStop(): Promise<MinerLocalState> {
  return invoke<MinerLocalState>("miner_stop");
}

export async function rpcGetMinerState(): Promise<MinerLocalState> {
  return invoke<MinerLocalState>("get_miner_state");
}

export async function rpcWalletUnlock(
  passphrase: string,
  timeoutSeconds: number,
): Promise<void> {
  return invoke<void>("wallet_unlock", {
    passphrase,
    timeoutSeconds,
  });
}

export async function rpcWalletLock(): Promise<void> {
  return invoke<void>("wallet_lock");
}

export async function rpcSendToAddress(
  address: string,
  amount: number,
  comment?: string,
): Promise<string> {
  return invoke<string>("send_to_address", {
    address,
    amount,
    comment: comment ?? "",
  });
}

export interface WalletCreateResult {
  success: boolean;
  message: string;
  daemon_stopped: boolean;
}

export async function rpcWalletCreateEncrypted(
  passphrase: string,
): Promise<WalletCreateResult> {
  return invoke<WalletCreateResult>("wallet_create_encrypted", { passphrase });
}

export async function rpcWalletChangePassphrase(
  oldPassphrase: string,
  newPassphrase: string,
): Promise<void> {
  return invoke<void>("wallet_change_passphrase", {
    oldPassphrase,
    newPassphrase,
  });
}

export interface WalletBackupResult {
  success: boolean;
  destination: string;
  message: string;
}

export async function rpcWalletBackup(
  destinationPath: string,
): Promise<WalletBackupResult> {
  return invoke<WalletBackupResult>("wallet_backup", { destinationPath });
}

export async function rpcWalletDumpPrivKey(address: string): Promise<string> {
  return invoke<string>("wallet_dump_privkey", { address });
}

export async function rpcWalletImportPrivKey(
  privkey: string,
  label?: string,
  rescan = true,
): Promise<void> {
  return invoke<void>("wallet_import_privkey", { privkey, label, rescan });
}

export async function rpcWalletSignMessage(
  address: string,
  message: string,
): Promise<string> {
  return invoke<string>("wallet_sign_message", { address, message });
}

export async function rpcWalletVerifyMessage(
  address: string,
  signature: string,
  message: string,
): Promise<boolean> {
  return invoke<boolean>("wallet_verify_message", {
    address,
    signature,
    message,
  });
}

export async function rpcWalletSetTxFee(
  feeRateVrmPerKb: number,
): Promise<boolean> {
  return invoke<boolean>("wallet_set_tx_fee", { feeRateVrmPerKb });
}

export interface UnspentOutput {
  txid: string;
  vout: number;
  address?: string;
  label?: string;
  amount: number;
  confirmations: number;
  spendable?: boolean;
  solvable?: boolean;
}

export async function rpcWalletListUnspent(
  minconf = 1,
  maxconf = 9_999_999,
): Promise<UnspentOutput[]> {
  return invoke<UnspentOutput[]>("wallet_list_unspent", { minconf, maxconf });
}

export interface WalletSendInput {
  txid: string;
  vout: number;
}

export async function rpcWalletSendWithInputs(
  inputs: WalletSendInput[],
  outputs: Record<string, number>,
  changeAddress?: string,
  feeRateVrmPerKb?: number,
): Promise<string> {
  return invoke<string>("wallet_send_with_inputs", {
    inputs,
    outputs,
    changeAddress,
    feeRateVrmPerKb,
  });
}

export async function rpcRaw(
  method: string,
  params?: unknown[],
): Promise<unknown> {
  return invoke<unknown>("rpc_raw_call", { method, params: params ?? [] });
}

export interface WalletFileStatus {
  exists: boolean;
  path: string;
}

export async function tauriWalletFileStatus(): Promise<WalletFileStatus> {
  return invoke<WalletFileStatus>("wallet_file_status");
}

export interface FirstRunConfigResult {
  bootstrapped: boolean;
  config: DaemonConfig;
}

export async function tauriEnsureFirstRun(): Promise<FirstRunConfigResult> {
  return invoke<FirstRunConfigResult>("ensure_first_run");
}

export async function tauriRestartAfterEncrypt(): Promise<EnsureConnectResult> {
  return invoke<EnsureConnectResult>("restart_after_encrypt");
}

export interface DiagnosticBundle {
  app_version: string;
  os: string;
  timestamp: string;
  datadir: string;
  daemon_runtime: string;
  daemon_path?: string;
  log_tail: string[];
}

export async function tauriDiagnosticBundle(): Promise<DiagnosticBundle> {
  return invoke<DiagnosticBundle>("diagnostic_bundle");
}

export async function rpcGetConfig(): Promise<DaemonConfig> {
  return invoke<DaemonConfig>("get_daemon_config");
}

export async function rpcSetConfig(
  partial: DaemonConfigPartial,
): Promise<DaemonConfig> {
  return invoke<DaemonConfig>("set_daemon_config", { partial });
}

export async function tauriTestRpcConnection(
  partial?: DaemonConfigPartial,
): Promise<RpcTestResult> {
  return invoke<RpcTestResult>("test_rpc_connection", { partial: partial ?? null });
}

export async function tauriSetupRpcCredentials(
  partial?: DaemonConfigPartial,
): Promise<RpcCredentialsSetup> {
  return invoke<RpcCredentialsSetup>("setup_rpc_credentials", {
    partial: partial ?? null,
  });
}

export async function tauriStartDaemon(): Promise<void> {
  return invoke<void>("start_daemon");
}

export async function tauriStopDaemon(): Promise<void> {
  return invoke<void>("stop_daemon");
}

export async function tauriRestartDaemon(): Promise<void> {
  return invoke<void>("restart_daemon");
}

export async function tauriTailLogs(lines = 200): Promise<string[]> {
  return invoke<string[]>("tail_logs", { lines });
}

export interface UpdateInfo {
  current: string;
  latest?: string;
  update_available: boolean;
  source: "cdn" | "manifest" | "none";
  download_url?: string;
  release_notes_url?: string;
  cdn_version?: string;
  manifest_version?: string;
}

export async function tauriCheckForUpdates(): Promise<UpdateInfo> {
  return invoke<UpdateInfo>("check_for_updates");
}

export interface EnsureConnectResult {
  connected: boolean;
  message: string;
}

export async function tauriEnsureDaemonConnected(): Promise<EnsureConnectResult> {
  return invoke<EnsureConnectResult>("ensure_daemon_connected");
}

export interface ChainRepairResult {
  success: boolean;
  message: string;
  mode: string;
}

export async function tauriRepairChain(
  mode: "bootstrap" | "reindex-chainstate" | "reindex",
): Promise<ChainRepairResult> {
  return invoke<ChainRepairResult>("repair_chain", { mode });
}

export interface RebuildWslResult {
  success: boolean;
  message: string;
  log_tail: string;
}

export async function tauriRebuildWslVeriumdFix(): Promise<RebuildWslResult> {
  return invoke<RebuildWslResult>("rebuild_wsl_veriumd_validation_fix");
}

export interface DaemonBinaryStatus {
  found: boolean;
  path?: string;
  source:
    | "sidecar"
    | "env"
    | "adjacenttoapp"
    | "path"
    | "systemdefault"
    | "wsl"
    | "none";
  wsl_found: boolean;
  wsl_path?: string;
  manageable: boolean;
  runtime: "bundled" | "windows" | "wsl" | "none";
}

export async function tauriDetectVeriumd(): Promise<DaemonBinaryStatus> {
  return invoke<DaemonBinaryStatus>("detect_veriumd");
}

export async function tauriDetectWslDatadirs(): Promise<WslDatadirCandidate[]> {
  return invoke<WslDatadirCandidate[]>("detect_wsl_datadirs_cmd");
}

export interface WslDatadirCandidate {
  distro: string;
  unc_path: string;
  has_verium_conf: boolean;
  has_blocks_dir: boolean;
  has_cookie: boolean;
  score: number;
}

export async function tauriGetWslRestartHint(uncDatadir: string): Promise<string> {
  return invoke<string>("get_wsl_restart_hint", { uncDatadir });
}

export async function tauriRestartWslVeriumd(uncDatadir: string): Promise<void> {
  return invoke<void>("restart_wsl_veriumd_cmd", { uncDatadir });
}
