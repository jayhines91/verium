// Copyright (c) 2026 The Verium developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_UTIL_ACTIVITYLOG_H
#define BITCOIN_UTIL_ACTIVITYLOG_H

#include <fs.h>
#include <util/devhelperconfig.h>

#include <boost/signals2/signal.hpp>
#include <cstdint>
#include <string>
#include <vector>

extern const char* const ACTIVITY_LOG_FILENAME;

enum class ActivityLevel {
    Info,
    Progress,
    Warning,
    Error,
    Debug,
};

struct ActivityEvent {
    uint64_t sequence{0};
    ActivityLevel level{ActivityLevel::Info};
    std::string timestamp;
    std::string thread;
    std::string message;
    std::string file;
    int line{0};
    std::string function;
};

/** Open activity.log in the data directory (always-on, flushed each line). */
void InitActivityLog();

/** Append a timestamped info line to activity.log. */
void LogActivity(const char* fmt, ...);

/** Append with severity and optional source location (for dev helper window). */
void LogActivityEx(ActivityLevel level, const char* file, int line, const char* function, const char* fmt, ...);

fs::path GetActivityLogPath();

/** Single-line copy/paste format used by the window and incident reports. */
std::string FormatActivityEventLine(const ActivityEvent& event);

/**
 * Build a paste-ready incident report: header, error line(s), and the last
 * @a context_lines events leading up to the most recent error (or tail if none).
 */
std::string BuildIncidentReport(size_t context_lines = 100);

uint64_t GetActivityEventCount();
uint64_t GetLastErrorSequence();

/** Legacy string subscribers. */
boost::signals2::signal<void(const std::string&)>& ActivityLogSignals();

/** Structured subscribers (dev helper window). */
boost::signals2::signal<void(const ActivityEvent&)>& ActivityEventSignals();

/** Hook debug.log output into the dev helper when enabled. Call after StartLogging(). */
void InitDevHelperLogMirror();

#if ENABLE_DEV_HELPER_WINDOW
#define DEV_TRACE(fmt, ...) LogActivityEx(ActivityLevel::Info, __FILE__, __LINE__, __FUNCTION__, fmt, ##__VA_ARGS__)
#define DEV_WARN(fmt, ...) LogActivityEx(ActivityLevel::Warning, __FILE__, __LINE__, __FUNCTION__, fmt, ##__VA_ARGS__)
#define DEV_ERROR(fmt, ...) LogActivityEx(ActivityLevel::Error, __FILE__, __LINE__, __FUNCTION__, fmt, ##__VA_ARGS__)
#else
#define DEV_TRACE(...) ((void)0)
#define DEV_WARN(...) ((void)0)
#define DEV_ERROR(...) ((void)0)
#endif

#endif // BITCOIN_UTIL_ACTIVITYLOG_H
