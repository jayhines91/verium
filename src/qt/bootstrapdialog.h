#ifndef BITCOIN_QT_BOOTSTRAPDIALOG_H
#define BITCOIN_QT_BOOTSTRAPDIALOG_H

#include <curl/curl.h>
#include <QDialog>
#include <QObject>
#include <QThread>

class QCloseEvent;

namespace Ui {
    class BootstrapDialog;
}

class BootstrapWorker : public QObject
{
    Q_OBJECT

public:
    enum Result {
        Success,
        Failed,
        Cancelled
    };

Q_SIGNALS:
    void progress(qint64 total, qint64 now);
    void statusMessage(const QString& message);
    void finished(int result, const QString& error);

public Q_SLOTS:
    void reportProgress(qint64 total, qint64 now);
    void run();
};

/** Dialog offering bootstrap download with retry and normal sync fallback. */
class BootstrapDialog : public QDialog
{
    Q_OBJECT

public:
    enum Page {
        PageIdle = 0,
        PageProgress = 1,
        PageInterrupted = 2
    };

    enum Phase {
        PhaseDownload = 0,
        PhaseExtract = 1,
        PhaseValidate = 2
    };

    explicit BootstrapDialog(QWidget *parent = 0);
    ~BootstrapDialog();

    Ui::BootstrapDialog *ui;

private Q_SLOTS:
    void on_startButton_clicked();
    void on_closeButton_clicked();
    void on_cancelDownloadButton_clicked();
    void on_showDetailsButton_clicked();
    void on_interruptedRetryButton_clicked();
    void on_interruptedCancelButton_clicked();
    void on_interruptedDetailsButton_clicked();
    void onDownloadProgress(qint64 total, qint64 now);
    void onStatusMessage(const QString& message);
    void onDownloadFinished(int result, const QString& error);

private:
    void setIdleState();
    void setProgressState();
    void setInterruptedState(const QString& detail, const QString& progressSummary, int percent = -1);
    void startDownload();
    void updateStepper(Phase phase);
    void updateProgressMetrics(qint64 total, qint64 now);
    void appendDetails(const QString& line);
    void setNetworkPausedBadgeVisible(bool visible);

    void reject() override;
    void closeEvent(QCloseEvent* event) override;

    QThread m_worker_thread;
    BootstrapWorker* m_worker;
    bool m_downloading;
    bool m_worker_running;
    Phase m_phase;
    qint64 m_lastProgressNow;
    qint64 m_lastProgressTotal;
    QString m_lastError;
};

#endif // BITCOIN_QT_BOOTSTRAPDIALOG_H
