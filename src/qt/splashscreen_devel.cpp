// Copyright (c) 2026 The Vericoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <qt/splashscreen_devel.h>

#if ENABLE_DEV_HELPER_WINDOW

#include <qt/guiutil.h>

#include <QPainter>
#include <QPainterPath>
#include <QPixmap>
#include <QRadialGradient>

QSize PaintDeveloperEditionSplash(
    QPixmap& pixmap,
    const QString& versionText,
    const QString& titleAddText,
    const QString& fontFamily)
{
    const QSize splashSize(420, 248);
    pixmap = QPixmap(splashSize);
    pixmap.fill(Qt::transparent);

    QPainter pixPaint(&pixmap);
    pixPaint.setRenderHint(QPainter::Antialiasing);

    const QRect mainRect(QPoint(0, 0), splashSize);

    QPainterPath borderPath;
    borderPath.addRoundedRect(mainRect.adjusted(1, 1, -1, -1), 19, 19);
    pixPaint.fillPath(borderPath, QColor(210, 105, 20));

    QPainterPath innerPath;
    innerPath.addRoundedRect(mainRect.adjusted(4, 4, -4, -4), 17, 17);
    QRadialGradient gradient(QPoint(0, 0), splashSize.width());
    gradient.setColorAt(0, QColor(255, 252, 245));
    gradient.setColorAt(1, QColor(255, 241, 220));
    pixPaint.fillPath(innerPath, gradient);
    pixPaint.drawPath(innerPath);

    const QRect devBanner(4, 4, splashSize.width() - 8, 34);
    pixPaint.fillRect(devBanner, QColor(170, 70, 10));
    pixPaint.setPen(Qt::white);
    QFont bannerFont(fontFamily, 13, QFont::Bold);
    bannerFont.setLetterSpacing(QFont::AbsoluteSpacing, 1.2);
    pixPaint.setFont(bannerFont);
    pixPaint.drawText(devBanner, Qt::AlignCenter, QStringLiteral("DEVELOPER EDITION"));

    QFont subFont(fontFamily, 9, QFont::DemiBold);
    pixPaint.setFont(subFont);
    pixPaint.setPen(QColor(120, 55, 0));
    const QRect devSub(4, 38, splashSize.width() - 8, 18);
    pixPaint.drawText(devSub, Qt::AlignCenter,
        QStringLiteral("Verbose trace build — not for holder release"));

    const int logoTop = 58;
    const int logoHeight = 96;
    const QRect rLogo(QPoint((splashSize.width() - 350) / 2, logoTop), QSize(350, logoHeight));

    QPixmap logoPixmap(":/icons/vrcsplashlogo");
    if (!GUIUtil::IsVericoin())
        logoPixmap = QPixmap(":/icons/vrmsplashlogo");

    const QPixmap logo = logoPixmap.scaledToHeight(logoHeight, Qt::SmoothTransformation);
    pixPaint.drawPixmap(rLogo, logo);

    QFont versionFont(fontFamily, 13, QFont::DemiBold);
    pixPaint.setFont(versionFont);

    const QRect rText(0, splashSize.height() - 38, splashSize.width(), 34);
    pixPaint.fillRect(rText, QColor(180, 85, 15));
    pixPaint.setPen(Qt::white);
    pixPaint.drawText(rText, Qt::AlignCenter,
        versionText + (titleAddText.isEmpty() ? QString() : QStringLiteral(" · ") + titleAddText));

    pixPaint.end();
    return splashSize;
}

#endif // ENABLE_DEV_HELPER_WINDOW
