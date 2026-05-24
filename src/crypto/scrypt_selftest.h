// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#ifndef BITCOIN_CRYPTO_SCRYPT_SELFTEST_H
#define BITCOIN_CRYPTO_SCRYPT_SELFTEST_H

#include <stdint.h>
#include <string>
#include <uint256.h>

/** Run KAT vectors against reference scryptHash; return empty string on success. */
std::string ScryptSelfTestReference();

/** Verify tier produces identical scryptHash output as reference for all KAT vectors. */
bool ScryptSelfTestTierMatchesReference(void (*hash_fn)(const void*, char*));

/** Verify parallel mining path finds the same PoW hashes as reference scryptHash. */
bool ScryptSelfTestMultiMatchesReference(bool (*multi_fn)(void*, uint256, int*, unsigned char*), int throughput);

/** KAT-only override for scrypt_N_1_1_256_multi lane count (defined in scrypt.cpp). */
void scrypt_selftest_set_forced_throughput(int throughput);
void scrypt_selftest_clear_forced_throughput();

#endif // BITCOIN_CRYPTO_SCRYPT_SELFTEST_H
