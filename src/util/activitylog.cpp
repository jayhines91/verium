// Copyright (c) 2026 The Vericoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <util/activitylog.h>

#include <fs.h>
#include <logging.h>
#include <shutdown.h>
#include <tinyformat.h>
#include <util/devhelperconfig.h>
#include <util/system.h>
#include <util/threadnames.h>
#include <util/time.h>

#include <atomic>
#include <cstdarg>
#include <cstdio>
#include <deque>
#include <list>
#include <mutex>

const char* const ACTIVITY_LOG_FILENAME = "activity.log";

static std::mutex g_activity_cs;
static FILE* g_activity_file = nullptr;
static boost::signals2::signal<void(const std::string&)> g_activity_signals;
static boost::signals2::signal<void(const ActivityEvent&)> g_activity_event_signals;
static std::list<std::function<void(const std::string&)>>::iterator g_debug_mirror_callback;

static std::atomic<uint64_t> g_event_sequence{0};
static std::atomic<uint64_t> g_last_error_sequence{0};

static constexpr size_t INCIDENT_RING_CAPACITY = 2048;
static std::deque<std::string> g_incident_ring;
static std::mutex g_ring_cs;

static const char* ActivityLevelLabel(ActivityLevel level)
{
    switch (level) {
    case ActivityLevel::Info: return "INFO";
    case ActivityLevel::Progress: return "PROGRESS";
    case ActivityLevel::Warning: return "WARN";
    case ActivityLevel::Error: return "ERROR";
    case ActivityLevel::Debug: return "DEBUG";
    }
    return "?";
}

static std::string Basename(const char* path)
{
    if (!path || !*path)
        return {};
    const char* slash = strrchr(path, '/');
#ifdef WIN32
    const char* bslash = strrchr(path, '\\');
    if (bslash && (!slash || bslash > slash))
        slash = bslash;
#endif
    return slash ? std::string(slash + 1) : std::string(path);
}

static std::string ActivityTimestampNow()
{
    const int64_t now_ms = GetTimeMillis();
    const int64_t sec = now_ms / 1000;
    const int64_t ms = now_ms % 1000;
    return strprintf("%s.%03d", FormatISO8601DateTime(sec), static_cast<int>(ms));
}

std::string FormatActivityEventLine(const ActivityEvent& event)
{
    std::string line = strprintf("[#%06llu] %s [%s] [thread=%s] %s",
        static_cast<unsigned long long>(event.sequence),
        event.timestamp,
        ActivityLevelLabel(event.level),
        event.thread,
        event.message);

    if (!event.file.empty() && event.line > 0) {
        line += strprintf(" @ %s:%d", event.file, event.line);
        if (!event.function.empty())
            line += strprintf(" in %s()", event.function);
    }
    return line;
}

static void PushIncidentRing(const std::string& formatted_line)
{
    std::lock_guard<std::mutex> lock(g_ring_cs);
    if (g_incident_ring.size() >= INCIDENT_RING_CAPACITY)
        g_incident_ring.pop_front();
    g_incident_ring.push_back(formatted_line);
}

static void WriteIncidentBlockToFile(const ActivityEvent& error_event, const std::string& formatted_line)
{
    std::lock_guard<std::mutex> lock(g_ring_cs);
    const size_t context = 100;
    const size_t ring_size = g_incident_ring.size();
    const size_t start = ring_size > context ? ring_size - context : 0;

    std::string block;
    block += "========== VERBOSE TRACE INCIDENT ==========\n";
    block += strprintf("ERROR event #%llu at %s\n", static_cast<unsigned long long>(error_event.sequence), error_event.timestamp.c_str());
    block += strprintf("ShutdownRequested=%s datadir=%s\n",
        ShutdownRequested() ? "yes" : "no",
        GetDataDir().string().c_str());
    block += formatted_line + "\n";
    block += strprintf("--- last %zu events before incident ---\n", ring_size - start);
    for (size_t i = start; i < ring_size; ++i) {
        block += g_incident_ring[i] + "\n";
    }
    block += "========== END INCIDENT ==========\n";

    std::lock_guard<std::mutex> activity_lock(g_activity_cs);
    if (g_activity_file) {
        fwrite(block.data(), 1, block.size(), g_activity_file);
        fflush(g_activity_file);
    }
}

static void EmitActivityEvent(ActivityEvent event)
{
    event.sequence = ++g_event_sequence;
    event.timestamp = ActivityTimestampNow();
    if (event.thread.empty())
        event.thread = "?";

    const std::string formatted = FormatActivityEventLine(event);
    const std::string file_line = formatted + "\n";

    if (event.level != ActivityLevel::Debug && !BCLog::g_logger_in_print_callback)
        LogPrint(BCLog::ALL, "activity: %s\n", event.message);

    PushIncidentRing(formatted);

    {
        std::lock_guard<std::mutex> lock(g_activity_cs);
        if (g_activity_file) {
            fwrite(file_line.data(), 1, file_line.size(), g_activity_file);
            fflush(g_activity_file);
        }
    }

    if (event.level == ActivityLevel::Error) {
        g_last_error_sequence.store(event.sequence);
        WriteIncidentBlockToFile(event, formatted);
    }

    g_activity_signals(file_line);
    g_activity_event_signals(event);
}

boost::signals2::signal<void(const std::string&)>& ActivityLogSignals()
{
    return g_activity_signals;
}

boost::signals2::signal<void(const ActivityEvent&)>& ActivityEventSignals()
{
    return g_activity_event_signals;
}

fs::path GetActivityLogPath()
{
    return GetDataDir() / ACTIVITY_LOG_FILENAME;
}

uint64_t GetActivityEventCount()
{
    return g_event_sequence.load();
}

uint64_t GetLastErrorSequence()
{
    return g_last_error_sequence.load();
}

std::string BuildIncidentReport(size_t context_lines)
{
    std::lock_guard<std::mutex> lock(g_ring_cs);
    const size_t ring_size = g_incident_ring.size();
    if (ring_size == 0)
        return "No verbose trace events recorded yet.\n";

    const uint64_t err_seq = g_last_error_sequence.load();
    size_t start = ring_size > context_lines ? ring_size - context_lines : 0;

    // If we have an error, try to include lines leading up to it (at least context_lines).
    if (err_seq > 0 && ring_size > context_lines) {
        start = ring_size - context_lines;
    }

    std::string report;
    report += "========== VERICOIN VERBOSE TRACE (copy/paste report) ==========\n";
    report += strprintf("Generated: %s\n", ActivityTimestampNow().c_str());
    report += strprintf("Total events: %llu  Last error event: #%llu\n",
        static_cast<unsigned long long>(g_event_sequence.load()),
        static_cast<unsigned long long>(err_seq));
    report += strprintf("Data directory: %s\n", GetDataDir().string().c_str());
    report += strprintf("Shutdown requested: %s\n", ShutdownRequested() ? "yes" : "no");
    report += strprintf("--- last %zu events ---\n", ring_size - start);
    for (size_t i = start; i < ring_size; ++i) {
        report += g_incident_ring[i] + "\n";
    }
    report += "========== END REPORT ==========\n";
    return report;
}

void InitActivityLog()
{
    {
        std::lock_guard<std::mutex> lock(g_activity_cs);
        if (g_activity_file)
            return;

        const fs::path path = GetActivityLogPath();
        g_activity_file = fsbridge::fopen(path, "a");
        if (!g_activity_file) {
            LogPrintf("activity: Unable to open %s for writing\n", path.string());
            return;
        }
        setbuf(g_activity_file, nullptr);
    }
    LogActivity("Verbose activity log started (datadir=%s)", GetDataDir().string().c_str());
}

void LogActivityEx(ActivityLevel level, const char* file, int line, const char* function, const char* fmt, ...)
{
    if (!fmt)
        return;

    char buffer[8192];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);

    ActivityEvent event;
    event.level = level;
    event.thread = util::ThreadGetInternalName();
    event.message = buffer;
    if (file && *file) {
        event.file = Basename(file);
        event.line = line;
    }
    if (function && *function)
        event.function = function;

    EmitActivityEvent(std::move(event));
}

void LogActivity(const char* fmt, ...)
{
    if (!fmt)
        return;

    char buffer[8192];
    va_list args;
    va_start(args, fmt);
    vsnprintf(buffer, sizeof(buffer), fmt, args);
    va_end(args);

    LogActivityEx(ActivityLevel::Info, nullptr, 0, nullptr, "%s", buffer);
}

void InitDevHelperLogMirror()
{
#if ENABLE_DEV_HELPER_WINDOW
    static bool installed = false;
    if (installed)
        return;
    installed = true;

    g_debug_mirror_callback = LogInstance().PushBackCallback([](const std::string& msg) {
        std::string trimmed = msg;
        while (!trimmed.empty() && (trimmed.back() == '\n' || trimmed.back() == '\r'))
            trimmed.pop_back();
        if (trimmed.empty())
            return;
        LogActivityEx(ActivityLevel::Debug, nullptr, 0, "debug.log", "[debug.log] %s", trimmed.c_str());
    });
#endif
}
