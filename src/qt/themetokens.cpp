// Copyright (c) 2026 The Verium developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <qt/themetokens.h>

#include <qt/thememanager.h>

namespace ThemeTokens {

static const Palette DARK_PALETTE = {
    QColor("#0f1419"),
    QColor("#1a2332"),
    QColor("#151b23"),
    QColor("#243044"),
    QColor("#418BCA"),
    QColor("#3277b3"),
    QColor("#f1f5f9"),
    QColor("#94a3b8"),
    QColor("#334155"),
    QColor("#359b37"),
    QColor("#e93a5d"),
    QColor("#f59e0b"),
    QColor("#e93a5d"),
    QColor("#359b37"),
    QColor(81, 177, 242),
    QColor(233, 58, 93),
    QColor(53, 155, 55),
    QColor(140, 140, 140),
};

static const Palette LIGHT_PALETTE = {
    QColor("#f8fafc"),
    QColor("#ffffff"),
    QColor("#e8eef4"),
    QColor("#f1f5f9"),
    QColor("#418BCA"),
    QColor("#3277b3"),
    QColor("#0f172a"),
    QColor("#64748b"),
    QColor("#cbd5e1"),
    QColor("#359b37"),
    QColor("#e93a5d"),
    QColor("#d97706"),
    QColor("#e93a5d"),
    QColor("#359b37"),
    QColor(81, 177, 242),
    QColor(233, 58, 93),
    QColor(53, 155, 55),
    QColor(100, 116, 139),
};

const Palette& palette(Theme theme)
{
    return theme == Theme::Light ? LIGHT_PALETTE : DARK_PALETTE;
}

Palette paletteForCurrentTheme()
{
    return palette(ThemeManager::instance().currentTheme());
}

} // namespace ThemeTokens
