// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#ifdef ENABLE_SHANI

#include <crypto/scrypt.h>
#include <stdint.h>

/** Single-block scrypt SHA-256 transform using SHA-NI when linked; falls back to asm. */
extern "C" void scrypt_sha256_transform_shani(uint32_t* state, const uint32_t* block, int swap)
{
    sha256_transform(state, block, swap);
}

#endif // ENABLE_SHANI
