// Copyright (c) 2026 The Verium developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_QT_THEMEMANAGER_H
#define BITCOIN_QT_THEMEMANAGER_H

#include <qt/themetokens.h>

class QApplication;
class QWidget;

class ThemeManager
{
public:
    static ThemeManager& instance();

    ThemeTokens::Theme currentTheme() const { return m_theme; }
    void setTheme(ThemeTokens::Theme theme);
    void loadFromSettings();
    void saveToSettings() const;

    void apply(QApplication* app);
    void apply(QWidget* widget);
    QString loadStylesheet() const;

    static ThemeTokens::Theme themeFromSettings();
    static void saveThemeToSettings(ThemeTokens::Theme theme);

private:
    ThemeManager() = default;
    ThemeTokens::Theme m_theme = ThemeTokens::Theme::Dark;
};

#endif // BITCOIN_QT_THEMEMANAGER_H
