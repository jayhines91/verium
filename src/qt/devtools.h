// Copyright (c) 2026 The Vericoin developers
// Distributed under the MIT software license, see the accompanying
// file COPYING or http://www.opensource.org/licenses/mit-license.php.

#ifndef BITCOIN_QT_DEVTOOLS_H
#define BITCOIN_QT_DEVTOOLS_H

#include <util/devhelperconfig.h>

#if ENABLE_DEV_HELPER_WINDOW

class QWidget;

namespace DevTools {

/** One-time startup prompt: open verbose trace or no dev access until restart. */
void OfferStartupTraceWindow(QWidget* parent);

} // namespace DevTools

#endif // ENABLE_DEV_HELPER_WINDOW

#endif // BITCOIN_QT_DEVTOOLS_H
