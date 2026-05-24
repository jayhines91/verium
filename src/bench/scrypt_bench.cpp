// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#include <bench/bench.h>
#include <crypto/scrypt.h>
#include <crypto/scrypt_dispatch.h>
#include <uint256.h>

#include <vector>

static void ScryptHashBench(benchmark::State& state)
{
    uint8_t header[80]{};
    header[0] = 0x04;
    char out[32];
    while (state.KeepRunning()) {
        ScryptDispatchHash(header, out);
    }
}

static void ScryptMultiBench(benchmark::State& state)
{
    uint8_t header[80]{};
    header[0] = 0x04;
    uint256 target;
    target.SetHex("00000000ffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
    unsigned char* scratch = ScryptDispatchBufferAlloc();
    if (!scratch) return;
    int done = 0;
    while (state.KeepRunning()) {
        ScryptDispatch_N_1_1_256_multi(header, target, &done, scratch);
    }
    ScryptDispatchBufferFree(scratch);
}

// One scrypt hash takes ~1s on a typical desktop; scale iterations accordingly.
BENCHMARK(ScryptHashBench, 1);
BENCHMARK(ScryptMultiBench, 1);
