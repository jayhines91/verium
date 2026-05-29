use std::time::Duration;

/// Max wait for RPC after spawn on startup.
pub const STARTUP_RPC_WAIT: Duration = Duration::from_secs(90);

/// Cooldown after spawn before supervisor may start another daemon.
pub const SPAWN_COOLDOWN: Duration = Duration::from_secs(60);

/// How long to avoid auto-starting a second daemon after bootstrap restart.
pub const BOOTSTRAP_LOADING_GRACE: Duration = Duration::from_secs(300);

/// Minimum interval between automatic chain repair attempts for one coin.
pub const REPAIR_BACKOFF: Duration = Duration::from_secs(60);

/// Supervisor polling interval.
pub const SUPERVISOR_TICK: Duration = Duration::from_secs(30);

/// RPC client timeout for status polling while the chain index loads.
pub const STATUS_RPC_TIMEOUT: Duration = Duration::from_secs(30);

/// Default RPC call timeout.
pub const RPC_TIMEOUT: Duration = Duration::from_secs(8);

/// Auth mismatch auto-restart attempts before surfacing failure.
pub const AUTH_RETRY_MAX: u32 = 1;
