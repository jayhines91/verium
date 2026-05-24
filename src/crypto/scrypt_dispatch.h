// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#ifndef BITCOIN_CRYPTO_SCRYPT_DISPATCH_H
#define BITCOIN_CRYPTO_SCRYPT_DISPATCH_H

#include <stdint.h>
#include <uint256.h>

/** Active SIMD / ISA tier selected at runtime after KAT self-test. */
enum class ScryptDispatchTier {
    REFERENCE = 0,
    AVX2 = 1,
    AVX512 = 2,
    ARM_CRYPTO = 3,
    ARM_NEON = 4,
};

/** Detect CPU, validate all compiled tiers against reference KAT, pick fastest passing tier. */
bool ScryptDispatchInit();

ScryptDispatchTier ScryptDispatchTierActive();
const char* ScryptDispatchTierName(ScryptDispatchTier tier);
const char* ScryptDispatchTierNameActive();

/** Throughput (parallel nonces) for the active tier. */
int ScryptDispatchBestThroughput();
int ScryptDispatchActiveThroughput();

/** Mining hot path — dispatches to active tier. */
bool ScryptDispatch_N_1_1_256_multi(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf);

/** PoW hash (scrypt^2) — dispatches to active tier. */
void ScryptDispatchHash(const void* input, char* output);

/** Allocate scratch buffer (~128 MiB per thread) with huge-page hint when available. */
unsigned char* ScryptDispatchBufferAlloc();

void ScryptDispatchBufferFree(unsigned char* buf);

#endif // BITCOIN_CRYPTO_SCRYPT_DISPATCH_H
