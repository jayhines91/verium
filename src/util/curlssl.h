// Copyright (c) 2026 The Verium developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_UTIL_CURLSSL_H
#define BITCOIN_UTIL_CURLSSL_H

#include <cstddef>
#include <string>

#ifndef CURLINC
typedef void CURL;
#endif

/** Discover CA sources once (safe to call repeatedly). */
void InitCurlSsl();

/** Apply CA trust store and peer verification to a curl easy handle. */
void ApplyCurlSslOptions(CURL* handle);

/** Resolved system or shipped CA bundle file, or empty if using embedded only. */
const std::string& GetSystemCaFile();

/** Resolved CA directory (OpenSSL hash dir), or empty if none found. */
const std::string& GetSystemCaPath();

/** Bundled Mozilla CA PEM compiled into the binary (always available). */
const char* GetEmbeddedCaPem();

/** Size of GetEmbeddedCaPem(), excluding the terminating NUL. */
std::size_t GetEmbeddedCaPemSize();

/** True when HTTPS will use the embedded Mozilla CA bundle. */
bool UsingEmbeddedCaBundle();

#endif // BITCOIN_UTIL_CURLSSL_H
