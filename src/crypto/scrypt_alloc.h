// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#ifndef BITCOIN_CRYPTO_SCRYPT_ALLOC_H
#define BITCOIN_CRYPTO_SCRYPT_ALLOC_H

#include <stddef.h>

/** Allocate scrypt scratch with huge-page / NUMA-local hints when available. */
unsigned char* ScryptScratchAlloc(size_t size);

void ScryptScratchFree(unsigned char* buf);

/** Touch every page so the mining loop does not fault mid-hash. */
void ScryptScratchPrefault(unsigned char* buf, size_t size);

#endif // BITCOIN_CRYPTO_SCRYPT_ALLOC_H
