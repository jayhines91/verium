// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#include <crypto/scrypt_dispatch.h>

#include <crypto/scrypt.h>
#include <crypto/scrypt_alloc.h>
#include <crypto/scrypt_selftest.h>
#include <crypto/scrypt_tier.h>
#include <logging.h>

#include <atomic>
#include <vector>

#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
#if defined(_MSC_VER)
#include <intrin.h>
#else
#include <cpuid.h>
#endif
#endif

#if defined(__linux__) && defined(__aarch64__)
#include <sys/auxv.h>
#ifndef HWCAP_SHA2
#define HWCAP_SHA2 (1 << 3)
#endif
#endif

namespace {

std::atomic<bool> g_dispatch_init{false};
ScryptDispatchTier g_active_tier{ScryptDispatchTier::REFERENCE};
int g_active_throughput{1};

bool (*g_multi_fn)(void*, uint256, int*, unsigned char*) = scrypt_N_1_1_256_multi;
void (*g_hash_fn)(const void*, char*) = scryptHash;

bool CpuHasAvx2()
{
#if defined(__x86_64__) || defined(_M_X64) || defined(__i386__) || defined(_M_IX86)
    unsigned int eax, ebx, ecx, edx;
#if defined(_MSC_VER)
    int info[4];
    __cpuid(info, 0);
    if (info[0] < 7) return false;
    __cpuidex(info, 7, 0);
    ebx = info[1];
#else
    if (__get_cpuid_max(0, nullptr) < 7) return false;
    __cpuid_count(7, 0, eax, ebx, ecx, edx);
#endif
    return (ebx & (1u << 5)) != 0;
#else
    return false;
#endif
}

bool CpuHasAvx512()
{
#if defined(__x86_64__) || defined(_M_X64)
    unsigned int eax, ebx, ecx, edx;
#if defined(_MSC_VER)
    int info[4];
    __cpuid(info, 0);
    if (info[0] < 7) return false;
    __cpuidex(info, 7, 0);
    ebx = info[1];
#else
    if (__get_cpuid_max(0, nullptr) < 7) return false;
    __cpuid_count(7, 0, eax, ebx, ecx, edx);
#endif
    return (ebx & (1u << 16)) != 0 && (ebx & (1u << 30)) != 0;
#else
    return false;
#endif
}

bool CpuHasArmSha2()
{
#if defined(__aarch64__)
#if defined(__linux__)
    return (getauxval(AT_HWCAP) & HWCAP_SHA2) != 0;
#elif defined(__APPLE__)
    return true;
#else
    return false;
#endif
#else
    return false;
#endif
}

int ComputeThroughput(int base)
{
    int throughput = base;
#if defined(HAVE_SHA256_4WAY)
    if (sha256_use_4way()) throughput *= 4;
#endif
#if defined(HAVE_SHA256_8WAY)
    if (sha256_use_8way() && base >= 6) throughput = 24;
#endif
#if defined(HAVE_SCRYPT_8WAY)
    if (base >= 8 && sha256_use_8way()) throughput = 48;
#endif
    return throughput;
}

struct TierCandidate {
    ScryptDispatchTier tier;
    const char* name;
    int base_throughput;
    bool (*multi)(void*, uint256, int*, unsigned char*);
    void (*hash)(const void*, char*);
    bool cpu_ok;
};

bool ValidateTier(TierCandidate& tier)
{
    if (!tier.cpu_ok) return false;
    if (!ScryptSelfTestTierMatchesReference(tier.hash)) {
        LogPrintf("Scrypt dispatch: tier %s failed scryptHash KAT self-test\n", tier.name);
        return false;
    }
    const int throughput = ComputeThroughput(tier.base_throughput);
    if (!ScryptSelfTestMultiMatchesReference(tier.multi, throughput)) {
        LogPrintf("Scrypt dispatch: tier %s failed mining multi KAT self-test (throughput %d)\n",
            tier.name, throughput);
        return false;
    }
    return true;
}

void SelectBestTier()
{
    std::vector<TierCandidate> candidates;

#if defined(__x86_64__) || defined(_M_X64)
#if defined(ENABLE_AVX512)
    candidates.push_back({ScryptDispatchTier::AVX512, "avx512", 8, scrypt_N_1_1_256_multi, scryptHash, CpuHasAvx512()});
#endif
#if defined(ENABLE_AVX2)
    candidates.push_back({ScryptDispatchTier::AVX2, "avx2", 6, scrypt_N_1_1_256_multi, scryptHash, CpuHasAvx2()});
#endif
    candidates.push_back({ScryptDispatchTier::REFERENCE, "sse3way", 3, scrypt_N_1_1_256_multi, scryptHash, true});
#elif defined(__aarch64__)
#if defined(ENABLE_ARM_CRYPTO)
    candidates.push_back({ScryptDispatchTier::ARM_CRYPTO, "armv8.2-crypto", 3, scrypt_N_1_1_256_multi_arm_crypto, scryptHash_arm_crypto, CpuHasArmSha2()});
#endif
    candidates.push_back({ScryptDispatchTier::ARM_NEON, "arm-neon", 3, scrypt_N_1_1_256_multi, scryptHash, true});
#else
    candidates.push_back({ScryptDispatchTier::REFERENCE, "reference", 1, scrypt_N_1_1_256_multi, scryptHash, true});
#endif

    TierCandidate* best = nullptr;
    for (auto& tier : candidates) {
        if (!ValidateTier(tier)) continue;
        if (!best || ComputeThroughput(tier.base_throughput) > ComputeThroughput(best->base_throughput)) {
            best = &tier;
        }
    }

    if (!best) {
        g_active_tier = ScryptDispatchTier::REFERENCE;
        g_multi_fn = scrypt_N_1_1_256_multi;
        g_hash_fn = scryptHash;
        g_active_throughput = ComputeThroughput(1);
        if (!ScryptSelfTestMultiMatchesReference(g_multi_fn, g_active_throughput)) {
            LogPrintf("Scrypt dispatch: reference fallback failed mining multi KAT\n");
            g_active_throughput = 0;
        }
        return;
    }

    g_active_tier = best->tier;
    g_multi_fn = best->multi;
    g_hash_fn = best->hash;
    g_active_throughput = ComputeThroughput(best->base_throughput);
}

} // namespace

const char* ScryptDispatchTierName(ScryptDispatchTier tier)
{
    switch (tier) {
    case ScryptDispatchTier::REFERENCE: return "reference";
    case ScryptDispatchTier::AVX2: return "avx2";
    case ScryptDispatchTier::AVX512: return "avx512";
    case ScryptDispatchTier::ARM_CRYPTO: return "armv8.2-crypto";
    case ScryptDispatchTier::ARM_NEON: return "arm-neon";
    }
    return "unknown";
}

ScryptDispatchTier ScryptDispatchTierActive() { return g_active_tier; }
const char* ScryptDispatchTierNameActive() { return ScryptDispatchTierName(g_active_tier); }
int ScryptDispatchBestThroughput() { return g_active_throughput; }
int ScryptDispatchActiveThroughput()
{
    if (!g_dispatch_init.load()) ScryptDispatchInit();
    return g_active_throughput;
}

bool ScryptDispatchInit()
{
    if (g_dispatch_init.load()) return true;

    const std::string ref_err = ScryptSelfTestReference();
    if (!ref_err.empty()) {
        LogPrintf("ScryptDispatchInit: reference self-test failed: %s\n", ref_err);
        return false;
    }

    SelectBestTier();
    if (g_active_throughput <= 0) {
        LogPrintf("ScryptDispatchInit: no consensus-safe mining path available\n");
        return false;
    }
    g_dispatch_init.store(true);
    LogPrintf("Scrypt dispatch active tier: %s (throughput %d)\n",
        ScryptDispatchTierNameActive(), g_active_throughput);
    return true;
}

bool ScryptDispatch_N_1_1_256_multi(void* input, uint256 hashTarget, int* nHashesDone, unsigned char* scratchbuf)
{
    if (!g_dispatch_init.load()) ScryptDispatchInit();
    return g_multi_fn(input, hashTarget, nHashesDone, scratchbuf);
}

void ScryptDispatchHash(const void* input, char* output)
{
    if (!g_dispatch_init.load()) ScryptDispatchInit();
    g_hash_fn(input, output);
}

unsigned char* ScryptDispatchBufferAlloc()
{
    return ScryptScratchAlloc(0);
}

void ScryptDispatchBufferFree(unsigned char* buf)
{
    ScryptScratchFree(buf);
}
