#include <qt/bootstrapdialog.h>
#include <qt/forms/ui_bootstrapdialog.h>
#include <qt/guiutil.h>
#include <downloader.h>

#include <QApplication>
#include <QCloseEvent>
#include <QEventLoop>
#include <QFile>
#include <QFont>
#include <QLabel>
#include <QStyle>

static BootstrapWorker* g_bootstrap_worker = nullptr;

static void xfer_callback(curl_off_t now, curl_off_t total)
{
    if (g_bootstrap_worker == nullptr)
        return;

    QMetaObject::invokeMethod(g_bootstrap_worker, "reportProgress", Qt::QueuedConnection,
                              Q_ARG(qint64, static_cast<qint64>(total)),
                              Q_ARG(qint64, static_cast<qint64>(now)));
}

void BootstrapWorker::reportProgress(qint64 total, qint64 now)
{
    Q_EMIT progress(total, now);
}

void BootstrapWorker::run()
{
    g_bootstrap_worker = this;
    set_xferinfo_data(reinterpret_cast<void*>(xfer_callback));
    set_bootstrap_status_fn([this](const char* msg) {
        Q_EMIT statusMessage(QString::fromUtf8(msg));
    });

    try {
        downloadBootstrap();
        set_bootstrap_status_fn(nullptr);
        set_xferinfo_data(nullptr);
        g_bootstrap_worker = nullptr;
        Q_EMIT finished(Success, QString());
    } catch (const std::runtime_error& e) {
        set_bootstrap_status_fn(nullptr);
        set_xferinfo_data(nullptr);
        g_bootstrap_worker = nullptr;
        const QString error = QString::fromStdString(e.what());
        if (download_cancelled()) {
            Q_EMIT finished(Cancelled, error);
        } else {
            Q_EMIT finished(Failed, error);
        }
    } catch (...) {
        set_bootstrap_status_fn(nullptr);
        set_xferinfo_data(nullptr);
        g_bootstrap_worker = nullptr;
        if (download_cancelled()) {
            Q_EMIT finished(Cancelled, tr("Download cancelled."));
        } else {
            Q_EMIT finished(Failed, tr("Unknown bootstrap error."));
        }
    }
}

BootstrapDialog::BootstrapDialog(QWidget *parent) :
    QDialog(parent),
    ui(new Ui::BootstrapDialog),
    m_worker(new BootstrapWorker),
    m_downloading(false),
    m_worker_running(false),
    m_phase(PhaseDownload),
    m_lastProgressNow(0),
    m_lastProgressTotal(0)
{
    ui->setupUi(this);
    setObjectName("BootstrapDialog");
    setWindowTitle(tr("Bootstrap Blockchain"));
    setModal(true);
    setAttribute(Qt::WA_DeleteOnClose, false);

    QFont titleFont = ui->idleTitle->font();
    titleFont.setPointSize(titleFont.pointSize() + 4);
    titleFont.setBold(true);
    ui->idleTitle->setFont(titleFont);
    ui->progressTitle->setFont(titleFont);
    ui->interruptedTitle->setFont(titleFont);

    QFont pctFont = ui->percentLabel->font();
    pctFont.setPointSize(pctFont.pointSize() + 8);
    pctFont.setBold(true);
    ui->percentLabel->setFont(pctFont);

    ui->interruptedUrlLabel->setText(QString::fromStdString(getBootstrapDownloadUrl()));
    ui->detailsText->setPlainText(QString::fromStdString(getBootstrapDownloadUrl()));
    ui->interruptedDetailsText->setPlainText(QString::fromStdString(getBootstrapDownloadUrl()));

    QFile styleFile(QStringLiteral(":/style"));
    if (styleFile.open(QFile::ReadOnly | QFile::Text)) {
        setStyleSheet(QString::fromUtf8(styleFile.readAll()));
    }

    m_worker->moveToThread(&m_worker_thread);
    connect(m_worker, &BootstrapWorker::progress, this, &BootstrapDialog::onDownloadProgress, Qt::QueuedConnection);
    connect(m_worker, &BootstrapWorker::statusMessage, this, &BootstrapDialog::onStatusMessage, Qt::QueuedConnection);
    connect(m_worker, &BootstrapWorker::finished, this, &BootstrapDialog::onDownloadFinished, Qt::QueuedConnection);
    m_worker_thread.start();

    setIdleState();
}

BootstrapDialog::~BootstrapDialog()
{
    if (m_downloading) {
        set_download_cancelled(true);
    }
    m_worker_thread.quit();
    m_worker_thread.wait();
    delete m_worker;
    delete ui;
    if (!bootstrapApplyPending()) {
        restoreNetworkAfterBootstrap();
    }
}

void BootstrapDialog::reject()
{
    restoreNetworkAfterBootstrap();
    clearBootstrapPartial();
    QDialog::reject();
}

void BootstrapDialog::closeEvent(QCloseEvent* event)
{
    if (m_downloading) {
        event->ignore();
        return;
    }
    QDialog::closeEvent(event);
}

void BootstrapDialog::setNetworkPausedBadgeVisible(bool visible)
{
    ui->networkPausedBadge->setVisible(visible);
}

void BootstrapDialog::updateStepper(Phase phase)
{
    m_phase = phase;

    auto applyStep = [&](QLabel* label, Phase stepPhase) {
        const char* state = "pending";
        if (phase > stepPhase) {
            state = "done";
        } else if (phase == stepPhase) {
            state = "active";
        }
        label->setProperty("bootstrapStep", state);
        label->style()->unpolish(label);
        label->style()->polish(label);
        label->update();
    };

    applyStep(ui->stepDownload, PhaseDownload);
    applyStep(ui->stepExtract, PhaseExtract);
    applyStep(ui->stepValidate, PhaseValidate);
}

void BootstrapDialog::appendDetails(const QString& line)
{
    ui->detailsText->appendPlainText(line);
    ui->interruptedDetailsText->appendPlainText(line);
}

void BootstrapDialog::setIdleState()
{
    m_downloading = false;
    m_worker_running = false;
    setNetworkPausedBadgeVisible(false);
    ui->stackedWidget->setCurrentIndex(PageIdle);

    const uint64_t partial = getBootstrapPartialBytes();
    if (partial > 0) {
        const double mbPartial = static_cast<double>(partial) / (1024.0 * 1024.0);
        ui->idlePartialNote->setText(tr("Partial download found (%1 MB). Download will resume from the saved archive.")
                                         .arg(mbPartial, 0, 'f', 1));
        ui->idlePartialNote->setVisible(true);
        ui->startButton->setText(tr("Resume download"));
    } else {
        ui->idlePartialNote->hide();
        ui->startButton->setText(tr("Download bootstrap"));
    }
    ui->startButton->setEnabled(true);
    ui->closeButton->setEnabled(true);
}

void BootstrapDialog::setProgressState()
{
    m_downloading = true;
    setNetworkPausedBadgeVisible(true);
    ui->stackedWidget->setCurrentIndex(PageProgress);
    ui->detailsText->clear();
    ui->detailsText->appendPlainText(QString::fromStdString(getBootstrapDownloadUrl()));
    ui->detailsText->setVisible(false);
    ui->showDetailsButton->setText(tr("Show details"));
    ui->progressBar->setMinimum(0);
    ui->progressBar->setMaximum(0);
    ui->progressBar->setValue(0);
    ui->percentLabel->setText(QStringLiteral("…"));
    ui->sizeLabel->clear();
    updateStepper(PhaseDownload);
    raise();
    activateWindow();
}

void BootstrapDialog::setInterruptedState(const QString& detail, const QString& progressSummary, int percent)
{
    ui->interruptedDetailLabel->setText(detail);
    ui->interruptedProgressLabel->setText(progressSummary);
    if (percent >= 0) {
        ui->interruptedProgressBar->setMaximum(100);
        ui->interruptedProgressBar->setValue(percent);
    } else if (m_lastProgressTotal > 0) {
        const int pct = static_cast<int>(qMin((m_lastProgressNow * 100) / m_lastProgressTotal, static_cast<qint64>(100)));
        ui->interruptedProgressBar->setMaximum(100);
        ui->interruptedProgressBar->setValue(pct);
    } else {
        ui->interruptedProgressBar->setMaximum(0);
    }
    ui->interruptedDetailsText->setVisible(false);
    ui->interruptedDetailsButton->setText(tr("Details"));
    ui->stackedWidget->setCurrentIndex(PageInterrupted);
    raise();
    activateWindow();
}

void BootstrapDialog::updateProgressMetrics(qint64 total, qint64 now)
{
    m_lastProgressNow = now;
    m_lastProgressTotal = total;

    if (total > 0) {
        const int pct = static_cast<int>(qMin((now * 100) / total, static_cast<qint64>(100)));
        ui->progressBar->setMaximum(100);
        ui->progressBar->setValue(pct);
        ui->percentLabel->setText(tr("%1%").arg(pct));
        const double mbNow = static_cast<double>(now) / (1024.0 * 1024.0);
        const double mbTotal = static_cast<double>(total) / (1024.0 * 1024.0);
        ui->sizeLabel->setText(tr("%1 MB of %2 MB").arg(mbNow, 0, 'f', 1).arg(mbTotal, 0, 'f', 1));
    } else if (now > 0) {
        ui->progressBar->setMaximum(0);
        ui->percentLabel->setText(QStringLiteral("…"));
        const double mbNow = static_cast<double>(now) / (1024.0 * 1024.0);
        ui->sizeLabel->setText(tr("%1 MB downloaded").arg(mbNow, 0, 'f', 1));
    }
}

void BootstrapDialog::startDownload()
{
    if (m_worker_running) {
        return;
    }

    reset_download_cancel();
    m_worker_running = true;
    pauseNetworkForBootstrap();
    setProgressState();
    QMetaObject::invokeMethod(m_worker, "run", Qt::QueuedConnection);
}

void BootstrapDialog::on_startButton_clicked()
{
    startDownload();
}

void BootstrapDialog::on_closeButton_clicked()
{
    reject();
}

void BootstrapDialog::on_cancelDownloadButton_clicked()
{
    if (!m_downloading) {
        reject();
        return;
    }
    set_download_cancelled(true);
    ui->cancelDownloadButton->setEnabled(false);
    ui->progressTitle->setText(tr("Cancelling…"));
}

void BootstrapDialog::on_showDetailsButton_clicked()
{
    const bool show = !ui->detailsText->isVisible();
    ui->detailsText->setVisible(show);
    ui->showDetailsButton->setText(show ? tr("Hide details") : tr("Show details"));
}

void BootstrapDialog::on_interruptedRetryButton_clicked()
{
    if (m_worker_running) {
        requestBootstrapDownloadRetryNow();
        ui->interruptedRetryButton->setEnabled(false);
        ui->interruptedDetailLabel->setText(tr("Retrying now…"));
        setProgressState();
        return;
    }

    startDownload();
}

void BootstrapDialog::on_interruptedCancelButton_clicked()
{
    if (m_worker_running) {
        set_download_cancelled(true);
        ui->interruptedCancelButton->setEnabled(false);
        return;
    }
    reject();
}

void BootstrapDialog::on_interruptedDetailsButton_clicked()
{
    const bool show = !ui->interruptedDetailsText->isVisible();
    ui->interruptedDetailsText->setVisible(show);
    ui->interruptedDetailsButton->setText(show ? tr("Hide details") : tr("Details"));
}

void BootstrapDialog::onStatusMessage(const QString& message)
{
    appendDetails(message);

    if (message.contains(QStringLiteral("Download interrupted"), Qt::CaseInsensitive) ||
        message.contains(QStringLiteral("Retrying in"), Qt::CaseInsensitive)) {
        QString progressSummary;
        if (m_lastProgressTotal > 0) {
            const double mbNow = static_cast<double>(m_lastProgressNow) / (1024.0 * 1024.0);
            const double mbTotal = static_cast<double>(m_lastProgressTotal) / (1024.0 * 1024.0);
            progressSummary = tr("Last progress: %1 MB of %2 MB").arg(mbNow, 0, 'f', 1).arg(mbTotal, 0, 'f', 1);
        } else if (m_lastProgressNow > 0) {
            const double mbNow = static_cast<double>(m_lastProgressNow) / (1024.0 * 1024.0);
            progressSummary = tr("Last progress: %1 MB downloaded").arg(mbNow, 0, 'f', 1);
        } else {
            const uint64_t partial = getBootstrapPartialBytes();
            if (partial > 0) {
                progressSummary = tr("Last progress: %1 MB saved on disk")
                                        .arg(static_cast<double>(partial) / (1024.0 * 1024.0), 0, 'f', 1);
            }
        }
        setInterruptedState(tr("Connection lost while downloading"), progressSummary);
        ui->interruptedRetryButton->setEnabled(true);
        return;
    }

    if (message.startsWith(QStringLiteral("Extracting"), Qt::CaseInsensitive)) {
        ui->stackedWidget->setCurrentIndex(PageProgress);
        ui->progressTitle->setText(tr("Extracting bootstrap archive"));
        ui->progressSubtitle->setText(tr("Unpacking chain data to the staging folder. This may take several minutes."));
        ui->progressBar->setMaximum(0);
        ui->percentLabel->setText(QStringLiteral("…"));
        ui->sizeLabel->setText(message);
        updateStepper(PhaseExtract);
        return;
    }

    if (message.contains(QStringLiteral("files processed"), Qt::CaseInsensitive)) {
        ui->sizeLabel->setText(message);
        return;
    }

    if (message.startsWith(QStringLiteral("Validating"), Qt::CaseInsensitive)) {
        ui->progressTitle->setText(tr("Validating bootstrap archive"));
        ui->progressSubtitle->setText(tr("Checking blocks and chainstate."));
        ui->progressBar->setMaximum(0);
        ui->percentLabel->setText(QStringLiteral("…"));
        ui->sizeLabel->clear();
        updateStepper(PhaseValidate);
        return;
    }

    if (message.startsWith(QStringLiteral("Downloading"), Qt::CaseInsensitive) ||
        message.startsWith(QStringLiteral("Resuming download"), Qt::CaseInsensitive)) {
        ui->stackedWidget->setCurrentIndex(PageProgress);
        ui->progressTitle->setText(tr("Downloading bootstrap archive"));
        ui->progressSubtitle->setText(tr("Downloading from files.vericonomy.com over HTTPS."));
        updateStepper(PhaseDownload);
        return;
    }

    if (message.startsWith(QStringLiteral("Bootstrap ready"), Qt::CaseInsensitive)) {
        ui->progressTitle->setText(tr("Bootstrap ready"));
        ui->progressSubtitle->setText(tr("Verium will now shut down. Restart to install chain data and finish syncing."));
        ui->progressBar->setMaximum(100);
        ui->progressBar->setValue(100);
        ui->percentLabel->setText(tr("100%"));
        updateStepper(PhaseComplete);
    }
}

void BootstrapDialog::onDownloadProgress(qint64 total, qint64 now)
{
    ui->stackedWidget->setCurrentIndex(PageProgress);
    if (m_phase <= PhaseDownload) {
        updateStepper(PhaseDownload);
    }
    updateProgressMetrics(total, now);
}

void BootstrapDialog::onDownloadFinished(int result, const QString& error)
{
    m_downloading = false;
    m_worker_running = false;
    ui->cancelDownloadButton->setEnabled(true);
    ui->interruptedCancelButton->setEnabled(true);
    ui->interruptedRetryButton->setEnabled(true);

    switch (result) {
    case BootstrapWorker::Success:
        ui->progressTitle->setText(tr("Bootstrap ready"));
        ui->progressSubtitle->setText(tr("Verium will now shut down.\nRestart to install chain data and finish syncing."));
        ui->progressBar->setMaximum(100);
        ui->progressBar->setValue(100);
        ui->percentLabel->setText(tr("100%"));
        updateStepper(PhaseComplete);
        QApplication::processEvents(QEventLoop::ExcludeUserInputEvents);
        accept();
        QApplication::quit();
        break;
    case BootstrapWorker::Cancelled: {
        m_lastError = error;
        QString progressSummary;
        if (m_lastProgressTotal > 0) {
            const double mbNow = static_cast<double>(m_lastProgressNow) / (1024.0 * 1024.0);
            const double mbTotal = static_cast<double>(m_lastProgressTotal) / (1024.0 * 1024.0);
            progressSummary = tr("Last progress: %1 MB of %2 MB").arg(mbNow, 0, 'f', 1).arg(mbTotal, 0, 'f', 1);
        } else {
            const uint64_t partial = getBootstrapPartialBytes();
            progressSummary = tr("Last progress: %1 MB saved on disk")
                                  .arg(static_cast<double>(partial) / (1024.0 * 1024.0), 0, 'f', 1);
        }
        setInterruptedState(tr("Download cancelled"), progressSummary);
        appendDetails(error);
        break;
    }
    case BootstrapWorker::Failed:
    default:
        m_lastError = error;
        setInterruptedState(tr("Download stopped"), error);
        appendDetails(error);
        break;
    }
}
