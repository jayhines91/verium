//! Installer / sidecar signature verification (Sigstore cosign public key check).

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerificationStatus {
    pub app_verified: bool,
    pub sidecar_verified: bool,
    pub message: String,
    pub checked_at: i64,
}

/// Best-effort verification of bundled binaries.
/// Full cosign verification requires network access to Sigstore; this checks
/// embedded manifest hashes when present.
pub fn verify_installation() -> AppResult<VerificationStatus> {
    let exe = std::env::current_exe().ok();
    let mut app_ok = false;
    let mut sidecar_ok = false;
    let mut messages = Vec::new();

    if let Some(path) = exe {
        if path.exists() {
            if let Ok(hash) = sha256_file(&path) {
                app_ok = check_manifest_hash("app", &hash);
                if app_ok {
                    messages.push("App binary hash matches release manifest.".into());
                } else {
                    messages.push(
                        "App binary hash not in manifest — install from official releases only."
                            .into(),
                    );
                }
            }
        }
    }

    let sidecar_paths = [
        "binaries/veriumd-x86_64-pc-windows-msvc.exe",
        "binaries/veriumd-x86_64-unknown-linux-gnu",
        "binaries/veriumd-x86_64-apple-darwin",
    ];
    for rel in sidecar_paths {
        let path = resolve_resource(rel);
        if path.exists() {
            if let Ok(hash) = sha256_file(&path) {
                if check_manifest_hash("veriumd", &hash) {
                    sidecar_ok = true;
                    messages.push(format!("Sidecar {} verified.", rel));
                    break;
                }
            }
        }
    }
    if !sidecar_ok {
        messages.push(
            "Sidecar hash not verified — download veriumd from files.vericonomy.com only.".into(),
        );
    }

    Ok(VerificationStatus {
        app_verified: app_ok,
        sidecar_verified: sidecar_ok,
        message: messages.join(" "),
        checked_at: chrono::Utc::now().timestamp(),
    })
}

fn sha256_file(path: &std::path::Path) -> AppResult<String> {
    use sha2::{Digest, Sha256};
    let bytes = std::fs::read(path)?;
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    Ok(hex::encode(hasher.finalize()))
}

fn resolve_resource(rel: &str) -> std::path::PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.join(rel);
        }
    }
    std::path::PathBuf::from(rel)
}

fn check_manifest_hash(component: &str, hash: &str) -> bool {
    let manifest_path = resolve_resource("release-hashes.json");
    if !manifest_path.exists() {
        return false;
    }
    let Ok(raw) = std::fs::read_to_string(manifest_path) else {
        return false;
    };
    let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return false;
    };
    manifest
        .get(component)
        .and_then(|v| v.as_str())
        .map(|expected| expected.eq_ignore_ascii_case(hash))
        .unwrap_or(false)
}

pub fn write_release_hashes(app_hash: &str, sidecar_hash: &str) -> AppResult<()> {
    let manifest = serde_json::json!({
        "app": app_hash,
        "veriumd": sidecar_hash,
        "generated_at": chrono::Utc::now().to_rfc3339(),
    });
    let path = crate::config::app_config_base().join("release-hashes.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(path, serde_json::to_string_pretty(&manifest)?)?;
    Ok(())
}
