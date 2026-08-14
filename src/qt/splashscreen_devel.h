// Copyright (c) 2026 The Vericoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_QT_SPLASHSCREEN_DEVEL_H
#define BITCOIN_QT_SPLASHSCREEN_DEVEL_H

#include <util/devhelperconfig.h>

#if ENABLE_DEV_HELPER_WINDOW

#include <QSize>
#include <QString>

class QPixmap;

/** Paint the Developer Edition splash into @a pixmap. Returns the splash dimensions used. */
QSize PaintDeveloperEditionSplash(
    QPixmap& pixmap,
    const QString& versionText,
    const QString& titleAddText,
    const QString& fontFamily);

#endif // ENABLE_DEV_HELPER_WINDOW

#endif // BITCOIN_QT_SPLASHSCREEN_DEVEL_H
