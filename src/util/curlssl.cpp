// Copyright (c) 2026 The Verium developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <util/curlssl.h>

#include <logging.h>
#include <util/system.h>

#define CURL_STATICLIB
#include <curl/curl.h>

#include <cstdlib>
#include <cstring>
#include <mutex>

#ifdef WIN32
#include <windows.h>
#elif defined(__linux__)
#include <limits.h>
#include <unistd.h>
#elif defined(__APPLE__)
#include <limits.h>
#include <mach-o/dyld.h>
#endif

#include "certs/cacert_pem.inc"

namespace {
enum class CaSource {
    NONE,
    SYSTEM_FILE,
    SYSTEM_DIR,
    BUNDLED_FILE,
    EMBEDDED,
};

struct CaConfig {
    std::string cainfo;
    std::string capath;
    CaSource source{CaSource::NONE};
    bool logged{false};
};

CaConfig g_ca;
std::once_flag g_ca_once;

bool PathIsReadableFile(const std::string& path)
{
    if (path.empty()) return false;
    boost::system::error_code ec;
    return fs::exists(path, ec) && fs::is_regular_file(path, ec);
}

bool PathIsReadableDir(const std::string& path)
{
    if (path.empty()) return false;
    boost::system::error_code ec;
    return fs::exists(path, ec) && fs::is_directory(path, ec);
}

fs::path GetExeDir()
{
#ifdef WIN32
    char path[MAX_PATH];
    if (GetModuleFileNameA(nullptr, path, MAX_PATH) == 0) {
        return {};
    }
    return fs::path(path).remove_filename();
#elif defined(__linux__)
    char path[PATH_MAX];
    const ssize_t len = readlink("/proc/self/exe", path, sizeof(path) - 1);
    if (len <= 0) {
        return {};
    }
    path[len] = '\0';
    return fs::path(path).remove_filename();
#elif defined(__APPLE__)
    char path[PATH_MAX];
    uint32_t size = sizeof(path);
    if (_NSGetExecutablePath(path, &size) != 0) {
        return {};
    }
    boost::system::error_code ec;
    return fs::canonical(fs::path(path), ec).remove_filename();
#else
    return {};
#endif
}

std::string FindBundledCaFile()
{
    const fs::path exe_dir = GetExeDir();
    if (exe_dir.empty()) {
        return {};
    }

    static const char* const REL_PATHS[] = {
        "cacert.pem",
        "certs/cacert.pem",
        "../cacert.pem",
        "../certs/cacert.pem",
        nullptr,
    };

    for (const char* const* rel = REL_PATHS; *rel; ++rel) {
        const fs::path candidate = exe_dir / *rel;
        if (PathIsReadableFile(candidate.string())) {
            return candidate.string();
        }
    }
    return {};
}

const char* CaSourceLabel(CaSource source)
{
    switch (source) {
    case CaSource::SYSTEM_FILE: return "system file";
    case CaSource::SYSTEM_DIR: return "system directory";
    case CaSource::BUNDLED_FILE: return "bundled file";
    case CaSource::EMBEDDED: return "embedded Mozilla CA bundle";
    case CaSource::NONE: return "none";
    }
    return "unknown";
}

void LogCaSelection()
{
    if (g_ca.logged) {
        return;
    }
    g_ca.logged = true;
    LogPrintf("%s: using %s", __func__, CaSourceLabel(g_ca.source));
    if (!g_ca.cainfo.empty()) {
        LogPrintf(" file=%s", g_ca.cainfo);
    }
    if (!g_ca.capath.empty()) {
        LogPrintf(" capath=%s", g_ca.capath);
    }
    LogPrintf("\n");
}

void DiscoverCaPaths()
{
    const char* env_file = std::getenv("SSL_CERT_FILE");
    if (env_file && *env_file && PathIsReadableFile(env_file)) {
        g_ca.cainfo = env_file;
        g_ca.source = CaSource::SYSTEM_FILE;
    }
    const char* env_dir = std::getenv("SSL_CERT_DIR");
    if (env_dir && *env_dir && PathIsReadableDir(env_dir)) {
        g_ca.capath = env_dir;
        if (g_ca.source == CaSource::NONE) {
            g_ca.source = CaSource::SYSTEM_DIR;
        }
    }

    static const char* const CAFILE_CANDIDATES[] = {
        "/etc/ssl/certs/ca-certificates.crt", // Debian/Ubuntu
        "/etc/pki/tls/certs/ca-bundle.crt",   // RHEL/Fedora
        "/etc/ssl/ca-bundle.pem",             // openSUSE
        "/etc/pki/tls/cacert.pem",
        "/etc/ssl/cert.pem",                  // Alpine/BSD
        nullptr,
    };

    static const char* const CAPATH_CANDIDATES[] = {
        "/etc/ssl/certs",
        "/etc/pki/tls/certs",
        nullptr,
    };

    if (g_ca.cainfo.empty()) {
        for (const char* const* p = CAFILE_CANDIDATES; *p; ++p) {
            if (PathIsReadableFile(*p)) {
                g_ca.cainfo = *p;
                if (g_ca.source == CaSource::NONE) {
                    g_ca.source = CaSource::SYSTEM_FILE;
                }
                break;
            }
        }
    }
    if (g_ca.capath.empty()) {
        for (const char* const* p = CAPATH_CANDIDATES; *p; ++p) {
            if (PathIsReadableDir(*p)) {
                g_ca.capath = *p;
                if (g_ca.source == CaSource::NONE) {
                    g_ca.source = CaSource::SYSTEM_DIR;
                }
                break;
            }
        }
    }

    if (g_ca.cainfo.empty()) {
        const std::string bundled = FindBundledCaFile();
        if (!bundled.empty()) {
            g_ca.cainfo = bundled;
            g_ca.source = CaSource::BUNDLED_FILE;
        }
    }

    if (g_ca.cainfo.empty() && g_ca.capath.empty()) {
        g_ca.source = CaSource::EMBEDDED;
    }

    LogCaSelection();
}
} // namespace

void InitCurlSsl()
{
    std::call_once(g_ca_once, DiscoverCaPaths);
}

const std::string& GetSystemCaFile()
{
    InitCurlSsl();
    return g_ca.cainfo;
}

const std::string& GetSystemCaPath()
{
    InitCurlSsl();
    return g_ca.capath;
}

const char* GetEmbeddedCaPem()
{
    return EMBEDDED_CA_PEM;
}

std::size_t GetEmbeddedCaPemSize()
{
    return std::strlen(EMBEDDED_CA_PEM);
}

bool UsingEmbeddedCaBundle()
{
    InitCurlSsl();
    return g_ca.source == CaSource::EMBEDDED;
}

void ApplyCurlSslOptions(CURL* handle)
{
    if (!handle) return;
    InitCurlSsl();

    if (!g_ca.cainfo.empty()) {
        curl_easy_setopt(handle, CURLOPT_CAINFO, g_ca.cainfo.c_str());
    } else if (!g_ca.capath.empty()) {
        curl_easy_setopt(handle, CURLOPT_CAPATH, g_ca.capath.c_str());
    } else {
#if LIBCURL_VERSION_NUM >= 0x074d00
        struct curl_blob blob;
        blob.data = const_cast<char*>(EMBEDDED_CA_PEM);
        blob.len = std::strlen(EMBEDDED_CA_PEM);
        blob.flags = CURL_BLOB_NOCOPY;
        curl_easy_setopt(handle, CURLOPT_CAINFO_BLOB, &blob);
#else
        LogPrintf("%s: embedded CA bundle unavailable (curl too old); HTTPS may fail\n", __func__);
#endif
    }

    curl_easy_setopt(handle, CURLOPT_SSL_VERIFYPEER, 1L);
    curl_easy_setopt(handle, CURLOPT_SSL_VERIFYHOST, 2L);
}
