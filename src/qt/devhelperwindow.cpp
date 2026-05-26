// Copyright (c) 2026 The Verium developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <qt/devhelperwindow.h>

#if ENABLE_DEV_HELPER_WINDOW

#include <qt/guiutil.h>

#include <fs.h>
#include <util/activitylog.h>
#include <util/devedition.h>

#include <QApplication>
#include <QCheckBox>
#include <QCloseEvent>
#include <QClipboard>
#include <QColor>
#include <QFont>
#include <QFontDatabase>
#include <QHBoxLayout>
#include <QLabel>
#include <QPlainTextEdit>
#include <QPushButton>
#include <QScrollBar>
#include <QTextCharFormat>
#include <QTextCursor>
#include <QTimer>
#include <QVBoxLayout>

#include <vector>

Q_DECLARE_METATYPE(ActivityEvent)

DevHelperWindow* DevHelperWindow::s_instance = nullptr;

DevHelperWindow::DevHelperWindow(QWidget* parent) :
    QWidget(parent, Qt::Window)
{
    setWindowTitle(tr("Verium Verbose Dev Trace"));
    setMinimumSize(720, 420);
    resize(960, 560);

    auto* layout = new QVBoxLayout(this);

    auto* header = new QLabel(tr(
        "Super-verbose trace for copy/paste debugging. Every init step, progress dialog, GUI message, "
        "and debug.log line is recorded with sequence numbers and source locations.\n"
        "Use \"Copy incident report\" after a hang/error to capture what happened leading up to it."));
    header->setWordWrap(true);
    layout->addWidget(header);

    m_logView = new QPlainTextEdit();
    m_logView->setReadOnly(true);
    m_logView->setLineWrapMode(QPlainTextEdit::NoWrap);
    QFont mono = QFontDatabase::systemFont(QFontDatabase::FixedFont);
    mono.setPointSize(mono.pointSize() - 1);
    m_logView->setFont(mono);
    layout->addWidget(m_logView, 1);

    m_statusLabel = new QLabel();
    layout->addWidget(m_statusLabel);

    auto* toolbar = new QHBoxLayout();
    m_errorsOnlyCheck = new QCheckBox(tr("Errors/warnings only"));
    m_alwaysOnTopCheck = new QCheckBox(tr("Always on top"));
    m_raiseOnErrorCheck = new QCheckBox(tr("Raise on error"));
    m_raiseOnErrorCheck->setChecked(true);
    m_clearButton = new QPushButton(tr("Clear view"));
    m_copyAllButton = new QPushButton(tr("Copy all"));
    m_copyLastButton = new QPushButton(tr("Copy last 200"));
    m_copyIncidentButton = new QPushButton(tr("Copy incident report"));
    m_selectAllButton = new QPushButton(tr("Select all"));
    m_openLogButton = new QPushButton(tr("Open activity.log"));

    m_copyIncidentButton->setToolTip(tr("Paste-ready report with the last ~100 events and error context"));
    m_copyLastButton->setToolTip(tr("Copy the most recent lines from this window"));

    toolbar->addWidget(m_errorsOnlyCheck);
    toolbar->addWidget(m_alwaysOnTopCheck);
    toolbar->addWidget(m_raiseOnErrorCheck);
    toolbar->addStretch(1);
    toolbar->addWidget(m_copyIncidentButton);
    toolbar->addWidget(m_copyLastButton);
    toolbar->addWidget(m_copyAllButton);
    toolbar->addWidget(m_selectAllButton);
    toolbar->addWidget(m_clearButton);
    toolbar->addWidget(m_openLogButton);
    layout->addLayout(toolbar);

    connect(m_errorsOnlyCheck, &QCheckBox::toggled, this, &DevHelperWindow::toggleErrorsOnly);
    connect(m_alwaysOnTopCheck, &QCheckBox::toggled, this, &DevHelperWindow::toggleAlwaysOnTop);
    connect(m_clearButton, &QPushButton::clicked, this, &DevHelperWindow::clearLog);
    connect(m_copyAllButton, &QPushButton::clicked, this, &DevHelperWindow::copyAll);
    connect(m_copyLastButton, &QPushButton::clicked, this, &DevHelperWindow::copyLastLines);
    connect(m_copyIncidentButton, &QPushButton::clicked, this, &DevHelperWindow::copyIncidentReport);
    connect(m_selectAllButton, &QPushButton::clicked, this, &DevHelperWindow::selectAll);
    connect(m_openLogButton, &QPushButton::clicked, this, &DevHelperWindow::openLogFile);

    qRegisterMetaType<ActivityEvent>("ActivityEvent");
    m_event_connection = ActivityEventSignals().connect([this](const ActivityEvent& event) {
        QMetaObject::invokeMethod(this, "deliverActivityEvent", Qt::QueuedConnection,
            Q_ARG(ActivityEvent, event));
    });

    QTimer::singleShot(0, this, [this]() { loadRecentHistory(); });
    s_instance = this;
    updateStatusBar();

    LogActivityEx(ActivityLevel::Info, __FILE__, __LINE__, __func__,
        "Verbose dev trace window opened (%s)", GetDeveloperEditionTitle().c_str());
}

DevHelperWindow::~DevHelperWindow()
{
    if (s_instance == this)
        s_instance = nullptr;
}

DevHelperWindow* DevHelperWindow::CreateAndShow(QWidget* parent)
{
    if (s_instance) {
        s_instance->show();
        s_instance->raise();
        s_instance->activateWindow();
        if (parent) {
            const QRect mainGeo = parent->frameGeometry();
            s_instance->move(mainGeo.right() + 12, mainGeo.top());
        }
        return s_instance;
    }

    auto* window = new DevHelperWindow(parent);
    window->setAttribute(Qt::WA_DeleteOnClose, false);
    if (parent) {
        const QRect mainGeo = parent->frameGeometry();
        window->move(mainGeo.right() + 12, mainGeo.top());
    }
    window->show();
    window->raise();
    return window;
}

void DevHelperWindow::setPinnedForSession(bool pinned)
{
    m_pinnedForSession = pinned;
    if (pinned) {
        setWindowTitle(tr("Verium Verbose Dev Trace (session)"));
        LogActivityEx(ActivityLevel::Info, __FILE__, __LINE__, __func__,
            "Verbose dev trace pinned for session");
    }
}

void DevHelperWindow::closeEvent(QCloseEvent* event)
{
    if (m_pinnedForSession) {
        event->ignore();
        m_statusLabel->setText(tr("Pinned for this session — restart Verium to open dev tools again."));
        raise();
        activateWindow();
        return;
    }
    QWidget::closeEvent(event);
}

DevHelperWindow* DevHelperWindow::instance()
{
    return s_instance;
}

bool DevHelperWindow::shouldShow(ActivityLevel level) const
{
    if (!m_errorsOnlyCheck || !m_errorsOnlyCheck->isChecked())
        return true;
    return level == ActivityLevel::Error || level == ActivityLevel::Warning;
}

void DevHelperWindow::appendFormattedLine(const QString& line, ActivityLevel level, bool is_error)
{
    if (is_error)
        ++m_error_count;
    ++m_visible_count;

    m_allLines.append(line);
    while (m_allLines.size() > kMaxStoredLines)
        m_allLines.removeFirst();

    QTextCharFormat fmt;
    switch (level) {
    case ActivityLevel::Error:
        fmt.setForeground(Qt::red);
        fmt.setFontWeight(QFont::Bold);
        break;
    case ActivityLevel::Warning:
        fmt.setForeground(QColor(200, 100, 0));
        break;
    case ActivityLevel::Progress:
        fmt.setForeground(QColor(0, 80, 180));
        break;
    case ActivityLevel::Debug:
        fmt.setForeground(QColor(90, 90, 90));
        break;
    default:
        fmt.setForeground(palette().text().color());
        break;
    }

    m_logView->moveCursor(QTextCursor::End);
    m_logView->setCurrentCharFormat(fmt);
    m_logView->insertPlainText(line + "\n");
    m_logView->moveCursor(QTextCursor::End);

    updateStatusBar();
}

void DevHelperWindow::deliverActivityEvent(ActivityEvent event)
{
    queueEvent(std::move(event));
}

void DevHelperWindow::queueEvent(ActivityEvent event)
{
    std::lock_guard<std::mutex> lock(m_pendingMutex);
    if (m_pendingEvents.size() > 3000 && event.level == ActivityLevel::Debug)
        return;
    m_pendingEvents.push_back(std::move(event));
    if (m_pendingEvents.size() > 2000)
        m_pendingEvents.erase(m_pendingEvents.begin(), m_pendingEvents.begin() + 1000);

    if (m_flushScheduled)
        return;
    m_flushScheduled = true;
    QTimer::singleShot(50, this, [this]() {
        m_flushScheduled = false;
        flushPendingEvents();
    });
}

void DevHelperWindow::flushPendingEvents()
{
    std::vector<ActivityEvent> batch;
    {
        std::lock_guard<std::mutex> lock(m_pendingMutex);
        if (m_pendingEvents.empty())
            return;
        batch.swap(m_pendingEvents);
    }

    m_logView->setUpdatesEnabled(false);
    for (const ActivityEvent& event : batch) {
        appendEvent(event);
    }
    m_logView->setUpdatesEnabled(true);
    m_logView->moveCursor(QTextCursor::End);
}

void DevHelperWindow::appendEvent(const ActivityEvent& event)
{
    if (!shouldShow(event.level))
        return;

    const QString line = QString::fromStdString(FormatActivityEventLine(event));
    appendFormattedLine(line, event.level, event.level == ActivityLevel::Error);

    if (event.level == ActivityLevel::Error) {
        setWindowTitle(tr("Verium Verbose Dev Trace — %1 error(s) — last #%2")
                           .arg(m_error_count)
                           .arg(static_cast<qulonglong>(event.sequence)));
        if (m_raiseOnErrorCheck && m_raiseOnErrorCheck->isChecked()) {
            show();
            raise();
            activateWindow();
        }
    }
}

void DevHelperWindow::loadRecentHistory()
{
    const fs::path path = GetActivityLogPath();
    if (!fs::exists(path))
        return;

    FILE* f = fsbridge::fopen(path, "r");
    if (!f)
        return;

    fseek(f, 0, SEEK_END);
    const long size = ftell(f);
    const long start = size > 512000 ? size - 512000 : 0;
    fseek(f, start, SEEK_SET);

    char buf[8192];
    size_t n;
    QString chunk;
    while ((n = fread(buf, 1, sizeof(buf), f)) > 0) {
        chunk += QString::fromUtf8(buf, static_cast<int>(n));
    }
    fclose(f);

    const QStringList lines = chunk.split('\n', QString::SkipEmptyParts);
    const int tail = qMin(lines.size(), 100);
    for (int i = lines.size() - tail; i < lines.size(); ++i) {
        m_allLines.append(lines.at(i));
        m_logView->appendPlainText(lines.at(i));
        ++m_visible_count;
    }
    m_logView->moveCursor(QTextCursor::End);
}

void DevHelperWindow::updateStatusBar()
{
    m_statusLabel->setText(tr("Visible: %1 | Stored: %2 | Total events: %3 | Last error: #%4")
                               .arg(m_visible_count)
                               .arg(m_allLines.size())
                               .arg(static_cast<qulonglong>(GetActivityEventCount()))
                               .arg(static_cast<qulonglong>(GetLastErrorSequence())));
}

void DevHelperWindow::clearLog()
{
    m_logView->clear();
    m_allLines.clear();
    m_error_count = 0;
    m_visible_count = 0;
    setWindowTitle(tr("Verium Verbose Dev Trace"));
    updateStatusBar();
}

void DevHelperWindow::copyAll()
{
    QApplication::clipboard()->setText(m_logView->toPlainText());
}

void DevHelperWindow::copyLastLines()
{
    const int n = qMin(kCopyLastLines, m_allLines.size());
    if (n <= 0)
        return;
    QApplication::clipboard()->setText(m_allLines.mid(m_allLines.size() - n).join('\n'));
}

void DevHelperWindow::copyIncidentReport()
{
    QApplication::clipboard()->setText(QString::fromStdString(BuildIncidentReport(100)));
}

void DevHelperWindow::selectAll()
{
    m_logView->selectAll();
    m_logView->setFocus();
}

void DevHelperWindow::openLogFile()
{
    GUIUtil::openActivityLogfile();
}

void DevHelperWindow::toggleAlwaysOnTop(bool checked)
{
    Qt::WindowFlags flags = windowFlags();
    if (checked)
        flags |= Qt::WindowStaysOnTopHint;
    else
        flags &= ~Qt::WindowStaysOnTopHint;
    setWindowFlags(flags);
    show();
}

void DevHelperWindow::toggleErrorsOnly(bool checked)
{
    Q_UNUSED(checked);
}

#endif // ENABLE_DEV_HELPER_WINDOW
