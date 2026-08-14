#include <downloader.h>

#include <init.h>
#include <logging.h>
#include <util/curlssl.h>
#include <util/system.h>
#include <util/time.h>

#include <util/miniunz.h>
#define CURL_STATICLIB
#include <curl/curl.h>
#include <openssl/ssl.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <mutex>

/*  Downloader functions for bootstrapping and updating client software */
static void* xferinfo_data = nullptr;
static std::once_flag g_curl_init_once;
static std::atomic<bool> g_download_cancelled{false};

static int xferinfo(void *p,
                    curl_off_t dltotal, curl_off_t dlnow,
                    curl_off_t ultotal, curl_off_t ulnow)
{
    if (g_download_cancelled.load())
        return 1;
    void (*ptr)(curl_off_t, curl_off_t) = (void(*)(curl_off_t, curl_off_t))xferinfo_data;
    if (ptr != nullptr) ptr(dltotal, dlnow);
    return 0;
}

void set_xferinfo_data(void* d)
{
    xferinfo_data = d;
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

    int attempt = 0;
    while (true) {
        ++attempt;
        try {
            downloadFileOnce(url, target_file_path);
            LogPrintf("Download: Successful.\n");
            return;
        } catch (const std::runtime_error& e) {
            const std::string msg = e.what();
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

// bootstrap
void extractBootstrap(const fs::path& target_file_path) {
    LogPrintf("bootstrap: Extracting bootstrap %s.\n", target_file_path);

    if (!boost::filesystem::exists(target_file_path))
        throw std::runtime_error("bootstrap: Bootstrap archive not found");


    const char * zipfilename = target_file_path.string().c_str();
    unzFile uf;
#ifdef USEWIN32IOAPI
    zlib_filefunc64_def ffunc;
    fill_win32_filefunc64A(&ffunc);
    uf = unzOpen2_64(zipfilename, &ffunc);
#else
    uf = unzOpen64(zipfilename);
#endif

    if (uf == NULL)
        throw std::runtime_error(strprintf("bootstrap: Cannot open bootstrap archive: %s\n", zipfilename));

    const char * dest_subdir = nullptr;
    if (!gArgs.GetBoolArg("-testnet", false)) {
        /* Mainnet only: support zips with top-level blocks/chainstate (extract into bootstrap/ subdir) */
        char first_entry[256] = {0};
        if (zip_get_first_entry_name(uf, first_entry, sizeof(first_entry))) {
            std::string name(first_entry);
            if (name.find("bootstrap/") != 0) {
                dest_subdir = "bootstrap";
                LogPrintf("bootstrap: Zip has top-level entries, extracting into bootstrap/.\n");
            }
        }
    }
    /* Testnet: always use dest_subdir=nullptr (zip must have bootstrap/ prefix as before) */

    int unzip_err = zip_extract_all(uf, GetDataDir(), "bootstrap", dest_subdir);
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

    if (!boost::filesystem::exists(GetDataDir() / "bootstrap" / "chainstate") ||
        !boost::filesystem::exists(GetDataDir() / "bootstrap" / "blocks"))
        throw std::runtime_error("bootstrap: Downloaded zip file did not contain all necessary files!\n");

}

void applyBootstrap() {
    boost::filesystem::remove_all(GetDataDir() / "blocks");
    boost::filesystem::remove_all(GetDataDir() / "chainstate");
    boost::filesystem::rename(GetDataDir() / "bootstrap" / "blocks", GetDataDir() / "blocks");
    boost::filesystem::rename(GetDataDir() / "bootstrap" / "chainstate", GetDataDir() / "chainstate");
    boost::filesystem::remove_all(GetDataDir() / "bootstrap");
    boost::filesystem::path pathBootstrapTurbo(GetDataDir() / "bootstrap_VRM.zip");
    boost::filesystem::path pathBootstrap(GetDataDir() / "bootstrap.dat");
    if (boost::filesystem::exists(pathBootstrapTurbo)){
        boost::filesystem::remove(pathBootstrapTurbo);
    }
    if (boost::filesystem::exists(pathBootstrap)){
        boost::filesystem::remove(pathBootstrap);
    }
}

void downloadBootstrap() {
    LogPrintf("bootstrap: Starting bootstrap process.\n");

    boost::filesystem::path pathBootstrapZip = GetDataDir() / "bootstrap_VRM.zip";
    boost::filesystem::path pathBootstrapStaging = GetDataDir() / "bootstrap";

    /* Remove any existing staging dir so redownload is a clean overwrite */
    if (boost::filesystem::exists(pathBootstrapStaging)) {
        LogPrintf("bootstrap: Removing existing bootstrap staging directory for clean extract.\n");
        boost::filesystem::remove_all(pathBootstrapStaging);
    }

    downloadFile(BOOTSTRAP_URL, pathBootstrapZip);
    extractBootstrap(pathBootstrapZip);
    validateBootstrapContent();

    fBootstrap = true;

    LogPrintf("bootstrap: bootstrap process finished.\n");

    return;
}

// check for update
void downloadVersionFile() {
    LogPrintf("Check for update: Getting version file.\n");

    const boost::filesystem::path pathVersionFile = GetDataDir() / "VERSION_VRM.json";

    try {
        downloadFile(VERSIONFILE_URL, pathVersionFile);
    } catch (const std::exception& e) {
        LogPrintf("Check for update: unable to download version file: %s\n", e.what());
    }
}

void downloadClient(std::string fileName) {
    LogPrintf("Check for update: Downloading new client.\n");

    const boost::filesystem::path pathClientFile = GetDataDir() / fileName;
    const std::string clientFileUrl = CLIENT_URL + fileName;
    downloadFile(clientFileUrl, pathClientFile);
}

int getArchitecture()
{
    int *i;
    return sizeof(i) * 8; // 8 bits/byte
}
