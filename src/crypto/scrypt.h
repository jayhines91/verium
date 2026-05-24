#ifndef BITCOIN_CRYPTO_SCRYPT_H
#define BITCOIN_CRYPTO_SCRYPT_H

#include <uint256.h>
#include <compat/byteswap.h>
#include <util/strencodings.h>
#include <inttypes.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

static const int SCRYPT_SCRATCHPAD_SIZE = 134218239;
static const int N = 1048576;

/** Parallel nonces for the active runtime dispatch tier. */
int scrypt_best_throughput();

bool scrypt_N_1_1_256_multi(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf);

void scryptHash(const void* input, char* output);
unsigned char* scrypt_buffer_alloc();

extern "C" void scrypt_core(uint32_t* X, uint32_t* V, int N);
extern "C" void sha256_transform(uint32_t* state, const uint32_t* block, int swap);

#if defined(__x86_64__) || defined(_M_X64)

#define HAVE_SHA256_4WAY 1
#define HAVE_SCRYPT_3WAY 1
extern "C" int sha256_use_4way();
extern "C" void sha256_init_4way(uint32_t* state);
extern "C" void sha256_transform_4way(uint32_t* state, const uint32_t* block, int swap);
extern "C" void scrypt_core_3way(uint32_t* X, uint32_t* V, int N);

#if defined(ENABLE_AVX2)
#define HAVE_SHA256_8WAY 1
#define HAVE_SCRYPT_6WAY 1
extern "C" int sha256_use_8way();
extern "C" void sha256_init_8way(uint32_t* state);
extern "C" void sha256_transform_8way(uint32_t* state, const uint32_t* block, int swap);
extern "C" void scrypt_core_6way(uint32_t* X, uint32_t* V, int N);
#endif

#if defined(ENABLE_AVX512)
#define HAVE_SCRYPT_8WAY 1
extern "C" void scrypt_core_8way(uint32_t* X, uint32_t* V, int N);
#endif

#if defined(ENABLE_AVX512)
#define SCRYPT_MAX_WAYS 48
#elif defined(ENABLE_AVX2)
#define SCRYPT_MAX_WAYS 24
#else
#define SCRYPT_MAX_WAYS 12
#endif

#elif defined(__i386__)

#define SCRYPT_MAX_WAYS 4
#define HAVE_SHA256_4WAY 1
extern "C" int sha256_use_4way();
extern "C" void sha256_init_4way(uint32_t* state);
extern "C" void sha256_transform_4way(uint32_t* state, const uint32_t* block, int swap);

#elif defined(__arm__) && defined(__APCS_32__)

extern "C" void scrypt_core(uint32_t* X, uint32_t* V, int N);
#define SCRYPT_MAX_WAYS 1

#if defined(__ARM_NEON)
#undef HAVE_SHA256_4WAY
#define SCRYPT_MAX_WAYS 3
#define HAVE_SCRYPT_3WAY 1
void scrypt_core_3way(uint32_t *X, uint32_t *V, int N);
#endif

#elif defined(__aarch64__)

#include <arm_neon.h>

#undef HAVE_SHA256_4WAY
#define SCRYPT_MAX_WAYS 3
#define HAVE_SCRYPT_3WAY 1
extern "C" void sha256_init(uint32_t *state);
extern "C" void scrypt_core(uint32_t* X, uint32_t* V, int N);
extern "C" void scrypt_core_3way(uint32_t B[32 * 3], uint32_t *V, uint32_t N);

#if defined(ENABLE_ARM_CRYPTO)
#define HAVE_ARM_SHA256 1
#endif

#else

#define SCRYPT_MAX_WAYS 1

#endif

#ifndef SCRYPT_MAX_WAYS
#define SCRYPT_MAX_WAYS 1
#endif

static inline uint32_t swab32(uint32_t v)
{
    return bswap_32(v);
}

#endif // BITCOIN_CRYPTO_SCRYPT_H
