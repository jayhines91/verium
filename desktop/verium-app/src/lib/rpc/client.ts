import { invoke } from "@tauri-apps/api/core";
import type { CoinId } from "@/lib/coin/profile";
import {
  parseVericoinMiningInfo,
  type VericoinMiningInfo,
} from "@/lib/staking-stats";

export type { VericoinMiningInfo };

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
  reindex_in_progress?: boolean;
  reindex_header?: number;
  daemon_phase?: string;
  sync_stalled?: boolean;
  sync_stall_detail?: string;
  state?: string;
  recovery_hint?: string;
  needs_bootstrap?: boolean;
  user_message?: string;
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
  scanning?: false | { duration: number; progress: number };
  stake?: number;
  newmint?: number;
  staketime?: number;
  unlocked_minting_only?: boolean;
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
  blockhash?: string;
  blockindex?: number;
  blocktime?: number;
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
  config: DaemonConfig;
}

export interface EarnLocalState {
  active: boolean;
  threads: number;
  started_at?: number;
}

export type MinerLocalState = EarnLocalState;
export type StakingLocalState = EarnLocalState;

export interface CoinProfileSummary {
  id: string;
  symbol: string;
  display_name: string;
  tagline: string;
  earn_mode: string;
  default_rpc_port: number;
  confirmations_matured: number;
}

export async function rpcGetCoinProfiles(): Promise<CoinProfileSummary[]> {
  return invoke<CoinProfileSummary[]>("get_coin_profiles");
}

export async function rpcGetNodeStatus(coin: CoinId): Promise<NodeStatus> {
  return invoke<NodeStatus>("get_node_status", { coin });
}

export async function rpcGetBlockchainInfo(coin: CoinId): Promise<BlockchainInfo> {
  return invoke<BlockchainInfo>("get_blockchain_info", { coin });
}

export async function rpcGetNetworkInfo(coin: CoinId): Promise<NetworkInfo> {
  return invoke<NetworkInfo>("get_network_info", { coin });
}

export async function rpcGetPeerInfo(coin: CoinId): Promise<PeerInfo[]> {
  return invoke<PeerInfo[]>("get_peer_info", { coin });
}

export interface AddedNodeInfo {
  addednode: string;
  connected: boolean;
}

export async function rpcGetAddedNodeInfo(coin: CoinId): Promise<AddedNodeInfo[]> {
  return invoke<AddedNodeInfo[]>("get_added_node_info", { coin });
}

export async function rpcAddNode(
  coin: CoinId,
  node: string,
  command: "add" | "onetry" | "remove",
): Promise<void> {
  return invoke<void>("add_node", { coin, node, command });
}

export async function rpcGetMiningInfo(coin: CoinId): Promise<MiningInfo> {
  return invoke<MiningInfo>("get_mining_info", { coin });
}

export async function rpcGetVericoinMiningInfo(): Promise<VericoinMiningInfo | null> {
  const raw = await invoke<unknown>("get_mining_info", { coin: "vericoin" });
  return parseVericoinMiningInfo(raw);
}

export async function rpcGetWalletInfo(coin: CoinId): Promise<WalletInfo | null> {
  return invoke<WalletInfo | null>("get_wallet_info", { coin });
}

export async function rpcGetNewAddress(coin: CoinId, label?: string): Promise<string> {
  return invoke<string>("get_new_address", { coin, label: label ?? "" });
}

export async function rpcListTransactions(
  coin: CoinId,
  count = 25,
  skip = 0,
): Promise<TransactionItem[]> {
  return invoke<TransactionItem[]>("list_transactions", { coin, count, skip });
}

export async function rpcListAddressGroupings(coin: CoinId): Promise<string[]> {
  return invoke<string[]>("list_address_groupings", { coin });
}

export async function rpcMinerStart(coin: CoinId, threads: number): Promise<MinerLocalState> {
  return invoke<MinerLocalState>("miner_start", { coin, threads });
}

export async function rpcMinerStop(coin: CoinId): Promise<MinerLocalState> {
  return invoke<MinerLocalState>("miner_stop", { coin });
}

export async function rpcGetMinerState(coin: CoinId): Promise<MinerLocalState> {
  return invoke<MinerLocalState>("get_miner_state", { coin });
}

export async function rpcStakingStart(coin: CoinId): Promise<StakingLocalState> {
  return invoke<StakingLocalState>("staking_start", { coin });
}

export async function rpcStakingStop(coin: CoinId): Promise<StakingLocalState> {
  return invoke<StakingLocalState>("staking_stop", { coin });
}

export async function rpcGetStakingState(coin: CoinId): Promise<StakingLocalState> {
  return invoke<StakingLocalState>("get_staking_state", { coin });
}

export async function rpcReserveBalanceSet(coin: CoinId, amount: number): Promise<void> {
  return invoke<void>("reserve_balance_set", { coin, amount });
}

export async function rpcWalletUnlock(
  coin: CoinId,
  passphrase: string,
  timeoutSeconds: number,
  mintingOnly?: boolean,
): Promise<void> {
  return invoke<void>("wallet_unlock", {
    coin,
    passphrase,
    timeoutSeconds,
    mintingOnly: mintingOnly ?? null,
  });
}

export async function rpcWalletLock(coin: CoinId): Promise<void> {
  return invoke<void>("wallet_lock", { coin });
}

export async function tauriTryAutoUnlockWallet(coin: CoinId): Promise<boolean> {
  return invoke<boolean>("try_auto_unlock_wallet", { coin });
}

export async function rpcSendToAddress(
  coin: CoinId,
  address: string,
  amount: number,
  comment?: string,
): Promise<string> {
  return invoke<string>("send_to_address", {
    coin,
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
  coin: CoinId,
  passphrase: string,
): Promise<WalletCreateResult> {
  return invoke<WalletCreateResult>("wallet_create_encrypted", { coin, passphrase });
}

export async function rpcWalletChangePassphrase(
  coin: CoinId,
  oldPassphrase: string,
  newPassphrase: string,
): Promise<void> {
  return invoke<void>("wallet_change_passphrase", {
    coin,
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
  coin: CoinId,
  destinationPath: string,
): Promise<WalletBackupResult> {
  return invoke<WalletBackupResult>("wallet_backup", { coin, destinationPath });
}

export interface WalletRestoreResult {
  success: boolean;
  destination: string;
  message: string;
  previous_wallet_backup?: string | null;
  rescan_started?: boolean;
}

export async function rpcWalletRestore(
  coin: CoinId,
  sourcePath: string,
): Promise<WalletRestoreResult> {
  return invoke<WalletRestoreResult>("wallet_restore", { coin, sourcePath });
}

export async function rpcWalletDumpPrivKey(coin: CoinId, address: string): Promise<string> {
  return invoke<string>("wallet_dump_privkey", { coin, address });
}

export async function rpcWalletImportPrivKey(
  coin: CoinId,
  privkey: string,
  label?: string,
  rescan = true,
): Promise<void> {
  return invoke<void>("wallet_import_privkey", { coin, privkey, label, rescan });
}

export async function rpcWalletSignMessage(
  coin: CoinId,
  address: string,
  message: string,
): Promise<string> {
  return invoke<string>("wallet_sign_message", { coin, address, message });
}

export async function rpcWalletVerifyMessage(
  coin: CoinId,
  address: string,
  signature: string,
  message: string,
): Promise<boolean> {
  return invoke<boolean>("wallet_verify_message", {
    coin,
    address,
    signature,
    message,
  });
}

export async function rpcWalletSetTxFee(coin: CoinId, feeRatePerKb: number): Promise<boolean> {
  return invoke<boolean>("wallet_set_tx_fee", { coin, feeRateVrmPerKb: feeRatePerKb });
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
  coin: CoinId,
  minconf = 1,
  maxconf = 9_999_999,
): Promise<UnspentOutput[]> {
  return invoke<UnspentOutput[]>("wallet_list_unspent", { coin, minconf, maxconf });
}

export interface WalletSendInput {
  txid: string;
  vout: number;
}

export async function rpcWalletSendWithInputs(
  coin: CoinId,
  inputs: WalletSendInput[],
  outputs: Record<string, number>,
  changeAddress?: string,
  feeRatePerKb?: number,
): Promise<string> {
  return invoke<string>("wallet_send_with_inputs", {
    coin,
    inputs,
    outputs,
    changeAddress,
    feeRateVrmPerKb: feeRatePerKb,
  });
}

export async function rpcRaw(
  coin: CoinId,
  method: string,
  params?: unknown[],
): Promise<unknown> {
  return invoke<unknown>("rpc_raw_call", { coin, method, params: params ?? [] });
}

export interface WalletFileStatus {
  exists: boolean;
  path: string;
  note?: string | null;
  backup_folder: string;
  suggested_backup_path: string;
}

export async function tauriWalletFileStatus(coin: CoinId): Promise<WalletFileStatus> {
  return invoke<WalletFileStatus>("wallet_file_status", { coin });
}

export interface FirstRunConfigResult {
  bootstrapped: boolean;
  config: DaemonConfig;
}

export async function tauriEnsureFirstRun(coin: CoinId): Promise<FirstRunConfigResult> {
  return invoke<FirstRunConfigResult>("ensure_first_run", { coin });
}

export async function tauriRestartAfterEncrypt(coin: CoinId): Promise<EnsureConnectResult> {
  return invoke<EnsureConnectResult>("restart_after_encrypt", { coin });
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

export async function tauriDiagnosticBundle(coin: CoinId): Promise<DiagnosticBundle> {
  return invoke<DiagnosticBundle>("diagnostic_bundle", { coin });
}

export async function rpcGetConfig(coin: CoinId): Promise<DaemonConfig> {
  return invoke<DaemonConfig>("get_daemon_config", { coin });
}

export async function rpcSetConfig(
  coin: CoinId,
  partial: DaemonConfigPartial,
): Promise<DaemonConfig> {
  return invoke<DaemonConfig>("set_daemon_config", { coin, partial });
}

export async function tauriTestRpcConnection(
  coin: CoinId,
  partial?: DaemonConfigPartial,
): Promise<RpcTestResult> {
  return invoke<RpcTestResult>("test_rpc_connection", { coin, partial: partial ?? null });
}

export async function tauriSetupRpcCredentials(
  coin: CoinId,
  partial?: DaemonConfigPartial,
): Promise<RpcCredentialsSetup> {
  return invoke<RpcCredentialsSetup>("setup_rpc_credentials", {
    coin,
    partial: partial ?? null,
  });
}

export async function tauriStartDaemon(coin: CoinId): Promise<void> {
  return invoke<void>("start_daemon", { coin });
}

export async function tauriStopDaemon(coin: CoinId): Promise<void> {
  return invoke<void>("stop_daemon", { coin });
}

/** Gracefully stop miners, stakers, daemons, and exit the wallet. */
export async function tauriQuitWallet(): Promise<void> {
  return invoke<void>("quit_wallet");
}

export async function tauriRestartDaemon(coin: CoinId): Promise<void> {
  return invoke<void>("restart_daemon", { coin });
}

export interface NodeConfFile {
  path: string;
  backup_path: string;
  content: string;
}

export type VeriumConfFile = NodeConfFile;

export async function tauriReadNodeConf(coin: CoinId): Promise<NodeConfFile> {
  return invoke<NodeConfFile>("read_verium_conf", { coin });
}

export async function tauriWriteNodeConf(
  coin: CoinId,
  content: string,
): Promise<NodeConfFile> {
  return invoke<NodeConfFile>("write_verium_conf", { coin, content });
}

export async function tauriOpenNodeConf(coin: CoinId): Promise<string> {
  return invoke<string>("open_verium_conf", { coin });
}

/** @deprecated use tauriReadNodeConf(coin) */
export async function tauriReadVeriumConf(coin: CoinId = "verium"): Promise<NodeConfFile> {
  return tauriReadNodeConf(coin);
}

/** @deprecated use tauriWriteNodeConf(coin, content) */
export async function tauriWriteVeriumConf(
  coin: CoinId,
  content: string,
): Promise<NodeConfFile> {
  return tauriWriteNodeConf(coin, content);
}

/** @deprecated use tauriOpenNodeConf(coin) */
export async function tauriOpenVeriumConf(coin: CoinId = "verium"): Promise<string> {
  return tauriOpenNodeConf(coin);
}

export async function tauriTailLogs(coin: CoinId, lines = 200): Promise<string[]> {
  return invoke<string[]>("tail_logs", { coin, lines });
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
  datadir_locked?: boolean;
  already_running?: boolean;
}

export interface DaemonRuntimeStatus {
  rpc_connected: boolean;
  datadir_locked: boolean;
  message: string;
  hint?: string;
}

export type VeriumdRuntimeStatus = DaemonRuntimeStatus;

export async function tauriDetectDaemonRuntime(coin: CoinId): Promise<DaemonRuntimeStatus> {
  return invoke<DaemonRuntimeStatus>("detect_veriumd_runtime", { coin });
}

export async function tauriEnsureDaemonConnected(coin: CoinId): Promise<EnsureConnectResult> {
  return invoke<EnsureConnectResult>("ensure_daemon_connected", { coin });
}

export interface ChainRepairResult {
  success: boolean;
  message: string;
  mode: string;
}

export async function tauriRepairChain(
  coin: CoinId,
  mode: "bootstrap" | "reindex-chainstate" | "reindex",
): Promise<ChainRepairResult> {
  return invoke<ChainRepairResult>("repair_chain", { coin, mode });
}

export async function tauriNodeRetry(coin: CoinId): Promise<void> {
  return invoke<void>("node_retry", { coin });
}

export async function tauriNodeResetCredentials(coin: CoinId): Promise<void> {
  return invoke<void>("node_reset_credentials", { coin });
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
    | "none";
  manageable: boolean;
  runtime: "bundled" | "windows" | "native" | "none";
  coin?: string;
  stub_sidecar?: boolean;
  missing_hint?: string;
}

export async function tauriDetectDaemon(coin: CoinId): Promise<DaemonBinaryStatus> {
  return invoke<DaemonBinaryStatus>("detect_daemon", { coin });
}

/** @deprecated use tauriDetectDaemon(coin) */
export async function tauriDetectVeriumd(coin: CoinId = "verium"): Promise<DaemonBinaryStatus> {
  return tauriDetectDaemon(coin);
}

export async function tauriImportBootstrap(
  coin: CoinId,
  localPath?: string | null,
): Promise<{
  success: boolean;
  message: string;
  restart_hint?: string;
}> {
  return invoke("import_bootstrap", {
    coin,
    localPath: localPath ?? null,
  });
}

export async function tauriCancelBootstrap(coin: CoinId): Promise<void> {
  return invoke<void>("cancel_bootstrap", { coin });
}

export async function tauriFetchExplorerStats(coin: CoinId) {
  return invoke("fetch_explorer_stats", { coin });
}

export async function tauriFetchExplorerBlocks(coin: CoinId, limit?: number) {
  return invoke("fetch_explorer_blocks", { coin, limit });
}

export async function tauriFetchExplorerTransactions(coin: CoinId, limit?: number) {
  return invoke("fetch_explorer_transactions", { coin, limit });
}

export async function tauriGetExplorerLogoUrl(coin: CoinId): Promise<string> {
  return invoke<string>("get_explorer_logo_url", { coin });
}

export async function tauriIsExplorerApiEnabled(): Promise<boolean> {
  return invoke<boolean>("is_explorer_api_enabled");
}

export interface AddressBookEntry {
  id: string;
  address: string;
  label: string;
  notes?: string;
  category: string;
  created_at: number;
  updated_at: number;
}

export async function tauriAddressBookList(coin: CoinId): Promise<AddressBookEntry[]> {
  return invoke<AddressBookEntry[]>("address_book_list", { coin });
}

export async function tauriAddressBookUpsert(
  coin: CoinId,
  entry: AddressBookEntry,
): Promise<AddressBookEntry> {
  return invoke<AddressBookEntry>("address_book_upsert", { coin, entry });
}

export async function tauriAddressBookDelete(coin: CoinId, id: string): Promise<void> {
  return invoke<void>("address_book_delete", { coin, id });
}
