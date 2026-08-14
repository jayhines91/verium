#include <downloader.h>

#include <clientversion.h>
#include <init.h>
#include <logging.h>
#include <net.h>
#include <util/activitylog.h>
#include <util/curlssl.h>
#include <util/system.h>
#include <validation.h>

#include <util/miniunz.h>
#define CURL_STATICLIB
#include <curl/curl.h>
#include <openssl/ssl.h>
#ifdef WIN32
#include <minizip/iowin32.h>
#endif

#include <util/time.h>

#include <atomic>
#include <algorithm>
#include <chrono>
#include <mutex>
#include <thread>

/*  Downloader functions for bootstrapping and updating client software

 * This xferinfo_data contains a callback function to be called
 * if the value is not nullptr.
 *
 * void xferinfo_data(curl_off_t total, curl_off_t now);
 *
 * This is admittedly ugly, but it allows us to get a percentage
 * callback in the GUI portion of code. by setting the xinfo_data.
 *
 * XXX it could use some rate limiting
 */
static void* xferinfo_data = nullptr;
static BootstrapStatusFn g_bootstrap_status_fn = nullptr;
static std::atomic<bool> g_download_cancelled{false};
static std::atomic<bool> g_bootstrap_retry_now{false};
static std::once_flag g_curl_init_once;
static curl_off_t g_bootstrap_resume_offset = 0;
static std::string g_bootstrap_shutdown_hint;
static bool g_bootstrap_network_paused = false;

extern std::unique_ptr<CConnman> g_connman;

static const char* BOOTSTRAP_APPLY_PENDING_FILE = ".bootstrap_apply_pending";

fs::path GetBootstrapApplyPendingPath()
{
    return GetDataDir() / BOOTSTRAP_APPLY_PENDING_FILE;
}

bool bootstrapStagingReady()
{
    const fs::path staging = GetDataDir() / "bootstrap";
    return fs::exists(staging / "blocks") &&
           fs::exists(staging / "chainstate");
}

bool bootstrapApplyPending()
{
    if (fs::exists(GetBootstrapApplyPendingPath()))
        return true;
    return bootstrapStagingReady();
}

void markBootstrapApplyPending()
{
    fsbridge::ofstream marker(GetBootstrapApplyPendingPath(), std::ios_base::app);
    if (!marker.good())
        throw std::runtime_error("bootstrap: Unable to write bootstrap apply marker");
    marker.close();
    LogActivity("Bootstrap: staged chain data ready; will apply on next startup");
}

void clearBootstrapApplyPending()
{
    const fs::path marker = GetBootstrapApplyPendingPath();
    if (fs::exists(marker)) {
        fs::remove(marker);
    }
}

void setBootstrapShutdownHint(const std::string& hint)
{
    g_bootstrap_shutdown_hint = hint;
}

std::string getBootstrapShutdownHint()
{
    return g_bootstrap_shutdown_hint;
}

void ensureDownloaderInit()
{
    std::call_once(g_curl_init_once, []() {
        curl_global_init(CURL_GLOBAL_ALL);
        InitCurlSsl();
    });
}

static size_t curlWriteToFile(void* ptr, size_t size, size_t nmemb, void* userdata)
{
    return fwrite(ptr, size, nmemb, static_cast<FILE*>(userdata));
}

void set_download_cancelled(bool cancel)
{
    g_download_cancelled.store(cancel);
}

bool download_cancelled()
{
    return g_download_cancelled.load();
}

void reset_download_cancel()
{
    g_download_cancelled.store(false);
    g_bootstrap_retry_now.store(false);
}

void requestBootstrapDownloadRetryNow()
{
    g_bootstrap_retry_now.store(true);
}

bool pauseNetworkForBootstrap()
{
    SetChainSyncPausedForBootstrap(true);

    if (!g_connman) {
        LogPrintf("bootstrap: connman not ready; chain sync paused only\n");
        return false;
    }
    if (g_bootstrap_network_paused) {
        return true;
    }
    const bool prior = g_connman->GetNetworkActive();
    if (!prior) {
        // SetNetworkActive(false) is a no-op when already inactive; toggle to force DisconnectNodes().
        g_connman->SetNetworkActive(true);
    }
    g_connman->SetNetworkActive(false);
    g_bootstrap_network_paused = true;
    LogActivity("Bootstrap: pausing P2P and chain sync during download and extract");
    LogPrintf("bootstrap: network paused for bootstrap (was %sactive)\n", prior ? "" : "in");
    return prior;
}

void restoreNetworkAfterBootstrap()
{
    SetChainSyncPausedForBootstrap(false);

    if (!g_bootstrap_network_paused) {
        return;
    }
    if (!g_connman) {
        g_bootstrap_network_paused = false;
        return;
    }
    g_connman->SetNetworkActive(true);
    g_bootstrap_network_paused = false;
    LogActivity("Bootstrap: resuming P2P and chain sync");
    LogPrintf("bootstrap: network restored (active=true)\n");
}

static int xferinfo(void *p,
                    curl_off_t dltotal, curl_off_t dlnow,
                    curl_off_t ultotal, curl_off_t ulnow)
{
    if (g_download_cancelled.load())
        return 1;
    void (*ptr)(curl_off_t, curl_off_t) = (void(*)(curl_off_t, curl_off_t))xferinfo_data;
    if (ptr != nullptr) {
        const curl_off_t now = g_bootstrap_resume_offset + dlnow;
        const curl_off_t total = dltotal > 0 ? g_bootstrap_resume_offset + dltotal : dltotal;
        ptr(now, total);
    }
    return 0; // continue xfer.
}

void set_xferinfo_data(void* d)
{
    xferinfo_data = d;
}

void set_bootstrap_status_fn(BootstrapStatusFn fn)
{
    g_bootstrap_status_fn = std::move(fn);
}

static void bootstrap_status(const char* message)
{
    if (!message || !*message)
        return;
    LogActivity("%s", message);
    if (g_bootstrap_status_fn)
        g_bootstrap_status_fn(message);
}

std::string getClientUrl() {
    return CLIENT_URL_VRM;
}

std::string getBootstrapArchiveFileName() {
    return BOOTSTRAP_FILE_VRM;
}

std::string getBootstrapDownloadUrl() {
    return strprintf("%s%s/%s", getClientUrl(), BOOTSTRAP_DIR, getBootstrapArchiveFileName());
}

uint64_t getBootstrapPartialBytes()
{
    const fs::path pathBootstrapZip = GetDataDir() / getBootstrapArchiveFileName();
    if (!boost::filesystem::exists(pathBootstrapZip))
        return 0;
    try {
        return static_cast<uint64_t>(boost::filesystem::file_size(pathBootstrapZip));
    } catch (...) {
        return 0;
    }
}

void clearBootstrapPartial()
{
    const fs::path pathBootstrapZip = GetDataDir() / getBootstrapArchiveFileName();
    if (boost::filesystem::exists(pathBootstrapZip)) {
        LogPrintf("bootstrap: Removing partial bootstrap archive %s\n", pathBootstrapZip.string());
        boost::filesystem::remove(pathBootstrapZip);
    }
}

static void waitBeforeBootstrapRetry(int seconds)
{
    g_bootstrap_retry_now.store(false);
    for (int elapsed = 0; elapsed < seconds * 10; ++elapsed) {
        if (g_download_cancelled.load()) {
            throw std::runtime_error("Download cancelled.");
        }
        if (g_bootstrap_retry_now.load()) {
            return;
        }
        UninterruptibleSleep(std::chrono::milliseconds{100});
    }
}

static bool isBootstrapDownloadFatalError(const std::string& message)
{
    return message.find("Download: fatal:") != std::string::npos;
}

static constexpr int kDownloadMaxAttempts = 8;

static bool isTransientHttpResponse(long code)
{
    return code == 408 || code == 429 || (code >= 500 && code <= 599);
}

static bool isFatalHttpResponse(long code)
{
    return code == 401 || code == 403 || code == 404;
}

static long parseHttpResponseCode(const std::string& message)
{
    long code = 0;
    const char* patterns[] = {
        "Server responded with %ld.",
        "Server responded with a %ld .",
        "Server responded with %ld",
        nullptr,
    };
    for (const char* const* p = patterns; *p; ++p) {
        if (sscanf(message.c_str(), *p, &code) == 1) {
            return code;
        }
    }
    return 0;
}

static bool isTransientDownloadError(const std::string& message)
{
    if (message.find("cancelled") != std::string::npos) {
        return false;
    }
    if (message.find("Download: fatal:") != std::string::npos) {
        return false;
    }
    const long code = parseHttpResponseCode(message);
    if (code != 0) {
        if (isFatalHttpResponse(code)) {
            return false;
        }
        if (isTransientHttpResponse(code)) {
            return true;
        }
        return false;
    }
    return message.find("Download: error:") != std::string::npos;
}

static void waitBeforeDownloadRetry(int seconds)
{
    for (int elapsed = 0; elapsed < seconds * 10; ++elapsed) {
        if (g_download_cancelled.load()) {
            throw std::runtime_error("Download cancelled.");
        }
        UninterruptibleSleep(std::chrono::milliseconds{100});
    }
}

/** Single curl attempt; may throw on transient errors (caller retries). */
static void downloadBootstrapArchiveOnce(const std::string& url, const fs::path& target_file_path)
{
    LogPrintf("Download: Downloading bootstrap from %s.\n", url);

    ensureDownloaderInit();

    curl_off_t resume_from = 0;
    if (boost::filesystem::exists(target_file_path)) {
        try {
            resume_from = static_cast<curl_off_t>(boost::filesystem::file_size(target_file_path));
            if (resume_from > 0) {
                LogPrintf("bootstrap: Resuming download at byte %lld\n", static_cast<long long>(resume_from));
            }
        } catch (...) {
            resume_from = 0;
        }
    }

    FILE* file = fsbridge::fopen(target_file_path, resume_from > 0 ? "ab" : "wb");
    if (!file)
        throw std::runtime_error(strprintf("Download: error: Unable to open output file for writing: %s.", target_file_path.string().c_str()));

    CURL* curlHandle = curl_easy_init();
    if (!curlHandle) {
        fclose(file);
        throw std::runtime_error("Download: error: curl_easy_init failed.");
    }

    char errbuf[CURL_ERROR_SIZE];
    errbuf[0] = 0;

    curl_easy_setopt(curlHandle, CURLOPT_ERRORBUFFER, errbuf);
    curl_easy_setopt(curlHandle, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curlHandle, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curlHandle, CURLOPT_NOPROGRESS, 0);
    curl_easy_setopt(curlHandle, CURLOPT_XFERINFODATA, xferinfo_data);
    curl_easy_setopt(curlHandle, CURLOPT_XFERINFOFUNCTION, xferinfo);
    curl_easy_setopt(curlHandle, CURLOPT_WRITEFUNCTION, curlWriteToFile);
    curl_easy_setopt(curlHandle, CURLOPT_WRITEDATA, file);
    curl_easy_setopt(curlHandle, CURLOPT_CONNECTTIMEOUT, 120L);
    curl_easy_setopt(curlHandle, CURLOPT_TCP_KEEPALIVE, 1L);
    /* Do not abort large bootstrap downloads for slow-but-steady links. */
    curl_easy_setopt(curlHandle, CURLOPT_LOW_SPEED_LIMIT, 0L);
    curl_easy_setopt(curlHandle, CURLOPT_LOW_SPEED_TIME, 0L);
    if (resume_from > 0) {
        curl_easy_setopt(curlHandle, CURLOPT_RESUME_FROM_LARGE, resume_from);
    }
    ApplyCurlSslOptions(curlHandle);

    g_bootstrap_resume_offset = resume_from;
    const CURLcode res = curl_easy_perform(curlHandle);
    g_bootstrap_resume_offset = 0;

    if (g_download_cancelled.load()) {
        curl_easy_cleanup(curlHandle);
        fclose(file);
        throw std::runtime_error("Download cancelled.");
    }

    long response_code = 0;
    curl_easy_getinfo(curlHandle, CURLINFO_RESPONSE_CODE, &response_code);

    if (res != CURLE_OK) {
        curl_easy_cleanup(curlHandle);
        fclose(file);
        const uint64_t partial = getBootstrapPartialBytes();
        const std::string partial_msg = partial > 0
            ? strprintf(" Partial download saved (%llu MB). Retry will resume.", partial / (1024 * 1024))
            : std::string();
        size_t len = strlen(errbuf);
        if (len) {
            throw std::runtime_error(strprintf("Download: error: %s%s%s", errbuf, ((errbuf[len - 1] != '\n') ? "\n" : ""), partial_msg));
        }
        throw std::runtime_error(strprintf("Download: error: %s.%s", curl_easy_strerror(res), partial_msg));
    }

    if (response_code == 416) {
        curl_easy_cleanup(curlHandle);
        fclose(file);
        LogPrintf("bootstrap: Server rejected resume (416); removing partial and restarting download\n");
        boost::filesystem::remove(target_file_path);
        throw std::runtime_error("Download: resume rejected by server.");
    }

    if (response_code == 404 || response_code == 403 || response_code == 401) {
        curl_easy_cleanup(curlHandle);
        fclose(file);
        throw std::runtime_error(strprintf("Download: fatal: Server responded with %ld.", response_code));
    }

    if (response_code != 200 && !(resume_from > 0 && response_code == 206)) {
        curl_easy_cleanup(curlHandle);
        fclose(file);
        throw std::runtime_error(strprintf("Download: error: Server responded with %ld.", response_code));
    }

    curl_easy_cleanup(curlHandle);
    fclose(file);

    LogPrintf("Download: Bootstrap archive download successful.\n");
}

/** Resume-capable download with automatic retry on flaky connections. */
static void downloadBootstrapArchive(const std::string& url, const fs::path& target_file_path)
{
    int attempt = 0;
    while (true) {
        if (g_download_cancelled.load()) {
            throw std::runtime_error("Download cancelled.");
        }
        ++attempt;
        try {
            downloadBootstrapArchiveOnce(url, target_file_path);
            return;
        } catch (const std::runtime_error& e) {
            if (g_download_cancelled.load()) {
                throw std::runtime_error("Download cancelled.");
            }
            const std::string msg = e.what();
            if (msg.find("cancelled") != std::string::npos) {
                throw;
            }
            if (isBootstrapDownloadFatalError(msg)) {
                throw;
            }

            const uint64_t partial = getBootstrapPartialBytes();
            const int delay_sec = std::min(5 * attempt, 60);
            const std::string status_msg = strprintf(
                "Download interrupted at %llu MB (attempt %d). Retrying in %d seconds...",
                partial / (1024 * 1024), attempt, delay_sec);
            bootstrap_status(status_msg.c_str());
            LogPrintf("bootstrap: download attempt %d failed: %s\n", attempt, msg.c_str());

            waitBeforeBootstrapRetry(delay_sec);
        }
    }
}

static void downloadFileOnce(const std::string& url, const fs::path& target_file_path)
{
    FILE *file = fsbridge::fopen(target_file_path, "wb");
    if (!file) {
        throw std::runtime_error(strprintf("Download: error: Unable to open output file for writing: %s.", target_file_path.string().c_str()));
    }

    CURL *curlHandle = curl_easy_init();
    if (!curlHandle) {
        fclose(file);
        throw std::runtime_error("Download: error: curl_easy_init failed.");
    }

    char errbuf[CURL_ERROR_SIZE];
    errbuf[0] = 0;

    curl_easy_setopt(curlHandle, CURLOPT_ERRORBUFFER, errbuf);
    curl_easy_setopt(curlHandle, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curlHandle, CURLOPT_FOLLOWLOCATION, 1L);
    curl_easy_setopt(curlHandle, CURLOPT_NOPROGRESS, 0);
    curl_easy_setopt(curlHandle, CURLOPT_XFERINFODATA, xferinfo_data);
    curl_easy_setopt(curlHandle, CURLOPT_XFERINFOFUNCTION, xferinfo);
    curl_easy_setopt(curlHandle, CURLOPT_WRITEFUNCTION, curlWriteToFile);
    curl_easy_setopt(curlHandle, CURLOPT_WRITEDATA, file);
    curl_easy_setopt(curlHandle, CURLOPT_CONNECTTIMEOUT, 60L);
    curl_easy_setopt(curlHandle, CURLOPT_LOW_SPEED_LIMIT, 512L);
    curl_easy_setopt(curlHandle, CURLOPT_LOW_SPEED_TIME, 600L);
    ApplyCurlSslOptions(curlHandle);

    const CURLcode res = curl_easy_perform(curlHandle);

    if (g_download_cancelled.load()) {
        curl_easy_cleanup(curlHandle);
        fclose(file);
        boost::filesystem::remove(target_file_path);
        throw std::runtime_error("Download cancelled.");
    }

    long response_code = 0;
    curl_easy_getinfo(curlHandle, CURLINFO_RESPONSE_CODE, &response_code);

    if (res != CURLE_OK) {
        curl_easy_cleanup(curlHandle);
        fclose(file);
        boost::filesystem::remove(target_file_path);
        size_t len = strlen(errbuf);
        if (len) {
            throw std::runtime_error(strprintf("Download: error: %s%s.", errbuf, ((errbuf[len - 1] != '\n') ? "\n" : "")));
        }
        throw std::runtime_error(strprintf("Download: error: %s.", curl_easy_strerror(res)));
    }

    if (response_code != 200) {
        curl_easy_cleanup(curlHandle);
        fclose(file);
        boost::filesystem::remove(target_file_path);
        if (isFatalHttpResponse(response_code)) {
            throw std::runtime_error(strprintf("Download: fatal: Server responded with %ld.", response_code));
        }
        throw std::runtime_error(strprintf("Download: error: Server responded with %ld.", response_code));
    }

    curl_easy_cleanup(curlHandle);
    fclose(file);
}

void downloadFile(std::string url, const fs::path& target_file_path)
{
    LogPrintf("Download: Downloading from %s.\n", url);

    ensureDownloaderInit();
    reset_download_cancel();

    int attempt = 0;
    while (true) {
        if (g_download_cancelled.load()) {
            throw std::runtime_error("Download cancelled.");
        }
        ++attempt;
        try {
            downloadFileOnce(url, target_file_path);
            LogPrintf("Download: Successful.\n");
            return;
        } catch (const std::runtime_error& e) {
            if (g_download_cancelled.load()) {
                throw std::runtime_error("Download cancelled.");
            }
            const std::string msg = e.what();
            if (msg.find("cancelled") != std::string::npos) {
                throw;
            }
            if (!isTransientDownloadError(msg) || attempt >= kDownloadMaxAttempts) {
                throw;
            }
            const int delay_sec = std::min(5 * attempt, 60);
            LogPrintf("download: attempt %d failed (%s); retrying in %d seconds\n",
                attempt, msg.c_str(), delay_sec);
            waitBeforeDownloadRetry(delay_sec);
        }
    }
}


static unzFile OpenBootstrapZip(const fs::path& target_file_path)
{
    const fs::path abs_path = fs::absolute(target_file_path);
#ifdef WIN32
    /* Match fsbridge::fopen wide-path behavior; required for Zip64 (>4GB) archives on Windows. */
    zlib_filefunc64_def ffunc;
    fill_win32_filefunc64W(&ffunc);
    return unzOpen2_64(abs_path.wstring().c_str(), &ffunc);
#else
    return unzOpen64(abs_path.string().c_str());
#endif
}

// bootstrap
static void bootstrap_extract_progress(int files_done)
{
    const std::string msg = strprintf("Extracting archive (%d files processed)", files_done);
    bootstrap_status(msg.c_str());
}

void extractBootstrap(const fs::path& target_file_path) {
    LogPrintf("bootstrap: Extracting bootstrap %s.\n", target_file_path);

    if (!boost::filesystem::exists(target_file_path))
        throw std::runtime_error("bootstrap: Bootstrap archive not found");

    unzFile uf = OpenBootstrapZip(target_file_path);

    if (uf == NULL)
        throw std::runtime_error(strprintf("bootstrap: Cannot open bootstrap archive: %s\n", target_file_path.string()));

    const char * dest_subdir = nullptr;
    char first_entry[256] = {0};
    if (zip_get_first_entry_name(uf, first_entry, sizeof(first_entry))) {
        std::string name(first_entry);
        if (name.find("bootstrap/") != 0) {
            dest_subdir = "bootstrap";
            LogPrintf("bootstrap: Zip has top-level entries, extracting into bootstrap/.\n");
        }
    }

    int unzip_err = zip_extract_all(uf, GetDataDir(), "bootstrap", dest_subdir, bootstrap_extract_progress);
    if (unzip_err != UNZ_OK) {
        unzClose(uf);
        throw std::runtime_error("bootstrap: Unzip failed\n");
    }

    unzClose(uf);
    LogPrintf("bootstrap: Unzip successful\n");

    return;
}

void validateBootstrapContent() {


    LogPrintf("bootstrap: Checking Bootstrap Content\n");

    const fs::path staging = GetDataDir() / "bootstrap";
    std::string missing;
    if (!boost::filesystem::exists(staging / "blocks"))
        missing += " blocks";
    if (!boost::filesystem::exists(staging / "chainstate"))
        missing += " chainstate";
    if (!missing.empty()) {
        throw std::runtime_error(strprintf(
            "bootstrap: Downloaded zip file did not contain all necessary files (%s)!",
            missing.substr(1)));
    }

    if (!boost::filesystem::exists(staging / "indexes")) {
        LogPrintf("bootstrap: archive has no indexes/; optional indexes will be rebuilt after install\n");
        LogActivity("Bootstrap: no indexes in archive (will rebuild on startup if enabled)");
    }

}

static void copy_directory_recursive(const fs::path& src, const fs::path& dst)
{
    boost::system::error_code ec;
    fs::create_directories(dst, ec);
    if (ec) {
        throw std::runtime_error(strprintf("bootstrap: Unable to create %s: %s", dst.string(), ec.message()));
    }

    for (fs::directory_iterator it(src, ec), end; it != end; it.increment(ec)) {
        if (ec) {
            throw std::runtime_error(strprintf("bootstrap: Unable to read %s: %s", src.string(), ec.message()));
        }
        const fs::path from = it->path();
        const fs::path to = dst / from.filename();
        if (fs::is_directory(from)) {
            copy_directory_recursive(from, to);
        } else {
            fs::create_directories(to.parent_path(), ec);
            if (ec) {
                throw std::runtime_error(strprintf("bootstrap: Unable to create %s: %s", to.parent_path().string(), ec.message()));
            }
            fs::copy_file(from, to, fs::copy_option::overwrite_if_exists, ec);
            if (ec) {
                throw std::runtime_error(strprintf("bootstrap: Unable to copy %s: %s", from.string(), ec.message()));
            }
        }
    }
}

static void install_staged_directory(const fs::path& src, const fs::path& dst)
{
    boost::system::error_code ec;
    if (fs::exists(dst)) {
        fs::remove_all(dst, ec);
        if (ec) {
            throw std::runtime_error(strprintf("bootstrap: Unable to remove %s: %s", dst.string(), ec.message()));
        }
        ec.clear();
    }

    fs::rename(src, dst, ec);
    if (!ec) {
        return;
    }

    LogPrintf("bootstrap: rename %s -> %s failed (%s), copying instead\n",
              src.string(), dst.string(), ec.message().c_str());
    copy_directory_recursive(src, dst);
    fs::remove_all(src, ec);
    if (ec) {
        LogPrintf("bootstrap: warning: installed %s but failed to remove staging copy %s: %s\n",
                  dst.string(), src.string(), ec.message().c_str());
    }
}

void applyBootstrap() {
    LogActivity("Bootstrap apply: removing old blocks directory");
    boost::filesystem::remove_all(GetDataDir() / "blocks");
    LogActivity("Bootstrap apply: removing old chainstate directory");
    boost::filesystem::remove_all(GetDataDir() / "chainstate");
    LogActivity("Bootstrap apply: removing old indexes directory");
    boost::filesystem::remove_all(GetDataDir() / "indexes");
    LogActivity("Bootstrap apply: installing blocks from staging");
    install_staged_directory(GetDataDir() / "bootstrap" / "blocks", GetDataDir() / "blocks");
    LogActivity("Bootstrap apply: installing chainstate from staging");
    install_staged_directory(GetDataDir() / "bootstrap" / "chainstate", GetDataDir() / "chainstate");
    if (boost::filesystem::exists(GetDataDir() / "bootstrap" / "indexes")) {
        LogActivity("Bootstrap apply: installing indexes from staging");
        install_staged_directory(GetDataDir() / "bootstrap" / "indexes", GetDataDir() / "indexes");
    } else {
        LogActivity("Bootstrap apply: no indexes in archive; will rebuild on startup if enabled");
    }
    LogActivity("Bootstrap apply: removing staging directory");
    boost::filesystem::remove_all(GetDataDir() / "bootstrap");
    boost::filesystem::path pathBootstrapZip(GetDataDir() / getBootstrapArchiveFileName());
    boost::filesystem::path pathBootstrapLegacy(GetDataDir() / "bootstrap.zip");
    boost::filesystem::path pathBootstrap(GetDataDir() / "bootstrap.dat");
    if (boost::filesystem::exists(pathBootstrapZip)){
        boost::filesystem::remove(pathBootstrapZip);
    }
    if (boost::filesystem::exists(pathBootstrapLegacy)){
        boost::filesystem::remove(pathBootstrapLegacy);
    }
    if (boost::filesystem::exists(pathBootstrap)){
        boost::filesystem::remove(pathBootstrap);
    }
    LogActivity("Bootstrap apply: complete");
}

void downloadBootstrap() {
    const std::string url = getBootstrapDownloadUrl();
    const std::string archiveName = getBootstrapArchiveFileName();

    LogPrintf("bootstrap: Starting bootstrap from %s\n", url.c_str());

    pauseNetworkForBootstrap();

    ensureDownloaderInit();

    boost::filesystem::path pathBootstrapZip = GetDataDir() / archiveName;
    boost::filesystem::path pathBootstrapStaging = GetDataDir() / "bootstrap";

    if (boost::filesystem::exists(pathBootstrapStaging)) {
        bootstrap_status("Clearing previous bootstrap staging folder");
        LogPrintf("bootstrap: Removing existing bootstrap staging directory for clean extract.\n");
        boost::filesystem::remove_all(pathBootstrapStaging);
    }

    const uint64_t partial = getBootstrapPartialBytes();
    if (partial > 0) {
        const std::string resume_msg = strprintf("Resuming download of %s from %s (%llu MB saved)",
            archiveName.c_str(), url.c_str(), partial / (1024 * 1024));
        bootstrap_status(resume_msg.c_str());
    } else {
        const std::string start_msg = strprintf("Downloading %s from %s", archiveName.c_str(), url.c_str());
        bootstrap_status(start_msg.c_str());
    }

    downloadBootstrapArchive(url, pathBootstrapZip);
    {
        const std::string extract_msg = strprintf("Extracting %s (this can take several minutes)", archiveName.c_str());
        bootstrap_status(extract_msg.c_str());
    }
    extractBootstrap(pathBootstrapZip);
    bootstrap_status("Validating blocks and chainstate");
    validateBootstrapContent();

    markBootstrapApplyPending();
    setBootstrapShutdownHint("Bootstrap extracted. Restart Verium to install chain data and finish syncing.");

    bootstrap_status("Bootstrap ready — restart Verium to install chain data");
    LogPrintf("bootstrap: bootstrap process finished.\n");
}

// check for update
void downloadVersionFile() {
    LogPrintf("Check for update: Getting version file.\n");

    const boost::filesystem::path pathVersionFile = GetDataDir() / "VERSION.json";

    try {
        downloadFile(strprintf("%s/%d.%d/releases/%s%s", getClientUrl(),
            CLIENT_VERSION_MAJOR, CLIENT_VERSION_MINOR,
            FormatVersion(CLIENT_VERSION),
            VERSIONFILE_PATH), pathVersionFile);
    } catch (const std::exception& e) {
        LogPrintf("Check for update: unable to download version file: %s\n", e.what());
    }
}

void downloadClient(std::string fileName) {
    LogPrintf("Check for update: Downloading new client.\n");

    const boost::filesystem::path pathClientFile = GetDataDir() / fileName;
    downloadFile(strprintf("%s/%d.%d/releases/%s", getClientUrl(), CLIENT_VERSION_MAJOR, CLIENT_VERSION_MINOR, fileName), pathClientFile);
}

int getArchitecture()
{
    int *i;
    return sizeof(i) * 8; // 8 bits/byte
}
