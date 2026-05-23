// Copyright (c) 2026 The Verium developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#include <qt/thememanager.h>

#include <QApplication>
#include <QFile>
#include <QSettings>
#include <QStyle>
#include <QTextStream>
#include <QWidget>

static void repolishWidgetTree(QWidget* root)
{
    if (!root) return;
    root->style()->unpolish(root);
    root->style()->polish(root);
    for (QObject* child : root->children()) {
        if (QWidget* w = qobject_cast<QWidget*>(child)) {
            repolishWidgetTree(w);
        }
    }
    root->update();
}

static const char SETTINGS_THEME_KEY[] = "fThemeDark";

ThemeManager& ThemeManager::instance()
{
    static ThemeManager manager;
    return manager;
}

ThemeTokens::Theme ThemeManager::themeFromSettings()
{
    QSettings settings;
    if (!settings.contains(QLatin1String(SETTINGS_THEME_KEY))) {
        return ThemeTokens::Theme::Dark;
    }
    return settings.value(QLatin1String(SETTINGS_THEME_KEY), true).toBool()
        ? ThemeTokens::Theme::Dark
        : ThemeTokens::Theme::Light;
}

void ThemeManager::saveThemeToSettings(ThemeTokens::Theme theme)
{
    QSettings settings;
    settings.setValue(QLatin1String(SETTINGS_THEME_KEY), theme == ThemeTokens::Theme::Dark);
}

void ThemeManager::loadFromSettings()
{
    m_theme = themeFromSettings();
}

void ThemeManager::saveToSettings() const
{
    saveThemeToSettings(m_theme);
}

void ThemeManager::setTheme(ThemeTokens::Theme theme)
{
    m_theme = theme;
}

QString ThemeManager::loadStylesheet() const
{
    const char* resource = m_theme == ThemeTokens::Theme::Light ? ":/theme-light" : ":/theme-dark";
    QFile f(resource);
    if (!f.open(QFile::ReadOnly | QFile::Text)) {
        QFile fallback(":/style");
        if (fallback.open(QFile::ReadOnly | QFile::Text)) {
            return QTextStream(&fallback).readAll();
        }
        return QString();
    }
    return QTextStream(&f).readAll();
}

void ThemeManager::apply(QApplication* app)
{
    if (!app) return;
    app->setStyleSheet(loadStylesheet());
    for (QWidget* w : app->topLevelWidgets()) {
        repolishWidgetTree(w);
    }
}

void ThemeManager::apply(QWidget* widget)
{
    if (!widget) return;
    widget->setStyleSheet(loadStylesheet());
}
