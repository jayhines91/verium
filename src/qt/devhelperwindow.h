// Copyright (c) 2026 The Vericoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_QT_DEVHELPERWINDOW_H
#define BITCOIN_QT_DEVHELPERWINDOW_H

#include <util/devhelperconfig.h>

#if ENABLE_DEV_HELPER_WINDOW

#include <util/activitylog.h>

#include <mutex>
#include <vector>

#include <QWidget>

class QCloseEvent;
class QCheckBox;
class QPlainTextEdit;
class QPushButton;
class QLabel;

/** Live verbose dev trace window — paste-ready incident reports. */
class DevHelperWindow : public QWidget
{
    Q_OBJECT

public:
    explicit DevHelperWindow(QWidget* parent = nullptr);
    ~DevHelperWindow();

    static DevHelperWindow* CreateAndShow(QWidget* parent = nullptr);
    static DevHelperWindow* instance();

    void setPinnedForSession(bool pinned);
    bool isPinnedForSession() const { return m_pinnedForSession; }

public Q_SLOTS:
    void deliverActivityEvent(ActivityEvent event);
    void appendEvent(const ActivityEvent& event);
    void clearLog();
    void copyAll();
    void copyLastLines();
    void copyIncidentReport();
    void selectAll();
    void openLogFile();
    void toggleAlwaysOnTop(bool checked);
    void toggleErrorsOnly(bool checked);

protected:
    void closeEvent(QCloseEvent* event) override;

private:
    void appendFormattedLine(const QString& line, ActivityLevel level, bool is_error);
    void queueEvent(ActivityEvent event);
    void flushPendingEvents();
    bool shouldShow(ActivityLevel level) const;
    void loadRecentHistory();
    void updateStatusBar();

    static DevHelperWindow* s_instance;

    QPlainTextEdit* m_logView = nullptr;
    QLabel* m_statusLabel = nullptr;
    QCheckBox* m_errorsOnlyCheck = nullptr;
    QCheckBox* m_alwaysOnTopCheck = nullptr;
    QCheckBox* m_raiseOnErrorCheck = nullptr;
    QPushButton* m_clearButton = nullptr;
    QPushButton* m_copyAllButton = nullptr;
    QPushButton* m_copyLastButton = nullptr;
    QPushButton* m_copyIncidentButton = nullptr;
    QPushButton* m_selectAllButton = nullptr;
    QPushButton* m_openLogButton = nullptr;
    boost::signals2::scoped_connection m_event_connection;
    bool m_pinnedForSession = false;
    bool m_flushScheduled = false;
    std::mutex m_pendingMutex;
    int m_error_count = 0;
    int m_visible_count = 0;
    QStringList m_allLines;
    std::vector<ActivityEvent> m_pendingEvents;
    static constexpr int kMaxStoredLines = 50000;
    static constexpr int kCopyLastLines = 200;
};

#endif // ENABLE_DEV_HELPER_WINDOW

#endif // BITCOIN_QT_DEVHELPERWINDOW_H
