#ifndef BITCOIN_DOWNLOADER_H
#define BITCOIN_DOWNLOADER_H

#if defined(HAVE_CONFIG_H)
#include <config/bitcoin-config.h>
#endif

#include <string>
#include <functional>

#if defined(__arm__) || defined(__aarch64__)
const std::string BOOTSTRAP_DIR("/bootstrap-arm");
#else
const std::string BOOTSTRAP_DIR("/bootstrap");
#endif

const std::string BOOTSTRAP_FILE_VRM("verium-bootstrap.zip");

const std::string VERSIONFILE_PATH("/VERSION.json");

const std::string CLIENT_URL_VRM("https://files.vericonomy.com/vrm");

void downloadBootstrap();
void applyBootstrap();
/** True if bootstrap chain data is staged and should be applied on next startup. */
bool bootstrapApplyPending();
/** Mark bootstrap as ready to apply (called after successful extract). */
void markBootstrapApplyPending();
void clearBootstrapApplyPending();
/** Optional message for the shutdown window after bootstrap completes. */
void setBootstrapShutdownHint(const std::string& hint);
std::string getBootstrapShutdownHint();
void downloadVersionFile();
void downloadClient(std::string fileName);
int getArchitecture();

/** Call once before any curl use (thread-safe). */
void ensureDownloaderInit();

/** Hardcoded bootstrap archive name and full download URL (see downloader.h constants). */
std::string getBootstrapArchiveFileName();
std::string getBootstrapDownloadUrl();

/** Bytes already downloaded for the current bootstrap archive, if any. */
uint64_t getBootstrapPartialBytes();

/** Remove a partial bootstrap archive (e.g. user chose to sync from network). */
void clearBootstrapPartial();

/** Progress callback: void(curl_off_t now, curl_off_t total). Set via set_xferinfo_data. */
void set_xferinfo_data(void* callback);

/** Optional UI/status hook for bootstrap (may be called from worker thread). */
using BootstrapStatusFn = std::function<void(const char* message)>;
void set_bootstrap_status_fn(BootstrapStatusFn fn);

void set_download_cancelled(bool cancel);
bool download_cancelled();
void reset_download_cancel();

/** Skip the auto-retry wait and attempt download again immediately. */
void requestBootstrapDownloadRetryNow();

/** Pause P2P (disconnect peers, stop new connections) while bootstrap runs. */
bool pauseNetworkForBootstrap();
/** Restore P2P when the user abandons bootstrap (Skip). No-op if not paused by us. */
void restoreNetworkAfterBootstrap();

#endif // BITCOIN_DOWNLOADER_H
