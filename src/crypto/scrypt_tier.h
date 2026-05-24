// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#ifndef BITCOIN_CRYPTO_SCRYPT_TIER_H
#define BITCOIN_CRYPTO_SCRYPT_TIER_H

#include <crypto/scrypt_dispatch.h>
#include <stdint.h>
#include <uint256.h>

struct ScryptTierOps {
    ScryptDispatchTier tier;
    const char* name;
    int base_throughput;
    bool (*multi)(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf);
    void (*hash)(const void* input, char* output);
};

#if defined(__x86_64__) || defined(_M_X64)
bool scrypt_N_1_1_256_multi_sse(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf);
void scryptHash_sse(const void* input, char* output);
int scrypt_base_throughput_sse();
#if defined(ENABLE_AVX2)
bool scrypt_N_1_1_256_multi_avx2(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf);
void scryptHash_avx2(const void* input, char* output);
int scrypt_base_throughput_avx2();
#endif
#if defined(ENABLE_AVX512)
bool scrypt_N_1_1_256_multi_avx512(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf);
void scryptHash_avx512(const void* input, char* output);
int scrypt_base_throughput_avx512();
#endif
#endif

#if defined(__aarch64__)
bool scrypt_N_1_1_256_multi_arm_neon(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf);
void scryptHash_arm_neon(const void* input, char* output);
int scrypt_base_throughput_arm_neon();
#if defined(ENABLE_ARM_CRYPTO)
bool scrypt_N_1_1_256_multi_arm_crypto(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf);
void scryptHash_arm_crypto(const void* input, char* output);
int scrypt_base_throughput_arm_crypto();
#endif
#endif

bool scrypt_N_1_1_256_multi_ref(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf);
void scryptHash_ref(const void* input, char* output);
int scrypt_base_throughput_ref();

#endif // BITCOIN_CRYPTO_SCRYPT_TIER_H
