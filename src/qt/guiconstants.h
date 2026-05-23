// Copyright (c) 2011-2018 The Bitcoin Core developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_QT_GUICONSTANTS_H
#define BITCOIN_QT_GUICONSTANTS_H

#include <qt/themetokens.h>

#include <cstdint>

/* Milliseconds between model updates */
static const int MODEL_UPDATE_DELAY = 250;

/* AskPassphraseDialog -- Maximum passphrase length */
static const int MAX_PASSPHRASE_SIZE = 1024;

/* BitcoinGUI -- Size of icons in status bar */
static const int STATUSBAR_ICONSIZE = 16;

static const bool DEFAULT_SPLASHSCREEN = true;

/* Invalid field — use property class invalid on QLineEdit where possible */
#define STYLE_INVALID "background-color: rgba(233, 58, 93, 0.25); border: 1px solid #e93a5d;"

/* Transaction list colors (theme-aware) */
#define COLOR_UNCONFIRMED (ThemeTokens::paletteForCurrentTheme().txUnconfirmed)
#define COLOR_NEGATIVE (ThemeTokens::paletteForCurrentTheme().txNegative)
#define COLOR_POSITIVE (ThemeTokens::paletteForCurrentTheme().txPositive)
#define COLOR_BAREADDRESS (ThemeTokens::paletteForCurrentTheme().txBareAddress)
#define COLOR_TX_STATUS_OPENUNTILDATE QColor(64, 64, 255)
#define COLOR_TX_STATUS_DANGER (ThemeTokens::paletteForCurrentTheme().danger)
#define COLOR_BLACK (ThemeTokens::paletteForCurrentTheme().textPrimary)

/* Tooltips longer than this (in characters) are converted into rich text,
   so that they can be word-wrapped.
 */
static const int TOOLTIP_WRAP_THRESHOLD = 80;

/* Number of frames in spinner animation */
#define SPINNER_FRAMES 36

#define QAPP_ORG_NAME "Verium"
#define QAPP_ORG_DOMAIN "vericonomy.com"
#define QAPP_APP_NAME_DEFAULT "Verium-Qt"
#define QAPP_APP_NAME_TESTNET "Verium-Qt-testnet"
#define QAPP_APP_NAME_REGTEST "Verium-Qt-regtest"

#define COMMUNITY_EXPLORER_URL "https://explorer-vrm.vericonomy.com/"
#define COMMUNITY_TWITTER_URL "https://twitter.com/vericonomy"
#define COMMUNITY_CHAT_URL "https://vericonomy.com"
#define COMMUNITY_WEBSITE_URL "https://vericonomy.com"

/* One gigabyte (GB) in bytes */
static constexpr uint64_t GB_BYTES{1000000000};

#endif // BITCOIN_QT_GUICONSTANTS_H
