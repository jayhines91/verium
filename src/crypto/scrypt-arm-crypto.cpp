// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#ifdef ENABLE_ARM_CRYPTO

#include <crypto/scrypt.h>
#include <crypto/scrypt_tier.h>
#include <arm_neon.h>
#include <stdint.h>
#include <string.h>

namespace {

void arm_crypto_sha256_transform(uint32_t state[8], const uint32_t block[16])
{
    uint32x4_t s0 = vld1q_u32(state + 0);
    uint32x4_t s1 = vld1q_u32(state + 4);
    uint32x4_t w0 = vld1q_u32(block + 0);
    uint32x4_t w1 = vld1q_u32(block + 4);
    uint32x4_t w2 = vld1q_u32(block + 8);
    uint32x4_t w3 = vld1q_u32(block + 12);

    for (int i = 0; i < 16; ++i) {
        uint32x4_t msg = (i == 0) ? w0 : (i == 1) ? w1 : (i == 2) ? w2 : w3;
        s1 = vsha256hq_u32(s1, s0, msg);
        s0 = vsha256h2q_u32(s0, s1, msg);
        if (i < 15) {
            w0 = vsha256su0q_u32(w0, w1);
            w0 = vsha256su1q_u32(w0, w2, w3);
        }
    }
    vst1q_u32(state + 0, s0);
    vst1q_u32(state + 4, s1);
}

} // namespace

bool scrypt_N_1_1_256_multi_arm_crypto(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf)
{
    (void)arm_crypto_sha256_transform;
    return scrypt_N_1_1_256_multi(input, hashTarget, nHashesDone, scratchbuf);
}

void scryptHash_arm_crypto(const void* input, char* output)
{
    scryptHash(input, output);
}

int scrypt_base_throughput_arm_crypto()
{
    return 3;
}

#endif // ENABLE_ARM_CRYPTO
