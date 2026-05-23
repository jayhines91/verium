mod addressbook;
mod bootstrap;
mod commands;
mod config;
mod daemon;
mod error;
mod explorer_api;
mod logs;
mod prefs;
mod rpc;
mod state;
mod updates;
mod wsl;

use state::AppState;
use tauri::Manager;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("info,verium_app_lib=debug")),
        )
        .try_init();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let state = AppState::initialize(app.handle().clone())?;
            let startup_state = state.clone();
            tauri::async_runtime::spawn(async move {
                commands::startup_daemon_connect(&startup_state).await;
            });
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_node_status,
            commands::get_blockchain_info,
            commands::get_network_info,
            commands::get_peer_info,
            commands::get_added_node_info,
            commands::add_node,
            commands::get_mining_info,
            commands::get_wallet_info,
            commands::get_new_address,
            commands::list_transactions,
            commands::list_address_groupings,
            commands::miner_start,
            commands::miner_stop,
            commands::get_miner_state,
            commands::wallet_unlock,
            commands::wallet_lock,
            commands::wallet_create_encrypted,
            commands::wallet_change_passphrase,
            commands::wallet_backup,
            commands::wallet_dump_privkey,
            commands::wallet_import_privkey,
            commands::wallet_sign_message,
            commands::wallet_verify_message,
            commands::wallet_set_tx_fee,
            commands::wallet_list_unspent,
            commands::wallet_send_with_inputs,
            commands::rpc_raw_call,
            commands::send_to_address,
            commands::get_daemon_config,
            commands::set_daemon_config,
            commands::test_rpc_connection,
            commands::get_rpc_auth_diagnostics,
            commands::setup_rpc_credentials,
            commands::start_daemon,
            commands::stop_daemon,
            commands::restart_daemon,
            commands::tail_logs,
            commands::check_for_updates,
            commands::open_external_url,
            commands::detect_veriumd,
            commands::wallet_file_status,
            commands::ensure_first_run,
            commands::restart_after_encrypt,
            commands::get_user_preferences,
            commands::set_user_preferences,
            commands::import_bootstrap,
            commands::fetch_explorer_stats,
            commands::fetch_explorer_blocks,
            commands::fetch_explorer_transactions,
            commands::fetch_explorer_extraction,
            commands::fetch_explorer_chain_tips,
            commands::fetch_explorer_peers_cmd,
            commands::get_explorer_logo_url,
            commands::get_wsl_restart_hint,
            commands::restart_wsl_veriumd_cmd,
            commands::detect_wsl_datadirs_cmd,
            commands::ensure_daemon_connected,
            commands::repair_chain,
            commands::rebuild_wsl_veriumd_validation_fix,
            commands::address_book_list,
            commands::address_book_upsert,
            commands::address_book_delete,
            commands::diagnostic_bundle,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
