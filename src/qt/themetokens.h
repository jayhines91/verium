// Copyright (c) 2026 The Verium developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_QT_THEMETOKENS_H
#define BITCOIN_QT_THEMETOKENS_H

#include <QColor>

namespace ThemeTokens {

enum class Theme { Dark, Light };

struct Palette {
    QColor bgApp;
    QColor bgSurface;
    QColor bgSidebar;
    QColor bgElevated;
    QColor accent;
    QColor accentHover;
    QColor textPrimary;
    QColor textMuted;
    QColor border;
    QColor success;
    QColor danger;
    QColor warning;
    QColor sendCta;
    QColor receiveCta;
    QColor txUnconfirmed;
    QColor txNegative;
    QColor txPositive;
    QColor txBareAddress;
};

const Palette& palette(Theme theme);
Palette paletteForCurrentTheme();

} // namespace ThemeTokens

#endif // BITCOIN_QT_THEMETOKENS_H
