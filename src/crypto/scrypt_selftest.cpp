// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#include <crypto/scrypt_selftest.h>

#include <crypto/scrypt.h>
#include <uint256.h>
#include <util/strencodings.h>

#include <cstring>
#include <string>

namespace {

static inline void be32enc(void *pp, uint32_t x)
{
    uint8_t *p = (uint8_t *)pp;
    p[3] = x & 0xff;
    p[2] = (x >> 8) & 0xff;
    p[1] = (x >> 16) & 0xff;
    p[0] = (x >> 24) & 0xff;
}

static inline uint32_t be32dec(const void *pp)
{
    const uint8_t *p = (uint8_t const *)pp;
    return ((uint32_t)(p[3]) + ((uint32_t)(p[2]) << 8) +
        ((uint32_t)(p[1]) << 16) + ((uint32_t)(p[0]) << 24));
}

struct KatVector {
    const char* name;
    uint8_t header[80];
};

static const KatVector KAT_VECTORS[] = {
    {
        "genesis_like",
        {
            0x01, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x3b, 0xa3, 0xed, 0xfd, 0x7b, 0x7b, 0x12, 0xbd, 0x4a, 0x7c, 0x11, 0x82,
            0x52, 0x35, 0x61, 0x13, 0x29, 0x8f, 0x33, 0xbf, 0x71, 0x45, 0x04, 0x1a,
            0x33, 0x39, 0x2f, 0x7f, 0x18, 0x59, 0x19, 0x00,
            0x00, 0x00, 0x00, 0x00,
            0xff, 0xff, 0x00, 0x1d,
            0x00, 0x00, 0x00, 0x00,
        },
    },
    {
        "mid_chain",
        {
            0x04, 0x00, 0x00, 0x00,
            0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01,
            0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x01, 0x23, 0x45, 0x67, 0x89,
            0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
            0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
            0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00,
            0x5f, 0x5e, 0x10, 0x0d,
            0xff, 0xff, 0x00, 0x1d,
            0x00, 0x00, 0x0a, 0x00,
        },
    },
    {
        "recent_tip_like",
        {
            0x04, 0x00, 0x00, 0x00,
            0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x12, 0x34, 0x56, 0x78,
            0x9a, 0xbc, 0xde, 0xf0, 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
            0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10,
            0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11, 0x22, 0x33, 0x44, 0x55,
            0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x00, 0x11,
            0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99,
            0x60, 0xea, 0x20, 0x0d,
            0xff, 0xff, 0x00, 0x1d,
            0x00, 0x01, 0x2c, 0x00,
        },
    },
};

} // namespace

std::string ScryptSelfTestReference()
{
    char a[32];
    char b[32];
    for (const auto& kat : KAT_VECTORS) {
        scryptHash(kat.header, a);
        scryptHash(kat.header, b);
        if (memcmp(a, b, 32) != 0) {
            return strprintf("scrypt reference non-deterministic on vector %s", kat.name);
        }
        bool all_zero = true;
        for (int i = 0; i < 32; ++i) {
            if (static_cast<unsigned char>(a[i]) != 0) {
                all_zero = false;
                break;
            }
        }
        if (all_zero) {
            return strprintf("scrypt reference returned zero hash on vector %s", kat.name);
        }
    }
    return {};
}

bool ScryptSelfTestTierMatchesReference(void (*hash_fn)(const void*, char*))
{
    char ref[32];
    char tier[32];
    for (const auto& kat : KAT_VECTORS) {
        scryptHash(kat.header, ref);
        hash_fn(kat.header, tier);
        if (memcmp(ref, tier, 32) != 0) {
            return false;
        }
    }
    return true;
}

bool ScryptSelfTestMultiMatchesReference(bool (*multi_fn)(void*, uint256, int*, unsigned char*), int throughput)
{
    if (throughput <= 0) {
        return false;
    }

    unsigned char* scratch = scrypt_buffer_alloc();
    if (!scratch) {
        return false;
    }

    scrypt_selftest_set_forced_throughput(throughput);

    bool ok = true;
    for (const auto& kat : KAT_VECTORS) {
        for (int lane = 0; lane < throughput && ok; ++lane) {
            uint8_t expectHeader[80];
            memcpy(expectHeader, kat.header, 80);
            const uint32_t baseNonce = be32dec(&((const uint32_t*)expectHeader)[19]);
            be32enc(&((uint32_t*)expectHeader)[19], baseNonce + static_cast<uint32_t>(lane));

            char expectHash[32];
            scryptHash(expectHeader, expectHash);

            uint256 target;
            memcpy(target.begin(), expectHash, 32);

            uint8_t miningHeader[80];
            memcpy(miningHeader, kat.header, 80);
            be32enc(&((uint32_t*)miningHeader)[19], baseNonce);

            int done = 0;
            if (!multi_fn(miningHeader, target, &done, scratch)) {
                ok = false;
                break;
            }

            char verifyHash[32];
            scryptHash(miningHeader, verifyHash);
            if (memcmp(verifyHash, expectHash, 32) != 0) {
                ok = false;
                break;
            }
        }
    }

    scrypt_selftest_clear_forced_throughput();
    free(scratch);
    return ok;
}
