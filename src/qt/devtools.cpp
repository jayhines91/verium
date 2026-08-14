// Copyright (c) 2026 The Vericoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <qt/devtools.h>

#if ENABLE_DEV_HELPER_WINDOW

#include <qt/devhelperwindow.h>

#include <util/activitylog.h>
#include <util/devedition.h>

#include <QInputDialog>
#include <QLineEdit>
#include <QMessageBox>
#include <QTimer>
#include <QCoreApplication>

namespace {

bool PromptUnlock(QWidget* parent)
{
    if (!IsDeveloperEditionActive())
        return false;

    if (IsDevToolsUnlocked())
        return true;

    QString prompt = QObject::tr("Master password:");

    for (;;) {
        bool ok = false;
        const QString password = QInputDialog::getText(
            parent,
            QObject::tr("Unlock Developer Tools"),
            prompt,
            QLineEdit::Password,
            QString(),
            &ok);
        if (!ok || password.isEmpty())
            return false;

        if (UnlockDevToolsWithPassword(password.toStdString()))
            return true;

        const int choice = QMessageBox::warning(
            parent,
            QObject::tr("Developer Edition"),
            QObject::tr("Incorrect master password."),
            QMessageBox::Retry | QMessageBox::Cancel,
            QMessageBox::Retry);
        if (choice != QMessageBox::Retry)
            return false;

        prompt = QObject::tr("Master password (try again):");
    }
}

void ShowTraceWindow(QWidget* parent)
{
    InitActivityLog();
    LogActivityEx(ActivityLevel::Info, __FILE__, __LINE__, __func__,
        "Verbose trace session starting (before chain init and bootstrap prompts)");

    // Defer window creation so modal password dialogs fully dismiss and init
    // is not blocked. debug.log mirroring is installed later in init.cpp after
    // StartLogging() to avoid flooding the GUI with buffered log lines.
    QTimer::singleShot(0, parent, [parent]() {
        DevHelperWindow* window = DevHelperWindow::CreateAndShow(parent);
        if (window)
            window->setPinnedForSession(true);
    });
}

} // namespace

namespace DevTools {

void OfferStartupTraceWindow(QWidget* parent)
{
    if (!IsDeveloperEditionActive()) {
        MarkDevStartupPromptComplete();
        return;
    }

    if (DevHelperWindow::instance() && DevHelperWindow::instance()->isPinnedForSession()) {
        MarkDevStartupPromptComplete();
        return;
    }

    const int ret = QMessageBox::question(
        parent,
        QObject::tr("Developer Edition"),
        QObject::tr("Open the Verbose Dev Trace window for this session?\n\n"
                    "Choose now, before chain loading or bootstrap — so if anything freezes "
                    "you can see exactly where it stopped.\n\n"
                    "The trace window stays open for the whole session. "
                    "If you choose No, dev tools are unavailable until restart."),
        QMessageBox::Yes | QMessageBox::No,
        QMessageBox::Yes);

    if (ret != QMessageBox::Yes) {
        LogActivityEx(ActivityLevel::Info, __FILE__, __LINE__, __func__,
            "User declined startup verbose trace (no dev UI this session; logging to activity.log still begins at init)");
        MarkDevStartupPromptComplete();
        return;
    }

    if (!PromptUnlock(parent)) {
        LogActivityEx(ActivityLevel::Warning, __FILE__, __LINE__, __func__,
            "Startup verbose trace cancelled at password prompt");
        MarkDevStartupPromptComplete();
        return;
    }

    ShowTraceWindow(parent);
    QCoreApplication::processEvents();
    MarkDevStartupPromptComplete();
}

} // namespace DevTools

#endif // ENABLE_DEV_HELPER_WINDOW
