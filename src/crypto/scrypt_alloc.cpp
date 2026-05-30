// Copyright (c) 2026 The Verium Core developers
// Distributed under the MIT software license.

#include <crypto/scrypt_alloc.h>

#include <crypto/scrypt.h>

#include <cstdlib>
#include <cstring>

#if defined(_WIN32)
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#elif defined(__APPLE__)
#include <mach/mach.h>
#include <mach/mach_vm.h>
#include <mach/vm_map.h>
#include <sys/mman.h>
#else
#include <sys/mman.h>
#ifndef MAP_HUGE_SHIFT
#define MAP_HUGE_SHIFT 26
#endif
#ifndef MAP_HUGE_2MB
#define MAP_HUGE_2MB (21 << MAP_HUGE_SHIFT)
#endif
#endif

static size_t ScryptScratchSize()
{
    return static_cast<size_t>(N) * static_cast<size_t>(SCRYPT_MAX_WAYS) * 128 + 63;
}

unsigned char* ScryptScratchAlloc(size_t size)
{
    if (size == 0) size = ScryptScratchSize();
    unsigned char* buf = nullptr;

#if defined(_WIN32)
    HANDLE token;
    if (OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &token)) {
        TOKEN_PRIVILEGES tp{};
        LUID luid{};
        if (LookupPrivilegeValue(nullptr, SE_LOCK_MEMORY_NAME, &luid)) {
            tp.PrivilegeCount = 1;
            tp.Privileges[0].Luid = luid;
            tp.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
            AdjustTokenPrivileges(token, FALSE, &tp, sizeof(tp), nullptr, nullptr);
        }
        CloseHandle(token);
    }
    buf = static_cast<unsigned char*>(VirtualAlloc(nullptr, size, MEM_RESERVE | MEM_COMMIT | MEM_LARGE_PAGES, PAGE_READWRITE));
    if (buf) {
        ScryptScratchPrefault(buf, size);
        return buf;
    }
#elif defined(__APPLE__)
    mach_vm_address_t addr = 0;
    kern_return_t kr = mach_vm_allocate(mach_task_self(), &addr, size, VM_FLAGS_ANYWHERE | VM_FLAGS_SUPERPAGE_SIZE_2MB);
    if (kr == KERN_SUCCESS) {
        buf = reinterpret_cast<unsigned char*>(addr);
        ScryptScratchPrefault(buf, size);
        return buf;
    }
#elif defined(__linux__)
    buf = static_cast<unsigned char*>(mmap(nullptr, size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_HUGETLB | MAP_HUGE_2MB, -1, 0));
    if (buf != MAP_FAILED) {
        ScryptScratchPrefault(buf, size);
        return buf;
    }
    buf = nullptr;
    if (posix_memalign(reinterpret_cast<void**>(&buf), 4096, size) == 0 && buf) {
        madvise(buf, size, MADV_HUGEPAGE);
        ScryptScratchPrefault(buf, size);
        return buf;
    }
#endif

    buf = scrypt_buffer_alloc();
    if (buf) ScryptScratchPrefault(buf, ScryptScratchSize());
    return buf;
}

void ScryptScratchFree(unsigned char* buf)
{
    if (!buf) return;
    const size_t size = ScryptScratchSize();
#if defined(_WIN32)
    VirtualFree(buf, 0, MEM_RELEASE);
#elif defined(__APPLE__)
    mach_vm_deallocate(mach_task_self(), reinterpret_cast<mach_vm_address_t>(buf), size);
#elif defined(__linux__)
    if (munmap(buf, size) != 0) {
        free(buf);
    }
#else
    free(buf);
#endif
}

void ScryptScratchPrefault(unsigned char* buf, size_t size)
{
    if (!buf || size == 0) return;
    const size_t page = 4096;
    for (size_t off = 0; off < size; off += page) {
        buf[off] = 0;
    }
    buf[size - 1] = 0;
}
