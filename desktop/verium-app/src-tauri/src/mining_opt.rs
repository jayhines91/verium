//! CPU topology detection and scrypt benchmark helpers for the mining UI.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tauri::State;
use tokio::process::Command;
use tokio::time::timeout;

use crate::coin_profile::CoinId;
use crate::daemon::detect_binary;
use crate::error::{AppError, AppResult};
use crate::state::AppState;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuTopology {
    pub logical_cpus: u32,
    pub physical_cpus: u32,
    pub performance_cores: u32,
    pub efficiency_cores: u32,
    pub avx2: bool,
    pub avx512: bool,
    pub sha_ni: bool,
    pub arm_sha2: bool,
    pub suggested_mining_threads: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuUtilizationSnapshot {
    pub system_utilization_percent: f32,
    pub system_idle_percent: f32,
    pub daemon_utilization_percent: Option<f32>,
    /// Estimated CPU used by non-veriumd workloads (0–100).
    pub other_utilization_percent: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScryptBenchResult {
    pub tier: String,
    pub throughput: i32,
    pub bench_output: String,
    pub elapsed_ms: u64,
}

fn detect_x86_features() -> (bool, bool, bool) {
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    {
        let mut avx2 = false;
        let mut avx512 = false;
        let mut shani = false;
        unsafe {
            let leaf7 = std::arch::x86_64::__cpuid(7);
            avx2 = leaf7.ebx & (1 << 5) != 0;
            avx512 = leaf7.ebx & (1 << 16) != 0 && leaf7.ebx & (1 << 30) != 0;
            shani = leaf7.ebx & (1 << 29) != 0;
        }
        return (avx2, avx512, shani);
    }
    #[cfg(not(any(target_arch = "x86", target_arch = "x86_64")))]
    {
        (false, false, false)
    }
}

#[cfg(not(target_os = "macos"))]
fn macos_perf_cores() -> Option<u32> {
    None
}

#[cfg(target_os = "macos")]
fn macos_perf_cores() -> Option<u32> {
    use std::ffi::CStr;
    use std::os::raw::c_char;

    extern "C" {
        fn sysctlbyname(
            name: *const c_char,
            oldp: *mut std::ffi::c_void,
            oldlenp: *mut usize,
            newp: *const std::ffi::c_void,
            newlen: usize,
        ) -> i32;
    }

    let name = c"hw.perflevel0.physicalcpu";
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>();
    let rc = unsafe {
        sysctlbyname(
            name.as_ptr(),
            &mut value as *mut u32 as *mut std::ffi::c_void,
            &mut size,
            std::ptr::null(),
            0,
        )
    };
    if rc == 0 && value > 0 {
        Some(value)
    } else {
        None
    }
}

fn is_veriumd_process(name: &str) -> bool {
    name.eq_ignore_ascii_case("veriumd") || name.eq_ignore_ascii_case("veriumd.exe")
}

fn cpu_utilization_snapshot_sync() -> AppResult<CpuUtilizationSnapshot> {
    use sysinfo::{CpuRefreshKind, ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_cpu(CpuRefreshKind::everything())
            .with_processes(ProcessRefreshKind::nothing().with_cpu()),
    );
    sys.refresh_cpu_all();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_all();
    sys.refresh_processes(ProcessesToUpdate::All, true);

    let system_util = sys.global_cpu_usage();
    let system_idle = (100.0_f32 - system_util).max(0.0);

    let daemon_util = sys
        .processes()
        .values()
        .filter(|p| is_veriumd_process(&p.name().to_string_lossy()))
        .map(|p| p.cpu_usage())
        .reduce(f32::max);

    let other_util = daemon_util
        .map(|d| (system_util - d).max(0.0))
        .unwrap_or(system_util);

    Ok(CpuUtilizationSnapshot {
        system_utilization_percent: system_util,
        system_idle_percent: system_idle,
        daemon_utilization_percent: daemon_util,
        other_utilization_percent: other_util,
    })
}

#[tauri::command]
pub async fn cpu_utilization_snapshot() -> AppResult<CpuUtilizationSnapshot> {
    tokio::task::spawn_blocking(cpu_utilization_snapshot_sync)
        .await
        .map_err(|e| AppError::other(format!("cpu utilization snapshot failed: {e}")))?
}

#[tauri::command]
pub async fn cpu_topology() -> AppResult<CpuTopology> {
    let logical = std::thread::available_parallelism()
        .map(|n| n.get() as u32)
        .unwrap_or(4);
    let (avx2, avx512, sha_ni) = detect_x86_features();

    #[cfg(all(target_arch = "aarch64", target_os = "linux"))]
    let arm_sha2 = std::fs::read_to_string("/proc/cpuinfo")
        .map(|s| s.contains("sha2"))
        .unwrap_or(false);
    #[cfg(all(target_arch = "aarch64", target_os = "macos"))]
    let arm_sha2 = true;
    #[cfg(not(target_arch = "aarch64"))]
    let arm_sha2 = false;

    let performance_cores = macos_perf_cores().unwrap_or_else(|| {
        if logical > 1 {
            (logical + 1) / 2
        } else {
            logical
        }
    });
    let efficiency_cores = logical.saturating_sub(performance_cores);
    let physical = performance_cores.max(1);
    let suggested = performance_cores.max(1).min(logical);

    Ok(CpuTopology {
        logical_cpus: logical,
        physical_cpus: physical,
        performance_cores,
        efficiency_cores,
        avx2,
        avx512,
        sha_ni,
        arm_sha2,
        suggested_mining_threads: suggested,
    })
}

fn bench_sidecar_path() -> Option<PathBuf> {
    let veriumd = detect_binary(CoinId::Verium).path.map(PathBuf::from)?;
    let dir = veriumd.parent()?;
    let stem = if cfg!(windows) { "verium-bench.exe" } else { "verium-bench" };
    let candidate = dir.join(stem);
    if candidate.exists() {
        Some(candidate)
    } else {
        let alt = dir.join(if cfg!(windows) {
            "bench_verium.exe"
        } else {
            "bench/bench_verium"
        });
        if alt.exists() {
            Some(alt)
        } else {
            None
        }
    }
}

#[tauri::command]
pub async fn bench_scrypt(_state: State<'_, AppState>) -> AppResult<ScryptBenchResult> {
    let started = std::time::Instant::now();
    let tier = "unknown".to_string();
    let throughput = 0;

    let Some(bench) = bench_sidecar_path() else {
        return Ok(ScryptBenchResult {
            tier,
            throughput,
            bench_output: "verium-bench sidecar not found; build with --enable-bench".into(),
            elapsed_ms: started.elapsed().as_millis() as u64,
        });
    };

    let output = timeout(
        Duration::from_secs(120),
        Command::new(&bench)
            .arg("-filter=Scrypt")
            .arg("-evals=1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await
    .map_err(|_| AppError::other("scrypt benchmark timed out"))?
    .map_err(|e| AppError::other(format!("failed to run verium-bench: {e}")))?;

    let text = String::from_utf8_lossy(&output.stdout).into_owned()
        + &String::from_utf8_lossy(&output.stderr);

    Ok(ScryptBenchResult {
        tier,
        throughput,
        bench_output: text,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[tauri::command]
pub async fn battery_on_ac_power() -> AppResult<bool> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        if let Ok(out) = std::process::Command::new("powershell")
            .args([
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-Command",
                "(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue) -eq $null -or (Get-CimInstance -ClassName BatteryStatus -Namespace root/WMI -ErrorAction SilentlyContinue | Select-Object -First 1).PowerOnline -ne $false",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            if s.trim().eq_ignore_ascii_case("true") {
                return Ok(true);
            }
            if s.trim().eq_ignore_ascii_case("false") {
                return Ok(false);
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("pmset")
            .args(["-g", "batt"])
            .output()
        {
            let s = String::from_utf8_lossy(&out.stdout);
            if s.contains("AC Power") {
                return Ok(true);
            }
            if s.contains("Battery Power") {
                return Ok(false);
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        if let Ok(s) = std::fs::read_to_string("/sys/class/power_supply/AC/online") {
            return Ok(s.trim() == "1");
        }
    }
    Ok(true)
}
