use std::time::Duration;

/// Max wait for RPC after spawn on startup.
pub const STARTUP_RPC_WAIT: Duration = Duration::from_secs(90);

/// Cooldown after spawn before supervisor may start another daemon.
pub const SPAWN_COOLDOWN: Duration = Duration::from_secs(60);

/// How long to avoid auto-starting a second daemon after bootstrap restart.
pub const BOOTSTRAP_LOADING_GRACE: Duration = Duration::from_secs(300);

/// Unified bootstrap runs `-reindex` for hours; keep supervisor from competing that long.
pub const POST_BOOTSTRAP_REINDEX_GRACE: Duration = Duration::from_secs(24 * 3600);

/// Slow header verification can go minutes between log lines during `-reindex`.
pub const REINDEX_LOG_MAX_AGE: Duration = Duration::from_secs(600);

/// Minimum interval between automatic chain repair attempts for one coin.
pub const REPAIR_BACKOFF: Duration = Duration::from_secs(60);

/// How often to retry `reconsiderblock` for invalid-block sync stalls (background only).
pub const INVALID_CLEAR_COOLDOWN: Duration = Duration::from_secs(8);

/// Background loop interval for invalid-block self-heal.
pub const INVALID_BLOCK_HEAL_TICK: Duration = Duration::from_secs(12);

/// Vericoin: pause P2P when chain blocks run this far ahead of txindex sync height.
pub const TXINDEX_PAUSE_BLOCK_LAG: u64 = 5_000;

/// Vericoin: resume P2P when txindex is within this many blocks of the chain tip.
pub const TXINDEX_RESUME_BLOCK_LAG: u64 = 2_000;

/// Supervisor polling interval.
pub const SUPERVISOR_TICK: Duration = Duration::from_secs(30);

/// RPC client timeout for status polling while the chain index loads.
pub const STATUS_RPC_TIMEOUT: Duration = Duration::from_secs(30);

/// Default RPC call timeout.
pub const RPC_TIMEOUT: Duration = Duration::from_secs(8);

/// Auth mismatch auto-restart attempts before surfacing failure.
pub const AUTH_RETRY_MAX: u32 = 1;
