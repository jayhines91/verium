// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#ifdef ENABLE_AVX512

#include <crypto/scrypt.h>
#include <stdint.h>
#include <cstring>

extern "C" void scrypt_core(uint32_t* X, uint32_t* V, int N);
extern "C" void scrypt_core_6way(uint32_t* X, uint32_t* V, int N);

/** 8-way salsa20/8 core: 6-way AVX2 batch plus 2 scalar lanes sharing scratch V. */
extern "C" void scrypt_core_8way(uint32_t* X, uint32_t* V, int N)
{
    scrypt_core_6way(X, V, N);
    scrypt_core(X + 6 * 32, V, N);
    scrypt_core(X + 7 * 32, V, N);
}

#endif // ENABLE_AVX512
